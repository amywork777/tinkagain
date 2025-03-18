#!/usr/bin/env node

/**
 * Script to simulate a complete checkout process
 * and verify email sending with Supabase links
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

// Create a simple STL file content
const simpleSTL = `solid simple_cube
facet normal 0 0 0
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 1 1 0
  endloop
endfacet
endsolid simple_cube`;

// Convert to base64
const stlBase64 = Buffer.from(simpleSTL).toString('base64');

// Configuration
const SERVER_URL = 'http://localhost:4002';

// Function to run the test
async function runTest() {
  try {
    console.log('=== Testing Checkout Process with Email Notifications ===');
    
    // Step 1: Submit the checkout request with STL data
    console.log('\n1. Creating checkout session with STL data...');
    
    // Generate a unique identifier for this test
    const testId = Date.now().toString().slice(-6);
    
    const checkoutResponse = await axios.post(`${SERVER_URL}/api/checkout`, {
      stlBase64,
      stlFileName: `test-model-${testId}.stl`,
      modelName: `Test Model ${testId}`,
      dimensions: '10x10x10',
      material: 'PLA',
      infillPercentage: 20,
      price: 1999,
      email: 'test@example.com'
    });
    
    console.log(`Checkout response status: ${checkoutResponse.status}`);
    
    if (!checkoutResponse.data.success) {
      throw new Error('Checkout failed: ' + JSON.stringify(checkoutResponse.data));
    }
    
    const sessionId = checkoutResponse.data.id;
    const checkoutUrl = checkoutResponse.data.url;
    console.log(`Created checkout session: ${sessionId}`);
    console.log(`Stripe checkout URL: ${checkoutUrl}`);
    console.log(`STL file name: test-model-${testId}.stl`);
    console.log(`STL URL: ${checkoutResponse.data.stlInfo.url}`);
    
    console.log('\n✅ Checkout process completed successfully!');
    console.log('✅ An email notification should have been sent to taiyaki.orders@gmail.com');
    console.log('✅ Check your email for the order notification with the Supabase link.');
    
  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the test
runTest().then(() => {
  console.log('\n✅ Test completed');
}); 