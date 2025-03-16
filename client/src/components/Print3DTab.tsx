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
  X
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

// Initialize with empty array, will be populated from API
const EMPTY_FILAMENT_COLORS: FilamentColor[] = [];

interface FilamentColor {
  id: string;
  name: string;
  hex: string;
}

interface FilamentApiItem {
  id?: string;
  filament?: string;
  name?: string;
  hex?: string;
  color?: string;
  [key: string]: any; // For any other properties
}

// Interface for uploaded model data
interface UploadedModelData {
  data: string | ArrayBuffer | null;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploadTime: string;
}

// Load Stripe outside of a component's render to avoid recreating the Stripe object on every render
const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY 
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : loadStripe('pk_live_51QIaT9CLoBz9jXRlVEQ99Q6V4UiRSYy8ZS49MelsW8EfX1mEijh3K5JQEe5iysIL31cGtf2IsTVIyV1mivoUHCUI00aPpz3GMi'); // Fallback key

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
      const response = await getFilaments();
      console.log('Filament API response:', response);
      
      // Normalize the data to ensure consistent structure
      let colors = [];
      
      if (Array.isArray(response)) {
        colors = response.map((item: FilamentApiItem) => {
          // Clean the name to remove any "PLA" to avoid redundancy
          let name = item.name || item.filament || 'Unknown Color';
          name = name.replace(/\bPLA\b/gi, '').trim();
          name = name.replace(/^[\s-]+|[\s-]+$/g, ''); // Remove leading/trailing spaces and hyphens
          
          return {
          id: item.id || item.filament || item.name || 'unknown',
            name: name,
          hex: item.hex || item.color || '#808080'
          };
        });
      } else if (response && response.filaments && Array.isArray(response.filaments)) {
        colors = response.filaments.map((item: FilamentApiItem) => {
          // Clean the name to remove any "PLA" to avoid redundancy
          let name = item.name || item.filament || 'Unknown Color';
          name = name.replace(/\bPLA\b/gi, '').trim();
          name = name.replace(/^[\s-]+|[\s-]+$/g, ''); // Remove leading/trailing spaces and hyphens
          
          return {
          id: item.id || item.filament || item.name || 'unknown',
            name: name,
          hex: item.hex || item.color || '#808080'
          };
        });
      }
      
      console.log('Normalized filament colors:', colors);
      
      // Use fallback if no valid colors found
      if (colors.length === 0) {
        colors = [
          { id: 'black-pla', name: 'Black', hex: '#121212' },
          { id: 'white-pla', name: 'White', hex: '#f9f9f9' },
          { id: 'gray-pla', name: 'Gray', hex: '#9e9e9e' },
          { id: 'red-pla', name: 'Red', hex: '#f44336' },
          { id: 'blue-pla', name: 'Royal Blue', hex: '#1976d2' },
          { id: 'green-pla', name: 'Forest Green', hex: '#2e7d32' },
          { id: 'yellow-pla', name: 'Bright Yellow', hex: '#fbc02d' },
          { id: 'orange-pla', name: 'Orange', hex: '#ff9800' },
          { id: 'purple-pla', name: 'Purple', hex: '#7b1fa2' },
          { id: 'pink-pla', name: 'Hot Pink', hex: '#e91e63' },
          { id: 'teal-pla', name: 'Teal', hex: '#009688' },
          { id: 'silver-pla', name: 'Silver Metallic', hex: '#b0bec5' },
          { id: 'gold-pla', name: 'Gold Metallic', hex: '#ffd700' },
          { id: 'bronze-pla', name: 'Bronze Metallic', hex: '#cd7f32' },
          { id: 'glow-pla', name: 'Glow-in-the-Dark', hex: '#c6ff00' }
        ];
      }
      
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
      const fallbackColors = [
        { id: 'black-pla', name: 'Black', hex: '#121212' },
        { id: 'white-pla', name: 'White', hex: '#f9f9f9' },
        { id: 'gray-pla', name: 'Gray', hex: '#9e9e9e' },
        { id: 'red-pla', name: 'Red', hex: '#f44336' },
        { id: 'blue-pla', name: 'Royal Blue', hex: '#1976d2' },
        { id: 'green-pla', name: 'Forest Green', hex: '#2e7d32' },
        { id: 'yellow-pla', name: 'Bright Yellow', hex: '#fbc02d' },
        { id: 'orange-pla', name: 'Orange', hex: '#ff9800' },
        { id: 'purple-pla', name: 'Purple', hex: '#7b1fa2' },
        { id: 'pink-pla', name: 'Hot Pink', hex: '#e91e63' }
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
          } else if (volumeCubicCm < 1000) {
            basePrice = 10 + ((volumeCubicCm - 200) / 800) * 20; // $10-$30
          } else if (volumeCubicCm < 5000) {
            basePrice = 30 + ((volumeCubicCm - 1000) / 4000) * 70; // $30-$100
      } else {
            // For extremely large models, continue scaling (approximately $15 per 1000 cubic cm)
            basePrice = 100 + ((volumeCubicCm - 5000) / 1000) * 15;
          }
          
          // No price cap - allow prices to reflect actual material and time costs
          
          // Calculate size in inches (assuming cubic root of volume, converted from cm to inches)
          const sizeInInches = Math.pow(volumeCubicCm, 1/3) / 2.54; 
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
                position.getX(index.getX(i+1)),
                position.getY(index.getX(i+1)),
                position.getZ(index.getX(i+1))
              );
              const c = new THREE.Vector3(
                position.getX(index.getX(i+2)),
                position.getY(index.getX(i+2)),
                position.getZ(index.getX(i+2))
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
                position.getX(i+1),
                position.getY(i+1),
                position.getZ(i+1)
              );
              const c = new THREE.Vector3(
                position.getX(i+2),
                position.getY(i+2),
                position.getZ(i+2)
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

  // Handle file upload function
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
                title: "Model uploaded successfully",
                description: `${originalFileName} (${Math.round(file.size / 1024)}KB)`,
              });
              
              // Calculate price for the uploaded model
              await calculatePriceFromAPI();
            }
          };
          reader.readAsDataURL(file);
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

  // Update the handleCheckout function
  const handleCheckout = async () => {
    console.log("Checkout initiated");
    
    // Validate required fields
    if (selectedModelIndex === null && !uploadedModelData) {
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
      toast({
        title: "Model required",
        description: "Please select a model or upload your own before checkout",
        variant: "destructive",
      });
      return;
    }
    
    // Check for required filament selection
    if (!selectedFilament) {
      toast({
        title: "Filament required",
        description: "Please select a filament color before checkout",
        variant: "destructive",
      });
      return;
    }
    
    // Set loading state
    setIsLoading(true);
    
    // Define variables here to be accessible in the helper function
    let modelName: string = "Unknown Model";
    let stlFileName: string = "unknown_model.stl";
    let stlFileData: string | null = null;
    
    // Helper function to continue with checkout after STL export
    const continueCheckoutProcess = () => {
      // Get the color name from the selected filament
      const selectedColor = filamentColors.find(color => color.id === selectedFilament);
      const colorName = selectedColor ? selectedColor.name : "Unknown Color";
      
      // Prepare the checkout data
      const checkoutData = {
        modelName,
        color: colorName,
        quantity: quantity,
        finalPrice: finalPrice,
        userId: "guest", // Replace with actual user ID if available
        email: "guest@example.com", // Replace with actual email if available
        type: "3d_print", // Specify this is a 3D print checkout
        stlFileName,
        stlFileData // Send the STL data for the server to store
      };
      
      console.log("Sending checkout request with data:", {
        modelName: checkoutData.modelName,
        color: checkoutData.color,
        quantity: checkoutData.quantity,
        finalPrice: checkoutData.finalPrice,
        hasStlFileData: !!checkoutData.stlFileData,
        stlFileName: checkoutData.stlFileName
      });
      
      // Use a single endpoint directly
      const endpoint = '/api/create-checkout-session';
      
      // Call the checkout endpoint
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(checkoutData),
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
      .then(data => {
        if (data.url) {
          // Redirect to Stripe Checkout
          console.log("Redirecting to Stripe Checkout:", data.url);
          window.location.href = data.url;
        } else {
          throw new Error("No checkout URL returned from server");
        }
      })
      .catch(error => {
        console.error("Checkout error:", error);
        toast({
          title: "Checkout failed",
          description: error.message || "Failed to create checkout session",
          variant: "destructive",
        });
        setIsLoading(false);
      });
    };
    
    try {
      console.log("Preparing checkout data");
      
      if (hasSelectedPredefinedModel && models) {
        // We're using a predefined model from the scene
        const model = models[selectedModelIndex];
        modelName = model.name;
        stlFileName = `${model.name.toLowerCase().replace(/\s+/g, '_')}.stl`;
        
        console.log(`Selected predefined model: ${modelName}`);
        
        // For predefined models, we need to export the STL
        try {
          // Export the selected model to STL format (returns a Blob)
          const stlBlob = exportSelectedModelAsSTL();
          if (stlBlob && stlBlob instanceof Blob) {
            // Create a FileReader to convert Blob to ArrayBuffer
            const reader = new FileReader();
            reader.onload = (event) => {
              if (event.target?.result) {
                // Convert ArrayBuffer to base64 string for transmission
                const arrayBuffer = event.target.result as ArrayBuffer;
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const base64 = window.btoa(binary);
                
                // Set the STL file data as a base64 string
                stlFileData = `data:application/octet-stream;base64,${base64}`;
                
                console.log(`Exported STL data for ${modelName}, base64 length: ${stlFileData.length} characters`);
                
                // Continue with checkout process
                continueCheckoutProcess();
              }
            };
            
            // Start reading the blob as ArrayBuffer
            reader.readAsArrayBuffer(stlBlob);
            
            // Return here - the checkout will continue asynchronously after the file is read
            return;
          } else {
            console.warn("Exported STL data is null or not a Blob");
            toast({
              title: "Export failed",
              description: "Could not generate STL data in the correct format",
              variant: "destructive",
            });
            setIsLoading(false);
            return;
          }
        } catch (exportError) {
          console.error("Error exporting predefined model to STL:", exportError);
          toast({
            title: "Export failed",
            description: "Failed to export the model to STL format",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        }
      } else if (hasUploadedModel && uploadedModelData) {
        // We're using a user-uploaded model
        // Handle uploaded model data based on its type
        if (typeof uploadedModelData === 'object' && 'fileName' in uploadedModelData) {
          // It's an UploadedModelData object
          const typedUploadedModelData = uploadedModelData as UploadedModelData;
          modelName = typedUploadedModelData.fileName || "Custom Model";
          stlFileName = typedUploadedModelData.fileName || "custom_model.stl";
          
          // If the uploaded data has string content, use it directly
          if (typedUploadedModelData.data && typeof typedUploadedModelData.data === 'string') {
            stlFileData = typedUploadedModelData.data;
            console.log(`Using existing STL data from upload, length: ${stlFileData.length}`);
          }
        } else {
          // It's some other format, use generic name
          modelName = "Custom Model";
          stlFileName = "custom_model.stl";
        }
        
        console.log(`Using uploaded model: ${modelName}`);
        
        // Try to export the model to STL if we don't already have STL data
        if (!stlFileData && uploadedModelData instanceof Object3D) {
          try {
            console.log("Exporting uploaded model to STL");
            
            // Use the STLExporter to convert the model to STL format
            const exporter = new STLExporter();
            
            // Export as STL string
            const stlString = exporter.parse(uploadedModelData, { binary: false });
            
            // Log a preview of the STL data
            if (typeof stlString === 'string') {
              const previewLength = Math.min(100, stlString.length);
              console.log(`STL data exported successfully. Preview: ${stlString.substring(0, previewLength)}...`);
              console.log(`STL data length: ${stlString.length} characters`);
              stlFileData = stlString;
              
              // Continue with checkout process
              continueCheckoutProcess();
              return;
            } else {
              console.log(`STL data exported but is not a string:`, typeof stlString);
              toast({
                title: "Export failed",
                description: "Failed to export STL data in the correct format",
                variant: "destructive",
              });
              setIsLoading(false);
              return;
            }
          } catch (exportError) {
            console.error("Error exporting model to STL:", exportError);
            toast({
              title: "Export failed",
              description: "Failed to export your model to STL format",
              variant: "destructive",
            });
            setIsLoading(false);
            return;
          }
        } else if (!stlFileData) {
          console.warn("No STL data available for export");
          toast({
            title: "Model data missing",
            description: "Could not find STL data to send with your order",
            variant: "destructive",
          });
          setIsLoading(false);
          return;
        } else {
          // We already have STL data, continue with checkout
          continueCheckoutProcess();
          return;
        }
      } else {
        // Fallback name if no model was properly selected
        console.warn("No specific model was selected for checkout");
        setIsLoading(false);
        return;
      }
    } catch (error) {
      console.error("Error in checkout process:", error);
      toast({
        title: "Checkout error",
        description: "An unexpected error occurred during checkout",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  // Return the component UI
  return (
    <div className="space-y-6">
      {/* Model selection section */}
      <div className="bg-card rounded-md border p-4">
        <h2 className="text-lg font-semibold mb-3">Select a Model</h2>
        
        <div className="space-y-4">
          {/* Model Dropdown */}
          <div>
            <Label htmlFor="model-select">Choose Model</Label>
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
                  <SelectLabel>From 3D Viewer</SelectLabel>
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
                  Upload New Model...
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {/* Selected model info or upload button */}
          <div>
            {selectedModelIndex !== null ? (
              <Card className="bg-muted/50">
                <CardContent className="p-3">
                  <div className="text-sm">
                    <span className="font-medium">Selected: </span>
                    {models[selectedModelIndex]?.name || `Model ${selectedModelIndex + 1}`}
            </div>
                </CardContent>
              </Card>
            ) : uploadedModelData ? (
              <Card className="bg-muted/50">
                <CardContent className="p-3">
                  <div className="text-sm">
                    <span className="font-medium">Uploaded: </span>
                    Custom Model
          </div>
                </CardContent>
              </Card>
            ) : (
            <Button 
              variant="outline" 
                className="w-full"
                onClick={handleUploadModel}
            >
                Upload STL Model
            </Button>
        )}
      </div>
          
          {error && (
            <div className="text-sm text-red-500 flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
            </div>
          </div>
          
      {/* Filament selection section */}
      <div className="bg-card rounded-md border p-4">
        <h2 className="text-lg font-semibold mb-3">Select Filament</h2>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="filament-select" className="mb-2 block font-semibold">Select PLA Color</Label>
            <Select
              value={selectedFilament}
              onValueChange={setSelectedFilament}
            >
              <SelectTrigger className="w-full" id="filament-select">
                <SelectValue placeholder="Select a material color" />
              </SelectTrigger>
              <SelectContent>
                {filamentColors.map((filament) => (
                  <SelectItem key={filament.id} value={filament.id}>
                    {filament.name} PLA
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Quantity selector */}
          <div>
            <Label htmlFor="quantity">Quantity</Label>
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
              Calculating...
            </>
          ) : (
            <>
              Recalculate Price
            </>
          )}
        </Button>
        
          <Button 
          onClick={handleCheckout}
          disabled={isLoading || isPriceCalculating || !selectedFilament || (selectedModelIndex === null && !uploadedModelData) || priceSource === 'estimate'}
          className="bg-primary hover:bg-primary/90"
            >
              {isLoading ? (
                <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
            <>
              Checkout ({formatPrice(finalPrice)})
            </>
              )}
            </Button>
          </div>
    </div>
  );
};

export default Print3DTab; 