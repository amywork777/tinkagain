/**
 * Supabase Storage Utilities for STL Files
 * 
 * This file contains helper functions for storing and retrieving STL files
 * from Supabase Storage, replacing the Firebase implementation.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hcegtlueiyeebzwbnasv.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_NAME = 'stl-files';

// Initialize Supabase client
let supabaseClient = null;

/**
 * Get or initialize the Supabase client
 * @returns {Object} Initialized Supabase client
 */
function getSupabaseClient() {
  if (!supabaseClient) {
    if (!SUPABASE_SERVICE_KEY) {
      throw new Error('Missing SUPABASE_SERVICE_KEY environment variable');
    }
    
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  
  return supabaseClient;
}

/**
 * Store an STL file in Supabase Storage
 * @param {string|Buffer} stlData - The STL data to store, either as a base64 string or Buffer
 * @param {string} fileName - The name of the STL file
 * @returns {Promise<{downloadUrl: string, publicUrl: string, storagePath: string, fileName: string, fileSize: number}>}
 */
async function storeSTLInSupabase(stlData, fileName) {
  console.log(`[${new Date().toISOString()}] Preparing to store STL file in Supabase Storage...`);
  
  // Check if Supabase is initialized
  try {
    const supabase = getSupabaseClient();
    
    // Debug the type of stlData
    console.log(`[${new Date().toISOString()}] STL data type: ${typeof stlData}`);
    if (typeof stlData === 'string') {
      console.log(`[${new Date().toISOString()}] STL data string preview: ${stlData.substring(0, 100)}...`);
      console.log(`[${new Date().toISOString()}] STL data length: ${stlData.length} characters`);
    } else if (Buffer.isBuffer(stlData)) {
      console.log(`[${new Date().toISOString()}] STL data is a Buffer of size: ${stlData.length} bytes`);
    } else {
      console.log(`[${new Date().toISOString()}] STL data is of unexpected type: ${typeof stlData}`);
    }
    
    let tempFilePath;
    
    try {
      // Create a safe filename (replace spaces and special chars)
      const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      
      // Process the STL data
      let stlBuffer;
      console.log(`[${new Date().toISOString()}] Processing ${typeof stlData === 'string' ? 'base64' : 'buffer'} STL data...`);
      
      if (typeof stlData === 'string') {
        // If stlData is a base64 string, convert it to buffer
        let base64Data;
        
        // Check if the data is a data URL (starts with data:)
        if (stlData.startsWith('data:')) {
          console.log(`[${new Date().toISOString()}] Detected data URL format, extracting base64 content`);
          // Extract the base64 part if it's a data URL
          const parts = stlData.split(',');
          if (parts.length >= 2) {
            base64Data = parts[1];
            console.log(`[${new Date().toISOString()}] Successfully extracted base64 data of length: ${base64Data.length} characters`);
          } else {
            console.error(`[${new Date().toISOString()}] Invalid data URL format`);
            base64Data = stlData; // Use as is if splitting failed
          }
        } else {
          console.log(`[${new Date().toISOString()}] Using direct base64 data`);
          // Assume it's already base64
          base64Data = stlData.replace(/^base64,/, '');
        }
        
        try {
          stlBuffer = Buffer.from(base64Data, 'base64');
          console.log(`[${new Date().toISOString()}] Converted base64 data to buffer of size: ${stlBuffer.length} bytes`);
        } catch (bufferError) {
          console.error(`[${new Date().toISOString()}] Failed to convert base64 to buffer:`, bufferError);
          throw new Error(`Failed to process STL data: ${bufferError.message}`);
        }
      } else if (Buffer.isBuffer(stlData)) {
        stlBuffer = stlData;
        console.log(`[${new Date().toISOString()}] Using provided buffer data of size: ${stlBuffer.length} bytes`);
      } else {
        console.error(`[${new Date().toISOString()}] Unsupported STL data format: ${typeof stlData}`);
        throw new Error(`Unsupported STL data format: ${typeof stlData}`);
      }
      
      const fileSize = stlBuffer.length;
      console.log(`[${new Date().toISOString()}] STL file size: ${fileSize} bytes`);
      
      // Write to a temporary file
      const timestamp = Date.now();
      const uniqueId = crypto.randomBytes(8).toString('hex');
      const tempDir = path.join(os.tmpdir(), 'stl-uploads');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      tempFilePath = path.join(tempDir, `${timestamp}-${uniqueId}-${safeFileName}`);
      
      console.log(`[${new Date().toISOString()}] Writing STL data to temporary file: ${tempFilePath}`);
      fs.writeFileSync(tempFilePath, stlBuffer);
      console.log(`[${new Date().toISOString()}] Temporary STL file created successfully`);
      
      // Create a path in Supabase Storage organized by date (YYYY/MM/DD)
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      
      const storagePath = `${year}/${month}/${day}/${timestamp}-${uniqueId}-${safeFileName}`;
      console.log(`[${new Date().toISOString()}] Supabase Storage path: ${storagePath}`);
      
      // Upload file to Supabase
      console.log(`[${new Date().toISOString()}] Uploading to Supabase Storage bucket: ${BUCKET_NAME}`);
      
      const fileData = fs.readFileSync(tempFilePath);
      
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, fileData, {
          contentType: 'model/stl',
          cacheControl: '3600',
          upsert: false
        });
      
      if (error) {
        throw new Error(`Supabase upload failed: ${error.message}`);
      }
      
      console.log(`[${new Date().toISOString()}] STL file uploaded successfully to Supabase Storage`);
      
      // Get public URL with 10 year expiry
      const tenYearsInSeconds = 315360000; // 10 years in seconds
      
      console.log(`[${new Date().toISOString()}] Creating signed URL with ${tenYearsInSeconds} seconds validity (10 years)`);
      
      // For production, make sure we use the right parameters
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 10);
      console.log(`[${new Date().toISOString()}] URL will expire on: ${expiryDate.toISOString()}`);
      
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(storagePath, tenYearsInSeconds);
      
      if (signedUrlError) {
        console.error(`[${new Date().toISOString()}] Error creating signed URL:`, signedUrlError);
        throw new Error(`Failed to create signed URL: ${signedUrlError.message}`);
      }
      
      if (!signedUrlData || !signedUrlData.signedUrl) {
        console.error(`[${new Date().toISOString()}] Signed URL data missing or invalid:`, signedUrlData);
        throw new Error('Signed URL generation failed - no URL returned');
      }
      
      const signedUrl = signedUrlData.signedUrl;
      console.log(`[${new Date().toISOString()}] Signed URL successfully created. URL length: ${signedUrl.length}`);
      
      // Also get a permanent public URL
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(storagePath);
      
      if (!publicUrlData || !publicUrlData.publicUrl) {
        console.error(`[${new Date().toISOString()}] Public URL data missing or invalid:`, publicUrlData);
      }
      
      const publicUrl = publicUrlData?.publicUrl || '';
      
      console.log(`[${new Date().toISOString()}] Generated public URL: ${publicUrl.substring(0, 100)}...`);
      console.log(`[${new Date().toISOString()}] Generated signed URL (valid for 10 years): ${signedUrl.substring(0, 100)}...`);
      
      // Clean up the temporary file
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          console.log(`[${new Date().toISOString()}] Temporary file deleted`);
        }
      } catch (cleanupError) {
        console.error(`[${new Date().toISOString()}] Error deleting temporary file:`, cleanupError);
      }
      
      return {
        downloadUrl: signedUrl,
        publicUrl: publicUrl,
        storagePath: `${BUCKET_NAME}/${storagePath}`,
        fileName: safeFileName,
        fileSize: fileSize
      };
      
    } catch (error) {
      // Clean up temporary file in case of error
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          console.log(`[${new Date().toISOString()}] Temporary file deleted`);
        } catch (cleanupError) {
          console.error(`[${new Date().toISOString()}] Error deleting temporary file:`, cleanupError);
        }
      }
      
      // Handle errors gracefully with fallback URLs
      console.error(`[${new Date().toISOString()}] Supabase storage error:`, error);
      
      // Create fallback URLs for development and testing
      if (process.env.NODE_ENV === 'development') {
        const timestamp = Date.now();
        const uniqueId = crypto.randomBytes(8).toString('hex');
        const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        
        // In development, create mock URLs with a clear indication they're fallbacks
        const host = process.env.BASE_URL || 'http://localhost:4002';
        const mockStoragePath = `stl-files/${year}/${month}/${day}/${timestamp}-${uniqueId}-${safeFileName}`;
        const mockDownloadUrl = `${host}/mock-stl-downloads/${timestamp}-${uniqueId}-${safeFileName}?error=true`;
        
        console.log(`[${new Date().toISOString()}] Using fallback URLs for development`);
        
        return {
          downloadUrl: mockDownloadUrl,
          publicUrl: mockDownloadUrl,
          storagePath: mockStoragePath,
          fileName: safeFileName,
          fileSize: typeof stlData === 'string' ? stlData.length : (Buffer.isBuffer(stlData) ? stlData.length : 0),
          isFallback: true
        };
      }
      
      throw new Error(`Supabase upload failed: ${error.message}`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] STL storage error:`, error);
    throw new Error(`Supabase upload failed: ${error.message}`);
  }
}

module.exports = {
  storeSTLInSupabase,
  getSupabaseClient
}; 