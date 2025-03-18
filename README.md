# Model Fusion Studio

## Local Development Setup

This repository contains both the client and API server code for the Model Fusion Studio application.

### Getting Started

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Configure your `.env.local` file (see Environment Variables section below)

### Running the Application

For local development, use the following command to start both the client and API server:

```
npm run dev:client-api
```

This will start:
- The client on http://localhost:5173 (or the next available port)
- The API server on http://localhost:4001

### Testing Firestore Connectivity

To test if Firestore is working correctly:

1. Using the web interface: Visit `http://localhost:4001/test-firestore.html`
2. Using the command line: Run `npm run test:firestore`

### API Development

To run just the API server:

```
npm run test:api
```

### Environment Variables

The application requires the following environment variables to be set in `.env.local`:

```
# API port for local development
API_PORT=4001

# Stripe configuration
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
STRIPE_PRICE_MONTHLY=your_monthly_price_id
STRIPE_PRICE_ANNUAL=your_annual_price_id

# Firebase configuration
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_auth_domain
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_storage_bucket
FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
FIREBASE_APP_ID=your_app_id
FIREBASE_MEASUREMENT_ID=your_measurement_id

# Firebase Admin SDK
FIREBASE_PRIVATE_KEY=your_private_key
FIREBASE_CLIENT_EMAIL=your_client_email
FIREBASE_CLIENT_ID=your_client_id

# Server configuration
BASE_URL=http://localhost:4001
```

### Troubleshooting

If you encounter any issues with Firestore:

1. Verify your Firebase credentials in `.env.local`
2. Run the Firestore test: `npm run test:firestore`
3. Check if the Firebase console shows your project is properly set up
4. Verify that your Firebase rules allow read/write access to your collections 

# Supabase Storage Integration

The application has been updated to use Supabase for STL file storage instead of Firebase. This provides a more streamlined storage solution with simplified permission management.

## Storage Implementation

- STL files are stored in a Supabase bucket named `stl-files`
- Files are organized by date (YYYY/MM/DD) with a unique timestamp-based ID
- Storage operations are handled by the `server/supabase-storage.cjs` utility

## Testing the Integration

Two test scripts are available to verify the storage and checkout integrations:

1. `scripts/test-supabase-upload.js` - Tests direct upload to Supabase Storage
2. `scripts/test-upload-and-checkout.js` - Tests the full checkout process with STL upload

Run the scripts using Node.js:

```bash
node scripts/test-supabase-upload.js
node scripts/test-upload-and-checkout.js
```

## Configuration

The Supabase integration requires the following environment variables in `.env.local`:

```
SUPABASE_URL=your-project-url
SUPABASE_SERVICE_KEY=your-service-role-api-key
SUPABASE_ANON_KEY=your-anon-api-key
```

The bucket setup and CORS configuration are handled by the `scripts/create-supabase-bucket.js` script. 