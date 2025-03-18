// Simple checkout server focused on 3D printing checkout

// Check if we're running in production and load production config
if (process.env.NODE_ENV === 'production') {
  try {
    require('./production-config.js');
    console.log(`[${new Date().toISOString()}] Loaded production configuration`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Failed to load production configuration:`, err.message);
  }
}

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
  
  // In production, dynamically update BASE_URL if needed
  if (process.env.NODE_ENV === 'production' && req.headers.host) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const newBaseUrl = `${protocol}://${req.headers.host}`;
    
    // Only log if it's different
    if (process.env.BASE_URL !== newBaseUrl) {
      console.log(`[${new Date().toISOString()}] Updating BASE_URL to: ${newBaseUrl}`);
      process.env.BASE_URL = newBaseUrl;
    }
  }
  
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
const localStoragePath = path.join(process.cwd(), 'local-storage');
app.use('/local-storage', express.static(localStoragePath));
console.log(`[${new Date().toISOString()}] Local file storage route enabled at /local-storage for path: ${localStoragePath}`);

// Route for uploading files to Supabase
app.post('/api/upload-to-supabase', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Handling /api/upload-to-supabase request`);
  
  try {
    // Validate request
    if (!req.body || !req.body.fileName || !req.body.fileData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: fileName and fileData are required'
      });
    }
    
    // Extract information from request
    const { fileName, fileData, fileType = 'application/octet-stream' } = req.body;
    
    // Sanitize the file name
    const safeFileName = fileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    
    // Convert base64 data to buffer
    const fileBuffer = Buffer.from(fileData, 'base64');
    
    console.log(`[${new Date().toISOString()}] Processing file: ${safeFileName}, size: ${fileBuffer.length} bytes`);
    
    // Generate a unique storage path with date-based organization
    const timestamp = Date.now();
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const storagePath = `${year}/${month}/${day}/${timestamp}-${uniqueId}-${safeFileName}`;
    console.log(`[${new Date().toISOString()}] Supabase Storage path: ${storagePath}`);
    
    // Ensure bucket exists
    try {
      if (supabase) {
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = buckets.some(bucket => bucket.name === 'stl-files');
        
        if (!bucketExists) {
          console.log(`[${new Date().toISOString()}] Creating bucket: stl-files`);
          await supabase.storage.createBucket('stl-files', {
            public: false,
            fileSizeLimit: 52428800, // 50MB limit
          });
        }
      }
    } catch (bucketError) {
      console.error(`[${new Date().toISOString()}] Bucket check/create error:`, bucketError);
      // Continue anyway, the bucket might exist
    }
    
    // Upload file to Supabase Storage using the existing uploadToSupabase function
    if (supabase) {
      console.log(`[${new Date().toISOString()}] Uploading to Supabase...`);
      const { data, error } = await uploadToSupabase(storagePath, fileBuffer);
      
      if (error) {
        console.error(`[${new Date().toISOString()}] Supabase upload error:`, error);
        throw new Error(`Supabase upload failed: ${error.message}`);
      }
      
      console.log(`[${new Date().toISOString()}] File uploaded successfully to Supabase`);
      
      // Create a signed URL with long expiry
      const { data: signedUrlData, error: signedUrlError } = await getSupabaseSignedUrl(storagePath);
      
      if (signedUrlError) {
        console.error(`[${new Date().toISOString()}] Signed URL error:`, signedUrlError);
        // Continue anyway, we'll use the public URL as fallback
      }
      
      // Get public URL as backup
      const { data: publicUrlData } = supabase.storage
        .from('stl-files')
        .getPublicUrl(storagePath);
      
      // Return success response with URLs and path
      return res.status(200).json({
        success: true,
        url: signedUrlData?.signedUrl || publicUrlData?.publicUrl || null,
        publicUrl: publicUrlData?.publicUrl || null,
        path: storagePath,
        fileName: safeFileName,
        fileSize: fileBuffer.length
      });
    } else {
      // If Supabase is not available, upload to local storage as fallback
      const localFilePath = path.join(localStoragePath, safeFileName);
      fs.writeFileSync(localFilePath, fileBuffer);
      
      const localUrl = `/local-storage/${safeFileName}`;
      return res.status(200).json({
        success: true,
        url: localUrl,
        publicUrl: localUrl,
        path: localUrl,
        fileName: safeFileName,
        fileSize: fileBuffer.length,
        note: "Using local storage (Supabase unavailable)"
      });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Upload error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'File upload failed'
    });
  }
});

// Route for Stripe checkout (without file upload)
app.post('/api/stripe-checkout', async (req, res) => {
  console.log(`[${new Date().toISOString()}] Stripe checkout request received`);
  
  try {
    // Validate request
    if (!req.body || !req.body.finalPrice) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: finalPrice is required'
      });
    }
    
    // Extract information from request
    const {
      modelName = 'Custom 3D Print',
      color = 'Default',
      quantity = 1,
      finalPrice,
      material = 'PLA',
      infillPercentage = 20
    } = req.body;
    
    console.log(`[${new Date().toISOString()}] Processing checkout for ${modelName}, price: $${finalPrice}, color: ${color}, material: ${material}`);
    
    // Convert price to cents if it's not already
    const priceCents = Math.round(parseFloat(finalPrice) * 100);
    
    // Create a product first, then create a price for it
    const product = await stripe.products.create({
      name: `3D Print: ${modelName}`,
      description: `Color: ${color}, Material: ${material}, Quantity: ${quantity}, Infill: ${infillPercentage}%`,
    });
    
    console.log(`[${new Date().toISOString()}] Stripe product created: ${product.id}`);
    
    // Create a price for this product
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: priceCents,
      product: product.id,
    });
    
    console.log(`[${new Date().toISOString()}] Stripe price created: ${price.id}`);
    
    // Determine the host for redirect URLs
    const host = req.headers.origin || 'http://localhost:3000';
    
    // Create the Stripe checkout session
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
        material,
        infillPercentage: infillPercentage.toString(),
        orderType: '3d_print'
      },
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'],
      },
    });
    
    console.log(`[${new Date().toISOString()}] Stripe session created: ${session.id}`);
    
    // Return the checkout URL
    return res.status(200).json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Stripe checkout error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Checkout failed'
    });
  }
});

// In production, create the local-storage directory if it doesn't exist
if (process.env.NODE_ENV === 'production') {
  // Ensure local-storage directories exist for fallback
  const stlFilesPath = path.join(localStoragePath, 'stl-files');
  const modelsPath = path.join(localStoragePath, 'models');
  
  try {
    if (!fs.existsSync(localStoragePath)) {
      console.log(`[${new Date().toISOString()}] Creating local-storage directory in production`);
      fs.mkdirSync(localStoragePath, { recursive: true });
    }
    
    if (!fs.existsSync(stlFilesPath)) {
      console.log(`[${new Date().toISOString()}] Creating stl-files directory in production`);
      fs.mkdirSync(stlFilesPath, { recursive: true });
    }
    
    if (!fs.existsSync(modelsPath)) {
      console.log(`[${new Date().toISOString()}] Creating models directory in production`);
      fs.mkdirSync(modelsPath, { recursive: true });
    }
    
    // Check if directories are writable
    const testFile = path.join(localStoragePath, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log(`[${new Date().toISOString()}] Confirmed local-storage directory is writable in production`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error setting up local-storage in production:`, err.message);
    console.error(`[${new Date().toISOString()}] This may affect fallback functionality`);
  }
}

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

