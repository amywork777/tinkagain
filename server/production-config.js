/**
 * Production Configuration Helper
 * 
 * This file helps ensure that production environment behaves the same as development.
 * Include this at the top of your server file in production.
 */

// Force consistent behavior between environments
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Ensure Supabase storage bucket is correctly set
if (!process.env.SUPABASE_STORAGE_BUCKET) {
  console.log('[PRODUCTION CONFIG] Setting SUPABASE_STORAGE_BUCKET to stl-files');
  process.env.SUPABASE_STORAGE_BUCKET = 'stl-files';
}

// Ensure base URL is set for file URLs
if (!process.env.BASE_URL) {
  console.log('[PRODUCTION CONFIG] Setting BASE_URL from request origin or default');
  // This will be dynamically updated on first request
  process.env.BASE_URL = 'https://your-vercel-url.vercel.app';
}

// Ensure API port is set properly
if (!process.env.API_PORT) {
  console.log('[PRODUCTION CONFIG] Setting API_PORT to 443 (HTTPS standard)');
  process.env.API_PORT = 443;
}

// Log what we have
console.log('[PRODUCTION CONFIG] Environment settings:');
console.log('[PRODUCTION CONFIG] NODE_ENV:', process.env.NODE_ENV);
console.log('[PRODUCTION CONFIG] SUPABASE_STORAGE_BUCKET:', process.env.SUPABASE_STORAGE_BUCKET);
console.log('[PRODUCTION CONFIG] BASE_URL:', process.env.BASE_URL);
console.log('[PRODUCTION CONFIG] API_PORT:', process.env.API_PORT);

// Export nothing - this file is just for its side effects
module.exports = {}; 