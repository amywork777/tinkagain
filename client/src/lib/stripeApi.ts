// API for interacting with Stripe through our backend
// Get API URL from environment variables or use localhost in development

// Add TypeScript definitions for Window.Stripe
declare global {
  interface Window {
    Stripe?: any;
  }
}

// Use module augmentation instead of interface merging to avoid linter errors
// This properly extends Vite's ImportMeta type
declare module 'vite' {
  export interface ImportMeta {
    readonly env: {
      readonly VITE_API_URL?: string;
      readonly [key: string]: string | boolean | undefined;
    }
  }
}

// Function to get the appropriate API URL based on the environment
const getApiUrl = (): string => {
  // Log hostname to debug
  const hostname = window.location.hostname;
  console.log(`Current hostname: ${hostname}`);
  
  // Check if development
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:3001/api';
  }
  
  // Primary production environment - 3dcad.taiyaki.ai
  if (hostname.includes('3dcad.taiyaki.ai')) {
    console.log('Production environment detected - using 3dcad.taiyaki.ai');
    return 'https://3dcad.taiyaki.ai/api';
  }
  
  // Legacy production environments - fishcad.com
  if (hostname.includes('fishcad.com')) {
    console.log('Legacy environment detected - using fishcad.com');
    return 'https://fishcad.com/api';
  }
  
  // Fallback to environment variable or default
  const envApiUrl = import.meta.env.VITE_API_URL;
  const fallback = envApiUrl || 'https://3dcad.taiyaki.ai/api';
  console.log(`Using fallback API URL: ${fallback}`);
  return fallback;
};

// Get the API URL
const API_URL = getApiUrl();
console.log(`API URL configured as: ${API_URL}`);

// PRODUCTION STRIPE KEYS
const STRIPE_PROD_KEYS = {
  PUBLISHABLE_KEY: 'pk_live_51QIaT9CLoBz9jXRlVEQ99Q6V4UiRSYy8ZS49MelsW8EfX1mEijh3K5JQEe5iysIL31cGtf2IsTVIyV1mivoUHCUI00aPpz3GMi',
  MONTHLY_PRICE: 'price_1R1jGiCLoBz9jXRlB1uLgvE9', // Pro Monthly
};

// Export the publishable key directly
export const PUBLISHABLE_KEY = STRIPE_PROD_KEYS.PUBLISHABLE_KEY;

// Export STRIPE_KEYS for backward compatibility with existing components
export const STRIPE_KEYS = {
  PUBLISHABLE_KEY: STRIPE_PROD_KEYS.PUBLISHABLE_KEY,
  MONTHLY_PRICE: STRIPE_PROD_KEYS.MONTHLY_PRICE,
};

// Export STRIPE_PRICES directly for consistent access
export const STRIPE_PRICES = {
  MONTHLY: STRIPE_PROD_KEYS.MONTHLY_PRICE,
};

