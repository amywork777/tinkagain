import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Info, Lock } from "lucide-react";
import { useNavigate } from 'react-router-dom';

export function FreeMagicFishAI() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full space-y-4 relative">
      {/* Overlay with message but no upgrade button */}
      <div className="absolute inset-0 backdrop-blur-sm bg-background/70 z-10 flex flex-col items-center justify-center p-6">
        <Lock className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold mb-2">AI Model Generation</h3>
        <p className="text-center text-muted-foreground mb-4">
          This feature is not available in this version.
        </p>
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
          {/* Empty content area that would normally contain the iframe */}
          <div className="w-full h-full bg-muted/20"></div>
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