// Script to test the Stripe webhook endpoint
import fetch from 'node-fetch';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!webhookSecret) {
  console.error('❌ ERROR: STRIPE_WEBHOOK_SECRET is missing from environment variables');
  process.exit(1);
}

// Create a sample payload similar to what Stripe would send
const payload = {
  id: 'evt_test_webhook',
  object: 'event',
  api_version: '2023-10-16',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: 'cs_test_webhook',
      object: 'checkout.session',
      mode: 'payment',
      payment_status: 'paid',
      metadata: {
        modelName: 'Test Model',
        color: 'Red',
        quantity: '1',
        finalPrice: '49.99',
        orderType: '3d_print'
      }
    }
  },
  type: 'checkout.session.completed',
  livemode: false
};

// Convert payload to string
const payloadString = JSON.stringify(payload);

// Create a signature using the webhook secret
const timestamp = Math.floor(Date.now() / 1000);
const signedPayload = `${timestamp}.${payloadString}`;
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(signedPayload)
  .digest('hex');

// Construct the Stripe signature header
const stripeSignature = `t=${timestamp},v1=${signature}`;

async function testWebhook() {
  const vercelEndpoint = 'https://3dcad.taiyaki.ai/api/webhook';
  
  console.log(`🔍 Testing webhook endpoint: ${vercelEndpoint}`);
  console.log(`🔑 Using webhook secret starting with: ${webhookSecret.substring(0, 8)}...`);
  console.log(`📦 Payload: ${payloadString.substring(0, 100)}...`);
  console.log(`🔏 Generated signature: ${stripeSignature.substring(0, 50)}...`);
  
  try {
    const response = await fetch(vercelEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': stripeSignature
      },
      body: payloadString
    });
    
    const responseText = await response.text();
    console.log(`\n✅ Response status: ${response.status}`);
    console.log(`✅ Response body: ${responseText}`);
    
    if (response.ok) {
      console.log('\n🎉 Webhook test successful! The endpoint is working correctly.');
    } else {
      console.error('\n❌ Webhook test failed! The endpoint returned an error.');
    }
  } catch (error) {
    console.error('\n❌ Error testing webhook:', error);
  }
}

// Run the test
testWebhook(); 