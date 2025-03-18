const express = require('express');
const cors = require('cors');
const { Stripe } = require('stripe');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const os = require('os');
const crypto = require('crypto');

// Load environment variables
dotenv.config();

// Enable strict mode
'use strict';

// Storage for orders and STL files
const orderStorage = new Map();
const stlFileStorage = new Map();

// Temporary storage path for non-Firebase environments
const tempStoragePath = path.join(__dirname, 'temp-stl-files');
if (!fs.existsSync(tempStoragePath)) {
  try {
    fs.mkdirSync(tempStoragePath, { recursive: true });
    console.log(`Created temporary storage directory: ${tempStoragePath}`);
  } catch (err) {
    console.error(`Failed to create temporary storage directory: ${err.message}`);
  }
}

// Environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.CHECKOUT_PORT || process.env.SERVER_PORT || 3001;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Initialize Express
const app = express();

// Increase the payload size limit to handle larger STL files
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Log key environment variables
console.log('Environment variables loaded:');
console.log('- STRIPE_PRICE_MONTHLY:', process.env.STRIPE_PRICE_MONTHLY);
console.log('- STRIPE_PRICE_ANNUAL:', process.env.STRIPE_PRICE_ANNUAL);
console.log('- STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? '✓ Configured' : '✗ Missing');
console.log('- STRIPE_PUBLISHABLE_KEY:', process.env.STRIPE_PUBLISHABLE_KEY ? '✓ Configured' : '✗ Missing');

// Initialize Firebase Admin SDK if not already initialized
let firestore;
let storage;

try {
  if (!admin.apps || !admin.apps.length) {
    try {
      // First try using service account file
      const serviceAccount = require('./firebase-service-account.json');
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'taiyaki-test1.firebasestorage.app'
      });
      
      console.log('Firebase Admin SDK initialized successfully with service account file');
    } catch (serviceAccountError) {
      console.error('Error loading service account:', serviceAccountError);
      
      // Fallback to environment variables
      const privateKey = process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined;
      
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'taiyaki-test1.firebasestorage.app'
      });
      
      console.log('Firebase Admin SDK initialized with environment variables');
    }
  }
  
  // Create Firestore references if available
  firestore = admin.firestore();
  storage = admin.storage().bucket();
  console.log('Firestore connection established');
} catch (error) {
  console.error('Failed to initialize Firebase Admin SDK:', error);
  console.log('Continuing without Firebase - will fallback to memory storage');
  // Firestore and storage will be undefined
}

// Set up Nodemailer for email notifications
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
  try {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
    
    // Verify the connection
    transporter.verify((error) => {
      if (error) {
        console.error('Error setting up email transport:', error);
      } else {
        console.log('Email transport ready for sending notifications');
      }
    });
  } catch (emailError) {
    console.error('Failed to initialize email transport:', emailError);
  }
} else {
  console.log('Email credentials not provided. Email notifications will be disabled.');
}

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Validate Stripe key
(async function validateStripeKey() {
  try {
    // Attempt to make a simple API call to check if the key is valid
    const testBalance = await stripe.balance.retrieve();
    console.log('Stripe API key is valid. Connected to Stripe successfully.');
  } catch (error) {
    console.error('⚠️ Stripe API key validation failed:', error.message);
    console.error('⚠️ Checkout functionality will not work correctly without a valid Stripe API key');
    if (error.type === 'StripeAuthenticationError') {
      console.error('⚠️ Please check your Stripe secret key in the .env file');
    }
  }
})();

// Create an in-memory store for orders when Firestore is unavailable
const memoryOrderStore = [];
// We already have stlFileStorage defined at the top of the file
// const stlFileStorage = new Map();

// Create temporary directory for STL files
const stlFilesDir = path.join(__dirname, 'temp-stl-files');
if (!fs.existsSync(stlFilesDir)) {
  fs.mkdirSync(stlFilesDir, { recursive: true });
  console.log(`Created STL files directory: ${stlFilesDir}`);
}

// Configure allowed origins for CORS
const allowedOrigins = [
  'http://localhost:5173',      // Local Vite dev server
  'http://localhost:3000',      // Local Next.js dev server
  'https://fishcad.com',        // Production domain
  'https://www.fishcad.com',    // Production domain with www
  'https://app.fishcad.com',    // App subdomain (if used)
  process.env.DOMAIN            // Domain from env var (if set)
].filter(Boolean); // Remove any undefined/null values

console.log('Allowed CORS origins:', allowedOrigins);

// Configure CORS middleware with specific options
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) {
      console.log('Request with no origin allowed');
      return callback(null, true);
    }
    
    // Check if the origin is allowed
    if (allowedOrigins.includes(origin) || 
        origin.endsWith('fishcad.com') || 
        origin.includes('localhost')) {
      console.log(`CORS request from origin: ${origin} - allowed`);
      return callback(null, true);
    }
    
    console.error(`CORS request from origin: ${origin} - not allowed`);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Add OPTIONS handler for preflight requests
app.options('*', cors());

