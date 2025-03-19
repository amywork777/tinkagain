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

  // Functions to handle visibility changes
  const handleGridVisibilityChange = (checked: boolean) => {
    console.log(`ViewOptions: Grid checkbox changed to ${checked}`);
    
    // Cast to boolean in case we get undefined
    const isChecked = !!checked;
    
    // Update through the scene hook - this is the main source of truth
    setShowGrid(isChecked);
    
    // Dispatch a scene-update event to ensure Viewport component handles it
    window.dispatchEvent(new CustomEvent('scene-update', { 
      detail: { type: 'grid-visibility', value: isChecked }
    }));
    
    // Force render on this frame
    if (scene && renderer && camera) {
      // Find and update grid directly as a backup method
      const gridHelper = scene.children.find(child => child.name === 'gridHelper');
      if (gridHelper) {
        gridHelper.visible = isChecked;
        renderer.render(scene, camera);
      }
      
      // Schedule additional renders to ensure it takes effect (helps with race conditions)
      setTimeout(() => {
        if (renderer && camera && scene) {
          renderer.render(scene, camera);
        }
      }, 50);
    }
  };
  
  const handleAxesVisibilityChange = (checked: boolean) => {
    console.log(`ViewOptions: Axes checkbox changed to ${checked}`);
    
    // Cast to boolean in case we get undefined
    const isChecked = !!checked;
    
    // Update through the scene hook - this is the main source of truth
    setShowAxes(isChecked);
    
    // Dispatch a scene-update event to ensure Viewport component handles it
    window.dispatchEvent(new CustomEvent('scene-update', { 
      detail: { type: 'axes-visibility', value: isChecked }
    }));
    
    // Force render on this frame
    if (scene && renderer && camera) {
      // Find and update axes directly as a backup method
      const axesHelper = scene.children.find(child => child.name === 'axesHelper');
      if (axesHelper) {
        axesHelper.visible = isChecked;
        renderer.render(scene, camera);
      }
      
      // Schedule additional renders to ensure it takes effect (helps with race conditions)
      setTimeout(() => {
        if (renderer && camera && scene) {
          renderer.render(scene, camera);
        }
      }, 50);
    }
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
            <Label htmlFor="show-grid">
              Show Grid
            </Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="show-axes" 
              checked={showAxes}
              onCheckedChange={handleAxesVisibilityChange}
            />
            <Label htmlFor="show-axes">
              Show Axes
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
} 