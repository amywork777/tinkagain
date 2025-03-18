import { VercelRequest, VercelResponse } from '@vercel/node';
import { Stripe } from 'stripe';

// Helper function to create a response
const createResponse = (res: VercelResponse, statusCode: number, data: any) => {
  return res.status(statusCode).json(data);
};

// API route handler
// For Vercel API routes
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb' // Default limit is fine for Stripe checkout
    }
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Stripe checkout request received`);
  
  // Set CORS headers for preflight requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Checkout-Type, X-Client-Timestamp');
  
  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle non-POST requests
  if (req.method !== 'POST') {
    return createResponse(res, 405, {
      success: false,
      error: 'Method not allowed. Use POST.'
    });
  }
  
  try {
    // Validate request
    if (!req.body || !req.body.finalPrice) {
      return createResponse(res, 400, {
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
    
    // Initialize Stripe with the secret key
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });
    
    // Convert price to cents if it's not already
    const priceCents = Math.round(parseFloat(finalPrice) * 100);
    
    // Create a product first
    const product = await stripe.products.create({
      name: `3D Print: ${modelName}`,
      description: `Color: ${color}, Material: ${material}, Quantity: ${quantity}, Infill: ${infillPercentage}%`,
    });
    
    console.log(`[${new Date().toISOString()}] Stripe product created: ${product.id}`);
    
    // Create a price for the product
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
    return createResponse(res, 200, {
      success: true,
      url: session.url,
      sessionId: session.id
    });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Stripe checkout error:`, error);
    return createResponse(res, 500, {
      success: false,
      error: error.message || 'Checkout failed'
    });
  }
}