// Helper to add cache-busting parameter
const addCacheBuster = (url: string): string => {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_t=${Date.now()}`;
};

// Utility function to check API connectivity before performing operations
export const checkApiConnectivity = async (): Promise<boolean> => {
  try {
    // Try an OPTIONS request to the API base URL to check connectivity
    const apiUrl = API_URL;
    
    // Add a timestamp to avoid caching
    const endpoint = addCacheBuster(`${apiUrl}/health-check`);
    
    console.log(`Checking API connectivity at ${endpoint}`);
    
    // Use fetch with a timeout to check connectivity
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(endpoint, {
      method: 'OPTIONS',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    // If we get any response, consider it a success
    console.log(`API connectivity check result: ${response.status}`);
    return response.status < 500; // Consider it a success if not a server error
  } catch (error) {
    console.error('API connectivity check failed:', error);
    return false;
  }
};

// Create a checkout session for a subscription
export const createCheckoutSession = async (
  priceId: string,
  userId: string,
  email: string
): Promise<{ url: string }> => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000; // 1 second
  // Helper function to wait
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  // As a last resort, create a form submit to the Stripe checkout
  const createFormSubmission = () => {
    console.log('Attempting fallback form submission method');
    
    // Create a hidden form and submit it
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = 'https://checkout.stripe.com/create-checkout-session';
    form.target = '_blank';
    
    // Add the necessary fields
    const addField = (name: string, value: string) => {
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = name;
      field.value = value;
      form.appendChild(field);
    };
    
    // Add required fields
    addField('api_key', STRIPE_PROD_KEYS.PUBLISHABLE_KEY);
    addField('price_id', priceId);
    addField('success_url', `${window.location.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`);
    addField('cancel_url', `${window.location.origin}/pricing`);
    addField('customer_email', email);
    
    // Append the form to the body, submit it, and remove it
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    
    // Return a placeholder URL since we're redirecting via form
    return Promise.resolve({ url: 'form_submission_in_progress' });
  };
  
  // Helper function for the fetch operation
  const attemptFetch = async (attempt: number = 1, urlIndex: number = 0): Promise<{ url: string }> => {
    try {
      const hostname = window.location.hostname;
      const isProduction = hostname.includes('3dcad.taiyaki.ai') || hostname.includes('fishcad.com');
      
      console.log(`Checkout attempt ${attempt} (URL version ${urlIndex}) - Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
      
      // Define multiple possible endpoint patterns to try in production
      // This helps us work around potential server routing issues
      const productionEndpoints = [
        // 3DCAD Taiyaki endpoints
        'https://3dcad.taiyaki.ai/pricing/create-checkout-session',  // Direct without /api
        'https://3dcad.taiyaki.ai/api/pricing/create-checkout-session', // With /api
        'https://3dcad.taiyaki.ai/api/create-checkout-session',      // Alternative path
        'https://3dcad.taiyaki.ai/checkout',                        // Simple checkout path
        'https://3dcad.taiyaki.ai/api/checkout',                    // Simple API checkout
        
        // Legacy fishcad.com endpoints
        'https://fishcad.com/pricing/create-checkout-session',      // Legacy direct
        'https://fishcad.com/api/pricing/create-checkout-session',  // Legacy with /api
        'https://fishcad.com/api/create-checkout-session',          // Legacy alternative
        'https://fishcad.com/checkout',                             // Legacy simple
        'https://fishcad.com/api/checkout',                         // Legacy API simple
        
        // With www prefix for either domain
        'https://www.3dcad.taiyaki.ai/api/pricing/create-checkout-session', // With www
        'https://www.fishcad.com/api/pricing/create-checkout-session'       // Legacy with www
      ];
      
      // Use a specific production endpoint for fishcad.com
      let endpoint;
      if (isProduction) {
        // Try different endpoint patterns in sequence
        endpoint = productionEndpoints[urlIndex % productionEndpoints.length];
        console.log(`Using production endpoint (${urlIndex+1}/${productionEndpoints.length}): ${endpoint}`);
      } else {
        // For development, use the configured API URL
        const endpointPath = API_URL.includes('/api') 
          ? '/pricing/create-checkout-session' 
          : '/api/pricing/create-checkout-session';
        endpoint = `${API_URL}${endpointPath}`;
        console.log(`Using development endpoint: ${endpoint}`);
      }
      // Add cache buster
      endpoint = addCacheBuster(endpoint);
      
      console.log(`Attempt ${attempt}: Making request to ${endpoint} with price ID: ${priceId}`);
      
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      try {
        // Proper fetch configuration for cross-origin requests
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Accept': 'application/json',
            'Origin': window.location.origin
          },
          credentials: 'include', // Always include credentials for both dev and prod
          mode: 'cors', // Explicitly set CORS mode
          signal: controller.signal,
          body: JSON.stringify({
            priceId,
            userId,
            email,
            // Force new customer on production to avoid test/live mode conflicts
            force_new_customer: isProduction
          }),
        });
        
        clearTimeout(timeoutId);

        // Handle non-OK responses
        if (!response.ok) {
          console.error(`Attempt ${attempt}: Checkout session creation failed:`, {
            status: response.status,
            statusText: response.statusText
          });

          // Clone the response before reading it
          const clonedResponse = response.clone();
          
          // Try to get error details from the response
          let errorData;
          try {
            // Try to parse as JSON first
            errorData = await clonedResponse.json();
          } catch (e) {
            // If not JSON, try getting the text
            try {
              const text = await response.text();
              errorData = { error: text || `HTTP error ${response.status}` };
            } catch (textError) {
              // If we can't read the text either, just use status info
              errorData = { error: `HTTP error ${response.status} - ${response.statusText}` };
            }
          }
          
          console.error('Error data:', errorData);
          
          // For specific error cases, we may want to retry
          if (response.status >= 500 || response.status === 429) {
            // Server error or rate limiting - retry
            if (attempt < MAX_RETRIES) {
              console.log(`Retrying in ${RETRY_DELAY}ms...`);
              await wait(RETRY_DELAY);
              return attemptFetch(attempt + 1, urlIndex);
            }
          }
          
          // For 405 Method Not Allowed, try a GET request approach
          if (response.status === 405) {
            console.log('Server does not allow POST to this endpoint, trying a GET request approach...');
            
            // If we're on the www domain, try a GET approach with query params
            if (endpoint.includes('www.fishcad.com')) {
              try {
                console.log('Attempting GET request approach for www domain...');
                
                // Create a new URL with query parameters
                const url = new URL(endpoint);
                url.searchParams.append('priceId', priceId);
                url.searchParams.append('userId', userId);
                url.searchParams.append('email', email);
                url.searchParams.append('_t', Date.now().toString()); // Cache buster
                
                console.log(`Making GET request to: ${url.toString()}`);
                
                // Create a new controller for this request
                const getController = new AbortController();
                const getTimeoutId = setTimeout(() => getController.abort(), 10000);
                
                const getResponse = await fetch(url.toString(), {
                  method: 'GET',
                  headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache',
                    'Origin': window.location.origin
                  },
                  credentials: 'include',
                  mode: 'cors',
                  signal: getController.signal
                });
                
                clearTimeout(getTimeoutId);
                
                if (!getResponse.ok) {
                  console.error(`GET request approach failed: ${getResponse.status} ${getResponse.statusText}`);
                  throw new Error(`GET request failed with status ${getResponse.status}`);
                }
                
                const getResponseData = await getResponse.json();
                
                if (!getResponseData?.url) {
                  throw new Error("API response from GET request is missing the checkout URL");
                }
                
                console.log(`GET request approach succeeded - Redirecting to: ${getResponseData.url}`);
                return getResponseData;
              } catch (getError) {
                console.error('GET request approach failed:', getError);
                // Continue with normal flow - try next endpoint
              }
            }
            
            const nextUrlIndex = (urlIndex + 1) % productionEndpoints.length;
            if (nextUrlIndex !== urlIndex) {
              await wait(RETRY_DELAY);
              return attemptFetch(attempt, nextUrlIndex);
            }
          }
          
          throw new Error(errorData?.error || `Failed to create checkout session (HTTP ${response.status})`);
        }
        
        // Success case - first clone the response before trying to read it
        const clonedResponse = response.clone();
        let data;
        
        try {
          data = await clonedResponse.json();
        } catch (e) {
          console.error('Failed to parse response as JSON:', e);
          try {
            const text = await response.text();
            console.log('Response as text:', text);
            // Try to extract a URL from the text if possible
            const urlMatch = text.match(/https:\/\/checkout\.stripe\.com\/[^\s"']+/);
            if (urlMatch) {
              data = { url: urlMatch[0] };
            } else {
              throw new Error('Could not parse response');
            }
          } catch (textError) {
            console.error('Failed to read response text:', textError);
            throw new Error('Failed to parse server response');
          }
        }
        
        if (!data?.url) {
          throw new Error("API response is missing the checkout URL");
        }
        
        console.log(`Attempt ${attempt}: Successfully created checkout session - Redirecting to: ${data.url}`);
        return data;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        throw fetchError;
      }
    } catch (error: unknown) {
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        console.error('Connection error - server may be rejecting the request or have CORS issues');
      }
      
      const hostname = window.location.hostname;
      const isProduction = hostname.includes('3dcad.taiyaki.ai') || hostname.includes('fishcad.com');
      
      // In production, try a different URL pattern if we have network errors
      if (isProduction && (
          error instanceof TypeError || 
          (error instanceof Error && (
            error.message.includes('Failed to fetch') || 
            error.message.includes('NetworkError') ||
            error.message.includes('Network request failed') ||
            error.message.includes('body stream already read') ||
            error.message.includes('Method Not Allowed')
          ))
      )) {
        // Try the next URL pattern
        const productionEndpoints = [
          'https://3dcad.taiyaki.ai/pricing/create-checkout-session',
          'https://3dcad.taiyaki.ai/api/pricing/create-checkout-session',
          'https://3dcad.taiyaki.ai/api/create-checkout-session',
          'https://3dcad.taiyaki.ai/checkout',
          'https://3dcad.taiyaki.ai/api/checkout',
          'https://www.3dcad.taiyaki.ai/api/pricing/create-checkout-session',
          'https://www.3dcad.taiyaki.ai/checkout',
          'https://www.fishcad.com/pricing/create-checkout-session',
          'https://www.fishcad.com/api/pricing/create-checkout-session',
          'https://www.fishcad.com/checkout',
          'https://www.fishcad.com/api/checkout'
        ];
        
        const nextUrlIndex = (urlIndex + 1) % productionEndpoints.length;
        
        // If we've tried all URL patterns, then increment the attempt counter
        if (nextUrlIndex <= urlIndex) {
          // If we've tried everything and we're at the last attempt, fall back to direct Stripe form submission
          if (attempt >= MAX_RETRIES) {
            console.log('All endpoints failed. Trying direct Stripe checkout...');
            try {
              await createDirectStripeCheckout(priceId, userId, email);
              // If the redirect works, we'll return a placeholder
              return { url: 'direct_stripe_checkout_initiated' };
            } catch (directError) {
              console.error('Direct Stripe checkout failed:', directError);
              // Now try form submission as the absolute last resort
              console.log('Falling back to form submission method...');
              return createFormSubmission();
            }
          }
          
          // Only retry for a certain number of attempts
          if (attempt < MAX_RETRIES) {
            console.log(`Network error, trying next endpoint pattern in ${RETRY_DELAY}ms...`);
            await wait(RETRY_DELAY);
            return attemptFetch(attempt + 1, 0); // Reset URL index if we've tried them all
          }
        } else {
          // Try the next URL pattern with the same attempt number
          console.log(`Network error, trying alternate endpoint pattern (${nextUrlIndex+1}/${productionEndpoints.length}) in ${RETRY_DELAY}ms...`);
          await wait(RETRY_DELAY);
          return attemptFetch(attempt, nextUrlIndex);
        }
      }
      // For non-production or non-network errors
      else if (attempt < MAX_RETRIES && 
          ((error instanceof TypeError) || // Network error
           (error instanceof Error && error.message?.includes('failed to fetch')))) {
        console.log(`Network error, retrying in ${RETRY_DELAY}ms...`);
        await wait(RETRY_DELAY);
        return attemptFetch(attempt + 1, urlIndex);
      }
      
      // If we've exhausted all retries and still failed, try the direct form submission as a last resort
      if (isProduction && attempt >= MAX_RETRIES) {
        console.log('All API approaches failed. Trying direct Stripe checkout...');
        try {
          await createDirectStripeCheckout(priceId, userId, email);
          // If the redirect works, we'll return a placeholder
          return { url: 'direct_stripe_checkout_initiated' };
        } catch (directError) {
          console.error('Direct Stripe checkout failed:', directError);
          // Now try form submission as the absolute last resort
          console.log('Falling back to form submission method...');
          return createFormSubmission();
        }
      }
      
      throw error;
    }
  };
  
  // Start the fetch attempt chain with the first URL pattern
  return attemptFetch(1, 0);
};