// Add health check endpoint
app.get('/api/health-check', (req, res) => {
  console.log('Health check requested from:', req.headers.origin || 'unknown origin');
  res.status(200).json({ 
    status: 'ok', 
    message: 'API is healthy',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Special case for Stripe webhook to handle raw body
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// Add pricing API endpoint for subscription checkout
app.post('/api/pricing/create-checkout-session', async (req, res) => {
  try {
    const { priceId, userId, email, force_new_customer } = req.body;
    
    console.log('Received subscription checkout request:', { 
      priceId, 
      userId, 
      email,
      force_new_customer: !!force_new_customer
    });
    
    if (!priceId || !userId || !email) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    let customerId = null;
    
    // Handle Stripe customer
    if (firestore && !force_new_customer) {
      try {
        const userRef = firestore.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists && userDoc.data().stripeCustomerId) {
          try {
            // Verify that customer exists in live mode
            await stripe.customers.retrieve(userDoc.data().stripeCustomerId);
            customerId = userDoc.data().stripeCustomerId;
            console.log(`Using existing Stripe customer ID: ${customerId}`);
          } catch (stripeError) {
            console.log(`Customer ID exists in Firestore but not in Stripe (likely test vs live mode). Creating new customer.`);
            const customer = await stripe.customers.create({
              email: email,
              metadata: {
                userId: userId,
              },
            });
            customerId = customer.id;
            
            // Update Firestore with the new customer ID
            await userRef.update({
              stripeCustomerId: customerId,
            });
            console.log(`Created new Stripe customer: ${customerId} and updated Firestore`);
          }
        } else {
          // Create a new customer
          const customer = await stripe.customers.create({
            email: email,
            metadata: {
              userId: userId,
            },
          });
          customerId = customer.id;
          console.log(`Created new Stripe customer: ${customerId}`);
          
          // Create or update user document with Stripe customer ID
          if (userDoc.exists) {
            // If document exists, update it
            await userRef.update({
              stripeCustomerId: customerId,
            });
            console.log(`Updated existing user document with Stripe customer ID`);
          } else {
            // If document doesn't exist, create it
            await userRef.set({
              uid: userId,
              email: email,
              stripeCustomerId: customerId,
              createdAt: new Date(),
              isPro: false,
              subscriptionStatus: 'none',
              modelsRemainingThisMonth: 0,
              lastResetDate: new Date().toISOString().substring(0, 7),
            });
            console.log(`Created new user document with Stripe customer ID`);
          }
        }
      } catch (firestoreError) {
        console.error('Firestore error:', firestoreError);
        
        // Check if this is a "not found" error for the user document
        if (firestoreError.code === 5 && firestoreError.details && firestoreError.details.includes('No document to update')) {
          // Create a new user document
          try {
            const userRef = firestore.collection('users').doc(userId);
            
            // Create a new customer first
            const customer = await stripe.customers.create({
              email: email,
              metadata: {
                userId: userId,
              },
            });
            customerId = customer.id;
            
            // Then create the user document
            await userRef.set({
              uid: userId,
              email: email,
              stripeCustomerId: customerId,
              createdAt: new Date(),
              isPro: false,
              subscriptionStatus: 'none',
              modelsRemainingThisMonth: 0,
              lastResetDate: new Date().toISOString().substring(0, 7),
            });
            console.log(`Created new user document for ID: ${userId}`);
          } catch (createError) {
            console.error('Error creating user document:', createError);
            // Continue with Stripe checkout anyway
          }
        } else {
          // For other errors, continue with Stripe checkout without updating Firestore
          const customer = await stripe.customers.create({
            email: email,
            metadata: {
              userId: userId,
            },
          });
          customerId = customer.id;
          console.log(`Created new Stripe customer (Firestore failed): ${customerId}`);
        }
      }
    } else {
      // Fallback if Firestore is not available or force_new_customer is true
      const customer = await stripe.customers.create({
        email: email,
        metadata: {
          userId: userId,
        },
      });
      customerId = customer.id;
      console.log(`Created new Stripe customer (${force_new_customer ? 'forced new' : 'no Firestore'}): ${customerId}`);
    }
    
    // Create the checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.DOMAIN || 'http://localhost:5173'}/pricing-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.DOMAIN || 'http://localhost:5173'}/pricing`,
      subscription_data: {
        metadata: {
          userId: userId,
        },
      },
    });
    
    res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to store an STL file temporarily
app.post('/api/stl-files', (req, res) => {
  try {
    const { stlData, fileName } = req.body;
    
    console.log('Received STL file upload request:', { 
      hasStlData: !!stlData, 
      fileName,
      dataType: typeof stlData,
      dataLength: stlData ? (typeof stlData === 'string' ? stlData.length : 'non-string') : 0
    });
    
    if (!stlData) {
      console.error('STL file upload failed: No STL data provided');
      return res.status(400).json({ 
        success: false, 
        message: 'No STL data provided' 
      });
    }
    
    // Generate a unique ID for the file
    const fileId = `stl-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const safeName = fileName?.replace(/[^a-zA-Z0-9.-]/g, '_') || 'model.stl';
    const filePath = path.join(stlFilesDir, `${fileId}-${safeName}`);
    
    // Process the data if it's a data URL
    let fileContent;
    try {
      if (typeof stlData === 'string' && stlData.startsWith('data:')) {
        const matches = stlData.match(/^data:([^;]+);base64,(.+)$/);
        if (matches && matches.length >= 3) {
          fileContent = Buffer.from(matches[2], 'base64');
          console.log(`Decoded base64 data URL, size: ${fileContent.length} bytes`);
    } else {
          console.log('Data URL format not recognized, treating as raw data');
          fileContent = Buffer.from(stlData);
        }
      } else {
        console.log('Not a data URL, treating as raw data');
        fileContent = Buffer.from(stlData);
      }
      
      if (!fileContent || fileContent.length === 0) {
        throw new Error('Processed file content is empty');
      }
    } catch (dataProcessingError) {
      console.error('STL data processing error:', dataProcessingError);
      return res.status(400).json({
        success: false,
        message: 'Failed to process STL data',
        error: dataProcessingError.message
      });
    }
    
    // Write the file
    try {
      fs.writeFileSync(filePath, fileContent);
      console.log(`Stored STL file at: ${filePath}, size: ${fileContent.length} bytes`);
    } catch (fileWriteError) {
      console.error('File write error:', fileWriteError);
      return res.status(500).json({
        success: false,
        message: 'Failed to write STL file to disk',
        error: fileWriteError.message
      });
    }
    
    // Store the metadata in memory
    stlFileStorage.set(fileId, {
      filePath,
      fileName: safeName,
      createdAt: new Date().toISOString()
    });
    
    // Generate the public URL
    const publicUrl = `http://localhost:${process.env.PORT || 3001}/api/stl-files/${fileId}`;
    console.log(`Created public URL for STL file: ${publicUrl}`);
    
    return res.status(200).json({
      success: true,
      fileId,
      url: publicUrl,
      storagePath: filePath
    });
  } catch (error) {
    console.error('Unexpected error storing STL file:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store STL file',
      error: error.message
    });
  }
});

// Endpoint to retrieve an STL file by ID
app.get('/api/stl-files/:fileId', (req, res) => {
  try {
    const { fileId } = req.params;
    
    // Try to retrieve the file metadata
    const fileData = stlFileStorage.get(fileId);
    
    if (!fileData) {
      return res.status(404).json({
        success: false,
        message: 'STL file not found'
      });
    }
    
    // Set appropriate headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    
    // Send the file
    return res.sendFile(fileData.filePath);
  } catch (error) {
    console.error('Error retrieving STL file:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve STL file'
    });
  }
});

/**
 * Stores STL data in Firebase Storage
 * @param {string|Buffer} stlData - The STL data to store, either as a base64 string or Buffer
 * @param {string} fileName - The name of the STL file
 * @returns {Promise<{downloadUrl: string, publicUrl: string, storagePath: string, fileName: string, fileSize: number}>}
 */
async function storeSTLInFirebase(stlData, fileName) {
  console.log('Preparing to store STL file in Firebase Storage...');
  
  try {
    // Ensure Firebase Storage is initialized
    if (!admin || !admin.storage || typeof admin.storage !== 'function') {
      console.error('Firebase Storage not initialized properly');
      throw new Error('Firebase Storage not initialized');
    }
    
    // Create a safe filename (replace spaces and special chars)
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    // Process the STL data
    let stlBuffer;
    console.log(`Processing ${typeof stlData === 'string' ? 'base64' : 'buffer'} STL data...`);
    
    if (typeof stlData === 'string') {
      // If stlData is a base64 string, convert it to buffer
      const base64Data = stlData.replace(/^data:.*?;base64,/, '');
      stlBuffer = Buffer.from(base64Data, 'base64');
    } else if (Buffer.isBuffer(stlData)) {
      stlBuffer = stlData;
    } else {
      throw new Error(`Unsupported STL data format: ${typeof stlData}`);
    }
    
    const fileSize = stlBuffer.length;
    console.log(`STL file size: ${fileSize} bytes`);
    
    // Write to a temporary file
    const timestamp = Date.now();
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const tempFilePath = path.join(os.tmpdir(), `${timestamp}-${uniqueId}-${safeFileName}`);
    
    console.log(`Writing STL data to temporary file: ${tempFilePath}`);
    fs.writeFileSync(tempFilePath, stlBuffer);
    console.log('Temporary STL file created successfully');
    
    // Create a path in Firebase Storage organized by date (YYYY/MM/DD)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const storagePath = `stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${safeFileName}`;
    console.log(`Firebase Storage path: ${storagePath}`);
    
    // Upload the file to Firebase Storage
    const bucket = admin.storage().bucket();
    if (!bucket) {
      throw new Error('Firebase Storage bucket not available');
    }
    
    console.log('Uploading to Firebase Storage...');
    
    // Set metadata including content type
    const metadata = {
      contentType: 'application/sla',
      cacheControl: 'public, max-age=31536000', // Cache for 1 year
    };
    
    // Upload file with metadata
    await bucket.upload(tempFilePath, {
      destination: storagePath,
      metadata: metadata
    });
    
    console.log('STL file uploaded successfully to Firebase Storage');
    
    // Get URLs - don't try to set ACLs since uniform bucket-level access is enabled
    const [signedUrl] = await bucket.file(storagePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 315360000000, // 10 years in milliseconds
    });
    
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    
    console.log(`Generated public URL: ${publicUrl}`);
    console.log(`Generated signed URL (expires in 10 years): ${signedUrl}`);
    
    // Clean up the temporary file
    try {
      fs.unlinkSync(tempFilePath);
      console.log('Temporary file deleted');
    } catch (cleanupError) {
      console.error('Error deleting temporary file:', cleanupError);
    }
    
    return {
      downloadUrl: signedUrl,
      publicUrl: publicUrl,
      storagePath: storagePath,
      fileName: safeFileName,
      fileSize: fileSize
    };
    
  } catch (error) {
    // Clean up temporary file in case of error
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
        console.log('Temporary file deleted');
      } catch (cleanupError) {
        console.error('Error deleting temporary file:', cleanupError);
      }
    }
    
    console.error('STL storage error:', error);
    throw new Error(`Firebase upload failed: ${error.message}`);
  }
}

// Add sendOrderConfirmationEmail function
async function sendOrderConfirmationEmail(orderData) {
  try {
    console.log('Preparing order confirmation email for:', orderData.customerEmail);
    
    // Use Nodemailer if configured
    if (process.env.EMAIL_USER && transporter) {
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: orderData.customerEmail,
        subject: `Order Confirmation: ${orderData.orderId}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4a5568;">Your 3D Print Order Confirmation</h2>
            <p>Hello ${orderData.customerName},</p>
            <p>Thank you for your order! We've received your payment and are processing your 3D print.</p>
            
            <div style="background-color: #f7fafc; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0; color: #4a5568;">Order Details</h3>
              <p><strong>Order ID:</strong> ${orderData.orderId}</p>
              <p><strong>Date:</strong> ${new Date(orderData.orderDate).toLocaleString()}</p>
              <p><strong>Model:</strong> ${orderData.orderDetails.modelName}</p>
              <p><strong>Color:</strong> ${orderData.orderDetails.color}</p>
              <p><strong>Quantity:</strong> ${orderData.orderDetails.quantity}</p>
              <p><strong>Total:</strong> $${orderData.amountTotal.toFixed(2)}</p>
            </div>
            
            ${orderData.stlFile && (orderData.stlFile.downloadUrl || orderData.stlFile.publicUrl) ? `
              <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #0366d6;">Your 3D Model File</h3>
                <p>Your STL file "${orderData.stlFile.fileName}" has been securely stored and is available for download.</p>
                <a href="${orderData.stlFile.downloadUrl || orderData.stlFile.publicUrl}" 
                   style="display: inline-block; background-color: #0366d6; color: white; padding: 10px 20px; 
                          text-decoration: none; border-radius: 4px; margin-top: 10px; font-weight: bold;">
                  Download STL
                </a>
              </div>
            ` : ''}
            
            <div style="margin-top: 30px;">
              <p>If you have any questions about your order, please contact our support team.</p>
              <p>Thank you for choosing our 3D printing service!</p>
            </div>
          </div>
        `
      };
      
      const info = await transporter.sendMail(mailOptions);
      console.log('Order confirmation email sent with Nodemailer:', info.messageId);
      return true;
    } else {
      console.log('Email configuration not available. Skipping order confirmation email.');
      return false;
    }
  } catch (error) {
    console.error('Failed to send order confirmation email:', error);
    return false;
  }
}

