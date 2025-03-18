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
  try {
    console.log('[' + new Date().toISOString() + '] Processing STL file storage request for ' + fileName);
    console.log('[' + new Date().toISOString() + '] Storing STL file "' + fileName + '" with data length:', stlData ? stlData.length : 'undefined');
    
    if (!stlData) {
      throw new Error('No STL data provided');
    }
    
    if (!fileName) {
      fileName = `model-${Date.now()}.stl`;
      console.log('[' + new Date().toISOString() + '] No filename provided, using generated name:', fileName);
    }
    
    // Make sure the filename has an .stl extension
    if (!fileName.toLowerCase().endsWith('.stl')) {
      fileName += '.stl';
      console.log('[' + new Date().toISOString() + '] Added .stl extension to filename:', fileName);
    }
    
    // Replace spaces and special characters in filename
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '-');
    if (safeFileName !== fileName) {
      console.log('[' + new Date().toISOString() + '] Sanitized filename from "' + fileName + '" to "' + safeFileName + '"');
      fileName = safeFileName;
    }
    
    console.log('[' + new Date().toISOString() + '] Preparing to store STL file in Supabase Storage...');
    
    // Process the STL data
    console.log('[' + new Date().toISOString() + '] STL data type:', typeof stlData);
    console.log('[' + new Date().toISOString() + '] STL data string preview:', stlData.substring(0, 80) + '...');
    console.log('[' + new Date().toISOString() + '] STL data length:', stlData.length, 'characters');
    
    let stlBuffer;
    // Check if the data is already base64 or needs encoding
    console.log('[' + new Date().toISOString() + '] Processing base64 STL data...');
    try {
      // Try to determine if it's a base64 string by checking for a common pattern
      if (stlData.match(/^[A-Za-z0-9+/=]+$/)) {
        console.log('[' + new Date().toISOString() + '] Using direct base64 data');
        stlBuffer = Buffer.from(stlData, 'base64');
      } else {
        console.log('[' + new Date().toISOString() + '] Converting to base64 first');
        stlBuffer = Buffer.from(stlData);
      }
      
      console.log('[' + new Date().toISOString() + '] Converted base64 data to buffer of size:', stlBuffer.length, 'bytes');
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error processing base64 data:', error.message);
      throw new Error('Failed to process STL data: ' + error.message);
    }
    
    console.log('[' + new Date().toISOString() + '] STL file size:', stlBuffer.length, 'bytes');
    
    // Create a UUID for uniqueness
    const uuid = require('crypto').randomUUID ? 
                 require('crypto').randomUUID() : 
                 Date.now().toString(36) + Math.random().toString(36).substring(2);
                 
    // Create a timestamp-based directory structure
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const timestamp = Date.now();
    
    // Shorten UUID to 16 chars for filename
    const shortId = uuid.replace(/-/g, '').substring(0, 16);
    
    // Create a temporary file path for the STL
    const tempDir = path.join(os.tmpdir(), 'stl-uploads');
    
    // Create the directory if it doesn't exist
    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
    
    const tempFilePath = path.join(tempDir, `${timestamp}-${shortId}-${fileName}`);
    
    // Write the STL data to the temporary file
    console.log('[' + new Date().toISOString() + '] Writing STL data to temporary file:', tempFilePath);
    
    try {
      // Use writeFileSync to ensure the file is completely written before proceeding
      fs.writeFileSync(tempFilePath, stlBuffer);
      console.log('[' + new Date().toISOString() + '] Temporary STL file created successfully');
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error writing temporary STL file:', error.message);
      throw new Error('Failed to create temporary STL file: ' + error.message);
    }
    
    // Define the path in storage - use a timestamp and UUID to ensure uniqueness
    const storagePath = `${year}/${month}/${day}/${timestamp}-${shortId}-${fileName}`;
    console.log('[' + new Date().toISOString() + '] Supabase Storage path:', storagePath);
    
    // Upload to Supabase Storage
    console.log('[' + new Date().toISOString() + '] Uploading to Supabase Storage bucket:', process.env.SUPABASE_STORAGE_BUCKET);
    
    try {
      // Read the file in chunks for better memory management with large files
      const fileStream = fs.createReadStream(tempFilePath);
      
      // Upload with appropriate content type for STL files
      await supabase.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET)
        .upload(storagePath, fileStream, {
          contentType: 'application/vnd.ms-pki.stl',
          upsert: true,
          duplex: 'half' // This helps with certain stream issues
        });
      
      console.log('[' + new Date().toISOString() + '] STL file uploaded successfully to Supabase Storage');
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error uploading to Supabase Storage:', error.message);
      
      // Try again with a direct buffer upload if streaming failed
      try {
        console.log('[' + new Date().toISOString() + '] Retrying upload with direct buffer method...');
        await supabase.storage
          .from(process.env.SUPABASE_STORAGE_BUCKET)
          .upload(storagePath, stlBuffer, {
            contentType: 'application/vnd.ms-pki.stl',
            upsert: true
          });
        console.log('[' + new Date().toISOString() + '] STL file uploaded successfully on retry');
      } catch (retryError) {
        console.error('[' + new Date().toISOString() + '] Retry upload also failed:', retryError.message);
        throw new Error('Failed to upload STL file to storage: ' + error.message);
      }
    }
    
    // Create a signed URL valid for 10 years
    const expirySeconds = 60 * 60 * 24 * 365 * 10; // 10 years in seconds
    console.log('[' + new Date().toISOString() + '] Creating signed URL with ' + expirySeconds + ' seconds validity (10 years)');
    console.log('[' + new Date().toISOString() + '] URL will expire on:', new Date(Date.now() + expirySeconds * 1000).toISOString());
    
    let signedUrlResponse;
    try {
      signedUrlResponse = await supabase.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET)
        .createSignedUrl(storagePath, expirySeconds);
      
      if (signedUrlResponse.error) {
        throw new Error(signedUrlResponse.error.message);
      }
      
      console.log('[' + new Date().toISOString() + '] Signed URL successfully created. URL length:', signedUrlResponse.data.signedUrl.length);
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error creating signed URL:', error.message);
      throw new Error('Failed to create signed URL: ' + error.message);
    }
    
    // Also get the public URL as a backup
    const { data: { publicUrl } } = supabase.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET)
      .getPublicUrl(storagePath);
    
    console.log('[' + new Date().toISOString() + '] Generated public URL:', publicUrl.substring(0, 70) + '...');
    console.log('[' + new Date().toISOString() + '] Generated signed URL (valid for 10 years):', signedUrlResponse.data.signedUrl.substring(0, 70) + '...');
    
    // Clean up the temporary file
    try {
      fs.unlinkSync(tempFilePath);
      console.log('[' + new Date().toISOString() + '] Temporary file deleted');
    } catch (error) {
      console.warn('[' + new Date().toISOString() + '] Failed to delete temporary file:', error.message);
    }
    
    const downloadUrl = signedUrlResponse.data.signedUrl;
    console.log('[' + new Date().toISOString() + '] STL file stored successfully. Download URL:', downloadUrl.substring(0, 70) + '...');
    console.log('[' + new Date().toISOString() + '] STL file stored at ' + process.env.SUPABASE_STORAGE_BUCKET + '/' + storagePath);
    console.log('[' + new Date().toISOString() + '] STL download URL length:', downloadUrl.length, 'characters');
    
    return {
      fileName,
      url: downloadUrl,
      publicUrl,
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
  try {
    console.log(`${new Date().toISOString()} - POST /api/checkout`);
    console.log('[' + new Date().toISOString() + '] Checkout request received');
    
    // Log the request body keys for debugging
    console.log('[' + new Date().toISOString() + '] Request body keys:', Object.keys(req.body));
    
    // Extract request data with better error handling
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
    
    // Validate required fields
    if (!stlBase64 || !stlFileName) {
      console.error('[' + new Date().toISOString() + '] Missing required fields: stlBase64 or stlFileName');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: STL file data and filename are required' 
      });
    }
    
    // Check if the file size is reasonable before processing
    const estimatedSize = Math.ceil(stlBase64.length * 0.75); // Approximate base64 decoded size
    console.log(`[${new Date().toISOString()}] Estimated STL size: ${estimatedSize} bytes`);
    
    // Set a high but reasonable limit (100MB)
    const MAX_SIZE = 100 * 1024 * 1024;
    if (estimatedSize > MAX_SIZE) {
      console.error(`[${new Date().toISOString()}] STL file too large: ${estimatedSize} bytes`);
      return res.status(400).json({
        success: false,
        error: 'STL file too large. Maximum size is 100MB.'
      });
    }
    
    console.log('[' + new Date().toISOString() + '] Processing checkout for "' + modelName + '" (' + stlFileName + ')');
    
    // Upload STL file to storage
    console.log('[' + new Date().toISOString() + '] Uploading STL file...');
    
    // Process STL file for storage
    let stlFile;
    try {
      stlFile = await storeSTLFile(stlBase64, stlFileName);
      if (!stlFile || !stlFile.url) {
        throw new Error('Failed to store STL file');
      }
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error storing STL file:', error.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to store STL file: ' + error.message 
      });
    }
    
    // Create formatted item description
    const modelDescription = formatModelDescription(modelName, dimensions, material, infillPercentage);
    
    // Create Stripe checkout session
    console.log('[' + new Date().toISOString() + '] Creating Stripe checkout session...');
    console.log('[' + new Date().toISOString() + '] Description length:', modelDescription.length, 'characters');
    
    // Create metadata object ensuring we stay under Stripe's limits
    const metadata = {
      stlFileName: stlFileName.substring(0, 40), // Limit length to avoid Stripe metadata issues
      stlUrl: stlFile.url.substring(0, 500),  // Limit to 500 chars to avoid Stripe metadata issues
      material,
      dimensions,
      infill: `${infillPercentage}%`,
      customerEmail: email || 'not provided'
    };
    
    // Keep the total metadata under Stripe's limit
    const metadataSize = JSON.stringify(metadata).length;
    console.log(`[${new Date().toISOString()}] Metadata size: ${metadataSize} bytes`);
    
    if (metadataSize > 50000) { // Stripe's metadata limit
      // Trim the URL if necessary to fit within limits
      const urlLength = metadata.stlUrl.length;
      const excessBytes = metadataSize - 50000 + 100; // 100 bytes buffer
      const newUrlLength = Math.max(100, urlLength - excessBytes);
      metadata.stlUrl = metadata.stlUrl.substring(0, newUrlLength) + '...';
      console.log(`[${new Date().toISOString()}] Trimmed URL to fit within Stripe metadata limits`);
    }
    
    try {
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
      
      console.log('[' + new Date().toISOString() + '] Stripe checkout session created successfully. Session ID:', session.id);
      
      // Send the response with both session ID and URL
      res.status(200).json({
        success: true,
        id: session.id,
        url: session.url,
        stlInfo: {
          url: stlFile.url,
          fileName: stlFile.fileName
        }
      });
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error creating checkout session:', error.message);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to create checkout session: ' + error.message 
      });
    }
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Unexpected error in checkout endpoint:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Server error processing checkout request: ' + error.message 
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Stripe checkout server is running on port ${PORT}`);
});