// Get user subscription status
export const getUserSubscription = async (userId: string): Promise<{
  isPro: boolean;
  modelsRemainingThisMonth: number;
  modelsGeneratedThisMonth: number;
  downloadsThisMonth: number;
  subscriptionStatus: string;
  subscriptionEndDate: string | null;
  subscriptionPlan: string;
  trialActive: boolean;
  trialEndDate: string | null;
}> => {
  try {
    const hostname = window.location.hostname;
    const isProduction = hostname.includes('3dcad.taiyaki.ai') || hostname.includes('fishcad.com');
    
    // Define multiple possible endpoint patterns to try in production
    const productionEndpoints = [
      `https://3dcad.taiyaki.ai/pricing/user-subscription/${userId}`,  // Direct without /api
      `https://3dcad.taiyaki.ai/api/pricing/user-subscription/${userId}`, // With /api
      `https://www.3dcad.taiyaki.ai/pricing/user-subscription/${userId}`, // With www
      `https://www.3dcad.taiyaki.ai/api/pricing/user-subscription/${userId}`, // With www and /api
      `https://fishcad.com/pricing/user-subscription/${userId}`,  // Legacy direct
      `https://fishcad.com/api/pricing/user-subscription/${userId}`,  // Legacy with /api
      `https://www.fishcad.com/pricing/user-subscription/${userId}`, // Legacy with www
      `https://www.fishcad.com/api/pricing/user-subscription/${userId}` // Legacy with www and /api
    ];
    
    // Use direct API URL for production
    let endpoint;
    if (isProduction) {
      // Try all endpoints in sequence if needed
      for (let i = 0; i < productionEndpoints.length; i++) {
        try {
          endpoint = productionEndpoints[i];
          console.log(`Trying production subscription endpoint (${i+1}/${productionEndpoints.length}): ${endpoint}`);
          
          // Add cache buster
          endpoint = addCacheBuster(endpoint);
          
          console.log(`Fetching subscription for user: ${userId} from ${endpoint}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
          
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Accept': 'application/json',
              'Origin': window.location.origin
            },
            credentials: 'include', // Always include credentials
            mode: 'cors', // Explicitly set CORS mode
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch (e) {
              errorData = { error: errorText || 'Unknown error' };
            }
            console.error(`Endpoint ${i+1} error response:`, {
              status: response.status,
              statusText: response.statusText,
              errorData
            });
            
            // If server error, try next endpoint
            if (response.status >= 500) {
              continue;
            }
            
            throw new Error(errorData.error || `Failed to get user subscription (HTTP ${response.status})`);
          }

          const data = await response.json();
          console.log('Subscription data received:', data);
          
          // Make sure all required fields are present with appropriate defaults
          const result = {
            isPro: data.isPro === true,
            modelsRemainingThisMonth: data.modelsRemainingThisMonth || 0,
            modelsGeneratedThisMonth: data.modelsGeneratedThisMonth || 0,
            downloadsThisMonth: data.downloadsThisMonth || 0,
            subscriptionStatus: data.subscriptionStatus || 'none',
            subscriptionEndDate: data.subscriptionEndDate || null,
            subscriptionPlan: data.subscriptionPlan || 'free',
            trialActive: data.trialActive === true,
            trialEndDate: data.trialEndDate || null,
          };
          
          console.log('Normalized subscription data:', result);
          return result;
        } catch (endpointError) {
          console.error(`Error with endpoint ${i+1}:`, endpointError);
          // If this is the last endpoint, rethrow the error
          if (i === productionEndpoints.length - 1) {
            throw endpointError;
          }
          // Otherwise try the next endpoint
          console.log(`Trying next endpoint pattern...`);
        }
      }
      
      // This should not be reached, but just in case
      throw new Error("All subscription endpoints failed");
      
    } else {
      // Development environment - use the standard endpoint
      const endpointPath = API_URL.includes('/api') 
        ? `/pricing/user-subscription/${userId}`
        : `/api/pricing/user-subscription/${userId}`;
      endpoint = `${API_URL}${endpointPath}`;
      console.log(`Using development subscription endpoint: ${endpoint}`);
      
      // Add cache buster
      endpoint = addCacheBuster(endpoint);
      
      console.log(`Fetching subscription for user: ${userId} from ${endpoint}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Accept': 'application/json',
          'Origin': window.location.origin
        },
        credentials: 'include', // Always include credentials
        mode: 'cors', // Explicitly set CORS mode
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: errorText || 'Unknown error' };
        }
        console.error('Error response from subscription API:', {
          status: response.status,
          statusText: response.statusText,
          errorData
        });
        throw new Error(errorData.error || `Failed to get user subscription (HTTP ${response.status})`);
      }

      const data = await response.json();
      console.log('Subscription data received:', data);
      
      // Make sure all required fields are present with appropriate defaults
      const result = {
        isPro: data.isPro === true,
        modelsRemainingThisMonth: data.modelsRemainingThisMonth || 0,
        modelsGeneratedThisMonth: data.modelsGeneratedThisMonth || 0,
        downloadsThisMonth: data.downloadsThisMonth || 0,
        subscriptionStatus: data.subscriptionStatus || 'none',
        subscriptionEndDate: data.subscriptionEndDate || null,
        subscriptionPlan: data.subscriptionPlan || 'free',
        trialActive: data.trialActive === true,
        trialEndDate: data.trialEndDate || null,
      };
      
      console.log('Normalized subscription data:', result);
      return result;
    }
  } catch (error) {
    console.error('Error getting user subscription:', error);
    throw error;
  }
};

