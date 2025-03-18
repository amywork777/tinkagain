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

// Load environment variables from multiple possible locations
try {
  // First try .env.local in the current directory
  if (fs.existsSync(path.resolve(process.cwd(), '.env.local'))) {
    console.log(`[${new Date().toISOString()}] Loading environment from .env.local`);
    dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
  } 
  // Then try .env in the current directory
  else if (fs.existsSync(path.resolve(process.cwd(), '.env'))) {
    console.log(`[${new Date().toISOString()}] Loading environment from .env`);
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });
  }
  // Then try parent directory .env.local
  else if (fs.existsSync(path.resolve(process.cwd(), '..', '.env.local'))) {
    console.log(`[${new Date().toISOString()}] Loading environment from ../.env.local`);
    dotenv.config({ path: path.resolve(process.cwd(), '..', '.env.local') });
  }
  // Then try parent directory .env
  else if (fs.existsSync(path.resolve(process.cwd(), '..', '.env'))) {
    console.log(`[${new Date().toISOString()}] Loading environment from ../.env`);
    dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });
  } else {
    console.warn(`[${new Date().toISOString()}] No .env or .env.local file found`);
    dotenv.config(); // Try loading from process.env anyway
  }
} catch (err) {
  console.error(`[${new Date().toISOString()}] Error loading environment variables:`, err);
}

console.log(`[${new Date().toISOString()}] Starting Stripe checkout server...`);
console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV}`);

// Add development mode fallbacks for missing environment variables
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.warn(`[${new Date().toISOString()}] STRIPE_SECRET_KEY is missing!`);
  
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[${new Date().toISOString()}] Using TEST MODE fallback key for development`);
    process.env.STRIPE_SECRET_KEY = 'sk_test_fallback_for_development_only'; // This won't actually work with Stripe API
  } else {
    console.error(`[${new Date().toISOString()}] Cannot run in production without a valid STRIPE_SECRET_KEY!`);
  }
} else {
  console.log(`[${new Date().toISOString()}] Using Stripe key: ${STRIPE_SECRET_KEY.startsWith('sk_test') ? 'TEST MODE' : 'LIVE MODE'}`);
}

// Import and initialize Supabase client
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with better fallbacks
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
let supabase = null;
let storageType = 'none';

