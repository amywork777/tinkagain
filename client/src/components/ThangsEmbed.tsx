import React, { useState, useEffect } from 'react';
import { Loader2, ExternalLink, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";

// Define props interface
interface ThangsEmbedProps {
  modelId: string;
  height?: string;
  width?: string;
}

// The URL to embed
const THANGS_URL = 'https://thangs.com/search/fish?scope=all&fileTypes=stl&freeModels=true&sort=nDownloads';

// Define only the working proxies
const PROXIES = [
  // Proxy 1 - cors.eu.org - works well with image fix
  `https://cors.eu.org/${THANGS_URL}`,
  // Proxy 2 - allorigins with HTML mode to fix images
  `https://api.allorigins.win/get?url=${encodeURIComponent(THANGS_URL)}&callback=processAllOriginsResponse`
];

// Proxy names for display
const PROXY_NAMES = ["CORS.eu.org", "AllOrigins"];

// Single model embed component
export const ThangsModelEmbed = ({ modelId, height = "600px", width = "100%" }: ThangsEmbedProps) => {
  return (
    <div style={{ width, height }}>
      <iframe
        src={`https://thangs.com/embed/${modelId}?hideExplore=true&hideMenu=true&autoRotate=true&hideShare=true`}
        width="100%"
        height="100%"
        frameBorder="0"
        allow="microphone; camera; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      ></iframe>
    </div>
  );
};

// Browse interface component
export function ThangsEmbed() {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentProxyIndex, setCurrentProxyIndex] = useState(0);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);

  // Create a function to open Thangs in a new tab as fallback
  const openThangsInNewTab = () => {
    window.open(THANGS_URL, '_blank');
  };

  // Toggle between the two proxies
  const toggleProxy = () => {
    const nextIndex = (currentProxyIndex + 1) % PROXIES.length;
    setCurrentProxyIndex(nextIndex);
    setIsLoading(true);
    setHasError(false);
    setHtmlContent(null);
  };

  // Special handling for allorigins proxy (index 1)
  useEffect(() => {
    if (currentProxyIndex === 1) {
      // Define the callback function for allorigins
      (window as any).processAllOriginsResponse = (data: any) => {
        if (data && data.contents) {
          try {
            // Fix image URLs in the HTML content
            let html = data.contents;
            
            // Replace relative image URLs with absolute ones
            html = html.replace(/src="\/([^"]*)"/g, 'src="https://thangs.com/$1"');
            html = html.replace(/src='\/([^']*)'/g, "src='https://thangs.com/$1'");
            
            // Replace CDN URLs to go through the proxy
            html = html.replace(
              /src="https:\/\/cdn\.thangs\.com\/([^"]*)"/g, 
              `src="https://cors.eu.org/https://cdn.thangs.com/$1"`
            );
            
            setHtmlContent(html);
            setIsLoading(false);
          } catch (error) {
            console.error('Error processing AllOrigins response:', error);
            setHasError(true);
            setIsLoading(false);
          }
        } else {
          setHasError(true);
          setIsLoading(false);
        }
      };
    }
  }, [currentProxyIndex]);

  // Add CSS to fix CORS issues with images when using Proxy 1
  const injectCorsFixStyle = `
    <style>
      /* Fix for CORS issues with images */
      img[src^="https://cdn.thangs.com/"] {
        content: url("https://cors.eu.org/" attr(src));
      }
    </style>
  `;

  return (
    <div className="flex flex-col h-full">
      <Card className="flex-1 overflow-hidden flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg">Thangs 3D Models</CardTitle>
              <CardDescription>Browse free 3D models of fish</CardDescription>
            </div>
            <div className="flex space-x-2">
              <Button variant="ghost" size="sm" onClick={toggleProxy} disabled={isLoading}>
                <RefreshCcw className="h-4 w-4 mr-2" />
                Try Other Proxy
              </Button>
              <Button variant="outline" size="sm" onClick={openThangsInNewTab}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in New Tab
              </Button>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="flex-1 p-0 overflow-hidden">
          <div className="w-full h-full relative">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2">Loading Thangs via {PROXY_NAMES[currentProxyIndex]}...</span>
              </div>
            )}
            
            {currentProxyIndex === 1 && htmlContent ? (
              // For allorigins proxy, we need to render the HTML content directly
              <iframe
                srcDoc={`${injectCorsFixStyle}${htmlContent}`}
                className="w-full h-full border-0"
                title="Thangs 3D Models (AllOrigins)"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
                allow="microphone; camera; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              />
            ) : currentProxyIndex === 0 ? (
              // For cors.eu.org proxy, inject CSS to fix image loading
              <iframe
                key={currentProxyIndex}
                src={PROXIES[currentProxyIndex]}
                className="w-full h-full border-0"
                title="Thangs 3D Models"
                onLoad={(e) => {
                  setIsLoading(false);
                  // Inject CSS to fix image loading
                  try {
                    const iframe = e.target as HTMLIFrameElement;
                    if (iframe.contentDocument) {
                      const style = iframe.contentDocument.createElement('style');
                      style.textContent = `
                        img[src^="https://cdn.thangs.com/"] {
                          content: url("https://cors.eu.org/" + attr(src));
                        }
                      `;
                      iframe.contentDocument.head.appendChild(style);
                    }
                  } catch (error) {
                    console.error('Error injecting CSS:', error);
                  }
                }}
                onError={() => {
                  setIsLoading(false);
                  setHasError(true);
                }}
                referrerPolicy="no-referrer"
                loading="lazy"
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads"
                allow="microphone; camera; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              />
            ) : null}

            {hasError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 z-10 p-4">
                <h3 className="text-lg font-medium mb-2">Could not embed Thangs</h3>
                <p className="text-muted-foreground mb-4 text-center">
                  {PROXY_NAMES[currentProxyIndex]} proxy is currently unavailable.
                </p>
                <div className="flex flex-col space-y-2">
                  <Button onClick={toggleProxy}>
                    Try {PROXY_NAMES[(currentProxyIndex + 1) % PROXIES.length]} Instead
                  </Button>
                  <Button variant="outline" onClick={openThangsInNewTab}>
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open Thangs in New Tab
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter className="p-3 flex justify-between">
          <p className="text-xs text-muted-foreground">
            Explore fish models from Thangs.com - printable 3D models
          </p>
          <p className="text-xs text-muted-foreground">
            Using {PROXY_NAMES[currentProxyIndex]} proxy
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}