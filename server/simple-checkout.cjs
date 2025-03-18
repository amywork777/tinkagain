// Simple checkout server focused on 3D printing checkout
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Load environment variables first
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

console.log(`[${new Date().toISOString()}] Starting Stripe checkout server...`);
console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV}`);
console.log(`[${new Date().toISOString()}] Using Stripe key: ${process.env.STRIPE_SECRET_KEY ? (process.env.STRIPE_SECRET_KEY.startsWith('sk_test') ? 'TEST MODE' : 'LIVE MODE') : 'MISSING'}`);

// Import Supabase storage utilities instead of Firebase
const { storeSTLInSupabase } = require('./supabase-storage.cjs');

// Replace Firebase admin initialization with Supabase config check
let storageType = 'none';

// Check if we have Supabase credentials
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  console.log('Supabase configuration found. Using Supabase for STL storage.');
  storageType = 'Supabase';
} else {
  console.log('No Supabase credentials found. Using fallback storage.');
  storageType = 'Fallback';
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

// Replace the health check endpoint to show Supabase status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    stripe: !!process.env.STRIPE_SECRET_KEY ? 'configured' : 'missing',
    storage: storageType
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
    storage: storageType,
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

// Update the storeSTLFile function for better handling of large files
async function storeSTLFile(stlData, fileName) {
  console.log('[' + new Date().toISOString() + '] Starting STL file storage process');
  
  try {
    // Validate input
    if (!stlData) {
      throw new Error('No STL data provided');
    }
    
    // Generate a file name if not provided
    if (!fileName) {
      fileName = `model-${Date.now()}.stl`;
    }
    
    // Make sure the filename has an .stl extension
    if (!fileName.toLowerCase().endsWith('.stl')) {
      fileName += '.stl';
    }
    
    // Sanitize the filename
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '-');
    if (safeFileName !== fileName) {
      console.log('[' + new Date().toISOString() + '] Sanitized filename from "' + fileName + '" to "' + safeFileName + '"');
      fileName = safeFileName;
    }
    
    // Log the data type and length
    console.log('[' + new Date().toISOString() + '] STL data type:', typeof stlData);
    console.log('[' + new Date().toISOString() + '] STL data length:', stlData.length);
    
    // Process the STL data - try to decode base64
    let stlBuffer;
    try {
      // Check if the data is base64 encoded
      if (stlData.match(/^[A-Za-z0-9+/=]+$/)) {
        console.log('[' + new Date().toISOString() + '] STL data appears to be base64 encoded, decoding...');
        stlBuffer = Buffer.from(stlData, 'base64');
      } else {
        console.log('[' + new Date().toISOString() + '] STL data does not appear to be base64 encoded, treating as raw data');
        stlBuffer = Buffer.from(stlData);
      }
      
      console.log('[' + new Date().toISOString() + '] Decoded STL buffer size:', stlBuffer.length);
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error decoding STL data:', error);
      throw new Error('Failed to decode STL data: ' + error.message);
    }
    
    // Create a unique identifier for this file
    const timestamp = Date.now();
    const uniqueId = require('crypto').randomUUID();
    
    // Create a timestamp-based directory structure for Supabase
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    
    // Define the storage path in Supabase
    const storagePath = `models/${year}/${month}/${day}/${timestamp}-${uniqueId}-${fileName}`;
    console.log('[' + new Date().toISOString() + '] Supabase storage path:', storagePath);
    
    // Upload the STL data to Supabase storage
    console.log('[' + new Date().toISOString() + '] Uploading STL file to Supabase storage...');
    
    // Try direct upload first
    try {
      const { error } = await supabase.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET)
        .upload(storagePath, stlBuffer, {
          contentType: 'application/vnd.ms-pki.stl',
          upsert: true,
          cacheControl: '31536000' // 1 year cache
        });
      
      if (error) {
        throw error;
      }
      
      console.log('[' + new Date().toISOString() + '] STL file uploaded successfully to Supabase storage');
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error uploading STL to Supabase storage:', error.message);
      
      // Try writing to a temp file and uploading as a fallback
      try {
        console.log('[' + new Date().toISOString() + '] Falling back to file-based upload...');
        
        // Create a temporary file
        const os = require('os');
        const path = require('path');
        const tempDir = path.join(os.tmpdir(), 'stl-uploads');
        
        // Ensure the directory exists
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const tempFilePath = path.join(tempDir, `${timestamp}-${uniqueId}-${fileName}`);
        
        // Write the buffer to a file
        fs.writeFileSync(tempFilePath, stlBuffer);
        
        // Create a read stream from the file
        const fileStream = fs.createReadStream(tempFilePath);
        
        // Upload the file stream
        const { error } = await supabase.storage
          .from(process.env.SUPABASE_STORAGE_BUCKET)
          .upload(storagePath, fileStream, {
            contentType: 'application/vnd.ms-pki.stl',
            upsert: true,
            cacheControl: '31536000', // 1 year cache
            duplex: 'half' // Help with streaming issues
          });
          
        if (error) {
          throw error;
        }
        
        console.log('[' + new Date().toISOString() + '] STL file uploaded successfully via file stream');
        
        // Clean up the temporary file
        try {
          fs.unlinkSync(tempFilePath);
        } catch (cleanupError) {
          console.warn('[' + new Date().toISOString() + '] Failed to delete temporary file:', cleanupError.message);
        }
      } catch (fallbackError) {
        console.error('[' + new Date().toISOString() + '] Fallback upload also failed:', fallbackError.message);
        throw new Error('Failed to upload STL file to storage: ' + error.message);
      }
    }
    
    // Create a signed URL valid for 10 years
    const expirySeconds = 60 * 60 * 24 * 365 * 10; // 10 years
    
    let signedUrl;
    try {
      const { data, error } = await supabase.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET)
        .createSignedUrl(storagePath, expirySeconds);
      
      if (error) {
        throw error;
      }
      
      signedUrl = data.signedUrl;
      console.log('[' + new Date().toISOString() + '] Generated signed URL (first 100 chars):', signedUrl.substring(0, 100) + '...');
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error creating signed URL:', error.message);
      
      // Try to get the public URL as a fallback
      try {
        const { data } = supabase.storage
          .from(process.env.SUPABASE_STORAGE_BUCKET)
          .getPublicUrl(storagePath);
        
        signedUrl = data.publicUrl;
        console.log('[' + new Date().toISOString() + '] Fallback to public URL (first 100 chars):', signedUrl.substring(0, 100) + '...');
      } catch (fallbackError) {
        console.error('[' + new Date().toISOString() + '] Failed to get public URL:', fallbackError.message);
        throw new Error('Failed to generate download URL: ' + error.message);
      }
    }
    
    console.log('[' + new Date().toISOString() + '] STL file stored successfully');
    
    return {
      fileName,
      url: signedUrl,
      path: storagePath,
      size: stlBuffer.length
    };
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Error in storeSTLFile:', error.message);
    throw error;
  }
}

// Create email transporter for notifications
let transporter = null;
try {
  if (process.env.EMAIL_USER && (process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD)) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD // Check both variables
      },
    });
    console.log(`[${new Date().toISOString()}] Email notifications configured for ${process.env.EMAIL_USER}`);
  } else {
    console.log(`[${new Date().toISOString()}] Email notification credentials not found in environment`);
  }
} catch (emailError) {
  console.error(`[${new Date().toISOString()}] Error setting up email transport:`, emailError);
}

// Main checkout endpoint
app.post('/api/checkout', async (req, res) => {
  console.log(`${new Date().toISOString()} - POST /api/checkout`);
  console.log('[' + new Date().toISOString() + '] Checkout request received');
  
  let stlFile = null;
  let modelData = null;
  let checkoutSession = null;
  
  try {
    // Extract request data
    const { 
      stlBase64, 
      stlFileName, 
      modelName = 'Untitled Model', 
      dimensions = 'Unknown',
      material = 'PLA', 
      infillPercentage = 20,
      price = 1999,  // Default to $19.99
      email = ''
    } = req.body;
    
    // Log receipt of data
    console.log('[' + new Date().toISOString() + '] Processing checkout for:', {
      modelName,
      fileName: stlFileName,
      dimensions,
      material,
      infill: `${infillPercentage}%`,
      price: `$${(price/100).toFixed(2)}`,
      email: email || 'not provided',
      dataSize: stlBase64 ? `${Math.round(stlBase64.length / 1024)}KB` : 'not provided'
    });
    
    // Validate required fields
    if (!stlBase64 || !stlFileName) {
      console.error('[' + new Date().toISOString() + '] Missing required fields: stlBase64 or stlFileName');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: STL file data and filename are required' 
      });
    }
    
    // Store STL file FIRST, before creating checkout session, to ensure we have the download link
    console.log('[' + new Date().toISOString() + '] Uploading STL file to Supabase...');
    
    try {
      stlFile = await storeSTLFile(stlBase64, stlFileName);
      console.log('[' + new Date().toISOString() + '] STL file stored successfully:', stlFile.path);
      console.log('[' + new Date().toISOString() + '] Download URL generated (first 100 chars):', stlFile.url.substring(0, 100) + '...');
      
      // Save model data for use in creating the checkout session
      modelData = {
        name: modelName,
        fileName: stlFileName,
        dimensions,
        material,
        infill: `${infillPercentage}%`,
        price,
        email: email || '',
        stlUrl: stlFile.url
      };
      
      // Record model in database even before checkout
      try {
        // Prepare model info object
        const modelInfo = {
          modelName,
          fileName: stlFileName,
          dimensions,
          material,
          infillPercentage,
          price,
          email: email || 'not provided',
          status: 'pending_payment',
          stlUrl: stlFile.url,
          stlPath: stlFile.path,
          createdAt: new Date().toISOString()
        };
        
        // Save to models collection
        const modelRef = db.collection('models').doc();
        await modelRef.set(modelInfo);
        console.log('[' + new Date().toISOString() + '] Saved model info with ID:', modelRef.id);
        
        // Add the model ID to the data
        modelData.modelId = modelRef.id;
      } catch (dbError) {
        console.error('[' + new Date().toISOString() + '] Error saving model to database:', dbError.message);
        // Continue even if database storage fails, this is not critical for checkout
      }
    } catch (storageError) {
      console.error('[' + new Date().toISOString() + '] Error storing STL file:', storageError.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to store STL file: ' + storageError.message 
      });
    }
    
    // Create formatted item description
    const modelDescription = formatModelDescription(modelName, dimensions, material, infillPercentage);
    
    // Create Stripe checkout session
    console.log('[' + new Date().toISOString() + '] Creating Stripe checkout session...');
    
    try {
      // Create metadata object with the STL file URL
      const metadata = {
        modelName: modelName.substring(0, 40),
        stlFileName: stlFileName.substring(0, 40),
        stlUrl: stlFile.url.substring(0, 500),  // Limit to 500 chars
        dimensions: dimensions.substring(0, 40),
        material: material.substring(0, 20),
        infill: `${infillPercentage}%`,
        customerEmail: email || 'not provided',
        modelId: modelData.modelId || 'unknown'
      };
      
      // Keep the total metadata under Stripe's limit (max 50KB)
      const metadataSize = JSON.stringify(metadata).length;
      if (metadataSize > 40000) { // Leave some buffer space
        // Trim the URL if necessary to fit within limits
        const excessBytes = metadataSize - 40000 + 100; // 100 bytes buffer
        const newUrlLength = Math.max(100, metadata.stlUrl.length - excessBytes);
        metadata.stlUrl = metadata.stlUrl.substring(0, newUrlLength) + '...';
        console.log('[' + new Date().toISOString() + '] Trimmed URL to fit within Stripe metadata limits');
      }
      
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `3D Print: ${modelName}`,
              description: modelDescription,
            },
            unit_amount: price, // in cents
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout/cancel`,
        metadata: metadata
      });
      
      checkoutSession = session;
      console.log('[' + new Date().toISOString() + '] Stripe checkout session created successfully. Session ID:', session.id);
      
      // Immediately send email with download link if email is provided
      if (email) {
        console.log('[' + new Date().toISOString() + '] Sending immediate download link email to:', email);
        
        try {
          await sendDownloadLinkEmail(
            email,
            modelName,
            stlFile.url,
            stlFileName,
            dimensions,
            material,
            `${infillPercentage}%`,
            'pending_payment'
          );
          console.log('[' + new Date().toISOString() + '] Immediate download link email sent successfully');
        } catch (emailError) {
          console.error('[' + new Date().toISOString() + '] Error sending immediate download link email:', emailError.message);
          // Continue even if email fails, this is not critical for checkout
        }
      }
      
      // Send the response with both session ID, URL, and STL file information
      res.status(200).json({
        success: true,
        id: session.id,
        url: session.url,
        stlInfo: {
          url: stlFile.url,
          fileName: stlFile.fileName,
          downloadUrl: stlFile.url,
          modelId: modelData.modelId || ''
        }
      });
    } catch (stripeError) {
      console.error('[' + new Date().toISOString() + '] Error creating checkout session:', stripeError.message);
      
      // Even if Stripe fails, we can return the download link
      if (stlFile && stlFile.url) {
        res.status(200).json({ 
          success: true,
          error: 'Failed to create checkout session, but STL file was stored successfully.',
          stlInfo: {
            url: stlFile.url,
            fileName: stlFile.fileName,
            downloadUrl: stlFile.url,
            modelId: modelData?.modelId || ''
          }
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: 'Failed to create checkout session: ' + stripeError.message 
        });
      }
    }
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Unexpected error in checkout endpoint:', error.message);
    
    // Even if there's a general error, try to return the download link if it was generated
    if (stlFile && stlFile.url) {
      res.status(200).json({ 
        success: true,
        error: 'Error during checkout, but STL file was stored successfully.',
        stlInfo: {
          url: stlFile.url,
          fileName: stlFile.fileName,
          downloadUrl: stlFile.url,
          modelId: modelData?.modelId || ''
        }
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Server error processing checkout request: ' + error.message 
      });
    }
  }
});

