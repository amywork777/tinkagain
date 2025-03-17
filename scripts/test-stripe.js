// Test script to verify Stripe configuration
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import Stripe from 'stripe';
import { dirname } from 'path';

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local file
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Initialize Stripe with the loaded secret key
const stripe = process.env.STRIPE_SECRET_KEY ? 
  new Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Function to test the Stripe connection
async function testStripeConnection() {
  console.log('Testing Stripe connection...');
  
  if (!stripe) {
    console.error('❌ Stripe SDK could not be initialized. Check your STRIPE_SECRET_KEY in .env.local');
    return false;
  }
  
  try {
    // Test basic Stripe API functionality
    const paymentMethods = await stripe.paymentMethods.list({
      limit: 1,
      type: 'card',
    });
    
    console.log('✅ Successfully connected to Stripe API');
    console.log(`  - Using API key: ${process.env.STRIPE_SECRET_KEY.substring(0, 8)}...`);
    
    return true;
  } catch (error) {
    console.error('❌ Stripe API connection failed:', error.message);
    return false;
  }
}

// Function to create a test checkout session
async function createTestCheckoutSession() {
  console.log('Creating a test checkout session...');
  
  if (!stripe) {
    console.error('❌ Stripe SDK could not be initialized. Check your STRIPE_SECRET_KEY in .env.local');
    return null;
  }
  
  try {
    // Create a test product
    const product = await stripe.products.create({
      name: 'Test 3D Print Model',
      description: 'A test 3D model for printing',
    });
    console.log(`  - Created test product: ${product.id}`);
    
    // Create a test price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 2000, // $20.00
      currency: 'usd',
    });
    console.log(`  - Created test price: ${price.id} ($${price.unit_amount/100})`);
    
    // Create a checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'http://localhost:5173/checkout-success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://localhost:5173/checkout-cancel',
    });
    
    console.log('✅ Successfully created test checkout session');
    console.log(`  - Session ID: ${session.id}`);
    console.log(`  - Checkout URL: ${session.url}`);
    
    return session;
  } catch (error) {
    console.error('❌ Failed to create test checkout session:', error.message);
    return null;
  }
}

// Run the test functions
async function runTests() {
  console.log('======== STRIPE TEST SCRIPT ========');
  console.log('Testing Stripe configuration with test keys');
  console.log('=====================================');
  
  const isConnected = await testStripeConnection();
  
  if (isConnected) {
    const session = await createTestCheckoutSession();
    
    if (session) {
      console.log('\n✨ TEST PASSED: Stripe is properly configured!');
      console.log('\nTo test the checkout flow, visit:');
      console.log(session.url);
    } else {
      console.log('\n❌ TEST FAILED: Could not create a checkout session');
    }
  } else {
    console.log('\n❌ TEST FAILED: Could not connect to Stripe');
  }
  
  console.log('\n=====================================');
}

// Execute the tests
runTests(); 