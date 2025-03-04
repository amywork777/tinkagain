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

  // Toggle grid visibility
  useEffect(() => {
    if (!scene) return;
    
    // Find the grid helper in the scene
    const gridHelper = scene.children.find(child => child.name === 'gridHelper');
    
    if (gridHelper) {
      gridHelper.visible = showGrid;
      
      // Force renderer update
      if (renderer && camera) {
        renderer.render(scene, camera);
      }
    }
  }, [showGrid, scene, renderer, camera]);

  // Toggle axes visibility
  useEffect(() => {
    if (!scene) return;
    
    // Find the axes helper in the scene
    const axesHelper = scene.children.find(child => child.name === 'axesHelper');
    
    if (axesHelper) {
      if (showAxes) {
        scene.add(axesHelper);
      } else {
        scene.remove(axesHelper);
      }
      
      // Force renderer update
      if (renderer && camera) {
        renderer.render(scene, camera);
      }
    }
  }, [showAxes, scene, renderer, camera]);

  return (
    <div className="w-full h-full bg-background relative overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />
      
      <ViewCube />
      
      {models.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center bg-background/80 backdrop-blur-sm p-6 rounded-lg max-w-md">
            <h3 className="text-2xl font-bold mb-2">Your Canvas Awaits</h3>
            <p className="text-muted-foreground mb-4">
              Add a shape from the sidebar or import an STL file to get started
            </p>
          </div>
        </div>
      )}
      
      {/* Make sure TransformGizmo is the last component added */}
      <TransformGizmo />
    </div>
  );
}