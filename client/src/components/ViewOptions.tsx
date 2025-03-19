import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useScene } from "@/hooks/use-scene";

export function ViewOptions() {
  const { 
    cameraView, 
    setCameraView, 
    showGrid, 
    setShowGrid, 
    showAxes, 
    setShowAxes,
    scene,  // Get scene directly for more direct updates
    renderer,
    camera
  } = useScene();

  // Functions to handle visibility changes with direct scene updates
  const handleGridVisibilityChange = (checked: boolean) => {
    console.log(`ViewOptions: Grid checkbox changed to ${checked}`);
    
    // First update the state in useScene
    setShowGrid(!!checked);
    
    // Then directly update the object if possible for immediate feedback
    if (scene) {
      const gridHelper = scene.children.find(child => child.name === 'gridHelper');
      if (gridHelper) {
        console.log(`ViewOptions: Directly updating grid helper to ${checked}`);
        gridHelper.visible = checked;
        
        // Force render if possible
        if (renderer && camera) {
          renderer.render(scene, camera);
        }
      }
    }
    
    // Also dispatch our own event as an extra measure
    window.dispatchEvent(new CustomEvent('view-option-changed', { 
      detail: { type: 'grid', value: checked }
    }));
  };
  
  const handleAxesVisibilityChange = (checked: boolean) => {
    console.log(`ViewOptions: Axes checkbox changed to ${checked}`);
    
    // First update the state in useScene
    setShowAxes(!!checked);
    
    // Then directly update the object if possible for immediate feedback
    if (scene) {
      const axesHelper = scene.children.find(child => child.name === 'axesHelper');
      if (axesHelper) {
        console.log(`ViewOptions: Directly updating axes helper to ${checked}`);
        axesHelper.visible = checked;
        
        // Force render if possible
        if (renderer && camera) {
          renderer.render(scene, camera);
        }
      }
    }
    
    // Also dispatch our own event as an extra measure
    window.dispatchEvent(new CustomEvent('view-option-changed', { 
      detail: { type: 'axes', value: checked }
    }));
  };

  return (
    <div className="p-4 border-t">
      <h3 className="text-lg font-semibold mb-4">View Options</h3>
      
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={cameraView === 'top' ? 'default' : 'outline'}
            className="w-full"
            onClick={() => setCameraView('top')}
          >
            Top
          </Button>
          <Button
            variant={cameraView === 'front' ? 'default' : 'outline'}
            className="w-full"
            onClick={() => setCameraView('front')}
          >
            Front
          </Button>
          <Button
            variant={cameraView === 'side' ? 'default' : 'outline'}
            className="w-full"
            onClick={() => setCameraView('side')}
          >
            Side
          </Button>
          <Button
            variant={cameraView === 'isometric' ? 'default' : 'outline'}
            className="w-full"
            onClick={() => setCameraView('isometric')}
          >
            Isometric
          </Button>
        </div>
        
        <div className="space-y-2 pt-2">
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="show-grid" 
              checked={showGrid}
              onCheckedChange={handleGridVisibilityChange}
            />
            <Label htmlFor="show-grid" onClick={() => handleGridVisibilityChange(!showGrid)}>
              Show Grid
            </Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="show-axes" 
              checked={showAxes}
              onCheckedChange={handleAxesVisibilityChange}
            />
            <Label htmlFor="show-axes" onClick={() => handleAxesVisibilityChange(!showAxes)}>
              Show Axes
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
} 