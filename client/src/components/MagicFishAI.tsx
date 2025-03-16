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
  
  // Calculate model limits and percentages
  const modelLimit = subscription.isPro ? 20 : 2;
  const modelsRemaining = subscription.modelsRemainingThisMonth;
  const modelsUsed = modelLimit - modelsRemaining;
  const usagePercent = Math.min(100, Math.round((modelsUsed / modelLimit) * 100));
  
  // Track total downloads from Firebase
  const totalDownloads = subscription.downloadsThisMonth || 0;

  // Configure iframe on load with unrestricted access
  useEffect(() => {
    const configureIframe = () => {
      const iframe = document.querySelector('iframe[src="https://magic.taiyaki.ai"]') as HTMLIFrameElement;
      if (!iframe || !iframe.contentWindow) return;
      
      try {
        // Send configuration that allows all features
        iframe.contentWindow.postMessage(
          { 
            type: 'fishcad_configure', 
            isPro: true, // Always allow Pro features
            modelsRemaining: modelLimit, // Always give full model count
            modelLimit: modelLimit,
            userId: user?.id || 'anonymous'
          },
          "https://magic.taiyaki.ai"
        );
        
        console.log('Sent unrestricted configuration to Magic Fish AI');
      } catch (error) {
        console.error('Error configuring iframe:', error);
      }
    };
    
    // Configure iframe when it loads
    if (!isLoading && !hasError) {
      configureIframe();
    }
    
    // Configure periodically to ensure settings persist
    const configInterval = setInterval(configureIframe, 30000); // Every 30 seconds
    
    return () => {
      clearInterval(configInterval);
    };
  }, [isLoading, hasError, modelLimit, user?.id]);
  
  // Handle iframe load errors
  const handleIframeError = () => {
    setIsLoading(false);
    setHasError(true);
    toast({
      title: "Failed to load AI",
      description: "There was a problem loading the AI interface. Please try again later.",
      variant: "destructive"
    });
  };

  // Handle reload button click
  const handleReload = () => {
    setIsLoading(true);
    setHasError(false);
    
    // Force iframe to reload
    const iframe = document.querySelector('iframe[src="https://magic.taiyaki.ai"]') as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
  };

  // Add message listener for download requests
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from the AI iframe origin
      if (event.origin !== "https://magic.taiyaki.ai") return;
      
      console.log('Received message from Taiyaki AI:', event.data);
      
      try {
        if (event.data && typeof event.data === 'object') {
          // If this is a download request
          if (event.data.type === 'download_stl' || event.data.type === 'download' || 
              event.data.action === 'download' || 
              (event.data.filename && event.data.filename.toLowerCase().endsWith('.stl'))) {
            
            // Send message that download is allowed
            const iframe = document.querySelector('iframe[src="https://magic.taiyaki.ai"]') as HTMLIFrameElement;
            if (iframe && iframe.contentWindow) {
              iframe.contentWindow.postMessage(
                { 
                  type: 'download_allowed',
                  autoDownload: true,
                  skipPrompt: true 
                },
                "https://magic.taiyaki.ai"
              );
            }
            
            // If the message contains a download URL, initiate automatic download
            if (event.data.url) {
              // Create a hidden anchor element
              const a = document.createElement('a');
              a.style.display = 'none';
              a.href = event.data.url;
              a.download = event.data.filename || event.data.fileName || 'download.stl';
              
              // Add to DOM, click it, and remove it
              document.body.appendChild(a);
              a.click();
              
              // Small timeout before removal to ensure download begins
              setTimeout(() => {
                document.body.removeChild(a);
              }, 100);
            }
          }
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
  }, []);

  return (
    <div className="flex flex-col h-full space-y-4">
      <Card className="flex-1 overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg">Taiyaki AI</CardTitle>
              <CardDescription>Create 3D models with AI</CardDescription>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-0 h-[calc(100%-7rem)]">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">Loading Taiyaki AI...</span>
            </div>
          )}
          
          {hasError ? (
            <div className="flex flex-col items-center justify-center h-full p-4">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <h3 className="font-semibold text-lg mb-2">Failed to load AI</h3>
              <p className="text-muted-foreground text-center mb-4">
                There was a problem connecting to the Taiyaki AI service.
              </p>
              <Button onClick={handleReload}>
                Try Again
              </Button>
            </div>
          ) : (
            <iframe
              src="https://magic.taiyaki.ai"
              className="w-full h-full"
              title="Taiyaki AI"
              onLoad={() => setIsLoading(false)}
              onError={handleIframeError}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads allow-modals allow-presentation allow-popups-to-escape-sandbox allow-top-navigation"
              allow="clipboard-write; downloads"
            />
          )}
        </CardContent>
        
        <CardFooter className="p-3 flex-col">
          <div className="w-full flex items-center justify-center">
            <div className="flex items-center">
              <Info className="h-3 w-3 text-muted-foreground mr-1" />
              <span className="text-xs text-muted-foreground">Powered by Taiyaki AI</span>
            </div>
          </div>
        </CardFooter>
      </Card>
      
      {/* Remove any references to overlays */}
      {/* No need for overlay ref div anymore */}
    </div>
  );
} 