// Add a helper function for creating consistent file URLs across environments
function createFileUrl(relativePath, isLocal = false) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:4002';
  const url = `${baseUrl}/${isLocal ? 'local-storage/' : ''}${relativePath}`;
  
  // Log the created URL for debugging
  if (process.env.NODE_ENV === 'production') {
    console.log(`[${new Date().toISOString()}] Created file URL in production: ${url} (from ${relativePath})`);
  }
  
  return url;
}

// Function to store an STL file and return its URL
async function storeSTLFile(stlData, originalFileName) {
  console.log('[' + new Date().toISOString() + '] Starting STL file storage process');
  
  try {
    // Sanitize the filename (remove spaces, special characters)
    const sanitizedFileName = originalFileName.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
    console.log('[' + new Date().toISOString() + '] Sanitized filename from "' + originalFileName + '" to "' + sanitizedFileName + '"');
    
    // Check type of stlData
    console.log('[' + new Date().toISOString() + '] STL data type:', typeof stlData);
    console.log('[' + new Date().toISOString() + '] STL data length:', stlData.length);
    
    // Determine if the data is base64 or a data URL
    let stlBuffer;
    let isBinary = false;
    
    if (stlData.startsWith('data:')) {
      console.log('[' + new Date().toISOString() + '] STL data appears to be a data URL, extracting...');
      // Extract the base64 data from the data URL
      const base64Data = stlData.split(',')[1];
      stlBuffer = Buffer.from(base64Data, 'base64');
    } else if (/^[A-Za-z0-9+/=]+$/.test(stlData)) {
      console.log('[' + new Date().toISOString() + '] STL data appears to be base64 encoded');
      stlBuffer = Buffer.from(stlData, 'base64');
    } else {
      console.log('[' + new Date().toISOString() + '] STL data does not appear to be base64 encoded, treating as raw data');
      stlBuffer = Buffer.from(stlData);
    }
    
    console.log('[' + new Date().toISOString() + '] Decoded STL buffer size:', stlBuffer.length);
    
    // Check if the STL is in binary format (binary STL starts with "solid" if it's ASCII)
    const headerStr = stlBuffer.toString('utf8', 0, 5).toLowerCase();
    if (headerStr !== 'solid') {
      console.log('[' + new Date().toISOString() + '] STL appears to be binary format');
      isBinary = true;
    } else {
      console.log('[' + new Date().toISOString() + '] STL appears to be ASCII format');
    }
    
    // Generate a unique filename with date structure YYYY/MM/DD
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const timestamp = now.getTime();
    const uuid = require('crypto').randomUUID();
    
    // Create file path with date-based directory structure
    const fileDir = `models/${year}/${month}/${day}`;
    const filename = `${timestamp}-${uuid}-${sanitizedFileName}`;
    const filePath = `${fileDir}/${filename}`;
    
    console.log('[' + new Date().toISOString() + '] Supabase storage path:', filePath);
    
    // Attempt to store in Supabase if available
    if (supabase && process.env.NODE_ENV === 'production') {
      // Always prioritize Supabase in production
      console.log('[' + new Date().toISOString() + '] Prioritizing Supabase storage in production mode');
      
      try {
        const { data, error } = await uploadToSupabase(filePath, stlBuffer);
        
        if (error) {
          console.error('[' + new Date().toISOString() + '] Error uploading to Supabase:', error.message);
          
          // In production, try one more time
          if (process.env.NODE_ENV === 'production') {
            console.log('[' + new Date().toISOString() + '] Retrying Supabase upload in production...');
            const retryResult = await uploadToSupabase(filePath, stlBuffer);
            
            if (retryResult.error) {
              console.error('[' + new Date().toISOString() + '] Retry also failed:', retryResult.error.message);
              throw new Error('Failed to upload STL file to Supabase storage: ' + retryResult.error.message);
            }
            
            // Successful retry
            const signedUrl = await getSupabaseSignedUrl(filePath);
            console.log('[' + new Date().toISOString() + '] Retry successful, generated signed URL');
            
            return {
              url: signedUrl,
              path: filePath,
              fileName: sanitizedFileName,
              storedAt: 'supabase',
              fileSize: stlBuffer.length,
              isBinary
            };
          }
          
          // Fall back to local storage
          console.log('[' + new Date().toISOString() + '] Falling back to local storage');
          return await storeLocally(fileDir, filename, stlBuffer, sanitizedFileName, isBinary);
        }
        
        // Get a signed URL
        const signedUrl = await getSupabaseSignedUrl(filePath);
        console.log('[' + new Date().toISOString() + '] Generated signed URL (first 100 chars):', signedUrl.substring(0, 100) + '...');
        
        console.log('[' + new Date().toISOString() + '] STL file stored successfully in Supabase storage:', filePath);
        
        return {
          url: signedUrl,
          path: filePath,
          fileName: sanitizedFileName,
          storedAt: 'supabase',
          fileSize: stlBuffer.length,
          isBinary
        };
      } catch (supabaseError) {
        console.error('[' + new Date().toISOString() + '] Error in Supabase storage:', supabaseError.message);
        
        // In production, we should try to upload to local storage as a last resort
        if (process.env.NODE_ENV === 'production') {
          console.log('[' + new Date().toISOString() + '] Attempting local storage as final fallback in production');
          return await storeLocally(fileDir, filename, stlBuffer, sanitizedFileName, isBinary);
        }
        
        throw new Error('Failed to upload STL file to storage: ' + supabaseError.message);
      }
    } else if (supabase && process.env.NODE_ENV === 'development' && process.env.PRIORITIZE_SUPABASE === 'true') {
      // In development, use Supabase if explicitly prioritized
      console.log('[' + new Date().toISOString() + '] Prioritizing Supabase storage even in development mode');
      
      try {
        console.log('[' + new Date().toISOString() + '] Uploading STL file to Supabase storage...');
        console.log('[' + new Date().toISOString() + '] Attempting Supabase upload to bucket:', 'stl-files');
        console.log('[' + new Date().toISOString() + '] File path:', filePath);
        
        const { data, error } = await uploadToSupabase(filePath, stlBuffer);
        
        if (error) {
          console.error('[' + new Date().toISOString() + '] Error uploading to Supabase:', error.message);
          // Fall back to local storage in development
          console.log('[' + new Date().toISOString() + '] Falling back to local storage');
          return await storeLocally(fileDir, filename, stlBuffer, sanitizedFileName, isBinary);
        }
        
        console.log('[' + new Date().toISOString() + '] STL file uploaded successfully to Supabase storage:', filePath);
        
        // Get a signed URL
        console.log('[' + new Date().toISOString() + '] Creating signed URL for file:', filePath);
        const signedUrl = await getSupabaseSignedUrl(filePath);
        console.log('[' + new Date().toISOString() + '] Generated signed URL (first 100 chars):', signedUrl.substring(0, 100) + '...');
        
        console.log('[' + new Date().toISOString() + '] STL file stored successfully:', filePath);
        
        return {
          url: signedUrl,
          path: filePath,
          fileName: sanitizedFileName,
          storedAt: 'supabase',
          fileSize: stlBuffer.length,
          isBinary
        };
      } catch (supabaseError) {
        console.error('[' + new Date().toISOString() + '] Supabase storage error:', supabaseError.message);
        // Fall back to local storage in development
        console.log('[' + new Date().toISOString() + '] Falling back to local storage after Supabase error');
        return await storeLocally(fileDir, filename, stlBuffer, sanitizedFileName, isBinary);
      }
    } else {
      // Default to local storage for development
      console.log('[' + new Date().toISOString() + '] Using local file storage for development mode');
      return await storeLocally(fileDir, filename, stlBuffer, sanitizedFileName, isBinary);
    }
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Error in storeSTLFile:', error.message);
    throw new Error('Failed to upload STL file to storage: ' + error.message);
  }
}

