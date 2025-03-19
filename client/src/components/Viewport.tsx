import { useEffect, useRef, useState, useCallback } from "react";
import { useScene } from "@/hooks/use-scene";
import { ViewCube } from "./ViewCube";
import { TransformGizmo } from "./TransformGizmo";

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { 
    scene, 
    camera, 
    renderer, 
    initializeScene, 
    models, 
    selectedModelIndex,
    cameraView,
    showGrid,
    showAxes,
    setCameraView
  } = useScene();
  
  // Initialize scene when component mounts
  useEffect(() => {
    if (!containerRef.current) return;
    
    console.log("Setting up 3D viewport...");
    
    // Initialize the scene with our container element
    const cleanup = initializeScene(containerRef.current);
    
    // Clean up when component unmounts
    return cleanup;
  }, [initializeScene]);

  // Add debug listener for mouse movement
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    
    // Debug mouse events
    const handleMouseMove = (e: MouseEvent) => {
      // Don't log to avoid console spam
      // console.log("Mouse move in viewport", e.clientX, e.clientY);
    };

    const handleMouseDown = (e: MouseEvent) => {
      console.log("Mouse down in viewport", e.clientX, e.clientY);
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mousedown', handleMouseDown);
    
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mousedown', handleMouseDown);
    };
  }, [containerRef.current]);

  // Update camera position when camera view changes
  useEffect(() => {
    if (!camera) return;
    
    console.log(`Changing camera view to: ${cameraView}`);
    
    switch (cameraView) {
      case 'top':
        camera.position.set(0, 50, 0);
        camera.lookAt(0, 0, 0);
        break;
      case 'bottom':
        camera.position.set(0, -50, 0);
        camera.lookAt(0, 0, 0);
        break;  
      case 'front':
        camera.position.set(0, 0, 50);
        camera.lookAt(0, 0, 0);
        break;
      case 'back':
        camera.position.set(0, 0, -50);
        camera.lookAt(0, 0, 0);
        break;
      case 'right':
        camera.position.set(50, 0, 0);
        camera.lookAt(0, 0, 0);
        break;
      case 'left':
        camera.position.set(-50, 0, 0);
        camera.lookAt(0, 0, 0);
        break;
      case 'isometric':
        camera.position.set(30, 30, 30);
        camera.lookAt(0, 0, 0);
        break;
    }
    
    // Force renderer update
    if (renderer) {
      renderer.render(scene, camera);
    }
  }, [cameraView, camera, renderer, scene]);

  // Handle direct updates to grid and axes visibility in one effect
  useEffect(() => {
    if (!scene) return;
    
    // Direct update to helper objects
    const updateSceneHelpers = () => {
      console.log("Viewport: Checking all helper visibility states");
      
      // Grid visibility - find and update
      const gridHelper = scene.children.find(child => child.name === 'gridHelper');
      if (gridHelper) {
        // Force override visibility to match current state
        if (gridHelper.visible !== showGrid) {
          console.log(`Viewport: Updating grid visibility to match state: ${showGrid}`);
          gridHelper.visible = showGrid;
        }
      } else {
        console.warn('Viewport: No grid helper found in scene!');
        
        // Try to create one if missing
        const newGridHelper = new THREE.GridHelper(500, 100);
        newGridHelper.name = 'gridHelper';
        newGridHelper.visible = showGrid;
        newGridHelper.position.y = -25;
        scene.add(newGridHelper);
        console.log(`Viewport: Created new grid helper with visibility: ${showGrid}`);
      }
      
      // Axes visibility - find and update
      const axesHelper = scene.children.find(child => child.name === 'axesHelper');
      if (axesHelper) {
        // Force override visibility to match current state
        if (axesHelper.visible !== showAxes) {
          console.log(`Viewport: Updating axes visibility to match state: ${showAxes}`);
          axesHelper.visible = showAxes;
        }
      } else {
        console.warn('Viewport: No axes helper found in scene!');
        
        // Try to create one if missing
        const newAxesHelper = new THREE.AxesHelper(250);
        newAxesHelper.name = 'axesHelper';
        newAxesHelper.visible = showAxes;
        scene.add(newAxesHelper);
        console.log(`Viewport: Created new axes helper with visibility: ${showAxes}`);
      }
      
      // Force render
      if (renderer && camera) {
        renderer.render(scene, camera);
        
        // Schedule additional renders to ensure it takes effect
        [50, 150, 300, 500].forEach(delay => {
          setTimeout(() => {
            if (renderer && camera && scene) {
              renderer.render(scene, camera);
            }
          }, delay);
        });
      }
    };
    
    // Run immediately
    updateSceneHelpers();
    
    // Also add a general scene update listener
    const handleSceneUpdate = (event: any) => {
      // React to specific update types
      if (event.detail.type === 'grid-visibility' || event.detail.type === 'axes-visibility') {
        console.log(`Viewport: Received scene update event: ${event.detail.type}=${event.detail.value}`);
        
        // Force a render update
        if (renderer && camera) {
          // Find and update all scene helpers
          updateSceneHelpers();
        }
      }
    };
    
    // Listen for scene updates
    window.addEventListener('scene-update', handleSceneUpdate);
    
    // Set up an animation loop that keeps checking visibility
    const visibilityCheckInterval = setInterval(() => {
      // Find helpers and ensure their visibility matches the state
      const gridHelper = scene?.children.find(child => child.name === 'gridHelper');
      const axesHelper = scene?.children.find(child => child.name === 'axesHelper');
      
      let needsRender = false;
      
      if (gridHelper && gridHelper.visible !== showGrid) {
        console.log(`Viewport: Fixing grid visibility from interval: ${gridHelper.visible} → ${showGrid}`);
        gridHelper.visible = showGrid;
        needsRender = true;
      }
      
      if (axesHelper && axesHelper.visible !== showAxes) {
        console.log(`Viewport: Fixing axes visibility from interval: ${axesHelper.visible} → ${showAxes}`);
        axesHelper.visible = showAxes;
        needsRender = true;
      }
      
      if (needsRender && renderer && camera && scene) {
        renderer.render(scene, camera);
      }
    }, 500); // Check every 500ms
    
    // Cleanup
    return () => {
      window.removeEventListener('scene-update', handleSceneUpdate);
      clearInterval(visibilityCheckInterval);
    };
  }, [showGrid, showAxes, scene, renderer, camera]);

  return (
    <div className="w-full h-full bg-background relative overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
      
      <ViewCube />
      
      {/* Make sure TransformGizmo is the last component added */}
      <TransformGizmo />
    </div>
  );
}