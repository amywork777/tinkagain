import { VercelRequest, VercelResponse } from '@vercel/node';
import { Stripe } from 'stripe';
import { buffer } from 'micro';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
let supabaseClient: any = null;
let supabaseInitialized = false;

// Initialize Supabase if needed
function initializeSupabase() {
  if (!supabaseInitialized) {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
      
      if (!supabaseUrl) {
        console.error('Supabase URL is missing');
      }
      
      if (!supabaseKey) {
        console.error('Supabase service key is missing');
      }
      
      if (supabaseUrl && supabaseKey) {
        supabaseClient = createClient(supabaseUrl, supabaseKey);
        supabaseInitialized = true;
        console.log('Supabase client initialized in webhook handler');
      } else {
        console.error('Cannot initialize Supabase: missing configuration');
      }
    } catch (error) {
      console.error('Error initializing Supabase:', error);
    }
  } else {
    console.log('Using existing Supabase client instance');
  }
  
  return supabaseClient;
}

// Define interfaces for type safety
interface UserData {
  uid?: string;
  email?: string;
  is_pro?: boolean;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  subscription_status?: string;
  subscription_end_date?: string;
  subscription_plan?: string;
  models_remaining_this_month?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: any; // Allow additional properties
}

// This is a special helper for raw bodies in Vercel serverless functions
export const config = {
  api: {
    bodyParser: false, // Disable body parsing, needed for Stripe webhook verification
    maxDuration: 60 // Set maximum execution time to 60 seconds
  },
};

// Initialize Stripe with the secret key
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2023-10-16' as any,
});

