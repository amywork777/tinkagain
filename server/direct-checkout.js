const express = require('express');
const cors = require('cors');
const { Stripe } = require('stripe');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Use a different port to avoid conflicts with other servers
const PORT = 4321;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = new Stripe(stripeSecretKey);

// Initialize Express
const app = express();

// Configure middleware
app.use(cors({
  origin: '*', // Allow all origins for testing
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Checkout server is running', timestamp: new Date().toISOString() });
});

// Simple checkout endpoint
app.post('/checkout', async (req, res) => {
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

    // Create a Stripe product for this order
    console.log(`[${new Date().toISOString()}] Creating Stripe product for 3D print order...`);
    
    const product = await stripe.products.create({
      name: `${modelName} (${color}, Qty: ${quantity})`,
      description: `3D Print: ${modelName} in ${color} - Test Product`,
      metadata: {
        modelName,
        color,
        quantity: quantity.toString(),
        orderType: '3d_print'
      }
    });
    console.log(`[${new Date().toISOString()}] Stripe product created: ID=${product.id}, Name=${product.name}`);
    
    // Create a price for the product
    console.log(`[${new Date().toISOString()}] Creating Stripe price...`);
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(finalPrice * 100), // Convert dollars to cents
      currency: 'usd',
    });
    console.log(`[${new Date().toISOString()}] Stripe price created: ID=${price.id}, Amount=${price.unit_amount/100} USD`);
    
    // Determine the host for redirect URLs
    const host = req.headers.origin || `http://localhost:3000`;
    console.log(`[${new Date().toISOString()}] Using host for redirect: ${host}`);
    
    // Create the Stripe checkout session
    console.log(`[${new Date().toISOString()}] Creating Stripe checkout session...`);
    
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
        stlFileName: stlFileName
      },
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'],
      },
    });
    
    console.log(`[${new Date().toISOString()}] Stripe checkout session created: ID=${session.id}, URL=${session.url}`);

    // Return success response with URL
    return res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Checkout error:`, error);
    return res.status(500).json({
      success: false,
      message: `Error: ${error.message}`,
      error: {
        type: error.type || 'unknown_type',
        code: error.code || 'unknown_code',
        message: error.message || 'Unknown error'
      }
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Direct checkout server running on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Test with: curl -X POST -H "Content-Type: application/json" -d '{"modelName":"Test Model","color":"Red","quantity":1,"finalPrice":30.00}' http://localhost:${PORT}/checkout`);
  console.log(`[${new Date().toISOString()}] Using Stripe Secret Key: ${stripeSecretKey ? '✓ Configured' : '✗ Missing'}`);
}); 