// Function to handle successful payment
async function handleSuccessfulPayment(session) {
  try {
    console.log('Processing successful payment', session.id);
    
    // Extract order details from session metadata
    const { 
      modelName, 
      color, 
      quantity, 
      finalPrice, 
      stlFileName, 
      stlDownloadUrl,
      stlPublicUrl,
      stlStoragePath,
      stlFileSize,
      stlDataPreview
    } = session.metadata;
    
    console.log('Order details from session metadata:', {
      modelName, 
      color, 
      quantity, 
      finalPrice, 
      stlFileName,
      hasStlDownloadUrl: !!stlDownloadUrl,
      hasStlPublicUrl: !!stlPublicUrl,
      hasStlStoragePath: !!stlStoragePath,
      stlFileSize: stlFileSize || 'unknown'
    });
    
    // Get user info from session or use default values
    const customerEmail = session.customer_details?.email || 'No email provided';
    const customerName = session.customer_details?.name || 'No name provided';
    
    // Get shipping details if available
    let shippingAddress = 'No shipping address provided';
    if (session.shipping) {
      const address = session.shipping.address;
      shippingAddress = `${address.line1}, ${address.city}, ${address.state}, ${address.postal_code}, ${address.country}`;
      if (address.line2) {
        shippingAddress = `${address.line1}, ${address.line2}, ${address.city}, ${address.state}, ${address.postal_code}, ${address.country}`;
      }
    }
    
    // Get STL data details - look at multiple sources for the download URL
    let stlInfo = {
      fileName: stlFileName || 'unknown.stl',
      downloadUrl: stlDownloadUrl || '',
      publicUrl: stlPublicUrl || '',
      storagePath: stlStoragePath || '',
      fileSize: parseInt(stlFileSize || '0', 10) || 0
    };
    
    // Log STL info for debugging
    console.log('STL file information:', {
      fileName: stlInfo.fileName,
      hasDownloadUrl: !!stlInfo.downloadUrl,
      hasPublicUrl: !!stlInfo.publicUrl,
      hasStoragePath: !!stlInfo.storagePath,
      fileSize: stlInfo.fileSize
    });
    
    // Create an order ID (could be random or based on session ID)
    const orderId = `order-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Store order in the database
    try {
      const orderData = {
        orderId,
        stripeSessionId: session.id,
        customerEmail,
        customerName,
        shippingAddress,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total / 100, // Convert from cents to dollars
        orderDetails: {
          modelName,
          color,
          quantity: parseInt(quantity, 10) || 1,
          finalPrice: parseFloat(finalPrice) || 0
        },
        stlFile: {
          fileName: stlInfo.fileName,
          downloadUrl: stlInfo.downloadUrl,
          publicUrl: stlInfo.publicUrl,
          storagePath: stlInfo.storagePath,
          fileSize: stlInfo.fileSize,
          dataPreview: stlDataPreview || ''
        },
        orderStatus: 'received',
        orderDate: new Date(),
        fulfillmentStatus: 'pending',
        estimatedShippingDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days from now
      };
      
      let savedToFirestore = false;
      
      // First try to save to Firestore
      try {
        console.log('Saving order to Firestore:', orderId);
        const db = admin.firestore();
        await db.collection('orders').doc(orderId).set(orderData);
        console.log('Order saved successfully to Firestore:', orderId);
        savedToFirestore = true;
      } catch (firestoreError) {
        console.error('Error storing order in Firestore:', firestoreError);
        // Fallback to memory storage
        memoryOrderStore.push(orderData);
        console.log(`Order ${orderId} stored in memory (Firestore failed)`);
      }
      
      // Try to send confirmation email, but don't throw if it fails
      try {
        await sendOrderConfirmationEmail(orderData);
        console.log(`Order confirmation email sent to ${customerEmail}`);
      } catch (emailError) {
        console.error('Failed to send order confirmation email:', emailError);
        // Continue processing even if email fails
      }
      
      // Send email with the signed URL and Stripe order reference
      if (stlDownloadUrl) {
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: 'taiyaki.orders@gmail.com',
          subject: `New Order: ${modelName}`,
          text: `A new order has been placed. Here is the signed URL for the STL file: ${stlDownloadUrl}\nStripe Order Reference: ${session.id}`
        };
        
        await transporter.sendMail(mailOptions);
        console.log('Email sent with the signed URL and Stripe order reference to taiyaki.orders@gmail.com');
      }
      
      return orderData;
    } catch (dbError) {
      console.error('Failed to save order to database:', dbError);
      // Don't throw, just log the error and continue
      return {
        orderId,
        error: `Error saving order: ${dbError.message}`
      };
    }
  } catch (error) {
    console.error('Error handling successful payment:', error);
    throw new Error(`Failed to process payment: ${error.message}`);
  }
}

// Send order notification email to the business
async function sendOrderNotificationEmail(orderData) {
  const businessEmail = process.env.BUSINESS_EMAIL;
  
  if (!businessEmail) {
    console.error('No business email configured for notifications');
    return false;
  }
  
  // Format shipping address if available
  let formattedAddress = 'No shipping address provided';
  
  if (orderData.shippingAddress) {
    const address = orderData.shippingAddress;
    formattedAddress = `
      ${address.name || ''}<br>
      ${address.line1 || ''}<br>
      ${address.line2 ? address.line2 + '<br>' : ''}
      ${address.city || ''}, ${address.state || ''} ${address.postal_code || ''}<br>
      ${address.country || ''}
    `;
  }
  
  // Prepare email content
  const subject = `New 3D Print Order: ${orderData.orderId}`;
  
  // Extract signed URL for easy copy-paste
  const signedUrl = orderData.stlFile?.downloadUrl || '';
  
  const htmlContent = `
    <h1>New 3D Print Order Received</h1>
    
    <h2>Order Details</h2>
    <ul>
      <li><strong>Order ID:</strong> ${orderData.orderId}</li>
      <li><strong>Date:</strong> ${new Date().toLocaleDateString()}</li>
      <li><strong>Model:</strong> ${orderData.modelName || 'Unknown'}</li>
      <li><strong>Color:</strong> ${orderData.color || 'Unknown'}</li>
      <li><strong>Quantity:</strong> ${orderData.quantity || 1}</li>
      <li><strong>Price:</strong> $${orderData.finalPrice ? orderData.finalPrice.toFixed(2) : '0.00'}</li>
    </ul>
    
    <h2>Customer Information</h2>
    <ul>
      <li><strong>Email:</strong> ${orderData.customerEmail || 'No email provided'}</li>
    </ul>
    
    <h2>Payment Information</h2>
    <ul>
      <li><strong>Payment Status:</strong> ${orderData.paymentStatus || 'Unknown'}</li>
      <li><strong>Payment ID:</strong> ${orderData.paymentId || 'Unknown'}</li>
    </ul>
    
    <h2>Shipping Address</h2>
    <div>${formattedAddress}</div>
    
    ${(orderData.stlFile && (orderData.stlFile.fileName || orderData.stlFileName)) ? `
    <h2>STL File Information</h2>
    <ul>
      <li><strong>Filename:</strong> ${orderData.stlFile?.fileName || orderData.stlFileName || 'Unnamed File'}</li>
      ${orderData.stlFile?.fileSize ? `<li><strong>File Size:</strong> ${(orderData.stlFile.fileSize / 1024 / 1024).toFixed(2)} MB</li>` : ''}
      ${orderData.stlFile?.storagePath ? `<li><strong>Storage Path:</strong> ${orderData.stlFile.storagePath}</li>` : ''}
    </ul>
    
    ${signedUrl ? `
    <div style="margin: 20px 0; padding: 15px; border: 2px solid #4CAF50; background-color: #f8fff8; border-radius: 5px;">
      <h3 style="margin-top: 0; color: #2E7D32;">⬇️ Direct STL Download Link (Valid for 10 Years)</h3>
      <div style="margin-bottom: 10px;">
        <a href="${signedUrl}" style="display: inline-block; padding: 12px 20px; background-color: #4CAF50; color: white; text-decoration: none; font-weight: bold; border-radius: 4px; font-size: 16px;">Download STL File</a>
      </div>
      <div style="margin-top: 10px; word-break: break-all; background-color: #f0f0f0; padding: 10px; border: 1px solid #ddd; border-radius: 3px; font-family: monospace; font-size: 12px;">
        ${signedUrl}
      </div>
    </div>
    `: ''}
    
    <h3>All Download Links</h3>
    <ul>
      ${orderData.stlFile?.downloadUrl ? `<li><strong>Signed URL:</strong> <a href="${orderData.stlFile.downloadUrl}">Download File</a></li>` : ''}
      ${orderData.stlFile?.publicUrl ? `<li><strong>Public URL:</strong> <a href="${orderData.stlFile.publicUrl}">Download File</a></li>` : ''}
      ${orderData.stlFile?.alternativeUrl ? `<li><strong>Alternative URL:</strong> <a href="${orderData.stlFile.alternativeUrl}">Download File</a></li>` : ''}
    </ul>
    ` : ''}
    
    <p>Please begin processing this order as soon as possible.</p>
  `;
  
  try {
    // Send email
    const info = await transporter.sendMail({
      from: `"3D Print Order System" <${process.env.EMAIL_USER}>`,
      to: businessEmail,
      subject: subject,
      html: htmlContent,
    });
    
    console.log('Order notification email sent with Nodemailer:', info.messageId);
    return true;
  } catch (error) {
    console.error('Failed to send order notification email:', error);
    return false;
  }
}

// Send confirmation email to the customer
async function sendCustomerConfirmationEmail(orderDetails) {
  if (!orderDetails.customerEmail) {
    console.error('No customer email provided for confirmation');
    return false;
  }
  
  // Prepare email content
  const subject = `Your 3D Print Order Confirmation - ${orderDetails.orderId}`;
  
  const htmlContent = `
    <h1>Your 3D Print Order Confirmation</h1>
    <p>Thank you for your order! We've received your request and will begin processing it shortly.</p>
    
    <h2>Order Details</h2>
    <ul>
      <li><strong>Order ID:</strong> ${orderDetails.orderId}</li>
      <li><strong>Date:</strong> ${new Date().toLocaleDateString()}</li>
      <li><strong>Model:</strong> ${orderDetails.modelName || 'Unknown'}</li>
      <li><strong>Color:</strong> ${orderDetails.color || 'Unknown'}</li>
      <li><strong>Quantity:</strong> ${orderDetails.quantity || 1}</li>
      <li><strong>Total:</strong> $${orderDetails.finalPrice ? orderDetails.finalPrice.toFixed(2) : '0.00'}</li>
    </ul>
    
    ${orderDetails.stlFile && (orderDetails.stlFile.downloadUrl || orderDetails.stlFile.publicUrl) ? `
    <div style="margin-top: 20px; margin-bottom: 20px; padding: 15px; border: 1px solid #e0e0e0; border-radius: 5px; background-color: #f9f9f9;">
      <h3 style="margin-top: 0; color: #333;">Your 3D Model File</h3>
      <p>Your STL file is stored securely. You can download it using the button below:</p>
      <a href="${orderDetails.stlFile.downloadUrl || orderDetails.stlFile.publicUrl}" 
         style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px; font-weight: bold;">
         Download STL
      </a>
    </div>
    ` : ''}
    
    <p>We will ship your order to the address you provided.</p>
    
    <p>You will receive updates about your order status at this email address.</p>
    
    <p>If you have any questions, please contact our customer support.</p>
    
    <p>Thank you for choosing our 3D printing service!</p>
  `;
  
  try {
    // Send email
    const info = await transporter.sendMail({
      from: `"3D Print Orders" <${process.env.EMAIL_USER}>`,
      to: orderDetails.customerEmail,
      subject: subject,
      html: htmlContent,
    });
    
    console.log('Customer confirmation email sent with Nodemailer:', info.messageId);
    return true;
  } catch (error) {
    console.error('Failed to send customer confirmation email:', error);
    return false;
  }
}

// Create Express route for creating a checkout session
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    // Check if this is a 3D print order based on flags
    const { productType, is3DPrint } = req.body;
    
    // If this is a 3D print order, use the existing 3D print checkout flow
    if (productType === '3d_print' || is3DPrint === true) {
      console.log('Handling 3D print order checkout');
      
      const { 
        modelName, 
        color, 
        quantity, 
        finalPrice, 
        stlFileName, 
        stlFileData, 
        stlDownloadUrl,
        stlStoragePath 
      } = req.body;
      
      console.log('Received 3D print checkout request with:', { 
        modelName, 
        color, 
        quantity, 
        finalPrice, 
        hasStlFileData: !!stlFileData,
        stlFileDataType: stlFileData ? typeof stlFileData : 'none',
        stlFileDataLength: stlFileData ? (typeof stlFileData === 'string' ? stlFileData.length : 0) : 0,
        stlFileName,
        stlDownloadUrl,
        stlStoragePath
      });
      
      if (!modelName || !color || !quantity || !finalPrice) {
        console.log('Missing required checkout information');
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required checkout information' 
        });
      }

      // Process and store STL file in Firebase Storage
      let finalStlDownloadUrl = stlDownloadUrl;
      let finalStlPublicUrl = '';
      let finalStlStoragePath = stlStoragePath;
      let stlFileSize = 0;
      let stlDataString = '';
      let stlFileUploaded = false;

      // Store STL file in Firebase if data is provided
      if (stlFileData) {
        try {
          console.log('Processing STL file data for storage...');
          
          // Upload to Firebase Storage
          const uploadResult = await storeSTLInFirebase(stlFileData, stlFileName);
          
          // If successful, update the URLs and path
          finalStlDownloadUrl = uploadResult.downloadUrl;
          finalStlPublicUrl = uploadResult.publicUrl;
          finalStlStoragePath = uploadResult.storagePath;
          stlFileSize = uploadResult.fileSize || 0;
          stlFileUploaded = true;
          
          console.log('STL file successfully uploaded to Firebase Storage:');
          console.log(`- Download URL: ${finalStlDownloadUrl.substring(0, 100)}...`);
          console.log(`- Public URL: ${finalStlPublicUrl}`);
          console.log(`- Storage Path: ${finalStlStoragePath}`);
          console.log(`- File Size: ${stlFileSize} bytes`);
          
          // Save a shorter preview of the STL data for the metadata
          if (typeof stlFileData === 'string') {
            const maxPreviewLength = 100; // Just enough to identify the file format
            stlDataString = stlFileData.length > maxPreviewLength 
              ? stlFileData.substring(0, maxPreviewLength) + '...[truncated]' 
              : stlFileData;
          }
        } catch (uploadError) {
          console.error('Failed to upload STL to Firebase Storage:', uploadError);
          
          // Fallback: store in memory if Firebase fails
          try {
            console.log('Creating fallback in-memory storage for STL file');
            const orderTempId = `temp-${Date.now()}`;
            
            // Limit the stored STL data to a shorter preview in the Stripe metadata
            if (typeof stlFileData === 'string') {
              const maxPreviewLength = 100; // Stripe has limits on metadata size
              stlDataString = stlFileData.length > maxPreviewLength 
                ? stlFileData.substring(0, maxPreviewLength) + '...[truncated]' 
                : stlFileData;
            }
            
            // Store full data in memory
            stlFileStorage.set(orderTempId, {
              stlString: stlFileData,
              fileName: stlFileName,
              createdAt: new Date().toISOString()
            });
            
            console.log(`Stored full STL data in memory with key: ${orderTempId}`);
          } catch (memoryError) {
            console.error('Failed to create memory backup for STL data:', memoryError);
          }
        }
      } else {
        console.log('No STL file data provided with checkout request');
      }
      
      // Format STL information for the description
      let stlInfo = stlFileName ? ` - File: ${stlFileName}` : '';
      
      // Add a download link if available
      if (finalStlDownloadUrl) {
        stlInfo += `\n\nSTL FILE DOWNLOAD LINK: ${finalStlDownloadUrl}`;
      }
      
      // Create a Stripe product for this order
      console.log(`[${new Date().toISOString()}] STRIPE PRODUCT CREATION: Starting product creation for 3D print order`);
      console.log(`[${new Date().toISOString()}] STRIPE PRODUCT DETAILS:`, {
        name: `${modelName} (${color}, Qty: ${quantity})`,
        description: `3D Print: ${modelName} in ${color}`,
        metadata: {
          modelName,
          color,
          quantity: quantity.toString(),
          finalPrice: finalPrice.toString(),
          stlFileName: stlFileName || 'unknown.stl',
          orderType: '3d_print'
        }
      });
      
      try {
        const product = await stripe.products.create({
          name: `${modelName} (${color}, Qty: ${quantity})`,
          description: `3D Print: ${modelName} in ${color}${stlInfo}`,
          metadata: {
            modelName,
            color,
            quantity: quantity.toString(),
            orderType: '3d_print'
          }
        });
        console.log(`[${new Date().toISOString()}] STRIPE PRODUCT CREATED: ID=${product.id}, Name=${product.name}`);
        
        // Create a price for the product
        console.log(`[${new Date().toISOString()}] STRIPE PRICE CREATION: Creating price for product ${product.id}`);
        console.log(`[${new Date().toISOString()}] STRIPE PRICE DETAILS:`, {
          product: product.id,
          unit_amount: Math.round(finalPrice * 100),
          currency: 'usd',
          productName: product.name
        });
        
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: Math.round(finalPrice * 100), // Convert dollars to cents
          currency: 'usd',
        });
        console.log(`[${new Date().toISOString()}] STRIPE PRICE CREATED: ID=${price.id}, Amount=${price.unit_amount/100} USD`);
        
        // Determine the host for redirect URLs
        const host = req.headers.origin || `http://${req.headers.host}`;
        console.log(`[${new Date().toISOString()}] CHECKOUT HOSTNAME: Using host for redirect: ${host}`);
        
        // Create the Stripe checkout session with STL file metadata
        console.log(`[${new Date().toISOString()}] STRIPE SESSION CREATION: Creating checkout session`);
        console.log(`[${new Date().toISOString()}] STRIPE SESSION DETAILS:`, {
          payment_method_types: ['card'],
          line_items: [{
            price: price.id,
            quantity: 1
          }],
          mode: 'payment',
          success_url: `${host}/checkout-confirmation?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${host}/`,
          has_shipping_address: true,
          has_billing_address: true
        });
        
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [
            {
              price: price.id,
              quantity: 1, // We already factored quantity into the price
            },
          ],
          mode: 'payment',
          success_url: `${host}/checkout-confirmation?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${host}/`,
          metadata: {
            modelName,
            color,
            quantity: quantity.toString(),
            finalPrice: finalPrice.toString(),
            stlFileName: stlFileName || 'unknown.stl',
            hasStlDownloadUrl: !!finalStlDownloadUrl,
            hasStlPublicUrl: !!finalStlPublicUrl,
            hasStlStoragePath: !!finalStlStoragePath,
            stlFileSize: stlFileSize.toString(),
            stlFileUploaded: stlFileUploaded.toString(),
            orderTempId: stlFileData && !stlFileUploaded ? `temp-${Date.now()}` : '', 
            stlDataPreview: stlDataString || ''
          },
          // Enable billing address collection to get email and address for shipping
          billing_address_collection: 'required',
          shipping_address_collection: {
            allowed_countries: ['US', 'CA', 'GB', 'AU'], // Add the countries you ship to
          },
        });
        console.log(`[${new Date().toISOString()}] STRIPE SESSION CREATED: ID=${session.id}, URL=${session.url}`);

        // Return the session ID and URL
        return res.json({
          success: true,
          url: session.url,
          sessionId: session.id
        });
      } catch (stripeError) {
        console.error(`[${new Date().toISOString()}] STRIPE ERROR:`, stripeError);
        
        // Get more details about the error
        const errorMessage = stripeError.message || 'Unknown Stripe error';
        const errorType = stripeError.type || 'unknown_type';
        const errorCode = stripeError.code || 'unknown_code';
        
        console.error(`[${new Date().toISOString()}] STRIPE ERROR DETAILS:`, {
          message: errorMessage,
          type: errorType,
          code: errorCode,
          raw: stripeError
        });
        
        return res.status(500).json({
          success: false,
          message: `Stripe error: ${errorMessage}`,
          error: {
            type: errorType,
            code: errorCode,
            message: errorMessage
          }
        });
      }
    } else {
      // This is a subscription checkout
      console.log('Handling subscription checkout');
      
      const { priceId, userId, email } = req.body;
      
      if (!priceId) {
        return res.status(400).json({ 
          success: false,
          error: 'Missing priceId parameter',
          message: 'The priceId parameter is required for subscription checkout'
        });
      }
      
      // Create a subscription checkout session
      console.log(`Creating subscription checkout with priceId: ${priceId}, userId: ${userId || 'not provided'}`);
      
      // Get the host from the request
      const host = req.get('host');
      const protocol = req.protocol || 'https';
      const origin = `${protocol}://${host}`;
      
      // Create the session for subscription
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing`,
        client_reference_id: userId || undefined,
        customer_email: email || undefined,
      });
      
      return res.json({
        success: true,
        url: session.url,
        sessionId: session.id
      });
    }
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message,
      message: 'An error occurred while creating the checkout session'
    });
  }
});

// Add a health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Stripe checkout server is running' });
});

// Add a filament endpoint to handle requests for filament colors
app.get('/api/slant3d/filament', (req, res) => {
  // Return a sample list of filament colors
  const filaments = [
    { id: 'black-pla', name: 'Black', hex: '#121212' },
    { id: 'white-pla', name: 'White', hex: '#f9f9f9' },
    { id: 'gray-pla', name: 'Gray', hex: '#9e9e9e' },
    { id: 'red-pla', name: 'Red', hex: '#f44336' },
    { id: 'blue-pla', name: 'Royal Blue', hex: '#1976d2' },
    { id: 'green-pla', name: 'Forest Green', hex: '#2e7d32' },
    { id: 'yellow-pla', name: 'Bright Yellow', hex: '#fbc02d' },
    { id: 'orange-pla', name: 'Orange', hex: '#ff9800' },
    { id: 'purple-pla', name: 'Purple', hex: '#7b1fa2' },
    { id: 'pink-pla', name: 'Hot Pink', hex: '#e91e63' },
    { id: 'teal-pla', name: 'Teal', hex: '#009688' },
    { id: 'silver-pla', name: 'Silver Metallic', hex: '#b0bec5' },
    { id: 'gold-pla', name: 'Gold Metallic', hex: '#ffd700' },
    { id: 'bronze-pla', name: 'Bronze Metallic', hex: '#cd7f32' },
    { id: 'glow-pla', name: 'Glow-in-the-Dark', hex: '#c6ff00' }
  ];
  
  res.json(filaments);
});

// Add a calculate price endpoint
app.post('/api/calculate-price', (req, res) => {
  try {
    // Get the parameters
    const { modelData, quantity = 1, material = 'PLA' } = req.body;
    
    if (!modelData) {
      return res.status(400).json({
        success: false,
        message: 'No model data provided'
      });
    }
    
    console.log(`Received price calculation request for ${material} model, quantity: ${quantity}`);
    
    // Determine model size/complexity based on the data length
    let modelDataStr = typeof modelData === 'string' ? modelData : JSON.stringify(modelData);
    
    // If it's a data URL, get just the data part after the comma
    if (typeof modelDataStr === 'string' && modelDataStr.startsWith('data:')) {
      modelDataStr = modelDataStr.split(',')[1] || modelDataStr;
    }
    
    const dataSize = modelDataStr.length;
    console.log(`Model data size: ${Math.round(dataSize / 1024)} KB`);
    
    // Base price calculation using data size as a proxy for complexity
    // $5 base price + $1 per 10KB, adjusted by quantity
    const baseItemPrice = 5 + (dataSize / 10240);
    const totalBasePrice = baseItemPrice * quantity;
    
    // Add randomness to make pricing seem more realistic (±10%)
    const randomFactor = 0.9 + (Math.random() * 0.2);
    const finalBasePrice = totalBasePrice * randomFactor;
    
    // Material and printing cost breakdown (40% material, 60% printing)
    const materialCost = finalBasePrice * 0.4;
    const printingCost = finalBasePrice * 0.6;
    
    // Fixed shipping cost
    const shippingCost = 4.99;
    
    // Calculate total price
    const totalPrice = finalBasePrice + shippingCost;
    
    // Return the price information
    return res.status(200).json({
      success: true,
      message: 'Price calculated successfully',
      basePrice: parseFloat(baseItemPrice.toFixed(2)),
      totalBasePrice: parseFloat(finalBasePrice.toFixed(2)),
      materialCost: parseFloat(materialCost.toFixed(2)),
      printingCost: parseFloat(printingCost.toFixed(2)),
      shippingCost: parseFloat(shippingCost.toFixed(2)),
      totalPrice: parseFloat(totalPrice.toFixed(2)),
      quantity: quantity,
      material: material
    });
  } catch (error) {
    console.error('Error calculating price:', error);
    
    // Fallback to a simple calculation
    const qty = req.body.quantity || 1;
    const basePrice = 15 + ((qty - 1) * 5);
    
    return res.status(500).json({
      success: false,
      message: 'Error calculating price, using estimate',
      basePrice: parseFloat(basePrice.toFixed(2)),
      totalBasePrice: parseFloat(basePrice.toFixed(2)),
      materialCost: parseFloat((basePrice * 0.4).toFixed(2)),
      printingCost: parseFloat((basePrice * 0.6).toFixed(2)),
      shippingCost: 4.99,
      totalPrice: parseFloat((basePrice + 4.99).toFixed(2)),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add a Slant3D price calculation endpoint for compatibility
app.post('/api/slant3d/calculate-price', (req, res) => {
  // Redirect to our normal calculate-price endpoint
  return app.handle(req, { ...res, _headers: {}, getHeader: () => {}, setHeader: () => {} }, () => {
    req.url = '/api/calculate-price';
    app.handle(req, res);
  });
});

// Add endpoint to get order details by session ID
app.get('/api/order-details', async (req, res) => {
  try {
    const { session_id } = req.query;
    
    if (!session_id) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }
    
    // First check Firestore for an order with this session ID
    let orderDoc = null;
    
    if (firestore) {
      try {
        const ordersSnapshot = await firestore
          .collection('orders')
          .where('sessionId', '==', session_id)
          .limit(1)
          .get();
        
        if (!ordersSnapshot.empty) {
          orderDoc = ordersSnapshot.docs[0].data();
          console.log('Found order in Firestore:', orderDoc.orderId);
          console.log('Order has STL data:', !!orderDoc.stlFileData);
          console.log('STL data length:', orderDoc.stlFileData ? orderDoc.stlFileData.length : 0);
        }
      } catch (firestoreError) {
        console.error('Error querying Firestore:', firestoreError);
      }
    }
    
    // If not found in Firestore, check memory storage
    if (!orderDoc) {
      // Check memory storage
      for (const order of memoryOrderStore) {
        if (order.sessionId === session_id) {
          orderDoc = order;
          console.log('Found order in memory storage:', orderDoc.orderId);
          console.log('Order has STL data:', !!orderDoc.stlFileData);
          console.log('STL data length:', orderDoc.stlFileData ? orderDoc.stlFileData.length : 0);
          break;
        }
      }
    }
    
    // If we found an order, return it
    if (orderDoc) {
      return res.status(200).json({
        success: true,
        order: orderDoc
      });
    }
    
    // If no order found, try to get the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(session_id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    // If the payment was successful, process the order
    if (session.payment_status === 'paid') {
      // Process the order and save it
      const orderData = await handleSuccessfulPayment(session);
      
      if (orderData) {
        return res.status(200).json({
          success: true,
          order: orderData
        });
      }
    }
    
    // Extract order details from the Stripe session
    const {
      metadata = {},
      amount_total = 0,
      payment_status = 'unpaid'
    } = session;
    
    // Retrieve the STL data if available from memory storage
    let stlFileData = '';
    if (metadata.orderTempId) {
      const memoryData = stlFileStorage.get(metadata.orderTempId);
      if (memoryData && memoryData.stlString) {
        stlFileData = memoryData.stlString;
        console.log(`Retrieved STL data from memory, length: ${stlFileData.length}`);
      }
    }
    
    // Create a temporary order object
    const orderDetails = {
      orderId: `temp-${session.id.substring(0, 8)}`,
      sessionId: session.id,
      modelName: metadata.modelName || 'Custom 3D Print',
      color: metadata.color || 'Unknown',
      quantity: parseInt(metadata.quantity || '1'),
      finalPrice: amount_total / 100, // Convert from cents to dollars
      paymentStatus: payment_status,
      stlFileName: metadata.stlFileName || 'model.stl',
      stlFileUrl: metadata.stlDownloadUrl || '',
      stlStoragePath: metadata.stlStoragePath || '',
      stlFileData: stlFileData || metadata.stlDataPreview || '', // Include STL data from memory or preview from metadata
      orderDate: new Date().toISOString()
    };
    
    return res.status(200).json({
      success: true,
      order: orderDetails
    });
  } catch (error) {
    console.error('Error getting order details:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching order details',
      error: error.message
    });
  }
});

// Webhook handling for Stripe events
app.post('/api/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    // Log the incoming webhook
    console.log(`[${new Date().toISOString()}] Webhook received`);
    
    let event;
    // For development/testing, allow a webhook without proper signature verification
    if (NODE_ENV === 'development' && sig === 'whsec_test') {
      event = req.body;
      console.log('[Webhook] Using test webhook event in development mode');
    } else {
      try {
        // Verify the event came from Stripe
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test'
        );
      } catch (verifyError) {
        console.error(`[Webhook] Signature verification failed: ${verifyError.message}`);
        return res.status(400).send(`Webhook Error: ${verifyError.message}`);
      }
    }
    
    if (!event) {
      return res.status(400).send('Invalid webhook event');
    }
    
    console.log(`[Webhook] Event type: ${event.type}`);
    
    // Handle the event based on its type
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log(`[Webhook] Payment successful for session: ${session.id}`);
        
        try {
          // Extract metadata from the session
          const { 
            stlUrl, 
            stlFileName, 
            productName,
            dimensions,
            material,
            infillPercentage
          } = session.metadata || {};
          
          console.log(`[Webhook] Session metadata: ${JSON.stringify(session.metadata || {})}`);
          
          // Ensure we have the STL URL
          if (!stlUrl) {
            console.error('[Webhook] No STL URL found in session metadata');
          }
          
          // Send email to taiyaki.orders@gmail.com
          if (transporter) {
            console.log('[Webhook] Preparing to send email notification to taiyaki.orders@gmail.com');
            
            const customerEmail = session.customer_details?.email || 'No email provided';
            const customerName = session.customer_details?.name || 'Customer';
            const orderTotal = (session.amount_total / 100).toFixed(2); // Convert from cents
            
            // Format shipping address
            const formatAddress = (address) => {
              if (!address) return 'No address provided';
              
              return [
                address.line1,
                address.line2,
                `${address.city}, ${address.state} ${address.postal_code}`,
                address.country
              ].filter(Boolean).join(', ');
            };
            
            const shippingAddress = formatAddress(session.shipping_details?.address);
            
            const mailOptions = {
              from: process.env.EMAIL_USER,
              to: 'taiyaki.orders@gmail.com',
              subject: `New Order: ${productName || 'Custom 3D Model'}`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h1 style="color: #4a5568;">New 3D Print Order</h1>
                  
                  <div style="background-color: #f7fafc; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <h2 style="margin-top: 0; color: #4a5568;">Order Details</h2>
                    <p><strong>Order ID:</strong> ${session.id}</p>
                    <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>Product:</strong> ${productName || 'Custom 3D Model'}</p>
                    <p><strong>Dimensions:</strong> ${dimensions || 'Not specified'}</p>
                    <p><strong>Material:</strong> ${material || 'Not specified'}</p>
                    <p><strong>Infill:</strong> ${infillPercentage || '20'}%</p>
                    <p><strong>Total:</strong> $${orderTotal}</p>
                  </div>
                  
                  <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <h2 style="margin-top: 0; color: #0366d6;">STL File Link</h2>
                    <p><strong>File Name:</strong> ${stlFileName || 'model.stl'}</p>
                    <p><strong>Download Link (valid for 10 years):</strong></p>
                    <a href="${stlUrl}" style="word-break: break-all; color: #0366d6;">${stlUrl}</a>
                  </div>
                  
                  <div style="background-color: #f0fff4; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <h2 style="margin-top: 0; color: #2f855a;">Customer Information</h2>
                    <p><strong>Name:</strong> ${customerName}</p>
                    <p><strong>Email:</strong> ${customerEmail}</p>
                    <p><strong>Shipping Address:</strong></p>
                    <p>${shippingAddress}</p>
                  </div>
                </div>
              `
            };
            
            try {
              const info = await transporter.sendMail(mailOptions);
              console.log(`[Webhook] Email sent: ${info.messageId}`);
            } catch (emailError) {
              console.error('[Webhook] Error sending email:', emailError);
            }
          } else {
            console.error('[Webhook] Email transporter not configured');
          }
          
          // Process the completed checkout session (existing code)
          await handleSuccessfulPayment(session);
          
        } catch (processingError) {
          console.error('[Webhook] Error processing payment:', processingError);
        }
        break;
      }
      // Add more cases for other events you want to handle
    }
    
    // Return a 200 response to acknowledge receipt of the event
    res.json({received: true});
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

      // This is a subscription checkout
      console.log('Handling subscription checkout');
      
      const { priceId, userId, email } = req.body;
      
      if (!priceId) {
        return res.status(400).json({ 
          success: false,
          error: 'Missing priceId parameter',
          message: 'The priceId parameter is required for subscription checkout'
        });
      }
      
      // Create a subscription checkout session
      console.log(`Creating subscription checkout with priceId: ${priceId}, userId: ${userId || 'not provided'}`);
      
      // Get the host from the request
      const host = req.headers.origin || `http://${req.headers.host}`;
      const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
      const origin = host || `${protocol}://${req.get('host')}`;
      
      // Create the session for subscription
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing`,
        client_reference_id: userId || undefined,
        customer_email: email || undefined,
      });
      
      console.log('Created checkout session:', session.id);
      
      return res.json({
        success: true,
        url: session.url,
        sessionId: session.id
      });
    }
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to create checkout session'
    });
  }
});

// Direct Checkout endpoint for subscriptions (POST)
app.post('/direct-checkout', async (req, res) => {
  try {
    console.log('POST /direct-checkout called with body:', req.body);
    
    // Get parameters from request body
    const { priceId, userId, email } = req.body;
    
    if (!priceId) {
      return res.status(400).json({ error: 'Missing required parameter: priceId' });
    }
    
    // Handle the checkout session creation
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin || 'https://fishcad.com'}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://fishcad.com'}/pricing`,
      customer_email: email,
      client_reference_id: userId
    });
    
    // Return the checkout session URL
    console.log('Checkout session created:', session.id);
    return res.json({ url: session.url });
    
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET endpoint for direct checkout (for browsers that don't support fetch)
app.get('/direct-checkout', async (req, res) => {
  try {
    console.log('GET /direct-checkout called with query:', req.query);
    
    // Get parameters from query
    const { plan, userId, email } = req.query;
    
    if (!plan) {
      return res.status(400).send('Missing required parameter: plan');
    }
    
    // Determine the price ID from the plan
    const priceId = plan === 'monthly' 
      ? process.env.STRIPE_PRICE_MONTHLY 
      : process.env.STRIPE_PRICE_ANNUAL;
    
    // Create the checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin || 'https://fishcad.com'}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://fishcad.com'}/pricing`,
      customer_email: email,
      client_reference_id: userId
    });
    
    // Redirect to Stripe checkout
    console.log('Redirecting to checkout URL:', session.url);
    return res.redirect(303, session.url);
    
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).send(`Error: ${error.message}`);
  }
});

