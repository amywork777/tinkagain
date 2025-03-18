import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Initialize Supabase client with custom options for large files
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Log environment variables (without exposing keys)
console.log(`Supabase URL configured: ${supabaseUrl ? 'Yes' : 'No'}`);
console.log(`Supabase Service Key configured: ${supabaseServiceKey ? 'Yes' : 'No'}`);

// Create client with increased timeouts
const supabase = createClient(supabaseUrl!, supabaseServiceKey!, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  global: {
    fetch: (url, options) => {
      // Set a 2-minute timeout for all Supabase requests
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), 120000); // 2 minutes
      
      // Combine the abort signal with existing options
      const fetchOptions = {
        ...options,
        signal: timeoutController.signal
      };
      
      return fetch(url, fetchOptions).finally(() => {
        clearTimeout(timeoutId);
      });
    }
  }
});

// Constants
const BUCKET_NAME = 'stl-files';

// Helper function to create a response
const createResponse = (res: VercelResponse, statusCode: number, data: any) => {
  return res.status(statusCode).json(data);
};

// API route handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[${new Date().toISOString()}] Upload to Supabase request received`);
  
  try {
    // Validate request
    if (!req.body || !req.body.fileName || !req.body.fileData) {
      return createResponse(res, 400, {
        success: false,
        error: 'Missing required fields: fileName and fileData are required'
      });
    }
    
    // Extract information from request
    const { fileName, fileData, fileType = 'application/octet-stream' } = req.body;
    
    // Sanitize the file name
    const safeFileName = fileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    
    // Make sure the fileData is properly formatted
    let processedFileData = fileData;
    
    // Check if the data is a dataURL and extract just the base64 part if needed
    if (fileData.startsWith('data:') && fileData.includes('base64,')) {
      console.log(`[${new Date().toISOString()}] Detected data URL format, extracting base64 content`);
      processedFileData = fileData.split('base64,')[1];
    }
    
    // Convert base64 data to buffer with error handling
    console.log(`[${new Date().toISOString()}] Converting base64 to buffer`);
    let fileBuffer;
    try {
      fileBuffer = Buffer.from(processedFileData, 'base64');
      if (fileBuffer.length === 0) {
        throw new Error('Empty buffer created');
      }
    } catch (bufferError) {
      console.error(`[${new Date().toISOString()}] Buffer conversion error:`, bufferError);
      throw new Error(`Failed to process file data: ${bufferError instanceof Error ? bufferError.message : 'Unknown error'}`);
    }
    
    console.log(`[${new Date().toISOString()}] Processing file: ${safeFileName}, size: ${fileBuffer.length} bytes`);
    
    // Generate a unique storage path with date-based organization
    const timestamp = Date.now();
    const uniqueId = crypto.randomBytes(8).toString('hex');
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    const storagePath = `${year}/${month}/${day}/${timestamp}-${uniqueId}-${safeFileName}`;
    console.log(`[${new Date().toISOString()}] Supabase Storage path: ${storagePath}`);
    
    // Ensure bucket exists
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
    
    // Add size check and chunking for larger files
    console.log(`[${new Date().toISOString()}] Uploading to Supabase...`);
    
    // Log the file size for debugging
    console.log(`[${new Date().toISOString()}] File size: ${fileBuffer.length} bytes`);
    
    // If file is over 5MB, log a warning but continue
    if (fileBuffer.length > 5 * 1024 * 1024) {
      console.log(`[${new Date().toISOString()}] WARNING: Large file detected (${Math.round(fileBuffer.length / (1024 * 1024))}MB)`);
    }
    
    // Implement chunking and retry logic for large files
    let data: any, error: any;
    
    // For large files (over 6MB), implement retry logic
    const maxRetries = 3;
    const CHUNK_SIZE_THRESHOLD = 6 * 1024 * 1024; // 6MB
    
    if (fileBuffer.length > CHUNK_SIZE_THRESHOLD) {
      console.log(`[${new Date().toISOString()}] Large file detected. Implementing retry logic with ${maxRetries} attempts.`);
    }
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[${new Date().toISOString()}] Upload attempt ${attempt} of ${maxRetries}`);
        
        // Add a small delay between retries
        if (attempt > 1) {
          const delayMs = 2000 * (attempt - 1); // 2s, 4s for retries
          console.log(`[${new Date().toISOString()}] Waiting ${delayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        // Perform upload with extended timeout
        const uploadResponse = await supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, fileBuffer, {
            contentType: fileType,
            cacheControl: '3600',
            upsert: true
          });
        
        // If upload succeeded, break out of retry loop
        data = uploadResponse.data;
        error = uploadResponse.error;
        
        if (!error) {
          console.log(`[${new Date().toISOString()}] Upload succeeded on attempt ${attempt}`);
          break;
        } else if (attempt < maxRetries) {
          console.log(`[${new Date().toISOString()}] Attempt ${attempt} failed: ${error.message}, will retry`);
        }
      } catch (uploadError) {
        console.error(`[${new Date().toISOString()}] Upload attempt ${attempt} failed with exception:`, uploadError);
        
        // If this is the last retry, throw the error
        if (attempt === maxRetries) {
          throw new Error(`Upload failed after ${maxRetries} attempts: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`);
        }
        
        console.log(`[${new Date().toISOString()}] Will retry upload...`);
      }
    }
    
    if (error) {
      console.error(`[${new Date().toISOString()}] Supabase upload error:`, error);
      throw new Error(`Supabase upload failed: ${error.message}`);
    }
    
    console.log(`[${new Date().toISOString()}] File uploaded successfully to Supabase`);
    
    // Create a signed URL with long expiry (10 years)
    const tenYearsInSeconds = 315360000; // 10 years in seconds
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(storagePath, tenYearsInSeconds);
    
    if (signedUrlError) {
      console.error(`[${new Date().toISOString()}] Signed URL error:`, signedUrlError);
      throw new Error(`Failed to create signed URL: ${signedUrlError.message}`);
    }
    
    // Get public URL as backup
    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);
    
    // Return success response with URLs and path
    return createResponse(res, 200, {
      success: true,
      url: signedUrlData.signedUrl,
      publicUrl: publicUrlData.publicUrl,
      path: storagePath,
      fileName: safeFileName,
      fileSize: fileBuffer.length
    });
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Upload error:`, error);
    return createResponse(res, 500, {
      success: false,
      error: error.message || 'File upload failed'
    });
  }
}