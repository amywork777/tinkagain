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
  const modelLimit = subscription.isPro ? 20 : 2;
  const modelsRemaining = subscription.modelsRemainingThisMonth;
  const modelsUsed = modelLimit - modelsRemaining;
  const usagePercent = Math.min(100, Math.round((modelsUsed / modelLimit) * 100));
  
  // Configure iframe on load
  useEffect(() => {
    const configureIframe = () => {
      if (!iframeRef.current || !iframeRef.current.contentWindow) return;
      
      try {
        // Send configuration without download restrictions
        iframeRef.current.contentWindow.postMessage(
          { 
            type: 'configure', 
            isPro: true,  // Always allow Pro features
            disableDownloads: false,  // Never disable downloads
            modelsRemaining: modelLimit,  // Always give full model count
            modelLimit: modelLimit
          },
          "https://library.taiyaki.ai"
        );
        
        console.log('Sent unrestricted configuration to Taiyaki Library');
      } catch (error) {
        console.error('Error configuring iframe:', error);
      }
    };
    
    // Configure iframe when it loads
    if (!isLoading && iframeRef.current) {
      configureIframe();
    }
  }, [isLoading, modelLimit]);
  
  // Listen for download requests from the iframe
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      // Only handle messages from the library iframe origin
      if (event.origin !== "https://library.taiyaki.ai") return;
      
      console.log('Received message from Taiyaki Library:', event.data);
      
      try {
        if (event.data && typeof event.data === 'object') {
          // If this is a download request, always allow it and help facilitate direct download
          if (event.data.type === 'download_stl' || event.data.type === 'download' || event.data.action === 'download') {
            // Always allow downloads
            if (iframeRef.current && iframeRef.current.contentWindow) {
              iframeRef.current.contentWindow.postMessage(
                { 
                  type: 'download_allowed',
                  autoDownload: true,
                  skipPrompt: true 
                },
                "https://library.taiyaki.ai"
              );
            }
            
            // If the message contains a download URL, initiate automatic download
            if (event.data.url) {
              // Create a hidden anchor element
              const a = document.createElement('a');
              a.style.display = 'none';
              a.href = event.data.url;
              a.download = event.data.fileName || 'download.stl';
              
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
  }, [toast, navigate]);

  // Remove before unload handler that restricts downloads
  useEffect(() => {
    // No restrictions on unload
  }, []);

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
            allow="microphone; camera; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads allow-modals allow-presentation allow-popups-to-escape-sandbox allow-top-navigation"
          />
        </CardContent>
        
        <CardFooter className="p-3 flex-col" style={{minHeight: "80px"}}>
          {/* Information about the feature */}
          <div className="w-full flex items-center justify-center">
            <div className="flex items-center">
              <Info className="h-3 w-3 text-muted-foreground mr-1" />
              <span className="text-xs text-muted-foreground">Access models from Taiyaki Library</span>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
} 