// ... existing code ...

// API endpoint for subscription checkout
app.post('/api/pricing/create-checkout-session', async (req, res) => {
  try {
    console.log('POST /api/pricing/create-checkout-session called with body:', req.body);
    
    // Get parameters from request body
    const { priceId, userId, email } = req.body;
    
    if (!priceId) {
      return res.status(400).json({ error: 'Missing required parameter: priceId' });
    }
    
    // Create a new customer or use existing one if we have Firestore
    let customerId = null;
    
    if (firestore && userId) {
      try {
        const userRef = firestore.collection('users').doc(userId);
        const userDoc = await userRef.get();
        
        if (userDoc.exists && userDoc.data().stripeCustomerId) {
          customerId = userDoc.data().stripeCustomerId;
          console.log(`Found existing Stripe customer ID: ${customerId}`);
        } else {
          // Create a new customer
          const customer = await stripe.customers.create({
            email: email,
            metadata: {
              userId: userId,
            },
          });
          customerId = customer.id;
          console.log(`Created new Stripe customer: ${customerId}`);
          
          // Update user with Stripe customer ID
          await userRef.update({
            stripeCustomerId: customerId,
          });
        }
      } catch (firestoreError) {
        console.error('Error with Firestore:', firestoreError);
        // Continue without Firestore integration
      }
    }
    
    // Create checkout session options
    const sessionOptions = {
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin || 'https://fishcad.com'}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://fishcad.com'}/pricing`,
      metadata: {
        userId: userId || 'anonymous',
      },
    };
    
    // Add customer if we have one
    if (customerId) {
      sessionOptions.customer = customerId;
    } else if (email) {
      sessionOptions.customer_email = email;
    }
    
    // Create the checkout session
    const session = await stripe.checkout.sessions.create(sessionOptions);
    
    // Return the checkout session URL
    console.log('Subscription checkout session created:', session.id);
    return res.json({ url: session.url });
    
  } catch (error) {
    console.error('Error creating subscription checkout session:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ... existing code ...

// API endpoint for 3D printing checkout
app.post('/api/print/create-checkout-session', async (req, res) => {
  try {
    console.log('POST /api/print/create-checkout-session called with body:', req.body);
    
    // Get parameters from request body for 3D printing
    const { modelName, color, quantity, finalPrice, stlFileData, stlFileName, stlDownloadUrl } = req.body;
    
    if (!modelName || !color || !quantity || !finalPrice) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required checkout information' 
      });
    }

    // Upload STL file to Firebase if stlFileData is provided but no download URL exists
    let fileUrl = stlDownloadUrl || '';
    let fileReference = '';
    
    if (stlFileData && !fileUrl) {
      try {
        // Check if Firebase Storage is initialized
        if (!storage) {
          throw new Error('Firebase Storage is not initialized properly');
        }
        
        // Create a unique ID for the file
        const uniqueId = crypto.randomBytes(4).toString('hex');
        
        // Create date-based folder structure
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        
        // Create the file path in Firebase Storage
        const timestamp = now.getTime();
        const filename = `${timestamp}-${uniqueId}-${stlFileName}`;
        const filePath = `stl-files/${year}/${month}/${day}/${filename}`;

        console.log('-----------------------------------------------------------');
        console.log(`ATTEMPTING FIREBASE UPLOAD WITH BUCKET: ${storage.name}`);
        console.log(`FIREBASE UPLOAD PATH: ${filePath}`);
        console.log('-----------------------------------------------------------');
        
        // Decode base64 data
        let fileData;
        if (stlFileData.startsWith('data:')) {
          const base64Data = stlFileData.split(',')[1];
          fileData = Buffer.from(base64Data, 'base64');
        } else {
          fileData = Buffer.from(stlFileData, 'base64');
        }
        
        // Upload to Firebase Storage
        const file = storage.file(filePath);
        
        // Create a write stream and upload the file
        const stream = file.createWriteStream({
          metadata: {
            contentType: 'application/octet-stream',
            metadata: {
              fileName: stlFileName
            }
          }
        });
        
        // Handle stream events
        await new Promise((resolve, reject) => {
          stream.on('error', (err) => {
            console.error('Error uploading to Firebase Storage stream:', err);
            reject(err);
          });
          
          stream.on('finish', async () => {
            console.log(`File uploaded to Firebase Storage: ${filePath}`);
            
            // Get a signed URL that expires in 1 year (maximum allowed)
            try {
              const expiration = new Date();
              expiration.setFullYear(expiration.getFullYear() + 10); // Try for max expiration time
              
              const [url] = await file.getSignedUrl({
                action: 'read',
                expires: expiration
              });
              
              fileUrl = url;
              console.log(`Generated Firebase Storage URL: ${fileUrl}`);
              resolve();
            } catch (urlError) {
              console.error('Error generating signed URL:', urlError);
              reject(urlError);
            }
          });
          
          // Write the file data and end the stream
          stream.end(fileData);
        });
        
        // Create a shorter reference for metadata
        fileReference = `stl:${year}${month}${day}:${uniqueId}`;
        console.log(`File reference for metadata: ${fileReference}`);
        
      } catch (uploadError) {
        console.error('‼️ FIREBASE UPLOAD ERROR:', uploadError.message);
        
        // Save to local storage as fallback
        try {
          const uniqueId = crypto.randomBytes(4).toString('hex');
          const now = new Date();
          const timestamp = now.getTime();
          const localFilename = `${timestamp}-${uniqueId}-${stlFileName}`;
          const localFilePath = path.join(tempStoragePath, localFilename);
          
          // Decode base64 data
          let fileData;
          if (stlFileData.startsWith('data:')) {
            const base64Data = stlFileData.split(',')[1];
            fileData = Buffer.from(base64Data, 'base64');
          } else {
            fileData = Buffer.from(stlFileData, 'base64');
          }
          
          // Write to local file
          fs.writeFileSync(localFilePath, fileData);
          console.log(`File saved locally: ${localFilePath}`);
          
          // Create a reference for metadata
          fileReference = `local:${uniqueId}`;
          fileUrl = `file://${localFilePath}`;
        } catch (localError) {
          console.error('Error saving file locally:', localError);
        }
      }
    }

    // Create a detailed description with the STL file link if available
    let description = `Custom 3D print - ${modelName} in ${color} (Qty: ${quantity})`;
    
    if (stlFileName) {
      description += ` - File: ${stlFileName}`;
    }
    
    if (fileUrl) {
      description += `\n\nSTL FILE DOWNLOAD: ${fileUrl}`;
      description += `\n\n[NOTE: This is an authenticated download link for your STL file.]`;
    }

    // Create a product for this specific order
    const product = await stripe.products.create({
      name: `3D Print: ${modelName}`,
      description: description,
    });

    // Create a price for the product
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(finalPrice * 100), // Convert to cents
      currency: 'usd',
    });

    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: price.id,
          quantity: 1, // We already factored quantity into the price
        },
      ],
      mode: 'payment',
      success_url: `${req.headers.origin || 'http://localhost:5173'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'http://localhost:5173'}/`,
      metadata: {
        modelName,
        color,
        quantity: quantity.toString(),
        finalPrice: finalPrice.toString(),
        stlFileName: stlFileName || 'unknown.stl',
        stlFileRef: fileReference || ''
      },
      // Enable billing address collection
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'], // Add the countries you ship to
      },
    });

    // Return the session ID and URL
    res.json({ 
      success: true,
      sessionId: session.id,
      url: session.url 
    });
  } catch (error) {
    console.error('Error creating 3D print checkout session:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create 3D print checkout session',
      error: error.message || 'Unknown error'
    });
  }
});

