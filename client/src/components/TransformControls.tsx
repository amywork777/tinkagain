import { Button } from "@/components/ui/button";
import { useScene } from "@/hooks/use-scene";
import { 
  MoveIcon, 
  RotateCcwIcon, 
  BoxIcon, 
  ArrowUpIcon, 
  ArrowDownIcon, 
  ArrowLeftIcon, 
  ArrowRightIcon,
  GridIcon, 
  MagnetIcon,
  RotateCw,
  RefreshCw,
  MaximizeIcon,
  MinimizeIcon,
  Move,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  MousePointer,
  Ruler,
  Box
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Box3, Vector3 } from "three";
import { cn } from "@/lib/utils";

const TRANSFORM_MODES = [
  { id: "translate", label: "Move", icon: MoveIcon },
  { id: "rotate", label: "Rotate", icon: RotateCcwIcon },
  { id: "scale", label: "Scale", icon: BoxIcon },
] as const;

// Units constants
const POSITION_UNIT = "mm";
const ROTATION_UNIT = "°";
const SCALE_UNIT = "";
const DIMENSION_UNIT = "mm";

// Maximum scale is now based on allowing models to reach reasonable size
const MAX_SCALE = 10; // Reduced from 100 to 10 for more intuitive scaling
const MAX_SCALE_FINE = 2; // For fine-tuning at lower scales
const MM_PER_INCH = 25.4;
const MAX_SIZE_MM = 254; // 10 inches in mm

// Helper function to format scale display
const formatScale = (scale: number) => {
  return scale >= 1 ? scale.toFixed(2) : scale.toFixed(3);
};

