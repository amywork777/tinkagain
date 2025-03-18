#!/usr/bin/env node

/**
 * Supabase Storage Bucket Setup Script
 * 
 * This script creates a storage bucket in Supabase for STL files if it doesn't exist
 * and sets up the appropriate permissions.
 * 
 * Usage:
 *   node scripts/create-supabase-bucket.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

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
 * Log a success message
 */
function logSuccess(message) {
  console.log(colors.green + '✓ ' + message + colors.reset);
}

/**
 * Log an error message
 */
function logError(message) {
  console.error(colors.red + '✗ ' + message + colors.reset);
}

/**
 * Log an info message
 */
function logInfo(message) {
  console.log(colors.blue + 'ℹ ' + message + colors.reset);
}

/**
 * Main function to create the Supabase bucket
 */
async function main() {
  printHeader('Supabase Storage Bucket Setup');
  
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const BUCKET_NAME = 'stl-files';
  
  // Validate credentials
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    logError('Missing Supabase credentials in .env.local file');
    console.log(`
${colors.yellow}Make sure to add the following to your .env.local file:${colors.reset}

SUPABASE_URL=your-supabase-project-url
SUPABASE_SERVICE_KEY=your-supabase-service-role-key
`);
    process.exit(1);
  }
  
  logInfo(`Connecting to Supabase project: ${SUPABASE_URL}`);
  
  // Initialize Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  try {
    // Check if the bucket already exists
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    
    if (bucketsError) {
      throw new Error(`Failed to list buckets: ${bucketsError.message}`);
    }
    
    const bucketExists = buckets.some(bucket => bucket.name === BUCKET_NAME);
    
    if (bucketExists) {
      logInfo(`Bucket '${BUCKET_NAME}' already exists`);
    } else {
      // Create the bucket
      logInfo(`Creating '${BUCKET_NAME}' bucket...`);
      
      const { error: createError } = await supabase.storage.createBucket(BUCKET_NAME, {
        public: false, // Not publicly accessible
        fileSizeLimit: 52428800, // 50MB limit (in bytes)
      });
      
      if (createError) {
        throw new Error(`Failed to create bucket: ${createError.message}`);
      }
      
      logSuccess(`Created '${BUCKET_NAME}' bucket`);
    }
    
    // Update CORS policy for the bucket
    logInfo('Setting CORS policy...');
    
    const corsConfigurations = [
      {
        origin: '*', // Allow any origin for development
        headers: ['Content-Type', 'Authorization', 'Accept'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        maxAgeSeconds: 3600,
      }
    ];
    
    // Update the CORS policy
    const { error: corsError } = await supabase.storage.updateBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: 52428800, // 50MB limit
      cors: corsConfigurations,
    });
    
    if (corsError) {
      throw new Error(`Failed to update CORS policy: ${corsError.message}`);
    }
    
    logSuccess('CORS policy set successfully');
    
    // Save Supabase credentials to .env file if they don't already exist
    const envPath = path.join(process.cwd(), '.env.local');
    
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      
      if (!envContent.includes('SUPABASE_URL=')) {
        fs.appendFileSync(envPath, `\n# Supabase credentials\nSUPABASE_URL=${SUPABASE_URL}\n`);
      }
      
      if (!envContent.includes('SUPABASE_SERVICE_KEY=')) {
        fs.appendFileSync(envPath, `SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}\n`);
      }
      
      logSuccess('Supabase credentials saved to .env.local file');
    }
    
    // Success message
    printHeader('Supabase Storage Setup Complete');
    console.log(`
${colors.green}✓ Supabase storage is now configured!${colors.reset}

STL files will be stored in the ${colors.bright}'${BUCKET_NAME}'${colors.reset} bucket.

${colors.yellow}Important Notes:${colors.reset}
1. Make sure your Supabase project has storage enabled
2. You can manage your storage buckets at ${colors.underscore}${SUPABASE_URL}/project/storage/buckets${colors.reset}
3. The bucket is set to private, requiring authentication for uploads
`);
    
  } catch (error) {
    logError(`Setup failed: ${error.message}`);
    process.exit(1);
  }
}

// Run the script
main(); 