// Check if we have Supabase credentials
if (supabaseUrl && supabaseKey) {
  console.log('[' + new Date().toISOString() + '] Supabase configuration found. Using Supabase for STL storage.');
  console.log('[' + new Date().toISOString() + '] Supabase URL:', supabaseUrl.substring(0, 20) + '...');
  
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    storageType = 'Supabase';
    
    // Test the connection by checking available buckets
    setTimeout(async () => {
      try {
        console.log('[' + new Date().toISOString() + '] Testing Supabase connection...');
        // Check if we can list storage buckets
        const { data: buckets, error } = await supabase.storage.listBuckets();
        
        if (error) {
          console.error('[' + new Date().toISOString() + '] Supabase storage test failed:', error.message);
        } else {
          console.log('[' + new Date().toISOString() + '] Available Supabase buckets:', buckets.map(b => b.name).join(', ') || 'none');
          
          // Check for our required bucket
          const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'stl-models';
          const bucketExists = buckets.some(b => b.name === bucketName);
          
          if (!bucketExists) {
            console.warn('[' + new Date().toISOString() + '] Required bucket "' + bucketName + '" not found in Supabase storage!');
            console.warn('[' + new Date().toISOString() + '] Please create this bucket in your Supabase dashboard or update the SUPABASE_STORAGE_BUCKET env variable.');
            console.warn('[' + new Date().toISOString() + '] Falling back to local storage for now.');
          } else {
            console.log('[' + new Date().toISOString() + '] Found required bucket "' + bucketName + '" in Supabase storage.');
          }
        }
        
        // Check for tables
        try {
          // See if we can access the 'models' table
          const { data, error } = await supabase
            .from('models')
            .select('id')
            .limit(1);
            
          if (error) {
            if (error.message && error.message.includes('does not exist')) {
              console.warn('[' + new Date().toISOString() + '] The "models" table does not exist in Supabase.');
              console.warn('[' + new Date().toISOString() + '] Create it with the following columns:');
              console.warn('[' + new Date().toISOString() + '] - id (uuid, primary key)');
              console.warn('[' + new Date().toISOString() + '] - model_name (text)');
              console.warn('[' + new Date().toISOString() + '] - file_name (text)');
              console.warn('[' + new Date().toISOString() + '] - dimensions (text)');
              console.warn('[' + new Date().toISOString() + '] - material (text)');
              console.warn('[' + new Date().toISOString() + '] - infill_percentage (integer)');
              console.warn('[' + new Date().toISOString() + '] - price (integer)');
              console.warn('[' + new Date().toISOString() + '] - email (text)');
              console.warn('[' + new Date().toISOString() + '] - status (text)');
              console.warn('[' + new Date().toISOString() + '] - stl_url (text)');
              console.warn('[' + new Date().toISOString() + '] - stl_path (text)');
              console.warn('[' + new Date().toISOString() + '] - created_at (timestamp with time zone)');
            } else {
              console.error('[' + new Date().toISOString() + '] Error checking for "models" table:', error.message);
            }
          } else {
            console.log('[' + new Date().toISOString() + '] Successfully connected to "models" table in Supabase');
          }
        } catch (tableError) {
          console.error('[' + new Date().toISOString() + '] Error testing table access:', tableError.message);
        }
      } catch (testError) {
        console.error('[' + new Date().toISOString() + '] Error testing Supabase connection:', testError.message);
      }
    }, 1000); // Delay test to not block server startup
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Error initializing Supabase client:', error.message);
    console.warn('[' + new Date().toISOString() + '] Falling back to local storage for file storage.');
    storageType = 'Local (Fallback)';
  }
} else {
  console.warn('[' + new Date().toISOString() + '] No Supabase credentials found. Using fallback storage.');
  if (!supabaseUrl) {
    console.warn('[' + new Date().toISOString() + '] Missing SUPABASE_URL environment variable');
  }
  if (!supabaseKey) {
    console.warn('[' + new Date().toISOString() + '] Missing SUPABASE_SERVICE_KEY environment variable');
  }
  
  if (process.env.NODE_ENV !== 'production') {
    console.log('[' + new Date().toISOString() + '] Setting up mock Supabase client for development');
    // Create a mock Supabase client for development
    supabase = {
      storage: {
        from: () => ({
          upload: async () => ({ data: { path: 'mock-path' }, error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: 'http://localhost:4002/mock-download/file.stl' }, error: null }),
          getPublicUrl: () => ({ data: { publicUrl: 'http://localhost:4002/mock-public/file.stl' }, error: null }),
          listBuckets: async () => ({ data: [{ name: 'mock-bucket' }], error: null })
        }),
        listBuckets: async () => ({ data: [{ name: 'mock-bucket' }], error: null })
      },
      from: () => ({
        insert: async () => ({ data: [{ id: 'mock-id-' + Date.now() }], error: null }),
        update: async () => ({ data: null, error: null }),
        select: () => ({ data: null, error: null }),
        eq: () => ({ data: null, error: null }),
        single: () => ({ data: null, error: null }),
        limit: () => ({ data: null, error: null })
      })
    };
    storageType = 'Mock';
  } else {
    storageType = 'None';
  }
}

// Initialize Stripe with better error handling
let stripe;
try {
  if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('[' + new Date().toISOString() + '] Stripe initialized successfully');
  } else if (process.env.NODE_ENV !== 'production') {
    console.log('[' + new Date().toISOString() + '] Creating mock Stripe client for development');
    // Create a mock Stripe client for development
    stripe = {
      checkout: {
        sessions: {
          create: async () => ({ 
            id: 'mock-session-' + Date.now(),
            url: 'http://localhost:4002/mock-checkout',
            listLineItems: async () => ({ data: [] })
          }),
          listLineItems: async () => ({ data: [] }),
          update: async () => ({})
        }
      },
      products: {
        retrieve: async () => ({ name: 'Mock Product', description: 'Mock Description', metadata: {} })
      },
      webhooks: {
        constructEvent: (body, sig, secret) => ({ type: 'mock.event', data: { object: {} } })
      }
    };
  } else {
    throw new Error('Missing STRIPE_SECRET_KEY in production environment');
  }
} catch (error) {
  console.error('[' + new Date().toISOString() + '] Error initializing Stripe:', error.message);
  if (process.env.NODE_ENV !== 'production') {
    console.log('[' + new Date().toISOString() + '] Creating mock Stripe client for development');
    // Create a mock Stripe client for development (same as above)
    stripe = {
      checkout: {
        sessions: {
          create: async () => ({ 
            id: 'mock-session-' + Date.now(),
            url: 'http://localhost:4002/mock-checkout',
            listLineItems: async () => ({ data: [] })
          }),
          listLineItems: async () => ({ data: [] }),
          update: async () => ({})
        }
      },
      products: {
        retrieve: async () => ({ name: 'Mock Product', description: 'Mock Description', metadata: {} })
      },
      webhooks: {
        constructEvent: (body, sig, secret) => ({ type: 'mock.event', data: { object: {} } })
      }
    };
  } else {
    console.error('[' + new Date().toISOString() + '] Cannot start server without valid Stripe configuration');
    process.exit(1); // Exit in production
  }
}

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

