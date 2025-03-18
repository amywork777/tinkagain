#!/usr/bin/env node

/**
 * Script to test both Firebase Storage upload and Stripe checkout functionality
 * 
 * This script will:
 * 1. Test Firebase credentials and upload a test STL file
 * 2. If Firebase fails, create a new service account key
 * 3. Test a Stripe checkout session creation
 * 
 * Usage: node scripts/test-firebase-and-stripe.js
 */

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import https from 'https';
import readline from 'readline';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Configuration
const TEMP_DIR = path.join(os.tmpdir(), 'firebase-test');
const SERVICE_ACCOUNT_PATH = path.resolve(process.cwd(), 'firebase-key-temp.json');
const TEST_STL_BASE64 = 'data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAgL8AAAAAAACgwQAAAAAAAKDBAACgQQAAAAAAAKDBAAAAAAAAAAAAAKBBAAAAAAAAAACAPwAAAAAAAAAAAAAgQgAAoEEAAKBBAAAgQgAAoMEAAKDBAAAgQgAAoMEAAAAAAAAAAAAAAACAvwAAoMEAAAAAAACgwQAAoMEAACBCAACgwQAAoEEAAAAAAACgwQAAAAAAAAAAAAAAAIC/AACgQQAAAAAAAKDBAACgwQAAIEIAAKDBAACgQQAAIEIAAKDBAAAu+WQ/AAAAAC755D4AAKBBAAAAAAAAoMEAAKBBAAAgQgAAoMEAAAAAAAAAAAAAoEEAAC75ZD8AAAAALvnkPgAAAAAAAAAAAACgQQAAoEEAACBCAACgwQAAAAAAACBCAACgQQAALvlkvwAAAAAu+eQ+AACgwQAAAAAAAKDBAAAAAAAAAAAAAKBBAACgwQAAIEIAAKDBAAAu+WS/AAAAAC755D4AAAAAAAAAAAAAoEEAAAAAAAAgQgAAoEEAAKDBAAAgQgAAoMEAAA==';

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Console colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
};

// Log with timestamp and color
function log(message, color = colors.reset) {
  console.log(`${color}[${new Date().toISOString()}] ${message}${colors.reset}`);
}

// Print a section header
function printHeader(title) {
  console.log('\n' + colors.blue + '='.repeat(50) + colors.reset);
  console.log(colors.blue + ` ${title} ` + colors.reset);
  console.log(colors.blue + '='.repeat(50) + colors.reset);
}

// Test Firebase upload functionality
async function testFirebaseUpload() {
  printHeader('TESTING FIREBASE STORAGE UPLOAD');
  
  try {
    // Ensure Firebase is initialized
    if (admin.apps.length === 0) {
      log('Initializing Firebase Admin SDK...', colors.blue);
      
      // Get the Firebase configuration from environment variables
      const privateKey = process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined;
      
      // Check if we have all required Firebase variables
      if (!process.env.FIREBASE_PROJECT_ID || !privateKey || !process.env.FIREBASE_CLIENT_EMAIL) {
        log('Missing required Firebase configuration', colors.red);
        return {
          success: false,
          message: 'Missing required Firebase configuration'
        };
      }
      
      // Initialize Firebase Admin SDK
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.appspot.com`
      });
    }
    
    // Create test STL file from base64 data
    log('Creating test STL file from base64 data...', colors.blue);
    
    // Process base64 data
    let base64Data;
    if (TEST_STL_BASE64.includes('base64,')) {
      const parts = TEST_STL_BASE64.split('base64,');
      base64Data = parts[1];
    } else {
      base64Data = TEST_STL_BASE64;
    }
    
    // Convert to buffer
    const stlBuffer = Buffer.from(base64Data, 'base64');
    log(`Test STL file size: ${stlBuffer.length} bytes`, colors.blue);
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    // Create a temporary file
    const timestamp = Date.now();
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const tempFilePath = path.join(TEMP_DIR, `test-${timestamp}.stl`);
    
    fs.writeFileSync(tempFilePath, stlBuffer);
    log(`Temporary STL file created at: ${tempFilePath}`, colors.green);
    
    // Create a path in Firebase Storage
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const storagePath = `test-uploads/${year}/${month}/${day}/${timestamp}-${uniqueId}-test.stl`;
    log(`Firebase Storage path: ${storagePath}`, colors.blue);
    
    // Get the bucket from Firebase storage
    const bucket = admin.storage().bucket();
    log(`Using Firebase Storage bucket: ${bucket.name}`, colors.blue);
    
    // Upload file
    log('Uploading test file to Firebase Storage...', colors.blue);
    await bucket.upload(tempFilePath, {
      destination: storagePath,
      metadata: {
        contentType: 'model/stl',
        metadata: {
          testUpload: 'true',
          timestamp: timestamp.toString()
        }
      }
    });
    
    log('✅ File uploaded successfully!', colors.green);
    
    // Generate a signed URL
    const [signedUrl] = await bucket.file(storagePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    });
    
    log('✅ Generated signed URL successfully', colors.green);
    log(`Signed URL: ${signedUrl}`, colors.green);
    
    // Clean up the temporary file
    fs.unlinkSync(tempFilePath);
    log('Temporary file deleted', colors.blue);
    
    return {
      success: true,
      signedUrl,
      storagePath
    };
  } catch (error) {
    log(`❌ Firebase upload test failed: ${error.message}`, colors.red);
    
    // Check if it's an authentication error
    if (error.message.includes('invalid_grant') || error.message.includes('JWT')) {
      log('Authentication error detected. Your Firebase credentials may be invalid.', colors.yellow);
      
      return {
        success: false,
        message: error.message,
        isAuthError: true
      };
    }
    
    return {
      success: false,
      message: error.message
    };
  }
}

// Create service account key JSON
function createServiceAccountKey() {
  printHeader('CREATING TEMPORARY SERVICE ACCOUNT KEY');
  
  try {
    // Check if required Firebase variables exist
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
      log('Missing required Firebase environment variables', colors.red);
      return false;
    }
    
    // Create service account object
    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID || "",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(process.env.FIREBASE_CLIENT_EMAIL)}`
    };
    
    // Save to file
    fs.writeFileSync(SERVICE_ACCOUNT_PATH, JSON.stringify(serviceAccount, null, 2));
    
    log(`✅ Service account key file created: ${SERVICE_ACCOUNT_PATH}`, colors.green);
    log('⚠️ Note: This is a temporary file containing sensitive information. Delete it when done testing.', colors.yellow);
    
    return true;
  } catch (error) {
    log(`❌ Failed to create service account key: ${error.message}`, colors.red);
    return false;
  }
}

