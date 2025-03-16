import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { 
  CheckCircle2, 
  AlertCircle, 
  Loader2
} from "lucide-react";

export interface OrderSummaryProps {
  // Price information
  basePrice: number;
  materialCost?: number;
  printingCost?: number;
  shippingCost?: number;
  finalPrice: number;
  complexityFactor?: number;
  printability?: {
    factor: number;
    category: string;
    hasOverhangs: boolean;
    hasThinWalls: boolean;
    hasFloatingIslands: boolean;
  };
  
  // Status information
  priceSource: 'api' | 'estimate';
  isPriceCalculating: boolean;
  isPreparing: boolean;
  
  // Model information
  selectedModelName: string | null;
  selectedFilament: string;
  quantity: number;
  
  // Actions
  onCalculatePrice: () => void;
  
  // Formatting
  formatPrice: (amount: number) => string;
}

export function OrderSummary({
  // Price information
  basePrice,
  materialCost,
  printingCost,
  shippingCost,
  finalPrice,
  complexityFactor = 1.0,
  printability,
  
  // Status information
  priceSource,
  isPriceCalculating,
  isPreparing,
  
  // Model information
  selectedModelName,
  selectedFilament,
  quantity,
  
  // Actions
  onCalculatePrice,
  
  // Formatting
  formatPrice
}: OrderSummaryProps) {
  // Local state for API connection attempts
  const [connectionAttempts, setConnectionAttempts] = React.useState(0);
  
  // Update connection attempts when price calculation starts
  React.useEffect(() => {
    if (isPriceCalculating) {
      setConnectionAttempts(prev => prev + 1);
    }
  }, [isPriceCalculating]);
  
  const connectionStatus = React.useMemo(() => {
    if (priceSource === 'api') {
      return 'success';
    }
    
    if (isPriceCalculating || isPreparing) {
      return 'connecting';
    }
    
    if (connectionAttempts >= 3) {
      return 'failed';
    } else if (connectionAttempts > 0) {
      return 'retrying';
    }
    
    return 'pending';
  }, [priceSource, isPriceCalculating, isPreparing, connectionAttempts]);
  
  return (
    <Card className="w-full shadow-sm">
      <CardHeader className="pb-2">
        <div>
          <CardTitle className="text-lg font-medium">Order Summary</CardTitle>
          {connectionStatus === 'connecting' ? (
            <CardDescription className="flex items-center text-amber-600">
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              Analyzing model
            </CardDescription>
          ) : connectionStatus === 'retrying' ? (
            <CardDescription className="flex items-center text-amber-600">
              <AlertCircle className="h-3.5 w-3.5 mr-1" />
              Refining calculation
            </CardDescription>
          ) : connectionStatus === 'failed' ? (
            <CardDescription className="flex items-center text-amber-600">
              <AlertCircle className="h-3.5 w-3.5 mr-1" />
              Using standard pricing
            </CardDescription>
          ) : connectionStatus !== 'success' && (
            <CardDescription className="flex items-center text-gray-700">
              <AlertCircle className="h-3.5 w-3.5 mr-1" />
              Estimated pricing
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {/* Model info section */}
        <div className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
          <div className="text-gray-700 font-medium">Model</div>
          <div className="font-medium truncate">
            {selectedModelName || 'Not selected'}
          </div>
          
          <div className="text-gray-700 font-medium">Material</div>
          <div className="font-medium capitalize">
            {selectedFilament || 'None'}
          </div>
          
          <div className="text-gray-700 font-medium">Quantity</div>
          <div className="font-medium">
            {quantity}
          </div>
          
          {complexityFactor > 1.05 && (
            <>
              <div className="text-gray-700 font-medium">Complexity</div>
              <div className={`font-medium ${complexityFactor > 1.3 ? "text-amber-700" : ""}`}>
                {complexityFactor >= 1.5 ? "Very High" : 
                 complexityFactor >= 1.3 ? "High" : 
                 complexityFactor >= 1.2 ? "Medium" : "Low"}
              </div>
            </>
          )}
        </div>
        
        <Separator />
        
        {/* Price breakdown section */}
        <div className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
          <div className="text-gray-700">Per Item</div>
          <div className="font-medium">{formatPrice(basePrice / quantity)}</div>
          
          <div className="text-gray-700">Subtotal</div>
          <div className="font-medium">{formatPrice(basePrice)}</div>
          
          <div className="text-gray-700">Shipping</div>
          <div className="font-medium">{basePrice > 50 ? '$10.00' : '$5.00'}</div>
          
          <Separator className="col-span-2 my-1" />
          
          <div className="text-base font-medium pt-1">Total</div>
          <div className="text-base font-medium pt-1">{formatPrice(finalPrice)}</div>
        </div>
        
        {/* Status messages */}
        {(isPriceCalculating || isPreparing) && (
          <div className="flex items-center justify-center py-1 text-gray-700">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm">
              {isPreparing ? 'Preparing model' : 'Calculating price'}
            </span>
          </div>
        )}
        
        {connectionStatus === 'failed' && !isPriceCalculating && !isPreparing && (
          <div className="bg-amber-50 p-2 rounded-md text-xs text-amber-800 border border-amber-200">
            <p className="flex items-start">
              <AlertCircle className="h-3.5 w-3.5 mr-1 shrink-0 mt-0.5 text-amber-600" />
              <span>
                Using standard pricing based on quantity.
                {connectionAttempts > 1 && (
                  <span className="block mt-1">
                    View your model in 3D for accurate pricing.
                  </span>
                )}
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 