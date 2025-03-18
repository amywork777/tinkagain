#!/usr/bin/env node

/**
 * Test Script for Stripe Webhook and Email Sending
 * 
 * This script simulates a Stripe webhook event for a completed checkout
 * to verify that emails are being sent with the Supabase STL download links.
 * 
 * Usage:
 *   node scripts/test-webhook.cjs
 */

const axios = require('axios');
const crypto = require('crypto');

// Configuration
const WEBHOOK_URL = 'http://localhost:4002/api/webhook';
const TEST_EMAIL = 'taiyaki.orders@gmail.com';

/**
 * Create a simulated Stripe webhook event
 */
function createStripeEvent() {
  // Generate a unique session ID
  const sessionId = `cs_test_${crypto.randomBytes(16).toString('hex')}`;
  
  // Create a simulated event
  return {
    id: `evt_test_${crypto.randomBytes(16).toString('hex')}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        customer_details: {
          email: 'customer@example.com',
          name: 'Test Customer'
        },
        amount_total: 1999, // $19.99
        payment_status: 'paid',
        metadata: {
          stlUrl: 'https://example-supabase.com/storage/v1/object/sign/stl-files/test.stl?token=exampletoken',
          stlFileName: 'test_model.stl',
          productName: 'Test Complex Model',
          dimensions: '100x100x100',
          material: 'PLA',
          infillPercentage: '20',
          urlValidity: '10 years',
          downloadInstructions: 'Your STL file download link is valid for 10 years. Save it somewhere safe!'
        },
        shipping_details: {
          address: {
            line1: '123 Test St',
            city: 'Test City',
            state: 'TS',
            postal_code: '12345',
            country: 'US'
          }
        }
      }
    }
  };
}

/**
 * Test the webhook endpoint with a simulated Stripe event
 */
async function testWebhook() {
  console.log('\n🧪 Testing Stripe webhook for completed checkout...');
  
  const event = createStripeEvent();
  console.log(`📝 Created simulated event: ${event.type}`);
  console.log(`📝 Session ID: ${event.data.object.id}`);
  
  try {
    // Send the webhook event
    console.log(`🚀 Sending webhook to ${WEBHOOK_URL}...`);
    
    const response = await axios.post(WEBHOOK_URL, event, {
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 'whsec_test'
      }
    });
    
    console.log('✅ Webhook response:', response.status, response.data);
    console.log(`\n📧 An email should have been sent to ${TEST_EMAIL} with the STL download link.`);
    console.log('📧 Check your server logs to confirm that the email was sent successfully.');
    
  } catch (error) {
    console.error('❌ Error testing webhook:', error.response ? error.response.data : error.message);
  }
}

// Run the test
console.log('====================================');
console.log('🧪 Stripe Webhook Email Test');
console.log('====================================');
testWebhook().then(() => {
  console.log('\n✅ Test completed');
}); 