// Prompt user to generate a new service account key
function promptForNewServiceAccount() {
  return new Promise((resolve) => {
    rl.question(
      `${colors.yellow}Would you like to generate a new Firebase service account key? (y/n): ${colors.reset}`,
      (answer) => {
        resolve(answer.toLowerCase() === 'y');
      }
    );
  });
}

// Test Stripe checkout functionality
async function testStripeCheckout() {
  printHeader('TESTING STRIPE CHECKOUT');
  
  try {
    // Check if we have a Stripe secret key
    if (!process.env.STRIPE_SECRET_KEY) {
      log('Missing STRIPE_SECRET_KEY environment variable', colors.red);
      return {
        success: false,
        message: 'Missing Stripe secret key'
      };
    }
    
    log(`Using Stripe key: ${process.env.STRIPE_SECRET_KEY.startsWith('sk_test') ? 'TEST MODE' : 'LIVE MODE'}`, colors.blue);
    
    // Initialize Stripe
    const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
    
    // Create a test product
    log('Creating test product...', colors.blue);
    const product = await stripeClient.products.create({
      name: 'Test 3D Print Product',
      description: 'Test product for 3D printing checkout',
      metadata: {
        type: '3d_print',
        is3DPrint: 'true',
        test: 'true'
      }
    });
    
    log(`✅ Created product with ID: ${product.id}`, colors.green);
    
    // Create a price for the product
    log('Creating test price...', colors.blue);
    const price = await stripeClient.prices.create({
      product: product.id,
      unit_amount: 1000, // $10.00
      currency: 'usd',
    });
    
    log(`✅ Created price with ID: ${price.id}`, colors.green);
    
    // Create a checkout session
    log('Creating test checkout session...', colors.blue);
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
      metadata: {
        type: '3d_print',
        is3DPrint: 'true',
        test: 'true'
      }
    });
    
    log(`✅ Created checkout session with ID: ${session.id}`, colors.green);
    
    // Create the checkout URL
    const checkoutUrl = session.url;
    log(`Checkout URL: ${checkoutUrl}`, colors.green);
    
    return {
      success: true,
      sessionId: session.id,
      checkoutUrl
    };
  } catch (error) {
    log(`❌ Stripe checkout test failed: ${error.message}`, colors.red);
    return {
      success: false,
      message: error.message
    };
  }
}

// Test webhook endpoint
async function testWebhookEndpoint() {
  printHeader('TESTING WEBHOOK ENDPOINT');
  
  // Check webhook secret
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    log('Missing STRIPE_WEBHOOK_SECRET environment variable', colors.red);
    return {
      success: false,
      message: 'Missing webhook secret'
    };
  }
  
  log(`Webhook secret detected: ${process.env.STRIPE_WEBHOOK_SECRET.substring(0, 5)}...`, colors.green);
  
  // Determine the webhook URL
  const webhookUrl = process.env.WEBHOOK_URL || `${process.env.BASE_URL}/api/webhook`;
  
  if (!webhookUrl) {
    log('No webhook URL found in environment variables', colors.red);
    return {
      success: false,
      message: 'Missing webhook URL'
    };
  }
  
  log(`Webhook URL: ${webhookUrl}`, colors.blue);
  
  // Check if the webhook URL is accessible (without sending actual data)
  const parsedUrl = new URL(webhookUrl);
  
  try {
    log(`Testing webhook URL connectivity...`, colors.blue);
    
    const testResult = await new Promise((resolve) => {
      const req = https.request(
        {
          method: 'OPTIONS',
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname,
          timeout: 5000
        },
        (res) => {
          resolve({
            status: res.statusCode,
            success: res.statusCode < 500 // Consider 4xx as "reachable" but with permission issue
          });
        }
      );
      
      req.on('error', (err) => {
        resolve({
          success: false,
          message: err.message
        });
      });
      
      req.end();
    });
    
    if (testResult.success) {
      log(`✅ Webhook endpoint is reachable (status: ${testResult.status})`, colors.green);
      return {
        success: true,
        status: testResult.status
      };
    } else {
      log(`❌ Could not reach webhook endpoint: ${testResult.message}`, colors.red);
      return {
        success: false,
        message: testResult.message
      };
    }
  } catch (error) {
    log(`❌ Error testing webhook endpoint: ${error.message}`, colors.red);
    return {
      success: false,
      message: error.message
    };
  }
}

