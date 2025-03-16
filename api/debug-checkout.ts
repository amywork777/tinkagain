import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set appropriate CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  console.log('Debug checkout endpoint hit with method:', req.method);

  // Return information about the request
  const responseData = {
    success: true,
    message: 'Debug endpoint reached successfully',
    method: req.method,
    headers: req.headers,
    body: req.method === 'POST' ? req.body : null,
    query: req.query,
    timestamp: new Date().toISOString(),
    env: {
      stripeKeyPresent: !!process.env.STRIPE_SECRET_KEY,
      nodeEnv: process.env.NODE_ENV
    }
  };

  // Log the response for server-side debugging
  console.log('Debug endpoint returning:', {
    ...responseData,
    headers: 'Headers object (simplified)', // Don't log full headers
    body: responseData.body ? 'Body present' : null
  });

  res.status(200).json(responseData);
} 