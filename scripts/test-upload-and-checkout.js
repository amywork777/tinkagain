#!/usr/bin/env node

/**
 * Test Script for Stripe Checkout with STL Upload
 * 
 * This script tests the checkout process with an STL file upload
 * to verify both Stripe and Supabase integration are working.
 * 
 * Usage:
 *   node scripts/test-upload-and-checkout.js
 */

// Import required modules
import fs from 'fs';
import path from 'path';
import os from 'os';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import axios from 'axios';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create temporary directory for test files
const tempDir = path.join(os.tmpdir(), 'stl-test');
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
 * @returns {{filePath: string, fileName: string, fileContent: Buffer}}
 */
function createTestSTLFile() {
  printHeader('Creating Test STL File');
  
  // Simple ASCII STL file containing a small cube
  const simpleSTL = `solid simple_cube
facet normal 0 0 0
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 1 1 0
  endloop
endfacet
endsolid simple_cube`;
  
  const timestamp = Date.now();
  const fileName = `test-${timestamp}.stl`;
  const filePath = path.join(tempDir, fileName);
  
  fs.writeFileSync(filePath, simpleSTL);
  const fileContent = fs.readFileSync(filePath);
  
  console.log(`Created test STL file at: ${filePath}`);
  console.log(`File size: ${fileContent.length} bytes`);
  
  // Convert to base64 for the API request
  const base64Content = fileContent.toString('base64');
  console.log(`Base64 length: ${base64Content.length} characters`);
  
  return {
    filePath,
    fileName,
    fileContent,
    base64Content
  };
}

/**
 * Test the checkout endpoint with STL upload
 */
async function testCheckout(base64STL, fileName) {
  printHeader('Testing Checkout Endpoint with STL Upload');
  
  try {
    // First test the debug endpoint
    console.log('Testing debug endpoint first...');
    const debugResponse = await fetch('http://localhost:4002/api/debug-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stlBase64: base64STL,
        stlFileName: fileName,
        modelName: 'Test Model',
        dimensions: '10x10x10',
        material: 'PLA',
        infillPercentage: 20,
        price: 1999, // $19.99
        email: 'test@example.com',
      }),
    });
    
    const debugResult = await debugResponse.json();
    console.log(colors.green + 'Debug endpoint response:' + colors.reset);
    console.log(JSON.stringify(debugResult, null, 2));
    
    // Now test the actual checkout endpoint
    console.log('\n' + colors.bright + colors.blue + 'Testing actual checkout endpoint...' + colors.reset);
    const checkoutResponse = await fetch('http://localhost:4002/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stlBase64: base64STL,
        stlFileName: fileName,
        modelName: 'Test Model',
        dimensions: '10x10x10',
        material: 'PLA',
        infillPercentage: 20,
        price: 1999, // $19.99
        email: 'test@example.com',
      }),
    });
    
    if (!checkoutResponse.ok) {
      throw new Error(`HTTP error! status: ${checkoutResponse.status}`);
    }
    
    const checkoutResult = await checkoutResponse.json();
    console.log(colors.green + 'Checkout endpoint response:' + colors.reset);
    console.log(JSON.stringify(checkoutResult, null, 2));
    
    if (checkoutResult.url) {
      console.log(colors.green + '\nCheckout URL: ' + colors.bright + checkoutResult.url + colors.reset);
      console.log(colors.yellow + 'Visit this URL to complete the test payment with Stripe.' + colors.reset);
    }
    
    return checkoutResult;
  } catch (error) {
    console.error(colors.red + 'Error testing checkout endpoint:' + colors.reset, error);
    return { error: error.message };
  }
}

/**
 * Add a test to simulate a successful checkout and verify email sending
 */
async function testCheckoutAndEmail() {
  try {
    console.log('Starting checkout and email test...');

    // Simulate a checkout request
    const response = await axios.post('http://localhost:4002/api/checkout', {
      stlBase64: 'c29saWQgc2ltcGxlX2N1YmUKZmFjZXQgbm9ybWFsIDAgMCAwCiAgb3V0ZXIgbG9vcAogICAgdmVydGV4IDAgMCAwCiAgICB2ZXJ0ZXggMSAwIDAKICAgIHZlcnRleCAxIDEgMAogIGVuZGxvb3AKZW5kZmFjZXQKZW5kc29saWQgc2ltcGxlX2N1YmU=',
      stlFileName: 'test.stl',
      modelName: 'Test Model',
      dimensions: '10x10x10',
      material: 'PLA',
      infillPercentage: 20,
      price: 1999,
      email: 'test@example.com'
    });

    console.log('Checkout response:', response.data);

    // Simulate Stripe webhook for successful payment
    const webhookResponse = await axios.post('http://localhost:4002/api/webhook', {
      id: 'evt_test_webhook',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: response.data.sessionId,
          metadata: {
            modelName: 'Test Model',
            stlDownloadUrl: 'https://example.com/download/test.stl'
          }
        }
      }
    }, {
      headers: {
        'Stripe-Signature': 'whsec_test'
      }
    });

    console.log('Webhook response:', webhookResponse.data);
  } catch (error) {
    console.error('Error during checkout and email test:', error);
  }
}

/**
 * Main function to orchestrate the test
 */
async function main() {
  printHeader('STL Upload and Checkout Test');
  
  let testFile = null;
  
  try {
    // Create test STL file
    testFile = createTestSTLFile();
    
    // Test the checkout endpoint
    await testCheckout(testFile.base64Content, testFile.fileName);
    
    // Test checkout and email
    await testCheckoutAndEmail();
    
  } catch (error) {
    console.error(colors.red + 'Test failed:' + colors.reset, error);
  } finally {
    // Clean up test file
    if (testFile && fs.existsSync(testFile.filePath)) {
      fs.unlinkSync(testFile.filePath);
      console.log(`\nDeleted test file: ${testFile.filePath}`);
    }
    
    printHeader('Test Completed');
  }
}

// Run the test
main(); 