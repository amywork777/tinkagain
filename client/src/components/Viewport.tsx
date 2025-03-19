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

  // Toggle grid visibility - with improved handling
  useEffect(() => {
    if (!scene) return;
    
    // Function to update grid visibility
    const updateGridVisibility = () => {
      // Find the grid helper in the scene
      const gridHelper = scene.children.find(child => child.name === 'gridHelper');
      
      if (gridHelper) {
        console.log(`Viewport: Setting grid visibility to: ${showGrid}`);
        gridHelper.visible = showGrid;
        
        // Force renderer update - multiple times for reliability
        if (renderer && camera) {
          console.log(`Viewport: Rendering scene for grid update`);
          renderer.render(scene, camera);
          
          // Schedule multiple renders with different delays to ensure it works
          setTimeout(() => {
            if (renderer && camera && scene) {
              console.log(`Viewport: Re-rendering scene for grid (50ms)`);
              renderer.render(scene, camera);
            }
          }, 50);
          
          setTimeout(() => {
            if (renderer && camera && scene) {
              console.log(`Viewport: Re-rendering scene for grid (150ms)`);
              renderer.render(scene, camera);
            }
          }, 150);
        }
      } else {
        console.warn('Viewport: Grid helper not found in scene');
      }
    };
    
    // Update immediately
    updateGridVisibility();
    
    // Also add event listener for updates from outside
    const handleGridVisibilityEvent = (event: any) => {
      console.log(`Viewport: Received grid visibility event: ${event.detail.visible}`);
      if (scene && renderer && camera) {
        // Find and update the grid helper
        const gridHelper = scene.children.find(child => child.name === 'gridHelper');
        if (gridHelper) {
          gridHelper.visible = event.detail.visible;
          renderer.render(scene, camera);
        }
      }
    };
    
    window.addEventListener('grid-visibility-changed', handleGridVisibilityEvent);
    
    // Cleanup
    return () => {
      window.removeEventListener('grid-visibility-changed', handleGridVisibilityEvent);
    };
  }, [showGrid, scene, renderer, camera]);

  // Toggle axes visibility - with improved handling
  useEffect(() => {
    if (!scene) return;
    
    // Function to update axes visibility
    const updateAxesVisibility = () => {
      // Find the axes helper in the scene
      const axesHelper = scene.children.find(child => child.name === 'axesHelper');
      
      if (axesHelper) {
        console.log(`Viewport: Setting axes visibility to: ${showAxes}`);
        axesHelper.visible = showAxes;
        
        // Force renderer update - multiple times for reliability
        if (renderer && camera) {
          console.log(`Viewport: Rendering scene for axes update`);
          renderer.render(scene, camera);
          
          // Schedule multiple renders with different delays to ensure it works
          setTimeout(() => {
            if (renderer && camera && scene) {
              console.log(`Viewport: Re-rendering scene for axes (50ms)`);
              renderer.render(scene, camera);
            }
          }, 50);
          
          setTimeout(() => {
            if (renderer && camera && scene) {
              console.log(`Viewport: Re-rendering scene for axes (150ms)`);
              renderer.render(scene, camera);
            }
          }, 150);
        }
      } else {
        console.warn('Viewport: Axes helper not found in scene');
      }
    };
    
    // Update immediately
    updateAxesVisibility();
    
    // Also add event listener for updates from outside
    const handleAxesVisibilityEvent = (event: any) => {
      console.log(`Viewport: Received axes visibility event: ${event.detail.visible}`);
      if (scene && renderer && camera) {
        // Find and update the axes helper
        const axesHelper = scene.children.find(child => child.name === 'axesHelper');
        if (axesHelper) {
          axesHelper.visible = event.detail.visible;
          renderer.render(scene, camera);
        }
      }
    };
    
    window.addEventListener('axes-visibility-changed', handleAxesVisibilityEvent);
    
    // Cleanup
    return () => {
      window.removeEventListener('axes-visibility-changed', handleAxesVisibilityEvent);
    };
  }, [showAxes, scene, renderer, camera]);

  return (
    <div className="w-full h-full bg-background relative overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
      
      <ViewCube />
      
      {/* Make sure TransformGizmo is the last component added */}
      <TransformGizmo />
    </div>
  );
}