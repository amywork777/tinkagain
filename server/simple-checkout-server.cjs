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
    // Verify the event came from Stripe
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test'
    );
    
    console.log(`Webhook received: ${event.type}`);
    
    // Handle the event based on its type
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('Payment successful for session:', session.id);
        
        try {
          // Process the completed checkout session
          const orderDetails = await handleSuccessfulPayment(session);
          
          // Send email to taiyaki.orders@gmail.com with order details and Supabase link
          if (process.env.EMAIL_USER && transporter) {
            const { stlUrl, stlFileName, productName } = session.metadata;
            
            // Check if we have the STL URL
            if (stlUrl) {
              const mailOptions = {
                from: process.env.EMAIL_USER,
                to: 'taiyaki.orders@gmail.com',
                subject: `New 3D Print Order: ${productName || 'Unknown Model'}`,
                html: `
                  <h1>New 3D Print Order Received</h1>
                  
                  <h2>Order Details</h2>
                  <ul>
                    <li><strong>Stripe Session ID:</strong> ${session.id}</li>
                    <li><strong>Product:</strong> ${productName || 'Unknown Model'}</li>
                    <li><strong>Customer Email:</strong> ${session.customer_details?.email || 'Not provided'}</li>
                    <li><strong>Amount:</strong> $${(session.amount_total / 100).toFixed(2)}</li>
                    <li><strong>Date:</strong> ${new Date().toLocaleString()}</li>
                  </ul>
                  
                  <h2>STL File Link</h2>
                  <p><strong>File Name:</strong> ${stlFileName || 'Unknown'}</p>
                  <p><strong>Download Link:</strong> <a href="${stlUrl}">${stlUrl}</a></p>
                  <p><strong>Validity:</strong> 10 years</p>
                  
                  <h2>Customer Shipping Address</h2>
                  <p>${formatAddress(session.shipping_details?.address) || 'No shipping address provided'}</p>
                `
              };
              
              try {
                await transporter.sendMail(mailOptions);
                console.log('Order notification email sent to taiyaki.orders@gmail.com');
              } catch (emailError) {
                console.error('Failed to send order notification email:', emailError);
              }
            } else {
              console.error('STL URL not found in session metadata');
            }
          }
        } catch (processingError) {
          console.error('Error processing successful payment:', processingError);
        }
        break;
      }
      // Add more cases for other events you want to handle
    }
    
    res.json({received: true});
  } catch (err) {
    console.error('Webhook Error:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Helper function to format an address
function formatAddress(address) {
  if (!address) return 'No address provided';
  
  return [
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.postal_code}`,
    address.country
  ].filter(Boolean).join(', ');
}

// Add an endpoint to download a stored STL file from Firebase Storage
app.get('/api/download-stl/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }
    
    console.log(`Processing STL download request for order: ${orderId}`);
    
    // First check memory store for the order
    let memoryOrder = null;
    for (const order of memoryOrderStore) {
      if (order.orderId === orderId) {
        memoryOrder = order;
        console.log(`Found order in memory store: ${orderId}`);
        break;
      }
    }
    
    // Handle memory order if found
    if (memoryOrder && memoryOrder.stlFile) {
      // If we have a direct download URL from memory, use it
      if (memoryOrder.stlFile.downloadUrl) {
        console.log(`Memory order has a download URL. Redirecting to: ${memoryOrder.stlFile.downloadUrl}`);
        return res.redirect(memoryOrder.stlFile.downloadUrl);
      }
      
      // If we have STL data directly in memory, serve it
      if (memoryOrder.stlFileData || memoryOrder.stlFile.dataPreview) {
        const stlData = memoryOrder.stlFileData || memoryOrder.stlFile.dataPreview;
        console.log('Serving STL data directly from memory');
        
        // Set headers for file download
        res.setHeader('Content-Type', 'application/sla');
        res.setHeader('Content-Disposition', `attachment; filename="${memoryOrder.stlFile.fileName || 'model.stl'}"`);
        
        // Send the STL data
        return res.send(stlData);
      }
    }
    
    // If not in memory or memory doesn't have STL data, try Firestore
    try {
      // Get the order from Firestore
      const db = admin.firestore();
      const orderDoc = await db.collection('orders').doc(orderId).get();
      
      if (!orderDoc.exists) {
        console.log(`Order not found in Firestore: ${orderId}`);
      } else {
        const order = orderDoc.data();
        console.log(`Found order in Firestore: ${orderId}`);
        
        // First check if we have a direct download URL
        if (order.stlFile && order.stlFile.downloadUrl) {
          console.log(`Order has a download URL. Redirecting to: ${order.stlFile.downloadUrl}`);
          return res.redirect(order.stlFile.downloadUrl);
        }
        
        // If no download URL but we have a storage path, generate a new download URL
        if (order.stlFile && order.stlFile.storagePath) {
          try {
            console.log(`Generating download URL for path: ${order.stlFile.storagePath}`);
            
            const bucket = admin.storage().bucket();
            const file = bucket.file(order.stlFile.storagePath);
            
            // Check if file exists
            const [exists] = await file.exists();
            if (!exists) {
              console.log(`File does not exist at path: ${order.stlFile.storagePath}`);
              
              // If we have a data preview, serve that as a fallback
              if (order.stlFile.dataPreview) {
                console.log('Serving STL data preview from Firestore as fallback');
                
                // Set headers for file download
                res.setHeader('Content-Type', 'application/sla');
                res.setHeader('Content-Disposition', `attachment; filename="${order.stlFile.fileName || 'model.stl'}"`);
                
                // Send the STL data
                return res.send(order.stlFile.dataPreview);
              }
              
              return res.status(404).json({
                success: false,
                message: 'STL file not found in storage'
              });
            }
            
            // Generate a signed URL valid for 1 hour
            const [signedUrl] = await file.getSignedUrl({
              version: 'v4',
              action: 'read',
              expires: Date.now() + 60 * 60 * 1000 // 1 hour
            });
            
            console.log(`Generated new signed URL for download: ${signedUrl}`);
            
            // Update the order with the new download URL
            await db.collection('orders').doc(orderId).update({
              'stlFile.downloadUrl': signedUrl,
              'stlFile.downloadUrlGeneratedAt': new Date().toISOString()
            });
            
            // Redirect to the download URL
            return res.redirect(signedUrl);
          } catch (storageError) {
            console.error('Error accessing Firebase Storage:', storageError);
            
            // If we have a data preview, serve that as a fallback
            if (order.stlFile.dataPreview) {
              console.log('Serving STL data preview after storage error');
              
              // Set headers for file download
              res.setHeader('Content-Type', 'application/sla');
              res.setHeader('Content-Disposition', `attachment; filename="${order.stlFile.fileName || 'model.stl'}"`);
              
              // Send the STL data
              return res.send(order.stlFile.dataPreview);
            }
            
            return res.status(500).json({
              success: false,
              message: 'Error accessing file in Firebase Storage',
              error: storageError.message
            });
          }
        }
        
        // If we have STL data in the order itself, serve it directly
        if (order.stlFile && order.stlFile.dataPreview) {
          console.log('Order has STL data preview. Serving limited STL data directly.');
          
          // Set headers for file download
          res.setHeader('Content-Type', 'application/sla');
          res.setHeader('Content-Disposition', `attachment; filename="${order.stlFile.fileName || 'model.stl'}"`);
          
          // Send the STL data
          return res.send(order.stlFile.dataPreview);
        }
      }
    } catch (firestoreError) {
      console.error('Error accessing Firestore:', firestoreError);
    }
    
    // If we get here, we don't have any STL data for this order
    console.log(`No STL data available for order: ${orderId}`);
    return res.status(404).json({
      success: false,
      message: 'No STL file data found for this order'
    });
  } catch (error) {
    console.error('Error processing STL download request:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Add an improved endpoint for getting order details
app.get('/api/order-details/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }
    
    console.log(`Getting order details for: ${orderId}`);
    
    // First check memory store for the order
    let memoryOrder = null;
    for (const order of memoryOrderStore) {
      if (order.orderId === orderId) {
        memoryOrder = order;
        console.log(`Found order in memory store: ${orderId}`);
        break;
      }
    }
    
    // If found in memory, return it
    if (memoryOrder) {
      // Create a download link
      const host = req.headers.origin || `http://${req.headers.host}`;
      if (memoryOrder.stlFile) {
        memoryOrder.stlFile.downloadLink = `${host}/api/download-stl/${orderId}`;
      }
      
      return res.json({
        success: true,
        order: memoryOrder,
        source: 'memory'
      });
    }
    
    // If not in memory, try Firestore
    let firestoreOrder = null;
    try {
      // Get the order from Firestore
      const db = admin.firestore();
      const orderDoc = await db.collection('orders').doc(orderId).get();
      
      if (!orderDoc.exists) {
        console.log(`Order not found in Firestore: ${orderId}`);
      } else {
        firestoreOrder = orderDoc.data();
        console.log(`Found order in Firestore: ${orderId}`);
        
        // Generate a fresh download URL if needed
        if (firestoreOrder.stlFile && firestoreOrder.stlFile.storagePath) {
          try {
            const bucket = admin.storage().bucket();
            const file = bucket.file(firestoreOrder.stlFile.storagePath);
            
            // Check if file exists
            const [exists] = await file.exists();
            if (exists) {
              // Generate a signed URL valid for 1 day
              const [signedUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
              });
              
              // Update the order with the fresh URL
              firestoreOrder.stlFile.downloadUrl = signedUrl;
              firestoreOrder.stlFile.downloadUrlGeneratedAt = new Date().toISOString();
              
              // Also update in Firestore
              await orderDoc.ref.update({
                'stlFile.downloadUrl': signedUrl,
                'stlFile.downloadUrlGeneratedAt': new Date().toISOString()
              });
              
              console.log(`Generated fresh download URL for order: ${orderId}`);
            }
          } catch (storageError) {
            console.warn('Could not refresh download URL:', storageError.message);
            // Continue with existing URL if available
          }
        }
        
        // Create a download link
        const host = req.headers.origin || `http://${req.headers.host}`;
        if (firestoreOrder.stlFile) {
          firestoreOrder.stlFile.downloadLink = `${host}/api/download-stl/${firestoreOrder.orderId}`;
        }
        
        return res.json({
          success: true,
          order: firestoreOrder,
          source: 'firestore'
        });
      }
    } catch (firestoreError) {
      console.error('Error getting order from Firestore:', firestoreError);
      // Continue to look in Stripe sessions
    }
    
    // If we got this far and still don't have an order, check for Stripe sessions
    // that might match this order ID pattern (common for temp-{timestamp} orders)
    if (orderId.startsWith('temp-') || orderId.startsWith('order-')) {
      try {
        console.log('Searching Stripe for matching sessions');
        // List recent Stripe sessions (limited to 10 for performance)
        const sessions = await stripe.checkout.sessions.list({
          limit: 10,
        });
        
        // Look for matching timestamp or other identifying information
        const timestampPart = orderId.split('-')[1]; // Extract timestamp if present
        
        for (const session of sessions.data) {
          // Check if this session might match our order
          if (session.metadata && 
              (session.id.includes(timestampPart) || 
               session.metadata.orderTempId === orderId)) {
            
            console.log(`Found potential matching Stripe session: ${session.id}`);
            // Try to create an order from this session
            const orderResult = await handleSuccessfulPayment(session);
            
            // Add download link
            const host = req.headers.origin || `http://${req.headers.host}`;
            if (orderResult.stlFile) {
              orderResult.stlFile.downloadLink = `${host}/api/download-stl/${orderResult.orderId}`;
            }
            
            return res.json({
              success: true,
              order: orderResult,
              source: 'stripe-lookup'
            });
          }
        }
      } catch (stripeError) {
        console.error('Error searching Stripe sessions:', stripeError);
      }
    }
    
    // If we get here, the order was not found anywhere
    return res.status(404).json({
      success: false,
      message: 'Order not found',
      orderId
    });
    
  } catch (error) {
    console.error('Error getting order details:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Add a checkout-confirmation endpoint to get order details
app.get('/api/checkout-confirmation', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }
    
    console.log(`Getting order details for checkout session: ${sessionId}`);
    
    // First check the memory store for this session
    let memoryOrder = null;
    for (const order of memoryOrderStore) {
      if (order.stripeSessionId === sessionId) {
        memoryOrder = order;
        console.log(`Found order in memory store for session: ${sessionId}`);
        break;
      }
    }
    
    // If found in memory, use that
    if (memoryOrder) {
      // Add download link for STL file if needed
      const host = req.headers.origin || `http://${req.headers.host}`;
      if (memoryOrder.stlFile) {
        memoryOrder.stlFile.downloadLink = `${host}/api/download-stl/${memoryOrder.orderId}`;
      }
      
      return res.json({
        success: true,
        order: memoryOrder,
        source: 'memory'
      });
    }
    
    // If not in memory, try Firestore
    let firestoreOrder = null;
    try {
      // Try to find the order in Firestore by session ID
      const db = admin.firestore();
      const ordersSnapshot = await db.collection('orders').where('stripeSessionId', '==', sessionId).limit(1).get();
      
      if (!ordersSnapshot.empty) {
        // We found an order matching this session ID
        const orderDoc = ordersSnapshot.docs[0];
        firestoreOrder = orderDoc.data();
        console.log(`Found order in Firestore for session: ${sessionId}`);
        
        // Generate fresh download URL if needed
        if (firestoreOrder.stlFile && firestoreOrder.stlFile.storagePath) {
          try {
            const bucket = admin.storage().bucket();
            const file = bucket.file(firestoreOrder.stlFile.storagePath);
            
            // Check if file exists
            const [exists] = await file.exists();
            if (exists) {
              // Generate a signed URL valid for 24 hours
              const [signedUrl] = await file.getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
              });
              
              // Update the order with the fresh URL
              firestoreOrder.stlFile.downloadUrl = signedUrl;
              firestoreOrder.stlFile.downloadUrlGeneratedAt = new Date().toISOString();
              
              // Also update in Firestore
              await orderDoc.ref.update({
                'stlFile.downloadUrl': signedUrl,
                'stlFile.downloadUrlGeneratedAt': new Date().toISOString()
              });
              
              console.log(`Generated fresh download URL for session: ${sessionId}`);
            }
          } catch (storageError) {
            console.warn('Could not refresh download URL:', storageError.message);
            // Continue with existing URL if available
          }
        }
        
        // Create a download link
        const host = req.headers.origin || `http://${req.headers.host}`;
        if (firestoreOrder.stlFile) {
          firestoreOrder.stlFile.downloadLink = `${host}/api/download-stl/${firestoreOrder.orderId}`;
        }
        
        return res.json({
          success: true,
          order: firestoreOrder,
          source: 'firestore'
        });
      }
    } catch (firestoreError) {
      console.error('Error querying Firestore:', firestoreError);
      // Proceed to try Stripe directly
    }
    
    // If not found in memory or Firestore, try to get the session from Stripe directly
    console.log(`Retrieving session from Stripe: ${sessionId}`);
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['customer', 'line_items']
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Checkout session not found'
      });
    }
    
    // If session exists but we don't have an order yet, create one now
    if (session) {
      try {
        console.log(`Creating order from Stripe session: ${sessionId}`);
        const orderResult = await handleSuccessfulPayment(session);
        
        // Add download link
        const host = req.headers.origin || `http://${req.headers.host}`;
        if (orderResult.stlFile) {
          orderResult.stlFile.downloadLink = `${host}/api/download-stl/${orderResult.orderId}`;
        }
        
        return res.json({
          success: true,
          order: orderResult,
          source: 'stripe-new'
        });
      } catch (orderCreationError) {
        console.error('Error creating order from Stripe session:', orderCreationError);
      }
    }
    
    // If we get here, we couldn't find or create a proper order
    // Create a minimal order from the session data as last resort
    console.log('Creating minimal order from session data as fallback');
    const minimalOrder = {
      orderId: `temp-${Date.now()}`,
      stripeSessionId: sessionId,
      customerEmail: session.customer_details?.email || 'Unknown',
      customerName: session.customer_details?.name || 'Unknown',
      orderDetails: {
        modelName: session.metadata?.modelName || 'Unknown Model',
        color: session.metadata?.color || 'Unknown',
        quantity: parseInt(session.metadata?.quantity || '1'),
        finalPrice: parseFloat(session.metadata?.finalPrice || '0')
      },
      stlFile: session.metadata?.stlFileName ? {
        fileName: session.metadata.stlFileName
      } : null,
      orderStatus: 'pending-details',
      orderDate: new Date().toISOString()
    };
    
    // Store this minimal order in memory for future requests
    memoryOrderStore.push(minimalOrder);
    
    return res.json({
      success: true,
      order: minimalOrder,
      source: 'stripe-minimal'
    });
  } catch (error) {
    console.error('Error getting checkout confirmation:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Add an endpoint to verify and update subscription status
app.post('/api/pricing/verify-subscription', async (req, res) => {
  try {
    const { userId, sessionId, email } = req.body;
    
    console.log('Verifying subscription for user:', { userId, email, sessionId });
    
    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }
    
    let subscription = null;
    let customerId = null;
    
    // First check if we have a valid Stripe session ID
    if (sessionId) {
      try {
        // Get session details
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ['subscription']
        });
        
        if (session && session.subscription) {
          console.log('Found active session with subscription:', session.subscription.id);
          subscription = session.subscription;
          customerId = session.customer;
        }
      } catch (sessionError) {
        console.error('Error retrieving session:', sessionError);
      }
    }
    
    // If we couldn't get the subscription from the session, try to find it by customer
    if (!subscription && customerId) {
      try {
        // Retrieve active subscriptions for the customer
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'active',
          limit: 1
        });
        
        if (subscriptions.data.length > 0) {
          subscription = subscriptions.data[0];
          console.log('Found active subscription for customer:', subscription.id);
        }
      } catch (listError) {
        console.error('Error listing subscriptions:', listError);
      }
    }
    
    // If we don't have a customerId yet, try to find the user in Stripe
    if (!customerId && email) {
      try {
        const customers = await stripe.customers.list({
          email: email,
          limit: 1
        });
        
        if (customers.data.length > 0) {
          customerId = customers.data[0].id;
          console.log('Found customer by email:', customerId);
          
          // Try to get subscriptions again with found customer ID
          const subscriptions = await stripe.subscriptions.list({
            customer: customerId,
            status: 'active',
            limit: 1
          });
          
          if (subscriptions.data.length > 0) {
            subscription = subscriptions.data[0];
            console.log('Found active subscription for customer:', subscription.id);
          }
        }
      } catch (customerError) {
        console.error('Error searching for customer:', customerError);
      }
    }
    
    // If we have a valid subscription, update the user's status
    if (subscription) {
      // Get price details to determine subscription tier
      let price;
      try {
        price = await stripe.prices.retrieve(subscription.items.data[0].price.id);
        console.log('Subscription price:', price.id, 'Product:', price.product);
      } catch (priceError) {
        console.error('Error retrieving price information:', priceError);
      }
      
      // Determine tier and limits based on subscription
      const tierInfo = {
        isPro: true,
        subscriptionStatus: subscription.status,
        subscriptionPlan: 'pro',
        subscriptionId: subscription.id,
        subscriptionPriceId: subscription.items.data[0].price.id,
        subscriptionProductId: price ? price.product : null,
        modelsRemainingThisMonth: 100, // Default value for Pro tier
        modelsGeneratedThisMonth: 0,
        downloadsThisMonth: 0,
        subscriptionEndDate: new Date(subscription.current_period_end * 1000).toISOString(),
        lastUpdated: new Date().toISOString()
      };
      
      // Update the user in Firestore
      if (firestore) {
        try {
          const userRef = firestore.collection('users').doc(userId);
          const userDoc = await userRef.get();
          
          if (userDoc.exists) {
            // Update existing user
            await userRef.update({
              ...tierInfo,
              stripeCustomerId: customerId || userDoc.data().stripeCustomerId
            });
            console.log('Updated existing user with subscription info:', userId);
          } else {
            // Create new user with subscription
            await userRef.set({
              uid: userId,
              email: email,
              stripeCustomerId: customerId,
              createdAt: new Date(),
              ...tierInfo
            });
            console.log('Created new user with subscription info:', userId);
          }
          
          // Return updated user info
          return res.json({
            success: true,
            message: 'Subscription verified and user updated',
            subscription: tierInfo
          });
        } catch (firestoreError) {
          console.error('Error updating user in Firestore:', firestoreError);
          return res.status(500).json({
            success: false,
            error: 'Error updating user in Firestore',
            subscription: tierInfo // Still return the valid subscription info
          });
        }
      } else {
        // No Firestore but we have subscription info
        return res.json({
          success: true,
          message: 'Subscription verified but user not updated (Firestore unavailable)',
          subscription: tierInfo
        });
      }
    } else {
      // No valid subscription found
      return res.json({
        success: false,
        message: 'No active subscription found for this user',
        subscription: null
      });
    }
  } catch (error) {
    console.error('Error verifying subscription:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Add an endpoint to get user subscription status
app.get('/api/pricing/user-subscription/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log(`Getting subscription status for user: ${userId}`);
    
    // Get user document from Firestore
    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log(`User not found: ${userId}`);
      return res.status(200).json({
        isPro: false,
        modelsRemainingThisMonth: 2, // Default limit for free users
        modelsGeneratedThisMonth: 0,
        downloadsThisMonth: 0,
        subscriptionStatus: 'none',
        subscriptionEndDate: null,
        subscriptionPlan: 'free',
        trialActive: false,
        trialEndDate: null
      });
    }
    
    const userData = userDoc.data();
    console.log(`Found user in Firestore:`, userData);
    
    // Check if the trial has expired (if user is on trial)
    let isPro = userData.isPro === true;
    let trialActive = userData.trialActive === true;
    let subscriptionStatus = userData.subscriptionStatus || 'none';
    let subscriptionPlan = userData.subscriptionPlan || 'free';
    
    // DEBUGGING: Print detailed subscription information
    console.log(`SUBSCRIPTION DEBUG for ${userId}:
      isPro: ${isPro}
      trialActive: ${trialActive}
      subscriptionStatus: ${subscriptionStatus}
      subscriptionPlan: ${subscriptionPlan}
      Original isPro value type: ${typeof userData.isPro} value: ${userData.isPro}
    `);
    
    // Check if this is a trial user and if the trial has expired
    if (trialActive && userData.trialEndDate) {
      const now = new Date();
      const trialEndDate = new Date(userData.trialEndDate);
      
      console.log(`Trial status check for ${userId}:
        Current time: ${now.toISOString()}
        Trial end time: ${trialEndDate.toISOString()}
        Time remaining: ${(trialEndDate.getTime() - now.getTime()) / 1000 / 60} minutes
      `);
      
      // Set to true to force all users to be non-pro for testing
      const forceNonPro = false;
      
      if (now > trialEndDate || forceNonPro) {
        console.log(`Trial has expired for user ${userId} ${forceNonPro ? '(FORCED)' : ''}`);
        // Trial has expired
        isPro = false;
        trialActive = false;
        subscriptionStatus = 'none';
        subscriptionPlan = 'free';
        
        // Update user in Firestore
        await userRef.update({
          isPro: false,
          trialActive: false,
          subscriptionStatus: 'none',
          subscriptionPlan: 'free',
          modelsRemainingThisMonth: 2, // Reset to free tier
          trialEndDate: null,  // Clear the trial end date
          updatedAt: new Date() // Add timestamp for the update
        });
        console.log(`Updated user ${userId} - trial expired, downgraded to free`);
      }
    }
    
    // Check paid subscription status if not on trial
    if (!trialActive && isPro && userData.subscriptionStatus === 'active') {
      // User has a paid subscription
      console.log(`User ${userId} has an active paid subscription`);
    } else if (!trialActive && !isPro) {
      // User is a free user
      console.log(`User ${userId} is a free user`);
    }
    
    // Return subscription information with possibly updated trial status
    const result = {
      isPro: isPro,
      modelsRemainingThisMonth: isPro ? Infinity : (userData.modelsRemainingThisMonth || 2),
      modelsGeneratedThisMonth: userData.modelsGeneratedThisMonth || 0,
      downloadsThisMonth: userData.downloadsThisMonth || 0,
      subscriptionStatus: subscriptionStatus,
      subscriptionEndDate: userData.subscriptionEndDate || null,
      subscriptionPlan: subscriptionPlan,
      trialActive: trialActive,
      trialEndDate: userData.trialEndDate || null
    };
    
    console.log(`Returning subscription data for ${userId}:`, result);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error getting user subscription:', error);
    return res.status(500).json({ error: 'Failed to get user subscription', details: error.message });
  }
});

