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
    console.log('=== Testing Checkout Process ===');
    
    // Step 1: Submit the checkout request with STL data
    console.log('\n1. Creating checkout session with STL data...');
    const checkoutResponse = await axios.post(`${SERVER_URL}/api/checkout`, {
      stlBase64,
      stlFileName: 'test-cube.stl',
      modelName: 'Test Cube',
      dimensions: '10x10x10',
      material: 'PLA',
      infillPercentage: 20,
      price: 1999,
      email: 'test@example.com'
    });
    
    console.log(`Checkout response: ${JSON.stringify(checkoutResponse.data, null, 2)}`);
    
    if (!checkoutResponse.data.success) {
      throw new Error('Checkout failed');
    }
    
    const sessionId = checkoutResponse.data.id;
    console.log(`Created checkout session: ${sessionId}`);
    console.log(`STL URL: ${checkoutResponse.data.stlInfo.url}`);
    
    // Step 2: Manually simulate webhook for completed payment
    console.log('\n2. Simulating webhook for completed payment...');
    
    // Create the webhook payload
    const webhookPayload = {
      id: 'evt_' + crypto.randomBytes(16).toString('hex'),
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          customer_details: {
            email: 'test@example.com',
            name: 'Test Customer'
          },
          shipping_details: {
            address: {
              line1: '123 Test St',
              city: 'Test City',
              state: 'Test State',
              postal_code: '12345',
              country: 'US'
            }
          },
          amount_total: 1999,
          payment_status: 'paid',
          metadata: {
            stlUrl: checkoutResponse.data.stlInfo.url,
            stlFileName: 'test-cube.stl',
            productName: 'Test Cube',
            dimensions: '10x10x10',
            material: 'PLA',
            infillPercentage: '20'
          }
        }
      }
    };
    
    // Send the webhook
    try {
      const webhookResponse = await axios.post(`${SERVER_URL}/api/webhook`, webhookPayload, {
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 'whsec_test'
        }
      });
      
      console.log(`Webhook response: ${JSON.stringify(webhookResponse.data, null, 2)}`);
      console.log('\nTest completed successfully!');
      console.log('Check your email at taiyaki.orders@gmail.com for the order notification with the Supabase link.');
      
    } catch (webhookError) {
      console.error('Webhook simulation failed:', webhookError.response?.data || webhookError.message);
    }
    
  } catch (error) {
    console.error('Test failed:', error.response?.data || error.message);
  }
}

// Run the test
runTest(); 