// Cancel subscription
export const cancelSubscription = async (userId: string): Promise<{ success: boolean; message: string }> => {
  try {
    const hostname = window.location.hostname;
    const isProduction = hostname.includes('3dcad.taiyaki.ai') || hostname.includes('fishcad.com');
    
    // Define multiple possible endpoint patterns to try in production
    const productionEndpoints = [
      'https://3dcad.taiyaki.ai/pricing/cancel-subscription',  // Direct without /api
      'https://3dcad.taiyaki.ai/api/pricing/cancel-subscription', // With /api
      'https://www.3dcad.taiyaki.ai/pricing/cancel-subscription', // With www
      'https://www.3dcad.taiyaki.ai/api/pricing/cancel-subscription', // With www and /api
      'https://fishcad.com/pricing/cancel-subscription',  // Legacy direct
      'https://fishcad.com/api/pricing/cancel-subscription',  // Legacy with /api
      'https://www.fishcad.com/pricing/cancel-subscription', // Legacy with www
      'https://www.fishcad.com/api/pricing/cancel-subscription' // Legacy with www and /api
    ];
    
    // Use direct API URL for production
    let endpoint;
    if (isProduction) {
      // Try all endpoints in sequence if needed
      for (let i = 0; i < productionEndpoints.length; i++) {
        try {
          endpoint = productionEndpoints[i];
          console.log(`Trying production cancel endpoint (${i+1}/${productionEndpoints.length}): ${endpoint}`);
          
          // Add cache buster
          endpoint = addCacheBuster(endpoint);
          
          console.log(`Cancelling subscription for user: ${userId} using endpoint: ${endpoint}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
          
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Accept': 'application/json',
              'Origin': window.location.origin
            },
            credentials: 'include', // Always include credentials
            mode: 'cors', // Explicitly set CORS mode
            signal: controller.signal,
            body: JSON.stringify({
              userId,
            }),
          });
          
          clearTimeout(timeoutId);

          // Handle non-OK responses properly
          if (!response.ok) {
            let errorData;
            try {
              errorData = await response.json();
            } catch (e) {
              // If not JSON, try getting the text
              const text = await response.text();
              errorData = { error: text || `HTTP error ${response.status}` };
            }
            
            console.error(`Endpoint ${i+1} error response:`, {
              status: response.status,
              statusText: response.statusText,
              errorData
            });
            
            // If server error, try next endpoint
            if (response.status >= 500) {
              continue;
            }
            
            throw new Error(errorData.error || `Failed to cancel subscription (HTTP ${response.status})`);
          }

          const data = await response.json();
          console.log('Cancellation response:', data);
          
          return data;
        } catch (endpointError) {
          console.error(`Error with endpoint ${i+1}:`, endpointError);
          // If this is the last endpoint, rethrow the error
          if (i === productionEndpoints.length - 1) {
            throw endpointError;
          }
          // Otherwise try the next endpoint
          console.log(`Trying next endpoint pattern...`);
        }
      }
      
      // This should not be reached, but just in case
      throw new Error("All cancellation endpoints failed");
      
    } else {
      // Development environment - use the standard endpoint
      const endpointPath = API_URL.includes('/api') 
        ? '/pricing/cancel-subscription' 
        : '/api/pricing/cancel-subscription';
      endpoint = `${API_URL}${endpointPath}`;
      console.log(`Using development cancel endpoint: ${endpoint}`);
      
      // Add cache buster
      endpoint = addCacheBuster(endpoint);
      
      console.log(`Cancelling subscription for user: ${userId}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Accept': 'application/json',
          'Origin': window.location.origin
        },
        credentials: 'include', // Always include credentials
        mode: 'cors', // Explicitly set CORS mode
        signal: controller.signal,
        body: JSON.stringify({
          userId,
        }),
      });
      
      clearTimeout(timeoutId);

      // Handle non-OK responses properly
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          // If not JSON, try getting the text
          const text = await response.text();
          errorData = { error: text || `HTTP error ${response.status}` };
        }
        
        throw new Error(errorData.error || `Failed to cancel subscription (HTTP ${response.status})`);
      }

      const data = await response.json();
      console.log('Cancellation response:', data);
      
      return data;
    }
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw error;
  }
};

