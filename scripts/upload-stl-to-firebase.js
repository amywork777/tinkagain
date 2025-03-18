#!/usr/bin/env node

/**
 * Script to upload an STL file to Firebase Storage and generate a signed URL
 * 
 * This script processes the STL data provided in the user's query and uploads it to Firebase,
 * then generates a signed URL for accessing the file.
 * 
 * Usage: node scripts/upload-stl-to-firebase.js
 */

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import dotenv from 'dotenv';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// The STL file as base64 data - this is the data from the user's query
const STL_BASE64 = 'data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAAAAAAAAAAgL8AAAAAAACgwQAAAAAAAKDBAACgQQAAAAAAAKDBAAAAAAAAAAAAAKBBAAAAAAAAAACAPwAAAAAAAAAAAAAgQgAAoEEAAKBBAAAgQgAAoMEAAKDBAAAgQgAAoMEAAAAAAAAAAAAAAACAvwAAoMEAAAAAAACgwQAAoMEAACBCAACgwQAAoEEAAAAAAACgwQAAAAAAAAAAAAAAAIC/AACgQQAAAAAAAKDBAACgwQAAIEIAAKDBAACgQQAAIEIAAKDBAAAu+WQ/AAAAAC755D4AAKBBAAAAAAAAoMEAAKBBAAAgQgAAoMEAAAAAAAAAAAAAoEEAAC75ZD8AAAAALvnkPgAAAAAAAAAAAACgQQAAoEEAACBCAACgwQAAAAAAACBCAACgQQAALvlkvwAAAAAu+eQ+AACgwQAAAAAAAKDBAAAAAAAAAAAAAKBBAACgwQAAIEIAAKDBAAAu+WS/AAAAAC755D4AAAAAAAAAAAAAoEEAAAAAAAAgQgAAoEEAAKDBAAAgQgAAoMEAAA==';

// Console colors for output
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

// Main function to upload STL to Firebase
async function uploadSTLToFirebase() {
  printHeader('UPLOADING STL TO FIREBASE');
  
  try {
    // Initialize Firebase Admin SDK if not already initialized
    if (admin.apps.length === 0) {
      log('Initializing Firebase Admin SDK...', colors.blue);
      
      // Process private key format
      const privateKey = process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined;
      
      // Check required environment variables
      if (!process.env.FIREBASE_PROJECT_ID || !privateKey || !process.env.FIREBASE_CLIENT_EMAIL) {
        throw new Error('Missing required Firebase configuration in .env.local file');
      }
      
      // Initialize Firebase
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.appspot.com`
      });
      
      log('Firebase Admin SDK initialized successfully', colors.green);
    }
    
    // Process the STL data
    log('Processing STL data...', colors.blue);
    
    // Extract base64 data from data URL format
    let base64Data;
    if (STL_BASE64.includes('base64,')) {
      const parts = STL_BASE64.split('base64,');
      base64Data = parts[1];
      log(`Extracted base64 data (${base64Data.length} characters)`, colors.green);
    } else {
      base64Data = STL_BASE64;
      log('Using direct base64 data', colors.blue);
    }
    
    // Convert to buffer
    const stlBuffer = Buffer.from(base64Data, 'base64');
    log(`Converted to buffer (${stlBuffer.length} bytes)`, colors.green);
    
    // Create temporary file
    const tempDir = path.join(os.tmpdir(), 'firebase-stl-upload');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const timestamp = Date.now();
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const tempFilePath = path.join(tempDir, `stl-${timestamp}-${uniqueId}.stl`);
    
    fs.writeFileSync(tempFilePath, stlBuffer);
    log(`Wrote data to temporary file: ${tempFilePath}`, colors.green);
    
    // Create a path in Firebase Storage
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const storagePath = `stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-prism.stl`;
    log(`Firebase Storage path: ${storagePath}`, colors.blue);
    
    // Get bucket reference
    const bucket = admin.storage().bucket();
    log(`Using Firebase Storage bucket: ${bucket.name}`, colors.blue);
    
    // Attempt to upload to Firebase
    log('Uploading to Firebase Storage...', colors.blue);
    
    try {
      // Upload file
      await bucket.upload(tempFilePath, {
        destination: storagePath,
        metadata: {
          contentType: 'model/stl',
          metadata: {
            timestamp: timestamp.toString(),
            filename: 'prism.stl'
          }
        }
      });
      
      log('✅ File uploaded successfully!', colors.green);
      
      // Generate signed URL for access
      const [signedUrl] = await bucket.file(storagePath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 315360000000, // 10 years in milliseconds
      });
      
      log('✅ Generated signed URL:', colors.green);
      console.log(signedUrl);
      
      // Also get a public URL
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
      
      log('Public URL (may require authentication):', colors.blue);
      console.log(publicUrl);
      
      // Clean up the temporary file
      fs.unlinkSync(tempFilePath);
      log('Temporary file deleted', colors.blue);
      
      return {
        signedUrl,
        publicUrl,
        storagePath
      };
      
    } catch (uploadError) {
      log(`❌ Firebase upload failed: ${uploadError.message}`, colors.red);
      
      // Check if it's an authentication error
      if (uploadError.message.includes('invalid_grant') || uploadError.message.includes('JWT')) {
        log('This appears to be an authentication error. Your service account key may be invalid.', colors.yellow);
        log('Please generate a new service account key from the Firebase console.', colors.yellow);
        log('1. Go to Firebase Console > Project Settings > Service accounts', colors.yellow);
        log('2. Click "Generate new private key"', colors.yellow);
        log('3. Save the file and update your .env.local', colors.yellow);
      }
      
      throw uploadError;
    }
    
  } catch (error) {
    log(`Error: ${error.message}`, colors.red);
    console.error(error);
    process.exit(1);
  }
}

// Execute the upload function
uploadSTLToFirebase().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
}); 