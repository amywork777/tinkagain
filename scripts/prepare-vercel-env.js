// Script to prepare environment variables for Vercel deployment
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// List of required environment variables for Vercel
const requiredVars = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_STORAGE_BUCKET'
];

// Check if variables are present and create Vercel-friendly output
console.log('\n=== Vercel Environment Variables ===\n');
console.log('Copy and paste these into your Vercel project environment variables:');
console.log('\n---\n');

let allVarsPresent = true;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  
  if (!value) {
    console.error(`❌ Missing required variable: ${varName}`);
    allVarsPresent = false;
    return;
  }
  
  // Special handling for private key which needs to be escaped differently
  if (varName === 'FIREBASE_PRIVATE_KEY') {
    // For Vercel, we need to keep the literal \n characters
    console.log(`${varName}=${value.replace(/\\n/g, '\\n')}`);
  } else {
    console.log(`${varName}=${value}`);
  }
});

console.log('\n---\n');

if (allVarsPresent) {
  console.log('✅ All required environment variables are present');
  console.log('\n1. Copy the variables above to your Vercel project settings');
  console.log('2. Go to https://vercel.com/amywork777/tinkagain/settings/environment-variables');
  console.log('3. Paste them in the "Production" environment');
  console.log('4. Redeploy your project after adding the variables');
} else {
  console.error('❌ Some required environment variables are missing');
  console.error('Please ensure all variables are present in your .env.local file');
}

// Specific notes for webhook setup
console.log('\n=== Stripe Webhook Configuration ===\n');
console.log('Webhook Endpoint URL: https://3dcad.taiyaki.ai/api/webhook');
console.log(`Webhook Secret: ${process.env.STRIPE_WEBHOOK_SECRET || 'MISSING'}`);
console.log('\nEndpoints to register in Stripe Dashboard:');
console.log('- checkout.session.completed');
console.log('- payment_intent.succeeded');
console.log('- payment_intent.payment_failed');
console.log('\nMake sure the Stripe webhook signature header is passed correctly!'); 