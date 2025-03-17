// Simple checkout server focused on 3D printing checkout
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const admin = require('firebase-admin');

// Load environment variables first
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

console.log(`[${new Date().toISOString()}] Starting Stripe checkout server...`);
console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV}`);
console.log(`[${new Date().toISOString()}] Using Stripe key: ${process.env.STRIPE_SECRET_KEY ? (process.env.STRIPE_SECRET_KEY.startsWith('sk_test') ? 'TEST MODE' : 'LIVE MODE') : 'MISSING'}`);

// Initialize Firebase Admin SDK if not already initialized
let firebaseInitialized = false;
if (!admin.apps.length) {
  try {
    // Get the Firebase configuration from environment variables
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
      : undefined;
    
    // Debug Firebase initialization params
    console.log(`[${new Date().toISOString()}] Firebase initialization parameters:`, {
      projectId: process.env.FIREBASE_PROJECT_ID ? 'Present' : 'Missing',
      privateKey: privateKey ? 'Present' : 'Missing',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? 'Present' : 'Missing',
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'Using default: taiyaki-test1.appspot.com'
    });
    
    if (!process.env.FIREBASE_PROJECT_ID || !privateKey || !process.env.FIREBASE_CLIENT_EMAIL) {
      console.log(`[${new Date().toISOString()}] Warning: Missing required Firebase configuration. STL upload will not work.`);
    } else {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'taiyaki-test1.appspot.com'
      });
      
      firebaseInitialized = true;
      console.log(`[${new Date().toISOString()}] Firebase Admin SDK initialized successfully`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error initializing Firebase:`, error);
  }
}

// Initialize Stripe with the loaded secret key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Initialize the server
const app = express();
const PORT = process.env.API_PORT || 4002;

// Use middleware
app.use(cors({
  origin: '*', // Allow all origins for testing
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
  credentials: true
}));

// Important: For Stripe webhooks, we need the raw body for signature verification
// Use the raw body parser only for the webhook endpoint
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// Configure body-parser with increased limit for STL file uploads
app.use(bodyParser.json({ 
  limit: '50mb', // Increase limit for large STL files
  verify: (req, res, buf) => {
    // Store raw body for Stripe webhook verification
    if (req.originalUrl === '/api/webhook') {
      req.rawBody = buf;
    }
  }
}));

app.use(bodyParser.urlencoded({ 
  extended: true,
  limit: '50mb' // Increase limit for large STL files
}));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  const stripeMode = process.env.STRIPE_SECRET_KEY ? 
    (process.env.STRIPE_SECRET_KEY.startsWith('sk_test') ? 'TEST MODE' : 'LIVE MODE') : 
    'MISSING KEY';
  
  res.json({ 
    status: 'ok', 
    message: 'Checkout server is running',
    stripeMode,
    environment: process.env.NODE_ENV
  });
});

// Simple debug endpoint to test connectivity
app.post('/api/debug-checkout', (req, res) => {
  console.log('Debug checkout endpoint hit with body:', req.body);
  res.json({ 
    success: true, 
    message: 'Debug checkout endpoint working',
    environment: process.env.NODE_ENV,
    stripeMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'TEST MODE' : 'LIVE MODE',
    body: req.body
  });
});

