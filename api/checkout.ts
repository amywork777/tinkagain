import { VercelRequest, VercelResponse } from '@vercel/node';
import { Stripe } from 'stripe';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Initialize Stripe - Fix for environment variable issue
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16' as any,
});

// Log the Stripe initialization to help with debugging
console.log(`Stripe initialized with key ${process.env.STRIPE_SECRET_KEY ? 'present' : 'MISSING'}`);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set appropriate CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
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

  try {
    console.log('Received checkout request with body:', req.body);
    
    // Check if this is a 3D print order
    const { 
      modelName, 
      color, 
      quantity, 
      finalPrice, 
      stlFileName, 
      stlFileData,
      type
    } = req.body;
    
    // Handle 3D print checkout
    if (type === '3d_print' || req.body.is3DPrint) {
      console.log('Handling 3D print checkout');
      
      if (!modelName || !color || !quantity || !finalPrice) {
        console.log('Missing required checkout information');
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required checkout information' 
        });
      }

      // Handle STL file data
      let stlStoragePath = '';
      let stlFileUploaded = false;
      
      // Create a product in Stripe for this 3D print
      console.log('Creating Stripe product for 3D print...');
      const product = await stripe.products.create({
        name: `3D Print: ${modelName}`,
        description: `3D Print in ${color} (Qty: ${quantity})`,
        metadata: {
          modelName,
          color,
          quantity: quantity.toString(),
          printType: '3d_print'
        }
      });
      
      console.log('Stripe product created:', product.id);
      
      // Create a price for the product
      console.log('Creating Stripe price...');
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(finalPrice * 100), // Convert dollars to cents
        currency: 'usd',
      });
      
      console.log('Stripe price created:', price.id);
      
      // Create the Stripe checkout session
      console.log('Creating Stripe checkout session...');
      
      // Determine the host for redirect URLs
      const host = req.headers.origin || '';
      
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
          stlFileName: stlFileName || 'unknown.stl',
          stlFileUploaded: stlFileUploaded.toString(),
          orderTempId: stlFileData ? `temp-${Date.now()}` : ''
        },
        // Enable billing address collection
        billing_address_collection: 'required',
        shipping_address_collection: {
          allowed_countries: ['US', 'CA', 'GB', 'AU'], // Add the countries you ship to
        },
      });
      
      console.log('Stripe checkout session created:', session.id);
      
      // Return the session URL and success status
      return res.json({
        success: true,
        sessionId: session.id,
        url: session.url
      });
    } else {
      // If not a 3D print checkout, possibly handle subscription checkout
      return res.status(400).json({ 
        success: false, 
        message: 'Unsupported checkout type' 
      });
    }
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to create checkout session',
      error: error.message
    });
  }
} 