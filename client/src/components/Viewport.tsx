import { useEffect, useRef, useState, useCallback } from "react";
import { useScene } from "@/hooks/use-scene";
import { ViewCube } from "./ViewCube";
import { TransformGizmo } from "./TransformGizmo";
import * as THREE from 'three';

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
  
  // Process Boolean operations during rendering
  useEffect(() => {
    if (!scene || !renderer || !camera) return;
    
    console.log("Setting up Boolean operation rendering processor");
    
    // Create a custom render function that will process boolean operations
    const originalRender = renderer.render.bind(renderer);
    
    // Override the render method to process boolean operations
    renderer.render = function(scene, camera) {
      // Process any boolean operations in the scene
      processBooleanOperations(scene);
      
      // Call the original render method
      originalRender(scene, camera);
    };
    
    // Process boolean operations before rendering
    function processBooleanOperations(scene: THREE.Scene) {
      // Traverse all objects in the scene
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        
        // Handle mesh with boolean operation metadata
        if (object.userData && object.userData.booleanType) {
          switch(object.userData.booleanType) {
            case 'subtract':
              // Visual-only subtraction (for future implementation with shaders/clipping)
              // For now, just ensure the mesh is visible
              break;
              
            case 'intersect':
              // For parent meshes with intersect type (containing both meshes)
              if (object.children && object.children.length > 0) {
                // Process the children for intersection visualization
                // (Future implementation with stencil buffers/shader effects)
              }
              break;
          }
        }
      });
    }
    
    // Call render once to update the scene
    renderer.render(scene, camera);
    
    // Return cleanup function to restore original render method
    return () => {
      if (renderer) {
        renderer.render = originalRender;
      }
    };
  }, [scene, renderer, camera]);

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

  // Handle direct updates to grid and axes visibility with improved reliability
  useEffect(() => {
    if (!scene) return;
    
    console.log(`Viewport: showGrid=${showGrid}, showAxes=${showAxes} - Initializing or values changed`);
    
    // Direct update to helper objects - robust implementation with priority, redundancy
    const updateSceneHelpers = (forceUpdate = false) => {
      console.log(`Viewport: Updating helpers - Grid: ${showGrid}, Axes: ${showAxes}, Force: ${forceUpdate}`);
      
      // GRID HELPER
      let gridHelper = scene.children.find(child => child.name === 'gridHelper');
      
      // Create grid helper if missing
      if (!gridHelper) {
        console.log('Viewport: Creating new grid helper');
        gridHelper = new THREE.GridHelper(500, 100);
        gridHelper.name = 'gridHelper';
        gridHelper.position.y = -25;
        scene.add(gridHelper);
      }
      
      // Always set visibility to match state value
      if (gridHelper.visible !== showGrid || forceUpdate) {
        console.log(`Viewport: Setting grid visibility to ${showGrid}`);
        gridHelper.visible = showGrid;
      }
      
      // AXES HELPER
      let axesHelper = scene.children.find(child => child.name === 'axesHelper');
      
      // Create axes helper if missing
      if (!axesHelper) {
        console.log('Viewport: Creating new axes helper');
        axesHelper = new THREE.AxesHelper(250);
        axesHelper.name = 'axesHelper';
        scene.add(axesHelper);
      }
      
      // Always set visibility to match state value
      if (axesHelper.visible !== showAxes || forceUpdate) {
        console.log(`Viewport: Setting axes visibility to ${showAxes}`);
        axesHelper.visible = showAxes;
      }
      
      // RENDER - Schedule multiple renders for maximum reliability
      if (renderer && camera) {
        // Immediate render
        renderer.render(scene, camera);
        
        // Multiple delayed renders at different times
        [20, 100, 300, 500].forEach(delay => {
          setTimeout(() => {
            if (renderer && camera && scene) {
              // Double-check the visibility just before rendering
              if (gridHelper && gridHelper.visible !== showGrid) {
                gridHelper.visible = showGrid;
              }
              if (axesHelper && axesHelper.visible !== showAxes) {
                axesHelper.visible = showAxes;
              }
              renderer.render(scene, camera);
            }
          }, delay);
        });
      }
    };
    
    // Run immediately when effect is triggered
    updateSceneHelpers(true);
    
    // Scene update listener - Handle events from other components
    const handleSceneUpdate = (event: any) => {
      console.log(`Viewport: Received event: ${event.type}, detail:`, event.detail);
      
      if (event.detail?.type === 'grid-visibility' || event.detail?.type === 'axes-visibility') {
        // Enforce a render update
        updateSceneHelpers(true);
      }
    };
    
    // Listen for ALL relevant events that might affect visibility
    window.addEventListener('scene-update', handleSceneUpdate);
    window.addEventListener('view-option-changed', handleSceneUpdate);
    
    // Polling backup - Keep checking visibility status
    const visibilityCheckInterval = setInterval(() => {
      const currentGridHelper = scene.children.find(child => child.name === 'gridHelper');
      const currentAxesHelper = scene.children.find(child => child.name === 'axesHelper');
      
      let needsCorrection = false;
      
      // Check grid visibility
      if (currentGridHelper && currentGridHelper.visible !== showGrid) {
        console.log(`Viewport: Fixing grid visibility via interval: ${currentGridHelper.visible} → ${showGrid}`);
        currentGridHelper.visible = showGrid;
        needsCorrection = true;
      }
      
      // Check axes visibility
      if (currentAxesHelper && currentAxesHelper.visible !== showAxes) {
        console.log(`Viewport: Fixing axes visibility via interval: ${currentAxesHelper.visible} → ${showAxes}`);
        currentAxesHelper.visible = showAxes;
        needsCorrection = true;
      }
      
      // Render if needed
      if (needsCorrection && renderer && camera) {
        renderer.render(scene, camera);
      }
    }, 250); // Check more frequently for maximum responsiveness
    
    // Cleanup all resources
    return () => {
      window.removeEventListener('scene-update', handleSceneUpdate);
      window.removeEventListener('view-option-changed', handleSceneUpdate);
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