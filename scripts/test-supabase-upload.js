#!/usr/bin/env node

/**
 * Test Script for Supabase STL Upload
 * 
 * This script tests the direct upload to Supabase Storage
 * without going through the checkout process.
 * 
 * Usage:
 *   node scripts/test-supabase-upload.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hcegtlueiyeebzwbnasv.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_NAME = 'stl-files';

// Create a temp directory for our test files
const tempDir = path.join(os.tmpdir(), 'supabase-test');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Color formatting for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  blink: '\x1b[5m',
  reverse: '\x1b[7m',
  hidden: '\x1b[8m',
  
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m'
};

/**
 * Print a formatted header to the console
 */
function printHeader(text) {
  console.log('\n' + colors.bright + colors.cyan + '='.repeat(80) + colors.reset);
  console.log(colors.bright + colors.cyan + ' ' + text + colors.reset);
  console.log(colors.bright + colors.cyan + '='.repeat(80) + colors.reset + '\n');
}

/**
 * Create a simple test STL file
 * @returns {{filePath: string, fileName: string}}
 */
function createTestSTLFile() {
  printHeader('Creating Test STL File');
  
  // Simple ASCII STL file containing a cube
  const stlContent = `solid cube
facet normal 0 0 0
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 1 1 0
  endloop
endfacet
endsolid cube`;
  
  // Create a unique filename
  const timestamp = Date.now();
  const uniqueId = crypto.randomBytes(4).toString('hex');
  const fileName = `test-${timestamp}-${uniqueId}.stl`;
  const filePath = path.join(tempDir, fileName);
  
  // Write the file
  fs.writeFileSync(filePath, stlContent);
  console.log(`Created test STL file at: ${filePath}`);
  
  return {
    filePath,
    fileName
  };
}

/**
 * Upload a file to Supabase Storage
 */
async function uploadToSupabase(filePath, fileName) {
  printHeader('Uploading to Supabase Storage');
  
  // Validate Supabase credentials
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error(colors.red + 'Missing Supabase credentials in .env.local file' + colors.reset);
    process.exit(1);
  }
  
  console.log(`Initializing Supabase client for: ${SUPABASE_URL}`);
  
  // Initialize Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  console.log(colors.green + 'Supabase client initialized' + colors.reset);
  
  // Check if the bucket exists
  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
  if (bucketsError) {
    throw new Error(`Failed to list buckets: ${bucketsError.message}`);
  }
  
  const bucketExists = buckets.some(bucket => bucket.name === BUCKET_NAME);
  if (!bucketExists) {
    console.log(`Bucket '${BUCKET_NAME}' does not exist, creating it...`);
    const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: 52428800, // 50MB limit
    });
    
    if (createError) {
      throw new Error(`Failed to create bucket: ${createError.message}`);
    }
    console.log(colors.green + `Created bucket '${BUCKET_NAME}'` + colors.reset);
  } else {
    console.log(`Using existing bucket: ${BUCKET_NAME}`);
  }
  
  // Read the file
  console.log(`Reading file: ${filePath}`);
  const fileData = fs.readFileSync(filePath);
  console.log(`File size: ${fileData.length} bytes`);
  
  // Create a path in storage organized by date (YYYY/MM/DD)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const timestamp = Date.now();
  
  const storagePath = `${year}/${month}/${day}/${timestamp}-${fileName}`;
  console.log(`Storage path: ${storagePath}`);
  
  // Upload the file
  console.log('Uploading to Supabase...');
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, fileData, {
      contentType: 'model/stl',
      cacheControl: '3600',
      upsert: false
    });
  
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }
  
  console.log(colors.green + 'File uploaded successfully!' + colors.reset);
  
  // Get signed URL for the uploaded file
  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, 604800); // 7 days expiry (1 week = 60 * 60 * 24 * 7 = 604800 seconds)
  
  if (signedUrlError) {
    throw new Error(`Failed to create signed URL: ${signedUrlError.message}`);
  }
  
  const signedUrl = signedUrlData.signedUrl;
  
  // Get public URL
  const { data: publicUrlData } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(storagePath);
  
  const publicUrl = publicUrlData.publicUrl;
  
  return {
    storagePath,
    fileName,
    fileSize: fileData.length,
    signedUrl,
    publicUrl
  };
}

/**
 * Main function to run the test
 */
async function main() {
  printHeader('Supabase Storage Test');
  
  let testFile = null;
  
  try {
    // Create a test STL file
    testFile = createTestSTLFile();
    
    // Upload to Supabase
    const uploadResult = await uploadToSupabase(testFile.filePath, testFile.fileName);
    
    printHeader('Test Results');
    console.log(`
${colors.green}Supabase Upload Successful!${colors.reset}

File Details:
- Name: ${colors.bright}${uploadResult.fileName}${colors.reset}
- Size: ${colors.bright}${uploadResult.fileSize} bytes${colors.reset}
- Storage Path: ${colors.bright}${uploadResult.storagePath}${colors.reset}

URLs:
- Signed URL (valid for 1 week): 
  ${colors.underscore}${uploadResult.signedUrl}${colors.reset}

- Public URL: 
  ${colors.underscore}${uploadResult.publicUrl}${colors.reset}
`);
    
  } catch (error) {
    console.error(colors.red + 'Test failed: ' + error.message + colors.reset);
    process.exit(1);
  } finally {
    // Clean up the test file
    if (testFile && fs.existsSync(testFile.filePath)) {
      fs.unlinkSync(testFile.filePath);
      console.log(`Deleted temporary test file: ${testFile.filePath}`);
    }
  }
}

// Run the test
main(); 