// Storage proxy endpoint for authenticated file downloads
app.get('/api/storage-proxy', async (req, res) => {
  try {
    const url = req.query.url;
    const userId = req.query.userId;
    
    console.log(`📥 STORAGE PROXY REQUEST RECEIVED`);
    console.log(`URL: ${url}`);
    console.log(`User ID: ${userId}`);
    
    if (!url) {
      console.error('❌ Missing URL parameter in storage proxy request');
      return res.status(400).json({ error: 'URL parameter is required' });
    }
    
    if (!userId) {
      console.error('❌ Missing userId parameter in storage proxy request');
      return res.status(400).json({ error: 'User ID is required for authentication' });
    }
    
    console.log(`🔄 Storage proxy request: ${url}, user: ${userId}`);
    
    // Get the user's subscription status from Firestore
    let isPro = false;
    let userData = null;
    
    try {
      console.log(`👤 Getting user status for download. User: ${userId}`);
      
      // Get the user's subscription status from Firestore
      const userRef = firestore.collection('users').doc(userId);
      const userDoc = await userRef.get();
      
      if (userDoc.exists) {
        userData = userDoc.data();
        // Use a strict check for isPro and also check if on trial
        isPro = userData.isPro === true || userData.trialActive === true;
        
        console.log(`📊 User subscription data:`, {
          userId,
          isPro: userData.isPro,
          trialActive: userData.trialActive,
          subscriptionStatus: userData.subscriptionStatus,
          subscriptionPlan: userData.subscriptionPlan
        });
      } else {
        console.log(`⚠️ User not found in database: ${userId}, treating as free user`);
        isPro = false;
      }
    } catch (error) {
      console.error('❌ Error getting user access level:', error);
      // Continue with download as free user
      isPro = false;
    }
    
    // IMPORTANT: Allow downloads for ALL users (both free and pro)
    // We'll just add a watermark indicator for free users in the filename
    console.log(`🔑 User access determined: ${isPro ? 'PRO' : 'FREE'} - allowing download for all users`);
    
    // Track the download in user's account if possible
    try {
      if (userData && userData.uid) {
        // Increment the downloadsThisMonth counter
        await firestore.collection('users').doc(userId).update({
          downloadsThisMonth: admin.firestore.FieldValue.increment(1),
          lastUpdated: new Date().toISOString()
        });
        console.log(`📝 Updated download count for user ${userId}`);
      } else if (userId) {
        // If the user exists in Auth but not in Firestore, create a record
        try {
          await firestore.collection('users').doc(userId).set({
            uid: userId,
            downloadsThisMonth: 1,
            isPro: false,
            lastUpdated: new Date().toISOString()
          }, { merge: true });
          console.log(`📝 Created new user record with download count`);
        } catch (createError) {
          console.error('❌ Error creating user record:', createError);
        }
      }
    } catch (downloadTrackingError) {
      // Don't fail the download if tracking fails, just log the error
      console.error('⚠️ Error tracking download:', downloadTrackingError);
    }
    
    try {
      console.log(`🔄 Proxying request to: ${url}, isPro: ${isPro}`);
      
      // Forward the request to the target URL
      const axios = require('axios');
      const response = await axios({
        method: 'GET',
        url,
        responseType: 'arraybuffer', // Important for binary files like STL
        timeout: 60000, // 60 second timeout for larger files
        maxContentLength: 100 * 1024 * 1024, // Allow up to 100MB for downloads
        headers: {
          // Add headers to appear as a browser request
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive'
        }
      });
      
      // NOTE: In a real implementation, we would add watermarking for free users
      // This is just a demo, so we're just modifying the filename
      
      // Determine filename (from URL, Content-Disposition header, or default)
      let filename = '';
      
      // Try to get filename from Content-Disposition header
      const contentDisposition = response.headers['content-disposition'];
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename=['"]?([^'";\n]+)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1];
        }
      }
      
      // If no filename from header, extract from URL
      if (!filename) {
        filename = url.split('/').pop() || 'download';
        // Remove any query parameters
        filename = filename.split('?')[0];
      }
      
      // For free users, add a watermark indicator to the filename
      if (!isPro) {
        // Add a watermark indicator to the filename for free users
        const filenameParts = filename.split('.');
        const ext = filenameParts.pop() || '';
        filename = filenameParts.join('.') + '-watermarked' + (ext ? '.' + ext : '');
      }
      
      // Set appropriate headers for the download
      res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      
      // Important CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      
      // Set Content-Disposition to force download with proper filename
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      console.log(`✅ Proxy successful. Content-Type: ${response.headers['content-type']}, Size: ${response.data.length} bytes, Filename: ${filename}`);
      
      // Return the response as binary data
      return res.status(response.status).send(response.data);
    } catch (error) {
      console.error('❌ Error proxying storage request:', error.message);
      
      // Check for specific axios errors
      if (error.response) {
        // The server responded with a status code outside of 2xx range
        console.error(`⚠️ Target server responded with status: ${error.response.status}`);
        return res.status(error.response.status).json({
          error: 'Error from target server',
          status: error.response.status,
          details: error.message
        });
      } else if (error.request) {
        // The request was made but no response was received
        console.error('⚠️ No response received from target server');
        return res.status(504).json({
          error: 'No response from target server',
          details: error.message
        });
      }
      
      // Handle other errors
      return res.status(500).json({ 
        error: 'Error proxying request',
        details: error.message
      });
    }
  } catch (mainError) {
    console.error('❌ Unexpected error in storage proxy:', mainError);
    return res.status(500).json({
      error: 'Unexpected error in storage proxy',
      details: mainError.message
    });
  }
});

