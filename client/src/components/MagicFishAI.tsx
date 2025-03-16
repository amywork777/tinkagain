import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Loader2, AlertCircle, Crown, Info, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from '@/context/SubscriptionContext';
import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Progress } from '@/components/ui/progress';

export function MagicFishAI() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const { toast } = useToast();
  const { hasAccess, subscription, decrementModelCount, trackDownload } = useSubscription();
  const { user } = useAuth();
  const navigate = useNavigate();
  const overlayRef = useRef<HTMLDivElement>(null); // Reference for the overlay
  
  // Calculate model limits and percentages
  const modelLimit = subscription.isPro ? 20 : 2;
  const modelsRemaining = subscription.modelsRemainingThisMonth;
  const modelsUsed = modelLimit - modelsRemaining;
  const usagePercent = Math.min(100, Math.round((modelsUsed / modelLimit) * 100));
  
  // Track total downloads from Firebase
  const totalDownloads = subscription.downloadsThisMonth || 0;

  // Function to track STL downloads - moved above effects for proper dependencies
  const handleDownloadDetected = async () => {
    console.log('STL Download detected - tracking in Firebase');
    
    // Track the download in Firebase
    const success = await trackDownload();
    
    if (success) {
      // Only decrement model count for free users
      if (!subscription.isPro) {
        // Check if user has reached their limit
        if (modelsRemaining <= 0) {
          toast({
            title: "Download Limit Reached",
            description: "You've reached your monthly limit of downloads as a free user.",
            variant: "destructive",
          });
          return;
        }
        
        // Decrement the available count
        const decrementSuccess = await decrementModelCount();
        
        if (!decrementSuccess) {
          toast({
            title: "Download Limit Reached",
            description: "You've reached your monthly limit of 2 downloads as a free user.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "STL Downloaded",
            description: `You have ${modelsRemaining - 1} downloads remaining this month.`,
            variant: "default",
          });
          
          // Check if this was their last download
          if (modelsRemaining === 1) {
            setTimeout(() => {
              toast({
                title: "Last Download Used",
                description: "You've used your last free download for this month.",
                variant: "default",
              });
            }, 2000);
          }
        }
      } else {
        // For Pro users, just show a notification about the count
        toast({
          title: "STL Downloaded",
          description: `You've downloaded ${totalDownloads + 1} of 20 files this month.`,
          variant: "default",
        });
      }
    }
  };

  // Implement the overlay approach to intercept download button clicks
  useEffect(() => {
    // Create an overlay only when the iframe is loaded
    if (isLoading || hasError) return;
    
    console.log("Setting up download button overlay...");
    
    // The overlay positioning function
    const positionOverlay = () => {
      const iframe = document.querySelector('iframe[src="https://magic.taiyaki.ai"]') as HTMLIFrameElement;
      if (!iframe || !overlayRef.current) return;
      
      // Get iframe position
      const iframeRect = iframe.getBoundingClientRect();
      
      // Position our overlay container absolutely over the iframe
      const overlayContainer = overlayRef.current;
      overlayContainer.style.position = 'absolute';
      overlayContainer.style.top = `${iframeRect.top}px`;
      overlayContainer.style.left = `${iframeRect.left}px`;
      overlayContainer.style.width = `${iframeRect.width}px`;
      overlayContainer.style.height = `${iframeRect.height}px`;
      overlayContainer.style.pointerEvents = 'none'; // Let events pass through by default
      overlayContainer.style.zIndex = '1000';
      
      // Clear any existing interceptors
      overlayContainer.innerHTML = '';
      
      // Create specific interceptors for known download button positions
      const buttonPositions = getDownloadButtonPositions();
      
      buttonPositions.forEach((pos, index) => {
        const interceptor = document.createElement('div');
        interceptor.className = 'download-interceptor';
        interceptor.style.position = 'absolute';
        interceptor.style.top = `${pos.top}px`;
        interceptor.style.left = `${pos.left}px`;
        interceptor.style.width = `${pos.width}px`;
        interceptor.style.height = `${pos.height}px`;
        interceptor.style.pointerEvents = 'auto'; // Catch clicks
        interceptor.style.cursor = 'pointer';
        interceptor.style.background = 'rgba(0, 0, 0, 0)'; // Transparent
        interceptor.dataset.buttonIndex = index.toString();
        
        // Add debug highlight (remove in production)
        if (import.meta.env.DEV) {
          interceptor.style.background = 'rgba(255, 0, 0, 0.1)';
          interceptor.style.border = '1px solid red';
        }
        
        // Add click listener
        interceptor.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log(`Download button intercepted at position ${index}`);
          handleDownloadDetected();
        });
        
        overlayContainer.appendChild(interceptor);
      });
      
      console.log(`Positioned ${buttonPositions.length} download button interceptors`);
    };
    
    // This function returns the positions of download buttons based on the iframe content
    // These positions would need to be determined by inspecting the iframe content
    const getDownloadButtonPositions = () => {
      // These values are examples and should be replaced with actual positions
      // Try to locate the buttons in the Taiyaki AI interface
      return [
        // Top right corner - common position for export/download buttons
        { top: 80, left: 520, width: 120, height: 40 },
        
        // Bottom right corner - another common position
        { top: 480, left: 520, width: 120, height: 40 },
        
        // Middle right side - common for sidebar buttons
        { top: 250, left: 520, width: 120, height: 40 },
        
        // If there's a specific download STL button you know about, add its position
        // Example: "download stl" button in a specific location
        { top: 400, left: 400, width: 150, height: 50 },
      ];
    };
    
    // Position the overlay initially
    positionOverlay();
    
    // Reposition on window resize or iframe content changes
    window.addEventListener('resize', positionOverlay);
    
    // Check periodically for changes in the iframe content
    const checkInterval = setInterval(positionOverlay, 2000);
    
    // Cleanup function
    return () => {
      window.removeEventListener('resize', positionOverlay);
      clearInterval(checkInterval);
    };
  }, [isLoading, hasError, handleDownloadDetected]);

  // Original event handler for the iframe messages
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from the iframe origin
      if (event.origin !== "https://magic.taiyaki.ai") return;
      
      console.log('Received message from Taiyaki AI:', event.data);
      
      try {
        // Check if the message indicates an error
        if (event.data && typeof event.data === 'object' && event.data.type === 'error') {
          console.error('Error from Taiyaki AI iframe:', event.data.message);
          toast({
            title: "Taiyaki AI Error",
            description: "There was an issue with the AI service. Please try again later.",
            variant: "destructive",
          });
          return;
        }
        
        // Track ONLY download-specific events
        // Look for download event types
        const isDownloadEvent = event.data && typeof event.data === 'object' && (
          // Very specific STL download events
          (event.data.type === 'download_stl') ||
          (event.data.action === 'download_stl') ||
          // File download with .stl extension
          (event.data.filename && event.data.filename.toLowerCase().endsWith('.stl')) ||
          // Explicit download action with STL format
          (event.data.action === 'download' && event.data.format === 'stl')
        );
        
        if (isDownloadEvent) {
          console.log('Confirmed STL download from iframe message');
          await handleDownloadDetected();
        }
      } catch (error) {
        console.error('Error processing message from iframe:', error);
      }
    };

    // Add event listener for messages from the iframe
    window.addEventListener('message', handleMessage);
    
    // Clean up the event listener when component unmounts
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [toast, decrementModelCount, subscription.isPro, navigate, modelsRemaining, trackDownload, totalDownloads]);

  // Configure iframe on load - with improved download tracking
  useEffect(() => {
    const configureIframe = () => {
      const iframe = document.querySelector('iframe[src="https://magic.taiyaki.ai"]') as HTMLIFrameElement;
      if (!iframe || !iframe.contentWindow) return;
      
      try {
        // Send subscription status to iframe with a more specific type
        iframe.contentWindow.postMessage(
          { 
            type: 'fishcad_configure', 
            isPro: subscription.isPro,
            modelsRemaining: modelsRemaining,
            modelLimit: modelLimit,
            userId: user?.id || 'anonymous'
          },
          "https://magic.taiyaki.ai"
        );
        
        console.log('Sent configuration to Taiyaki AI:', { 
          type: 'fishcad_configure',
          isPro: subscription.isPro,
          modelsRemaining,
          modelLimit,
          userId: user?.id || 'anonymous'
        });
      } catch (error) {
        console.error('Error configuring iframe:', error);
      }
    };
    
    // Configure iframe when it loads
    if (!isLoading && !hasError) {
      configureIframe();
      
      // Set a recurring timer to refresh the configuration
      const configInterval = setInterval(configureIframe, 30000); // Every 30 seconds
      
      return () => {
        clearInterval(configInterval);
      };
    }
  }, [isLoading, hasError, subscription.isPro, modelsRemaining, modelLimit, user]);

  // Handle iframe load errors
  const handleIframeError = () => {
    setHasError(true);
    setIsLoading(false);
    toast({
      title: "Connection Error",
      description: "Could not connect to Taiyaki AI service. Please try again later.",
      variant: "destructive",
    });
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <Card className="flex-1 relative overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg">Taiyaki AI</CardTitle>
              <CardDescription>Create and edit 3D models using AI</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {subscription.isPro && (
                <span className="bg-primary/10 text-primary text-xs px-2 py-1 rounded-full flex items-center">
                  <Crown className="h-3 w-3 mr-1" />
                  Pro
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-0 h-[calc(100%-12rem)]">
          {/* Show the AI interface for everyone, but track usage limits */}
          {isLoading && !hasError && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">Loading Taiyaki AI...</span>
            </div>
          )}
          
          {hasError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10 p-4 text-center">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <h3 className="text-lg font-medium mb-2">Connection Error</h3>
              <p className="text-muted-foreground mb-4">Could not connect to the Taiyaki AI service. The service might be temporarily unavailable.</p>
              <Button onClick={() => {
                setIsLoading(true);
                setHasError(false);
                // Force iframe to reload
                const iframe = document.querySelector('iframe[src="https://magic.taiyaki.ai"]') as HTMLIFrameElement;
                if (iframe) {
                  iframe.src = iframe.src;
                }
              }}>
                Try Again
              </Button>
            </div>
          ) : (
            <div className="relative h-full">
              <iframe 
                src="https://magic.taiyaki.ai"
                className="w-full h-full border-0"
                title="Taiyaki AI"
                onLoad={() => setIsLoading(false)}
                onError={handleIframeError}
                allow="microphone; clipboard-write; camera; clipboard-read; display-capture"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads allow-modals allow-presentation allow-popups-to-escape-sandbox"
              />
              
              {/* Transparent overlay for non-Pro users that prevents interaction but allows viewing */}
              {!subscription.isPro && !isLoading && !hasError && (
                <div 
                  className="absolute inset-0 z-20 pointer-events-auto cursor-not-allowed" 
                  style={{ background: 'transparent' }}
                  onClick={() => {
                    toast({
                      title: "Pro Feature",
                      description: "The AI Generator is available exclusively to Pro users.",
                      variant: "default",
                    });
                  }}
                />
              )}
              
              {/* Download button interceptor overlay container */}
              <div ref={overlayRef} className="download-interceptor-container"></div>
            </div>
          )}
        </CardContent>
        
        <CardFooter className="p-3 flex-col" style={{minHeight: "80px"}}>
          {/* Information about the feature */}
          <div className="w-full flex items-center justify-center">
            <div className="flex items-center">
              <Info className="h-3 w-3 text-muted-foreground mr-1" />
              <span className="text-xs text-muted-foreground">Create custom 3D models with AI</span>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
} 