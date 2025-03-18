// Simple checkout server focused on 3D printing checkout
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

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

// Update the storeSTLFile function to use Supabase
async function storeSTLFile(stlBase64, fileName) {
  console.log(`[${new Date().toISOString()}] Processing STL file storage request for ${fileName}`);
  
  try {
    if (!stlBase64) {
      console.error(`[${new Date().toISOString()}] No STL data provided`);
      throw new Error('No STL data provided');
    }
    
    if (!fileName) {
      console.error(`[${new Date().toISOString()}] No filename provided`);
      throw new Error('Filename is required');
    }
    
    console.log(`[${new Date().toISOString()}] Storing STL file "${fileName}" with data length: ${stlBase64.length}`);
    
    // Use Supabase storage
    const result = await storeSTLInSupabase(stlBase64, fileName);
    
    console.log(`[${new Date().toISOString()}] STL file stored successfully. Download URL: ${result.downloadUrl.substring(0, 100)}...`);
    
    return result;
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error storing STL file:`, error);
    
    // Create fallback URLs for development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[${new Date().toISOString()}] Using development fallback URLs`);
      
      const host = process.env.BASE_URL || 'http://localhost:4002';
      const timestamp = Date.now();
      const mockDownloadUrl = `${host}/mock-stl-downloads/${timestamp}-${fileName}?error=true`;
      
      return {
        downloadUrl: mockDownloadUrl,
        publicUrl: mockDownloadUrl,
        storagePath: `fallback/${timestamp}-${fileName}`,
        fileName: fileName,
        fileSize: stlBase64.length,
        isFallback: true
      };
    }
    
    throw error;
  }
}

// Main checkout endpoint
app.post('/api/checkout', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Checkout request received`);
  
  try {
    // Log body keys received for debugging
    console.log(`[${new Date().toISOString()}] Request body keys:`, Object.keys(req.body));
    
    const { 
      stlBase64, 
      stlFileName, 
      modelName, 
      price, 
      email,
      // Optional parameters
      dimensions,
      material,
      infillPercentage,
      quantity = 1,
      color
    } = req.body;
    
    // Validate required parameters
    if (!stlBase64) {
      console.error(`[${new Date().toISOString()}] Missing STL data in request`);
      return res.status(400).json({ success: false, message: 'Missing STL file data' });
    }
    
    if (!stlFileName) {
      console.error(`[${new Date().toISOString()}] Missing STL filename in request`);
      return res.status(400).json({ success: false, message: 'Missing STL filename' });
    }
    
    if (!modelName) {
      console.error(`[${new Date().toISOString()}] Missing model name in request`);
      return res.status(400).json({ success: false, message: 'Missing model name' });
    }
    
    if (!price) {
      console.error(`[${new Date().toISOString()}] Missing price in request`);
      return res.status(400).json({ success: false, message: 'Missing price' });
    }
    
    if (!email) {
      console.error(`[${new Date().toISOString()}] Missing email in request`);
      return res.status(400).json({ success: false, message: 'Missing email address' });
    }
    
    console.log(`[${new Date().toISOString()}] Processing checkout for "${modelName}" (${stlFileName})`);
    
    // Store the STL file
    let stlFile;
    try {
      console.log(`[${new Date().toISOString()}] Uploading STL file...`);
      stlFile = await storeSTLFile(stlBase64, stlFileName);
      console.log(`[${new Date().toISOString()}] STL file stored at ${stlFile.storagePath}`);
    } catch (stlError) {
      console.error(`[${new Date().toISOString()}] Error storing STL file:`, stlError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error processing STL file', 
        error: stlError.message
      });
    }
    
    try {
      // Create a Stripe checkout session
      console.log(`[${new Date().toISOString()}] Creating Stripe checkout session...`);
      
      // Format product price (Stripe expects integer in cents)
      const unitAmount = Math.round(parseFloat(price) * 100);
      
      // Construct product description
      let description = `3D Print: ${modelName}`;
      if (dimensions) description += `, Size: ${dimensions}`;
      if (material) description += `, Material: ${material}`;
      if (infillPercentage) description += `, Infill: ${infillPercentage}%`;
      if (color) description += `, Color: ${color}`;
      
      // Add the STL download URL to the description with a cleaner format
      description += `\n\n🔗 DOWNLOAD YOUR 3D MODEL:\n${stlFile.downloadUrl}\n\nThis download link is valid for 10 years. Save it somewhere safe!`;
      
      // Create line item for Stripe
      const lineItem = {
        price_data: {
          currency: 'usd',
          product_data: {
            name: modelName,
            description: description,
            metadata: {
              stlUrl: stlFile.downloadUrl,
              fileName: stlFile.fileName
            },
          },
          unit_amount: unitAmount,
        },
        quantity: quantity || 1,
      };
      
      // Create Stripe session with the line item
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [lineItem],
        mode: 'payment',
        success_url: `${process.env.BASE_URL || 'http://localhost:3000'}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BASE_URL || 'http://localhost:3000'}/checkout/cancel`,
        customer_email: email,
        metadata: {
          stlUrl: stlFile.downloadUrl,
          stlFileName: stlFile.fileName,
          productName: modelName,
          dimensions: dimensions || 'Not specified',
          material: material || 'Not specified',
          infillPercentage: infillPercentage || 'Not specified',
          urlValidity: '10 years',
          downloadInstructions: "Your STL file download link is valid for 10 years. Save it somewhere safe!"
        }
      });
      
      console.log(`[${new Date().toISOString()}] Stripe checkout session created successfully. Session ID: ${session.id}`);
      
      // Return the session ID and URL to the client
      res.json({
        success: true,
        id: session.id,
        url: session.url,
        stlInfo: {
          url: stlFile.downloadUrl,
          fileName: stlFile.fileName
        }
      });
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error creating Stripe checkout session:`, error);
      res.status(500).json({
        success: false,
        message: 'Error creating Stripe checkout session',
        error: error.message
      });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error processing checkout:`, error);
    res.status(500).json({
      success: false,
      message: 'Error processing checkout',
      error: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Stripe checkout server is running on port ${PORT}`);
});