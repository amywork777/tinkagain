import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

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
    
    // Convert base64 data to buffer
    const fileBuffer = Buffer.from(fileData, 'base64');
    
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
    
    // Upload file to Supabase Storage
    console.log(`[${new Date().toISOString()}] Uploading to Supabase...`);
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, fileBuffer, {
        contentType: fileType,
        cacheControl: '3600',
        upsert: true
      });
    
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