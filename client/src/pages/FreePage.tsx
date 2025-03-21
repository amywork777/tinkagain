import React, { useState, useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Viewport } from "@/components/Viewport";
import { TransformControls } from "@/components/TransformControls";
import ToolBar from "@/components/ToolBar";
import { RightSidebar } from "@/components/RightSidebar";
import { Button } from "@/components/ui/button";
import { Printer, PanelLeft, LogIn, LogOut, User, Share2, Crown } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { initFishCadMessageListener } from "@/lib/iframeInterceptor";
import MobileWarning from "@/components/MobileWarning";
import FreeMobileView from "@/components/FreeMobileView";
import { useAuth } from "@/context/AuthContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShareDialog } from "@/components/ShareDialog";
import FishLogo from "@/components/FishLogo";
import STLImporter from "@/components/STLImporter";
import PendingImportDialog from "@/components/PendingImportDialog";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FreeMagicFishAI } from "@/components/FreeMagicFishAI";
import { FreeTaiyakiLibrary } from "@/components/FreeTaiyakiLibrary";

// This custom context provides the free version components to the Sidebar
// without changing the original Sidebar component
export const FreeModeContext = React.createContext({
  TaiyakiLibraryComponent: null as any,
  MagicFishAIComponent: null as any,
  isFreeMode: false
});

// We need to extend the Sidebar to use our free versions of the components
function FreeSidebar({ onClose }: { onClose?: () => void }) {
  return (
    <FreeModeContext.Provider value={{
      TaiyakiLibraryComponent: FreeTaiyakiLibrary,
      MagicFishAIComponent: FreeMagicFishAI,
      isFreeMode: true
    }}>
      <Sidebar onClose={onClose} />
    </FreeModeContext.Provider>
  );
}

// Interface for pending import data stored in localStorage
interface PendingImportData {
  fileName: string;
  timestamp: number;
}

// Function to check for pending imports
function checkForPendingImport(): PendingImportData | null {
  // Check if we arrived with the pending parameter
  const urlParams = new URLSearchParams(window.location.search);
  const hasPendingParam = urlParams.get('pending') === 'true';
  
  if (hasPendingParam) {
    try {
      // Look for pending import data in localStorage
      const pendingImportStr = localStorage.getItem('fishcad_pending_import');
      
      if (pendingImportStr) {
        const pendingImport = JSON.parse(pendingImportStr) as PendingImportData;
        
        // Check if it's recent (within the last minute)
        if (Date.now() - pendingImport.timestamp < 60000) {
          return pendingImport;
        }
      }
    } catch (error) {
      console.error('Error checking for pending import:', error);
    }
  }
  
  return null;
}

export default function FreePage() {
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [useMobileVersion, setUseMobileVersion] = useState(false);
  const [skipMobileWarning, setSkipMobileWarning] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImportData | null>(null);
  const { user, isAuthenticated, login, logout } = useAuth();
  const { subscription } = useSubscription();
  
  // Initialize the FISHCAD message listener when the component mounts
  useEffect(() => {
    // Set up the message listener and get the cleanup function
    const cleanup = initFishCadMessageListener();
    
    // Check for temporary desktop preference (session-only)
    const tempUseDesktop = sessionStorage.getItem("temp-use-desktop");
    if (tempUseDesktop === "true") {
      // This is a one-time skip of the mobile warning for this session only
      setSkipMobileWarning(true);
      // We don't clear the flag as it should persist for the session
    }
    
    // Log that the listener is active
    console.log("FISHCAD STL import message listener initialized");
    
    // Return the cleanup function to be called when the component unmounts
    return cleanup;
  }, []);
  
  // Check for pending imports when the component mounts
  useEffect(() => {
    // Only run in the browser
    if (typeof window === 'undefined') return;
    
    // Check for pending imports
    const pendingImport = checkForPendingImport();
    
    if (pendingImport) {
      console.log('Found pending import:', pendingImport);
      
      // Show the import dialog
      setPendingImport(pendingImport);
      
      // Clear the pending import flag from localStorage
      localStorage.removeItem('fishcad_pending_import');
      
      // Also clear the URL parameter to prevent showing the dialog again on refresh
      const newUrl = window.location.pathname + window.location.hash;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);
  
  // Close the pending import dialog
  const closePendingImportDialog = () => {
    setPendingImport(null);
  };
  
  // Enable mobile version
  const handleUseMobileVersion = () => {
    setUseMobileVersion(true);
  };

  // If mobile version is active, render the free version mobile view with pro-mode popup
  if (useMobileVersion) {
    return <FreeMobileView />;
  }
  
  // Otherwise render the full desktop version
  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen">
        {/* Pro Banner removed */}

        {/* Mobile Warning Overlay - Only skip if explicitly set for this session */}
        {!skipMobileWarning && <MobileWarning onUseMobileVersion={handleUseMobileVersion} />}
        
        {/* Pending Import Dialog */}
        {pendingImport && (
          <PendingImportDialog
            isOpen={true}
            onClose={closePendingImportDialog}
            fileName={pendingImport.fileName}
          />
        )}

        {/* Main content area */}
        <main className="flex flex-1 w-full overflow-hidden relative">
          {/* Sidebar - Left panel */}
          {leftSidebarOpen ? (
            <div className="w-96 flex-shrink-0 border-r border-border overflow-y-auto h-full">
              <FreeSidebar onClose={() => setLeftSidebarOpen(false)} />
            </div>
          ) : (
            <div className="absolute top-4 left-4 z-10">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setLeftSidebarOpen(true)}
                className="h-10 w-10 bg-background/80 backdrop-blur-sm"
              >
                <PanelLeft className="h-5 w-5" />
              </Button>
            </div>
          )}
          
          {/* Main Viewport Area - Center panel */}
          <div className="flex-1 relative h-full">
            <Viewport />
            
            {/* Floating ToolBar positioned */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 w-[90%] md:w-auto">
              <ToolBar />
            </div>
            
            {/* Transform Controls - adjusted for better mobile positioning */}
            <div className="absolute bottom-8 sm:bottom-5 left-1/2 transform -translate-x-1/2 z-10 w-full max-w-[95%] sm:max-w-[90%] md:max-w-[80%] lg:max-w-[60%]">
              <TransformControls />
            </div>
            
            {/* Buttons Container - Combines Share and 3D Print */}
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              {/* Share Button */}
              <div className="flex items-center">
                <ShareDialog />
              </div>
              
              {/* 3D Print Button */}
              <Button 
                variant="primary"
                onClick={() => setRightSidebarOpen(true)}
                className="text-xs sm:text-sm"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline ml-2">3D print with taiyaki</span>
                <span className="sm:hidden ml-2">Print</span>
              </Button>
            </div>
          </div>
          
          {/* Right Sidebar - Overlay positioned */}
          {rightSidebarOpen && (
            <div className="absolute top-0 right-0 h-full z-20">
              <RightSidebar isOpen={rightSidebarOpen} onClose={() => setRightSidebarOpen(false)} />
            </div>
          )}
        </main>
        
        {/* Scene Save and Share */}
        <STLImporter />
      </div>
    </TooltipProvider>
  );
} 