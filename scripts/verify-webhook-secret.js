// Script to verify Stripe webhook secret
import dotenv from 'dotenv';
import { Stripe } from 'stripe';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!stripeSecretKey) {
  console.error('❌ ERROR: STRIPE_SECRET_KEY is missing from environment variables');
  process.exit(1);
}

if (!webhookSecret) {
  console.error('❌ ERROR: STRIPE_WEBHOOK_SECRET is missing from environment variables');
  process.exit(1);
}

console.log('✅ Stripe secret key found in environment variables');
console.log(`✅ Webhook secret found: ${webhookSecret.substring(0, 8)}...`);

// Initialize Stripe with secret key
const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16',
});

async function verifyWebhookEndpoints() {
  try {
    console.log('\n🔍 Checking Stripe webhook endpoints...');
    const webhookEndpoints = await stripe.webhookEndpoints.list({
      limit: 10,
    });
    
    if (webhookEndpoints.data.length === 0) {
      console.error('⚠️ No webhook endpoints found for this Stripe account!');
      return;
    }
    
    console.log(`Found ${webhookEndpoints.data.length} webhook endpoints:`);
    
    webhookEndpoints.data.forEach((endpoint, i) => {
      console.log(`\n[${i + 1}] Webhook Endpoint:`);
      console.log(`  URL: ${endpoint.url}`);
      console.log(`  Status: ${endpoint.status}`);
      console.log(`  Events: ${endpoint.enabled_events?.join(', ') || 'All events'}`);
      
      // Determine if this is the endpoint we're targeting
      const isTargetEndpoint = endpoint.url === 'https://3dcad.taiyaki.ai/api/webhook';
      
      if (isTargetEndpoint) {
        console.log(`  ✅ This is the target endpoint for 3dcad.taiyaki.ai!`);
      }
    });
    
    console.log('\n✅ Webhook verification complete');
  } catch (error) {
    console.error('Error checking webhook endpoints:', error);
  }
}

// Run the verification
verifyWebhookEndpoints(); 