// Helper function to upload file to Supabase
async function uploadToSupabase(filePath, buffer) {
  if (!supabase) {
    return { data: null, error: new Error('Supabase client not initialized') };
  }
  
  try {
    return await supabase
      .storage
      .from('stl-files')
      .upload(filePath, buffer, {
        contentType: 'application/octet-stream',
        cacheControl: '3600',
        upsert: true
      });
  } catch (error) {
    return { data: null, error };
  }
}

// Helper function to get a signed URL from Supabase
async function getSupabaseSignedUrl(filePath) {
  if (!supabase) {
    console.log('[' + new Date().toISOString() + '] getSupabaseSignedUrl: Supabase client not initialized');
    return { data: { signedUrl: null }, error: new Error('Supabase client not initialized') };
  }

  try {
    console.log('[' + new Date().toISOString() + '] Getting signed URL for:', filePath);
    
    // Generate a signed URL with a long expiry (7 days)
    const { data, error } = await supabase.storage
      .from('stl-files')
      .createSignedUrl(filePath, 604800); // 7 days in seconds
    
    if (error) {
      console.error('[' + new Date().toISOString() + '] Error creating signed URL:', error.message);
      return { data: { signedUrl: null }, error };
    }
    
    if (!data || !data.signedUrl) {
      console.warn('[' + new Date().toISOString() + '] No signed URL returned from Supabase');
      // Return a fallback with public URL instead
      const { data: publicUrlData } = supabase.storage
        .from('stl-files')
        .getPublicUrl(filePath);
      
      return { 
        data: { signedUrl: publicUrlData?.publicUrl || null },
        error: null
      };
    }
    
    console.log('[' + new Date().toISOString() + '] Signed URL created successfully');
    return { data, error: null };
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Exception in getSupabaseSignedUrl:', error.message);
    return { data: { signedUrl: null }, error };
  }
}