// Main function
async function main() {
  printHeader('FIREBASE AND STRIPE TEST SCRIPT');
  
  try {
    // Test Firebase upload
    log('Step 1: Testing Firebase Storage upload...', colors.blue);
    const firebaseResult = await testFirebaseUpload();
    
    // If Firebase test failed due to auth error
    if (!firebaseResult.success && firebaseResult.isAuthError) {
      log('Firebase authentication failed. Your service account key may be invalid.', colors.yellow);
      
      // Ask user if they want to generate a new service account key
      const shouldCreateKey = await promptForNewServiceAccount();
      
      if (shouldCreateKey) {
        // Create service account key JSON
        const keyCreated = createServiceAccountKey();
        
        if (!keyCreated) {
          log('Failed to create service account key. Please generate a new one manually.', colors.red);
        } else {
          log('Service account key created. Use it to update your Firebase credentials.', colors.green);
          log(`Generated at: ${SERVICE_ACCOUNT_PATH}`, colors.green);
          log('Instructions to generate a new service account key:', colors.blue);
          log('1. Go to Firebase Console > Project Settings > Service accounts', colors.blue);
          log('2. Click "Generate new private key"', colors.blue);
          log('3. Save the file and update your .env.local', colors.blue);
        }
      } else {
        log('Skipping service account key generation.', colors.yellow);
      }
    }
    
    // Test Stripe checkout
    log('\nStep 2: Testing Stripe checkout...', colors.blue);
    const stripeResult = await testStripeCheckout();
    
    // Test webhook endpoint
    log('\nStep 3: Testing webhook endpoint...', colors.blue);
    const webhookResult = await testWebhookEndpoint();
    
    // Print summary
    printHeader('TEST RESULTS SUMMARY');
    
    log(`Firebase Storage: ${firebaseResult.success ? '✅ PASSED' : '❌ FAILED'}`, 
      firebaseResult.success ? colors.green : colors.red);
    
    if (firebaseResult.success) {
      log(`Generated signed URL: ${firebaseResult.signedUrl}`, colors.green);
    } else {
      log(`Error: ${firebaseResult.message}`, colors.red);
    }
    
    log(`Stripe Checkout: ${stripeResult.success ? '✅ PASSED' : '❌ FAILED'}`, 
      stripeResult.success ? colors.green : colors.red);
    
    if (stripeResult.success) {
      log(`Checkout URL: ${stripeResult.checkoutUrl}`, colors.green);
    } else {
      log(`Error: ${stripeResult.message}`, colors.red);
    }
    
    log(`Webhook Endpoint: ${webhookResult.success ? '✅ PASSED' : '❌ FAILED'}`, 
      webhookResult.success ? colors.green : colors.red);
    
    if (!webhookResult.success) {
      log(`Error: ${webhookResult.message}`, colors.red);
    }
    
    // If any tests failed, provide guidance
    if (!firebaseResult.success || !stripeResult.success || !webhookResult.success) {
      printHeader('TROUBLESHOOTING RECOMMENDATIONS');
      
      if (!firebaseResult.success) {
        log('Fix Firebase issues:', colors.yellow);
        log('1. Generate a new service account key from the Firebase console', colors.yellow);
        log('2. Update your .env.local file with the new credentials', colors.yellow);
        log('3. Restart your server', colors.yellow);
      }
      
      if (!stripeResult.success) {
        log('Fix Stripe issues:', colors.yellow);
        log('1. Check that your STRIPE_SECRET_KEY is valid and properly formatted', colors.yellow);
        log('2. Ensure you have internet connectivity', colors.yellow);
        log('3. Verify that your Stripe account is in good standing', colors.yellow);
      }
      
      if (!webhookResult.success) {
        log('Fix webhook issues:', colors.yellow);
        log('1. Ensure your server is running and accessible', colors.yellow);
        log('2. Check that the BASE_URL or WEBHOOK_URL in .env.local is correct', colors.yellow);
        log('3. If using localhost, consider using a tunneling service like ngrok', colors.yellow);
      }
    }
    
  } catch (error) {
    log(`Unexpected error: ${error.message}`, colors.red);
    console.error(error);
  } finally {
    rl.close();
  }
}

// Run the main function
main(); 