// Calculate discounted price for pro users - now always returns original price
export const calculateDiscountedPrice = async (
  basePrice: number,
  userId: string
): Promise<number> => {
  // No discount applied anymore - always return the original price
  return basePrice;
};

// Verify subscription and update user status
export const verifySubscription = async (
  userId: string, 
  email: string, 
  sessionId?: string
): Promise<{ 
  success: boolean; 
  subscription: any; 
  message: string;
}> => {
  try {
    const hostname = window.location.hostname;
    const isProduction = hostname.includes('3dcad.taiyaki.ai') || hostname.includes('fishcad.com');
    
    // Define multiple possible endpoint patterns to try in production
    const productionEndpoints = [
      'https://3dcad.taiyaki.ai/pricing/verify-subscription',  // Direct without /api
      'https://3dcad.taiyaki.ai/api/pricing/verify-subscription', // With /api
      'https://www.3dcad.taiyaki.ai/pricing/verify-subscription', // With www
      'https://www.3dcad.taiyaki.ai/api/pricing/verify-subscription', // With www and /api
      'https://fishcad.com/pricing/verify-subscription',  // Legacy direct
      'https://fishcad.com/api/pricing/verify-subscription',  // Legacy with /api
      'https://www.fishcad.com/pricing/verify-subscription', // Legacy with www
      'https://www.fishcad.com/api/pricing/verify-subscription' // Legacy with www and /api
    ];
    
    // Use direct API URL for production
    let endpoint;
    if (isProduction) {
      // Try all endpoints in sequence if needed
      for (let i = 0; i < productionEndpoints.length; i++) {
        try {
          endpoint = productionEndpoints[i];
          console.log(`Trying production verify endpoint (${i+1}/${productionEndpoints.length}): ${endpoint}`);
          
          // Add cache buster
          endpoint = addCacheBuster(endpoint);
          
          console.log(`Verifying subscription for user: ${userId}, session: ${sessionId || 'none'} using endpoint: ${endpoint}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
          
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache',
              'Accept': 'application/json',
              'Origin': window.location.origin
            },
            credentials: 'include', // Always include credentials
            mode: 'cors', // Explicitly set CORS mode
            signal: controller.signal,
            body: JSON.stringify({
              userId,
              email,
              sessionId,
            }),
          });
          
          clearTimeout(timeoutId);

          // Handle non-OK responses properly
          if (!response.ok) {
            let errorData;
            try {
              errorData = await response.json();
            } catch (e) {
              // If not JSON, try getting the text
              const text = await response.text();
              errorData = { error: text || `HTTP error ${response.status}` };
            }
            
            console.error(`Endpoint ${i+1} error response:`, {
              status: response.status,
              statusText: response.statusText,
              errorData
            });
            
            // If server error, try next endpoint
            if (response.status >= 500) {
              continue;
            }
            
            throw new Error(errorData.error || `Failed to verify subscription (HTTP ${response.status})`);
          }

          const data = await response.json();
          console.log('Verification response:', data);
          
          return data;
        } catch (endpointError) {
          console.error(`Error with endpoint ${i+1}:`, endpointError);
          // If this is the last endpoint, rethrow the error
          if (i === productionEndpoints.length - 1) {
            throw endpointError;
          }
          // Otherwise try the next endpoint
          console.log(`Trying next endpoint pattern...`);
        }
      }
      
      // This should not be reached, but just in case
      throw new Error("All verification endpoints failed");
      
    } else {
      // Development environment - use the standard endpoint
      const endpointPath = API_URL.includes('/api') 
        ? '/pricing/verify-subscription' 
        : '/api/pricing/verify-subscription';
      endpoint = `${API_URL}${endpointPath}`;
      console.log(`Using development verify endpoint: ${endpoint}`);
      
      // Add cache buster
      endpoint = addCacheBuster(endpoint);
      
      console.log(`Verifying subscription for user: ${userId}, session: ${sessionId || 'none'}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Accept': 'application/json',
          'Origin': window.location.origin
        },
        credentials: 'include', // Always include credentials
        mode: 'cors', // Explicitly set CORS mode
        signal: controller.signal,
        body: JSON.stringify({
          userId,
          email,
          sessionId,
        }),
      });
      
      clearTimeout(timeoutId);

      // Handle non-OK responses properly
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          // If not JSON, try getting the text
          const text = await response.text();
          errorData = { error: text || `HTTP error ${response.status}` };
        }
        
        throw new Error(errorData.error || `Failed to verify subscription (HTTP ${response.status})`);
      }

      const data = await response.json();
      console.log('Verification response:', data);
      
      return data;
    }
  } catch (error) {
    console.error('Error verifying subscription:', error);
    throw error;
  }
};