// Helper function to store file locally
async function storeLocally(fileDir, filename, buffer, sanitizedFileName, isBinary) {
  try {
    // For local storage, create the file structure in a local-storage directory
    const localDirPath = path.join(process.cwd(), 'local-storage', 'stl-files', fileDir);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(localDirPath)) {
      fs.mkdirSync(localDirPath, { recursive: true });
    }
    
    // Save the file locally
    const localFilePath = path.join(localDirPath, filename);
    fs.writeFileSync(localFilePath, buffer);
    
    console.log('[' + new Date().toISOString() + '] Saved STL file locally to:', localFilePath);
    
    // Determine the base URL for local storage
    const baseUrl = process.env.BASE_URL || 'http://localhost:4002';
    const fileUrl = `${baseUrl}/local-storage/stl-files/${fileDir}/${filename}`;
    
    console.log('[' + new Date().toISOString() + '] Created local file URL:', fileUrl);
    
    return {
      url: fileUrl,
      path: `local-storage/${fileDir}/${filename}`,
      fileName: sanitizedFileName,
      storedAt: 'local',
      fileSize: buffer.length,
      isBinary
    };
  } catch (localError) {
    console.error('[' + new Date().toISOString() + '] Error storing file locally:', localError.message);
    throw new Error('Failed to store file locally: ' + localError.message);
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
    
    // STEP 1: Store STL file FIRST, before creating checkout session
    console.log('[' + new Date().toISOString() + '] Uploading STL file to storage...');
    
    try {
      // Upload the STL file
      stlFile = await storeSTLFile(stlBase64, stlFileName);
      console.log('[' + new Date().toISOString() + '] STL file stored successfully:', stlFile.path);
      console.log('[' + new Date().toISOString() + '] Download URL generated (first 100 chars):', stlFile.url.substring(0, 100) + '...');
      
      // Save model data regardless of Stripe success
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
      
      // STEP 2: Store model in database and get modelId
      let modelId;
      
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
          
          console.log('[' + new Date().toISOString() + '] Attempting to save model info to Supabase');
          
          // Save to models table in Supabase
          const { data, error } = await supabase
            .from('models')
            .insert(modelInfo)
            .select();
            
          if (error) {
            console.error('[' + new Date().toISOString() + '] Error saving model to Supabase:', error.message);
            
            // Use local storage as fallback
            modelId = saveFallbackModelData(modelInfo);
          } else if (!data || data.length === 0) {
            console.error('[' + new Date().toISOString() + '] No data returned from Supabase insert, but no error reported');
            
            // Use local storage as fallback
            modelId = saveFallbackModelData(modelInfo);
          } else {
            console.log('[' + new Date().toISOString() + '] Saved model info with ID:', data[0]?.id);
            modelId = data[0]?.id;
          }
        } catch (dbError) {
          console.error('[' + new Date().toISOString() + '] Error saving model to database:', dbError.message);
          
          // Use local storage as fallback
          modelId = saveFallbackModelData({
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
          });
        }
      } else {
        console.warn('[' + new Date().toISOString() + '] Supabase client not initialized, using fallback storage');
        
        // Use local storage as fallback
        modelId = saveFallbackModelData({
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
        });
      }
      
      // Add the modelId to modelData
      if (modelId) {
        modelData.modelId = modelId;
      }
      
      // STEP 3: Send email with download link immediately after successful upload
      // This ensures the customer gets the link regardless of Stripe success
      if (email && stlFile && stlFile.url) {
        console.log('[' + new Date().toISOString() + '] Sending immediate download link email to:', email);
        
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
      }
      
      // Send notification to admin email
      if (process.env.ADMIN_EMAIL) {
        console.log('[' + new Date().toISOString() + '] Sending admin notification email');
        
        await sendAdminNotificationEmail(
          modelName,
          stlFile.url,
          stlFileName,
          dimensions,
          material,
          `${infillPercentage}%`,
          priceCents,
          email
        );
      }
      
      // STEP 4: Create Stripe checkout session
      try {
        // Prepare metadata for Stripe (keep it minimal to avoid size issues)
        const metadata = {
          modelId: modelData.modelId || '',
          modelName,
          fileName: stlFileName,
          material,
          infill: `${infillPercentage}%`,
          email: email || ''
        };
        
        // Don't include the full URL in metadata, it's too long
        // Just include a shortened reference that we can use to look up the file
        
        const productDescription = `3D Print of ${modelName}${dimensions ? `\nDimensions: ${dimensions}` : ''}
Material: ${material}
Infill: ${infillPercentage}%`;
        
        console.log('[' + new Date().toISOString() + '] Creating Stripe checkout session with price in cents:', priceCents);
        
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
                  modelId: modelData.modelId || ''
                }
              },
              unit_amount: priceCents,
            },
            quantity: 1,
          }],
          mode: 'payment',
          success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/thank-you`,
          cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout/cancel`,
          metadata: metadata
        });
        
        checkoutSession = session;
        console.log('[' + new Date().toISOString() + '] Stripe checkout session created successfully. Session ID:', session.id);
        
        // Send successful response with both Stripe session and STL info
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
        // The customer already has the email with the download link
        res.status(200).json({ 
          success: true,
          error: 'Failed to create checkout session, but STL file was stored successfully and emailed to you.',
          stlInfo: {
            url: stlFile.url,
            fileName: stlFile.fileName,
            downloadUrl: stlFile.url,
            modelId: modelData.modelId || ''
          }
        });
      }
    } catch (uploadError) {
      console.error('[' + new Date().toISOString() + '] Error storing STL file:', uploadError.message);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to upload STL file: ' + uploadError.message 
      });
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

