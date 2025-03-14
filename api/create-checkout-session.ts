import { VercelRequest, VercelResponse } from '@vercel/node';
import { Stripe } from 'stripe';
import * as admin from 'firebase-admin';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Initialize Stripe with the secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16' as any,
});

// Initialize Firebase Admin SDK if not already initialized
let firebaseStorage: any;
try {
  if (!admin.apps.length) {
    // Try to load service account from environment variable
    const privateKey = process.env.FIREBASE_PRIVATE_KEY 
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
      : undefined;
    
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        privateKey: privateKey,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'taiyaki-test1.appspot.com'
    });
    
    console.log('Firebase Admin SDK initialized');
  }
  
  // Get the Firebase Storage bucket
  firebaseStorage = admin.storage().bucket();
  console.log('Firebase Storage initialized:', firebaseStorage.name);
} catch (error) {
  console.error('Error initializing Firebase:', error);
}

/**
 * Uploads an STL file to Firebase Storage
 * @param stlData Base64 encoded STL data
 * @param fileName Original file name
 * @returns Object with download URL and file path
 */
async function uploadSTLToFirebase(stlData: string, fileName: string): Promise<{ downloadUrl: string, filePath: string }> {
  if (!firebaseStorage) {
    throw new Error('Firebase Storage is not initialized');
  }
  
  console.log('Preparing to upload STL file to Firebase Storage');
  
  // Create safe filename and generate unique ID
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const uniqueId = uuidv4();
  
  // Create date-based folder structure for organization
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  
  // Create the file path in Firebase Storage
  const timestamp = now.getTime();
  const storagePath = `stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${safeFileName}`;
  
  // Process the STL data
  let fileBuffer: Buffer;
  if (stlData.startsWith('data:')) {
    // Extract the base64 part if it's a data URL
    const base64Data = stlData.split(',')[1];
    fileBuffer = Buffer.from(base64Data, 'base64');
  } else {
    // Assume it's already base64
    fileBuffer = Buffer.from(stlData, 'base64');
  }
  
  // Create a temporary file path
  const tempDir = path.join(os.tmpdir(), 'stl-uploads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const tempFilePath = path.join(tempDir, `${timestamp}-${uniqueId}-${safeFileName}`);
  
  // Write buffer to temporary file
  fs.writeFileSync(tempFilePath, fileBuffer);
  
  try {
    // Upload to Firebase Storage
    await firebaseStorage.upload(tempFilePath, {
      destination: storagePath,
      metadata: {
        contentType: 'model/stl',
        metadata: {
          originalName: safeFileName
        }
      }
    });
    
    console.log('STL file uploaded to Firebase Storage:', storagePath);
    
    // Get a signed URL with long expiration
    const [signedUrl] = await firebaseStorage.file(storagePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 315360000000, // 10 years in milliseconds
    });
    
    console.log('Generated signed URL for STL file');
    
    return {
      downloadUrl: signedUrl,
      filePath: storagePath
    };
  } finally {
    // Clean up the temporary file
    try {
      fs.unlinkSync(tempFilePath);
    } catch (error) {
      console.error('Error deleting temporary file:', error);
    }
  }
}