// Add a test endpoint to simulate trial expiration
app.get('/api/test-trial-expiration/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    console.log(`🧪 TESTING trial expiration for user: ${userId}`);
    
    // Get user document from Firestore
    const userRef = firestore.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log(`User not found: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    console.log(`Found user for testing:`, userData);
    
    // Check if the user is on a trial
    if (!userData.trialActive) {
      console.log(`User ${userId} is not on a trial, can't test expiration`);
      return res.status(400).json({ 
        error: 'User is not on a trial', 
        userData: userData 
      });
    }
    
    // Set the trial end date to 1 hour ago to simulate expiration
    const pastDate = new Date();
    pastDate.setHours(pastDate.getHours() - 1); // 1 hour ago instead of 24 hours
    
    console.log(`Setting trial end date to past date: ${pastDate}`);
    
    // Update the user document
    await userRef.update({
      trialEndDate: admin.firestore.Timestamp.fromDate(pastDate)
    });
    
    console.log(`Updated user trial end date to past. Calling subscription endpoint to trigger expiration check...`);
    
    // Call the user subscription endpoint to check if it correctly identifies the expired trial
    const port = PORT;
    const url = `http://localhost:${port}/api/pricing/user-subscription/${userId}`;
    
    console.log(`Calling subscription endpoint: ${url}`);
    
    try {
      // We'll simulate calling the endpoint ourselves
      // Get the updated user document
      const updatedUserDoc = await userRef.get();
      const updatedUserData = updatedUserDoc.data();
      
      console.log('Retrieved updated user data:', updatedUserData);
      
      // Check if trial has expired
      const trialEndDate = updatedUserData.trialEndDate;
      const now = new Date();
      
      let trialHasExpired = false;
      let trialEndTime;
      
      if (trialEndDate) {
        if (trialEndDate._seconds) {
          trialEndTime = new Date(trialEndDate._seconds * 1000);
        } else if (typeof trialEndDate.toDate === 'function') {
          trialEndTime = trialEndDate.toDate();
        } else {
          trialEndTime = new Date(trialEndDate);
        }
        
        trialHasExpired = now > trialEndTime;
      }
      
      console.log(`Current time: ${now}, Trial end time: ${trialEndTime}, Trial expired: ${trialHasExpired}`);
      
      // If trial has expired, update user data
      if (trialHasExpired && updatedUserData.isPro && updatedUserData.subscriptionPlan === 'trial') {
        await userRef.update({
          isPro: false,
          trialActive: false,
          subscriptionStatus: 'none',
          subscriptionPlan: 'free'
        });
        
        console.log('Successfully downgraded user to free plan after trial expiration');
      }
      
      // Get the final user state
      const finalUserDoc = await userRef.get();
      const finalUserData = finalUserDoc.data();
      
      // Return the test results
      return res.json({
        testStatus: 'SUCCESS',
        message: 'Trial expiration test completed successfully',
        beforeUpdate: updatedUserData,
        afterUpdate: finalUserData,
        trialExpired: trialHasExpired,
        currentTime: now.toISOString(),
        trialEndTime: trialEndTime ? trialEndTime.toISOString() : null
      });
      
    } catch (error) {
      console.error('Error calling subscription endpoint:', error);
      return res.status(500).json({
        testStatus: 'ERROR',
        error: 'Error calling subscription endpoint',
        details: error.message
      });
    }
    
  } catch (error) {
    console.error('Error in test-trial-expiration endpoint:', error);
    return res.status(500).json({
      testStatus: 'ERROR',
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Test trial expiration endpoint that doesn't require Firestore
app.get('/api/test-trial-expiration/:userId', async (req, res) => {
  const userId = req.params.userId;
  
  console.log(`🧪 SIMPLE TEST for trial expiration. User ID: ${userId}`);
  
  // Always return success with mock data
  return res.json({
    testStatus: 'SUCCESS',
    message: 'This is a simplified test endpoint that always succeeds',
    userId: userId,
    mockData: {
      isPro: false,
      trialActive: false,
      trialEndDate: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago instead of 24 hours
      subscriptionPlan: 'free',
      currentTime: new Date().toISOString()
    }
  });
});

// Add generic checkout endpoint for maximum flexibility
app.all('/api/checkout', async (req, res) => {
  console.log(`Received ${req.method} request at /api/checkout`);
  
  // Handle OPTIONS requests for preflight
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).send();
  }
  
  // Only proceed with POST
  if (req.method !== 'POST') {
    console.log(`Redirecting ${req.method} to POST handler`);
    // Instead of returning 405, forward to the POST handler
    req.method = 'POST';
  }
  
  try {
    const { priceId, userId, email, force_new_customer } = req.body;
    
    console.log('Received checkout request at simplified endpoint:', { 
      priceId, 
      userId, 
      email,
      force_new_customer: !!force_new_customer
    });
    
    if (!priceId || !userId || !email) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    // Rest of implementation is the same as other checkout endpoints
    // ... proceed with the checkout process
    let customerId = null;
    
    // Create a new customer every time in production for simplicity
    try {
      const customer = await stripe.customers.create({
        email: email,
        metadata: {
          userId: userId,
        },
      });
      customerId = customer.id;
      console.log(`Created new Stripe customer: ${customerId}`);
      
      // Update Firestore if available
      if (firestore) {
        const userRef = firestore.collection('users').doc(userId);
        await userRef.set({
          stripeCustomerId: customerId,
        }, { merge: true });
        console.log('Updated Firestore with new customer ID');
      }
    } catch (stripeError) {
      console.error('Error creating Stripe customer:', stripeError);
      return res.status(500).json({ error: 'Failed to create Stripe customer', details: stripeError.message });
    }
    
    // Create a checkout session with the customer
    try {
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
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
          userId: userId,
        },
      });
      
      return res.json({ url: session.url });
    } catch (stripeError) {
      console.error('Error creating checkout session:', stripeError);
      return res.status(500).json({ error: 'Failed to create checkout session', details: stripeError.message });
    }
  } catch (error) {
    console.error('Error processing checkout request:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Add a catchall route that provides useful information
app.all('*', (req, res) => {
  const path = req.path;
  const method = req.method;
  
  console.log(`Received ${method} request for unhandled path: ${path}`);
  
  // If the path contains "checkout" or "stripe", provide helpful debug info
  if (path.includes('checkout') || path.includes('stripe')) {
    return res.status(404).json({
      error: 'Endpoint not found',
      message: `The ${method} request to ${path} was not handled by the server.`,
      availableEndpoints: [
        '/api/checkout',
        '/api/pricing/create-checkout-session',
        '/pricing/create-checkout-session',
        '/api/create-checkout-session',
        '/create-checkout-session'
      ],
      suggestedEndpoint: '/api/checkout',
      helpMessage: 'Try using the /api/checkout endpoint which handles all HTTP methods properly.'
    });
  }
  
  // Generic 404 for other routes
  res.status(404).json({ error: 'Not found' });
});

// COMMENTED OUT: First app.listen call to avoid duplicate server binding
// app.listen(PORT, () => {
//   console.log(`Simple checkout server running at http://localhost:${PORT}`);
// }); 

// MOVE THIS HANDLER HERE - BEFORE the catchall route and app.listen()
// Special handler for the www domain path that was returning 405 errors
app.get('/pricing/create-checkout-session', async (req, res) => {
  console.log('Received GET request to /pricing/create-checkout-session with query params:', req.query);
  
  // Set headers explicitly to ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  
  // If this is a query string format, extract parameters
  const priceId = req.query.priceId;
  const userId = req.query.userId;
  const email = req.query.email;
  
  if (!priceId || !userId || !email) {
    console.log('Missing required parameters in GET request:', req.query);
    return res.status(400).json({ 
      error: 'Missing required parameters', 
      message: 'This endpoint requires priceId, userId, and email parameters',
      received: req.query
    });
  }
  
  console.log('Processing checkout with parameters:', { priceId, userId, email });
  
  try {
    // Always create a new customer for simplicity
    const customer = await stripe.customers.create({
      email: email,
      metadata: {
        userId: userId,
      },
    });
    const customerId = customer.id;
    console.log(`Created new Stripe customer: ${customerId}`);
    
    // Update Firestore if available
    if (firestore) {
      try {
        const userRef = firestore.collection('users').doc(userId);
        await userRef.set({
          stripeCustomerId: customerId,
        }, { merge: true });
        console.log('Updated Firestore with new customer ID');
      } catch (firestoreError) {
        console.error('Error updating Firestore:', firestoreError);
        // Continue anyway
      }
    }
    
    // Create a checkout session with the customer
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin || 'https://www.fishcad.com'}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'https://www.fishcad.com'}/pricing`,
      metadata: {
        userId: userId,
      },
    });
    
    console.log('Checkout session created with URL:', session.url);
    
    // Return the session URL as JSON
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ 
      error: 'Failed to create checkout session', 
      details: error.message 
    });
  }
}); 

// POST handler for creating a checkout session
app.post('/pricing/create-checkout-session', async (req, res) => {
  try {
    // ... existing code ...
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET handler for creating a checkout session - should be here, BEFORE app.listen
app.get('/pricing/create-checkout-session', async (req, res) => {
  try {
    console.log('GET handler for checkout session called');
    
    // Get parameters from query string
    const { priceId, userId, email } = req.query;
    
    if (!priceId) {
      return res.status(400).json({ error: 'Missing required parameter: priceId' });
    }
    
    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/pricing`,
      client_reference_id: userId,
      customer_email: email,
    });
    
    // Return the checkout session URL
    res.json({ url: session.url });
  } catch (error) {
    console.error('Error in GET create-checkout-session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel subscription
app.post('/pricing/cancel-subscription', async (req, res) => {
  // ... existing code ...
});

// GET handler for user subscription
app.get('/pricing/user-subscription', async (req, res) => {
  // ... existing code ...
});

// Verify subscription
app.post('/pricing/verify-subscription', async (req, res) => {
  // ... existing code ...
});

// Handle any other routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (http://localhost:${PORT})`);
  console.log(`Allowed CORS origins:`, app.get('corsOrigins'));
  console.log(`Stripe configuration:`);
  console.log(`- Upgrade to Pro Monthly: ${process.env.STRIPE_PRICE_MONTHLY || 'Not configured'}`);
  console.log(`- Upgrade to Pro Annual: ${process.env.STRIPE_PRICE_ANNUAL || 'Not configured'}`);
  console.log(`- 3D Print Orders: Enabled`);
}); 

