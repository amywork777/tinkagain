import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { CheckCircle, ArrowLeft, Download, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OrderDetails {
  orderId: string;
  modelName: string;
  color: string;
  quantity: number;
  finalPrice: number;
  paymentStatus: string;
  stlFileName?: string;
  stlFileUrl?: string;
  stlStoragePath?: string;
  stlFileData?: string;
  stlFile?: {
    downloadUrl?: string;
    downloadLink?: string;
    fileName?: string;
    fileSize?: string;
    storagePath?: string;
  };
  orderDetails?: {
    modelName?: string;
    color?: string;
    quantity?: number;
    finalPrice?: number;
  };
  amountTotal?: number;
}

const CheckoutConfirmation = () => {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  
  // Check for download parameter instead of session_id
  const downloadUrl = searchParams.get('download');
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    // If we have a download URL from the query params, create a simple orderDetails object
    if (downloadUrl) {
      setLoading(false);
      setOrderDetails({
        orderId: `order-${Date.now()}`,
        modelName: 'Your 3D Model',
        color: 'As specified',
        quantity: 1,
        finalPrice: 0,
        paymentStatus: 'Received',
        stlFileUrl: downloadUrl
      });
      
      // Show confirmation toast
      toast({
        title: "Order received",
        description: "Thank you for your order!",
        variant: "default"
      });
      
      return;
    }
    
    // For backward compatibility, still try to fetch order details if session_id is present
    if (sessionId) {
      const fetchOrderDetails = async () => {
        setLoading(true);
        try {
          // Try to fetch order details, but don't worry if it fails
          const response = await fetch(`/api/checkout/session/${sessionId}`);
          const data = await response.json();
          
          if (data.success) {
            setOrderDetails({
              orderId: `order-${sessionId.substring(0, 8)}`,
              modelName: 'Your 3D Model',
              color: 'As specified',
              quantity: 1,
              finalPrice: data.amount ? data.amount / 100 : 0,
              paymentStatus: data.status || 'Received',
              stlFileUrl: data.downloadUrl
            });
            
            toast({
              title: "Order confirmed",
              description: "Your order has been placed successfully!",
              variant: "default"
            });
          }
        } catch (error) {
          console.error("Error fetching order details:", error);
        } finally {
          setLoading(false);
        }
      };
      
      fetchOrderDetails();
    } else {
      // No download URL or session ID, just show the thank you page
      setLoading(false);
    }
  }, [downloadUrl, sessionId, toast]);

  // Function to download STL file if available
  const handleDownloadSTL = () => {
    if (orderDetails?.stlFileUrl) {
      window.open(orderDetails.stlFileUrl, '_blank');
    } else if (orderDetails?.stlFile?.downloadUrl) {
      window.open(orderDetails.stlFile.downloadUrl, '_blank');
    } else if (orderDetails?.stlFile?.downloadLink) {
      window.open(orderDetails.stlFile.downloadLink, '_blank');
    } else {
      toast({
        title: "Download unavailable",
        description: "STL file download link is not available",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="container mx-auto py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {loading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-muted-foreground">Loading order details...</p>
              </div>
            </CardContent>
          </Card>
        ) : !orderDetails ? (
          <Card>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <CheckCircle className="h-16 w-16 text-green-500" />
              </div>
              <CardTitle className="text-2xl">Thank You for Your Order!</CardTitle>
              <CardDescription>
                Your 3D print order has been received and is being processed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                We've sent a confirmation email with your order details and download link.
              </p>
              <p className="text-muted-foreground mb-6">
                If you have any questions about your order, please contact us at taiyaki.orders@gmail.com
              </p>
              
              {downloadUrl && (
                <Button 
                  variant="outline" 
                  className="w-full mb-4"
                  onClick={() => window.open(downloadUrl, '_blank')}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Your 3D Model
                </Button>
              )}
            </CardContent>
            <CardFooter>
              <Button asChild className="w-full">
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Return to Home
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <Card>
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <CheckCircle className="h-16 w-16 text-green-500" />
              </div>
              <CardTitle className="text-2xl">Order Successful!</CardTitle>
              <CardDescription>
                Your 3D print order has been received and is being processed.
              </CardDescription>
            </CardHeader>

            <CardContent>
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Order ID:</span>
                  <span className="font-medium">{orderDetails.orderId}</span>
                </div>
                
                <Separator />
                
                <div className="space-y-4">
                  <h3 className="font-semibold">Order Summary</h3>
                  
                  <div className="bg-muted rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium">{orderDetails.modelName}</p>
                      </div>
                      <Badge variant="outline" className="bg-green-50">
                        {orderDetails.paymentStatus}
                      </Badge>
                    </div>
                    
                    <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2">
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Color</span>
                        <span className="font-medium">
                          {orderDetails.color || (orderDetails.orderDetails?.color) || 'Not specified'}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">Quantity</span>
                        <span className="font-medium">
                          {orderDetails.quantity || (orderDetails.orderDetails?.quantity) || 1}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex justify-between font-medium text-lg">
                    <span>Total:</span>
                    <span>
                      ${(orderDetails.finalPrice || orderDetails.orderDetails?.finalPrice || orderDetails.amountTotal || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
                
                <Separator />
                
                <div className="space-y-4">
                  <h3 className="font-semibold">What's Next?</h3>
                  
                  <p className="text-sm text-muted-foreground">
                    We'll start working on your 3D printing order right away. You'll receive an email 
                    confirmation with all details, and we'll keep you updated on the printing progress.
                  </p>
                  
                  {(orderDetails.stlFileUrl || orderDetails.stlFile?.downloadUrl || orderDetails.stlFile?.downloadLink) && (
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={handleDownloadSTL}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download Your 3D Model
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
            
            <CardFooter className="flex flex-col space-y-4">
              <Button asChild className="w-full">
                <Link to="/">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Return to Home
                </Link>
              </Button>
              
              <p className="text-xs text-center text-muted-foreground">
                If you have any questions, please contact our customer support.
              </p>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
};

export default CheckoutConfirmation; 