// Debugging guard to catch undefined references
function safeObjectCheck(obj: any, property: string): boolean {
  try {
    return obj && typeof obj === 'object' && property in obj;
  } catch (error) {
    console.error(`Error checking property ${property}:`, error);
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Debug: Log the request information
  console.log(`Webhook received: ${req.method} ${req.url}`);
  
  // Special handling for OPTIONS requests (CORS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, stripe-signature');
    res.status(200).end();
    return;
  }
  
  // Only allow POST for webhooks
  if (req.method !== 'POST') {
    console.error(`Invalid method: ${req.method}`);
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // Get the raw request body for Stripe webhook signature verification
  let rawBody: Buffer;
  try {
    rawBody = await buffer(req);
    console.log(`Raw body received, length: ${rawBody.length} bytes`);
  } catch (error) {
    console.error('Error getting raw request body:', error);
    return res.status(400).json({ success: false, message: 'Error reading request body' });
  }

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('Missing STRIPE_WEBHOOK_SECRET environment variable');
    return res.status(500).json({ success: false, message: 'Webhook secret not configured' });
  }

  if (!sig) {
    console.error('Missing stripe-signature header');
    return res.status(400).json({ success: false, message: 'Missing signature header' });
  }

  let event: Stripe.Event;

  try {
    // Verify the event came from Stripe using raw body
    event = stripe.webhooks.constructEvent(
      rawBody.toString(),
      sig,
      webhookSecret
    );
    console.log(`✅ Stripe signature verified for event: ${event.type}, id: ${event.id}`);
  } catch (err: any) {
    console.error(`⚠️ Webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ success: false, message: `Webhook Error: ${err.message}` });
  }

  try {
    // Initialize Supabase
    const supabase = initializeSupabase();
    
    // Added defensive logging
    if (!supabase) {
      console.log('WARNING: Supabase client not initialized, continuing with limited functionality');
    }
    
    console.log(`Processing webhook event: ${event.type}, id: ${event.id}`);

    // Handle the event based on its type
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`Processing completed checkout session: ${session.id}`);
        
        // Safely check if this is a 3D print order with defensive code
        let is3DPrintOrder = false;
        
        // Add null checks before accessing properties
        if (session && session.metadata) {
          is3DPrintOrder = 
            session.metadata.orderType === '3d_print' ||
            session.metadata.type === '3d_print' ||
            session.metadata.is3DPrint === 'true';
        }
        
        console.log('Order metadata:', session.metadata);
        console.log('Is 3D print order:', is3DPrintOrder);
        
        if (is3DPrintOrder) {
          console.log('Processing 3D print order');
          
          // Update model status in Supabase if we have a modelId
          if (session.metadata && session.metadata.modelId && supabase) {
            const modelId = session.metadata.modelId;
            console.log(`Updating model ${modelId} status to paid`);
            
            const { data, error } = await supabase
              .from('models')
              .update({ status: 'paid', payment_completed_at: new Date().toISOString() })
              .eq('id', modelId);
              
            if (error) {
              console.error('Error updating model status:', error);
            } else {
              console.log('Model status updated successfully');
            }
          }
          
          // Handle 3D print checkout completed - no subscription handling needed
          console.log('3D print order payment completed');
          break;
        }
        
        // Only continue with subscription handling if this is a subscription checkout
        if (session.mode !== 'subscription') {
          console.log('Not a subscription checkout, skipping');
          break;
        }
        
        // Make sure we have a subscription ID
        if (!session.subscription) {
          console.error('No subscription ID in completed session');
          break;
        }
        
        // Fetch more details about the subscription
        const subscriptionId = typeof session.subscription === 'string' 
          ? session.subscription 
          : session.subscription.id;
          
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        console.log(`Retrieved subscription: ${subscription.id}, status: ${subscription.status}`);
        
        // Get user ID from session metadata or customer metadata
        let userId = session.metadata?.userId;
        console.log(`Initial userId from session metadata: ${userId || 'not found'}`);
        
        // If no user ID in session metadata, try to get it from customer metadata
        if (!userId && session.customer) {
          console.log(`Looking up customer metadata for customer: ${session.customer}`);
          const customerId = typeof session.customer === 'string' 
            ? session.customer 
            : session.customer.id;
            
          const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
          
          userId = customer.metadata?.userId;
          console.log(`UserId from customer metadata: ${userId || 'not found'}`);
        }
        
        if (!userId) {
          console.error('No user ID found in session or customer metadata');
          break;
        }
        
        if (!supabase) {
          console.error('Supabase client not initialized, cannot update user subscription');
          break;
        }
        
        console.log(`Updating subscription status for user: ${userId}`);
        
        // Get subscription plan info - add null checks
        const priceId = subscription.items.data && 
                       subscription.items.data.length > 0 && 
                       subscription.items.data[0].price ? 
          subscription.items.data[0].price.id : 
          'unknown';
        
        // Get customer ID - add null checks
        const customerId = typeof session.customer === 'string' 
          ? session.customer 
          : session.customer?.id;
          
        // Calculate end date - add null checks
        const endDate = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default to 30 days from now
        
        // Log the update we're about to make
        console.log(`Setting user ${userId} to is_pro=true, with subscription ID ${subscription.id}, status ${subscription.status}`);
        
        // Update user subscription status in Supabase
        const updateData: UserData = {
          is_pro: true,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          subscription_status: subscription.status,
          subscription_end_date: endDate.toISOString(),
          subscription_plan: priceId,
          models_remaining_this_month: 999999, // Effectively unlimited
          updated_at: new Date().toISOString()
        };
        
        console.log(`Updating Supabase record for user ${userId} with:`, JSON.stringify(updateData));
        
        // Check if the user exists first
        const { data: existingUser, error: userFetchError } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();
          
        if (userFetchError) {
          console.error(`Error fetching user ${userId}:`, userFetchError);
          
          // Try to create the user
          console.log(`User ${userId} not found or error, creating new record`);
          
          // Get customer email - add null checks
          let customerEmail = '';
          if (session.customer_email) {
            customerEmail = session.customer_email;
          } else if (session.customer_details?.email) {
            customerEmail = session.customer_details.email;
          } else if (session.customer) {
            try {
              const customerId = typeof session.customer === 'string' 
                ? session.customer 
                : session.customer.id;
                
              const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
              customerEmail = customer.email || '';
            } catch (e) {
              console.error('Error retrieving customer details:', e);
            }
          }
          
          // Create new user with subscription data
          const newUserData: UserData = {
            ...updateData,
            id: userId,
            email: customerEmail,
            created_at: new Date().toISOString()
          };
          
          const { data: insertResult, error: insertError } = await supabase
            .from('users')
            .insert([newUserData]);
            
          if (insertError) {
            console.error(`Error creating user ${userId}:`, insertError);
          } else {
            console.log(`Created new user ${userId} with subscription data`);
          }
        } else {
          // Update existing user
          const { data: updateResult, error: updateError } = await supabase
            .from('users')
            .update(updateData)
            .eq('id', userId);
            
          if (updateError) {
            console.error(`Error updating user ${userId}:`, updateError);
          } else {
            console.log(`Updated user ${userId} with subscription data`);
          }
        }
        
        break;
      }
      
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        console.log(`Processing invoice payment succeeded: ${invoice.id}`);
        
        // Only process subscription invoices
        if (!invoice.subscription) {
          console.log('Not a subscription invoice, skipping');
          break;
        }
        
        const customerId = invoice.customer as string;
        console.log(`Invoice for customer: ${customerId}`);
        
        // Get the customer to find the associated user ID
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const userId = customer.metadata?.userId;
        
        if (!userId) {
          console.error('No user ID found in customer metadata');
          break;
        }
        
        // Check if Supabase is available
        if (!supabase) {
          console.error('Supabase client not initialized, cannot update user subscription');
          break;
        }
        
        // Get subscription details to update user record
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
        
        // Calculate new subscription end date
        const endDate = subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000)
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          
        console.log(`Updating subscription end date for user ${userId} to ${endDate.toISOString()}`);
        
        // Update user record with new subscription details
        const { data, error } = await supabase
          .from('users')
          .update({
            subscription_status: subscription.status,
            subscription_end_date: endDate.toISOString(),
            is_pro: true,
            models_remaining_this_month: 999999,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);
          
        if (error) {
          console.error(`Error updating user ${userId} after invoice payment:`, error);
        } else {
          console.log(`Updated user ${userId} subscription after invoice payment`);
        }
        
        break;
      }
      
      case 'customer.subscription.deleted':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log(`Processing subscription ${event.type}: ${subscription.id}`);
        
        // Get the customer to find the associated user ID
        const customerId = subscription.customer as string;
        console.log(`Subscription for customer: ${customerId}`);
        
        const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
        const userId = customer.metadata?.userId;
        
        if (!userId) {
          console.error('No user ID found in customer metadata');
          break;
        }
        
        // Check if Supabase is available
        if (!supabase) {
          console.error('Supabase client not initialized, cannot update user subscription');
          break;
        }
        
        if (event.type === 'customer.subscription.deleted' || subscription.status === 'canceled') {
          // Handle subscription cancellation
          console.log(`Subscription ${subscription.id} canceled for user ${userId}`);
          
          const { data, error } = await supabase
            .from('users')
            .update({
              is_pro: false,
              subscription_status: 'canceled',
              models_remaining_this_month: 0,
              updated_at: new Date().toISOString()
            })
            .eq('id', userId);
            
          if (error) {
            console.error(`Error updating user ${userId} after subscription cancellation:`, error);
          } else {
            console.log(`Updated user ${userId} after subscription cancellation`);
          }
        } else {
          // Update subscription status
          const endDate = subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            
          const { data, error } = await supabase
            .from('users')
            .update({
              subscription_status: subscription.status,
              subscription_end_date: endDate.toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', userId);
            
          if (error) {
            console.error(`Error updating user ${userId} subscription status:`, error);
          } else {
            console.log(`Updated user ${userId} subscription status to ${subscription.status}`);
          }
        }
        
        break;
      }
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error(`Error processing webhook:`, error);
    res.status(500).json({ success: false, error: 'Error processing webhook' });
  }
}