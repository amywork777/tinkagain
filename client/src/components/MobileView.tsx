import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowLeft } from "lucide-react";

const MobileView: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Handle the iframe load event
  useEffect(() => {
    const handleIframeLoaded = () => {
      setIsLoading(false);
    };
    
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.addEventListener('load', handleIframeLoaded);
    }
    
    return () => {
      if (iframe) {
        iframe.removeEventListener('load', handleIframeLoaded);
      }
    };
  }, []);
  
  // Auto-hide controls after 5 seconds
  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => {
        setShowControls(false);
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [isLoading]);
  
  // Refresh the iframe content
  const handleRefresh = () => {
    setIsLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = "https://magic.taiyaki.ai/";
    }
  };
  
  // Return to desktop version
  const handleSwitchToDesktop = () => {
    sessionStorage.setItem("temp-use-desktop", "true");
    window.location.reload();
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-background">
      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="text-center space-y-4">
            <RefreshCw className="h-12 w-12 animate-spin mx-auto text-primary" />
            <p className="text-lg font-medium">Loading AI-powered modeling...</p>
          </div>
        </div>
      )}
      
      {/* Controls - only show when showControls is true or on touch */}
      <div 
        className={`absolute top-4 left-4 right-4 z-40 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}
        onMouseEnter={() => setShowControls(true)}
        onTouchStart={() => setShowControls(true)}
      >
        <div className="flex justify-between gap-2">
          {/* Back to Desktop Button */}
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleSwitchToDesktop}
            className="shadow-lg"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span>Desktop Version</span>
          </Button>
          
          {/* Refresh Button */}
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={handleRefresh}
            className="shadow-lg"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            <span>Refresh</span>
          </Button>
        </div>
      </div>
      
      {/* Invisible touch area to show controls */}
      <div 
        className="absolute inset-0 z-30 pointer-events-auto touch-manipulation"
        style={{ pointerEvents: showControls ? 'none' : 'auto' }}
        onClick={() => setShowControls(true)}
      />
      
      {/* Embedded magic.taiyaki.ai iframe */}
      <iframe
        ref={iframeRef}
        src="https://magic.taiyaki.ai/"
        className="w-full h-full border-none"
        title="Magic Taiyaki AI"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
        allow="accelerometer; camera; clipboard-write; fullscreen; gyroscope; microphone; payment"
      ></iframe>
    </div>
  );
}
};

export default MobileView; // Added a comment