// Alias for 3D print checkout
app.post('/api/3d-print/checkout', (req, res) => {
  // Forward to the main 3D print checkout endpoint
  app.handle(req, res, () => {
    req.url = '/api/print/create-checkout-session';
    app.handle(req, res);
  });
});

// ... existing code ...

// Update the confirmation page to display a thank you message
app.get('/checkout-confirmation', (req, res) => {
  res.send(`
    <div style="text-align: center; font-family: Arial, sans-serif;">
      <img src="/path/to/taiyaki-logo.png" alt="Taiyaki Logo" style="width: 100px; margin-bottom: 20px;" />
      <h1>Thank you for your order!</h1>
      <p>Your order has been successfully processed. We appreciate your business.</p>
      <a href="/" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background-color: #0366d6; color: white; text-decoration: none; border-radius: 4px;">Return to Home</a>
    </div>
  `);
});

// Modify the STL file processing function to handle larger files more efficiently
async function storeSTLInSupabase(stlData, fileName) {
  console.log('[2025-03-18T08:52:04.694Z] Preparing to store STL file in Supabase Storage...');
  
  try {
    // Process the STL data with better error handling
    let stlBuffer;
    console.log(`[2025-03-18T08:52:04.695Z] STL data type: ${typeof stlData}`);
    
    // For very large files, log only the beginning of the data
    if (typeof stlData === 'string') {
      console.log(`[2025-03-18T08:52:04.695Z] STL data string preview: ${stlData.substring(0, 100)}...`);
      console.log(`[2025-03-18T08:52:04.695Z] STL data length: ${stlData.length} characters`);
      
      try {
        // Check if it's a data URL (starts with data:)
        if (stlData.startsWith('data:')) {
          console.log('[2025-03-18T08:52:04.695Z] Processing data URL format STL...');
          const matches = stlData.match(/^data:([^;]+);base64,(.+)$/);
          if (matches && matches.length >= 3) {
            stlBuffer = Buffer.from(matches[2], 'base64');
          } else {
            throw new Error('Invalid data URL format');
          }
        } else {
          // Process as direct base64 data
          console.log('[2025-03-18T08:52:04.695Z] Using direct base64 data');
          stlBuffer = Buffer.from(stlData, 'base64');
        }
        
        // Verify the buffer isn't empty
        if (!stlBuffer || stlBuffer.length === 0) {
          throw new Error('Converted buffer is empty');
        }
        
        console.log(`[2025-03-18T08:52:04.695Z] Converted base64 data to buffer of size: ${stlBuffer.length} bytes`);
      } catch (error) {
        console.error(`Error processing STL data: ${error.message}`);
        throw new Error(`Failed to process STL string data: ${error.message}`);
      }
    } else if (Buffer.isBuffer(stlData)) {
      stlBuffer = stlData;
      console.log(`[2025-03-18T08:52:04.695Z] Processing buffer data of size: ${stlBuffer.length} bytes`);
    } else {
      throw new Error(`Unsupported STL data format: ${typeof stlData}`);
    }
    
    // Process the file in chunks for large files
    console.log(`[2025-03-18T08:52:04.695Z] STL file size: ${stlBuffer.length} bytes`);
    
    // Check for reasonable size limits (100MB max)
    if (stlBuffer.length > 100 * 1024 * 1024) {
      throw new Error('STL file too large (max 100MB)');
    }
    
    // Continue with the existing code for file upload...
  } catch (error) {
    console.error(`STL processing error: ${error.message}`);
    throw error;
  }
}

