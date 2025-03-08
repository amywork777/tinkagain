import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Crown, Info, Lock } from "lucide-react";
import { useSubscription } from '@/context/SubscriptionContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from "@/hooks/use-toast";
import { FEATURES } from '@/lib/constants';
import { Progress } from '@/components/ui/progress';

export function TaiyakiLibrary() {
  const [isLoading, setIsLoading] = useState(true);
  const { subscription, hasAccess, decrementModelCount } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Calculate model limits and percentages (reuse the same counters as AI)
  const modelLimit = subscription.isPro ? 20 : 3;
  const modelsRemaining = subscription.modelsRemainingThisMonth;
  const modelsUsed = modelLimit - modelsRemaining;
  const usagePercent = Math.min(100, Math.round((modelsUsed / modelLimit) * 100));
  
  // Configure iframe on load
  useEffect(() => {
    const configureIframe = () => {
      if (!iframeRef.current || !iframeRef.current.contentWindow) return;
      
      try {
        // Send subscription status to iframe
        iframeRef.current.contentWindow.postMessage(
          { 
            type: 'configure', 
            isPro: subscription.isPro,
            disableDownloads: !subscription.isPro && modelsRemaining <= 0, // Disable downloads if free user is out of credits
            modelsRemaining: modelsRemaining,
            modelLimit: modelLimit
          },
          "https://library.taiyaki.ai"
        );
        
        console.log('Sent configuration to Taiyaki Library:', { 
          isPro: subscription.isPro, 
          modelsRemaining,
          disableDownloads: !subscription.isPro && modelsRemaining <= 0
        });
      } catch (error) {
        console.error('Error configuring iframe:', error);
      }
    };
    
    // Configure iframe when it loads
    if (!isLoading && iframeRef.current) {
      configureIframe();
    }
  }, [isLoading, subscription.isPro, modelsRemaining, modelLimit]);
  
  // Listen for download requests from the iframe
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from the library iframe origin
      if (event.origin !== "https://library.taiyaki.ai") return;
      
      console.log('Received message from Taiyaki Library:', event.data);
      
      try {
        if (event.data && typeof event.data === 'object') {
          // If this is a download request
          if (event.data.type === 'download_stl' || event.data.type === 'download' || event.data.action === 'download') {
            // Check if user has Pro access or has remaining downloads
            if (!subscription.isPro) {
              if (modelsRemaining <= 0) {
                // Block download if not a Pro user and no credits left
                toast({
                  title: "Limit Reached",
                  description: "You've used all your free downloads this month. Upgrade to Pro for unlimited access.",
                  variant: "destructive",
                });
                
                // Respond to iframe that download is not allowed
                if (iframeRef.current && iframeRef.current.contentWindow) {
                  iframeRef.current.contentWindow.postMessage(
                    { type: 'download_blocked', requiresUpgrade: true },
                    "https://library.taiyaki.ai"
                  );
                }
                
                // Ask if they want to upgrade
                if (window.confirm("You've reached your download limit. Would you like to upgrade to Pro for unlimited downloads?")) {
                  navigate('/pricing');
                }
                
                return;
              } else {
                // Free user with remaining downloads
                // Decrement the model count (reusing the same counter)
                const success = await decrementModelCount();
                
                if (success) {
                  toast({
                    title: "Download Started",
                    description: `You have ${modelsRemaining - 1} downloads remaining this month.`,
                    variant: "default",
                  });
                  
                  // Allow the download
                  if (iframeRef.current && iframeRef.current.contentWindow) {
                    iframeRef.current.contentWindow.postMessage(
                      { type: 'download_allowed' },
                      "https://library.taiyaki.ai"
                    );
                  }
                } else {
                  // Should never happen but just in case
                  toast({
                    title: "Download Error",
                    description: "Could not process your download. Please try again.",
                    variant: "destructive",
                  });
                  return;
                }
              }
            } else {
              // Pro users can download without limitations
              if (iframeRef.current && iframeRef.current.contentWindow) {
                iframeRef.current.contentWindow.postMessage(
                  { type: 'download_allowed' },
                  "https://library.taiyaki.ai"
                );
              }
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
  }, [subscription.isPro, toast, navigate, decrementModelCount, modelsRemaining]);

  // This function will monitor download attempts directly for browser downloads
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // If a free user attempts to download, we should prevent it
      if (!subscription.isPro && event.target !== window && modelsRemaining <= 0) {
        // We don't actually prevent unload, but we can show a notification
        toast({
          title: "Download Limit Reached",
          description: "You've used all your free downloads this month. Upgrade to Pro for unlimited downloads.",
          variant: "destructive",
        });
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [subscription.isPro, toast, modelsRemaining]);

  return (
    <div className="flex flex-col h-full space-y-4">
      <Card className="flex-1 relative overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg">Taiyaki Library</CardTitle>
              <CardDescription>Browse and import models from the Taiyaki library</CardDescription>
            </div>
            {subscription.isPro && (
              <span className="bg-primary/10 text-primary text-xs px-2 py-1 rounded-full flex items-center">
                <Crown className="h-3 w-3 mr-1" />
                Pro
              </span>
            )}
          </div>
        </CardHeader>
        
        <CardContent className="p-0 h-[calc(100%-12rem)]">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">Loading Taiyaki Library...</span>
            </div>
          )}
          <iframe 
            ref={iframeRef}
            src="https://library.taiyaki.ai"
            className="w-full h-full border-0"
            title="Taiyaki Library"
            onLoad={() => setIsLoading(false)}
            allow="clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
          
          {/* Free user restriction banner */}
          {!subscription.isPro && !isLoading && (
            <div className="absolute bottom-0 left-0 right-0 bg-orange-50 border-t border-orange-200 p-2 flex items-center justify-between">
              <div className="flex items-center">
                <Lock className="h-4 w-4 text-orange-500 mr-2" />
                <span className="text-xs text-orange-700">
                  STL downloads from Taiyaki Library require a Pro subscription
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs text-orange-600 hover:text-orange-800 hover:bg-orange-100"
                onClick={() => navigate('/pricing')}
              >
                <Crown className="h-3 w-3 mr-1" />
                Upgrade
              </Button>
            </div>
          )}
        </CardContent>
        
        <CardFooter className="p-3 flex-col" style={{minHeight: "80px"}}>
          {/* Download counter for free users */}
          {!subscription.isPro && (
            <>
              <div className="w-full mb-2">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span>STL Downloads</span>
                  <span className="font-medium">{modelsRemaining}/{modelLimit} remaining</span>
                </div>
                <Progress value={usagePercent} className="h-2" />
              </div>
              
              <div className="w-full mt-2 flex justify-between items-center">
                <span className="text-xs text-muted-foreground">Free users get {modelLimit} downloads per month</span>
                <Button 
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => navigate('/pricing')}
                >
                  <Crown className="h-3 w-3 mr-1" />
                  Upgrade for unlimited
                </Button>
              </div>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  );
} 