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