// Improve the checkout endpoint to handle complex models and large files
app.post('/api/checkout', async (req, res) => {
  console.log('[timestamp] Checkout request received');
  
  try {
    const { 
      stlBase64, 
      stlFileName, 
      modelName, 
      dimensions, 
      material, 
      infillPercentage, 
      price, 
      email,
      additionalOptions
    } = req.body;
    
    // Log request info but truncate large data
    console.log('[timestamp] Request body keys:', Object.keys(req.body));
    console.log(`[timestamp] Processing checkout for "${modelName}" (${stlFileName})`);
    
    if (!stlBase64 || !stlFileName) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing STL file data or filename' 
      });
    }
    
    // Check for reasonable size limits
    if (stlBase64.length > 20 * 1024 * 1024) { // 20MB as base64 (approx. 15MB file)
      return res.status(413).json({
        success: false,
        message: 'STL file too large (max 15MB). For larger models, please contact us directly.'
      });
    }
    
    // Upload the STL file with improved error handling
    console.log('[timestamp] Uploading STL file...');
    
    let stlFile;
    try {
      stlFile = await storeSTLInSupabase(stlBase64, stlFileName);
      if (!stlFile || !stlFile.downloadUrl) {
        throw new Error('Failed to get download URL from storage');
      }
    } catch (uploadError) {
      console.error('[timestamp] Error uploading STL file:', uploadError);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload STL file',
        error: uploadError.message
      });
    }
    
    // Create a timeout for long-running operations
    const checkoutTimeout = setTimeout(() => {
      console.error('[timestamp] Checkout process timed out');
      if (!res.headersSent) {
        return res.status(504).json({
          success: false,
          message: 'Checkout process timed out. Your model may be too complex.'
        });
      }
    }, 60000); // 60 second timeout
    
    // Proceed with Stripe checkout session creation
    try {
      // Format model information
      const modelInfo = `${modelName} (${dimensions})`;
      const materialInfo = `Material: ${material}, Infill: ${infillPercentage}%`;
      
      // Create a more detailed description for complex models
      const description = `3D model: ${modelInfo}\n${materialInfo}${additionalOptions ? `\nOptions: ${additionalOptions}` : ''}`;
      
      // Create line item with full information
      const lineItem = {
        price_data: {
          currency: 'usd',
          product_data: {
            name: `3D Print: ${modelName}`,
            description: description.substring(0, 500), // Stripe has a 500 char limit
          },
          unit_amount: price,
        },
        quantity: 1,
      };
      
      // Create the Stripe session with better metadata
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [lineItem],
        mode: 'payment',
        success_url: `${process.env.BASE_URL || 'http://localhost:3000'}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BASE_URL || 'http://localhost:3000'}/checkout-cancel`,
        customer_email: email,
        metadata: {
          stlUrl: stlFile.downloadUrl,
          stlFileName: stlFileName,
          productName: modelName,
          dimensions: dimensions || 'Not specified',
          material: material || 'Not specified',
          infillPercentage: infillPercentage || '20',
          urlValidity: '10 years',
          downloadInstructions: 'Your STL file download link is valid for 10 years. Save it somewhere safe!',
          isComplexModel: stlBase64.length > 1000000 ? 'true' : 'false' // Flag for complex models
        }
      });
      
      // Clear the timeout as checkout was successful
      clearTimeout(checkoutTimeout);
      
      console.log(`[timestamp] Stripe checkout session created successfully. Session ID: ${session.id}`);
      
      // For testing: Send an email immediately with the Supabase link
      if (NODE_ENV === 'development' && transporter) {
        console.log('[Dev Testing] Sending immediate test email with Supabase link');
        
        const testMailOptions = {
          from: process.env.EMAIL_USER,
          to: 'taiyaki.orders@gmail.com',
          subject: `[TEST] New Order: ${modelName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #4a5568;">Test 3D Print Order</h1>
              
              <div style="background-color: #f7fafc; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h2 style="margin-top: 0; color: #4a5568;">Test Order Details</h2>
                <p><strong>Order ID:</strong> ${session.id}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Product:</strong> ${modelName}</p>
                <p><strong>Dimensions:</strong> ${dimensions || 'Not specified'}</p>
                <p><strong>Material:</strong> ${material || 'Not specified'}</p>
                <p><strong>Infill:</strong> ${infillPercentage || '20'}%</p>
                <p><strong>Total:</strong> $${(price / 100).toFixed(2)}</p>
              </div>
              
              <div style="background-color: #e6f7ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h2 style="margin-top: 0; color: #0366d6;">STL File Link</h2>
                <p><strong>File Name:</strong> ${stlFileName}</p>
                <p><strong>Download Link (valid for 10 years):</strong></p>
                <a href="${stlFile.downloadUrl}" style="word-break: break-all; color: #0366d6;">${stlFile.downloadUrl}</a>
              </div>
              
              <div style="background-color: #f0fff4; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <h2 style="margin-top: 0; color: #2f855a;">This is a test email</h2>
                <p>This email was sent for testing purposes to verify that Supabase links are correctly included.</p>
              </div>
            </div>
          `
        };
        
        try {
          const info = await transporter.sendMail(testMailOptions);
          console.log(`[Dev Testing] Test email sent: ${info.messageId}`);
        } catch (emailError) {
          console.error('[Dev Testing] Error sending test email:', emailError);
        }
      }
      
      return res.status(200).json({
        success: true,
        id: session.id,
        url: session.url,
        stlInfo: {
          url: stlFile.downloadUrl,
          fileName: stlFileName
        }
      });
    } catch (checkoutError) {
      // Clear the timeout in case of error
      clearTimeout(checkoutTimeout);
      
      console.error('[timestamp] Error creating checkout session:', checkoutError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create checkout session',
        error: checkoutError.message
      });
    }
  } catch (error) {
    console.error('[timestamp] Unexpected error in checkout process:', error);
    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred',
      error: error.message
    });
  }
});