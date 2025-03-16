import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Info, Lock } from "lucide-react";
import { useNavigate } from 'react-router-dom';

export function FreeTaiyakiLibrary() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full space-y-4 relative">
      {/* Overlay with message but no upgrade button */}
      <div className="absolute inset-0 backdrop-blur-sm bg-background/70 z-10 flex flex-col items-center justify-center p-6">
        <Lock className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold mb-2">Taiyaki Library Access</h3>
        <p className="text-center text-muted-foreground mb-4">
          This feature is not available in this version.
        </p>
      </div>

      {/* Basic card structure to match TaiyakiLibrary's appearance */}
      <Card className="flex-1 relative overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-lg">Taiyaki Library</CardTitle>
              <CardDescription>Browse and import models from the Taiyaki library</CardDescription>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-0 h-[calc(100%-12rem)]">
          {/* Empty content area that would normally contain the iframe */}
          <div className="w-full h-full bg-muted/20"></div>
        </CardContent>
        
        <CardFooter className="p-3 flex-col" style={{minHeight: "80px"}}>
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