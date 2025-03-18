import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// API config for Vercel
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb' // Limit for completion request
    },
    maxDuration: 60 // 60 seconds timeout for this function
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

// Bucket names
const CHUNKS_BUCKET = 'stl-files-chunks';
const FINAL_BUCKET = 'stl-files';

// Complete chunked upload
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
    if (!req.body || !req.body.uploadId || !req.body.fileName || !req.body.totalChunks) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: uploadId, fileName, and totalChunks are required'
      });
    }
    
    // Extract data with support for v2 client
    const { 
      uploadId, 
      fileName,
      totalChunks,
      checksum,
      uploadedChunks = [], // Optional array of successfully uploaded chunk indices
      version = '1.0'      // API version
    } = req.body;
    
    console.log(`[${new Date().toISOString()}] Completing upload ${uploadId}, client version: ${version}`);
    console.log(`[${new Date().toISOString()}] Upload metadata: ${fileName}, ${totalChunks} chunks`);
    
    // If client sent uploadedChunks, log which chunks should be present
    if (uploadedChunks && Array.isArray(uploadedChunks) && uploadedChunks.length > 0) {
      console.log(`[${new Date().toISOString()}] Client reported ${uploadedChunks.length} of ${totalChunks} chunks uploaded`);
      if (uploadedChunks.length < totalChunks) {
        console.log(`[${new Date().toISOString()}] Warning: Incomplete upload, proceeding with available chunks`);
      }
    }
    
    console.log(`[${new Date().toISOString()}] Completing upload ${uploadId} with ${totalChunks} chunks`);
    
    // Ensure the final bucket exists
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      const bucketExists = buckets.some(bucket => bucket.name === FINAL_BUCKET);
      
      if (!bucketExists) {
        console.log(`[${new Date().toISOString()}] Creating bucket: ${FINAL_BUCKET}`);
        await supabase.storage.createBucket(FINAL_BUCKET, {
          public: false,
          fileSizeLimit: 104857600, // 100MB limit
        });
      }
    } catch (bucketError) {
      console.error(`[${new Date().toISOString()}] Bucket check/create error:`, bucketError);
      // Continue anyway, the bucket might exist
    }
    
    // List all chunks with detailed logging
    console.log(`[${new Date().toISOString()}] Listing chunks for upload ID: ${uploadId}`);
    
    const { data: chunksData, error: listError } = await supabase.storage
      .from(CHUNKS_BUCKET)
      .list(uploadId);
      
    if (listError) {
      console.error(`[${new Date().toISOString()}] Error listing chunks:`, listError);
      throw new Error(`Failed to list chunks: ${listError.message}`);
    }
    
    // Log chunk information
    console.log(`[${new Date().toISOString()}] Found ${chunksData?.length || 0} chunks in bucket`);
    if (chunksData && chunksData.length > 0) {
      chunksData.forEach((chunk, i) => {
        console.log(`[${new Date().toISOString()}] Chunk ${i}: ${chunk.name}, size: ${chunk.metadata?.size || 'unknown'} bytes`);
      });
    }
    
    // Verify all chunks are present
    if (!chunksData || chunksData.length !== totalChunks) {
      const errorMsg = `Chunks mismatch: expected ${totalChunks}, found ${chunksData?.length || 0}`;
      console.error(`[${new Date().toISOString()}] ${errorMsg}`);
      return res.status(400).json({
        success: false,
        error: errorMsg
      });
    }
    
    // Sort chunks by index
    const sortedChunks = chunksData.sort((a, b) => {
      const aIndex = parseInt(a.name.split('.')[0]);
      const bIndex = parseInt(b.name.split('.')[0]);
      return aIndex - bIndex;
    });
    
    console.log(`[${new Date().toISOString()}] All ${totalChunks} chunks found, assembling file`);
    
    // Assemble the chunks into the final file
    let assembledFile = Buffer.alloc(0);
    
    for (let i = 0; i < sortedChunks.length; i++) {
      const chunkPath = `${uploadId}/${sortedChunks[i].name}`;
      
      try {
        // Download the chunk with type logging
        console.log(`[${new Date().toISOString()}] Downloading chunk ${i+1}: ${chunkPath}`);
        const { data: chunkBlob, error: downloadError } = await supabase.storage
          .from(CHUNKS_BUCKET)
          .download(chunkPath);
          
        if (downloadError || !chunkBlob) {
          console.error(`[${new Date().toISOString()}] Error downloading chunk ${i}:`, downloadError);
          throw new Error(`Failed to download chunk ${i}: ${downloadError?.message || 'Unknown error'}`);
        }
        
        console.log(`[${new Date().toISOString()}] Chunk ${i+1} downloaded, type: ${typeof chunkBlob}${chunkBlob instanceof Blob ? ', is Blob' : ''}${Buffer.isBuffer(chunkBlob) ? ', is Buffer' : ''}`);
        
        if (chunkBlob instanceof Blob) {
          console.log(`[${new Date().toISOString()}] Blob size: ${chunkBlob.size} bytes, type: ${chunkBlob.type}`);
        }
        
        // Fix: Handle different blob types properly
        let chunkBuffer;
        
        if (chunkBlob instanceof Blob) {
          // Convert Blob to ArrayBuffer
          const arrayBuffer = await chunkBlob.arrayBuffer();
          // Then convert ArrayBuffer to Buffer
          chunkBuffer = Buffer.from(arrayBuffer);
        } else if (Buffer.isBuffer(chunkBlob)) {
          // Already a buffer
          chunkBuffer = chunkBlob;
        } else if (chunkBlob instanceof Uint8Array) {
          // Convert Uint8Array to Buffer
          chunkBuffer = Buffer.from(chunkBlob);
        } else if (typeof chunkBlob === 'object' && chunkBlob !== null && 'arrayBuffer' in chunkBlob && typeof chunkBlob.arrayBuffer === 'function') {
          // Generic ArrayBuffer-like object
          const arrayBuffer = await chunkBlob.arrayBuffer();
          chunkBuffer = Buffer.from(arrayBuffer);
        } else {
          throw new Error(`Unsupported chunk data type: ${typeof chunkBlob}`);
        }
        
        // Log chunk buffer type and size for debugging
        console.log(`[${new Date().toISOString()}] Chunk ${i+1} type: ${Buffer.isBuffer(chunkBuffer) ? 'Buffer' : typeof chunkBuffer}, size: ${chunkBuffer.length} bytes`);
        
        // Append to assembled file
        assembledFile = Buffer.concat([assembledFile, chunkBuffer]);
        
        console.log(`[${new Date().toISOString()}] Added chunk ${i + 1}/${totalChunks}, total size: ${assembledFile.length} bytes`);
      } catch (chunkError) {
        console.error(`[${new Date().toISOString()}] Error processing chunk ${i}:`, chunkError);
        throw new Error(`Failed to process chunk ${i}: ${chunkError instanceof Error ? chunkError.message : 'Unknown error'}`);
      }
    }
    
    // Generate a unique storage path with date-based organization
    const timestamp = Date.now();
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const storagePath = `${year}/${month}/${day}/${timestamp}-${uniqueId}-${fileName}`;
    console.log(`[${new Date().toISOString()}] Final file path: ${storagePath}`);
    
    // Upload the assembled file
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(FINAL_BUCKET)
      .upload(storagePath, assembledFile, {
        contentType: 'application/octet-stream',
        upsert: true
      });
      
    if (uploadError) {
      console.error(`[${new Date().toISOString()}] Error uploading assembled file:`, uploadError);
      throw new Error(`Failed to upload assembled file: ${uploadError.message}`);
    }
    
    console.log(`[${new Date().toISOString()}] Assembled file uploaded successfully`);
    
    // Create URLs for the file
    const { data: signedUrlData } = await supabase.storage
      .from(FINAL_BUCKET)
      .createSignedUrl(storagePath, 315360000); // 10 years
      
    const { data: publicUrlData } = supabase.storage
      .from(FINAL_BUCKET)
      .getPublicUrl(storagePath);
    
    // Clean up chunks (as a background task - don't await)
    Promise.all(sortedChunks.map(chunk => {
      return supabase.storage
        .from(CHUNKS_BUCKET)
        .remove([`${uploadId}/${chunk.name}`]);
    })).catch(err => {
      console.error(`[${new Date().toISOString()}] Error cleaning up chunks:`, err);
      // Non-critical error, so don't throw
    });
    
    // Return success with file URLs
    return res.status(200).json({
      success: true,
      url: signedUrlData?.signedUrl,
      publicUrl: publicUrlData?.publicUrl,
      path: storagePath,
      fileName: fileName,
      fileSize: assembledFile.length,
      message: 'File assembled and uploaded successfully'
    });
    
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Upload completion error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Upload completion failed'
    });
  }
}