import { VercelRequest, VercelResponse } from '@vercel/node';
import { Stripe } from 'stripe';

// Initialize Stripe with better error handling
console.log(`[${new Date().toISOString()}] Vercel function initializing...`);
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
console.log(`[${new Date().toISOString()}] Stripe key type: ${STRIPE_KEY ? (STRIPE_KEY.startsWith('sk_test') ? 'TEST' : 'LIVE') : 'MISSING'}`);

// Create Stripe instance
let stripe: Stripe;
try {
  stripe = new Stripe(STRIPE_KEY, {
    apiVersion: '2023-10-16' as any,
  });
  console.log(`[${new Date().toISOString()}] Stripe instance created successfully`);
} catch (err) {
  console.error(`[${new Date().toISOString()}] Error creating Stripe instance:`, err);
  // We'll create a dummy object so the rest of the code doesn't crash
  // The actual API calls will be checked before using stripe
  stripe = {} as any;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Log the request to debug
  console.log(`[${new Date().toISOString()}] Request received: ${req.method}`);
  console.log(`[${new Date().toISOString()}] Headers exist: ${!!req.headers}`);
  
  try {
    // Set appropriate CORS headers with maximum safety
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    // Super safe check for headers and origin
    const origin = req.headers && req.headers.origin ? req.headers.origin.toString() : '*';
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }
    
    // Log detailed request info for debugging
    console.log('[' + new Date().toISOString() + '] POST /api/print/create-checkout-session called');
    console.log('[' + new Date().toISOString() + '] Request body:', req.body ? 'Exists' : 'Missing');
    
    // Ensure request body exists
    if (!req.body) {
      console.error('[' + new Date().toISOString() + '] Request body is missing');
      return res.status(400).json({ 
        success: false, 
        message: 'Missing request body' 
      });
    }
    
    // Get parameters from request body for 3D printing with safe fallbacks
    const { 
      modelName = 'Custom 3D Print', 
      color = 'Default', 
      quantity = 1, 
      finalPrice,
      material = 'PLA',
      infillPercentage = 20
    } = req.body;
    
    // Log extracted values
    console.log('[' + new Date().toISOString() + '] Extracted data:', {
      modelName: typeof modelName === 'string' ? modelName : 'Invalid (using default)',
      finalPrice: finalPrice ? 'Provided' : 'Missing'
    });
    
    if (!finalPrice) {
      console.error('[' + new Date().toISOString() + '] Missing required parameter: finalPrice');
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required checkout information: finalPrice is required' 
      });
    }
    
    // Validate Stripe is properly initialized
    if (!stripe || !STRIPE_KEY) {
      console.error('[' + new Date().toISOString() + '] Stripe is not properly initialized');
      return res.status(500).json({
        success: false,
        message: 'Payment processor is not available'
      });
    }

    // Create a product in Stripe for this 3D print
    console.log('[' + new Date().toISOString() + '] Creating Stripe product for 3D print...');
    const product = await stripe.products.create({
      name: `3D Print: ${modelName}`,
      description: `3D Print in ${color}, Material: ${material}, Infill: ${infillPercentage}% (Qty: ${quantity})`,
      metadata: {
        modelName,
        color,
        quantity: String(quantity),
        material,
        infillPercentage: String(infillPercentage),
        printType: '3d_print'
      }
    });
    
    console.log('[' + new Date().toISOString() + '] Stripe product created:', product.id);
    
    // Create a price for the product
    console.log('[' + new Date().toISOString() + '] Creating Stripe price...');
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(Number(finalPrice) * 100), // Convert dollars to cents
      currency: 'usd',
    });
    
    console.log('[' + new Date().toISOString() + '] Stripe price created:', price.id);
    
    // Determine the host for redirect URLs with maximum safety
    let host = '';
    
    // Log header existence for debugging
    console.log('[' + new Date().toISOString() + '] Headers available:', {
      headersExist: !!req.headers,
      originExists: !!(req.headers && req.headers.origin),
      hostExists: !!(req.headers && req.headers.host)
    });
    
    // Try multiple approaches to determine the host
    if (req.headers && req.headers.origin) {
      host = String(req.headers.origin);
      console.log('[' + new Date().toISOString() + '] Using origin header for host:', host);
    } else if (req.headers && req.headers.host) {
      const protocol = (req.headers['x-forwarded-proto'] || 'https').toString();
      host = `${protocol}://${String(req.headers.host)}`;
      console.log('[' + new Date().toISOString() + '] Constructed host from headers:', host);
    } else {
      // Default fallback for production
      host = 'https://3dcad.taiyaki.ai';
      console.log('[' + new Date().toISOString() + '] Using fallback host:', host);
    }
    
    // Create a checkout session
    console.log('[' + new Date().toISOString() + '] Creating Stripe checkout session...');
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
        quantity: String(quantity),
        finalPrice: String(finalPrice),
        material,
        infillPercentage: String(infillPercentage),
        orderType: '3d_print'
      },
      // Enable billing address collection
      billing_address_collection: 'required',
      shipping_address_collection: {
        allowed_countries: ['US', 'CA', 'GB', 'AU'], // Add the countries you ship to
      },
    });

    console.log('[' + new Date().toISOString() + '] Checkout session created:', session.id);
    console.log('[' + new Date().toISOString() + '] Checkout URL:', session.url);

    // Return the session ID and URL
    res.json({ 
      success: true,
      sessionId: session.id,
      url: session.url 
    });
  } catch (error: any) {
    console.error('[' + new Date().toISOString() + '] Error creating 3D print checkout session:', error);
    
    // Check for specific Stripe errors
    if (error.type === 'StripeAuthenticationError') {
      console.error('[' + new Date().toISOString() + '] Stripe authentication error - check your API key');
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create 3D print checkout session',
      error: error.message || 'Unknown error'
    });
  }
} 