export function TransformControls({ className }: { className?: string }) {
  const { 
    transformMode, 
    setTransformMode, 
    applyTransform, 
    resetTransform,
    selectedModelIndex,
    models,
    setModelPosition,
    setModelRotation,
    setModelScale,
    snapSettings,
    toggleSnap,
    updateSnapSettings,
    unit,
    setUnit,
    convertValue
  } = useScene();
  
  // State for direct input values
  const [positionValues, setPositionValues] = useState({ x: 0, y: 0, z: 0 });
  const [rotationValues, setRotationValues] = useState({ x: 0, y: 0, z: 0 });
  const [scaleValues, setScaleValues] = useState({ x: 1, y: 1, z: 1 });
  const [uniformScale, setUniformScale] = useState(1);
  const [useUniformScale, setUseUniformScale] = useState(false);
  const [scaleMode, setScaleMode] = useState('normal');
  
  // State for slider controls
  const [xPosition, setXPosition] = useState(0);
  const [yPosition, setYPosition] = useState(0);
  const [zPosition, setZPosition] = useState(0);
  const [xRotation, setXRotation] = useState(0);
  const [yRotation, setYRotation] = useState(0);
  const [zRotation, setZRotation] = useState(0);
  const [xScale, setXScale] = useState(1);
  const [yScale, setYScale] = useState(1);
  const [zScale, setZScale] = useState(1);
  
  // State for dimensions of the selected model
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, depth: 0 });
  
  // Update input fields when selected model changes
  useEffect(() => {
    if (selectedModelIndex !== null && models[selectedModelIndex]) {
      const model = models[selectedModelIndex];
      
      // Position values
      const posX = parseFloat(model.mesh.position.x.toFixed(2));
      const posY = parseFloat(model.mesh.position.y.toFixed(2));
      const posZ = parseFloat(model.mesh.position.z.toFixed(2));
      
      setPositionValues({ x: posX, y: posY, z: posZ });
      setXPosition(posX);
      setYPosition(posY);
      setZPosition(posZ);
      
      // Rotation values
      const rotX = parseFloat(model.mesh.rotation.x.toFixed(2));
      const rotY = parseFloat(model.mesh.rotation.y.toFixed(2));
      const rotZ = parseFloat(model.mesh.rotation.z.toFixed(2));
      
      setRotationValues({ x: rotX, y: rotY, z: rotZ });
      setXRotation(rotX);
      setYRotation(rotY);
      setZRotation(rotZ);
      
      // Scale values
      const sclX = parseFloat(model.mesh.scale.x.toFixed(2));
      const sclY = parseFloat(model.mesh.scale.y.toFixed(2));
      const sclZ = parseFloat(model.mesh.scale.z.toFixed(2));
      
      setScaleValues({ x: sclX, y: sclY, z: sclZ });
      setXScale(sclX);
      setYScale(sclY);
      setZScale(sclZ);
      
      // Use the average of all scales for uniform scale
      setUniformScale(
        parseFloat(((sclX + sclY + sclZ) / 3).toFixed(2))
      );

      // Calculate and update dimensions
      if (model.mesh.geometry) {
        model.mesh.geometry.computeBoundingBox();
        const bbox = model.mesh.geometry.boundingBox || new Box3();
        const size = new Vector3();
        bbox.getSize(size);
        
        // Apply scale to get actual dimensions with swapped Y and Z
        const width = parseFloat((size.x * sclX).toFixed(2));
        // Swap depth and height to match our label swap in the UI
        const depth = parseFloat((size.y * sclZ).toFixed(2)); // Y dimension (controlled by Z scale) is depth
        const height = parseFloat((size.z * sclY).toFixed(2)); // Z dimension (controlled by Y scale) is height
        
        setDimensions({ width, height, depth });
      }
    }
  }, [selectedModelIndex, models]);
  
  // Handle transform operations
  const handleTransform = (operation: string, direction: number) => {
    applyTransform(operation as any, direction as any);
  };
  
  // Handle slider position change
  const handlePositionSliderChange = (axis: 'x' | 'y' | 'z', value: number) => {
    if (selectedModelIndex === null) return;
    
    let newPosition = { ...positionValues };
    
    if (axis === 'x') {
      newPosition.x = value;
      setXPosition(value);
    } else if (axis === 'y') {
      // Y input controls Y position
      newPosition.y = value;
      setYPosition(value);
    } else {
      // Z input controls Z position
      newPosition.z = value;
      setZPosition(value);
    }
    
    setPositionValues(newPosition);
    setModelPosition(newPosition.x, newPosition.y, newPosition.z);
  };
  
  // Handle slider rotation change
  const handleRotationSliderChange = (axis: 'x' | 'y' | 'z', value: number) => {
    if (selectedModelIndex === null) return;
    
    let newRotation = { ...rotationValues };
    
    if (axis === 'x') {
      newRotation.x = value;
      setXRotation(value);
    } else if (axis === 'y') {
      // Y input controls Y rotation
      newRotation.y = value;
      setYRotation(value);
    } else {
      // Z input controls Z rotation
      newRotation.z = value;
      setZRotation(value);
    }
    
    setRotationValues(newRotation);
    setModelRotation(newRotation.x, newRotation.y, newRotation.z);
  };
  
  // Handle slider scale change
  const handleScaleSliderChange = (axis: 'x' | 'y' | 'z', value: number) => {
    if (selectedModelIndex === null) return;
    
    let newScale = { ...scaleValues };
    
    if (axis === 'x') {
      newScale.x = value;
      setXScale(value);
    } else if (axis === 'y') {
      // Y input updates Y scale value
      newScale.y = value;
      setYScale(value);
    } else if (axis === 'z') {
      // Z input updates Z scale value
      newScale.z = value;
      setZScale(value);
    }
    
    setScaleValues(newScale);
    
    // Swap Y and Z when applying to the model
    setModelScale(newScale.x, newScale.z, newScale.y);
    
    // Update dimensions after scale change
    if (selectedModelIndex !== null && models[selectedModelIndex]) {
      const model = models[selectedModelIndex];
      if (model.mesh.geometry) {
        model.mesh.geometry.computeBoundingBox();
        if (model.mesh.geometry.boundingBox) {
          const size = new Vector3();
          model.mesh.geometry.boundingBox.getSize(size);
          
          // Apply the current scale to get actual dimensions with Y and Z swapped
          const width = parseFloat((size.x * newScale.x).toFixed(2));
          // Swap depth and height to match our label swap in the UI
          const depth = parseFloat((size.y * newScale.z).toFixed(2)); // Y dimension (controlled by Z scale) is depth
          const height = parseFloat((size.z * newScale.y).toFixed(2)); // Z dimension (controlled by Y scale) is height
          
          console.log(`Updated dimensions: ${width.toFixed(2)}mm × ${height.toFixed(2)}mm × ${depth.toFixed(2)}mm`);
          console.log(`Updated dimensions: ${(width/25.4).toFixed(2)}in × ${(height/25.4).toFixed(2)}in × ${(depth/25.4).toFixed(2)}in`);
          
          setDimensions({ width, height, depth });
        }
      }
    }
  };
  
  // Handle uniform scale slider change
  const handleUniformScaleSliderChange = (value: number) => {
    if (selectedModelIndex === null) return;
    
    // Set all scale values and UI state
    setUniformScale(value);
    setScaleValues({ x: value, y: value, z: value });
    setXScale(value);
    setYScale(value);
    setZScale(value);
    
    // Apply scale to model with Y-Z swap for consistency
    setModelScale(value, value, value);

    // Update dimensions after uniform scale change
    if (selectedModelIndex !== null && models[selectedModelIndex]) {
      const model = models[selectedModelIndex];
      if (model.mesh.geometry) {
        // Ensure we compute the current bounding box for accurate dimensions
        model.mesh.geometry.computeBoundingBox();
        if (model.mesh.geometry.boundingBox) {
          const size = new Vector3();
          model.mesh.geometry.boundingBox.getSize(size);
          
          // Apply the uniform scale to get actual dimensions
          const width = parseFloat((size.x * value).toFixed(2));
          // Swap depth and height to match our label swap in the UI
          const depth = parseFloat((size.y * value).toFixed(2)); // Y dimension is depth
          const height = parseFloat((size.z * value).toFixed(2)); // Z dimension is height
          
          console.log(`Updated dimensions (uniform): ${width.toFixed(2)}mm × ${height.toFixed(2)}mm × ${depth.toFixed(2)}mm`);
          console.log(`Updated dimensions (uniform): ${(width/25.4).toFixed(2)}in × ${(height/25.4).toFixed(2)}in × ${(depth/25.4).toFixed(2)}in`);
          
          setDimensions({ width, height, depth });
        }
      }
    }
  };
  
  const getAxisColor = (axis: 'x' | 'y' | 'z') => {
    return axis === 'x' ? "bg-red-500" : axis === 'y' ? "bg-green-500" : "bg-blue-500";
  };
  
  // Add a function to get the dimension unit
  const getDimensionUnit = () => {
    return unit === 'mm' ? 'mm' : 'in';
  };
  
  // Format a value with the appropriate unit
  const formatDimension = (value: number) => {
    if (unit === 'in') {
      return `${(value / 25.4).toFixed(3)} in`;
    }
    return `${value.toFixed(1)} mm`;
  };
  
  // Toggle between mm and in
  const toggleUnit = () => {
    setUnit(unit === 'mm' ? 'in' : 'mm');
  };
  
  // Add a function to format position values based on current unit
  const formatPosition = (value: number) => {
    return unit === 'mm' 
      ? value.toFixed(2) 
      : convertValue(value, 'mm', 'in').toFixed(3);
  };

  // Add new handlers for number inputs
  const handlePositionInputChange = (axis: 'x' | 'y' | 'z', value: string) => {
    if (selectedModelIndex === null) return;
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    
    handlePositionSliderChange(axis, numValue);
  };

  const handleRotationInputChange = (axis: 'x' | 'y' | 'z', value: string) => {
    if (selectedModelIndex === null) return;
    
    const numValue = parseFloat(value) * Math.PI / 180; // Convert degrees to radians
    if (isNaN(numValue)) return;
    
    handleRotationSliderChange(axis, numValue);
  };

  const handleScaleInputChange = (axis: 'x' | 'y' | 'z', value: string) => {
    if (selectedModelIndex === null) return;
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    
    handleScaleSliderChange(axis, numValue);
  };

  const handleUniformScaleInputChange = (value: string) => {
    if (selectedModelIndex === null) return;
    
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    
    handleUniformScaleSliderChange(numValue);
  };

  return (
    <div className={cn("", className)}>
      <Card className="bg-background/90 backdrop-blur-sm shadow-lg border border-border max-w-full">
        <CardContent className="p-1 sm:p-2">
          <div className="space-y-2">
            {selectedModelIndex === null ? (
              <div className="flex items-center justify-center h-8 text-xs text-muted-foreground">
                Select a model
              </div>
            ) : (
              <>
                {/* Mode Selection */}
                <div className="flex items-center space-x-1 justify-center">
                  <div className="bg-muted rounded-md p-0.5 flex">
                    {TRANSFORM_MODES.map((mode) => {
                      const IconComponent = mode.icon;
                      const isActive = transformMode === mode.id;
                      return (
                        <Button
                          key={mode.id}
                          variant="ghost"
                          size="sm"
                          className={`rounded-sm h-7 px-2 ${isActive ? 'bg-background shadow-sm' : ''}`}
                          onClick={() => setTransformMode(mode.id as any)}
                        >
                          <IconComponent className="h-3.5 w-3.5 mr-1" />
                          <span className="text-xs hidden sm:inline">{mode.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7"
                        onClick={resetTransform}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Reset Transform</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center space-x-1">
                        <Switch
                          checked={snapSettings.enabled}
                          onCheckedChange={toggleSnap}
                          className="data-[state=checked]:bg-green-500"
                        />
                        <span className="text-xs whitespace-nowrap hidden sm:inline">Snap</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Enable Snap to Grid</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={toggleUnit}
                      >
                        {unit.toUpperCase()}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Toggle Units (MM/Inches)</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                {/* Model Info */}
                <div className="flex flex-wrap items-center justify-between text-xs gap-1">
                  <div className="flex text-[10px] space-x-2">
                    <div>
                      <span className="text-red-500">W:</span>{formatDimension(dimensions.width)}
                    </div>
                    <div>
                      <span className="text-blue-500">D:</span>{formatDimension(dimensions.height)}
                    </div>
                    <div>
                      <span className="text-green-500">H:</span>{formatDimension(dimensions.depth)}
                    </div>
                    <div>
                      {getDimensionUnit()}
                    </div>
                  </div>
                </div>

                {transformMode === "translate" && (
                  <div className="space-y-1.5">
                    <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="x-position" className="text-red-500 text-xs">X Position</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={formatPosition(xPosition)}
                              onChange={(e) => handlePositionInputChange('x', e.target.value)}
                              className="w-14 h-5 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">{POSITION_UNIT}</span>
                          </div>
                        </div>
                        <Slider 
                          id="x-position"
                          min={-150} 
                          max={150}
                          step={1}
                          value={[xPosition]} 
                          onValueChange={(values) => handlePositionSliderChange('x', values[0])}
                          className="slider-red"
                        />
                      </div>
                    </Card>
                    
                    <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="y-position" className="text-blue-500 text-xs">Y Position</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={formatPosition(yPosition)}
                              onChange={(e) => handlePositionInputChange('y', e.target.value)}
                              className="w-14 h-5 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">{POSITION_UNIT}</span>
                          </div>
                        </div>
                        <Slider 
                          id="y-position"
                          min={-150} 
                          max={150}
                          step={1}
                          value={[yPosition]} 
                          onValueChange={(values) => handlePositionSliderChange('y', values[0])}
                          className="slider-blue"
                        />
                      </div>
                    </Card>
                    
                    <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="z-position" className="text-green-500 text-xs">Z Position</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={formatPosition(zPosition)}
                              onChange={(e) => handlePositionInputChange('z', e.target.value)}
                              className="w-14 h-5 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">{POSITION_UNIT}</span>
                          </div>
                        </div>
                        <Slider 
                          id="z-position"
                          min={-150} 
                          max={150}
                          step={1}
                          value={[zPosition]} 
                          onValueChange={(values) => handlePositionSliderChange('z', values[0])}
                          className="slider-green"
                        />
                      </div>
                    </Card>
                  </div>
                )}
                
                {transformMode === "rotate" && (
                  <div className="space-y-1.5">
                    <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="x-rotation" className="text-red-500 text-xs">X Rotation</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={xRotation.toFixed(0)}
                              onChange={(e) => handleRotationInputChange('x', e.target.value)}
                              className="w-14 h-5 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">{ROTATION_UNIT}</span>
                          </div>
                        </div>
                        <Slider 
                          id="x-rotation"
                          min={-180} 
                          max={180}
                          step={1}
                          value={[xRotation]} 
                          onValueChange={(values) => handleRotationSliderChange('x', values[0])}
                          className="slider-red"
                        />
                      </div>
                    </Card>
                    
                    <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="y-rotation" className="text-blue-500 text-xs">Y Rotation</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={yRotation.toFixed(0)}
                              onChange={(e) => handleRotationInputChange('y', e.target.value)}
                              className="w-14 h-5 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">{ROTATION_UNIT}</span>
                          </div>
                        </div>
                        <Slider 
                          id="y-rotation"
                          min={-180} 
                          max={180}
                          step={1}
                          value={[yRotation]} 
                          onValueChange={(values) => handleRotationSliderChange('y', values[0])}
                          className="slider-blue"
                        />
                      </div>
                    </Card>
                    
                    <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="z-rotation" className="text-green-500 text-xs">Z Rotation</Label>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              value={zRotation.toFixed(0)}
                              onChange={(e) => handleRotationInputChange('z', e.target.value)}
                              className="w-14 h-5 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">{ROTATION_UNIT}</span>
                          </div>
                        </div>
                        <Slider 
                          id="z-rotation"
                          min={-180} 
                          max={180}
                          step={1}
                          value={[zRotation]} 
                          onValueChange={(values) => handleRotationSliderChange('z', values[0])}
                          className="slider-green"
                        />
                      </div>
                    </Card>
                  </div>
                )}
                
                {transformMode === "scale" && (
                  <div className="space-y-1.5">
                    <div className="flex items-center space-x-2 justify-between">
                      <div className="flex items-center">
                        <Checkbox 
                          id="uniform-scale" 
                          checked={useUniformScale} 
                          onCheckedChange={(checked) => setUseUniformScale(checked === true)}
                          className="h-3.5 w-3.5 rounded-sm mr-1.5"
                        />
                        <Label htmlFor="uniform-scale" className="text-xs cursor-pointer">Uniform Scale</Label>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button
                          variant={scaleMode === 'normal' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setScaleMode('normal')}
                          className="h-6 text-xs px-2"
                        >
                          Normal
                        </Button>
                        <Button
                          variant={scaleMode === 'fine' ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setScaleMode('fine')}
                          className="h-6 text-xs px-2"
                        >
                          Fine
                        </Button>
                      </div>
                    </div>
                    
                    {useUniformScale ? (
                      <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="uniform-scale-slider" className="text-xs">Uniform Scale</Label>
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                value={uniformScale.toFixed(scaleMode === 'fine' ? 3 : 2)}
                                onChange={(e) => handleUniformScaleInputChange(e.target.value)}
                                min={0.01}
                                max={scaleMode === 'fine' ? MAX_SCALE_FINE : MAX_SCALE}
                                step={scaleMode === 'fine' ? 0.005 : 0.01}
                                className="w-14 h-5 text-xs"
                              />
                              <span className="text-xs text-muted-foreground">{SCALE_UNIT}</span>
                            </div>
                          </div>
                          <Slider 
                            id="uniform-scale-slider"
                            min={scaleMode === 'fine' ? 0.01 : 0.1} 
                            max={scaleMode === 'fine' ? MAX_SCALE_FINE : MAX_SCALE}
                            step={scaleMode === 'fine' ? 0.005 : 0.01}
                            value={[uniformScale]} 
                            onValueChange={(values) => handleUniformScaleSliderChange(values[0])}
                            className="slider-purple"
                          />
                        </div>
                      </Card>
                    ) : (
                      <>
                        <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label htmlFor="x-scale" className="text-red-500 text-xs">X Scale</Label>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={xScale.toFixed(scaleMode === 'fine' ? 3 : 2)}
                                  onChange={(e) => handleScaleInputChange('x', e.target.value)}
                                  min={0.01}
                                  max={scaleMode === 'fine' ? MAX_SCALE_FINE : MAX_SCALE}
                                  step={scaleMode === 'fine' ? 0.005 : 0.01}
                                  className="w-14 h-5 text-xs"
                                />
                                <span className="text-xs text-muted-foreground">{SCALE_UNIT}</span>
                              </div>
                            </div>
                            <Slider 
                              id="x-scale"
                              min={scaleMode === 'fine' ? 0.01 : 0.1} 
                              max={scaleMode === 'fine' ? MAX_SCALE_FINE : MAX_SCALE}
                              step={scaleMode === 'fine' ? 0.005 : 0.01}
                              value={[xScale]} 
                              onValueChange={(values) => handleScaleSliderChange('x', values[0])}
                              className="slider-red"
                            />
                          </div>
                        </Card>
                        
                        <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label htmlFor="y-scale" className="text-blue-500 text-xs">Y Scale</Label>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={yScale.toFixed(scaleMode === 'fine' ? 3 : 2)}
                                  onChange={(e) => handleScaleInputChange('y', e.target.value)}
                                  min={0.01}
                                  max={scaleMode === 'fine' ? MAX_SCALE_FINE : MAX_SCALE}
                                  step={scaleMode === 'fine' ? 0.005 : 0.01}
                                  className="w-14 h-5 text-xs"
                                />
                                <span className="text-xs text-muted-foreground">{SCALE_UNIT}</span>
                              </div>
                            </div>
                            <Slider 
                              id="y-scale"
                              min={scaleMode === 'fine' ? 0.01 : 0.1} 
                              max={scaleMode === 'fine' ? MAX_SCALE_FINE : MAX_SCALE}
                              step={scaleMode === 'fine' ? 0.005 : 0.01}
                              value={[yScale]} 
                              onValueChange={(values) => handleScaleSliderChange('y', values[0])}
                              className="slider-blue"
                            />
                          </div>
                        </Card>
                        
                        <Card className="bg-background/80 backdrop-blur-sm p-1.5 border">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label htmlFor="z-scale" className="text-green-500 text-xs">Z Scale</Label>
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={zScale.toFixed(scaleMode === 'fine' ? 3 : 2)}
                                  onChange={(e) => handleScaleInputChange('z', e.target.value)}
                                  min={0.01}
                                  max={scaleMode === 'fine' ? MAX_SCALE_FINE : MAX_SCALE}
                                  step={scaleMode === 'fine' ? 0.005 : 0.01}
                                  className="w-14 h-5 text-xs"
                                />
                                <span className="text-xs text-muted-foreground">{SCALE_UNIT}</span>
                              </div>
                            </div>
                            <Slider 
                              id="z-scale"
                              min={scaleMode === 'fine' ? 0.01 : 0.1} 
                              max={scaleMode === 'fine' ? MAX_SCALE_FINE : MAX_SCALE}
                              step={scaleMode === 'fine' ? 0.005 : 0.01}
                              value={[zScale]} 
                              onValueChange={(values) => handleScaleSliderChange('z', values[0])}
                              className="slider-green"
                            />
                          </div>
                        </Card>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