// Get the correct price ID based on the plan type
function getStripePriceId(planType: string): string {
  if (planType === 'MONTHLY') {
    return process.env.STRIPE_PRICE_MONTHLY || 'price_1QzyJ0CLoBz9jXRlwdxlAQKZ';
  } else if (planType === 'ANNUAL') {
    return process.env.STRIPE_PRICE_ANNUAL || 'price_1QzyJNCLoBz9jXRlXE8bsC68';
  }
  return planType; // If planType is already a price ID, use it directly
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set appropriate CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
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
    console.log('Received request to /api/create-checkout-session with body:', req.body);

    // Determine if this is a subscription or 3D print checkout
    const { type } = req.body;

    // Determine the host for redirect URLs
    const host = req.headers.origin || '';

    // SUBSCRIPTION CHECKOUT
    if (type === 'subscription') {
      const { priceId: rawPriceId, userId, email, plan } = req.body;
      
      // Handle different ways of providing the price ID
      let priceId = rawPriceId;
      
      // If no direct priceId was provided, check if plan is specified
      if (!priceId && plan) {
        priceId = getStripePriceId(plan);
      }
      
      if (!priceId) {
        return res.status(400).json({ 
          success: false,
          error: 'Missing priceId parameter',
          message: 'The priceId parameter is required for subscription checkout'
        });
      }
      
      console.log(`Creating subscription checkout with priceId: ${priceId}, userId: ${userId || 'not provided'}`);
      
      // Create the session for subscription
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${host}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${host}/pricing`,
        client_reference_id: userId || undefined,
        customer_email: email || undefined,
        metadata: {
          userId: userId || '',
          checkoutType: 'subscription'
        }
      });
      
      console.log('Created checkout session:', session.id);
      
      // Return the checkout URL
      return res.json({
        success: true,
        url: session.url,
        sessionId: session.id
      });
    }
    
    // 3D PRINT CHECKOUT
    if (type === '3d_print' || req.body.is3DPrint) {
      const { 
        modelName, 
        color, 
        quantity, 
        finalPrice, 
        stlFileData, 
        stlFileName
      } = req.body;
      
      console.log('Handling 3D print checkout with:', { 
        modelName, 
        color, 
        quantity, 
        finalPrice,
        hasStlFileData: !!stlFileData,
        stlFileName
      });
      
      if (!modelName || !color || !quantity || !finalPrice) {
        return res.status(400).json({ 
          success: false, 
          message: 'Missing required checkout information' 
        });
      }

      // Variables to store STL file information
      let stlDownloadUrl = '';
      let stlFilePath = '';
      
      // Upload STL file to Firebase if provided
      if (stlFileData && stlFileName) {
        try {
          console.log('Uploading STL file to Firebase Storage');
          const uploadResult = await uploadSTLToFirebase(stlFileData, stlFileName);
          
          stlDownloadUrl = uploadResult.downloadUrl;
          stlFilePath = uploadResult.filePath;
          
          console.log('STL file uploaded successfully');
          console.log('Download URL:', stlDownloadUrl.substring(0, 100) + '...');
          
          // Log the full length of the URL and a clearer indication that it was generated
          console.log(`FULL STL DOWNLOAD URL LENGTH: ${stlDownloadUrl.length} characters`);
          console.log(`STL URL EXAMPLE (first 150 chars): ${stlDownloadUrl.substring(0, 150)}...`);
          console.log('This URL will be included in Stripe product description');
        } catch (uploadError) {
          console.error('Failed to upload STL file to Firebase:', uploadError);
          // Continue with checkout even if upload fails
        }
      }
      
      // Add STL download link to product description
      let productDescription = `3D Print in ${color} (Qty: ${quantity})`;
      if (stlDownloadUrl) {
        // Simplified format that's more likely to display properly in Stripe
        productDescription = `3D Print in ${color} (Qty: ${quantity}). STL DOWNLOAD LINK: ${stlDownloadUrl}`;
      }

      // Create a product in Stripe for this 3D print
      const product = await stripe.products.create({
        name: stlDownloadUrl 
          ? `3D Print: ${modelName} (Download Available)` 
          : `3D Print: ${modelName}`,
        description: productDescription,
        metadata: {
          modelName,
          color,
          quantity: quantity.toString(),
          printType: '3d_print',
          stlFileName: stlFileName || '',
          stlFilePath: stlFilePath || '',
          hasStlFile: stlDownloadUrl ? 'true' : 'false',
          stlDownloadUrl: stlDownloadUrl || ''  // Always include in metadata, even if empty
        }
      });
      
      // Create a price for the product
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(finalPrice * 100), // Convert dollars to cents
        currency: 'usd',
      });
      
      // Create checkout session metadata with all needed information
      const sessionMetadata: Record<string, string> = {
        modelName,
        color,
        quantity: quantity.toString(),
        finalPrice: finalPrice.toString(),
        stlFileName: stlFileName || 'unknown.stl'
      };
      
      // Add STL download URL to metadata if available
      if (stlDownloadUrl) {
        sessionMetadata.stlDownloadUrl = stlDownloadUrl;
        sessionMetadata.stlFilePath = stlFilePath;
      }
      
      // Create a checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: price.id,
            quantity: 1, // We already factored quantity into the price
          },
        ],
        mode: 'payment',
        success_url: stlDownloadUrl 
          ? `${host}/checkout-confirmation?session_id={CHECKOUT_SESSION_ID}&stl_url=${encodeURIComponent(stlDownloadUrl)}`
          : `${host}/checkout-confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${host}/`,
        metadata: sessionMetadata,
        // Enable billing address collection
        billing_address_collection: 'required',
        shipping_address_collection: {
          allowed_countries: ['US', 'CA', 'GB', 'AU'], // Add the countries you ship to
        },
        shipping_options: stlDownloadUrl ? [
          {
            shipping_rate_data: {
              type: 'fixed_amount',
              fixed_amount: {
                amount: 0,
                currency: 'usd',
              },
              display_name: `STL DOWNLOAD: ${stlDownloadUrl.substring(0, 50)}...`,
              delivery_estimate: {
                minimum: {
                  unit: 'business_day',
                  value: 5,
                },
                maximum: {
                  unit: 'business_day',
                  value: 10,
                },
              }
            }
          }
        ] : undefined,
        // Add custom text to display the download URL directly in the checkout page
        custom_text: stlDownloadUrl ? {
          submit: {
            message: `IMPORTANT: Save your STL download link: ${stlDownloadUrl}`
          }
        } : undefined,
      });

      // Return the session ID and URL
      return res.json({ 
        success: true,
        sessionId: session.id,
        url: session.url 
      });
    }
    
    // Neither subscription nor 3D print - unsupported checkout type
    return res.status(400).json({ 
      success: false, 
      message: 'Unsupported checkout type. Please specify type as "subscription" or "3d_print".' 
    });
    
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    return res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to create checkout session'
    });
  }
} 