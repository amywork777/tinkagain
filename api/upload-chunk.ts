import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// API config for Vercel
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb' // Limit for each chunk
    }
  }
};

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl!, supabaseServiceKey!, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Bucket name
const BUCKET_NAME = 'stl-files-chunks';

// Process chunk upload
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS request (preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }
  
  try {
    // Validate request
    if (!req.body || !req.body.uploadId || req.body.chunkIndex === undefined || !req.body.chunkData) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: uploadId, chunkIndex, and chunkData are required'
      });
    }
    
    // Extract data
    const { 
      uploadId, 
      chunkIndex, 
      totalChunks, 
      chunkData, 
      fileName
    } = req.body;
    
    console.log(`[${new Date().toISOString()}] Processing chunk ${chunkIndex + 1}/${totalChunks} for upload ${uploadId}`);
    
    // Ensure the chunks bucket exists
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      const bucketExists = buckets.some(bucket => bucket.name === BUCKET_NAME);
      
      if (!bucketExists) {
        console.log(`[${new Date().toISOString()}] Creating bucket: ${BUCKET_NAME}`);
        await supabase.storage.createBucket(BUCKET_NAME, {
          public: false,
          fileSizeLimit: 52428800, // 50MB limit
        });
      }
    } catch (bucketError) {
      console.error(`[${new Date().toISOString()}] Bucket check/create error:`, bucketError);
      // Continue anyway, the bucket might exist
    }
    
    // Create chunk file path
    const chunkPath = `${uploadId}/${String(chunkIndex).padStart(5, '0')}.chunk`;
    
    // Convert base64 chunk data to buffer
    const chunkBuffer = Buffer.from(chunkData, 'base64');
    console.log(`[${new Date().toISOString()}] Chunk size: ${chunkBuffer.length} bytes`);
    
    // Upload chunk to Supabase
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(chunkPath, chunkBuffer, {
        contentType: 'application/octet-stream',
        upsert: true
      });
      
    if (error) {
      console.error(`[${new Date().toISOString()}] Chunk upload error:`, error);
      throw new Error(`Failed to upload chunk: ${error.message}`);
    }
    
    console.log(`[${new Date().toISOString()}] Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`);
    
    // Return success
    return res.status(200).json({
      success: true,
      chunkIndex,
      uploadId,
      message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`
    });
    
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Chunk upload error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Chunk upload failed'
    });
  }
}