// Add a route to serve locally stored STL files
app.use('/local-storage', express.static(path.join(process.cwd(), 'local-storage')));
console.log(`[${new Date().toISOString()}] Local file storage route enabled at /local-storage`);

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

// Helper function to store STL files
async function storeSTLFile(stlData, fileName) {
  console.log('[' + new Date().toISOString() + '] Starting STL file storage process');
  try {
    // Sanitize the file name
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
      // Check if the data starts with "data:model/stl" or similar
      if (typeof stlData === 'string' && stlData.startsWith('data:')) {
        console.log('[' + new Date().toISOString() + '] STL data appears to be a data URL, extracting...');
        const base64Data = stlData.split(';base64,').pop();
        stlBuffer = Buffer.from(base64Data, 'base64');
      }
      // Check if it's base64 encoded without a header
      else if (typeof stlData === 'string' && stlData.match(/^[A-Za-z0-9+/=]+$/)) {
        console.log('[' + new Date().toISOString() + '] STL data appears to be base64 encoded, decoding...');
        stlBuffer = Buffer.from(stlData, 'base64');
      } 
      // Check if it's binary data directly
      else if (stlData instanceof Buffer || stlData instanceof Uint8Array) {
        console.log('[' + new Date().toISOString() + '] STL data is already a buffer');
        stlBuffer = Buffer.from(stlData);
      }
      // Otherwise, treat as raw string data (ASCII STL)
      else {
        console.log('[' + new Date().toISOString() + '] STL data appears to be raw text data, treating as ASCII STL');
        stlBuffer = Buffer.from(stlData);
      }
      
      console.log('[' + new Date().toISOString() + '] Decoded STL buffer size:', stlBuffer.length);
      
      // Verify this looks like an STL file
      if (stlBuffer.length < 10) {
        console.error('[' + new Date().toISOString() + '] Warning: STL buffer too small, may not be valid STL data');
      } else {
        // Check if it's a binary STL (starts with header then has 4-byte face count)
        // or ASCII STL (starts with "solid")
        const headerStr = stlBuffer.toString('utf8', 0, 5).toLowerCase();
        if (headerStr === 'solid') {
          console.log('[' + new Date().toISOString() + '] STL appears to be ASCII format');
        } else {
          console.log('[' + new Date().toISOString() + '] STL appears to be binary format');
        }
      }
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
    
    // Get the bucket name with fallback
    const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'stl-models';
    
    // DEVELOPMENT MODE: First try to use local file storage if we're not in production
    if (process.env.NODE_ENV !== 'production') {
      try {
        // Skip automatic local file storage in development mode to prioritize Supabase
        // Only use local storage as fallback if Supabase fails
        console.log('[' + new Date().toISOString() + '] Prioritizing Supabase storage even in development mode');
      } catch (localStorageError) {
        console.error('[' + new Date().toISOString() + '] Error using local file storage:', localStorageError.message);
        console.log('[' + new Date().toISOString() + '] Falling back to Supabase storage...');
      }
    }
    
    // Upload the STL data to Supabase storage
    console.log('[' + new Date().toISOString() + '] Uploading STL file to Supabase storage...');
    
    // Check if Supabase is initialized
    if (!supabase) {
      console.warn('[' + new Date().toISOString() + '] Supabase client is not initialized. Using local file fallback.');
      
      // Local file fallback since Supabase isn't available
      // Create local directory for files
      const localStorageDir = path.join(process.cwd(), 'local-storage', 'stl-files');
      const fullStoragePath = path.join(localStorageDir, year.toString(), month, day);
      
      // Create directories if they don't exist
      fs.mkdirSync(fullStoragePath, { recursive: true });
      
      // Write the file locally
      const localFilePath = path.join(fullStoragePath, `${timestamp}-${uniqueId}-${fileName}`);
      fs.writeFileSync(localFilePath, stlBuffer);
      
      console.log('[' + new Date().toISOString() + '] Saved STL file locally to:', localFilePath);
      
      // Create a local file URL
      const hostUrl = process.env.BASE_URL || 'http://localhost:4002';
      const fileUrl = `${hostUrl}/local-storage/stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${fileName}`;
      
      console.log('[' + new Date().toISOString() + '] Created local file URL:', fileUrl);
      
      return {
        fileName,
        url: fileUrl,
        path: `local-storage/${storagePath}`,
        size: stlBuffer.length,
        isLocalStorage: true
      };
    }
    
    // Try direct upload first
    try {
      // Log more details about the upload attempt
      console.log('[' + new Date().toISOString() + '] Attempting Supabase upload to bucket:', bucketName);
      console.log('[' + new Date().toISOString() + '] File path:', storagePath);
      
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(storagePath, stlBuffer, {
          contentType: 'application/vnd.ms-pki.stl',
          upsert: true,
          cacheControl: '31536000' // 1 year cache
        });
      
      if (error) {
        // Log detailed error information
        console.error('[' + new Date().toISOString() + '] Supabase upload error details:', JSON.stringify(error));
        
        // If bucket not found, try to find available buckets
        if (error.message && (error.message.includes('Bucket not found') || error.message.includes('not found'))) {
          console.warn('[' + new Date().toISOString() + '] Bucket not found. Trying local file storage...');
          
          // Try to list available buckets for debugging
          try {
            const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
            if (bucketError) {
              console.error('[' + new Date().toISOString() + '] Error listing buckets:', bucketError.message);
            } else {
              console.log('[' + new Date().toISOString() + '] Available buckets:', buckets.map(b => b.name).join(', '));
            }
          } catch (bucketListError) {
            console.error('[' + new Date().toISOString() + '] Error checking buckets:', bucketListError.message);
          }
          
          // Use local file storage as fallback
          const localStorageDir = path.join(process.cwd(), 'local-storage', 'stl-files');
          const fullStoragePath = path.join(localStorageDir, year.toString(), month, day);
          
          // Create directories if they don't exist
          fs.mkdirSync(fullStoragePath, { recursive: true });
          
          // Write the file locally
          const localFilePath = path.join(fullStoragePath, `${timestamp}-${uniqueId}-${fileName}`);
          fs.writeFileSync(localFilePath, stlBuffer);
          
          console.log('[' + new Date().toISOString() + '] Saved STL file locally to:', localFilePath);
          
          // Create a local file URL
          const hostUrl = process.env.BASE_URL || 'http://localhost:4002';
          const fileUrl = `${hostUrl}/local-storage/stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${fileName}`;
          
          console.log('[' + new Date().toISOString() + '] Created local file URL:', fileUrl);
          
          return {
            fileName,
            url: fileUrl,
            path: `local-storage/${storagePath}`,
            size: stlBuffer.length,
            isLocalStorage: true
          };
        } else {
          throw error;
        }
      }
      
      console.log('[' + new Date().toISOString() + '] STL file uploaded successfully to Supabase storage:', data.path);
      
      // Create a signed URL valid for 10 years
      const expirySeconds = 60 * 60 * 24 * 365 * 10; // 10 years
      
      console.log('[' + new Date().toISOString() + '] Creating signed URL for file:', storagePath);
      const { data: urlData, error: urlError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(storagePath, expirySeconds);
      
      if (urlError) {
        console.error('[' + new Date().toISOString() + '] Error creating signed URL:', urlError.message);
        
        // Try to get the public URL as a fallback
        try {
          const { data: publicUrlData } = supabase.storage
            .from(bucketName)
            .getPublicUrl(storagePath);
          
          const signedUrl = publicUrlData.publicUrl;
          console.log('[' + new Date().toISOString() + '] Fallback to public URL (first 100 chars):', signedUrl.substring(0, 100) + '...');
          
          return {
            fileName,
            url: signedUrl,
            path: storagePath,
            size: stlBuffer.length,
            isSupabase: true
          };
        } catch (fallbackError) {
          console.error('[' + new Date().toISOString() + '] Failed to get public URL:', fallbackError.message);
          throw urlError;
        }
      }
      
      const signedUrl = urlData.signedUrl;
      console.log('[' + new Date().toISOString() + '] Generated signed URL (first 100 chars):', signedUrl.substring(0, 100) + '...');
      
      return {
        fileName,
        url: signedUrl,
        path: storagePath,
        size: stlBuffer.length,
        isSupabase: true
      };
      
    } catch (error) {
      console.error('[' + new Date().toISOString() + '] Error uploading STL to Supabase storage:', error.message);
      
      // Try writing to a temp file and uploading as a fallback
      try {
        // If bucket not found, try to find available buckets or use local storage
        if (error.message && (error.message.includes('Bucket not found') || error.message.includes('not found'))) {
          console.warn('[' + new Date().toISOString() + '] Bucket not found. Trying local file storage...');
          
          // Use local file storage as fallback
          const localStorageDir = path.join(process.cwd(), 'local-storage', 'stl-files');
          const fullStoragePath = path.join(localStorageDir, year.toString(), month, day);
          
          // Create directories if they don't exist
          fs.mkdirSync(fullStoragePath, { recursive: true });
          
          // Write the file locally
          const localFilePath = path.join(fullStoragePath, `${timestamp}-${uniqueId}-${fileName}`);
          fs.writeFileSync(localFilePath, stlBuffer);
          
          console.log('[' + new Date().toISOString() + '] Saved STL file locally to:', localFilePath);
          
          // Create a local file URL
          const hostUrl = process.env.BASE_URL || 'http://localhost:4002';
          const fileUrl = `${hostUrl}/local-storage/stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${fileName}`;
          
          console.log('[' + new Date().toISOString() + '] Created local file URL:', fileUrl);
          
          return {
            fileName,
            url: fileUrl,
            path: `local-storage/${storagePath}`,
            size: stlBuffer.length,
            isLocalStorage: true
          };
        }
        
        console.log('[' + new Date().toISOString() + '] Falling back to file-based upload...');
        
        // Create a temporary file
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
        const { data, error } = await supabase.storage
          .from(bucketName)
          .upload(storagePath, fileStream, {
            contentType: 'application/vnd.ms-pki.stl',
            upsert: true,
            cacheControl: '31536000', // 1 year cache
            duplex: 'half' // Help with streaming issues
          });
          
        if (error) {
          // If bucket not found, use local storage
          if (error.message && (error.message.includes('Bucket not found') || error.message.includes('not found'))) {
            console.warn('[' + new Date().toISOString() + '] Bucket not found. Using local file storage...');
            
            // Use local file storage
            const localStorageDir = path.join(process.cwd(), 'local-storage', 'stl-files');
            const fullStoragePath = path.join(localStorageDir, year.toString(), month, day);
            
            // Create directories if they don't exist
            fs.mkdirSync(fullStoragePath, { recursive: true });
            
            // Just move the temp file to our local storage
            const localFilePath = path.join(fullStoragePath, `${timestamp}-${uniqueId}-${fileName}`);
            fs.copyFileSync(tempFilePath, localFilePath);
            
            console.log('[' + new Date().toISOString() + '] Saved STL file locally to:', localFilePath);
            
            // Create a local file URL
            const hostUrl = process.env.BASE_URL || 'http://localhost:4002';
            const fileUrl = `${hostUrl}/local-storage/stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${fileName}`;
            
            console.log('[' + new Date().toISOString() + '] Created local file URL:', fileUrl);
            
            // Clean up the temporary file
            try {
              fs.unlinkSync(tempFilePath);
            } catch (cleanupError) {
              console.warn('[' + new Date().toISOString() + '] Failed to delete temporary file:', cleanupError.message);
            }
            
            return {
              fileName,
              url: fileUrl,
              path: `local-storage/${storagePath}`,
              size: stlBuffer.length,
              isLocalStorage: true
            };
          }
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
        
        // Last resort: local file storage
        try {
          console.log('[' + new Date().toISOString() + '] All Supabase methods failed. Using local file storage as last resort.');
          
          // Use local file storage
          const localStorageDir = path.join(process.cwd(), 'local-storage', 'stl-files');
          const fullStoragePath = path.join(localStorageDir, year.toString(), month, day);
          
          // Create directories if they don't exist
          fs.mkdirSync(fullStoragePath, { recursive: true });
          
          // Write the file locally
          const localFilePath = path.join(fullStoragePath, `${timestamp}-${uniqueId}-${fileName}`);
          fs.writeFileSync(localFilePath, stlBuffer);
          
          console.log('[' + new Date().toISOString() + '] Saved STL file locally to:', localFilePath);
          
          // Create a local file URL
          const hostUrl = process.env.BASE_URL || 'http://localhost:4002';
          const fileUrl = `${hostUrl}/local-storage/stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${fileName}`;
          
          console.log('[' + new Date().toISOString() + '] Created local file URL:', fileUrl);
          
          return {
            fileName,
            url: fileUrl,
            path: `local-storage/${storagePath}`,
            size: stlBuffer.length,
            isLocalStorage: true
          };
        } catch (lastResortError) {
          console.error('[' + new Date().toISOString() + '] Even local storage failed:', lastResortError.message);
          throw new Error('Failed to store STL file anywhere: ' + lastResortError.message);
        }
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

// Create email transporter for notifications - fixed initialization
let transporter = null;
try {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
  
  if (emailUser && emailPass) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      },
    });
    console.log(`[${new Date().toISOString()}] Email notifications configured for ${emailUser}`);
  } else {
    console.log(`[${new Date().toISOString()}] Email notification credentials not found in environment`);
  }
} catch (emailError) {
  console.error(`[${new Date().toISOString()}] Error setting up email transport:`, emailError);
}

// Helper function to format model description
function formatModelDescription(modelName, dimensions, material, infillPercentage) {
  let description = `3D Print of ${modelName}`;
  if (dimensions && dimensions.trim() !== '') {
    description += `\nDimensions: ${dimensions}`;
  }
  description += `\nMaterial: ${material}\nInfill: ${infillPercentage}%`;
  return description;
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
      dimensions = '',
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
      price: `$${(parseFloat(price)/100).toFixed(2)}`,
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

    // Convert price to integer cents for Stripe
    let priceCents;
    try {
      if (typeof price === 'string' && price.includes('.')) {
        // Convert price like "13.93" to 1393 cents
        priceCents = Math.round(parseFloat(price) * 100);
      } else if (typeof price === 'number' && !Number.isInteger(price)) {
        // Convert price like 13.93 to 1393 cents
        priceCents = Math.round(price * 100);
      } else {
        // Assume it's already in cents
        priceCents = parseInt(price, 10);
      }
      
      console.log(`[${new Date().toISOString()}] Original price: ${price}, converted to ${priceCents} cents for Stripe`);
      
      // Validate the price is a positive integer
      if (isNaN(priceCents) || priceCents <= 0) {
        console.error(`[${new Date().toISOString()}] Invalid price value: ${price}, defaulting to 1999 cents ($19.99)`);
        priceCents = 1999; // Default to $19.99 if invalid
      }
    } catch (priceError) {
      console.error(`[${new Date().toISOString()}] Error processing price: ${priceError.message}, defaulting to 1999 cents ($19.99)`);
      priceCents = 1999; // Default to $19.99 if any error occurs
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
        price: priceCents,
        email: email || '',
        stlUrl: stlFile.url
      };
      
      // Store model data in Supabase
      if (supabase) {
        try {
          // Prepare model info object
          const modelInfo = {
            model_name: modelName,
            file_name: stlFileName,
            dimensions,
            material,
            infill_percentage: infillPercentage,
            price: priceCents,
            email: email || 'not provided',
            status: 'pending_payment',
            stl_url: stlFile.url,
            stl_path: stlFile.path,
            created_at: new Date().toISOString()
          };
          
          console.log('[' + new Date().toISOString() + '] Attempting to save model info to Supabase:', JSON.stringify(modelInfo).substring(0, 200) + '...');
          
          // Save to models table in Supabase
          const { data, error } = await supabase
            .from('models')
            .insert(modelInfo)
            .select();
            
          if (error) {
            console.error('[' + new Date().toISOString() + '] Error saving model to Supabase:', error.message);
            
            // If the table doesn't exist, log a more helpful message and try to create it
            if (error.message && error.message.includes('does not exist')) {
              console.error('[' + new Date().toISOString() + '] The "models" table does not exist in Supabase. Using local storage only.');
              
              // Store model data in a local JSON file for development
              if (process.env.NODE_ENV !== 'production') {
                try {
                  const localModelsDirPath = path.join(process.cwd(), 'local-storage', 'models');
                  
                  // Create the directory if it doesn't exist
                  if (!fs.existsSync(localModelsDirPath)) {
                    fs.mkdirSync(localModelsDirPath, { recursive: true });
                  }
                  
                  // Generate a UUID for the model
                  const modelId = require('crypto').randomUUID();
                  modelInfo.id = modelId;
                  
                  // Save to a JSON file
                  const localModelPath = path.join(localModelsDirPath, `${modelId}.json`);
                  fs.writeFileSync(localModelPath, JSON.stringify(modelInfo, null, 2));
                  
                  console.log('[' + new Date().toISOString() + '] Saved model info to local storage with ID:', modelId);
                  
                  // Add the model ID to the data for the rest of the process
                  modelData.modelId = modelId;
                } catch (localStorageError) {
                  console.error('[' + new Date().toISOString() + '] Error saving model to local storage:', localStorageError.message);
                }
              }
            }
          } else if (!data || data.length === 0) {
            console.error('[' + new Date().toISOString() + '] No data returned from Supabase insert, but no error reported');
          } else {
            console.log('[' + new Date().toISOString() + '] Saved model info with ID:', data[0]?.id);
            
            // Add the model ID to the data
            if (data && data[0] && data[0].id) {
              modelData.modelId = data[0].id;
            }
          }
        } catch (dbError) {
          console.error('[' + new Date().toISOString() + '] Error saving model to database:', dbError.message);
          console.error('[' + new Date().toISOString() + '] Stack trace:', dbError.stack);
          
          // Try local storage as fallback
          if (process.env.NODE_ENV !== 'production') {
            try {
              const localModelsDirPath = path.join(process.cwd(), 'local-storage', 'models');
              
              // Create the directory if it doesn't exist
              if (!fs.existsSync(localModelsDirPath)) {
                fs.mkdirSync(localModelsDirPath, { recursive: true });
              }
              
              // Generate a UUID for the model
              const modelId = require('crypto').randomUUID();
              const modelInfo = {
                id: modelId,
                model_name: modelName,
                file_name: stlFileName,
                dimensions,
                material,
                infill_percentage: infillPercentage,
                price: priceCents,
                email: email || 'not provided',
                status: 'pending_payment',
                stl_url: stlFile.url,
                stl_path: stlFile.path,
                created_at: new Date().toISOString()
              };
              
              // Save to a JSON file
              const localModelPath = path.join(localModelsDirPath, `${modelId}.json`);
              fs.writeFileSync(localModelPath, JSON.stringify(modelInfo, null, 2));
              
              console.log('[' + new Date().toISOString() + '] Saved model info to local storage with ID:', modelId);
              
              // Add the model ID to the data for the rest of the process
              modelData.modelId = modelId;
            } catch (localStorageError) {
              console.error('[' + new Date().toISOString() + '] Error saving model to local storage:', localStorageError.message);
            }
          }
        }
      } else {
        console.warn('[' + new Date().toISOString() + '] Supabase client not initialized, skipping database storage');
        
        // Fallback to local storage for development mode
        if (process.env.NODE_ENV !== 'production') {
          try {
            const localModelsDirPath = path.join(process.cwd(), 'local-storage', 'models');
            
            // Create the directory if it doesn't exist
            if (!fs.existsSync(localModelsDirPath)) {
              fs.mkdirSync(localModelsDirPath, { recursive: true });
            }
            
            // Generate a UUID for the model
            const modelId = require('crypto').randomUUID();
            const modelInfo = {
              id: modelId,
              model_name: modelName,
              file_name: stlFileName,
              dimensions,
              material,
              infill_percentage: infillPercentage,
              price: priceCents,
              email: email || 'not provided',
              status: 'pending_payment',
              stl_url: stlFile.url,
              stl_path: stlFile.path,
              created_at: new Date().toISOString()
            };
            
            // Save to a JSON file
            const localModelPath = path.join(localModelsDirPath, `${modelId}.json`);
            fs.writeFileSync(localModelPath, JSON.stringify(modelInfo, null, 2));
            
            console.log('[' + new Date().toISOString() + '] Saved model info to local storage with ID:', modelId);
            
            // Add the model ID to the data for the rest of the process
            modelData.modelId = modelId;
          } catch (localStorageError) {
            console.error('[' + new Date().toISOString() + '] Error saving model to local storage:', localStorageError.message);
          }
        }
      }
      
      // Send email with download link immediately after successful upload
      if (email && stlFile && stlFile.url) {
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
            'File Uploaded'
          );
          console.log('[' + new Date().toISOString() + '] Immediate download link email sent successfully');
        } catch (emailError) {
          console.error('[' + new Date().toISOString() + '] Error sending immediate download link email:', emailError.message);
          // Continue even if email fails, this is not critical for checkout
        }
      } else if (!email) {
        console.log('[' + new Date().toISOString() + '] No email provided, skipping immediate email notification');
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
    console.log('[' + new Date().toISOString() + '] Creating Stripe checkout session with price in cents:', priceCents);
    
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
        modelId: modelData.modelId || 'unknown',
        orderType: '3d_print',
        downloadLink: stlFile.url // Make sure this is explicitly included
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
      
      const productDescription = `3D Print of ${modelName}${dimensions ? `\nDimensions: ${dimensions}` : ''}
Material: ${material}
Infill: ${infillPercentage}%
Download your STL file: ${stlFile.url}`;
      
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: {
              name: `3D Print: ${modelName}`,
              description: productDescription,
              metadata: {
                type: '3d_print',
                stlDownloadUrl: stlFile.url
              }
            },
            unit_amount: priceCents, // Now using properly formatted price in cents
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
    
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Database connection not available' });
    }
    
    // Get model data from Supabase
    const { data: modelData, error } = await supabase
      .from('models')
      .select('*')
      .eq('id', modelId)
      .single();
      
    if (error) {
      console.error('[' + new Date().toISOString() + '] Error retrieving model:', error.message);
      return res.status(500).json({ success: false, error: 'Error retrieving model data' });
    }
    
    if (!modelData) {
      return res.status(404).json({ success: false, error: 'Model not found' });
    }
    
    // Return model data with download link
    res.status(200).json({
      success: true,
      model: {
        id: modelId,
        name: modelData.model_name,
        fileName: modelData.file_name,
        downloadUrl: modelData.stl_url,
        status: modelData.status,
        createdAt: modelData.created_at
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
    // Use the global transporter if available, otherwise create a new one
    let emailTransporter = transporter;
    
    if (!emailTransporter) {
      // Try to create a new transporter as fallback
      const emailUser = process.env.EMAIL_USER;
      const emailPass = process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
      
      if (!emailUser || !emailPass) {
        console.error('[' + new Date().toISOString() + '] Cannot send email: missing email credentials');
        return false;
      }
      
      emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: emailUser,
          pass: emailPass
        }
      });
    }
    
    // Check if dimensions is empty
    const hasDimensions = dimensions && dimensions.trim() !== '';
    
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
            ${hasDimensions ? `
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Dimensions:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${dimensions}</td>
            </tr>` : ''}
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
      bcc: process.env.BCC_EMAIL || 'taiyaki.orders@gmail.com', // BCC a copy to the business email
      subject: `Your STL File for "${modelName}" is Ready`,
      html: emailBody
    };
    
    // Send the email
    console.log('[' + new Date().toISOString() + '] Sending download link email...');
    const info = await emailTransporter.sendMail(mailOptions);
    console.log('[' + new Date().toISOString() + '] Download link email sent:', info.response);
    
    return true;
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Error sending download link email:', error.message);
    // Don't throw the error, just log it and return false
    return false;
  }
}

// Start the server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Stripe checkout server is running on port ${PORT}`);
});