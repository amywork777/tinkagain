import { VercelRequest, VercelResponse } from '@vercel/node';
import { Stripe } from 'stripe';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as firebaseStorage from '../firebase/firebaseStorage';

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
      let stlDownloadUrl = '';
      let stlStoragePath = '';
      let stlFileUploaded = false;
      
      // Upload STL file to Firebase if provided
      if (stlFileData && stlFileName) {
        try {
          // Create a unique ID for the file
          const uniqueId = uuidv4();
          
          // Create date-based folder structure
          const now = new Date();
          const year = now.getFullYear().toString();
          const month = (now.getMonth() + 1).toString().padStart(2, '0');
          const day = now.getDate().toString().padStart(2, '0');
          
          // Create the file path in Firebase Storage
          const timestamp = now.getTime();
          const safeFileName = stlFileName.replace(/[^a-zA-Z0-9.-]/g, '_');
          stlStoragePath = `stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${safeFileName}`;
          
          // Process the STL data
          let fileBuffer: Buffer;
          if (stlFileData.startsWith('data:')) {
            const base64Data = stlFileData.split(',')[1];
            fileBuffer = Buffer.from(base64Data, 'base64');
          } else {
            fileBuffer = Buffer.from(stlFileData, 'base64');
          }
          
          // Upload to Firebase Storage
          const file = firebaseStorage.file(stlStoragePath);
          await file.save(fileBuffer, {
            metadata: {
              contentType: 'model/stl',
              metadata: {
                originalName: safeFileName,
                uploadTime: new Date().toISOString()
              }
            }
          });
          
          // Verify the file exists
          const [exists] = await file.exists();
          if (!exists) {
            throw new Error('File failed to upload to Firebase');
          }
          
          // Get a signed URL with long expiration
          const [signedUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 315360000000, // 10 years in milliseconds
          });
          
          if (!signedUrl) {
            throw new Error('Failed to generate signed URL');
          }
          
          stlDownloadUrl = signedUrl;
          stlFileUploaded = true;
          
          console.log('Successfully uploaded STL file to Firebase:', {
            path: stlStoragePath,
            downloadUrl: stlDownloadUrl.substring(0, 50) + '...'
          });
        } catch (error) {
          console.error('Error uploading STL file to Firebase:', error);
          // Continue with checkout even if file upload fails
        }
      }
      
      // Create a product in Stripe for this 3D print
      console.log('Creating Stripe product for 3D print...');
      const productDescription = `3D Print in ${color} (Qty: ${quantity})\n\n` +
        (stlDownloadUrl ? `Your STL file will be available at:\n${stlDownloadUrl}\n\n` +
                         `Please save this URL - it's valid for 10 years.` : '');
      
      const product = await stripe.products.create({
        name: `3D Print: ${modelName}${stlDownloadUrl ? ' (Includes STL File)' : ''}`,
        description: productDescription,
        metadata: {
          modelName,
          color,
          quantity: quantity.toString(),
          printType: '3d_print',
          stlFileName: stlFileName || '',
          stlFilePath: stlStoragePath || '',
          hasStlFile: stlDownloadUrl ? 'true' : 'false',
          stlDownloadUrl: stlDownloadUrl || ''
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
            quantity: 1,
            description: stlDownloadUrl ? 
              `Your STL file will be available at: ${stlDownloadUrl}\n\nThis URL is valid for 10 years - please save it.` : 
              undefined
          },
        ],
        mode: 'payment',
        success_url: stlDownloadUrl 
          ? `${host}/checkout-confirmation?session_id={CHECKOUT_SESSION_ID}&stl_url=${encodeURIComponent(stlDownloadUrl)}`
          : `${host}/checkout-confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${host}/`,
        metadata: {
          modelName,
          color,
          quantity: quantity.toString(),
          finalPrice: finalPrice.toString(),
          stlFileName: stlFileName || '',
          stlDownloadUrl: stlDownloadUrl || '',
          stlFilePath: stlStoragePath || '',
          stlFileUploaded: stlFileUploaded.toString()
        },
        billing_address_collection: 'required',
        shipping_address_collection: {
          allowed_countries: ['US', 'CA', 'GB', 'AU'],
        },
        custom_text: stlDownloadUrl ? {
          submit: {
            message: `IMPORTANT: Your STL file URL is shown in the item description above. Please save it before completing your purchase.`
          }
        } : undefined,
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