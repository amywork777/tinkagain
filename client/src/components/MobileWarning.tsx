import React, { useEffect, useState } from "react";
import { ComputerIcon, SmartphoneIcon, ExternalLinkIcon, ArrowLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface MobileWarningProps {
  onUseMobileVersion: () => void;
}

const MobileWarning: React.FC<MobileWarningProps> = ({ onUseMobileVersion }) => {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    // More comprehensive mobile detection
    const checkMobile = () => {
      // Get user agent string
      const userAgent = 
        navigator.userAgent || navigator.vendor || (window as any).opera;
      
      // Check for mobile width (less than 768px is typically considered mobile)
      const isMobileWidth = window.innerWidth < 768;
      
      // Check for mobile user agent patterns
      const isMobileUserAgent = 
        /android|webos|iphone|ipod|blackberry|iemobile|opera mini/i.test(
          userAgent.toLowerCase()
        );
      
      // Check for touch capability (most mobile devices have touch)
      const hasTouchCapability = 
        'ontouchstart' in window || 
        navigator.maxTouchPoints > 0 || 
        (navigator as any).msMaxTouchPoints > 0;
        
      // Consider tablets as mobile for this warning too (include iPad)
      const isTablet = 
        /ipad/i.test(userAgent.toLowerCase()) ||
        (/tablet|ipad/i.test(userAgent.toLowerCase()) && !(/mobile/i.test(userAgent.toLowerCase())));
      
      // Set as mobile if any of these conditions are true
      setIsMobile(isMobileWidth || isMobileUserAgent || isTablet || (hasTouchCapability && isMobileWidth));
    };

    // Check immediately on mount
    checkMobile();

    // Check again if window is resized
    window.addEventListener("resize", checkMobile);
    
    // Clean up event listener
    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  // Navigate user back to taiyaki.ai website
  const handleReturnToTaiyaki = () => {
    window.location.href = "https://taiyaki.ai";
  };
  
  // User clicked to use the mobile version
  const handleUseMobileVersion = () => {
    onUseMobileVersion();
  };

  // User clicked to continue with desktop version
  const handleContinueToDesktop = () => {
    // Just use a session-only flag so it shows again on next visit
    sessionStorage.setItem("temp-use-desktop", "true");
    window.location.reload();
  };

  if (!isMobile) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-background/95 to-background/90 backdrop-blur-lg z-50 flex flex-col items-center justify-center p-4 text-center">
      <Card className="bg-card shadow-lg rounded-lg max-w-md flex flex-col items-center space-y-4 border border-primary/20 p-6 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/5 rounded-full blur-xl"></div>
        <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-primary/5 rounded-full blur-xl"></div>
        
        <div className="flex items-center space-x-3 mb-2 z-10">
          <SmartphoneIcon className="h-8 w-8 text-primary" />
          <span className="text-xl font-bold">Mobile Device Detected</span>
        </div>
        
        <p className="text-md mb-2 z-10">
          FishCAD works best on a desktop or laptop computer.
        </p>
        
        <div className="bg-muted/80 p-4 rounded-md mb-2 z-10 text-left">
          <p className="text-sm mb-3">
            Why a desktop is recommended:
          </p>
          <ul className="text-sm space-y-2 pl-2">
            <li className="flex items-start">
              <ArrowLeftIcon className="h-3 w-3 mr-2 mt-1 text-primary" />
              <span>Precision 3D modeling needs a larger screen and mouse</span>
            </li>
            <li className="flex items-start">
              <ArrowLeftIcon className="h-3 w-3 mr-2 mt-1 text-primary" />
              <span>Full CAD tools are only available on desktop</span>
            </li>
            <li className="flex items-start">
              <ArrowLeftIcon className="h-3 w-3 mr-2 mt-1 text-primary" />
              <span>Complex designs are difficult to create on mobile</span>
            </li>
          </ul>
        </div>
        
        <div className="flex flex-col w-full space-y-3 mt-2 z-10">
          <Button 
            onClick={handleReturnToTaiyaki} 
            variant="default" 
            className="bg-primary hover:bg-primary/90"
          >
            <ExternalLinkIcon className="h-4 w-4 mr-2" />
            Return to taiyaki.ai
          </Button>
          
          <Button onClick={handleUseMobileVersion} variant="outline">
            <SmartphoneIcon className="h-4 w-4 mr-2" />
            Try Magic Taiyaki AI
          </Button>
          
          <Button onClick={handleContinueToDesktop} variant="outline" className="text-sm opacity-70">
            <ComputerIcon className="h-4 w-4 mr-2" />
            Continue to Desktop Version
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default MobileWarning; 