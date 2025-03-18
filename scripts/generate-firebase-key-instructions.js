#!/usr/bin/env node

/**
 * Script to provide instructions for generating a new Firebase service account key.
 * This will help the user fix their Firebase authentication issues.
 */

// Console colors for better readability
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bold: '\x1b[1m'
};

// Print a section header
function printHeader(title) {
  console.log('\n' + colors.blue + '='.repeat(70) + colors.reset);
  console.log(colors.blue + colors.bold + ` ${title} ` + colors.reset);
  console.log(colors.blue + '='.repeat(70) + colors.reset);
}

// Main function to display instructions
function displayInstructions() {
  console.clear();
  
  printHeader('FIREBASE SERVICE ACCOUNT KEY INSTRUCTIONS');
  
  console.log(`
${colors.bold}${colors.yellow}Your Firebase authentication is not working properly${colors.reset}

The error message "${colors.red}invalid_grant: Invalid JWT Signature${colors.reset}" indicates that your
Firebase private key is invalid or has been revoked. To fix this issue, you'll need
to generate a new service account key.

${colors.bold}${colors.green}Follow these steps to generate a new Firebase service account key:${colors.reset}

${colors.bold}1. Go to the Firebase Console:${colors.reset}
   ${colors.cyan}https://console.firebase.google.com/project/taiyaki-test1${colors.reset}
   
${colors.bold}2. Navigate to Project Settings:${colors.reset}
   - Click on the gear icon (⚙️) next to "Project Overview" in the left sidebar
   - Select "Project settings" from the menu
   
${colors.bold}3. Go to the "Service accounts" tab${colors.reset}
   
${colors.bold}4. Under "Firebase Admin SDK":${colors.reset}
   - Click the "Generate new private key" button
   - Confirm by clicking "Generate key" in the dialog
   - A JSON file will be downloaded to your computer
   
${colors.bold}5. Update your environment variables:${colors.reset}
   - Open the downloaded JSON file
   - Update your .env.local file with the following values from the JSON:
     ${colors.cyan}FIREBASE_PROJECT_ID=${colors.yellow}project_id value from JSON${colors.reset}
     ${colors.cyan}FIREBASE_CLIENT_EMAIL=${colors.yellow}client_email value from JSON${colors.reset}
     ${colors.cyan}FIREBASE_PRIVATE_KEY="${colors.yellow}private_key value from JSON${colors.reset}"
     ${colors.cyan}FIREBASE_STORAGE_BUCKET=${colors.yellow}${process.env.FIREBASE_PROJECT_ID || 'taiyaki-test1'}.appspot.com${colors.reset}
   
   ${colors.magenta}Important: Make sure to keep the quotes around the private key value!${colors.reset}
   
${colors.bold}6. Restart your server${colors.reset}
   - After updating your environment variables, restart your server
   - Run a test to confirm that Firebase is now working properly:
     ${colors.cyan}node scripts/upload-stl-to-firebase.js${colors.reset}

${colors.bold}${colors.green}Additional Notes:${colors.reset}

- If you're using the firebase-adminsdk-o2zgz@taiyaki-test1.iam.gserviceaccount.com service account,
  make sure it has the necessary permissions (Storage Admin, Storage Object Creator/Viewer).

- Keep your service account key secure! Never commit it to your repository.

- For Vercel deployment, you'll need to add these updated environment variables
  to your Vercel project settings as well.
`);

  printHeader('STRIPE TESTING');
  
  console.log(`
${colors.bold}${colors.green}To test your Stripe integration:${colors.reset}

1. Make sure your .env.local file has the correct Stripe variables:
   ${colors.cyan}STRIPE_SECRET_KEY=${colors.yellow}Your Stripe test secret key${colors.reset}
   ${colors.cyan}STRIPE_PUBLISHABLE_KEY=${colors.yellow}Your Stripe test publishable key${colors.reset}
   ${colors.cyan}STRIPE_WEBHOOK_SECRET=${colors.yellow}Your Stripe webhook secret${colors.reset}

2. Run the development server:
   ${colors.cyan}npm run dev${colors.reset}

3. In another terminal window, start the checkout server:
   ${colors.cyan}NODE_ENV=development node server/simple-checkout.cjs${colors.reset}

4. Test a checkout by visiting:
   ${colors.cyan}http://localhost:3000/checkout${colors.reset}
   or whichever route accesses your checkout page
`);
}

// Run the instructions display
displayInstructions(); 