// Create a new endpoint to get download link for a model
app.get('/api/model/:modelId', async (req, res) => {
  try {
    const { modelId } = req.params;
    
    // Validate model ID
    if (!modelId) {
      return res.status(400).json({ success: false, error: 'Model ID is required' });
    }
    
    // Get model data from Firestore
    const modelDoc = await db.collection('models').doc(modelId).get();
    if (!modelDoc.exists) {
      return res.status(404).json({ success: false, error: 'Model not found' });
    }
    
    const modelData = modelDoc.data();
    
    // Return model data with download link
    res.status(200).json({
      success: true,
      model: {
        id: modelId,
        name: modelData.modelName,
        fileName: modelData.fileName,
        downloadUrl: modelData.stlUrl,
        status: modelData.status,
        createdAt: modelData.createdAt
      }
    });
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Error getting model:', error.message);
    res.status(500).json({ success: false, error: 'Error retrieving model data: ' + error.message });
  }
});

// Add a helper function to send download link email immediately
async function sendDownloadLinkEmail(email, modelName, downloadUrl, fileName, dimensions, material, infill, status) {
  if (!email) {
    console.log('[' + new Date().toISOString() + '] No email provided for download link notification');
    return false;
  }
  
  console.log('[' + new Date().toISOString() + '] Preparing to send download link email to:', email);
  
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });
    
    // Format the email body
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a5568; margin-bottom: 20px;">Your STL File Is Ready</h2>
        
        <p>Thank you for uploading your STL file to Taiyaki 3D Printing. Your file has been received and stored securely.</p>
        
        <div style="margin: 20px 0; padding: 15px; background-color: #f7fafc; border-radius: 5px;">
          <h3 style="color: #4a5568; margin-top: 0;">Model Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; width: 40%;"><strong>Model Name:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${modelName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>File Name:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${fileName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Dimensions:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${dimensions}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Material:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${material}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Infill:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${infill}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Status:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${status}</td>
            </tr>
          </table>
        </div>
        
        <div style="margin: 25px 0; text-align: center;">
          <a href="${downloadUrl}" style="background-color: #4a5568; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Download Your STL File</a>
          <p style="margin-top: 10px; font-size: 0.9em; color: #718096;">
            This download link will be valid for 10 years.
          </p>
        </div>
        
        <p>If you continue with the payment process, we will begin 3D printing your model according to the specifications you provided.</p>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 0.9em; color: #718096;">
          <p>Thank you for choosing Taiyaki 3D Printing.</p>
          <p>If you have any questions, please contact us at support@taiyaki.studio</p>
        </div>
      </div>
    `;
    
    // Set up email options
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      bcc: 'taiyaki.orders@gmail.com', // BCC a copy to the business email
      subject: `Your STL File for "${modelName}" is Ready`,
      html: emailBody
    };
    
    // Send the email
    console.log('[' + new Date().toISOString() + '] Sending download link email...');
    const info = await transporter.sendMail(mailOptions);
    console.log('[' + new Date().toISOString() + '] Download link email sent:', info.response);
    
    return true;
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Error sending download link email:', error.message);
    throw error;
  }
}

// Start the server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Stripe checkout server is running on port ${PORT}`);
});