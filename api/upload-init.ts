import { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

// API config for Vercel
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb' // Smaller limit for init is fine
    }
  }
};

// Initialize upload endpoint
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
    console.log(`[${new Date().toISOString()}] Upload initialization request received`);
    
    // Validate request
    if (!req.body || !req.body.fileName || !req.body.totalChunks) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: fileName and totalChunks are required'
      });
    }
    
    // Extract metadata
    const { 
      fileName, 
      totalChunks, 
      fileSize, 
      checksum, 
      contentType = 'application/octet-stream',
      uploadId = null
    } = req.body;
    
    // Generate unique upload ID if not provided
    const generatedUploadId = uploadId || `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    
    // Log the initialization
    console.log(`[${new Date().toISOString()}] Initializing chunked upload: 
      - File: ${fileName}
      - Total chunks: ${totalChunks}
      - File size: ${fileSize} bytes
      - Upload ID: ${generatedUploadId}`
    );
    
    // In a production system, we would store this metadata in a database
    // For this implementation, we'll rely on the client providing the uploadId in subsequent requests
    
    // Return the initialization data
    return res.status(200).json({
      success: true,
      uploadId: generatedUploadId,
      expiresAt: Date.now() + (3600 * 1000), // 1 hour expiry
      message: 'Upload initialized successfully'
    });
    
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Upload initialization error:`, error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Error initializing upload'
    });
  }
}