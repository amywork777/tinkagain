import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

interface ExternalLibraryFrameProps {
  src: string;
  title?: string;
  height?: string | number;
  width?: string | number;
  className?: string;
  allowFullIntegration?: boolean;
}

/**
 * ExternalLibraryFrame component
 * 
 * A wrapper for iframes that securely embeds external library content
 * from allowed origins like magic.taiyaki.ai and library.taiyaki.ai
 */
export function ExternalLibraryFrame({
  src,
  title = 'External Library',
  height = 600,
  width = '100%',
  className = '',
  allowFullIntegration = true, // Default to allowing full integration
}: ExternalLibraryFrameProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [iframeElement, setIframeElement] = useState<HTMLIFrameElement | null>(null);

  // Check if the source URL is from an allowed domain
  const isAllowedDomain = () => {
    try {
      const url = new URL(src);
      return ['magic.taiyaki.ai', 'library.taiyaki.ai'].includes(url.hostname);
    } catch (err) {
      return false;
    }
  };

  // Handle iframe load event
  const handleLoad = () => {
    setLoading(false);
    // Indicate to the iframe that FISHCAD is ready
    if (iframeElement && iframeElement.contentWindow) {
      try {
        const targetOrigin = new URL(src).origin;
        iframeElement.contentWindow.postMessage({
          type: 'fishcad-ready',
          ready: true,
          version: '1.0'
        }, targetOrigin);
        
        // Log that we sent the ready message
        console.log(`Sent fishcad-ready message to ${targetOrigin}`);
      } catch (err) {
        console.error('Error sending ready message to iframe:', err);
      }
    }
  };

  // Handle iframe error event
  const handleError = () => {
    setLoading(false);
    setError('Failed to load external content');
    console.error(`Failed to load iframe content from: ${src}`);
  };

  // Set up message listener for direct communication with iframe
  useEffect(() => {
    // Only add listeners if we have an iframe element
    if (!iframeElement) return;
    
    // Listen for message events
    const handleMessage = (event: MessageEvent) => {
      // Validate the origin
      try {
        const srcOrigin = new URL(src).origin;
        if (event.origin !== srcOrigin) {
          return; // Ignore messages from other origins
        }
        
        // Handle specific message types
        if (event.data?.type === 'iframe-height') {
          // Handle iframe height request (responsive iframe)
          const requestedHeight = event.data.height;
          if (requestedHeight && typeof requestedHeight === 'number') {
            iframeElement.style.height = `${requestedHeight}px`;
          }
        }
        
        // Log received messages for debugging
        console.log(`Received message from iframe (${event.origin}):`, event.data);
      } catch (err) {
        console.error('Error processing iframe message:', err);
      }
    };
    
    // Add event listener
    window.addEventListener('message', handleMessage);
    
    // Cleanup
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [iframeElement, src]);

  // If the domain is not allowed, show an error
  if (!isAllowedDomain()) {
    return (
      <Card className={`flex items-center justify-center bg-red-50 dark:bg-red-900/20 ${className}`} style={{ height, width }}>
        <div className="text-center p-4">
          <p className="text-red-500 font-medium">Security Error</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
            This domain is not in the allowed list of external libraries.
          </p>
        </div>
      </Card>
    );
  }

  // Set ref callback to store the iframe element
  const iframeRef = (element: HTMLIFrameElement) => {
    if (element !== null) {
      setIframeElement(element);
    }
  };

  return (
    <div className={`relative ${className}`} style={{ height, width }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 dark:bg-gray-800">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 dark:bg-red-900/20">
          <div className="text-center p-4">
            <p className="text-red-500 font-medium">{error}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
              Please try again later or contact support.
            </p>
          </div>
        </div>
      )}
      
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        width="100%"
        height="100%"
        frameBorder="0"
        onLoad={handleLoad}
        onError={handleError}
        sandbox={allowFullIntegration ? 
          "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation allow-downloads" : 
          "allow-scripts allow-same-origin allow-forms allow-popups"
        }
        referrerPolicy="no-referrer-when-downgrade"
        allow="clipboard-read; clipboard-write; microphone; camera; accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        className={`${loading || error ? 'invisible' : 'visible'}`}
      />
    </div>
  );
}

export default ExternalLibraryFrame; 