// Helper function to save model data to local storage as fallback
function saveFallbackModelData(modelInfo) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[' + new Date().toISOString() + '] No fallback storage available in production');
    return null;
  }
  
  try {
    const localModelsDirPath = path.join(process.cwd(), 'local-storage', 'models');
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(localModelsDirPath)) {
      fs.mkdirSync(localModelsDirPath, { recursive: true });
    }
    
    // Generate a UUID for the model
    const modelId = require('crypto').randomUUID();
    const fullModelInfo = {
      ...modelInfo,
      id: modelId
    };
    
    // Save to a JSON file
    const localModelPath = path.join(localModelsDirPath, `${modelId}.json`);
    fs.writeFileSync(localModelPath, JSON.stringify(fullModelInfo, null, 2));
    
    console.log('[' + new Date().toISOString() + '] Saved model info to local storage with ID:', modelId);
    
    return modelId;
  } catch (localStorageError) {
    console.error('[' + new Date().toISOString() + '] Error saving model to local storage:', localStorageError.message);
    return null;
  }
}

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

// Add a helper function to send admin notification for orders
async function sendAdminNotificationEmail(modelName, downloadUrl, fileName, dimensions, material, infill, price, customerEmail, orderTime = new Date()) {
  if (!process.env.ADMIN_EMAIL) {
    console.log('[' + new Date().toISOString() + '] No admin email configured for notifications');
    return false;
  }
  
  console.log('[' + new Date().toISOString() + '] Preparing to send admin notification email to:', process.env.ADMIN_EMAIL);
  
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
    
    // Format the email body
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <h2 style="color: #4a5568; margin-bottom: 20px;">🚨 New STL File Order Received</h2>
        
        <p>A new 3D printing order has been received. Here are the details:</p>
        
        <div style="margin: 20px 0; padding: 15px; background-color: #f7fafc; border-radius: 5px;">
          <h3 style="color: #4a5568; margin-top: 0;">Order Details:</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; width: 40%;"><strong>Customer Email:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${customerEmail || 'Not provided'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Order Time:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${orderTime.toISOString()}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Model Name:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${modelName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>File Name:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${fileName}</td>
            </tr>
            ${dimensions ? `
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
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Price:</strong></td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">$${(parseInt(price)/100).toFixed(2)}</td>
            </tr>
          </table>
        </div>
        
        <div style="margin: 25px 0; text-align: center;">
          <a href="${downloadUrl}" style="background-color: #4a5568; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Download Customer's STL File</a>
        </div>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 0.9em; color: #718096;">
          <p>This is an automated notification from your Taiyaki 3D Printing service.</p>
        </div>
      </div>
    `;
    
    // Get admin email - either from env or use the BCC email as fallback
    const adminEmail = process.env.ADMIN_EMAIL || process.env.BCC_EMAIL || 'taiyaki.orders@gmail.com';
    
    // Set up email options
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: adminEmail,
      subject: `🚨 New 3D Print Order: ${modelName} from ${customerEmail || 'Guest'}`,
      html: emailBody
    };
    
    // Send the email
    console.log('[' + new Date().toISOString() + '] Sending admin notification email...');
    const info = await emailTransporter.sendMail(mailOptions);
    console.log('[' + new Date().toISOString() + '] Admin notification email sent:', info.response);
    
    return true;
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Error sending admin notification email:', error.message);
    return false;
  }
}