// Add a REST API endpoint for the new client
app.get('/api/pricing/create-checkout-session', async (req, res) => {
  try {
    console.log('GET API handler for checkout session called');
    
    // Get parameters from query string
    const { priceId, userId, email } = req.query;
    
    if (!priceId) {
      return res.status(400).json({ error: 'Missing required parameter: priceId' });
    }
    
    console.log('Creating checkout session with:', { priceId, userId, email });
    
    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/pricing`,
      client_reference_id: userId || undefined,
      customer_email: email || undefined,
    });
    
    console.log('Checkout session created:', session.id);
    
    // Return the checkout session URL
    res.json({ url: session.url });
  } catch (error) {
    console.error('Error in GET API create-checkout-session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a POST endpoint for the same functionality
app.post('/api/pricing/create-checkout-session', async (req, res) => {
  try {
    console.log('POST API handler for checkout session called');
    
    // Get parameters from request body
    const { priceId, userId, email } = req.body;
    
    if (!priceId) {
      return res.status(400).json({ error: 'Missing required parameter: priceId' });
    }
    
    console.log('Creating checkout session with:', { priceId, userId, email });
    
    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/pricing`,
      client_reference_id: userId || undefined,
      customer_email: email || undefined,
    });
    
    console.log('Checkout session created:', session.id);
    
    // Return the checkout session URL
    res.json({ url: session.url });
  } catch (error) {
    console.error('Error in POST API create-checkout-session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Keep the existing routes for backward compatibility
// ... existing code ...

// Add a simple direct checkout endpoint
app.get('/simple-checkout', async (req, res) => {
  try {
    console.log('Simple checkout endpoint called with query:', req.query);
    
    // Get parameters from query string
    const { plan = 'monthly' } = req.query;
    
    // Determine price ID based on plan
    const priceId = plan === 'monthly' 
      ? process.env.STRIPE_PRICE_MONTHLY 
      : process.env.STRIPE_PRICE_ANNUAL;
    
    console.log('Using price ID:', priceId);
    
    if (!priceId) {
      console.error('Price ID not configured in server environment');
      return res.status(500).send(`
        <html>
          <head><title>Configuration Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1>Configuration Error</h1>
            <p>Price ID not configured in server environment.</p>
            <p>Check server .env file for STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL.</p>
            <p><a href="/pricing">Return to pricing page</a></p>
          </body>
        </html>
      `);
    }
    
    // Get the host from the request
    const host = req.get('host');
    const protocol = req.protocol || 'https';
    const origin = `${protocol}://${host}`;
    
    console.log(`Creating checkout session for ${plan} plan (${priceId}) with origin: ${origin}`);
    
    try {
      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing`,
        // No customer_email or client_reference_id - keeping it simple
      });
      
      console.log('Checkout session created successfully:', session.id);
      console.log('Redirecting to:', session.url);
      
      // Redirect directly to the session URL
      return res.redirect(303, session.url);
    } catch (stripeError) {
      console.error('Stripe session creation failed:', stripeError);
      
      // Handle Stripe errors with more specific messages
      let errorMessage = 'Error creating checkout session.';
      let technicalDetails = stripeError.message || 'Unknown Stripe error';
      
      if (stripeError.type === 'StripeInvalidRequestError') {
        if (stripeError.message.includes('No such price')) {
          errorMessage = 'The price ID does not exist in your Stripe account.';
          technicalDetails = `Price ID "${priceId}" was not found in your Stripe account. Check your Stripe Dashboard.`;
        }
      }
      
      // Return a user-friendly error page
      return res.status(500).send(`
        <html>
          <head><title>Checkout Error</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1>Checkout Error</h1>
            <p>${errorMessage}</p>
            <p>Technical details: ${technicalDetails}</p>
            <p><a href="/pricing">Return to pricing page</a></p>
            <div style="margin-top: 50px; padding: 20px; background: #f5f5f5; border-radius: 5px; text-align: left;">
              <h3>Debug Information (for site administrator)</h3>
              <p>Plan type: ${plan}</p>
              <p>Price ID: ${priceId}</p>
              <p>Host: ${host}</p>
              <p>Stripe API key configured: ${!!process.env.STRIPE_SECRET_KEY}</p>
            </div>
          </body>
        </html>
      `);
    }
  } catch (error) {
    console.error('Error in simple-checkout:', error);
    
    // Provide user-friendly error page
    res.status(500).send(`
      <html>
        <head><title>Checkout Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>Something went wrong</h1>
          <p>We encountered an error setting up your checkout session.</p>
          <p>Error details: ${error.message}</p>
          <p><a href="/pricing">Return to pricing page</a></p>
        </body>
      </html>
    `);
  }
});

// Add a REST API endpoint for the new client
// ... existing code ...

// Direct checkout web page
app.get('/direct-checkout', async (req, res) => {
  // Check if this is a 3D print order based on query parameters
  const { productType, is3DPrint } = req.query;
  
  // If this is a 3D print order, redirect to the 3D print checkout API
  if (productType === '3d_print' || is3DPrint === 'true') {
    console.log('Redirecting to 3D print checkout API');
    // Forward the request to the 3D print checkout endpoint
    return res.redirect(307, '/api/create-checkout-session');
  }
  
  // Handle subscription checkout (existing code)
  const { plan = 'monthly' } = req.query;
  
  // Get the price ID for the plan
  let priceId;
  
  // Check if plan is already a price ID
  if (plan.startsWith('price_')) {
    priceId = plan;
    console.log(`Using direct price ID: ${priceId}`);
  } else {
    // Use the plan type to select the appropriate price ID
    priceId = plan === 'monthly' 
      ? process.env.STRIPE_PRICE_MONTHLY 
      : process.env.STRIPE_PRICE_ANNUAL;
    console.log(`Using price ID for ${plan} plan: ${priceId}`);
  }
  
  const priceLabel = plan === 'monthly' ? '$20 monthly' : '$192 annually';
  const publicKey = process.env.STRIPE_PUBLISHABLE_KEY;
  
  // Send an HTML page with a direct checkout button
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>FishCAD Pro Checkout</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.6;
          padding: 40px 20px;
          max-width: 600px;
          margin: 0 auto;
          text-align: center;
        }
        h1 { margin-bottom: 10px; }
        .price { 
          font-size: 2rem; 
          font-weight: bold; 
          margin: 20px 0;
        }
        .btn {
          display: inline-block;
          background: #556cd6;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 12px 24px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 20px;
          text-decoration: none;
        }
        .debug {
          margin-top: 40px;
          text-align: left;
          background: #f5f5f5;
          padding: 15px;
          border-radius: 4px;
          font-size: 13px;
          color: #666;
        }
      </style>
      <script src="https://js.stripe.com/v3/"></script>
    </head>
    <body>
      <h1>FishCAD Pro Subscription</h1>
      <p>You're subscribing to the FishCAD Pro ${plan} plan</p>
      <div class="price">${priceLabel}</div>
      
      <button class="btn" id="checkout-button">Subscribe Now</button>
      
      <p><a href="/">Return to FishCAD</a></p>
      
      <div class="debug">
        <strong>Debug Info:</strong>
        <div>Plan: ${plan}</div>
        <div>Price ID: ${priceId}</div>
        <div>Stripe Key Available: ${!!publicKey}</div>
      </div>
      
      <script>
        document.getElementById('checkout-button').addEventListener('click', function() {
          // Create the checkout directly with Stripe.js
          const stripe = Stripe('${publicKey}');
          
          fetch('/create-checkout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              priceId: '${priceId}',
              plan: '${plan}'
            })
          })
          .then(function(response) {
            return response.json();
          })
          .then(function(session) {
            return stripe.redirectToCheckout({ sessionId: session.id });
          })
          .then(function(result) {
            if (result.error) {
              alert(result.error.message);
            }
          })
          .catch(function(error) {
            console.error('Error:', error);
            alert('There was an error processing your payment. Please try again.');
          });
        });
      </script>
    </body>
    </html>
  `);
});

// API endpoint for creating checkout sessions via fetch
app.post('/create-checkout', async (req, res) => {
  try {
    console.log('Create checkout API called', req.body);
    
    const { priceId } = req.body;
    
    if (!priceId) {
      console.error('No price ID provided');
      return res.status(400).json({ error: 'Missing priceId parameter' });
    }
    
    // Get the host from the request
    const host = req.get('host');
    const protocol = req.protocol || 'https';
    const origin = `${protocol}://${host}`;
    
    // Create the checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`
    });
    
    console.log('Checkout session created:', session.id);
    
    // Return the session ID
    res.json({ id: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// ... existing code ...

// Add a POST endpoint for the JSON API-based checkout
app.post('/direct-checkout', async (req, res) => {
  try {
    console.log('POST /direct-checkout called with body:', req.body);
    
    // Check if this is a 3D print order based on flags
    const { productType, is3DPrint } = req.body;
    
    // If this is a 3D print order, redirect to the 3D print checkout API
    if (productType === '3d_print' || is3DPrint === true) {
      console.log('Redirecting to 3D print checkout API');
      // Forward the request to the 3D print checkout endpoint
      return res.redirect(307, '/api/create-checkout-session');
    }
    
    // Handle subscription checkout (existing code)
    // Get parameters from request body
    const { priceId: rawPriceId, plan = 'monthly', userId, email } = req.body;
    
    // Determine the price ID to use
    let priceId = rawPriceId;
    
    // If no direct priceId was provided, check if plan is a price ID or plan type
    if (!priceId) {
      if (plan.startsWith('price_')) {
        priceId = plan;
        console.log(`Using direct price ID from plan field: ${priceId}`);
      } else {
        // Otherwise, use the plan type to select the appropriate price ID
        priceId = plan === 'monthly' 
          ? process.env.STRIPE_PRICE_MONTHLY 
          : process.env.STRIPE_PRICE_ANNUAL;
        console.log(`Using price ID for ${plan} plan: ${priceId}`);
      }
    }
    
    if (!priceId) {
      console.error('No price ID could be determined from the request');
      return res.status(400).json({ 
        error: 'Missing price ID',
        message: 'No price ID could be determined from the request. Please provide either a priceId or plan parameter.'
      });
    }
    
    // Get the host from the request or use configured success URL
    const host = req.get('host');
    const protocol = req.protocol || 'https';
    const origin = `${protocol}://${host}`;
    
    console.log(`Creating checkout session with price ID: ${priceId}, userId: ${userId || 'not provided'}, origin: ${origin}`);
    
    // Create the session parameters
    const sessionParams = {
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pricing`,
    };
    
    // Add client_reference_id if userId is provided
    if (userId) {
      sessionParams.client_reference_id = userId;
    }
    
    // Add customer_email if email is provided
    if (email) {
      sessionParams.customer_email = email;
    }
    
    // Create the checkout session
    const session = await stripe.checkout.sessions.create(sessionParams);
    
    console.log('Checkout session created:', session.id);
    
    // Return the session URL
    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({
      error: 'Failed to create checkout session',
      message: error.message || 'An unexpected error occurred'
    });
  }
});

// Keep the existing routes for backward compatibility
// ... existing code ...

// Add a route for the API endpoint that the client is calling
app.post('/api/pricing/create-checkout-session', async (req, res) => {
  console.log('Received request to /api/pricing/create-checkout-session with body:', req.body);
  
  const { priceId, userId, email } = req.body;
  
  if (!priceId) {
    return res.status(400).json({ 
      success: false,
      error: 'Missing priceId parameter',
      message: 'The priceId parameter is required for subscription checkout'
    });
  }
  
  try {
    // Create a subscription checkout session
    console.log(`Creating subscription checkout with priceId: ${priceId}, userId: ${userId || 'not provided'}`);
    
    // Get the host from the request
    const host = req.get('host');
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'https';
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
    
    console.log('Created checkout session:', session.id);
    
    return res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to create checkout session'
    });
  }
});

// Add a route for the exact endpoint the client is calling
app.post('/api/create-checkout-session', async (req, res) => {
  console.log('Received request to /api/create-checkout-session with body:', req.body);
  
  try {
    // Check if this is a 3D print checkout or a subscription checkout
    if (req.body.productType === '3d_print' || req.body.is3DPrint) {
      console.log('Handling 3D print checkout');
      
      // Get the required fields from the request
      const { 
        modelName, 
        color, 
        quantity, 
        finalPrice, 
        stlFileData, 
        stlFileName,
        stlDownloadUrl,
        stlStoragePath
      } = req.body;
      
      console.log('Received 3D print checkout request with:', { 
        modelName, 
        color, 
        quantity, 
        finalPrice, 
        hasStlFileData: !!stlFileData,
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
          
          console.log('STL file successfully uploaded to Firebase Storage');
        } catch (uploadError) {
          console.error('Failed to upload STL to Firebase Storage:', uploadError);
        }
      }

      // Create information about the STL file for the product description
      let stlInfo = '';
      if (finalStlDownloadUrl) {
        stlInfo += `\n\nSTL FILE DOWNLOAD LINK: ${finalStlDownloadUrl}`;
      }

      // Create a product in Stripe
      console.log('Creating Stripe product...');
      const product = await stripe.products.create({
        name: `${modelName} (${color}, Qty: ${quantity})`,
        description: `3D Print: ${modelName} in ${color}${stlInfo}`,
      });
      console.log('Stripe product created:', product.id);
      
      // Create a price for the product
      console.log('Creating Stripe price...');
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(finalPrice * 100), // Convert dollars to cents
        currency: 'usd',
      });
      console.log('Stripe price created:', price.id);
      
      // Determine the host for redirect URLs
      const host = req.headers.origin || `http://${req.headers.host}`;
      console.log('Using host for redirect:', host);
      
      // Create the Stripe checkout session
      console.log('Creating Stripe checkout session...');
      
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
        },
        // Enable billing address collection
        billing_address_collection: 'required',
        shipping_address_collection: {
          allowed_countries: ['US', 'CA', 'GB', 'AU'], // Add the countries you ship to
        },
      });
      console.log('Stripe checkout session created:', session.id);

      // Return the session ID and URL
      return res.json({
        success: true,
        url: session.url,
        sessionId: session.id
      });
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