// Add a function to create a direct Stripe checkout
// This uses Stripe's hosted checkout page directly without our server
export const createDirectStripeCheckout = async (
  priceId: string,
  userId: string,
  email: string
): Promise<void> => {
  console.log('Creating direct Stripe checkout for:', { priceId, userId, email });
  
  // Load the Stripe.js library dynamically
  const loadStripe = async (): Promise<any> => {
    return new Promise((resolve, reject) => {
      // Check if Stripe is already loaded
      if (typeof window.Stripe !== 'undefined') {
        console.log('Stripe already loaded');
        return resolve(window.Stripe);
      }
      
      try {
        console.log('Loading Stripe.js dynamically');
        // Create script element
        const script = document.createElement('script');
        script.src = 'https://js.stripe.com/v3/';
        script.async = true;
        
        // Set up load handlers
        script.onload = () => {
          console.log('Stripe.js loaded successfully');
          if (typeof window.Stripe !== 'undefined') {
            resolve(window.Stripe);
          } else {
            reject(new Error('Stripe.js loaded but Stripe is not defined'));
          }
        };
        
        script.onerror = () => {
          reject(new Error('Failed to load Stripe.js'));
        };
        
        // Add script to document
        document.head.appendChild(script);
      } catch (error) {
        reject(error);
      }
    });
  };
  
  try {
    // Load Stripe
    const StripeConstructor = await loadStripe();
    const stripe = StripeConstructor(STRIPE_PROD_KEYS.PUBLISHABLE_KEY);
    
    console.log('Stripe loaded successfully, redirecting to checkout...');
    
    // Create checkout parameters for direct checkout
    const checkoutParams = {
      lineItems: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      successUrl: `${window.location.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${window.location.origin}/pricing`,
      customerEmail: email,
      clientReferenceId: userId,
    };
    
    console.log('Redirecting to Stripe checkout with params:', checkoutParams);
    
    // Redirect to Stripe's hosted checkout page
    const result = await stripe.redirectToCheckout(checkoutParams);
    
    if (result.error) {
      console.error('Stripe redirect error:', result.error);
      throw new Error(result.error.message || 'Failed to redirect to Stripe checkout');
    }
  } catch (error) {
    console.error('Error creating direct Stripe checkout:', error);
    // Use a simpler approach with window.open as a last resort
    try {
      console.log('Trying alternative approach - direct link to Stripe...');
      // Direct link to Stripe Checkout with parameters in URL
      const params = new URLSearchParams({
        'client_reference_id': userId,
        'customer_email': email,
        'mode': 'subscription',
        'success_url': `${window.location.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${window.location.origin}/pricing`,
      });
      
      // For price, we need to add it separately
      params.append('line_items[0][price]', priceId);
      params.append('line_items[0][quantity]', '1');
      
      // Add API key
      params.append('key', STRIPE_PROD_KEYS.PUBLISHABLE_KEY);
      
      // Construct the final URL
      const url = `https://checkout.stripe.com/pay/${params.toString()}`;
      console.log('Opening direct Stripe URL:', url);
      
      // Open in new tab
      window.open(url, '_blank');
    } catch (directError) {
      console.error('Direct Stripe URL failed:', directError);
      // As an absolute last resort, try the form submission method
      createFormSubmission(priceId, email);
    }
  }
};

// As a last resort, create a form submit to the Stripe checkout
const createFormSubmission = (priceId: string, email?: string) => {
  console.log('Attempting fallback form submission method');
  
  // Create a hidden form and submit it
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = 'https://checkout.stripe.com/pay';
  form.target = '_blank';
  
  // Add the necessary fields
  const addField = (name: string, value: string) => {
    const field = document.createElement('input');
    field.type = 'hidden';
    field.name = name;
    field.value = value;
    form.appendChild(field);
  };
  
  // Add required fields
  addField('key', STRIPE_PROD_KEYS.PUBLISHABLE_KEY);
  addField('line_items[0][price]', priceId);
  addField('line_items[0][quantity]', '1');
  addField('mode', 'subscription');
  addField('success_url', `${window.location.origin}/pricing/success?session_id={CHECKOUT_SESSION_ID}`);
  addField('cancel_url', `${window.location.origin}/pricing`);
  
  // Add customer email if provided
  if (email) {
    addField('customer_email', email);
  }
  
  // Append the form to the body, submit it, and remove it
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
  
  return { url: 'form_submission_in_progress' };
}; 