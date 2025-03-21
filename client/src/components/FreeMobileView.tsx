import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, ArrowLeft, Crown } from "lucide-react";
import { Link } from "react-router-dom";

const FreeMobileView: React.FC = () => {
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
            <p className="text-lg font-medium">Loading preview...</p>
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
        </div>
      </div>
      
      {/* Pro Mode Overlay - Always visible */}
      <div className="absolute inset-0 bg-background/50 backdrop-blur-sm flex items-center justify-center z-40 pointer-events-auto">
        <div className="bg-card p-6 rounded-lg shadow-lg max-w-sm w-full text-center">
          <Crown className="h-12 w-12 mx-auto text-yellow-500 mb-3" />
          <h2 className="text-xl font-bold mb-2">Pro Feature</h2>
          <p className="mb-4">Mobile AI modeling is only available in the Pro version.</p>
          <p className="text-sm text-muted-foreground mb-4">Upgrade to access all features including mobile AI modeling.</p>
          <div className="flex flex-col gap-2">
            <Button asChild variant="default" size="lg">
              <Link to="/pricing">Upgrade to Pro</Link>
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleSwitchToDesktop}
            >
              Return to Desktop Version
            </Button>
          </div>
        </div>
      </div>
      
      {/* Embedded magic.taiyaki.ai iframe - with pointer-events-none to make it non-interactive */}
      <iframe
        ref={iframeRef}
        src="https://magic.taiyaki.ai/"
        className="w-full h-full border-none pointer-events-none"
        title="Magic Taiyaki AI Preview"
        sandbox="allow-scripts allow-same-origin"
        style={{ filter: "blur(2px)" }}
      ></iframe>
    </div>
  );
}

export default FreeMobileView;