// Add a debugging endpoint for environment variables (safe version)
app.get('/api/debug-environment', (req, res) => {
  const envSummary = {
    nodeEnv: process.env.NODE_ENV || 'not set',
    baseUrl: process.env.BASE_URL || 'not set',
    apiPort: process.env.API_PORT || 'not set',
    storageType: storageType || 'not configured',
    supabse: {
      hasBucket: process.env.SUPABASE_STORAGE_BUCKET ? true : false,
      bucketName: process.env.SUPABASE_STORAGE_BUCKET || 'not set',
      hasUrl: process.env.SUPABASE_URL ? true : false,
      hasKey: process.env.SUPABASE_SERVICE_KEY ? true : false,
    },
    stripe: {
      hasKey: process.env.STRIPE_SECRET_KEY ? true : false,
      testMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') || false,
      hasWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? true : false
    },
    serverTime: new Date().toISOString(),
    headers: {
      host: req.headers.host,
      protocol: req.headers['x-forwarded-proto'] || 'http',
      userAgent: req.headers['user-agent']
    }
  };
  
  res.json({
    success: true,
    environment: envSummary
  });
});

// Add a session details endpoint (optional, not part of main checkout flow)
app.get('/api/checkout/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Session ID required' });
    }
    
    // Get session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    // Return only safe information
    return res.json({
      success: true,
      status: session.status,
      customerEmail: session.customer_details?.email,
      amount: session.amount_total,
      currency: session.currency,
      downloadUrl: session.metadata?.stlUrl || session.metadata?.downloadLink,
      completedAt: session.status === 'complete' ? new Date().toISOString() : null
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error retrieving session:`, error.message);
    return res.status(400).json({ 
      success: false, 
      error: 'Could not retrieve session details',
      message: error.message
    });
  }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[${new Date().toISOString()}] Stripe checkout server is running on port ${PORT}`);
});