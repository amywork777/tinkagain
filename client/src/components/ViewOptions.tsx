import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useScene } from "@/hooks/use-scene";
import * as THREE from 'three';

export function ViewOptions() {
  const scene = useScene(state => state.scene);
  const renderer = useScene(state => state.renderer);
  const camera = useScene(state => state.camera);
  const cameraView = useScene(state => state.cameraView);
  const setCameraView = useScene(state => state.setCameraView);
  const showGrid = useScene(state => state.showGrid);
  const setShowGrid = useScene(state => state.setShowGrid);
  const showAxes = useScene(state => state.showAxes);
  const setShowAxes = useScene(state => state.setShowAxes);

  // Ultra-direct handlers that focus on updating the Three.js objects first
  const handleGridVisibilityChange = (checked: boolean) => {
    console.log(`ViewOptions: DIRECT Grid checkbox changed to ${checked}`);
    
    // Convert to bool to handle undefined/null
    const newVisibility = !!checked;
    
    // APPROACH 1: Find and directly update the grid in the scene first
    if (scene) {
      let gridHelper = scene.children.find(child => child.name === 'gridHelper');
      
      // If not found, create it
      if (!gridHelper) {
        console.log("Grid helper not found, creating new one");
        gridHelper = new THREE.GridHelper(500, 100);
        gridHelper.name = 'gridHelper';
        gridHelper.position.y = -25;
        scene.add(gridHelper);
      }
      
      // Set visibility directly on Three.js object
      console.log(`Directly setting grid visibility to ${newVisibility}`);
      gridHelper.visible = newVisibility;
      
      // Force immediate render
      if (renderer && camera) {
        console.log("Forcing immediate render for grid change");
        renderer.render(scene, camera);
      }
    }
    
    // APPROACH 2: Update Zustand state through hook
    console.log(`Setting grid state to ${newVisibility}`);
    setShowGrid(newVisibility);
    
    // APPROACH 3: Broadcast event for any other listeners
    console.log("Broadcasting grid visibility change event");
    window.dispatchEvent(new CustomEvent('grid-visibility-changed', { 
      detail: { visible: newVisibility }
    }));
    
    // APPROACH 4: Schedule follow-up renders to ensure changes stick
    if (renderer && camera && scene) {
      [50, 100, 300, 1000].forEach(delay => {
        setTimeout(() => {
          console.log(`Follow-up render at ${delay}ms`);
          // Re-find the helper in case it was recreated
          const helper = scene.children.find(child => child.name === 'gridHelper');
          if (helper) {
            helper.visible = newVisibility;
          }
          renderer.render(scene, camera);
        }, delay);
      });
    }
  };
  
  const handleAxesVisibilityChange = (checked: boolean) => {
    console.log(`ViewOptions: DIRECT Axes checkbox changed to ${checked}`);
    
    // Convert to bool to handle undefined/null
    const newVisibility = !!checked;
    
    // APPROACH 1: Find and directly update the axes in the scene first
    if (scene) {
      let axesHelper = scene.children.find(child => child.name === 'axesHelper');
      
      // If not found, create it
      if (!axesHelper) {
        console.log("Axes helper not found, creating new one");
        axesHelper = new THREE.AxesHelper(250);
        axesHelper.name = 'axesHelper';
        scene.add(axesHelper);
      }
      
      // Set visibility directly on Three.js object
      console.log(`Directly setting axes visibility to ${newVisibility}`);
      axesHelper.visible = newVisibility;
      
      // Force immediate render
      if (renderer && camera) {
        console.log("Forcing immediate render for axes change");
        renderer.render(scene, camera);
      }
    }
    
    // APPROACH 2: Update Zustand state through hook
    console.log(`Setting axes state to ${newVisibility}`);
    setShowAxes(newVisibility);
    
    // APPROACH 3: Broadcast event for any other listeners
    console.log("Broadcasting axes visibility change event");
    window.dispatchEvent(new CustomEvent('axes-visibility-changed', { 
      detail: { visible: newVisibility }
    }));
    
    // APPROACH 4: Schedule follow-up renders to ensure changes stick
    if (renderer && camera && scene) {
      [50, 100, 300, 1000].forEach(delay => {
        setTimeout(() => {
          console.log(`Follow-up render at ${delay}ms`);
          // Re-find the helper in case it was recreated
          const helper = scene.children.find(child => child.name === 'axesHelper');
          if (helper) {
            helper.visible = newVisibility;
          }
          renderer.render(scene, camera);
        }, delay);
      });
    }
  };

  // EMERGENCY DIRECT HANDLERS
  const toggleGridDirectly = () => {
    // Log action
    console.log("EMERGENCY DIRECT GRID TOGGLE");
    
    // Use a function to get latest state when called
    const scene = useScene.getState().scene;
    const currentShowGrid = useScene.getState().showGrid;
    
    if (!scene) {
      console.error("No scene available for direct toggle");
      return;
    }
    
    // Toggle state
    const newVisibility = !currentShowGrid;
    
    // 1. Find the grid helper
    let gridHelper = scene.children.find(child => child.name === 'gridHelper');
    
    // Create if missing
    if (!gridHelper) {
      console.log("Creating grid helper for emergency toggle");
      gridHelper = new THREE.GridHelper(500, 100);
      gridHelper.name = 'gridHelper';
      gridHelper.position.y = -25; 
      scene.add(gridHelper);
    }
    
    // 2. Set visibility directly
    gridHelper.visible = newVisibility;
    
    // 3. Update state
    useScene.getState().setShowGrid(newVisibility);
    
    // 4. Force rendering
    const renderer = useScene.getState().renderer;
    const camera = useScene.getState().camera;
    if (renderer && camera) {
      renderer.render(scene, camera);
    }
  };
  
  const toggleAxesDirectly = () => {
    // Log action
    console.log("EMERGENCY DIRECT AXES TOGGLE");
    
    // Use a function to get latest state when called
    const scene = useScene.getState().scene;
    const currentShowAxes = useScene.getState().showAxes;
    
    if (!scene) {
      console.error("No scene available for direct toggle");
      return;
    }
    
    // Toggle state
    const newVisibility = !currentShowAxes;
    
    // 1. Find the axes helper
    let axesHelper = scene.children.find(child => child.name === 'axesHelper');
    
    // Create if missing
    if (!axesHelper) {
      console.log("Creating axes helper for emergency toggle");
      axesHelper = new THREE.AxesHelper(250);
      axesHelper.name = 'axesHelper';
      scene.add(axesHelper);
    }
    
    // 2. Set visibility directly
    axesHelper.visible = newVisibility;
    
    // 3. Update state
    useScene.getState().setShowAxes(newVisibility);
    
    // 4. Force rendering
    const renderer = useScene.getState().renderer;
    const camera = useScene.getState().camera;
    if (renderer && camera) {
      renderer.render(scene, camera);
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
          {/* Direct checkbox implementation with simpler pattern */}
          <div 
            className="flex items-center space-x-2" 
            onClick={() => handleGridVisibilityChange(!showGrid)}
          >
            <Checkbox 
              id="show-grid" 
              checked={showGrid}
              onCheckedChange={handleGridVisibilityChange}
            />
            <Label 
              htmlFor="show-grid" 
              className="cursor-pointer"
            >
              Show Grid
            </Label>
          </div>
          
          <div 
            className="flex items-center space-x-2"
            onClick={() => handleAxesVisibilityChange(!showAxes)}
          >
            <Checkbox 
              id="show-axes" 
              checked={showAxes}
              onCheckedChange={handleAxesVisibilityChange}
            />
            <Label 
              htmlFor="show-axes"
              className="cursor-pointer"
            >
              Show Axes
            </Label>
          </div>
          
          {/* Emergency direct buttons as fallback - no state dependency */}
          <div className="mt-3 border-t pt-3">
            <h4 className="text-xs text-gray-500 mb-2">If toggles don't work, use these:</h4>
            <div className="grid grid-cols-2 gap-2">
              <Button 
                variant="outline" 
                size="sm"
                className="text-xs"
                onClick={toggleGridDirectly}
              >
                Toggle Grid
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                className="text-xs"
                onClick={toggleAxesDirectly}
              >
                Toggle Axes
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 