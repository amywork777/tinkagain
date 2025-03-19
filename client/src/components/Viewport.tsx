import { useEffect, useRef, useState, useCallback } from "react";
import { useScene } from "@/hooks/use-scene";
import { ViewCube } from "./ViewCube";
import { TransformGizmo } from "./TransformGizmo";
import * as THREE from 'three';

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Use individual selectors for better performance and to prevent unnecessary rerenders
  const scene = useScene(state => state.scene);
  const camera = useScene(state => state.camera); 
  const renderer = useScene(state => state.renderer);
  const initializeScene = useScene(state => state.initializeScene);
  const models = useScene(state => state.models);
  const selectedModelIndex = useScene(state => state.selectedModelIndex);
  const cameraView = useScene(state => state.cameraView);
  const setCameraView = useScene(state => state.setCameraView);
  
  // Grid and axes visibility are extremely important
  const showGrid = useScene(state => state.showGrid);
  const showAxes = useScene(state => state.showAxes);
  
  // Initialize scene when component mounts
  useEffect(() => {
    if (!containerRef.current) return;
    
    console.log("Setting up 3D viewport...");
    
    // Initialize the scene with our container element
    const cleanup = initializeScene(containerRef.current);
    
    // Clean up when component unmounts
    return cleanup;
  }, [initializeScene]);
  
  // Process Boolean operations and grid/axes visibility during rendering
  useEffect(() => {
    if (!scene || !renderer || !camera) return;
    
    console.log("Setting up custom render processor with grid/axes enforcer");
    
    // Create a custom render function
    const originalRender = renderer.render.bind(renderer);
    
    // Override the render method to enforce visibility and process operations
    renderer.render = function(scene, camera) {
      // First, enforce grid and axes visibility EVERY frame
      enforceHelperVisibility(scene);
      
      // Process any boolean operations in the scene
      processBooleanOperations(scene);
      
      // Call the original render method
      originalRender(scene, camera);
    };
    
    // Enforce grid and axes visibility on every frame
    function enforceHelperVisibility(scene: THREE.Scene) {
      // Get the current state directly for critical values - ALWAYS get fresh state
      const useSceneState = useScene.getState();
      const currentShowGrid = useSceneState.showGrid;
      const currentShowAxes = useSceneState.showAxes;
      
      // Log visibility state for debugging
      // console.log(`Enforcing helper visibility - Grid: ${currentShowGrid}, Axes: ${currentShowAxes}`);
      
      // ULTRA-RELIABLE GRID IMPLEMENTATION
      // GRID HELPER - Find or create
      let gridHelper: THREE.Object3D | undefined = scene.children.find(child => child.name === 'gridHelper');
      
      // If not found, create it with proper visibility
      if (!gridHelper) {
        console.log('Creating missing grid helper during render');
        gridHelper = new THREE.GridHelper(500, 100);
        gridHelper.name = 'gridHelper';
        gridHelper.position.y = -25;
        gridHelper.visible = currentShowGrid; // Set initial visibility correctly
        scene.add(gridHelper);
      } else {
        // Always enforce current state if existing
        if (gridHelper.visible !== currentShowGrid) {
          console.log(`Correcting grid visibility from ${gridHelper.visible} to ${currentShowGrid}`);
          gridHelper.visible = currentShowGrid;
        }
      }
      
      // ULTRA-RELIABLE AXES IMPLEMENTATION
      // AXES HELPER - Find or create
      let axesHelper: THREE.Object3D | undefined = scene.children.find(child => child.name === 'axesHelper');
      
      // If not found, create it with proper visibility
      if (!axesHelper) {
        console.log('Creating missing axes helper during render');
        axesHelper = new THREE.AxesHelper(250);
        axesHelper.name = 'axesHelper';
        axesHelper.visible = currentShowAxes; // Set initial visibility correctly
        scene.add(axesHelper);
      } else {
        // Always enforce current state if existing
        if (axesHelper.visible !== currentShowAxes) {
          console.log(`Correcting axes visibility from ${axesHelper.visible} to ${currentShowAxes}`);
          axesHelper.visible = currentShowAxes;
        }
      }
      
      // Set a special flag to force re-render if needed
      scene.userData.visibilityUpdated = Date.now();
    }
    
    // Process boolean operations before rendering
    function processBooleanOperations(scene: THREE.Scene) {
      // Traverse all objects in the scene
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        
        // Handle mesh with boolean operation metadata
        if (object.userData && object.userData.booleanType) {
          switch(object.userData.booleanType) {
            case 'subtract':
              // Visual-only subtraction
              break;
              
            case 'intersect':
              // For parent meshes with intersect type
              if (object.children && object.children.length > 0) {
                // Process the children for intersection visualization
              }
              break;
          }
        }
      });
    }
    
    // Call render once to update the scene and trigger our overrides
    console.log("Triggering initial render with enforced visibility");
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
      
      // GRID HELPER - Check for duplicates and maintain only one
      // Check for ANY grid helpers - not just those named 'gridHelper'
      const allGridHelpers = scene.children.filter(child => 
        child.name === 'gridHelper' || 
        child.type === 'GridHelper' ||
        (child.constructor && child.constructor.name === 'GridHelper')
      );
      
      // If we have more than one grid, remove all except the first one
      if (allGridHelpers.length > 1) {
        console.warn(`Viewport: Found ${allGridHelpers.length} grid helpers - removing duplicates`);
        // Keep only the first grid
        for (let i = 1; i < allGridHelpers.length; i++) {
          console.log(`Removing duplicate grid helper: ${allGridHelpers[i].uuid}`);
          scene.remove(allGridHelpers[i]);
        }
      }
      
      // Use the first grid if available, or create a new one if needed
      let gridHelper = allGridHelpers[0];
      
      // Create grid helper if missing
      if (!gridHelper) {
        console.log('Viewport: Creating new grid helper');
        gridHelper = new THREE.GridHelper(500, 100);
        gridHelper.name = 'gridHelper';
        gridHelper.position.y = -25;
        scene.add(gridHelper);
      } else {
        // Ensure the grid always has the correct name
        gridHelper.name = 'gridHelper';
      }
      
      // Always set visibility to match state value
      if (gridHelper.visible !== showGrid || forceUpdate) {
        console.log(`Viewport: Setting grid visibility to ${showGrid}`);
        gridHelper.visible = showGrid;
      }
      
      // AXES HELPER - Check for duplicates and maintain only one
      // Check for ANY axes helpers - not just those named 'axesHelper'
      const allAxesHelpers = scene.children.filter(child => 
        child.name === 'axesHelper' || 
        child.type === 'AxesHelper' ||
        (child.constructor && child.constructor.name === 'AxesHelper')
      );
      
      // If we have more than one axes, remove all except the first one
      if (allAxesHelpers.length > 1) {
        console.warn(`Viewport: Found ${allAxesHelpers.length} axes helpers - removing duplicates`);
        // Keep only the first axes
        for (let i = 1; i < allAxesHelpers.length; i++) {
          console.log(`Removing duplicate axes helper: ${allAxesHelpers[i].uuid}`);
          scene.remove(allAxesHelpers[i]);
        }
      }
      
      // Use the first axes if available, or create a new one if needed
      let axesHelper = allAxesHelpers[0];
      
      // Create axes helper if missing
      if (!axesHelper) {
        console.log('Viewport: Creating new axes helper');
        axesHelper = new THREE.AxesHelper(250);
        axesHelper.name = 'axesHelper';
        scene.add(axesHelper);
      } else {
        // Ensure the axes always has the correct name
        axesHelper.name = 'axesHelper';
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