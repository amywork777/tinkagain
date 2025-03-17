// Simple checkout server focused on 3D printing checkout
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize the server
const app = express();
const PORT = process.env.API_PORT || 4002;

// Use middleware
app.use(cors({
  origin: '*', // Allow all origins for testing
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
}));

// Important: For Stripe webhooks, we need the raw body for signature verification
// Use the raw body parser only for the webhook endpoint
app.use('/api/webhook', express.raw({ type: 'application/json' }));

// Use the JSON parser for all other routes
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Checkout server is running' });
});

// Simple debug endpoint to test connectivity
app.post('/api/debug-checkout', (req, res) => {
  console.log('Debug checkout endpoint hit with body:', req.body);
  res.json({ 
    success: true, 
    message: 'Debug checkout endpoint working',
    body: req.body
  });
});

// Webhook handling for Stripe events
app.post('/api/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  if (!sig) {
    console.error('Missing stripe-signature header');
    return res.status(400).json({ success: false, message: 'Missing signature header' });
  }
  
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET environment variable');
    return res.status(500).json({ success: false, message: 'Webhook secret not configured' });
  }
  
  try {
    // For verification, we need the raw request body as a string or buffer
    // Express.raw middleware ensures req.body is a Buffer
    console.log(`Received webhook with signature: ${sig.substring(0, 20)}...`);
    console.log(`Raw body size: ${req.body.length} bytes`);
    
    // Verify the event came from Stripe
    const event = stripe.webhooks.constructEvent(
      req.body,  // This is the raw request body (Buffer)
      sig,
      webhookSecret
    );
    
    console.log(`✅ Webhook signature verified for event: ${event.type}, id: ${event.id}`);
    
    // Handle the event based on its type
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log(`Payment successful for session: ${session.id}`);
        
        // Here you would typically update your database, send confirmation emails, etc.
        console.log(`Processing order metadata:`, session.metadata);
        
        break;
      }
      // Add more cases for other events you want to handle
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error(`⚠️ Webhook Error:`, err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

// Main checkout endpoint
app.post(['/api/checkout', '/api/create-checkout-session', '/api/print/create-checkout-session'], async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] Received checkout request:`, {
      type: req.body.type || 'unknown',
      is3DPrint: req.body.is3DPrint,
      modelName: req.body.modelName,
      color: req.body.color,
      quantity: req.body.quantity,
      price: req.body.finalPrice,
      hasStlFileData: !!req.body.stlFileData,
      stlFileName: req.body.stlFileName
    });

    if (!req.body.modelName || !req.body.color || !req.body.quantity || !req.body.finalPrice) {
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
    const finalPrice = req.body.finalPrice;
    const stlFileName = req.body.stlFileName || 'unknown.stl';
    const stlFileData = req.body.stlFileData;

    console.log(`[${new Date().toISOString()}] Creating Stripe product for 3D print order: ${modelName} in ${color} (Qty: ${quantity})`);
    
    // Create a Stripe product for this order
    const product = await stripe.products.create({
      name: `${modelName} (${color}, Qty: ${quantity})`,
      description: `3D Print: ${modelName} in ${color}`,
      metadata: {
        modelName,
        color,
        quantity: quantity.toString(),
        orderType: '3d_print'
      }
    });
    console.log(`[${new Date().toISOString()}] Stripe product created: ID=${product.id}, Name=${product.name}`);
    
    // Create a price for the product
    console.log(`[${new Date().toISOString()}] Creating Stripe price with amount: ${Math.round(finalPrice * 100)} cents`);
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(finalPrice * 100), // Convert dollars to cents
      currency: 'usd',
    });
    console.log(`[${new Date().toISOString()}] Stripe price created: ID=${price.id}, Amount=${price.unit_amount/100} USD`);
    
    // Determine the host for redirect URLs
    const host = req.headers.origin || `http://localhost:5173`;
    console.log(`[${new Date().toISOString()}] Using host for redirect: ${host}`);

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: price.id,
          quantity: 1,
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
        stlFileName,
        orderType: '3d_print',
        stlFileIncluded: stlFileData ? 'true' : 'false'
      },
      // Enable billing address collection
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'], // Add the countries you ship to
      },
    });
    
    console.log(`[${new Date().toISOString()}] Stripe checkout session created: ID=${session.id}`);
    
    // Return the session URL to the client
    res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in checkout:`, error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during checkout',
      error: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Simple checkout server running at http://localhost:${PORT}`);
  console.log(`[${new Date().toISOString()}] Using Stripe key: ${process.env.STRIPE_SECRET_KEY ? 'Valid key present' : 'MISSING KEY'}`);
  console.log(`[${new Date().toISOString()}] Webhook secret: ${process.env.STRIPE_WEBHOOK_SECRET ? 'Valid secret present' : 'MISSING SECRET'}`);
}); 