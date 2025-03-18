#!/usr/bin/env node

/**
 * Direct Email Test Script
 * 
 * This script directly tests email sending using the provided credentials,
 * without relying on environment variables.
 */

const nodemailer = require('nodemailer');

// Use the credentials directly provided by the user
const EMAIL_USER = 'taiyaki.orders@gmail.com';
const EMAIL_PASSWORD = 'lfrq katt exfz jzoh';
const TEST_EMAIL = 'taiyaki.orders@gmail.com'; // Send to the same email

async function testEmail() {
  console.log('====================================');
  console.log('📧 Direct Email Test');
  console.log('====================================');
  
  console.log(`\n📧 Setting up email transporter for ${EMAIL_USER}...`);
  
  try {
    // Create the transporter with the direct credentials
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASSWORD
      }
    });
    
    console.log('📧 Transporter created successfully');
    
    // Create a simple test email
    const mailOptions = {
      from: EMAIL_USER,
      to: TEST_EMAIL,
      subject: 'Test Email from Taiyaki 3D Print Service',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #4a5568;">Direct Email Test</h1>
          
          <div style="background-color: #f7fafc; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <h2 style="margin-top: 0; color: #4a5568;">This is a test email</h2>
            <p>This email is being sent directly using the provided credentials.</p>
            <p>If you're seeing this, email sending is working properly!</p>
            <p>Time sent: ${new Date().toLocaleString()}</p>
          </div>
        </div>
      `
    };
    
    console.log(`📧 Sending test email to ${TEST_EMAIL}...`);
    
    // Send the email
    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully!');
    console.log(`📧 Message ID: ${info.messageId}`);
    
  } catch (error) {
    console.error('❌ Error sending email:', error);
    if (error.code === 'EAUTH') {
      console.error('Authentication failed. Check if your password is correct and if "Less secure app access" is enabled for your Google account.');
    }
  }
}

// Run the test
testEmail().then(() => {
  console.log('\n✅ Test completed');
}); 