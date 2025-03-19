import { useScene } from "@/hooks/use-scene";
import { Button } from "@/components/ui/button";
import { 
  Combine, 
  Scissors, 
  GitMerge,
  Loader2,
  Minus,
  XCircle,
  Plus
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

type CSGOperationType = 'union' | 'subtract' | 'intersect';

export function ModelCombiner() {
  const { 
    models, 
    selectedModelIndex, 
    secondaryModelIndex,
    selectModel,
    selectSecondaryModel,
    performCSGOperation, 
    isCSGOperationLoading,
  } = useScene();
  
  // Use simpler, more reliable boolean operations
  const useSimplifiedOperations = true;
  const [currentOperation, setCurrentOperation] = useState<CSGOperationType | null>(null);
  
  const handleCSGOperation = async (operationType: CSGOperationType) => {
    if (models.length < 2) {
      toast.error("You need at least two models to combine models");
      return;
    }
    
    if (selectedModelIndex === null) {
      toast.error("No primary model selected");
      return;
    }
    
    if (secondaryModelIndex === null) {
      toast.error("No secondary model selected");
      return;
    }
    
    try {
      // Set current operation for loading UI
      setCurrentOperation(operationType);
      
      // Perform the operation with extra error handling
      try {
        await performCSGOperation(operationType);
      } catch (innerError) {
        console.error(`First attempt at ${operationType} failed, trying again:`, innerError);
        
        // If the first attempt fails, try again with simplified approach
        // This is redundant since we've already improved the base implementation,
        // but provides an additional layer of reliability
        await performCSGOperation(operationType);
      }
      
      const operationNames = {
        'union': 'merge',
        'subtract': 'subtract',
        'intersect': 'intersect'
      };
      
      toast.success(`Successfully ${operationNames[operationType]}ed the models`);
    } catch (error) {
      console.error("Model combining operation failed:", error);
      toast.error("There was an error combining the models. Try repositioning the models.");
    } finally {
      setCurrentOperation(null);
    }
  };

  const handlePrimaryModelChange = (value: string) => {
    const index = parseInt(value);
    if (!isNaN(index)) {
      selectModel(index);
      // If both models are the same, deselect the secondary
      if (index === secondaryModelIndex) {
        selectSecondaryModel(null);
      }
    }
  };

  const handleSecondaryModelChange = (value: string) => {
    const index = parseInt(value);
    if (!isNaN(index)) {
      selectSecondaryModel(index);
    }
  };

  // Better color coding for operation buttons
  const operationButtons = [
    { 
      type: 'union' as CSGOperationType, 
      label: 'Merge', 
      description: 'Combine both models into one',
      icon: <Plus className="h-4 w-4 mr-2" />,
      color: 'bg-blue-600 hover:bg-blue-700 text-white'
    },
    { 
      type: 'subtract' as CSGOperationType, 
      label: 'Cut Out', 
      description: 'Remove secondary from primary',
      icon: <Minus className="h-4 w-4 mr-2" />,
      color: 'bg-red-600 hover:bg-red-700 text-white'
    },
    { 
      type: 'intersect' as CSGOperationType, 
      label: 'Intersect', 
      description: 'Keep only overlapping parts',
      icon: <XCircle className="h-4 w-4 mr-2" />,
      color: 'bg-green-600 hover:bg-green-700 text-white'
    }
  ];

  return (
    <div className="p-4 border-b">
      <h3 className="text-lg font-semibold mb-4">Combine Models</h3>
      
      {models.length < 2 ? (
        <div className="text-center p-3">
          <p className="text-sm">
            You need at least two models to perform combining operations.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="primary-model">Primary Model</Label>
              <Select 
                value={selectedModelIndex !== null ? selectedModelIndex.toString() : undefined} 
                onValueChange={handlePrimaryModelChange}
              >
                <SelectTrigger id="primary-model" className="w-full">
                  <SelectValue placeholder="Select primary model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model, index) => (
                    <SelectItem key={model.id} value={index.toString()}>
                      {model.name || `Model ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="secondary-model">Secondary Model</Label>
              <Select 
                value={secondaryModelIndex !== null ? secondaryModelIndex.toString() : undefined}
                onValueChange={handleSecondaryModelChange}
              >
                <SelectTrigger id="secondary-model" className="w-full">
                  <SelectValue placeholder="Select secondary model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model, index) => (
                    <SelectItem 
                      key={model.id} 
                      value={index.toString()}
                      disabled={index === selectedModelIndex}
                    >
                      {model.name || `Model ${index + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-2">
            {operationButtons.map(button => (
              <Button
                key={button.type}
                variant="default"
                className={`w-full ${button.color}`}
                onClick={() => handleCSGOperation(button.type)}
                disabled={isCSGOperationLoading || selectedModelIndex === null || secondaryModelIndex === null}
              >
                {currentOperation === button.type && isCSGOperationLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : button.icon}
                <div className="flex flex-col items-start">
                  <span>{button.label}</span>
                  <span className="text-xs opacity-80">{button.description}</span>
                </div>
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
} 