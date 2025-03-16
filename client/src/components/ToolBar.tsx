import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Undo, Redo, Combine, Plus, Minus, XCircle, Copy, Trash2, Move, RotateCw, Maximize2, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useScene } from "@/hooks/use-scene";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ViewOptions } from "./ViewOptions";
import * as THREE from "three";
import { ShareDialog } from "./ShareDialog";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { uploadAsset } from '@/lib/firebase';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { eventBus, EVENTS } from '@/lib/events';

export const ToolBar = () => {
  const { 
    undo, 
    redo, 
    canUndo, 
    canRedo, 
    renderingMode, 
    setRenderingMode,
    cameraView, 
    setCameraView, 
    showGrid, 
    setShowGrid, 
    showAxes, 
    setShowAxes,
    scene,
    models,
    selectedModelIndex,
    secondaryModelIndex,
    selectModel,
    selectSecondaryModel,
    performCSGOperation,
    isCSGOperationLoading,
    saveHistoryState,
    removeModel
  } = useScene();
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const [combineOptionsOpen, setCombineOptionsOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [isSavingToDrafts, setIsSavingToDrafts] = useState(false);

  const handleUndo = () => {
    if (canUndo) {
      undo();
      toast({
        title: "Action undone",
        duration: 2000,
      });
    }
  };

  const handleRedo = () => {
    if (canRedo) {
      redo();
      toast({
        title: "Action redone",
        duration: 2000,
      });
    }
  };

  const handleRenderingModeChange = (value: string) => {
    setRenderingMode(value as 'standard' | 'wireframe' | 'metallic' | 'glass-like' | 'xray');
    toast({
      title: `Rendering mode: ${value}`,
      duration: 2000,
    });
  };

  // Handle model selection
  const handlePrimaryModelSelect = (modelIndex: string) => {
    const index = parseInt(modelIndex, 10);
    selectModel(index);
    toast({
      title: "Primary model selected",
      duration: 2000,
    });
  };

  const handleSecondaryModelSelect = (modelIndex: string) => {
    const index = parseInt(modelIndex, 10);
    selectSecondaryModel(index);
    toast({
      title: "Secondary model selected",
      duration: 2000,
    });
  };

  const handleCSGOperation = async (operationType: 'union' | 'subtract' | 'intersect') => {
    if (selectedModelIndex === null || secondaryModelIndex === null) {
      toast({
        title: "Operation failed",
        description: "Please select two models for the operation",
        variant: "destructive",
      });
      return;
    }
    
    const operationNames = {
      union: "Merge",
      subtract: "Cut Out",
      intersect: "Intersect"
    };
    
    toast({
      title: `${operationNames[operationType]} operation in progress...`,
      description: "Please wait while we process your models",
      variant: "default",
    });
    
    try {
      await performCSGOperation(operationType);
      toast({
        title: "Operation complete",
        description: `${operationNames[operationType]} operation was successful`,
        duration: 2000,
      });
      
      // Close popover when done
      setCombineOptionsOpen(false);
    } catch (error) {
      toast({
        title: "Operation failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleCopyModel = () => {
    if (selectedModelIndex === null || !models[selectedModelIndex]) {
      toast({
        title: "No model selected",
        description: "Please select a model to copy",
        variant: "destructive",
      });
      return;
    }

    const modelToCopy = models[selectedModelIndex];
    
    // Clone the geometry and material
    const geometry = modelToCopy.mesh.geometry.clone();
    const material = modelToCopy.mesh.material instanceof Array
      ? modelToCopy.mesh.material.map(m => m.clone())
      : modelToCopy.mesh.material.clone();

    // Create new mesh
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Position slightly offset from original
    mesh.position.copy(modelToCopy.mesh.position);
    mesh.position.x += 50; // Offset by 50mm
    mesh.rotation.copy(modelToCopy.mesh.rotation);
    mesh.scale.copy(modelToCopy.mesh.scale);

    // Store original transform
    const originalPosition = mesh.position.clone();
    const originalRotation = mesh.rotation.clone();
    const originalScale = mesh.scale.clone();

    // Create new model object
    const newModel = {
      id: `${modelToCopy.type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: `${modelToCopy.name} (Copy)`,
      type: modelToCopy.type,
      mesh,
      originalPosition,
      originalRotation,
      originalScale,
      ...(modelToCopy.textProps ? { textProps: { ...modelToCopy.textProps } } : {})
    };

    // Add to scene and state
    scene.add(mesh);
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();

    toast({
      title: "Model Copied",
      description: `Created copy of ${modelToCopy.name}`,
      duration: 2000,
    });
  };

  const handleDeleteModel = () => {
    if (selectedModelIndex === null) {
      toast({
        title: "No model selected",
        description: "Please select a model to delete",
        variant: "destructive",
      });
      return;
    }

    const modelName = models[selectedModelIndex].name;
    removeModel(selectedModelIndex);
    
    toast({
      title: "Model Deleted",
      description: `Removed ${modelName}`,
      duration: 2000,
    });
  };

  // Internal utility function to export model to STL
  const exportModelToSTL = (model: any): Uint8Array => {
    const exporter = new STLExporter();
    const mesh = model.mesh.clone();
    
    // Apply model transformations to the mesh for export
    mesh.position.copy(model.mesh.position);
    mesh.rotation.copy(model.mesh.rotation);
    mesh.scale.copy(model.mesh.scale);
    
    const result = exporter.parse(mesh as any, { binary: true });
    
    // Convert to Uint8Array which is suitable for creating Blobs
    return new Uint8Array(result.buffer);
  };

  // Internal utility function to upload STL to drafts
  const uploadSTLToDrafts = async (userId: string, file: File, modelName: string) => {
    if (!userId) {
      throw new Error("User ID is required");
    }
    
    return await uploadAsset(userId, file, modelName);
  };

  // Add this function to handle saving to drafts
  const handleSaveToDrafts = async () => {
    if (!isAuthenticated) {
      toast({
        description: "Please sign in to save models to your drafts",
      });
      return;
    }

    if (selectedModelIndex === null) {
      toast({
        description: "Please select a model to save",
      });
      return;
    }

    if (!user) {
      toast({
        description: "User information not available",
        variant: "destructive",
      });
      return;
    }

    setIsSavingToDrafts(true);
    
    try {
      // Get the selected model
      const model = models[selectedModelIndex];
      
      // Generate STL data
      const stlData = exportModelToSTL(model);
      
      // Create a Blob and File object
      const blob = new Blob([stlData], { type: 'application/vnd.ms-pki.stl' });
      const file = new File([blob], `${model.name || 'model'}.stl`, { type: 'application/vnd.ms-pki.stl' });
      
      // Upload to Firebase
      await uploadSTLToDrafts(user.id, file, model.name);
      
      toast({
        description: "Model saved to your drafts",
      });
      
      // Emit event to refresh drafts
      eventBus.emit(EVENTS.REFRESH_DRAFTS);
    } catch (error) {
      console.error("Error saving to drafts:", error);
      toast({
        description: "Failed to save model to drafts",
        variant: "destructive",
      });
    } finally {
      setIsSavingToDrafts(false);
    }
  };

  return (
    <div className="bg-background/90 backdrop-blur-sm rounded-lg shadow-lg p-1.5 flex items-center justify-center space-x-1.5 border border-border max-w-fit mx-auto">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleUndo} 
            disabled={!canUndo}
            className="h-7 w-7"
          >
            <Undo className={canUndo ? "text-foreground" : "text-muted-foreground"} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Undo (Ctrl+Z)</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleRedo} 
            disabled={!canRedo}
            className="h-7 w-7"
          >
            <Redo className={canRedo ? "text-foreground" : "text-muted-foreground"} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Redo (Ctrl+Y)</p>
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-0.5" />
      
      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon"
            className="h-7 w-7"
            onClick={handleCopyModel}
            disabled={selectedModelIndex === null}
          >
            <Copy className={selectedModelIndex !== null ? "text-foreground" : "text-muted-foreground"} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Copy Model (Ctrl+C)</p>
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon"
            className="h-7 w-7"
            onClick={handleDeleteModel}
            disabled={selectedModelIndex === null}
          >
            <Trash2 className={selectedModelIndex !== null ? "text-destructive" : "text-muted-foreground"} size={16} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Delete Selected Model</p>
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-0.5" />

      {/* Save to Drafts Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            onClick={handleSaveToDrafts}
            disabled={selectedModelIndex === null || !isAuthenticated || isSavingToDrafts}
          >
            {isSavingToDrafts ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Save to Drafts</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-0.5" />

      {/* Combine Models Popover */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Popover open={combineOptionsOpen} onOpenChange={setCombineOptionsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="px-2 h-7 text-xs">
                <span className="text-foreground">Combine</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-2" align="center">
              <div className="space-y-2">
                <h4 className="font-medium text-sm leading-none">Model Selection for Boolean Operations</h4>
                
                <div className="grid grid-cols-2 gap-1.5 py-1.5">
                  <div>
                    <Label htmlFor="primary-model" className="text-xs mb-1 block">Primary Model</Label>
                    <Select
                      value={selectedModelIndex !== null ? selectedModelIndex.toString() : ''}
                      onValueChange={handlePrimaryModelSelect}
                      disabled={models.length < 1}
                    >
                      <SelectTrigger id="primary-model" className="text-xs py-1.5">
                        <SelectValue placeholder="Select model..." />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((model, index) => (
                          <SelectItem key={`primary-${index}`} value={index.toString()} className="text-xs py-1">
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="secondary-model" className="text-xs mb-1 block">Secondary Model</Label>
                    <Select
                      value={secondaryModelIndex !== null ? secondaryModelIndex.toString() : ''}
                      onValueChange={handleSecondaryModelSelect}
                      disabled={models.length < 2}
                    >
                      <SelectTrigger id="secondary-model" className="text-xs py-1.5">
                        <SelectValue placeholder="Select model..." />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((model, index) => (
                          <SelectItem key={`secondary-${index}`} value={index.toString()} className="text-xs py-1">
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <Separator className="my-1" />
                
                {/* Model list with checkboxes */}
                <div className="max-h-[200px] overflow-y-auto border rounded p-1.5">
                  {models.map((model, index) => (
                    <div 
                      key={`model-${index}`}
                      className={`flex items-center justify-between p-1 rounded mb-1 text-xs ${
                        index === selectedModelIndex || index === secondaryModelIndex
                        ? 'bg-muted/80'
                        : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center space-x-1.5">
                        <Checkbox 
                          id={`model-${index}`}
                          checked={index === selectedModelIndex || index === secondaryModelIndex}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              if (selectedModelIndex === null) {
                                selectModel(index);
                              } else if (secondaryModelIndex === null) {
                                selectSecondaryModel(index);
                              } else {
                                // If both are already selected, update the secondary selection
                                selectSecondaryModel(index);
                              }
                            } else {
                              // Deselect the appropriate model
                              if (index === selectedModelIndex) {
                                selectModel(null);
                              } else if (index === secondaryModelIndex) {
                                selectSecondaryModel(null);
                              }
                            }
                          }}
                        />
                        <Label htmlFor={`model-${index}`} className="cursor-pointer">
                          {model.name}
                        </Label>
                      </div>
                      <div className="flex items-center">
                        {(index === selectedModelIndex || index === secondaryModelIndex) && (
                          <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded mr-1.5 text-[10px]">
                            {index === selectedModelIndex ? "Primary" : "Secondary"}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                
                <Separator className="my-1" />
                
                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    variant="outline"
                    onClick={() => handleCSGOperation('union')}
                    disabled={selectedModelIndex === null || secondaryModelIndex === null || isCSGOperationLoading}
                    className="h-7 text-xs"
                  >
                    {isCSGOperationLoading ? <span className="animate-pulse">Processing...</span> : "Union"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleCSGOperation('subtract')}
                    disabled={selectedModelIndex === null || secondaryModelIndex === null || isCSGOperationLoading}
                    className="h-7 text-xs"
                  >
                    {isCSGOperationLoading ? <span className="animate-pulse">Processing...</span> : "Subtract"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleCSGOperation('intersect')}
                    disabled={selectedModelIndex === null || secondaryModelIndex === null || isCSGOperationLoading}
                    className="h-7 text-xs"
                  >
                    {isCSGOperationLoading ? <span className="animate-pulse">Processing...</span> : "Intersect"}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </TooltipTrigger>
        <TooltipContent>
          <p>Boolean Operations</p>
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-0.5" />

      {/* Model List */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="px-2 h-7 text-xs">
                <span className="text-foreground">Models</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[250px] p-2" align="center">
              <div className="space-y-2">
                <h4 className="font-medium text-sm leading-none">Available Models</h4>
                {models.length === 0 ? (
                  <div className="text-center p-2 text-xs text-muted-foreground">
                    No models available
                  </div>
                ) : (
                  <div className="max-h-[200px] overflow-y-auto border rounded p-1.5">
                    {models.map((model, index) => (
                      <div 
                        key={model.id}
                        className={`flex items-center justify-between p-1.5 rounded mb-1 cursor-pointer ${
                          index === selectedModelIndex ? 'bg-muted/80' : 'hover:bg-muted/50'
                        }`}
                        onClick={() => selectModel(index)}
                      >
                        <div className="text-xs truncate max-w-[120px]">{model.name}</div>
                        <div className="flex items-center">
                          {index === selectedModelIndex && (
                            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded mr-1.5">
                              Selected
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectModel(index);
                              handleCopyModel();
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectModel(index);
                              handleDeleteModel();
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </TooltipTrigger>
        <TooltipContent>
          <p>Current Models</p>
        </TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6 mx-0.5" />

      {/* Rendering Mode */}
      <div className="flex items-center space-x-1.5">
        <Select value={renderingMode} onValueChange={handleRenderingModeChange}>
          <SelectTrigger className="w-[110px] h-7 text-xs px-2">
            <SelectValue placeholder="Rendering Mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem key="standard" value="standard" className="text-xs py-1">Standard</SelectItem>
            <SelectItem key="wireframe" value="wireframe" className="text-xs py-1">Wireframe</SelectItem>
            <SelectItem key="metallic" value="metallic" className="text-xs py-1">Metallic</SelectItem>
            <SelectItem key="glass-like" value="glass-like" className="text-xs py-1">Glass-like</SelectItem>
            <SelectItem key="xray" value="xray" className="text-xs py-1">X-Ray</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

export default ToolBar; 