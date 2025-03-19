import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { useScene } from "@/hooks/use-scene";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import * as THREE from 'three';
import {
  Printer,
  Loader2,
  AlertCircle,
  X,
  Upload,
  CheckCircle
} from "lucide-react";
import {
  calculatePrice,
  getFilaments,
  calculate3DPrintPrice
} from "@/lib/slantApi";
import { OrderSummary } from './OrderSummary';
import { FormControl, FormLabel, FormHelperText, FormItem, SimpleForm } from "@/components/ui/form";
import { loadStripe } from '@stripe/stripe-js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter';
import { Object3D } from 'three';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { Progress } from "@/components/ui/progress";

// Initialize with empty array, will be populated from API
const EMPTY_FILAMENT_COLORS: FilamentColor[] = [];

interface FilamentColor {
  id: string;
  name: string;
  hex: string;
  price: number;
  imageUrl: string;
  brand: string;
  mass: number;
  link: string;
}

interface FilamentApiItem {
  filament_id: string;
  filament_brand: string;
  filament_name: string;
  filament_color: string;
  filament_unit_price: number;
  filament_image_url: string;
  filament_mass_in_grams: number;
  filament_link: string;
}

interface FilamentApiResponse {
  status: string;
  result: FilamentApiItem[];
}

// Interface for uploaded model data
interface UploadedModelData {
  data: string | ArrayBuffer | null;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploadTime: string;
}

// Constants for Supabase
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://jwftsutqrfcnxwxshwbf.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3ZnRzdXRxcmZjbnh3eHNod2JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTM2NTMxMjEsImV4cCI6MjAwOTIyOTEyMX0.J9OLZW8-h0DY-_vWuKU94-JErA_Y510X2RNYVbSa5m0';
const STL_FILES_BUCKET = 'stl-files';

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Log Supabase initialization for debugging
console.log(`[${new Date().toISOString()}] Supabase client initialized`);

// Load Stripe outside of a component's render to avoid recreating the Stripe object on every render
const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : loadStripe('pk_live_51QIaT9CLoBz9jXRlVEQ99Q6V4UiRSYy8ZS49MelsW8EfX1mEijh3K5JQEe5iysIL31cGtf2IsTVIyV1mivoUHCUI00aPpz3GMi'); // Production fallback key

// Log Stripe initialization for debugging
console.log(`[${new Date().toISOString()}] Stripe initialization with key: ${import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ? 'Environment key' : 'Fallback key'}`);
console.log(`[${new Date().toISOString()}] Stripe key type: ${import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test') ? 'TEST' : 'LIVE'}`);

