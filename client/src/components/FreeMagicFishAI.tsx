import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Info, Lock } from "lucide-react";
import { useNavigate } from 'react-router-dom';

export function FreeMagicFishAI() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full space-y-4 relative">
      {/* More translucent overlay - still blocks interaction but allows visibility */}
      <div className="absolute inset-0 backdrop-blur-[2px] bg-background/30 z-10 flex flex-col items-center justify-center p-6 pointer-events-auto">
        <div className="bg-background/80 p-6 rounded-lg shadow-lg flex flex-col items-center max-w-xs text-center">
          <Lock className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-2">AI Model Generation</h3>
          <p className="text-sm text-muted-foreground">
            This feature is not available in the free version. Upgrade to Pro for full access.
          </p>
        </div>
      </div>

      {/* Basic card structure to match MagicFishAI's appearance */}
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
          {/* Actual iframe that's visible but not interactive */}
          <iframe
            src="https://magic.taiyaki.ai"
            className="w-full h-full border-0 pointer-events-none"
            title="Taiyaki AI (Read-only)"
            sandbox="allow-scripts allow-same-origin"
          />
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
    </div>
  );
} 