// Webhook handling for Stripe events
app.post('/api/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  if (!sig) {
    console.error(`[${new Date().toISOString()}] Missing stripe-signature header`);
    return res.status(400).json({ success: false, message: 'Missing signature header' });
  }
  
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error(`[${new Date().toISOString()}] Missing STRIPE_WEBHOOK_SECRET environment variable`);
    return res.status(500).json({ success: false, message: 'Webhook secret not configured' });
  }
  
  try {
    // For verification, we need the raw request body as a string or buffer
    // Express.raw middleware ensures req.body is a Buffer
    console.log(`[${new Date().toISOString()}] Received webhook with signature: ${sig.substring(0, 20)}...`);
    console.log(`[${new Date().toISOString()}] Raw body size: ${req.body.length} bytes`);
    
    // Verify the event came from Stripe
    const event = stripe.webhooks.constructEvent(
      req.body,  // This is the raw request body (Buffer)
      sig,
      webhookSecret
    );
    
    console.log(`[${new Date().toISOString()}] ✅ Webhook signature verified for event: ${event.type}, id: ${event.id}`);
    
    // Handle the event based on its type
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log(`[${new Date().toISOString()}] Payment successful for session: ${session.id}`);
        
        // Log existing session metadata
        console.log(`[${new Date().toISOString()}] Processing order metadata:`, session.metadata || 'No metadata found');
        
        // Check if this is a 3D print order from the metadata or line items
        const is3DPrintOrder = session.metadata?.orderType === '3d_print' || 
                               session.metadata?.type === '3d_print' || 
                               session.metadata?.is3DPrint === 'true';
                               
        console.log(`[${new Date().toISOString()}] Order type: ${is3DPrintOrder ? '3D Print Order' : 'Other Order Type'}`);
        
        // If this was a 3D print order with an STL file, update the metadata in Stripe
        // to ensure the download link is included in receipts and confirmation emails
        if (is3DPrintOrder || session.metadata?.productType === '3d_print') {
          console.log(`[${new Date().toISOString()}] Handling 3D print order, retrieving STL information...`);
          
          try {
            // Get the product ID from the line items
            const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
            console.log(`[${new Date().toISOString()}] Retrieved ${lineItems?.data?.length || 0} line items from session`);
            
            if (lineItems && lineItems.data && lineItems.data.length > 0) {
              const lineItem = lineItems.data[0];
              const productId = lineItem.price.product;
              
              console.log(`[${new Date().toISOString()}] Found product ID: ${productId}`);
              
              // Retrieve the product to get the STL download URL from description or metadata
              const product = await stripe.products.retrieve(productId);
              console.log(`[${new Date().toISOString()}] Retrieved product: ${product.name}`);
              
              // Try to extract STL download URL from product description or metadata
              let stlDownloadUrl = null;
              
              // Check metadata first
              if (product.metadata && product.metadata.stlDownloadUrl) {
                stlDownloadUrl = product.metadata.stlDownloadUrl;
                console.log(`[${new Date().toISOString()}] Found STL download URL in product metadata`);
              }
              // If not in metadata, try to extract from description (if it's in the format we expect)
              else if (product.description && product.description.includes('Download your STL file:')) {
                const matches = product.description.match(/Download your STL file: (https:\/\/[^\s]+)/);
                if (matches && matches.length > 1) {
                  stlDownloadUrl = matches[1];
                  console.log(`[${new Date().toISOString()}] Extracted STL download URL from product description`);
                }
              }
              
              if (stlDownloadUrl) {
                console.log(`[${new Date().toISOString()}] STL download URL found: ${stlDownloadUrl.substring(0, 50)}...`);
                
                // Create detailed metadata for the confirmation email
                const updatedMetadata = {
                  ...session.metadata,
                  orderType: '3d_print',
                  stlDownloadUrl: stlDownloadUrl,
                  productName: product.name,
                  stlFileName: session.metadata?.stlFileName || 'model.stl',
                  downloadInstructions: "📥 Click the link below to download your 3D model STL file:",
                  downloadLinkTitle: "DOWNLOAD YOUR STL FILE HERE",
                  downloadLink: stlDownloadUrl,
                  noteToCustomer: "Your STL file download link is valid for 10 years. Please save it for future reference."
                };
                
                // Update the session metadata to include the download link
                // This ensures it's available in confirmation emails
                await stripe.checkout.sessions.update(session.id, {
                  metadata: updatedMetadata
                });
                
                console.log(`[${new Date().toISOString()}] Updated checkout session with enhanced STL download information`);
              } else {
                console.log(`[${new Date().toISOString()}] No STL download URL found in product metadata or description`);
              }
            } else {
              console.log(`[${new Date().toISOString()}] No line items found for this session`);
            }
          } catch (error) {
            console.error(`[${new Date().toISOString()}] Error updating session with STL download information:`, error);
          }
        }
        
        break;
      }
      // Add more cases for other events you want to handle
      default:
        console.log(`[${new Date().toISOString()}] Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error(`⚠️ Webhook Error:`, err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

/**
 * Stores STL data in Firebase Storage
 * @param {string|Buffer} stlData - The STL data to store, either as a base64 string or Buffer
 * @param {string} fileName - The name of the STL file
 * @returns {Promise<{downloadUrl: string, publicUrl: string, storagePath: string, fileName: string, fileSize: number}>}
 */
async function storeSTLInFirebase(stlData, fileName) {
  console.log(`[${new Date().toISOString()}] Preparing to store STL file in Firebase Storage...`);
  
  // Check if Firebase is initialized
  if (!firebaseInitialized) {
    console.error(`[${new Date().toISOString()}] Firebase not initialized, cannot upload STL`);
    throw new Error('Firebase Storage not initialized');
  }
  
  // Debug the type of stlData
  console.log(`[${new Date().toISOString()}] STL data type: ${typeof stlData}`);
  if (typeof stlData === 'string') {
    console.log(`[${new Date().toISOString()}] STL data string preview: ${stlData.substring(0, 100)}...`);
    console.log(`[${new Date().toISOString()}] STL data length: ${stlData.length} characters`);
  } else if (Buffer.isBuffer(stlData)) {
    console.log(`[${new Date().toISOString()}] STL data is a Buffer of size: ${stlData.length} bytes`);
  } else {
    console.log(`[${new Date().toISOString()}] STL data is of unexpected type: ${typeof stlData}`);
  }
  
  let tempFilePath;
  
  try {
    // Create a safe filename (replace spaces and special chars)
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    // Process the STL data
    let stlBuffer;
    console.log(`[${new Date().toISOString()}] Processing ${typeof stlData === 'string' ? 'base64' : 'buffer'} STL data...`);
    
    if (typeof stlData === 'string') {
      // If stlData is a base64 string, convert it to buffer
      let base64Data;
      
      // Check if the data is a data URL (starts with data:)
      if (stlData.startsWith('data:')) {
        console.log(`[${new Date().toISOString()}] Detected data URL format, extracting base64 content`);
        // Extract the base64 part if it's a data URL
        const parts = stlData.split(',');
        if (parts.length >= 2) {
          base64Data = parts[1];
          console.log(`[${new Date().toISOString()}] Successfully extracted base64 data of length: ${base64Data.length} characters`);
        } else {
          console.error(`[${new Date().toISOString()}] Invalid data URL format`);
          base64Data = stlData; // Use as is if splitting failed
        }
      } else {
        console.log(`[${new Date().toISOString()}] Using direct base64 data`);
        // Assume it's already base64
        base64Data = stlData.replace(/^base64,/, '');
      }
      
      try {
        stlBuffer = Buffer.from(base64Data, 'base64');
        console.log(`[${new Date().toISOString()}] Converted base64 data to buffer of size: ${stlBuffer.length} bytes`);
      } catch (bufferError) {
        console.error(`[${new Date().toISOString()}] Failed to convert base64 to buffer:`, bufferError);
        throw new Error(`Failed to process STL data: ${bufferError.message}`);
      }
    } else if (Buffer.isBuffer(stlData)) {
      stlBuffer = stlData;
      console.log(`[${new Date().toISOString()}] Using provided buffer data of size: ${stlBuffer.length} bytes`);
    } else {
      console.error(`[${new Date().toISOString()}] Unsupported STL data format: ${typeof stlData}`);
      throw new Error(`Unsupported STL data format: ${typeof stlData}`);
    }
    
    const fileSize = stlBuffer.length;
    console.log(`[${new Date().toISOString()}] STL file size: ${fileSize} bytes`);
    
    // Write to a temporary file
    const timestamp = Date.now();
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const tempDir = path.join(os.tmpdir(), 'stl-uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    tempFilePath = path.join(tempDir, `${timestamp}-${uniqueId}-${safeFileName}`);
    
    console.log(`[${new Date().toISOString()}] Writing STL data to temporary file: ${tempFilePath}`);
    fs.writeFileSync(tempFilePath, stlBuffer);
    console.log(`[${new Date().toISOString()}] Temporary STL file created successfully`);
    
    // Create a path in Firebase Storage organized by date (YYYY/MM/DD)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const storagePath = `stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${safeFileName}`;
    console.log(`[${new Date().toISOString()}] Firebase Storage path: ${storagePath}`);
    
    // Get the bucket from Firebase storage
    const bucket = admin.storage().bucket();
    if (!bucket) {
      throw new Error('Firebase Storage bucket not available');
    }
    
    console.log(`[${new Date().toISOString()}] Uploading to Firebase Storage bucket: ${bucket.name}`);
    
    // Set metadata including content type
    const metadata = {
      contentType: 'model/stl',  // Updated to correct MIME type for STL files
      cacheControl: 'public, max-age=31536000', // Cache for 1 year
      metadata: {
        originalFileName: fileName
      }
    };
    
    // Upload file with metadata
    await bucket.upload(tempFilePath, {
      destination: storagePath,
      metadata: metadata
    });
    
    console.log(`[${new Date().toISOString()}] STL file uploaded successfully to Firebase Storage`);
    
    // Get URLs - don't try to set ACLs since uniform bucket-level access is enabled
    const [signedUrl] = await bucket.file(storagePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 315360000000, // 10 years in milliseconds
    });
    
    // Also get a permanent public URL (though this depends on bucket permissions)
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    
    console.log(`[${new Date().toISOString()}] Generated public URL: ${publicUrl.substring(0, 100)}...`);
    console.log(`[${new Date().toISOString()}] Generated signed URL (expires in 10 years): ${signedUrl.substring(0, 100)}...`);
    
    // Clean up the temporary file
    try {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`[${new Date().toISOString()}] Temporary file deleted`);
      }
    } catch (cleanupError) {
      console.error(`[${new Date().toISOString()}] Error deleting temporary file:`, cleanupError);
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
        console.log(`[${new Date().toISOString()}] Temporary file deleted`);
      } catch (cleanupError) {
        console.error(`[${new Date().toISOString()}] Error deleting temporary file:`, cleanupError);
      }
    }
    
    console.error(`[${new Date().toISOString()}] STL storage error:`, error);
    throw new Error(`Firebase upload failed: ${error.message}`);
  }
}

// Main checkout endpoint
app.post(['/api/checkout', '/api/create-checkout-session', '/api/print/create-checkout-session'], async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] Received checkout request:`, {
      type: req.body.type || 'unknown',
      is3DPrint: req.body.is3DPrint,
      modelName: req.body.modelName,
      color: req.body.color,
      quantity: req.body.quantity,
      price: req.body.price || req.body.finalPrice,
      hasStlFileData: !!req.body.stlFileData,
      stlFileName: req.body.stlFileName,
      // Log the size of stlFileData if it exists but don't log the actual data which could be large
      stlFileDataSize: req.body.stlFileData ? (typeof req.body.stlFileData === 'string' ? req.body.stlFileData.length : 'unknown') : 'none'
    });

    if (!req.body.modelName || !req.body.color || !req.body.quantity || !req.body.price && !req.body.finalPrice) {
      console.error(`[${new Date().toISOString()}] Missing required checkout parameters`);
      return res.status(400).json({
        success: false,
        message: 'Missing required checkout information'
      });
    }

    // Extract checkout information
    const modelName = req.body.modelName;
    const color = req.body.color;
    const quantity = req.body.quantity;
    const finalPrice = req.body.price || req.body.finalPrice;
    const stlFileData = req.body.stlFileData;
    const stlFileName = req.body.stlFileName || 'model.stl';
    
    // Variables to store Firebase upload results
    let stlDownloadUrl = '';
    let stlPublicUrl = '';
    let stlStoragePath = '';
    let stlFileSize = 0;
    let stlFileUploaded = false;
    
    // Upload STL file to Firebase if provided
    if (stlFileData && firebaseInitialized) {
      try {
        console.log(`[${new Date().toISOString()}] Uploading STL file to Firebase Storage...`);
        console.log(`[${new Date().toISOString()}] STL data type: ${typeof stlFileData}`);
        console.log(`[${new Date().toISOString()}] STL file name: ${stlFileName}`);
        
        // Try the upload
        const uploadResult = await storeSTLInFirebase(stlFileData, stlFileName);
        
        stlDownloadUrl = uploadResult.downloadUrl;
        stlPublicUrl = uploadResult.publicUrl;
        stlStoragePath = uploadResult.storagePath;
        stlFileSize = uploadResult.fileSize;
        stlFileUploaded = true;
        
        console.log(`[${new Date().toISOString()}] STL file uploaded successfully`);
        console.log(`[${new Date().toISOString()}] Download URL: ${stlDownloadUrl.substring(0, 100)}...`);
        console.log(`[${new Date().toISOString()}] Storage path: ${stlStoragePath}`);
        console.log(`[${new Date().toISOString()}] File size: ${stlFileSize} bytes`);
      } catch (uploadError) {
        console.error(`[${new Date().toISOString()}] Failed to upload STL file:`, uploadError);
        // Continue with checkout even if upload fails
      }
    } else if (!stlFileData) {
      console.log(`[${new Date().toISOString()}] No STL file data provided for upload`);
    } else if (!firebaseInitialized) {
      console.log(`[${new Date().toISOString()}] Firebase not initialized, skipping STL upload`);
    }
    
    console.log(`[${new Date().toISOString()}] Creating Stripe product for 3D print order: ${modelName} in ${color} (Qty: ${quantity})`);
    
    // Create product description with STL link if available
    let productDescription = `3D Print Order - Model: ${modelName} | Material: ${color} | Quantity: ${quantity}`;
    if (stlDownloadUrl) {
      // Add the STL download link in a clearer format
      productDescription += `\n\n📥 Download your STL file: ${stlDownloadUrl}`;
      console.log(`[${new Date().toISOString()}] Added STL download link to product description`);
    }
    
    // Prepare product metadata with STL information
    const productMetadata = {
      type: '3d_print',
      modelName,
      color,
      quantity: quantity.toString(),
      is3DPrint: 'true',
      clientTimestamp: new Date().toISOString()
    };
    
    // Add STL information to metadata if available
    if (stlFileUploaded) {
      productMetadata.stlDownloadUrl = stlDownloadUrl;
      productMetadata.stlPublicUrl = stlPublicUrl;
      productMetadata.stlStoragePath = stlStoragePath;
      productMetadata.stlFileName = stlFileName;
      productMetadata.stlFileSize = stlFileSize.toString();
      productMetadata.hasStlFile = 'true';
    }
    
    // Create the product in Stripe with enhanced metadata
    const product = await stripe.products.create({
      name: `3D Print: ${modelName} - ${color} material (Quantity: ${quantity})`,
      description: productDescription,
      metadata: productMetadata
    });
    
    console.log(`[${new Date().toISOString()}] Stripe product created: ID=${product.id}, Name=${product.name}`);
    
    // Create a price for the product
    console.log(`[${new Date().toISOString()}] Creating Stripe price with amount: ${Math.round(finalPrice * 100)} cents`);
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(finalPrice * 100),
      currency: 'usd',
    });
    
    console.log(`[${new Date().toISOString()}] Stripe price created: ID=${price.id}, Amount=${finalPrice} USD`);
    
    // Determine the host for redirect URLs
    const host = req.headers.origin || `http://${req.headers.host}`;
    console.log(`[${new Date().toISOString()}] Using host for redirect: ${host}`);
    
    // Create customer-facing metadata for the session
    const sessionMetadata = {
      type: '3d_print',
      orderType: '3d_print',
      productType: '3d_print',
      modelName,
      color,
      quantity: quantity.toString(),
      is3DPrint: 'true'
    };
    
    // Add STL information to session metadata if available
    if (stlFileUploaded) {
      sessionMetadata.stlFileName = stlFileName;
      sessionMetadata.hasStlFile = 'true';
    }
    
    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${host}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${host}/checkout/cancel`,
      metadata: sessionMetadata
    });
    
    console.log(`[${new Date().toISOString()}] Stripe checkout session created: ID=${session.id}`);
    
    res.json({ 
      id: session.id,
      url: session.url,
      success: true
    });
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Checkout error:`, error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Home route for testing
app.get('/', (req, res) => {
  res.send('Simple checkout server is running');
});

// Start the server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Simple checkout server running at http://localhost:${PORT}`);
  console.log(`[${new Date().toISOString()}] Using Stripe key: ${process.env.STRIPE_SECRET_KEY ? 'Valid key present' : 'MISSING KEY'}`);
  console.log(`[${new Date().toISOString()}] Webhook secret: ${process.env.STRIPE_WEBHOOK_SECRET ? 'Valid secret present' : 'MISSING SECRET'}`);
}); 