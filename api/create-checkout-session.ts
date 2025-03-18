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
      storageBucket: 'taiyaki-test1.firebasestorage.app'
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
    console.log('Starting Firebase upload with file size:', fileBuffer.length, 'bytes');
    console.log('Upload destination:', storagePath);
    
    const [uploadedFile] = await firebaseStorage.upload(tempFilePath, {
      destination: storagePath,
      metadata: {
        contentType: 'model/stl',
        metadata: {
          originalName: safeFileName,
          uploadTime: new Date().toISOString()
        }
      }
    });

    console.log('File uploaded to Firebase. File details:', {
      name: uploadedFile.name,
      bucket: uploadedFile.bucket.name,
      exists: await uploadedFile.exists(),
      metadata: await uploadedFile.getMetadata()
    });
    
    // Get a signed URL with long expiration
    console.log('Generating signed URL for path:', storagePath);
    const [signedUrl] = await firebaseStorage.file(storagePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 315360000000, // 10 years in milliseconds
    });
    
    console.log('Generated signed URL length:', signedUrl.length);
    console.log('Signed URL preview (first 100 chars):', signedUrl.substring(0, 100));
    
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
      const { priceId: rawPriceId, userId, email, plan, promoCode } = req.body;
      
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
      
      if (!userId) {
        return res.status(400).json({ 
          success: false,
          error: 'Missing userId parameter',
          message: 'The userId parameter is required for subscription checkout'
        });
      }
      
      console.log(`Creating subscription checkout with priceId: ${priceId}, userId: ${userId || 'not provided'}`);
      
      // First, try to look up existing customer
      let customerId: string | undefined = undefined;
      
      if (userId && firebaseStorage) {
        try {
          // Get Firestore database
          const db = admin.firestore();
          
          // Try to get user document
          const userDoc = await db.collection('users').doc(userId).get();
          
          if (userDoc.exists && userDoc.data()?.stripeCustomerId) {
            customerId = userDoc.data()?.stripeCustomerId;
            console.log(`Found existing Stripe customer ID for user ${userId}: ${customerId}`);
          }
        } catch (error) {
          console.error('Error looking up user in Firestore:', error);
          // Continue without customerId
        }
      }
      
      // If no customer found, create a new one
      if (!customerId && email) {
        try {
          const customer = await stripe.customers.create({
            email,
            metadata: {
              userId, // Store userId in customer metadata
            },
          });
          customerId = customer.id;
          console.log(`Created new Stripe customer for user ${userId}: ${customerId}`);
          
          // Save the customer ID to Firestore if available
          if (userId && firebaseStorage) {
            try {
              const db = admin.firestore();
              await db.collection('users').doc(userId).set({
                email,
                stripeCustomerId: customerId,
                updatedAt: new Date().toISOString(),
              }, { merge: true });
              console.log(`Updated user ${userId} in Firestore with Stripe customer ID`);
            } catch (error) {
              console.error('Error updating user in Firestore:', error);
              // Continue without updating Firestore
            }
          }
        } catch (error) {
          console.error('Error creating Stripe customer:', error);
          // Continue without customerId - will use customer_email instead
        }
      }
      
      // Create checkout session options
      const sessionOptions: Stripe.Checkout.SessionCreateParams = {
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'subscription',
        success_url: `${host}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${host}/pricing`,
        customer: customerId,
        client_reference_id: userId || undefined,
        customer_email: !customerId ? email : undefined, // Only use customer_email if we don't have a customerId
        metadata: {
          userId: userId || '', // Important for webhook processing
          checkoutType: 'subscription'
        },
        subscription_data: {
          metadata: {
            userId: userId || '', // Important to store userId on the subscription itself
          },
        },
        // Enable promotion codes on the checkout page
        allow_promotion_codes: true,
      };
      
      // If a specific promo code was provided, apply it directly
      if (promoCode) {
        try {
          console.log(`Applying promotion code: ${promoCode}`);
          
          // Validate that the promotion code exists
          const promotionCodes = await stripe.promotionCodes.list({
            code: promoCode,
            active: true,
          });
          
          if (promotionCodes.data.length > 0) {
            const promotionCodeId = promotionCodes.data[0].id;
            console.log(`Found valid promotion code: ${promotionCodeId}`);
            
            // Add the promotion code to the session
            sessionOptions.discounts = [{ promotion_code: promotionCodeId }];
          } else {
            console.log(`Promotion code not found or not active: ${promoCode}`);
          }
        } catch (error) {
          console.error(`Error applying promotion code ${promoCode}:`, error);
          // Continue without the promotion code
        }
      }
      
      // Create the session for subscription
      const session = await stripe.checkout.sessions.create(sessionOptions);
      
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
      
      // Upload to Firebase and get signed URL
      if (stlFileData && stlFileName) {
        try {
          if (!firebaseStorage) {
            throw new Error('Firebase Storage is not initialized');
          }

          // Upload to Firebase and get signed URL
          const uploadResult = await uploadSTLToFirebase(stlFileData, stlFileName);
          
          // Verify the file exists in Firebase
          const file = firebaseStorage.file(uploadResult.filePath);
          const [exists] = await file.exists();
          
          if (!exists) {
            throw new Error('File failed to upload to Firebase');
          }
          
          stlDownloadUrl = uploadResult.downloadUrl;
          stlFilePath = uploadResult.filePath;
          
          if (!stlDownloadUrl) {
            throw new Error('Failed to get download URL from Firebase');
          }
        } catch (error) {
          console.error('Error in file upload process:', error);
          return res.status(500).json({ 
            success: false, 
            message: 'Failed to upload STL file',
            error: error.message
          });
        }
      }
      
      // Create product description with the Firebase signed URL
      const productDescription = `3D Print in ${color} (Qty: ${quantity})\n\n` +
        (stlDownloadUrl ? `Your STL file will be available at:\n${stlDownloadUrl}\n\n` +
                         `Please save this URL - it's valid for 10 years.` : '');

      // Create a product in Stripe with Firebase URL
      const product = await stripe.products.create({
        name: `3D Print: ${modelName}${stlDownloadUrl ? ' (Includes STL File)' : ''}`,
        description: productDescription,
        metadata: {
          modelName,
          color,
          quantity: quantity.toString(),
          printType: '3d_print',
          stlFileName: stlFileName || '',
          stlFilePath: stlFilePath || '',
          hasStlFile: stlDownloadUrl ? 'true' : 'false',
          stlDownloadUrl: stlDownloadUrl || ''
        }
      });
      
      // Create a price for the product
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(finalPrice * 100),
        currency: 'usd',
      });
      
      // Create checkout session metadata
      const sessionMetadata = {
        modelName,
        color,
        quantity: quantity.toString(),
        finalPrice: finalPrice.toString(),
        stlFileName: stlFileName || '',
        stlDownloadUrl: stlDownloadUrl || '',
        stlFilePath: stlFilePath || ''
      };
      
      // Create checkout session with Firebase URL in success path
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price: price.id,
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: stlDownloadUrl 
          ? `${host}/checkout-confirmation?session_id={CHECKOUT_SESSION_ID}&stl_url=${encodeURIComponent(stlDownloadUrl)}`
          : `${host}/checkout-confirmation?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${host}/`,
        metadata: sessionMetadata,
        billing_address_collection: 'required',
        shipping_address_collection: {
          allowed_countries: ['US', 'CA', 'GB', 'AU'],
        },
        custom_text: stlDownloadUrl ? {
          submit: {
            message: `IMPORTANT: Your STL file URL is shown in the product description above. Please save it.`
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