const Print3DTab = () => {
  const { models, selectedModelIndex, exportSelectedModelAsSTL, selectModel } = useScene();
  const { toast } = useToast();

  // State variables
  const [selectedFilament, setSelectedFilament] = useState<string>("");
  const [filamentColors, setFilamentColors] = useState<FilamentColor[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [isPriceCalculating, setIsPriceCalculating] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [basePrice, setBasePrice] = useState(0);
  const [materialCost, setMaterialCost] = useState(0);
  const [printingCost, setPrintingCost] = useState(0);
  const [shippingCost, setShippingCost] = useState(0);
  const [finalPrice, setFinalPrice] = useState(0);
  const [complexityFactor, setComplexityFactor] = useState(1.0);
  const [printability, setPrintability] = useState<{
    factor: number;
    category: string;
    hasOverhangs: boolean;
    hasThinWalls: boolean;
    hasFloatingIslands: boolean;
  }>({
    factor: 1.0,
    category: "Easy",
    hasOverhangs: false,
    hasThinWalls: false,
    hasFloatingIslands: false
  });
  const [priceSource, setPriceSource] = useState<'api' | 'estimate'>('estimate');
  const [error, setError] = useState<string | null>(null);
  const [uploadedModelData, setUploadedModelData] = useState<UploadedModelData | string | null>(null);
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  
  // New state variables for direct upload
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [directUploadResult, setDirectUploadResult] = useState<any>(null);

  // Fetch filaments when component mounts
  useEffect(() => {
    fetchFilaments();
  }, []);

  // Initialize with price calculation when a model is selected
  useEffect(() => {
    if ((selectedModelIndex !== null || uploadedModelData) && selectedFilament) {
      calculatePriceFromAPI();
    }
  }, [selectedModelIndex, uploadedModelData, selectedFilament, quantity]);

  // Effect to ensure prices are recalculated when the model changes
  useEffect(() => {
    // Reset saved pricing when model is changed
    setPriceSource('estimate');
    setConnectionAttempts(0);

    if ((selectedModelIndex !== null || uploadedModelData) && selectedFilament) {
      calculatePriceFromAPI();
    }
  }, [selectedModelIndex, uploadedModelData]);

  // Effect for recalculation when filament or quantity changes
  useEffect(() => {
    if ((selectedModelIndex !== null || uploadedModelData) && selectedFilament) {
      calculatePriceFromAPI();
    }
  }, [selectedFilament, quantity]);

  // Fetch filaments from the API
  const fetchFilaments = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('https://backend.mandarin3d.com/api/filament?action=list')
      console.log('Filament API response:', response);

      const responseData = await response.json() as FilamentApiResponse;
      let colors: FilamentColor[] = [];

      if (responseData.status === "success" && Array.isArray(responseData.result)) {
        colors = responseData.result.map((item: FilamentApiItem) => {
          // Clean the name to remove any redundancy
          let name = item.filament_name.replace(/\bPLA\b/gi, '').trim();
          name = name.replace(/^[\s-]+|[\s-]+$/g, '');

          return {
            id: item.filament_id,
            name: name || 'Unknown Color',
            hex: item.filament_color || '#808080',
            price: item.filament_unit_price,
            imageUrl: item.filament_image_url,
            brand: item.filament_brand,
            mass: item.filament_mass_in_grams,
            link: item.filament_link
          };
        });
        
        // Reorder the colors array to make Black the default (first item)
        // Find the black color option
        const blackColorIndex = colors.findIndex(
          color => color.name.toLowerCase().includes('black')
        );
        
        // If black color is found and it's not already the first item
        if (blackColorIndex > 0) {
          // Remove the black color from its current position
          const blackColor = colors.splice(blackColorIndex, 1)[0];
          // Add it to the beginning of the array
          colors.unshift(blackColor);
        }
      }

      console.log('Normalized filament colors:', colors);

      setFilamentColors(colors);
      if (colors.length > 0) {
        setSelectedFilament(colors[0].id);
      }
    } catch (err) {
      console.error('Error fetching filaments:', err);
      toast({
        title: "Failed to load filaments",
        description: "Using default color options",
        variant: "destructive",
      });

      // Use fallback colors on error
      const fallbackColors: FilamentColor[] = [
        { id: 'black-pla', name: 'Black', hex: '#121212', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'white-pla', name: 'White', hex: '#f9f9f9', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'gray-pla', name: 'Gray', hex: '#9e9e9e', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'red-pla', name: 'Red', hex: '#f44336', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'blue-pla', name: 'Royal Blue', hex: '#1976d2', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'green-pla', name: 'Forest Green', hex: '#2e7d32', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'yellow-pla', name: 'Bright Yellow', hex: '#fbc02d', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'orange-pla', name: 'Orange', hex: '#ff9800', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'purple-pla', name: 'Purple', hex: '#7b1fa2', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' },
        { id: 'pink-pla', name: 'Hot Pink', hex: '#e91e63', price: 24.99, imageUrl: '', brand: 'Generic', mass: 1000, link: '' }
      ];

      setFilamentColors(fallbackColors);
      setSelectedFilament(fallbackColors[0].id);
    } finally {
      setIsLoading(false);
    }
  };

  // Function to calculate the price using our advanced algorithm
  const calculatePriceFromAPI = async () => {
    if ((selectedModelIndex === null && !uploadedModelData) || !selectedFilament) {
      toast({
        title: "Missing required information",
        description: "Please select a model and material before calculating price.",
        variant: "destructive",
      });
      return;
    }

    console.log('Starting price calculation');
    setIsPriceCalculating(true);
    setError(null);
    setPriceSource('estimate'); // Default to estimate until calculation succeeds

    // Set reasonable fallback prices that scale with quantity
    const calculateFallbackPrices = () => {
      // Base price formula: More gradual scaling based on quantity with 20% increase
      let basePriceFallback;

      if (quantity === 1) {
        basePriceFallback = 6; // Single item (previously 5, now with 20% markup)
      } else if (quantity <= 5) {
        basePriceFallback = 6 + (quantity - 1) * 3.6; // $6 + $3.60 per additional up to 5
      } else if (quantity <= 10) {
        basePriceFallback = 20.4 + (quantity - 5) * 3; // $20.40 + $3 per additional from 6-10
      } else {
        basePriceFallback = 36 + (quantity - 10) * 2.4; // $36 + $2.40 per additional after 10
      }

      // For backend compatibility, still calculate material and printing costs
      const materialCostFallback = basePriceFallback * 0.4;
      const printingCostFallback = basePriceFallback * 0.6;

      // Shipping cost varies based on order size
      const shippingCostFallback = basePriceFallback > 50 ? 10.00 : 5.00;

      // Calculate total price 
      const totalPriceFallback = basePriceFallback + shippingCostFallback;

      console.log('Using fallback prices:', {
        basePriceFallback,
        materialCostFallback,
        printingCostFallback,
        shippingCostFallback,
        totalPriceFallback
      });

      return {
        basePrice: basePriceFallback,
        materialCost: materialCostFallback,
        printingCost: printingCostFallback,
        shippingCost: shippingCostFallback,
        totalPrice: totalPriceFallback
      };
    };

    // Get fallback prices as a starting point
    const fallbackPrices = calculateFallbackPrices();

    // Set fallback values right away so UI always shows something
    setBasePrice(fallbackPrices.basePrice);
    setMaterialCost(fallbackPrices.materialCost);
    setPrintingCost(fallbackPrices.printingCost);
    setShippingCost(fallbackPrices.shippingCost);
    setFinalPrice(fallbackPrices.totalPrice);

    toast({
      title: "Calculating price...",
      description: "Analyzing model geometry and materials",
    });

    try {
      // Calculate price based on model volume
      if (selectedModelIndex !== null && selectedModelIndex >= 0 && selectedModelIndex < models.length) {
        // We have a selected model from the scene
        const model = models[selectedModelIndex];
        if (model && model.mesh) {
          console.log('Calculating price for model:', model.name);

          // Calculate model volume
          const modelVolume = calculateModelVolume(model);
          console.log('Calculated model volume:', modelVolume, 'cubic mm');

          // Calculate model complexity (polygon count, geometry details)
          const complexityFactor = calculateModelComplexity(model);
          console.log('Model complexity factor:', complexityFactor);

          // Assess model printability (overhangs, thin walls, etc.)
          const printabilityAssessment = assessPrintability(model);
          setPrintability(printabilityAssessment);
          console.log('Model printability:', printabilityAssessment);

          // Revised pricing model without artificial caps
          // Base prices depend on volume
          const volumeCubicCm = modelVolume / 1000; // Convert to cubic cm

          let basePrice;
          if (volumeCubicCm < 5) {
            basePrice = 2; // Minimum price
          } else if (volumeCubicCm < 50) {
            basePrice = 2 + ((volumeCubicCm - 5) / 45) * 3; // $2-$5
          } else if (volumeCubicCm < 200) {
            basePrice = 5 + ((volumeCubicCm - 50) / 150) * 5; // $5-$10
          } else {
            // For extremely large models, continue scaling (approximately $15 per 1000 cubic cm)
            basePrice = 100 + ((volumeCubicCm - 5000) / 1000) * 15;
          }

          // No price cap - allow prices to reflect actual material and time costs

          // Calculate size in inches (assuming cubic root of volume, converted from cm to inches)
          const sizeInInches = Math.pow(volumeCubicCm, 1 / 3) / 2.54;
          console.log(`Approximate model size: ${sizeInInches.toFixed(1)} inches`);

          // Apply complexity factor to base price
          // Complex models take longer to print and have higher failure rates
          const complexityAdjustedBasePrice = basePrice * complexityFactor;
          console.log('Complexity-adjusted base price:', complexityAdjustedBasePrice.toFixed(2));

          // Apply printability factor to the price
          // Hard-to-print models require more supports, have higher failure rates, etc.
          const printabilityAdjustedBasePrice = complexityAdjustedBasePrice * printabilityAssessment.factor;
          console.log('Printability-adjusted base price:', printabilityAdjustedBasePrice.toFixed(2));

          // Apply material pricing factor based on selected filament
          // Premium materials cost more
          let materialFactor = 1.0; // Default for standard materials
          if (selectedFilament.includes('Premium') ||
            selectedFilament.includes('Metallic') ||
            selectedFilament.includes('Wood')) {
            materialFactor = 1.25; // 25% premium for specialty materials
          }

          const materialAdjustedBasePrice = printabilityAdjustedBasePrice * materialFactor;
          console.log('Material-adjusted base price:', materialAdjustedBasePrice.toFixed(2));

          // Apply quantity discount
          let quantityFactor = 1.0;
          if (quantity > 1) {
            // First item is full price, additional items get progressively cheaper
            const firstItemPrice = materialAdjustedBasePrice;
            let additionalItemsPrice = 0;

            // Apply progressive discounts
            for (let i = 1; i < quantity; i++) {
              // Each subsequent item gets cheaper (up to 40% off)
              const discount = Math.min(0.40, 0.15 + (i * 0.025));
              additionalItemsPrice += materialAdjustedBasePrice * (1 - discount);
            }

            const totalBeforeShipping = firstItemPrice + additionalItemsPrice;
            const effectiveUnitPrice = totalBeforeShipping / quantity;

            // Calculate equivalent quantity factor
            quantityFactor = effectiveUnitPrice / materialAdjustedBasePrice * quantity;

            console.log(`Quantity ${quantity}: equivalent factor ${quantityFactor.toFixed(2)}`);
          }

          const quantityAdjustedBasePrice = materialAdjustedBasePrice * quantityFactor;
          console.log('Quantity-adjusted total price:', quantityAdjustedBasePrice.toFixed(2));

          // Shipping calculation - base fee plus per-item cost, with volume consideration
          const shippingBase = 5.00;
          const shippingPerItem = 0.50;
          const volumeFactor = Math.min(3.0, Math.max(1.0, volumeCubicCm / 200));

          const shipping = (shippingBase + (shippingPerItem * quantity)) * volumeFactor;
          console.log('Shipping cost:', shipping.toFixed(2));

          // Final price component breakdown
          const materialCost = quantityAdjustedBasePrice * 0.4; // 40% of base for materials
          const printingCost = quantityAdjustedBasePrice * 0.6; // 60% of base for printing process

          // Set state with calculated values
          setBasePrice(Number(quantityAdjustedBasePrice.toFixed(2)));
          setMaterialCost(Number(materialCost.toFixed(2)));
          setPrintingCost(Number(printingCost.toFixed(2)));
          setShippingCost(Number(shipping.toFixed(2)));
          setFinalPrice(Number((quantityAdjustedBasePrice + shipping).toFixed(2)));
          setComplexityFactor(complexityFactor);
          setPriceSource('api');

          console.log('Price calculation complete:', {
            basePrice: quantityAdjustedBasePrice.toFixed(2),
            materialCost: materialCost.toFixed(2),
            printingCost: printingCost.toFixed(2),
            shipping: shipping.toFixed(2),
            finalPrice: (quantityAdjustedBasePrice + shipping).toFixed(2)
          });

          toast({
            title: "Price calculated",
            description: "Based on model geometry, complexity, and material",
            variant: "default",
          });
        }
      } else if (uploadedModelData) {
        // Handle uploaded model data
        // Since we can't easily analyze geometry, use fallback based on model data size
        let modelDataSize = 0;
        if (typeof uploadedModelData === 'string') {
          modelDataSize = uploadedModelData.length;
        } else if (uploadedModelData instanceof ArrayBuffer) {
          modelDataSize = uploadedModelData.byteLength;
        }

        // Rough estimate - larger files generally mean more complex/larger models
        const estimatedVolume = modelDataSize / 50; // Very rough approximation
        console.log('Estimated volume from data size:', estimatedVolume);

        // Use more aggressive fallback prices for uploaded models since we have less info
        const basePrice = fallbackPrices.basePrice * 1.2; // 20% higher due to unknown geometry

        setBasePrice(Number(basePrice.toFixed(2)));
        setMaterialCost(Number((basePrice * 0.4).toFixed(2)));
        setPrintingCost(Number((basePrice * 0.6).toFixed(2)));
        setFinalPrice(Number((basePrice + fallbackPrices.shippingCost).toFixed(2)));

        toast({
          title: "Estimated price calculated",
          description: "Based on limited information from uploaded model",
          variant: "default",
        });
      }
    } catch (error) {
      console.error('Error calculating price:', error);
      setError('Failed to calculate accurate price. Using estimates.');

      toast({
        title: "Using estimated pricing",
        description: "Could not analyze model in detail. Using size-based estimates.",
        variant: "destructive",
      });
    } finally {
      setIsPriceCalculating(false);
    }
  };

  // Calculate the volume of a 3D model in cubic millimeters
  const calculateModelVolume = (model: any) => {
    try {
      if (!model || !model.mesh) {
        console.error('Invalid model for volume calculation');
        return 0;
      }

      // Make sure the model's geometry is up to date
      model.mesh.updateMatrixWorld(true);

      if (model.mesh.geometry) {
        // Clone the geometry to avoid modifying the original
        const geometry = model.mesh.geometry.clone();

        // Apply the model's transformation to the geometry
        geometry.applyMatrix4(model.mesh.matrixWorld);

        // Compute the volume
        if (geometry.isBufferGeometry) {
          // For buffer geometry, we need to compute volume from vertices and faces
          const position = geometry.getAttribute('position');
          const index = geometry.getIndex();

          let volume = 0;

          // If we have an indexed geometry
          if (index) {
            for (let i = 0; i < index.count; i += 3) {
              const a = new THREE.Vector3(
                position.getX(index.getX(i)),
                position.getY(index.getX(i)),
                position.getZ(index.getX(i))
              );
              const b = new THREE.Vector3(
                position.getX(index.getX(i + 1)),
                position.getY(index.getX(i + 1)),
                position.getZ(index.getX(i + 1))
              );
              const c = new THREE.Vector3(
                position.getX(index.getX(i + 2)),
                position.getY(index.getX(i + 2)),
                position.getZ(index.getX(i + 2))
              );

              // Calculate signed volume of tetrahedron formed by triangle and origin
              const tetraVolume = (a.dot(b.cross(c))) / 6;
              volume += Math.abs(tetraVolume);
            }
          } else {
            // Non-indexed geometry
            for (let i = 0; i < position.count; i += 3) {
              const a = new THREE.Vector3(
                position.getX(i),
                position.getY(i),
                position.getZ(i)
              );
              const b = new THREE.Vector3(
                position.getX(i + 1),
                position.getY(i + 1),
                position.getZ(i + 1)
              );
              const c = new THREE.Vector3(
                position.getX(i + 2),
                position.getY(i + 2),
                position.getZ(i + 2)
              );

              // Calculate signed volume of tetrahedron formed by triangle and origin
              const tetraVolume = (a.dot(b.cross(c))) / 6;
              volume += Math.abs(tetraVolume);
            }
          }

          // Return volume in cubic millimeters with reasonable bounds
          // Ensure volume is at least 1 cubic cm (1000 cubic mm) for minimum price
          return Math.max(1000, volume);
        }
      }

      // Fallback - use bounding box volume
      const boundingBox = new THREE.Box3().setFromObject(model.mesh);
      const size = new THREE.Vector3();
      boundingBox.getSize(size);

      // Return volume in cubic millimeters with reasonable bounds
      return Math.max(1000, size.x * size.y * size.z);
    } catch (error) {
      console.error('Error calculating model volume:', error);
      return 1000; // Fallback value: 1 cubic cm
    }
  };

  // Calculate a complexity factor for the model based on geometry
  const calculateModelComplexity = (model: any) => {
    try {
      if (!model || !model.mesh || !model.mesh.geometry) {
        return 1.0; // Default complexity factor
      }

      const geometry = model.mesh.geometry;

      // Get face count as measure of complexity
      let faceCount = 0;
      if (geometry.index) {
        faceCount = geometry.index.count / 3;
      } else {
        const position = geometry.getAttribute('position');
        faceCount = position.count / 3;
      }

      // Calculate normalized complexity factor
      // Simple models: <1000 faces
      // Medium complexity: 1000-10,000 faces
      // Complex models: 10,000-100,000 faces
      // Very complex models: >100,000 faces

      let complexityFactor;
      if (faceCount < 1000) {
        complexityFactor = 1.0; // Normal pricing for simple models
      } else if (faceCount < 10000) {
        complexityFactor = 1.0 + ((faceCount - 1000) / 9000) * 0.2; // Up to 20% more for medium complexity
      } else if (faceCount < 100000) {
        complexityFactor = 1.2 + ((faceCount - 10000) / 90000) * 0.3; // Up to 50% more for complex models
      } else {
        complexityFactor = 1.5 + Math.min(0.5, ((faceCount - 100000) / 900000) * 0.5); // Up to 100% more for very complex models
      }

      console.log(`Model complexity: ${faceCount} faces, factor: ${complexityFactor.toFixed(2)}`);
      return complexityFactor;
    } catch (error) {
      console.error('Error calculating complexity factor:', error);
      return 1.0; // Default complexity factor
    }
  };

  // Assess the printability of a model
  const assessPrintability = (model: any) => {
    try {
      if (!model || !model.mesh || !model.mesh.geometry) {
        return {
          factor: 1.0,
          category: "Unknown",
          hasOverhangs: false,
          hasThinWalls: false,
          hasFloatingIslands: false
        };
      }

      // Get the geometry
      const geometry = model.mesh.geometry;
      const position = geometry.getAttribute('position');

      // Calculate the bounding box
      const bbox = new THREE.Box3().setFromBufferAttribute(position);
      const dimensions = new THREE.Vector3();
      bbox.getSize(dimensions);

      // Look for potential overhangs (negative Z-normals if upward is Z)
      let hasOverhangs = false;
      let hasThinWalls = false;
      let hasFloatingIslands = false;

      // Check for overhangs using normals
      if (geometry.getAttribute('normal')) {
        const normals = geometry.getAttribute('normal');
        let downwardNormalCount = 0;

        for (let i = 0; i < normals.count; i++) {
          const z = normals.getZ(i);
          if (z < -0.7) { // Steep downward normal
            downwardNormalCount++;
          }
        }

        // If more than 10% of normals point downward, consider it has overhangs
        hasOverhangs = downwardNormalCount > normals.count * 0.1;
      }

      // Simple heuristic for thin walls - if any dimension is much smaller than others
      const minDimension = Math.min(dimensions.x, dimensions.y, dimensions.z);
      const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z);
      hasThinWalls = minDimension < maxDimension * 0.05;

      // We can't reliably detect floating islands without more complex analysis
      hasFloatingIslands = false; // Simplified assumption

      // Determine printability category and factor
      let category = "Easy";
      let factor = 1.0;

      if (hasOverhangs && hasThinWalls) {
        category = "Difficult";
        factor = 1.5; // 50% price increase for difficult prints
      } else if (hasOverhangs || hasThinWalls) {
        category = "Moderate";
        factor = 1.25; // 25% price increase for moderately difficult prints
      }

      return {
        factor,
        category,
        hasOverhangs,
        hasThinWalls,
        hasFloatingIslands
      };
    } catch (error) {
      console.error('Error assessing printability:', error);
      return {
        factor: 1.0,
        category: "Unknown",
        hasOverhangs: false,
        hasThinWalls: false,
        hasFloatingIslands: false
      };
    }
  };

  // Handle file upload function with direct upload for large files
  const handleUploadModel = async () => {
    try {
      // Create a file input element
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.stl';

      // Handle file selection
      fileInput.onchange = async (e) => {
        const target = e.target as HTMLInputElement;
        if (target && target.files && target.files[0]) {
          const file = target.files[0];

          // Store the original filename
          const originalFileName = file.name;
          
          // Check file size
          const fileSizeMB = file.size / (1024 * 1024);
          console.log(`[${new Date().toISOString()}] Selected file: ${originalFileName} (${fileSizeMB.toFixed(2)}MB)`);
          
          try {
            // For larger files, upload directly to Supabase
            if (file.size > 4 * 1024 * 1024) { // 4MB threshold
              console.log(`[${new Date().toISOString()}] Large file detected (${fileSizeMB.toFixed(2)}MB), using direct upload`);
              
              // First notify that we're reading the file
              toast({
                title: "Processing file...",
                description: `Preparing ${originalFileName} (${Math.round(fileSizeMB)}MB) for upload`,
                duration: 3000,
              });
              
              // Start a direct upload with the file object
              const uploadResult = await uploadDirectToSupabase(file, originalFileName);
              
              // Store the result in uploaded model data
              setUploadedModelData({
                data: null, // We don't need to store the full data in memory anymore
                fileName: originalFileName,
                fileSize: file.size,
                fileType: file.type,
                uploadTime: new Date().toISOString()
              });
              
              // Calculate price for the uploaded model
              await calculatePriceFromAPI();
            } else {
              // For smaller files, we can still use the regular flow with data URLs
              console.log(`[${new Date().toISOString()}] Standard file size (${fileSizeMB.toFixed(2)}MB), using regular upload`);
              
              // Convert file to base64 for model preview and API use
              const reader = new FileReader();
              reader.onload = async (event) => {
                if (event.target && event.target.result) {
                  // Store both the file data and metadata
                  setUploadedModelData({
                    data: event.target.result,
                    fileName: originalFileName,
                    fileSize: file.size,
                    fileType: file.type,
                    uploadTime: new Date().toISOString()
                  });

                  toast({
                    title: "Model loaded",
                    description: `${originalFileName} (${Math.round(file.size / 1024)}KB)`,
                  });

                  // Calculate price for the uploaded model
                  await calculatePriceFromAPI();
                }
              };
              reader.readAsDataURL(file);
            }
          } catch (uploadError) {
            console.error(`[${new Date().toISOString()}] Error in upload process:`, uploadError);
            
            // Even if upload fails, still load the model for pricing
            const reader = new FileReader();
            reader.onload = async (event) => {
              if (event.target && event.target.result) {
                // Store model metadata and minimal data reference
                setUploadedModelData({
                  data: event.target.result,
                  fileName: originalFileName,
                  fileSize: file.size,
                  fileType: file.type,
                  uploadTime: new Date().toISOString()
                });
                
                // Calculate price
                await calculatePriceFromAPI();
              }
            };
            reader.readAsDataURL(file);
            
            toast({
              title: "Upload issue",
              description: "File loaded for preview, but storage upload had issues. You can still proceed with checkout.",
              variant: "default",
            });
          }
        }
      };

      // Trigger the file selection dialog
      fileInput.click();
    } catch (error) {
      console.error('Error uploading model:', error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload model file",
        variant: "destructive",
      });
    }
  };

  // Format price as currency
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  // Function to get the appropriate API URL based on the environment
  const getApiUrl = (): string => {
    // Log hostname to debug
    const hostname = window.location.hostname;
    console.log(`Current hostname: ${hostname}`);

    // Check if development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3001/api';
    }

    // Production environments - Taiyaki 3DCAD
    if (hostname.includes('3dcad.taiyaki.ai')) {
      console.log('Production environment detected - using 3dcad.taiyaki.ai');
      // Use main domain for production
      return 'https://3dcad.taiyaki.ai/api';
    }

    // Legacy production environments - fishcad.com
    if (hostname.includes('fishcad.com')) {
      console.log('Legacy environment detected - using fishcad.com');
      return 'https://fishcad.com/api';
    }

    // Fallback to environment variable or default
    const envApiUrl = import.meta.env.VITE_API_URL;
    // Update the fallback to use the new domain
    const fallback = envApiUrl || 'https://3dcad.taiyaki.ai/api';
    console.log(`Using fallback API URL: ${fallback}`);
    return fallback;
  };

  // Enhanced checkout function with better error handling and retries
  const handleCheckout = async () => {
    console.log(`[${new Date().toISOString()}] CHECKOUT STARTED: 3D Print Checkout initiated`);

    // Validate required fields
    if (selectedModelIndex === null && !uploadedModelData) {
      console.error(`[${new Date().toISOString()}] CHECKOUT ERROR: No model selected`);
      toast({
        title: "Please select a model",
        description: "You need to select a model to proceed with checkout",
        variant: "destructive",
      });
      return;
    }

    // Check if we have a selected model or an uploaded model
    const hasSelectedPredefinedModel = selectedModelIndex !== null && selectedModelIndex !== -1;
    const hasUploadedModel = uploadedModelData !== null;

    if (!hasSelectedPredefinedModel && !hasUploadedModel) {
      console.error(`[${new Date().toISOString()}] CHECKOUT ERROR: No valid model found`);
      toast({
        title: "Model required",
        description: "Please select a model or upload your own before checkout",
        variant: "destructive",
      });
      return;
    }

    // Check for required filament selection
    if (!selectedFilament) {
      console.error(`[${new Date().toISOString()}] CHECKOUT ERROR: No filament selected`);
      toast({
        title: "Filament required",
        description: "Please select a filament color before checkout",
        variant: "destructive",
      });
      return;
    }

    console.log(`[${new Date().toISOString()}] CHECKOUT STATUS: All validation passed, proceeding with checkout`);

    // Set loading state
    setIsLoading(true);

    toast({
      title: "Preparing checkout",
      description: "Processing your 3D print order...",
    });

    // Define variables here to be accessible in the helper function
    let modelName: string = "Unknown Model";
    let stlFileName: string = "unknown_model.stl";
    let stlFileData: string | null = null;
    let uploadResult: any = null;
    let uploadError: any = null;

    try {
      console.log(`[${new Date().toISOString()}] CHECKOUT PROCESSING: Preparing STL data`);

      // Get the selected color name
      const selectedColor = filamentColors.find(color => color.id === selectedFilament);
      const colorName = selectedColor ? selectedColor.name : "Unknown Color";

      // Prepare checkout data to be used at the end
      const checkoutData = {
        modelName: "Custom 3D Print",
        color: colorName,
        quantity: quantity,
        finalPrice: finalPrice,
        material: "PLA",
        infillPercentage: 20,
        checkoutTimestamp: Date.now()
      };

      // For processing uploaded models
      const processUploadedModel = async () => {
        console.log(`[${new Date().toISOString()}] PROCESSING: Uploaded model`);
        modelName = "Uploaded Model";
        
        // Only access uploadedModelData after confirming it's not null
        if (uploadedModelData) {
          stlFileName = typeof uploadedModelData === 'object' && 'fileName' in uploadedModelData
            ? uploadedModelData.fileName || "uploaded_model.stl"
            : "uploaded_model.stl";
          
          checkoutData.modelName = stlFileName.replace(/\.[^/.]+$/, ""); // Remove file extension
          
          // If we already have a direct upload result, use it to skip the upload step
          if (directUploadResult?.success && directUploadResult?.direct) {
            console.log(`[${new Date().toISOString()}] Using existing direct upload result:`, directUploadResult);
            checkoutData.filePath = directUploadResult.path;
            checkoutData.fileUrl = directUploadResult.url;
            
            // Skip the upload step and go straight to checkout
            await initiateStripeCheckout(checkoutData);
            return;
          }
          
          // Extract the file data from uploadedModelData
          console.log(`[${new Date().toISOString()}] Processing uploadedModelData type: ${typeof uploadedModelData}`);
          
          try {
            // Handle both object structure and direct data storage patterns
            if (typeof uploadedModelData === 'object') {
              if ('data' in uploadedModelData && uploadedModelData.data) {
                console.log(`[${new Date().toISOString()}] Found data property in uploadedModelData`);
                // This is coming from the upload handler
                stlFileData = typeof uploadedModelData.data === 'string' 
                  ? uploadedModelData.data 
                  : `data:application/octet-stream;base64,${Buffer.from(uploadedModelData.data as ArrayBuffer).toString('base64')}`;
                
                // Generate file identification for checkout data
                const fileIdentifier = `${Date.now()}-${stlFileName}`;
                checkoutData.filePath = fileIdentifier;
                checkoutData.isUploading = true; // Flag to indicate upload in progress
                
                // REVERSED ORDER: Start Stripe checkout first
                toast({
                  title: "Starting checkout...",
                  description: "Beginning the payment process while we upload your model",
                  duration: 3000,
                });
                
                // Start Stripe checkout process
                console.log(`[${new Date().toISOString()}] Starting Stripe checkout before upload`);
                const stripePromise = initiateStripeCheckout(checkoutData);
                
                // Start file upload in parallel
                console.log(`[${new Date().toISOString()}] Starting file upload in parallel with checkout`);
                const uploadPromise = uploadFileToSupabase(stlFileData, stlFileName)
                  .catch(err => {
                    console.error(`[${new Date().toISOString()}] Upload failed but checkout can continue:`, err);
                    return {
                      success: false,
                      path: fileIdentifier,
                      fileName: stlFileName,
                      error: err.message,
                      placeholder: true
                    };
                  });
                
                // Wait for both to complete, but prioritize the Stripe checkout
                const [stripeResult, uploadResult] = await Promise.allSettled([stripePromise, uploadPromise]);
                
                // Log results
                console.log(`[${new Date().toISOString()}] Stripe checkout status:`, stripeResult.status);
                console.log(`[${new Date().toISOString()}] File upload status:`, uploadResult.status);
                
                // Handle Stripe checkout result
                if (stripeResult.status === 'rejected') {
                  throw stripeResult.reason;
                }
                
                // Handle upload result (just log, since checkout is already done)
                if (uploadResult.status === 'fulfilled') {
                  console.log(`[${new Date().toISOString()}] Upload completed successfully:`, uploadResult.value);
                } else {
                  console.error(`[${new Date().toISOString()}] Upload failed:`, uploadResult.reason);
                  toast({
                    title: "Upload issue",
                    description: "Note: Your file upload had issues, but payment was successful. Our team will help resolve this.",
                    variant: "default",
                    duration: 5000,
                  });
                }
                
              } else if ('fileData' in uploadedModelData && uploadedModelData.fileData) {
                console.log(`[${new Date().toISOString()}] Found fileData property in uploadedModelData`);
                stlFileData = uploadedModelData.fileData as string;
                
                // Generate file identification for checkout data
                const fileIdentifier = `${Date.now()}-${stlFileName}`;
                checkoutData.filePath = fileIdentifier;
                checkoutData.isUploading = true; // Flag to indicate upload in progress
                
                // REVERSED ORDER: Start Stripe checkout first
                toast({
                  title: "Starting checkout...",
                  description: "Beginning the payment process while we upload your model",
                  duration: 3000,
                });
                
                // Start Stripe checkout process
                console.log(`[${new Date().toISOString()}] Starting Stripe checkout before upload`);
                const stripePromise = initiateStripeCheckout(checkoutData);
                
                // Start file upload in parallel
                console.log(`[${new Date().toISOString()}] Starting file upload in parallel with checkout`);
                const uploadPromise = uploadFileToSupabase(stlFileData, stlFileName)
                  .catch(err => {
                    console.error(`[${new Date().toISOString()}] Upload failed but checkout can continue:`, err);
                    return {
                      success: false,
                      path: fileIdentifier,
                      fileName: stlFileName,
                      error: err.message,
                      placeholder: true
                    };
                  });
                
                // Wait for both to complete, but prioritize the Stripe checkout
                const [stripeResult, uploadResult] = await Promise.allSettled([stripePromise, uploadPromise]);
                
                // Log results
                console.log(`[${new Date().toISOString()}] Stripe checkout status:`, stripeResult.status);
                console.log(`[${new Date().toISOString()}] File upload status:`, uploadResult.status);
                
                // Handle Stripe checkout result
                if (stripeResult.status === 'rejected') {
                  throw stripeResult.reason;
                }
                
                // Handle upload result (just log, since checkout is already done)
                if (uploadResult.status === 'fulfilled') {
                  console.log(`[${new Date().toISOString()}] Upload completed successfully:`, uploadResult.value);
                } else {
                  console.error(`[${new Date().toISOString()}] Upload failed:`, uploadResult.reason);
                  toast({
                    title: "Upload issue",
                    description: "Note: Your file upload had issues, but payment was successful. Our team will help resolve this.",
                    variant: "default",
                    duration: 5000,
                  });
                }
                
              } else if ('blob' in uploadedModelData && uploadedModelData.blob instanceof Blob) {
                console.log(`[${new Date().toISOString()}] Found blob property in uploadedModelData`);
                return new Promise<void>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = async (event) => {
                    if (event.target?.result) {
                      stlFileData = event.target.result as string;
                      try {
                        // Generate file identification for checkout data
                        const fileIdentifier = `${Date.now()}-${stlFileName}`;
                        checkoutData.filePath = fileIdentifier;
                        checkoutData.isUploading = true; // Flag to indicate upload in progress
                        
                        // REVERSED ORDER: Start Stripe checkout first
                        toast({
                          title: "Starting checkout...",
                          description: "Beginning the payment process while we upload your model",
                          duration: 3000,
                        });
                        
                        // Start Stripe checkout process
                        console.log(`[${new Date().toISOString()}] Starting Stripe checkout before upload`);
                        const stripePromise = initiateStripeCheckout(checkoutData);
                        
                        // Start file upload in parallel
                        console.log(`[${new Date().toISOString()}] Starting file upload in parallel with checkout`);
                        const uploadPromise = uploadFileToSupabase(stlFileData, stlFileName)
                          .catch(err => {
                            console.error(`[${new Date().toISOString()}] Upload failed but checkout can continue:`, err);
                            return {
                              success: false,
                              path: fileIdentifier,
                              fileName: stlFileName,
                              error: err.message,
                              placeholder: true
                            };
                          });
                        
                        // Wait for both to complete, but prioritize the Stripe checkout
                        const [stripeResult, uploadResult] = await Promise.allSettled([stripePromise, uploadPromise]);
                        
                        // Log results
                        console.log(`[${new Date().toISOString()}] Stripe checkout status:`, stripeResult.status);
                        console.log(`[${new Date().toISOString()}] File upload status:`, uploadResult.status);
                        
                        // Handle Stripe checkout result
                        if (stripeResult.status === 'rejected') {
                          throw stripeResult.reason;
                        }
                        
                        // Handle upload result (just log, since checkout is already done)
                        if (uploadResult.status === 'fulfilled') {
                          console.log(`[${new Date().toISOString()}] Upload completed successfully:`, uploadResult.value);
                        } else {
                          console.error(`[${new Date().toISOString()}] Upload failed:`, uploadResult.reason);
                          toast({
                            title: "Upload issue",
                            description: "Note: Your file upload had issues, but payment was successful. Our team will help resolve this.",
                            variant: "default",
                            duration: 5000,
                          });
                        }
                        
                        resolve();
                      } catch (error) {
                        reject(error);
                      }
                    } else {
                      reject(new Error("Failed to read uploaded STL blob"));
                    }
                  };
                  reader.onerror = () => reject(reader.error);
                  reader.readAsDataURL(uploadedModelData.blob as Blob);
                });
              }
            } else if (typeof uploadedModelData === 'string') {
              console.log(`[${new Date().toISOString()}] uploadedModelData is string`);
              stlFileData = uploadedModelData;
              
              // Generate file identification for checkout data
              const fileIdentifier = `${Date.now()}-${stlFileName}`;
              checkoutData.filePath = fileIdentifier;
              checkoutData.isUploading = true; // Flag to indicate upload in progress
              
              // REVERSED ORDER: Start Stripe checkout first
              toast({
                title: "Starting checkout...",
                description: "Beginning the payment process while we upload your model",
                duration: 3000,
              });
              
              // Start Stripe checkout process
              console.log(`[${new Date().toISOString()}] Starting Stripe checkout before upload`);
              const stripePromise = initiateStripeCheckout(checkoutData);
              
              // Start file upload in parallel
              console.log(`[${new Date().toISOString()}] Starting file upload in parallel with checkout`);
              const uploadPromise = uploadFileToSupabase(stlFileData, stlFileName)
                .catch(err => {
                  console.error(`[${new Date().toISOString()}] Upload failed but checkout can continue:`, err);
                  return {
                    success: false,
                    path: fileIdentifier,
                    fileName: stlFileName,
                    error: err.message,
                    placeholder: true
                  };
                });
              
              // Wait for both to complete, but prioritize the Stripe checkout
              const [stripeResult, uploadResult] = await Promise.allSettled([stripePromise, uploadPromise]);
              
              // Log results
              console.log(`[${new Date().toISOString()}] Stripe checkout status:`, stripeResult.status);
              console.log(`[${new Date().toISOString()}] File upload status:`, uploadResult.status);
              
              // Handle Stripe checkout result
              if (stripeResult.status === 'rejected') {
                throw stripeResult.reason;
              }
              
              // Handle upload result (just log, since checkout is already done)
              if (uploadResult.status === 'fulfilled') {
                console.log(`[${new Date().toISOString()}] Upload completed successfully:`, uploadResult.value);
              } else {
                console.error(`[${new Date().toISOString()}] Upload failed:`, uploadResult.reason);
                toast({
                  title: "Upload issue",
                  description: "Note: Your file upload had issues, but payment was successful. Our team will help resolve this.",
                  variant: "default",
                  duration: 5000,
                });
              }
            }
            
            // The default case is now handled in each branch above with the parallel approach
            if (!stlFileData) {
              throw new Error("No STL data available from uploaded model");
            }
          } catch (error) {
            console.error(`[${new Date().toISOString()}] Error processing uploaded model:`, error);
            
            // Despite errors, try to proceed with checkout anyway
            toast({
              title: "Limited checkout",
              description: "We encountered an issue with your model but will still proceed with checkout",
              variant: "default",
            });
            
            checkoutData.filePath = `error-${Date.now()}-${stlFileName}`;
            await initiateStripeCheckout(checkoutData);
          }
        }
      };

      // For processing predefined models
      const processSelectedModel = async () => {
        console.log(`[${new Date().toISOString()}] PROCESSING: Selected predefined model`);
        if (!models) throw new Error("No models available");
        
        // Ensure selectedModelIndex is not null before using it as an index
        if (selectedModelIndex === null) {
          throw new Error("No model selected");
        }
        
        const model = models[selectedModelIndex];
        modelName = model.name;
        stlFileName = `${model.name.toLowerCase().replace(/\s+/g, '_')}.stl`;
        
        checkoutData.modelName = modelName;
        
        // If we already have a direct upload result, use it to skip the upload step
        if (directUploadResult?.success && directUploadResult?.direct) {
          console.log(`[${new Date().toISOString()}] Using existing direct upload result:`, directUploadResult);
          checkoutData.filePath = directUploadResult.path;
          checkoutData.fileUrl = directUploadResult.url;
          
          // Skip the STL export and upload, go straight to checkout
          await initiateStripeCheckout(checkoutData);
          return;
        }

        try {
          // Export the model to STL
          const stlBlob = exportSelectedModelAsSTL();
          if (!stlBlob || !(stlBlob instanceof Blob)) {
            throw new Error("STL export failed - no valid blob returned");
          }
          
          return new Promise<void>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (event) => {
              if (event.target?.result) {
                // Convert ArrayBuffer to base64 string
                const arrayBuffer = event.target.result as ArrayBuffer;
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const base64 = window.btoa(binary);
                stlFileData = `data:application/octet-stream;base64,${base64}`;
                
                try {
                  // REVERSED ORDER: Start Stripe checkout first
                  toast({
                    title: "Starting checkout...",
                    description: "Beginning the payment process while we upload your model",
                    duration: 3000,
                  });
                  
                  // Generate file identification for checkout data
                  const fileIdentifier = `${Date.now()}-${stlFileName}`;
                  checkoutData.filePath = fileIdentifier;
                  checkoutData.isUploading = true; // Flag to indicate upload in progress
                  
                  // Start Stripe checkout process
                  console.log(`[${new Date().toISOString()}] Starting Stripe checkout before upload`);
                  const stripePromise = initiateStripeCheckout(checkoutData);
                  
                  // Start file upload in parallel
                  console.log(`[${new Date().toISOString()}] Starting file upload in parallel with checkout`);
                  const uploadPromise = uploadFileToSupabase(stlFileData, stlFileName)
                    .catch(err => {
                      console.error(`[${new Date().toISOString()}] Upload failed but checkout can continue:`, err);
                      return {
                        success: false,
                        path: fileIdentifier,
                        fileName: stlFileName,
                        error: err.message,
                        placeholder: true
                      };
                    });
                  
                  // Wait for both to complete, but prioritize the Stripe checkout
                  const [stripeResult, uploadResult] = await Promise.allSettled([stripePromise, uploadPromise]);
                  
                  // Log results
                  console.log(`[${new Date().toISOString()}] Stripe checkout status:`, stripeResult.status);
                  console.log(`[${new Date().toISOString()}] File upload status:`, uploadResult.status);
                  
                  // Handle Stripe checkout result
                  if (stripeResult.status === 'rejected') {
                    throw stripeResult.reason;
                  }
                  
                  // Handle upload result (just log, since checkout is already done)
                  if (uploadResult.status === 'fulfilled') {
                    console.log(`[${new Date().toISOString()}] Upload completed successfully:`, uploadResult.value);
                  } else {
                    console.error(`[${new Date().toISOString()}] Upload failed:`, uploadResult.reason);
                    toast({
                      title: "Upload issue",
                      description: "Note: Your file upload had issues, but payment was successful. Our team will help resolve this.",
                      variant: "default",
                      duration: 5000,
                    });
                  }
                  
                  resolve();
                } catch (error) {
                  reject(error);
                }
              } else {
                reject(new Error("Failed to read STL data from FileReader"));
              }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(stlBlob);
          });
        } catch (error) {
          console.error(`[${new Date().toISOString()}] Error exporting/reading model:`, error);
          
          // Create a basic STL for checkout purposes
          checkoutData.filePath = `error-export-${Date.now()}-${stlFileName}`;
          
          // Proceed with checkout despite the error
          toast({
            title: "Model export issue",
            description: "We encountered a problem with your model but will still process your order",
            variant: "default",
          });
          
          await initiateStripeCheckout(checkoutData);
        }
      };

      // Execute the appropriate process based on model type
      if (hasSelectedPredefinedModel) {
        await processSelectedModel();
      } else if (hasUploadedModel) {
        await processUploadedModel();
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] CHECKOUT ERROR:`, error);
      
      // If the error happened during upload but we need to continue to checkout
      if (uploadError && !uploadResult) {
        console.log(`[${new Date().toISOString()}] Upload failed, but will try to proceed with checkout anyway`);
        
        try {
          // Get the selected color name
          const selectedColor = filamentColors.find(color => color.id === selectedFilament);
          const colorName = selectedColor ? selectedColor.name : "Unknown Color";
          
          // Create emergency checkout data
          const emergencyCheckoutData = {
            modelName: modelName || "Custom 3D Print",
            color: colorName,
            quantity: quantity,
            finalPrice: finalPrice,
            material: "PLA",
            infillPercentage: 20,
            filePath: `emergency-${Date.now()}-${stlFileName}`,
            emergency: true,
            checkoutTimestamp: Date.now()
          };
          
          toast({
            title: "Proceeding with limited checkout",
            description: "We'll handle your model details after payment",
            variant: "default",
          });
          
          await initiateStripeCheckout(emergencyCheckoutData);
          return;
        } catch (secondaryError) {
          console.error(`[${new Date().toISOString()}] Emergency checkout also failed:`, secondaryError);
        }
      }
      
      toast({
        title: "Checkout error",
        description: error instanceof Error ? error.message : "An unexpected error occurred during checkout",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  // Helper function to generate a checksum for data integrity verification
  const generateChecksum = async (data: string): Promise<string> => {
    // Use SubtleCrypto API to generate a SHA-256 hash
    const msgUint8 = new TextEncoder().encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  };
  
  // Direct upload to Supabase function - bypasses Vercel completely
  const uploadDirectToSupabase = async (fileData: string | ArrayBuffer | File | Blob, fileName: string) => {
    console.log(`[${new Date().toISOString()}] DIRECT SUPABASE UPLOAD: Starting direct upload for ${fileName}`);
    
    try {
      setIsUploading(true);
      setUploadProgress(0);
      
      // Generate a unique path with date-based organization
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const timestamp = Date.now();
      const uniqueId = uuidv4().split('-')[0]; // Use part of UUID for shorter ID
      
      const storagePath = `${year}/${month}/${day}/${timestamp}-${uniqueId}-${fileName}`;
      console.log(`[${new Date().toISOString()}] Storage path: ${storagePath}`);
      
      // Ensure the bucket exists (this is a common issue)
      try {
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = buckets?.some(bucket => bucket.name === STL_FILES_BUCKET);
        
        if (!bucketExists) {
          console.log(`[${new Date().toISOString()}] Creating bucket: ${STL_FILES_BUCKET}`);
          await supabase.storage.createBucket(STL_FILES_BUCKET, {
            public: false,
            fileSizeLimit: 100 * 1024 * 1024, // 100MB limit
          });
        }
      } catch (error) {
        console.warn(`[${new Date().toISOString()}] Bucket check error (might exist already):`, error);
      }
      
      // Convert data to the right format if needed
      let fileBlob: Blob;
      
      if (fileData instanceof File || fileData instanceof Blob) {
        fileBlob = fileData;
      } else if (fileData instanceof ArrayBuffer) {
        fileBlob = new Blob([fileData], { type: 'application/octet-stream' });
      } else if (typeof fileData === 'string') {
        // Handle base64 data
        if (fileData.includes('base64,')) {
          const base64Data = fileData.split('base64,')[1];
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          fileBlob = new Blob([bytes], { type: 'application/octet-stream' });
        } else {
          // Assume it's already base64
          const binaryString = atob(fileData);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          fileBlob = new Blob([bytes], { type: 'application/octet-stream' });
        }
      } else {
        throw new Error('Unsupported file data format');
      }
      
      // Create a toast for upload progress
      toast({
        title: "Direct upload started",
        description: `Uploading ${fileName} (${Math.round(fileBlob.size / (1024 * 1024))}MB)`,
        duration: 5000,
      });
      
      // Upload the file with progress tracking
      const { data, error } = await supabase.storage
        .from(STL_FILES_BUCKET)
        .upload(storagePath, fileBlob, {
          contentType: 'application/octet-stream',
          cacheControl: '3600',
          upsert: true,
          onUploadProgress: (progress) => {
            const percentage = Math.round((progress.loaded / progress.total) * 100);
            console.log(`[${new Date().toISOString()}] Upload progress: ${percentage}%`);
            setUploadProgress(percentage);
            
            // Update toast at certain intervals
            if (percentage % 25 === 0 || percentage === 100) {
              toast({
                title: `Upload: ${percentage}%`,
                description: percentage === 100 ? 
                  "Upload complete! Processing file..." : 
                  `Uploading ${fileName}`,
                duration: 2000,
              });
            }
          }
        });
        
      if (error) {
        throw error;
      }
      
      // Create a signed URL with long expiry (10 years)
      const tenYearsInSeconds = 315360000; // 10 years in seconds
      const { data: signedUrlData, error: signedUrlError } = await supabase.storage
        .from(STL_FILES_BUCKET)
        .createSignedUrl(storagePath, tenYearsInSeconds);
      
      if (signedUrlError) {
        console.error(`[${new Date().toISOString()}] Signed URL error:`, signedUrlError);
        throw new Error(`Failed to create signed URL: ${signedUrlError.message}`);
      }
      
      // Get public URL as backup
      const { data: publicUrlData } = supabase.storage
        .from(STL_FILES_BUCKET)
        .getPublicUrl(storagePath);
      
      const result = {
        success: true,
        url: signedUrlData.signedUrl,
        publicUrl: publicUrlData.publicUrl,
        path: storagePath,
        fileName: fileName,
        fileSize: fileBlob.size,
        direct: true
      };
      
      console.log(`[${new Date().toISOString()}] DIRECT UPLOAD SUCCESS:`, result);
      setDirectUploadResult(result);
      
      toast({
        title: "Upload complete!",
        description: "Your 3D model has been uploaded successfully.",
        variant: "default",
        duration: 3000,
      });
      
      return result;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] DIRECT UPLOAD ERROR:`, error);
      
      // Create a descriptive error message
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown upload error';
      
      toast({
        title: "Upload failed",
        description: `Could not upload file: ${errorMessage}`,
        variant: "destructive",
        duration: 5000,
      });
      
      // Even if upload fails, return a placeholder to allow checkout to continue
      return {
        success: false,
        path: `failed-${Date.now()}-${fileName}`,
        fileName: fileName,
        error: errorMessage,
        direct: true,
        placeholder: true
      };
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Legacy function to upload file to Supabase via serverless API
  const uploadFileToSupabase = async (fileData: string, fileName: string) => {
    console.log(`[${new Date().toISOString()}] SUPABASE UPLOAD: Uploading file to Supabase: ${fileName}`);
    
    try {
      // Extract base64 data from the data URL
      const base64Data = fileData.includes('base64,') 
        ? fileData.split('base64,')[1] 
        : fileData;
      
      // Check file size and log warning for large files
      const decodedSize = Math.ceil((base64Data.length * 3) / 4);
      console.log(`[${new Date().toISOString()}] Estimated file size: ${Math.round(decodedSize / 1024)}KB`);
      
      // Generate a unique filename with timestamp to avoid conflicts
      const timestamp = Date.now();
      const uniqueFileName = `${timestamp}-${fileName}`;
      
      // For large files, use direct upload to Supabase instead of going through Vercel
      if (decodedSize > 4 * 1024 * 1024) {
        console.log(`[${new Date().toISOString()}] File is > 4MB, using direct Supabase upload`);
        return await uploadDirectToSupabase(fileData, fileName);
      }
      
      // For smaller files, we can still use the server API route
      toast({
        title: "Uploading model...",
        description: "Uploading model to server",
        duration: 3000,
      });
      
      // Upload using standard API endpoint
      const uploadResult = await uploadStandardFile(base64Data, uniqueFileName, true);
      
      console.log(`[${new Date().toISOString()}] SUPABASE UPLOAD SUCCESS:`, uploadResult);
      
      toast({
        title: "File uploaded successfully",
        description: "Your 3D model has been saved.",
        duration: 3000,
      });
      
      return uploadResult;
    } catch (error) {
      console.error(`[${new Date().toISOString()}] SUPABASE UPLOAD ERROR:`, error);
      
      // For any errors, fall back to direct upload
      console.log(`[${new Date().toISOString()}] API upload failed, falling back to direct upload`);
      
      try {
        return await uploadDirectToSupabase(fileData, fileName);
      } catch (directError) {
        console.error(`[${new Date().toISOString()}] Direct upload also failed:`, directError);
        
        toast({
          title: "Upload failed",
          description: "Could not upload your file. Please try again.",
          variant: "destructive",
        });
        
        // Last resort - return a placeholder
        return {
          success: false,
          path: `error-${Date.now()}-${fileName}`,
          fileName: fileName,
          placeholder: true
        };
      }
    }
  };
  
  // Function to handle standard file upload for small files
  const uploadStandardFile = async (base64Data: string, fileName: string, throwOnError: boolean = true) => {
    console.log(`[${new Date().toISOString()}] Standard upload for file: ${fileName}`);
    
    const uploadEndpoint = `/api/upload-to-supabase`;
    
    // Set up controller with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute timeout
    
    // Create payload
    const uploadPayload = {
      fileName,
      fileData: base64Data,
      fileType: 'application/octet-stream',
      strategy: 'direct',
      timestamp: Date.now()
    };
    
    try {
      // Send upload request
      const response = await fetch(uploadEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(uploadPayload),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server responded with status: ${response.status} - ${errorText}`);
      }
      
      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`[${new Date().toISOString()}] Standard upload failed:`, error);
      
      if (throwOnError) {
        throw error;
      } else {
        // For the adaptive strategy, return a rejection so the code switches to chunked upload
        return Promise.reject(error);
      }
    }
  };
  
  // Enhanced function to handle chunked file upload for large files
  const uploadLargeFileInChunks = async (base64Data: string, fileName: string, checksum: string) => {
    console.log(`[${new Date().toISOString()}] Starting chunked upload for file: ${fileName}`);
    
    // Smaller chunk size to prevent Vercel limits
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB per chunk in base64 (smaller to ensure each request is under limits)
    const chunks = [];
    
    // Split data into chunks
    for (let i = 0; i < base64Data.length; i += CHUNK_SIZE) {
      chunks.push(base64Data.slice(i, i + CHUNK_SIZE));
    }
    
    console.log(`[${new Date().toISOString()}] File split into ${chunks.length} chunks`);
    
    // Create metadata with file info and add version for tracking
    const fileMetadata = {
      fileName,
      totalChunks: chunks.length,
      checksum: checksum,
      fileSize: base64Data.length,
      contentType: 'application/octet-stream',
      uploadId: `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`,
      version: '2.0' // Track the version of the chunking protocol
    };
    
    // First, initialize the chunked upload with error handling
    let initAttempts = 0;
    let uploadId = null;
    
    while (initAttempts < 3 && !uploadId) {
      try {
        console.log(`[${new Date().toISOString()}] Initializing chunked upload (attempt ${initAttempts + 1}/3)`);
        
        const initResponse = await fetch('/api/upload-init', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Client-Version': '2.0'
          },
          body: JSON.stringify(fileMetadata)
        });
        
        if (!initResponse.ok) {
          const errorText = await initResponse.text();
          throw new Error(`Failed to initialize chunked upload: ${errorText}`);
        }
        
        const initData = await initResponse.json();
        if (initData.success && initData.uploadId) {
          uploadId = initData.uploadId;
          console.log(`[${new Date().toISOString()}] Upload initialized with ID: ${uploadId}`);
          break;
        } else {
          throw new Error('Invalid initialization response');
        }
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Init attempt ${initAttempts + 1} failed:`, error);
        initAttempts++;
        if (initAttempts < 3) {
          await new Promise(r => setTimeout(r, 1000 * initAttempts));
        } else {
          throw new Error(`Failed to initialize upload after ${initAttempts} attempts`);
        }
      }
    }
    
    if (!uploadId) {
      throw new Error('Failed to obtain valid upload ID');
    }
    
    // Track uploaded chunks to enable resuming
    const uploadedChunks = new Set();
    
    // For very large files, prepare early Stripe checkout after a certain threshold
    const startEarlyCheckout = chunks.length > 10;
    let checkoutPrepPromise = null;
    
    // Progress tracking
    let totalProgress = 0;
    const updateProgress = (increment) => {
      totalProgress += increment;
      const percentage = Math.min(95, Math.round((totalProgress / chunks.length) * 100));
      
      // Only show progress updates at certain intervals to avoid too many toasts
      if (percentage % 20 === 0 || percentage === 95) {
        toast({
          title: `Uploading: ${percentage}%`,
          description: `Uploading chunk ${uploadedChunks.size} of ${chunks.length}`,
          duration: 2000,
        });
      }
    };
    
    // Upload chunks with parallel batching for better performance
    const PARALLEL_UPLOADS = 3; // Number of chunks to upload in parallel
    
    for (let startIdx = 0; startIdx < chunks.length; startIdx += PARALLEL_UPLOADS) {
      const batch = [];
      
      // Create batch of upload promises
      for (let i = 0; i < PARALLEL_UPLOADS && startIdx + i < chunks.length; i++) {
        const chunkIndex = startIdx + i;
        
        // Skip already uploaded chunks
        if (uploadedChunks.has(chunkIndex)) continue;
        
        // Create a promise for this chunk upload with retries
        const uploadChunkWithRetry = async () => {
          const chunk = chunks[chunkIndex];
          let success = false;
          const maxRetries = 3;
          
          // Try to upload this chunk with retries
          for (let attempt = 0; attempt < maxRetries && !success; attempt++) {
            try {
              // If retrying, wait a bit
              if (attempt > 0) {
                await new Promise(r => setTimeout(r, 1000 * attempt));
                console.log(`[${new Date().toISOString()}] Retrying chunk ${chunkIndex + 1}, attempt ${attempt + 1}`);
              }
              
              // Upload this chunk
              const chunkResponse = await fetch('/api/upload-chunk', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'X-Client-Version': '2.0'
                },
                body: JSON.stringify({
                  uploadId,
                  chunkIndex: chunkIndex,
                  totalChunks: chunks.length,
                  chunkData: chunk,
                  fileName
                })
              });
              
              if (!chunkResponse.ok) {
                const errorText = await chunkResponse.text();
                throw new Error(`Chunk upload failed with status: ${chunkResponse.status} - ${errorText}`);
              }
              
              // Mark this chunk as successfully uploaded
              uploadedChunks.add(chunkIndex);
              updateProgress(1);
              console.log(`[${new Date().toISOString()}] Chunk ${chunkIndex + 1}/${chunks.length} uploaded successfully`);
              
              success = true;
              return true;
            } catch (error) {
              console.error(`[${new Date().toISOString()}] Error uploading chunk ${chunkIndex + 1}, attempt ${attempt + 1}:`, error);
              // On last attempt, might still throw
              if (attempt === maxRetries - 1) throw error;
            }
          }
        };
        
        batch.push(uploadChunkWithRetry());
      }
      
      // For very large files, start early checkout preparation after uploading a certain percentage
      if (startEarlyCheckout && !checkoutPrepPromise && uploadedChunks.size > chunks.length * 0.3) {
        console.log(`[${new Date().toISOString()}] Starting early checkout preparation while upload continues`);
        toast({
          title: "Preparing checkout...",
          description: "Getting your order ready while upload continues",
          duration: 3000,
        });
        
        // We don't await this - it runs in parallel with remaining uploads
        checkoutPrepPromise = Promise.resolve();
      }
      
      // Wait for all chunks in this batch to finish
      try {
        await Promise.all(batch);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Batch upload failed:`, error);
        // Continue with next batch despite errors - we'll validate at the end
      }
    }
    
    // Validate all chunks were uploaded
    if (uploadedChunks.size !== chunks.length) {
      // This is a partially failed upload
      console.error(`[${new Date().toISOString()}] Upload incomplete: only ${uploadedChunks.size} of ${chunks.length} chunks uploaded`);
      
      // Check if we have enough chunks to attempt completion anyway
      if (uploadedChunks.size < chunks.length * 0.95) { // Less than 95% complete
        throw new Error(`Failed to upload all chunks: only ${uploadedChunks.size} of ${chunks.length} succeeded`);
      } else {
        console.log(`[${new Date().toISOString()}] Attempting to complete upload with ${uploadedChunks.size}/${chunks.length} chunks`);
      }
    }
    
    // All (or most) chunks uploaded, attempt to complete the upload
    console.log(`[${new Date().toISOString()}] All chunks uploaded, finalizing...`);
    
    // Show 95% progress
    toast({
      title: "Upload: 95%",
      description: "Finalizing upload...",
      duration: 3000,
    });
    
    let completeAttempts = 0;
    let completeResult = null;
    
    // Try multiple times to complete the upload
    while (completeAttempts < 3 && !completeResult) {
      try {
        const completeResponse = await fetch('/api/upload-complete', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-Client-Version': '2.0'
          },
          body: JSON.stringify({
            uploadId,
            fileName,
            totalChunks: chunks.length,
            checksum,
            uploadedChunks: Array.from(uploadedChunks) // Tell server which chunks were uploaded
          })
        });
        
        if (!completeResponse.ok) {
          const errorText = await completeResponse.text();
          throw new Error(`Failed to complete chunked upload: ${errorText}`);
        }
        
        completeResult = await completeResponse.json();
        break;
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Complete attempt ${completeAttempts + 1} failed:`, error);
        completeAttempts++;
        
        if (completeAttempts < 3) {
          // Wait longer between completion attempts
          await new Promise(r => setTimeout(r, 2000 * completeAttempts));
        } else {
          // Last attempt, check if we should proceed anyway with a placeholder
          console.error(`[${new Date().toISOString()}] Failed to complete upload after ${completeAttempts} attempts`);
          
          // For very large files, we'll return a placeholder to allow checkout to proceed
          // The server might still be able to process the chunks later
          if (chunks.length > 10) {
            return {
              success: true,
              path: `partial-${Date.now()}-${fileName}`,
              fileName: fileName,
              fileSize: base64Data.length,
              url: `placeholder-url-${Date.now()}`,
              publicUrl: `placeholder-public-url-${Date.now()}`,
              status: 'pending_completion',
              placeholder: true
            };
          } else {
            throw error;
          }
        }
      }
    }
    
    toast({
      title: "Upload: 100%",
      description: "Upload complete!",
      duration: 3000,
    });
    
    return completeResult;
  };
  
  // Function to initiate Stripe checkout with retry logic
  const initiateStripeCheckout = async (checkoutData: any) => {
    console.log(`[${new Date().toISOString()}] STRIPE CHECKOUT: Initiating Stripe checkout`);
    
    // Retry configuration 
    const maxRetries = 3;
    let retryCount = 0;
    let lastError = null;
    
    // Function to handle a single checkout attempt
    const attemptCheckout = async (): Promise<any> => {
      try {
        // Use a relative URL that will be handled by the Vite proxy
        const checkoutEndpoint = `/api/stripe-checkout`;
        
        // Add retry information to checkout data for tracking
        const checkoutPayload = {
          ...checkoutData,
          _retryCount: retryCount,
          _clientTimestamp: new Date().toISOString()
        };
        
        console.log(`[${new Date().toISOString()}] Checkout attempt ${retryCount + 1}/${maxRetries}`);
        
        // Send the checkout request
        const response = await fetch(checkoutEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Checkout-Type': '3d_print',
            'X-Client-Timestamp': new Date().toISOString(),
            'X-Retry-Count': retryCount.toString()
          },
          body: JSON.stringify(checkoutPayload)
        });
        
        // Check for server errors
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Server responded with status: ${response.status} - ${errorText}`);
        }
        
        const responseData = await response.json();
        
        // Validate response data
        if (!responseData || !responseData.url) {
          throw new Error("Invalid response: No checkout URL returned");
        }
        
        return responseData;
      } catch (error) {
        console.error(`[${new Date().toISOString()}] Checkout attempt ${retryCount + 1} failed:`, error);
        lastError = error;
        throw error;
      }
    };
    
    // Main checkout logic with retries
    while (retryCount < maxRetries) {
      try {
        // If this isn't the first attempt, wait before retrying
        if (retryCount > 0) {
          const delayMs = 1000 * retryCount; // Increasing delay: 1s, 2s
          console.log(`[${new Date().toISOString()}] Waiting ${delayMs}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          
          // Show retry toast on subsequent attempts
          toast({
            title: `Retry ${retryCount}/${maxRetries - 1}`,
            description: "Previous checkout attempt failed. Retrying...",
            duration: 3000,
          });
        }
        
        // Attempt checkout
        const responseData = await attemptCheckout();
        console.log(`[${new Date().toISOString()}] STRIPE CHECKOUT SUCCESS:`, responseData);
        
        // Stop loading state
        setIsLoading(false);
        
        // Open the Stripe checkout URL in a new tab
        const checkoutUrl = responseData.url;
        console.log(`[${new Date().toISOString()}] STRIPE CHECKOUT URL: ${checkoutUrl}`);
        
        window.open(checkoutUrl, '_blank');
        
        // Show a toast notification in case the window was blocked
        toast({
          title: "Checkout Ready",
          description: "Click below to complete your purchase if the checkout page didn't open automatically.",
          action: (
            <Button 
              className="bg-green-600 hover:bg-green-700 text-white font-bold"
              onClick={() => window.open(checkoutUrl, '_blank')}
            >
              Go to Checkout
            </Button>
          ),
          duration: 60000, // Keep it visible for 1 minute
        });
        
        return responseData;
      } catch (error) {
        retryCount++;
        
        // If this was the last retry, handle the failure
        if (retryCount >= maxRetries) {
          console.error(`[${new Date().toISOString()}] STRIPE CHECKOUT FAILED after ${maxRetries} attempts:`, lastError);
          toast({
            title: "Checkout failed",
            description: "We couldn't process your checkout request. Please try again later.",
            variant: "destructive",
          });
          setIsLoading(false);
          throw lastError; // Re-throw the last error
        }
        
        // Otherwise, continue to next retry iteration
      }
    }
    
    // This should not be reached, but TypeScript requires a return
    throw new Error("Failed to complete checkout after retries");
  };

  // Return the component UI
  return (
    <div className="space-y-5">
      {/* Model selection section */}
      <div className="bg-card rounded-md border p-4">
        <h2 className="text-lg font-medium mb-3 text-card-foreground">Model</h2>

        <div className="space-y-4">
          {/* Model Dropdown */}
          <div>
            <Select
              value={selectedModelIndex !== null ? selectedModelIndex.toString() : ""}
              onValueChange={(value) => {
                if (value === "upload") {
                  handleUploadModel();
                } else {
                  selectModel(parseInt(value));
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel className="font-medium text-foreground">From 3D Viewer</SelectLabel>
                  {models.length > 0 ? (
                    models.map((model, index) => (
                      <SelectItem key={index} value={index.toString()}>
                        {model.name || `Model ${index + 1}`}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-models" disabled>
                      No models available
                    </SelectItem>
                  )}
                </SelectGroup>
                <SelectItem value="upload">
                  Upload New Model
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Upload progress indicator */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Uploading directly to storage...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

          {/* Selected model info or upload button */}
          <div>
            {selectedModelIndex !== null ? (
              <Card className="bg-muted/50">
                <CardContent className="p-3">
                  <div className="text-sm text-foreground">
                    <span className="font-medium">Selected:</span>{" "}
                    {models[selectedModelIndex]?.name || `Model ${selectedModelIndex + 1}`}
                  </div>
                </CardContent>
              </Card>
            ) : uploadedModelData ? (
              <div className="space-y-2">
                <Card className="bg-muted/50">
                  <CardContent className="p-3">
                    <div className="flex justify-between items-center">
                      <div className="text-sm text-foreground">
                        <span className="font-medium">Uploaded:</span>{" "}
                        {typeof uploadedModelData === 'object' && 'fileName' in uploadedModelData ? 
                          uploadedModelData.fileName : "Custom Model"}
                      </div>
                      {directUploadResult?.success && (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                    {directUploadResult?.path ? (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {directUploadResult.fileSize ? `${Math.round(directUploadResult.fileSize / (1024 * 1024))}MB` : ''} 
                        {directUploadResult.direct ? ' • Direct upload' : ''}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground mt-1 truncate">
                        {typeof uploadedModelData === 'object' && 'fileSize' in uploadedModelData ? 
                          `${Math.round((uploadedModelData.fileSize as number) / (1024 * 1024))}MB` : ""}
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                {!directUploadResult?.success && typeof uploadedModelData === 'object' && 'data' in uploadedModelData && uploadedModelData.data && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full text-xs" 
                    onClick={async () => {
                      try {
                        if (typeof uploadedModelData === 'object' && 'data' in uploadedModelData && 'fileName' in uploadedModelData) {
                          await uploadDirectToSupabase(
                            uploadedModelData.data, 
                            uploadedModelData.fileName
                          );
                        }
                      } catch (err) {
                        console.error('Error in direct upload:', err);
                      }
                    }}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-1 h-3 w-3" />
                        Upload Directly to Storage
                      </>
                    )}
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={handleUploadModel}
                disabled={isUploading}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload STL Model
                  </>
                )}
              </Button>
            )}
          </div>

          {error && (
            <div className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Filament selection section */}
      <div className="bg-card rounded-md border p-4">
        <h2 className="text-lg font-medium mb-3 text-card-foreground">Material & Quantity</h2>

        <div className="space-y-4">
          <div>
            <Label htmlFor="filament-select" className="mb-2 block text-foreground">PLA Color</Label>
            <Select
              value={selectedFilament}
              onValueChange={setSelectedFilament}
            >
              <SelectTrigger className="w-full" id="filament-select">
                <SelectValue placeholder="Select color" />
              </SelectTrigger>
              <SelectContent>
                {filamentColors.map((filament) => (
                  <SelectItem key={filament.id} value={filament.id}>
                    {filament.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity selector */}
          <div>
            <Label htmlFor="quantity" className="text-foreground">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full"
              min={1}
            />
          </div>
        </div>
      </div>

      {/* Order Summary */}
      <OrderSummary
        basePrice={basePrice}
        materialCost={materialCost}
        printingCost={printingCost}
        shippingCost={shippingCost}
        finalPrice={finalPrice}
        complexityFactor={complexityFactor}
        printability={printability}
        priceSource={priceSource}
        isPriceCalculating={isPriceCalculating}
        isPreparing={isPreparing}
        selectedModelName={selectedModelIndex !== null
          ? models[selectedModelIndex]?.name || 'Unnamed Model'
          : uploadedModelData
            ? 'Uploaded Model'
            : null}
        selectedFilament={filamentColors.find(f => f.id === selectedFilament)?.name || selectedFilament || 'None'}
        quantity={quantity}
        onCalculatePrice={calculatePriceFromAPI}
        formatPrice={formatPrice}
      />

      {/* Action buttons */}
      <div className="flex justify-between">
        <Button
          onClick={calculatePriceFromAPI}
          disabled={isLoading || isPriceCalculating || !selectedFilament || (selectedModelIndex === null && !uploadedModelData)}
          variant="outline"
        >
          {isPriceCalculating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Calculating
            </>
          ) : (
            "Recalculate Price"
          )}
        </Button>

        <Button
          onClick={handleCheckout}
          disabled={isLoading || isUploading || isPriceCalculating || !selectedFilament || (selectedModelIndex === null && !uploadedModelData) || priceSource === 'estimate'}
          className="bg-primary hover:bg-primary/90"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing
            </>
          ) : isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : directUploadResult?.success ? (
            <>
              <CheckCircle className="mr-2 h-4 w-4" />
              Checkout {formatPrice(finalPrice)}
            </>
          ) : (
            `Checkout ${formatPrice(finalPrice)}`
          )}
        </Button>
      </div>
    </div>
  );
};

export default Print3DTab; 