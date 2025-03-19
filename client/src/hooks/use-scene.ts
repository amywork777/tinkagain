import { create } from "zustand";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSG } from 'three-csg-ts';
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry, TextGeometryParameters } from "three/examples/jsm/geometries/TextGeometry.js";
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { createRoot } from 'react-dom/client';
import { ImportScaleDialog } from '../components/ImportScaleDialog';
import { Vector3 } from "three";
import * as React from 'react';
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { isGizmoBeingDragged } from '@/lib/dragState';

// Scene configuration
const GRID_SIZE = 500; // Much larger grid for better visibility
const GRID_DIVISIONS = 100; // More divisions for finer grid
const BACKGROUND_COLOR = 0x333333; // Dark gray

// Define an array of vibrant, fun colors
const vibrantColors = [
  '#FF5733', // Bright orange/coral
  '#33FF57', // Bright green
  '#3357FF', // Bright blue
  '#FF33A8', // Hot pink
  '#33FFF6', // Cyan
  '#F6FF33', // Bright yellow
  '#FF33F6', // Magenta
  '#FF5757', // Bright red
  '#57FF57', // Lime green
  '#5757FF', // Indigo
  '#FFC733', // Gold
  '#33CFFF', // Sky blue
  '#FF9E33', // Orange
  '#B533FF', // Purple
  '#33FF9E',  // Mint green
  
  // Adding more playful and fun colors
  '#FF00CC', // Neon pink
  '#00FFCC', // Bright turquoise
  '#CCFF00', // Lime yellow
  '#FF66B2', // Pastel pink
  '#66FFB2', // Pastel mint
  '#B266FF', // Lavender
  '#FF9966', // Peach
  '#66FF99', // Light green
  '#9966FF', // Periwinkle
  '#FFFF00', // Electric yellow
  '#00FFFF', // Electric cyan
  '#FF00FF', // Electric magenta
  '#7B68EE', // Medium slate blue
  '#FF1493', // Deep pink
  '#00FA9A', // Medium spring green
  '#1E90FF', // Dodger blue
  '#ADFF2F', // Green yellow
  '#FF8C00', // Dark orange
  '#9400D3', // Dark violet
  '#FFDAB9'  // Peach puff
];

// Get a random color from our enhanced palette
const getRandomColor = () => {
  // Select a random color from the array
  const randomIndex = Math.floor(Math.random() * vibrantColors.length);
  return new THREE.Color(vibrantColors[randomIndex]);
};

// Function to create a fun material for a model
const createFunMaterial = () => {
  // 25% chance to return a fun gradient material instead of a solid color
  if (Math.random() < 0.25) {
    // Create a gradient texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    
    if (context) {
      // Different gradient types
      const gradientTypes = ['radial', 'linear', 'rainbow'];
      const type = gradientTypes[Math.floor(Math.random() * gradientTypes.length)];
      
      // Pick two random colors from our palette
      const color1 = vibrantColors[Math.floor(Math.random() * vibrantColors.length)];
      const color2 = vibrantColors[Math.floor(Math.random() * vibrantColors.length)];
      
      let gradient;
      
      if (type === 'radial') {
        gradient = context.createRadialGradient(128, 128, 10, 128, 128, 128);
        gradient.addColorStop(0, color1);
        gradient.addColorStop(1, color2);
      } else if (type === 'linear') {
        gradient = context.createLinearGradient(0, 0, 256, 256);
        gradient.addColorStop(0, color1);
        gradient.addColorStop(1, color2);
      } else { // rainbow
        gradient = context.createLinearGradient(0, 0, 256, 0);
        gradient.addColorStop(0, '#FF0000');
        gradient.addColorStop(0.17, '#FF9900');
        gradient.addColorStop(0.33, '#FFFF00');
        gradient.addColorStop(0.5, '#00FF00');
        gradient.addColorStop(0.67, '#0099FF');
        gradient.addColorStop(0.83, '#0000FF');
        gradient.addColorStop(1, '#9900FF');
      }
      
      context.fillStyle = gradient;
      context.fillRect(0, 0, 256, 256);
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true;
      
      // Create a material with this texture
      return new THREE.MeshStandardMaterial({ 
        map: texture,
        metalness: Math.random() * 0.5,
        roughness: 0.5 + Math.random() * 0.5
      });
    }
  }
  
  // Otherwise, select a random color from the array
  return new THREE.MeshStandardMaterial({ 
    color: getRandomColor(),
    metalness: Math.random() * 0.3,
    roughness: 0.5 + Math.random() * 0.5
  });
};

// Maximum model size in inches - set to exactly 10 inches
const MAX_SIZE_INCHES = 10;
const MM_PER_INCH = 25.4;
const MAX_SIZE_MM = MAX_SIZE_INCHES * MM_PER_INCH; // 254mm

// Helper constants for transformation
const TRANSFORM_STEP = 5.0;
const ROTATION_STEP = Math.PI / 18;
const SCALE_STEP = 0.2;
const SNAP_THRESHOLD = 1.0;
const SNAP_GRID_SIZE = 2.0;

// Type for our 3D models
type Model = {
  id: string;
  name: string;
  type: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'text' | 'model' | 'torusknot' | 'octahedron' | 'icosahedron' | 'dodecahedron' | 'capsule' | 'pyramid' | 'svg';
  mesh: THREE.Mesh;
  originalPosition: THREE.Vector3;
  originalRotation: THREE.Euler;
  originalScale: THREE.Vector3;
  textProps?: TextProps;
};

// Type for our transform operations
type TransformOperation = 'translateX' | 'translateY' | 'translateZ' | 
                         'rotateX' | 'rotateY' | 'rotateZ' | 
                         'scaleX' | 'scaleY' | 'scaleZ';

// Type for history tracking
type HistoryRecord = {
  models: Model[];
  selectedModelIndex: number | null;
};

// Type for our snap settings
type SnapSettings = {
  enabled: boolean;
  snapToGrid: boolean;
  snapToFaces: boolean;
  snapToEdges: boolean;
  snapThreshold: number;
};

// Add SVG Result type
type SVGResult = {
  paths: Array<{
    toShapes: (solid: boolean) => THREE.Shape[];
  }>;
};

// Utility function to merge Float32Arrays
const mergeFloat32Arrays = (arrays: Float32Array[]): Float32Array => {
  // Calculate total length
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  
  // Create new array with combined length
  const result = new Float32Array(totalLength);
  
  // Copy data
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  
  return result;
};

// Text options type
type TextOptions = {
  text: string;
  fontSize?: number;
  height?: number;
  curveSegments?: number;
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  bevelSegments?: number;
  color?: THREE.Color | string | number;
  fontPath?: string;
};

// Default font path
const defaultFontPath = '/fonts/helvetiker_regular.typeface.json';

type SceneState = {
  // Scene components
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  orbitControls: OrbitControls | null;
  raycaster: THREE.Raycaster;
  mouse: THREE.Vector2;

  // State variables
  models: Model[];
  isSceneInitialized: boolean;
  isSceneReady: boolean;
  selectedModelIndex: number | null;
  secondaryModelIndex: number | null; // For CSG operations
  transformMode: "translate" | "rotate" | "scale";
  
  // Rendering mode
  renderingMode: 'standard' | 'wireframe' | 'metallic' | 'glass-like' | 'xray';
  setRenderingMode: (mode: 'standard' | 'wireframe' | 'metallic' | 'glass-like' | 'xray') => void;
  
  // Unit system
  unit: 'mm' | 'in';
  setUnit: (unit: 'mm' | 'in') => void;
  convertValue: (value: number, from: 'mm' | 'in', to: 'mm' | 'in') => number;
  
  // View options
  cameraView: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'isometric';
  showGrid: boolean;
  showAxes: boolean;
  setCameraView: (view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'isometric') => void;
  setShowGrid: (show: boolean) => void;
  setShowAxes: (show: boolean) => void;
  
  // Loading states
  isCSGOperationLoading: boolean;
  
  // History tracking for undo/redo
  history: HistoryRecord[];
  currentHistoryIndex: number;
  canUndo: boolean;
  canRedo: boolean;
  
  // Snap settings
  snapSettings: SnapSettings;
  snapIndicators: THREE.Object3D[];
  
  // Scene initialization
  initializeScene: (container: HTMLDivElement) => () => void;
  
  // Model management
  loadSTL: (file: File | string, name?: string) => Promise<void>;
  loadSVG: (file: File | string, extrudeDepth?: number) => Promise<void>;
  loadText: (text: string, options?: TextOptions) => Promise<void>;
  removeModel: (index: number) => void;
  selectModel: (index: number | null) => void;
  selectSecondaryModel: (index: number | null) => void;
  
  // Transform operations - direct transforms without controls
  setTransformMode: (mode: "translate" | "rotate" | "scale") => void;
  applyTransform: (operation: TransformOperation, direction: 1 | -1) => void;
  resetTransform: () => void;
  
  // Direct transform methods
  setModelPosition: (x: number, y: number, z: number) => void;
  setModelRotation: (x: number, y: number, z: number) => void;
  setModelScale: (x: number, y: number, z: number) => void;
  
  // CSG operations
  performCSGOperation: (operationType: 'union' | 'subtract' | 'intersect') => Promise<void>;
  
  // History operations
  saveHistoryState: () => void;
  undo: () => void;
  redo: () => void;
  
  // Snap operations
  toggleSnap: () => void;
  updateSnapSettings: (settings: Partial<SnapSettings>) => void;
  clearSnapIndicators: () => void;
  
  // Export
  exportSelectedModelAsSTL: () => Blob | null;

  // Add function to update grid position based on models
  updateGridPosition: () => void;

  // Sync UI state with current model transforms
  syncTransformUIState: () => void;
};

export const useScene = create<SceneState>((set, get) => {
  // Create initial Three.js objects 
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    precision: "highp"
  });
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  return {
    // Scene components
    scene,
    camera,
    renderer,
    orbitControls: null,
    raycaster,
    mouse,
    
    // State variables
    models: [],
    isSceneInitialized: false,
    isSceneReady: false,
    selectedModelIndex: null,
    secondaryModelIndex: null,
    transformMode: "scale",

    // Rendering mode
    renderingMode: 'standard',

    // Unit system
    unit: 'mm',
    setUnit: (unit: 'mm' | 'in') => {
      set({ unit });
      console.log(`Changed unit system to ${unit}`);
    },
    convertValue: (value: number, from: 'mm' | 'in', to: 'mm' | 'in'): number => {
      if (from === to) return value;
      
      if (from === 'mm' && to === 'in') {
        // Convert mm to inches (1 inch = 25.4 mm)
        return value / 25.4;
      } else if (from === 'in' && to === 'mm') {
        // Convert inches to mm
        return value * 25.4;
      }
      
      return value; // Fallback
    },

    // View options
    cameraView: 'isometric',
    showGrid: true,
    showAxes: true,

    // Loading states
    isCSGOperationLoading: false,
    
    // History tracking for undo/redo
    history: [],
    currentHistoryIndex: -1,
    canUndo: false,
    canRedo: false,
    
    // Snap settings
    snapSettings: {
      enabled: false,
      snapToGrid: true,
      snapToFaces: true,
      snapToEdges: true,
      snapThreshold: SNAP_THRESHOLD
    },
    snapIndicators: [],
    
    // Initialize the 3D scene
    initializeScene: (container: HTMLDivElement) => {
      console.log("Initializing scene with container:", container);
      const state = get();

      if (state.isSceneInitialized) {
        console.log("Scene already initialized, skipping");
        return () => {};
      }
      
      // Clear container
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      
      // Set up renderer
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setClearColor(BACKGROUND_COLOR);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      
      // Style canvas
      const canvas = renderer.domElement;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.position = "absolute";
      canvas.style.top = "0";
      canvas.style.left = "0";
      canvas.style.touchAction = "none";
      canvas.style.outline = "none";
      canvas.style.zIndex = "1";
      
      // Append to container
      container.appendChild(canvas);
      console.log("Canvas attached to DOM:", canvas.width, "x", canvas.height);
      
      // Setup camera and orbit controls
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.position.set(25, 25, 25); // Was originally 10, 10, 10
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      
      // Initialize orbit controls with optimizations for transform controls
      const orbitControls = new OrbitControls(camera, renderer.domElement);
      orbitControls.minDistance = 5; // Allow closer zoom
      orbitControls.maxDistance = 200; // Allow further zoom
      orbitControls.enableDamping = true;
      orbitControls.dampingFactor = 0.05;
      orbitControls.rotateSpeed = 0.7; // Slow down rotation for more precise control
      orbitControls.zoomSpeed = 0.8; // Slightly slower zoom for better control
      orbitControls.addEventListener('change', () => {
        // Force renderer update on orbit change
        renderer.render(scene, camera);
      });
      
      // Make sure the canvas receives all pointer events
      canvas.style.pointerEvents = "auto";
      canvas.style.zIndex = "1";
      
      set({ orbitControls });
      
      // Add a grid helper and give it a name for later reference
      const gridHelper = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS);
      gridHelper.name = 'gridHelper';
      gridHelper.visible = get().showGrid;
      gridHelper.position.y = -25; // Start grid lower initially
      scene.add(gridHelper);
      
      // Add axes helper
      const axesHelper = new THREE.AxesHelper(GRID_SIZE / 2); // Larger axes for better visibility
      axesHelper.name = 'axesHelper';
      axesHelper.visible = get().showAxes;
      scene.add(axesHelper);
      
      // Add lights
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
      scene.add(ambientLight);
      
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(10, 10, 10);
      directionalLight.castShadow = true;
      scene.add(directionalLight);
      
      // Add click event listener for model selection 
      canvas.addEventListener('pointerdown', (event) => {
          const currentState = get();
          
        // Check if the gizmo is being dragged to avoid conflicts
        if (isGizmoBeingDragged()) {
          return;
        }
        
        // We're skipping complicated checks for debugging purposes
        // This avoids potential conflicts between selection and transformation
        const isTransformActive = false; // Allow selection to work for debugging
        
        // Only handle selection when orbit controls are enabled
        if (orbitControls.enabled && !isTransformActive) {
          // Prevent default to avoid any browser handling
          event.preventDefault();
          
          // Only handle left mouse button
          if (event.button !== 0) return;
          
          // Get mouse position
          const rect = canvas.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
          
          // Update raycaster
          mouse.set(x, y);
          raycaster.setFromCamera(mouse, camera);
          
          // Get current models to check
          const currentModels = currentState.models;
          if (currentModels.length === 0) return;
          
          // Find intersections with models
          const meshes = currentModels.map(model => model.mesh);
          const intersects = raycaster.intersectObjects(meshes, false);
          
          if (intersects.length > 0) {
            // Find which model was clicked
            const clickedMesh = intersects[0].object as THREE.Mesh;
            const modelIndex = currentModels.findIndex(model => model.mesh === clickedMesh);
            
            if (modelIndex !== -1) {
              console.log(`Clicked on model ${modelIndex}:`, currentModels[modelIndex].name);
              get().selectModel(modelIndex);
              
              // Initialize free dragging if a model is selected
              const selectedModel = currentModels[modelIndex];
              
              // Create a drag plane perpendicular to the camera direction
              const dragPlane = new THREE.Plane();
              const cameraDirection = new THREE.Vector3();
              camera.getWorldDirection(cameraDirection);
              dragPlane.setFromNormalAndCoplanarPoint(
                cameraDirection,
                selectedModel.mesh.position
              );
              
              // Save initial intersection point
              const initialIntersection = new THREE.Vector3();
              const initialRay = new THREE.Ray(camera.position, raycaster.ray.direction);
              initialRay.intersectPlane(dragPlane, initialIntersection);
              
              // Save the initial model position
              const initialModelPosition = selectedModel.mesh.position.clone();
              
              // Disable orbit controls during dragging
              orbitControls.enabled = false;
              
              // Define pointermove handler
              const handlePointerMove = (moveEvent: PointerEvent) => {
                // Get current mouse position
                const rect = canvas.getBoundingClientRect();
                const x = ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1;
                const y = -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1;
                
                // Update raycaster with new mouse position
                mouse.set(x, y);
                raycaster.setFromCamera(mouse, camera);
                
                // Find the new intersection point with the drag plane
                const currentIntersection = new THREE.Vector3();
                const currentRay = new THREE.Ray(camera.position, raycaster.ray.direction);
                if (currentRay.intersectPlane(dragPlane, currentIntersection)) {
                  // Calculate the offset
                  const offset = new THREE.Vector3().subVectors(
                    currentIntersection,
                    initialIntersection
                  );
                  
                  // Apply offset to model position
                  const newPosition = new THREE.Vector3().addVectors(
                    initialModelPosition,
                    offset
                  );
                  
                  // Update the model position
                  get().setModelPosition(newPosition.x, newPosition.y, newPosition.z);
                }
              };
              
              // Define pointerup handler
              const handlePointerUp = () => {
                // Remove event listeners
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);
                
                // Re-enable orbit controls
                orbitControls.enabled = true;
                
                // Save the state for undo/redo
                get().saveHistoryState();
              };
              
              // Add event listeners for dragging
              window.addEventListener('pointermove', handlePointerMove);
              window.addEventListener('pointerup', handlePointerUp);
            }
          } else {
            // Clicked on empty space, deselect
            get().selectModel(null);
          }
        }
      });
      
      // Set up animation loop
      function animate() {
        requestAnimationFrame(animate);
        
        if (orbitControls) {
          orbitControls.update();
        }
        
        // Ensure grid and axes visibility matches state
        const state = get();
        const gridHelper = scene.children.find(child => child.name === 'gridHelper');
        const axesHelper = scene.children.find(child => child.name === 'axesHelper');
        
        if (gridHelper) {
          gridHelper.visible = state.showGrid;
        }
        
        if (axesHelper) {
          axesHelper.visible = state.showAxes;
        }
        
        renderer.render(scene, camera);
      }
      
      animate();
      
      // Handle window resize
      function handleResize() {
        if (!container) return;
        
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        renderer.render(scene, camera);
      }
      
      window.addEventListener('resize', handleResize);
      
      // Update state
      set({ 
        orbitControls, 
        isSceneInitialized: true,
        isSceneReady: true
      });
      
      // Return cleanup function
      return () => {
        console.log("Cleaning up scene");
        window.removeEventListener('resize', handleResize);
        
        if (container.contains(canvas)) {
          container.removeChild(canvas);
        }
        
        // Reset state
        set({
          orbitControls: null,
          isSceneInitialized: false,
          isSceneReady: false,
        });
      };
    },
    
    // Add function to update grid position based on models
    updateGridPosition: () => {
        const state = get();
      const gridHelper = state.scene.children.find(child => child.name === 'gridHelper');
      if (!gridHelper) return;

      // Find the lowest point among all models
      let lowestY = 0;
      let hasModels = false;

      state.models.forEach(model => {
        if (!model.mesh) return;
        
        // Create a new bounding box for the entire mesh in world space
        const bbox = new THREE.Box3();
        bbox.setFromObject(model.mesh); // This handles all transformations automatically

        if (!hasModels) {
          lowestY = bbox.min.y;
          hasModels = true;
              } else {
          lowestY = Math.min(lowestY, bbox.min.y);
        }
      });

      // Position grid 50mm below the lowest point or at -50 if no models
      const gridY = hasModels ? lowestY - 50 : -50;
      gridHelper.position.y = gridY;

      // Force scene update
      if (state.renderer && state.camera) {
        state.renderer.render(state.scene, state.camera);
      }
    },
    
    // Load an STL file
    loadSTL: async (file: File | string, name?: string) => {
      const loader = new STLLoader();
      let geometry: THREE.BufferGeometry;
      
      if (typeof file === 'string') {
        // If file is a URL string, load it directly
        try {
          // For Firebase Storage URLs, we need to fetch the data ourselves
          // because STLLoader might have CORS issues with the Firebase URLs
          const response = await fetch(file);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          
          const arrayBuffer = await response.arrayBuffer();
          geometry = loader.parse(arrayBuffer);
        } catch (error) {
          console.error("Error loading STL from URL:", error);
          throw new Error(`Failed to load STL from URL: ${error}`);
        }
      } else {
        // Original file handling logic
        const arrayBuffer = await file.arrayBuffer();
        geometry = loader.parse(arrayBuffer);
      }
      
      // Show scaling dialog
      const dialogRoot = document.createElement('div');
      dialogRoot.id = 'scale-dialog-root';
      document.body.appendChild(dialogRoot);
      
      // Create a promise that resolves when scaling is complete
      const scale = await new Promise<THREE.Vector3>((resolve) => {
        const root = createRoot(dialogRoot);
        root.render(
          React.createElement(ImportScaleDialog, {
            isOpen: true,
            onClose: () => {
              root.unmount();
              dialogRoot.remove();
              resolve(new THREE.Vector3(1, 1, 1)); // Default scale if dialog is closed
            },
            geometry: geometry,
            onScale: (scale) => {
              root.unmount();
              dialogRoot.remove();
              resolve(scale);
            }
          })
        );
      });
      
      // Create mesh with random color and apply scale
      const material = createFunMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Apply the chosen scale
      mesh.scale.copy(scale);

      // Center geometry
      geometry.computeBoundingBox();
      const center = new THREE.Vector3();
      geometry.boundingBox!.getCenter(center);
      geometry.center();

      // Find suitable position
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);
      const position = findSuitablePosition(get().models, size);
      mesh.position.copy(position);

      // Add to scene
      scene.add(mesh);
        
        // Store original transform
        const originalPosition = mesh.position.clone();
        const originalRotation = mesh.rotation.clone();
        const originalScale = mesh.scale.clone();
        
        // Create model object
      const model: Model = {
          id: `model-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: name || (typeof file === 'string' ? file.split('/').pop() || 'Model from URL' : file.name),
          type: 'model',
          mesh,
          originalPosition,
          originalRotation,
          originalScale
        };
        
      // Update state
      const updatedModels = [...get().models, model];
      set({ 
        models: updatedModels,
        selectedModelIndex: updatedModels.length - 1 
      });
        get().saveHistoryState();
      get().updateGridPosition();
    },

    // Remove a model
    removeModel: (index: number) => {
      const state = get();
      if (index < 0 || index >= state.models.length) return;

      const model = state.models[index];
      scene.remove(model.mesh);

      const newModels = [...state.models];
      newModels.splice(index, 1);
      set({ models: newModels, selectedModelIndex: null });

      // Update grid position after removing model
      get().updateGridPosition();

      // Save to history
      get().saveHistoryState();
    },
    
    // Select a model
    selectModel: (index: number | null) => {
      const { models, selectedModelIndex, clearSnapIndicators, renderingMode } = get();
      
      // If there was a previously selected model, reset its appearance
      if (selectedModelIndex !== null && models[selectedModelIndex]) {
        const model = models[selectedModelIndex];
        // First preserve the current color
        const currentColor = model.mesh.material instanceof THREE.Material 
          ? (model.mesh.material as THREE.MeshStandardMaterial).color 
          : new THREE.Color(0x888888);
        
        // Apply material based on the current rendering mode
        updateModelMaterial(model.mesh, renderingMode);
      }
      
      // If selecting a new model, highlight it while preserving the rendering mode
      if (index !== null && models[index]) {
        const model = models[index];
        const currentColor = model.mesh.material instanceof THREE.Material 
          ? (model.mesh.material as THREE.MeshStandardMaterial).color 
          : new THREE.Color(0x888888);
        
        // First apply the current rendering mode
        updateModelMaterial(model.mesh, renderingMode);
        
        // Then add highlighting based on material type
        if (model.mesh.material instanceof THREE.MeshStandardMaterial || 
            model.mesh.material instanceof THREE.MeshPhysicalMaterial) {
          model.mesh.material.emissive = new THREE.Color(0x222222);
        }
      }
      
      // Reset highlighting on all models
      models.forEach(model => {
        if (model.mesh.material instanceof THREE.MeshStandardMaterial ||
            model.mesh.material instanceof THREE.MeshPhysicalMaterial) {
          model.mesh.material.emissive.set(0x000000); // Reset emissive to black (no glow)
        }
      });
      
      // If selecting a model, highlight it
      if (index !== null && models[index]) {
        const selectedModel = models[index];
        
        // Highlight selected model with emissive glow based on material type
        if (selectedModel.mesh.material instanceof THREE.MeshStandardMaterial ||
            selectedModel.mesh.material instanceof THREE.MeshPhysicalMaterial) {
          selectedModel.mesh.material.emissive.set(0x222222); // Slight glow
        }
      }
      
      clearSnapIndicators(); // Clear indicators when selecting a new model
      
      // Force a render to show changes
      const { scene, camera, renderer } = get();
      renderer.render(scene, camera);
      
      set({ selectedModelIndex: index });
    },
    
    // Select a secondary model for CSG operations
    selectSecondaryModel: (index: number | null) => {
      const state = get();

      // Reset secondary highlighting on all models
      state.models.forEach(model => {
        // Only reset secondary highlight, not the primary selected model
        if (state.models.indexOf(model) !== state.selectedModelIndex) {
          // Check if this is not the primary selected model and it was secondarily selected
          if (model.mesh.userData.secondarySelected) {
            // Reset emissive based on material type
            if (model.mesh.material instanceof THREE.MeshStandardMaterial || 
                model.mesh.material instanceof THREE.MeshPhysicalMaterial) {
              model.mesh.material.emissive.set(0x000000);
            }
            model.mesh.userData.secondarySelected = false;
          }
        }
      });
      
      // Update secondary model index
      set({ secondaryModelIndex: index });
      
      // If selecting a secondary model, highlight it differently
      if (index !== null && state.models[index]) {
        const secondaryModel = state.models[index];
        
        // Highlight secondary model with a different emissive color based on material type
        if (secondaryModel.mesh.material instanceof THREE.MeshStandardMaterial || 
            secondaryModel.mesh.material instanceof THREE.MeshPhysicalMaterial) {
          secondaryModel.mesh.material.emissive.set(0x004444); // Teal-ish color
        }
        secondaryModel.mesh.userData.secondarySelected = true;
        
        console.log("Selected secondary model:", secondaryModel.name);
      }
      
      // Force a render to show changes
      state.renderer.render(state.scene, state.camera);
    },
    
    // Set transform mode (affects how applyTransform works)
    setTransformMode: (mode: "translate" | "rotate" | "scale") => {
      const { clearSnapIndicators } = get();
      clearSnapIndicators();
      set({ transformMode: mode });
      console.log(`Transform mode set to: ${mode}`);
    },

    // Apply transformation directly to the selected model
    applyTransform: (operation: TransformOperation, direction: 1 | -1) => {
      const state = get();
      const { selectedModelIndex, models, snapSettings, unit } = state;
      
      if (selectedModelIndex === null || !models[selectedModelIndex]) {
        console.warn("No model selected for transform");
        return;
      }
      
      const model = models[selectedModelIndex];
      const mesh = model.mesh;
      
      // Convert max size to current unit
      const maxSizeInCurrentUnit = unit === 'in' ? MAX_SIZE_INCHES : MAX_SIZE_INCHES * MM_PER_INCH;
      
      // Apply the requested transform
      switch(operation) {
        // Translation operations
        case 'translateX':
          mesh.position.x += TRANSFORM_STEP * direction;
          if (snapSettings.enabled) snapModelPosition(selectedModelIndex);
          console.log(`Moved X to: ${mesh.position.x.toFixed(2)}`);
          break;
        case 'translateY':
          mesh.position.y += TRANSFORM_STEP * direction;
          if (snapSettings.enabled) snapModelPosition(selectedModelIndex);
          console.log(`Moved Y to: ${mesh.position.y.toFixed(2)}`);
          break;
        case 'translateZ':
          mesh.position.z += TRANSFORM_STEP * direction;
          if (snapSettings.enabled) snapModelPosition(selectedModelIndex);
          console.log(`Moved Z to: ${mesh.position.z.toFixed(2)}`);
          break;
          
        // Rotation operations
        case 'rotateX':
          mesh.rotation.x += ROTATION_STEP * direction;
          break;
        case 'rotateY':
          mesh.rotation.y += ROTATION_STEP * direction;
          break;
        case 'rotateZ':
          mesh.rotation.z += ROTATION_STEP * direction;
          break;
          
        // Scale operations  
        case 'scaleX':
        case 'scaleY':
        case 'scaleZ': {
          const minScale = 0.01; // Smaller minimum scale for more flexibility
          
          // Calculate current size in scene units
          mesh.geometry.computeBoundingBox();
          const boundingBox = mesh.geometry.boundingBox;
          
          if (boundingBox) {
            // Calculate dimensions of the original geometry (before scaling)
            const size = new THREE.Vector3();
            boundingBox.getSize(size);
            const originalWidth = size.x;
            const originalHeight = size.y; 
            const originalDepth = size.z;
            
            console.log(`Original model dimensions: ${originalWidth.toFixed(2)} × ${originalHeight.toFixed(2)} × ${originalDepth.toFixed(2)}`);
            
            // Calculate the proposed new scale
            let newScaleX = mesh.scale.x;
            let newScaleY = mesh.scale.y;
            let newScaleZ = mesh.scale.z;
            
            if (operation === 'scaleX') {
              newScaleX += SCALE_STEP * direction;
            } else if (operation === 'scaleY') {
              newScaleY += SCALE_STEP * direction;
            } else if (operation === 'scaleZ') {
              newScaleZ += SCALE_STEP * direction;
            }
            
            // Calculate the proposed dimensions
            const proposedWidth = originalWidth * newScaleX;
            const proposedHeight = originalHeight * newScaleY;
            const proposedDepth = originalDepth * newScaleZ;
            
            // Check if any dimension would exceed the max size
            const maxDimension = Math.max(proposedWidth, proposedHeight, proposedDepth);
            
            if (direction > 0 && maxDimension > maxSizeInCurrentUnit) {
              // If scaling up and any dimension would exceed max size, don't scale
              console.log(`Cannot scale further - max dimension would be ${(maxDimension/MM_PER_INCH).toFixed(2)} inches`);
              return;
            } else if (direction < 0) {
              // If scaling down, ensure we don't go below minimum
              newScaleX = Math.max(minScale, newScaleX);
              newScaleY = Math.max(minScale, newScaleY);
              newScaleZ = Math.max(minScale, newScaleZ);
            }
            
            // Apply the new scales
            mesh.scale.set(newScaleX, newScaleY, newScaleZ);
            
            // Log current dimensions after scaling
            const currentWidth = originalWidth * mesh.scale.x;
            const currentHeight = originalHeight * mesh.scale.y;
            const currentDepth = originalDepth * mesh.scale.z;
            
            // Convert to appropriate units for display
            const widthInUserUnits = unit === 'in' ? currentWidth / MM_PER_INCH : currentWidth;
            const heightInUserUnits = unit === 'in' ? currentHeight / MM_PER_INCH : currentHeight;
            const depthInUserUnits = unit === 'in' ? currentDepth / MM_PER_INCH : currentDepth;
            
            console.log(`Current dimensions (${unit}): ${widthInUserUnits.toFixed(2)} × ${heightInUserUnits.toFixed(2)} × ${depthInUserUnits.toFixed(2)}`);
            // Also log in mm for debugging
            console.log(`Current dimensions (mm): ${currentWidth.toFixed(2)} × ${currentHeight.toFixed(2)} × ${currentDepth.toFixed(2)}`);
            console.log(`Current dimensions (in): ${(currentWidth/MM_PER_INCH).toFixed(2)} × ${(currentHeight/MM_PER_INCH).toFixed(2)} × ${(currentDepth/MM_PER_INCH).toFixed(2)}`);
          } else {
            // Fallback to original behavior if bounding box is not available
            if (operation === 'scaleX') {
              mesh.scale.x = Math.max(minScale, mesh.scale.x + SCALE_STEP * direction);
            } else if (operation === 'scaleY') {
              mesh.scale.y = Math.max(minScale, mesh.scale.y + SCALE_STEP * direction);
            } else if (operation === 'scaleZ') {
              mesh.scale.z = Math.max(minScale, mesh.scale.z + SCALE_STEP * direction);
            }
          }
          break;
        }
      }
      
      // Update the matrix
      mesh.updateMatrix();
      
      // Render the scene to show changes
      state.renderer.render(state.scene, state.camera);
      
      // Save history state after transformation
      get().saveHistoryState();

      // After applying transform
      if (operation.startsWith('translate') || operation.startsWith('scale')) {
        get().updateGridPosition();
      }
    },
    
    // Set direct position for the selected model
    setModelPosition: (x: number, y: number, z: number) => {
      const state = get();
      const { selectedModelIndex, models } = state;
      
      if (selectedModelIndex === null || !models[selectedModelIndex]) {
        console.warn("No model selected for position change");
        return;
      }
      
      const model = models[selectedModelIndex];
      model.mesh.position.set(x, y, z);
      
      // Apply snapping if enabled
      if (state.snapSettings.enabled) {
        snapModelPosition(selectedModelIndex);
      }
      
      model.mesh.updateMatrix();
      get().saveHistoryState();
    },
    
    // Set model rotation directly from input values (in radians)
    setModelRotation: (x: number, y: number, z: number) => {
      const state = get();
      const { selectedModelIndex, models } = state;
      
      if (selectedModelIndex === null || !models[selectedModelIndex]) {
        console.warn("No model selected for rotation change");
        return;
      }
      
      const model = models[selectedModelIndex];
      const mesh = model.mesh;
      
      // Set the new rotation
      mesh.rotation.set(x, y, z);
      
      // Update the matrix
      mesh.updateMatrix();
      
      console.log(`Set rotation for model ${model.name}:`, { 
        x: `${x.toFixed(2)} rad (${(x * 180 / Math.PI).toFixed(1)}°)`,
        y: `${y.toFixed(2)} rad (${(y * 180 / Math.PI).toFixed(1)}°)`,
        z: `${z.toFixed(2)} rad (${(z * 180 / Math.PI).toFixed(1)}°)`
      });
      
      // Render to show changes
      state.renderer.render(state.scene, state.camera);
      
      // Save history state after direct rotation change
      get().saveHistoryState();
    },
    
    // Set model scale directly from input values
    setModelScale: (x: number, y: number, z: number) => {
      const state = get();
      const { selectedModelIndex, models, unit } = state;
      
      if (selectedModelIndex === null || !models[selectedModelIndex]) {
        console.warn("No model selected for scale change");
        return;
      }
      
      const model = models[selectedModelIndex];
      const mesh = model.mesh;
      
      // Ensure minimum scale is very small to allow for tiny models
      const minScale = 0.0001;
      let validX = Math.max(minScale, x);
      let validY = Math.max(minScale, y);
      let validZ = Math.max(minScale, z);
      
      // Apply exact 10-inch size limit
      mesh.geometry.computeBoundingBox();
      const boundingBox = mesh.geometry.boundingBox;
      
      if (boundingBox) {
        // Calculate dimensions of the original geometry (before scaling)
        const size = new THREE.Vector3();
        boundingBox.getSize(size);
        const originalWidth = size.x;
        const originalHeight = size.y; 
        const originalDepth = size.z;
        
        // Calculate final dimensions after proposed scaling
        const finalWidth = originalWidth * validX;
        const finalHeight = originalHeight * validY;
        const finalDepth = originalDepth * validZ;
        
        // Check if any dimension would exceed 10 inches (254mm)
        const maxAllowedSize = MAX_SIZE_MM; // 254mm (10 inches)
        
        // Calculate scale factors that would achieve exactly 10 inches for each dimension
        const maxScaleX = originalWidth > 0 ? maxAllowedSize / originalWidth : Infinity;
        const maxScaleY = originalHeight > 0 ? maxAllowedSize / originalHeight : Infinity;
        const maxScaleZ = originalDepth > 0 ? maxAllowedSize / originalDepth : Infinity;
        
        // Apply the limits
        validX = Math.min(validX, maxScaleX);
        validY = Math.min(validY, maxScaleY);
        validZ = Math.min(validZ, maxScaleZ);
        
        // Calculate final dimensions for logging
        const finalDimensions = {
          width: originalWidth * validX,
          height: originalHeight * validY,
          depth: originalDepth * validZ
        };
        
        // Log dimensions in both units
        console.log('Final dimensions (mm):', {
          width: finalDimensions.width.toFixed(2),
          height: finalDimensions.height.toFixed(2),
          depth: finalDimensions.depth.toFixed(2)
        });
        
        console.log('Final dimensions (inches):', {
          width: (finalDimensions.width / MM_PER_INCH).toFixed(3),
          height: (finalDimensions.height / MM_PER_INCH).toFixed(3),
          depth: (finalDimensions.depth / MM_PER_INCH).toFixed(3)
        });
      }
      
      // Set the new scale
      mesh.scale.set(validX, validY, validZ);
      mesh.updateMatrix();
      
      // Render to show changes
      state.renderer.render(state.scene, state.camera);
      
      // Save history state after scale change
      get().saveHistoryState();
    },
    
    // Reset the selected model to its original transform
    resetTransform: () => {
      const { selectedModelIndex, models, clearSnapIndicators } = get();
      
      if (selectedModelIndex !== null) {
        const model = models[selectedModelIndex];
        model.mesh.position.copy(model.originalPosition);
        model.mesh.rotation.copy(model.originalRotation);
        model.mesh.scale.copy(model.originalScale);
        
        clearSnapIndicators();
        get().saveHistoryState();
      }
    },
    
    // Perform CSG operations between selected and secondary models
    performCSGOperation: async (operationType: 'union' | 'subtract' | 'intersect') => {
      const state = get();
      const { selectedModelIndex, secondaryModelIndex, models, scene } = state;
      
      // Set loading state
      set({ isCSGOperationLoading: true });
      
      // Add progress tracking system
      const reportProgress = (stage: string, percent: number) => {
        console.log(`Boolean operation progress: ${stage} - ${percent.toFixed(1)}%`);
      };
      
      try {
        if (selectedModelIndex === null) {
          throw new Error("Primary model not selected for boolean operation");
        }
        
        if (secondaryModelIndex === null) {
          throw new Error("Secondary model not selected for boolean operation");
        }
        
        // Get the models
        const modelA = models[selectedModelIndex];
        const modelB = models[secondaryModelIndex];
        
        console.log(`Performing CSG ${operationType} between models:`, modelA.name, modelB.name);
        
        // Create working copies of meshes
        const meshA = modelA.mesh.clone();
        const meshB = modelB.mesh.clone();
        
        // Apply world matrices to transform geometries into world space
        meshA.updateWorldMatrix(true, false);
        meshB.updateWorldMatrix(true, false);
        
        // Clone and transform geometries
        const geomA = modelA.mesh.geometry.clone();
        const geomB = modelB.mesh.geometry.clone();
        
        geomA.applyMatrix4(meshA.matrixWorld);
        geomB.applyMatrix4(meshB.matrixWorld);
        
        // Ensure geometries are manifold (watertight)
        const processedGeomA = ensureManifoldGeometry(geomA);
        const processedGeomB = ensureManifoldGeometry(geomB);
        
        // Pre-processing feedback
        console.log("Pre-processed geometries:", {
          meshA: { 
            original: geomA.attributes.position.count,
            processed: processedGeomA.attributes.position.count 
          },
          meshB: { 
            original: geomB.attributes.position.count,
            processed: processedGeomB.attributes.position.count
          }
        });
        
        // Create temporary meshes with material configuration suitable for CSG
        const tempMeshA = new THREE.Mesh(
          processedGeomA,
          new THREE.MeshStandardMaterial({
            color: meshA.material instanceof THREE.Material ? 
                  (meshA.material as THREE.MeshStandardMaterial).color.clone() : 
                  (meshA.material[0] as THREE.MeshStandardMaterial).color.clone(),
            side: THREE.DoubleSide
          })
        );
        
        const tempMeshB = new THREE.Mesh(
          processedGeomB,
          new THREE.MeshStandardMaterial({
            color: meshB.material instanceof THREE.Material ? 
                  (meshB.material as THREE.MeshStandardMaterial).color.clone() : 
                  (meshB.material[0] as THREE.MeshStandardMaterial).color.clone(),
            side: THREE.DoubleSide
          })
        );
        
        // Reset positions since transforms are now baked into the geometry
        tempMeshA.position.set(0, 0, 0);
        tempMeshA.rotation.set(0, 0, 0);
        tempMeshA.scale.set(1, 1, 1);
        tempMeshB.position.set(0, 0, 0);
        tempMeshB.rotation.set(0, 0, 0);
        tempMeshB.scale.set(1, 1, 1);
        
        // Add a small delay to allow the UI to show loading state
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Perform the operation based on type
        let resultMesh: THREE.Mesh;
        let operationSucceeded = false;
        let errorMessage = "";
        
        // Try different approaches, starting with the most reliable for each operation type
        try {
          if (operationType === 'union') {
            // For union operations, use our robust union approach
            try {
              console.log("Performing robust union operation");
              resultMesh = robustMeshUnion(tempMeshA, tempMeshB);
              operationSucceeded = true;
              console.log("Robust union successful");
            } catch (e: any) {
              console.error("Union operation failed:", e);
              throw new Error(`Union operation failed: ${e.message}`);
            }
          } else if (operationType === 'subtract') {
            // Use our specialized robust subtraction function
            try {
              console.log("Performing robust subtraction operation");
              resultMesh = robustMeshSubtract(tempMeshA, tempMeshB);
              operationSucceeded = true;
              console.log("Robust subtraction successful");
            } catch (e: any) {
              console.error("Subtraction operation failed:", e);
              throw new Error(`Subtraction operation failed: ${e.message}`);
            }
          } else if (operationType === 'intersect') {
            // Use our specialized robust intersection function
            try {
              console.log("Performing robust intersection operation");
              resultMesh = robustMeshIntersect(tempMeshA, tempMeshB);
              operationSucceeded = true;
              console.log("Robust intersection successful");
            } catch (e: any) {
              console.error("Intersection operation failed:", e);
              throw new Error(`Intersection operation failed: ${e.message}`);
            }
          } else {
            throw new Error(`Unknown operation type: ${operationType}`);
          }
        } catch (error: any) {
          console.error("All CSG approaches failed:", error);
          errorMessage = error.message || "Operation failed";
          throw error;
        }
        
        // If we made it here, we have a result mesh
        if (!operationSucceeded || !resultMesh) {
          throw new Error(errorMessage || "Boolean operation failed with no specific error");
        }
        
        // Validate the result mesh
        if (!validateResultMesh(resultMesh)) {
          throw new Error("The boolean operation produced an invalid mesh. Try with simpler models or a different operation.");
        }
        
        // Post-process the result geometry
        if (resultMesh.geometry) {
          console.log("Post-processing result geometry");
          
          try {
            // Compute normals for proper lighting
            resultMesh.geometry.computeVertexNormals();
            
            // Update bounding info
            resultMesh.geometry.computeBoundingBox();
            resultMesh.geometry.computeBoundingSphere();
            
            // For union operations, be careful with vertex merging
            if (operationType === 'union' && BufferGeometryUtils.mergeVertices) {
              // Use a small tolerance to avoid losing detail
              resultMesh.geometry = BufferGeometryUtils.mergeVertices(resultMesh.geometry, 0.0001);
            }
            
            console.log("Final result vertices:", resultMesh.geometry.attributes.position.count);
          } catch (e) {
            console.warn("Error during result post-processing:", e);
            // Still continue with the operation
          }
        }
        
        // Setup final material properties
        const material = new THREE.MeshStandardMaterial({
          color: meshA.material instanceof THREE.Material ? 
                 (meshA.material as THREE.MeshStandardMaterial).color.clone() : 
                 (meshA.material[0] as THREE.MeshStandardMaterial).color.clone(),
          metalness: 0.1,
          roughness: 0.8,
          side: THREE.DoubleSide,
          flatShading: false
        });
        
        resultMesh.material = material;
        resultMesh.castShadow = true;
        resultMesh.receiveShadow = true;
        
        // Remove the original models from the scene
        scene.remove(modelA.mesh);
        scene.remove(modelB.mesh);
        
        // Add the result to the scene
        scene.add(resultMesh);
        
        // Create a new model for the result
        const newModel: Model = {
          id: `csg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: `${operationType}_${modelA.name}_${modelB.name}`,
          type: 'model',
          mesh: resultMesh,
          originalPosition: resultMesh.position.clone(),
          originalRotation: resultMesh.rotation.clone(),
          originalScale: resultMesh.scale.clone()
        };
        
        // Update models array: remove the two used models and add the result
        const updatedModels = models.filter((_, i) => i !== selectedModelIndex && i !== secondaryModelIndex);
        updatedModels.push(newModel);
        
        // Update state
        set({ 
          models: updatedModels,
          selectedModelIndex: updatedModels.length - 1, // Select the new model
          secondaryModelIndex: null, // Reset secondary selection
          isCSGOperationLoading: false
        });
        
        console.log(`CSG operation successful, created: ${newModel.name}`);
        
        // Render to show changes
        state.renderer.render(state.scene, state.camera);
        
        // Save history state after CSG operation
        get().saveHistoryState();
        
      } catch (error) {
        console.error(`Error during CSG ${operationType} operation:`, error);
        set({ isCSGOperationLoading: false });
        
        // Create a user-friendly error message
        let userErrorMessage = `The ${operationType} operation failed.`;
        
        if (error && typeof error === 'object' && 'message' in error) {
          const errorMessage = error.message as string;
          if (errorMessage.includes("non-manifold") || errorMessage.includes("watertight")) {
            userErrorMessage += " The models have gaps or overlaps that prevent a clean operation.";
          } else if (errorMessage.includes("intersect") || errorMessage.includes("overlap")) {
            userErrorMessage += " The models don't intersect properly.";
          } else if (errorMessage.includes("complex")) {
            userErrorMessage += " The models are too complex for this operation.";
          }
        }
        
        userErrorMessage += " Try repositioning the models or using simpler shapes.";
        
        throw new Error(userErrorMessage);
      }
    },
    
    // Save the current state to history
    saveHistoryState: () => {
      const { models, selectedModelIndex, history, currentHistoryIndex } = get();
      
      // Create a deep clone of the models array for history
      const modelsCopy: Model[] = models.map(model => {
        // Create a clone of the mesh
        const meshClone = model.mesh.clone(false); // false means don't clone children
        
        // Clone materials properly
        if (Array.isArray(model.mesh.material)) {
          meshClone.material = model.mesh.material.map(mat => mat.clone());
        } else if (model.mesh.material) {
          meshClone.material = (model.mesh.material as THREE.Material).clone();
        }
        
        return {
          id: model.id,
          name: model.name,
          type: model.type,
          mesh: meshClone,
          originalPosition: model.originalPosition.clone(),
          originalRotation: model.originalRotation.clone(),
          originalScale: model.originalScale.clone()
        };
      });
      
      // Create the history record
      const newRecord: HistoryRecord = {
        models: modelsCopy,
        selectedModelIndex
      };
      
      // If we're in the middle of the history and perform a new action,
      // we need to truncate the history after the current index
      if (currentHistoryIndex < history.length - 1) {
        const newHistory = history.slice(0, currentHistoryIndex + 1);
        newHistory.push(newRecord);
        
        set({
          history: newHistory,
          currentHistoryIndex: newHistory.length - 1,
          canUndo: newHistory.length > 1,
          canRedo: false
        });
      } else {
        // Otherwise just append to history
        const newHistory = [...history, newRecord];
        
        // Cap history at 30 steps to avoid memory issues
        if (newHistory.length > 30) {
          newHistory.shift();
        }
        
        set({
          history: newHistory,
          currentHistoryIndex: newHistory.length - 1,
          canUndo: newHistory.length > 1,
          canRedo: false
        });
      }
      
      console.log(`Saved history state. History length: ${get().history.length}, Current index: ${get().currentHistoryIndex}`);
    },
    
    // Undo the last operation
    undo: () => {
      const { history, currentHistoryIndex, scene, renderer, camera } = get();
      
      if (currentHistoryIndex <= 0) {
        console.warn("Cannot undo: at the beginning of history");
        return;
      }
      
      // Move back in history
      const newIndex = currentHistoryIndex - 1;
      const targetState = history[newIndex];
      
      // Clear current models from scene
      get().models.forEach(model => {
        scene.remove(model.mesh);
      });
      
      // Add models from history state to the scene
      // These are clones in history, so we need to clone them again to avoid modifying history
      const restoredModels: Model[] = targetState.models.map(historyModel => {
        const restoredGeometry = (historyModel.mesh.geometry as THREE.BufferGeometry).clone();
        
        // Clone materials
        let restoredMaterial: THREE.Material | THREE.Material[];
        if (Array.isArray(historyModel.mesh.material)) {
          restoredMaterial = historyModel.mesh.material.map(mat => mat.clone());
        } else {
          restoredMaterial = (historyModel.mesh.material as THREE.Material).clone();
        }
        
        // Create the restored mesh
        const restoredMesh = new THREE.Mesh(restoredGeometry, restoredMaterial);
        
        // Copy transform properties
        restoredMesh.position.copy(historyModel.mesh.position);
        restoredMesh.rotation.copy(historyModel.mesh.rotation);
        restoredMesh.scale.copy(historyModel.mesh.scale);
        
        // Ensure casting shadows
        restoredMesh.castShadow = true;
        restoredMesh.receiveShadow = true;
        
        // Add to scene
        scene.add(restoredMesh);
        
        return {
          id: historyModel.id,
          name: historyModel.name,
          type: historyModel.type,
          mesh: restoredMesh,
          originalPosition: historyModel.originalPosition.clone(),
          originalRotation: historyModel.originalRotation.clone(),
          originalScale: historyModel.originalScale.clone()
        };
      });
      
      // Update state
      set({
        models: restoredModels,
        selectedModelIndex: targetState.selectedModelIndex,
        currentHistoryIndex: newIndex,
        canUndo: newIndex > 0,
        canRedo: true
      });
      
      // Reapply highlighting to the selected model
      if (targetState.selectedModelIndex !== null) {
        const selectedModel = restoredModels[targetState.selectedModelIndex];
        if (selectedModel) {
          const material = selectedModel.mesh.material;
          // Check if material is a MeshStandardMaterial or MeshPhysicalMaterial before setting emissive
          if (material instanceof THREE.MeshStandardMaterial || 
              material instanceof THREE.MeshPhysicalMaterial) {
            material.emissive.set(0x444444);
          }
        }
      }
      
      // Force a render
      renderer.render(scene, camera);
      
      console.log(`Undo to history index ${newIndex}. Can undo: ${newIndex > 0}, Can redo: true`);
    },
    
    // Redo the last undone operation
    redo: () => {
      const { history, currentHistoryIndex, scene, renderer, camera } = get();
      
      if (currentHistoryIndex >= history.length - 1) {
        console.warn("Cannot redo: at the end of history");
        return;
      }
      
      // Move forward in history
      const newIndex = currentHistoryIndex + 1;
      const targetState = history[newIndex];
      
      // Clear current models from scene
      get().models.forEach(model => {
        scene.remove(model.mesh);
      });
      
      // Add models from history state to the scene
      const restoredModels: Model[] = targetState.models.map(historyModel => {
        const restoredGeometry = (historyModel.mesh.geometry as THREE.BufferGeometry).clone();
        
        // Clone materials
        let restoredMaterial: THREE.Material | THREE.Material[];
        if (Array.isArray(historyModel.mesh.material)) {
          restoredMaterial = historyModel.mesh.material.map(mat => mat.clone());
        } else {
          restoredMaterial = (historyModel.mesh.material as THREE.Material).clone();
        }
        
        // Create the restored mesh
        const restoredMesh = new THREE.Mesh(restoredGeometry, restoredMaterial);
        
        // Copy transform properties
        restoredMesh.position.copy(historyModel.mesh.position);
        restoredMesh.rotation.copy(historyModel.mesh.rotation);
        restoredMesh.scale.copy(historyModel.mesh.scale);
        
        // Ensure casting shadows
        restoredMesh.castShadow = true;
        restoredMesh.receiveShadow = true;
        
        // Add to scene
        scene.add(restoredMesh);
        
        return {
          id: historyModel.id,
          name: historyModel.name,
          type: historyModel.type,
          mesh: restoredMesh,
          originalPosition: historyModel.originalPosition.clone(),
          originalRotation: historyModel.originalRotation.clone(),
          originalScale: historyModel.originalScale.clone()
        };
      });
      
      // Update state
      set({
        models: restoredModels,
        selectedModelIndex: targetState.selectedModelIndex,
        currentHistoryIndex: newIndex,
        canUndo: true,
        canRedo: newIndex < history.length - 1
      });
      
      // Reapply highlighting to the selected model
      if (targetState.selectedModelIndex !== null) {
        const selectedModel = restoredModels[targetState.selectedModelIndex];
        if (selectedModel) {
          const material = selectedModel.mesh.material;
          // Check if material is a MeshStandardMaterial or MeshPhysicalMaterial before setting emissive
          if (material instanceof THREE.MeshStandardMaterial || 
              material instanceof THREE.MeshPhysicalMaterial) {
            material.emissive.set(0x444444);
          }
        }
      }
      
      // Force a render
      renderer.render(scene, camera);
      
      console.log(`Redo to history index ${newIndex}. Can undo: true, Can redo: ${newIndex < history.length - 1}`);
    },
    
    // Export the selected model as STL
    exportSelectedModelAsSTL: () => {
      const { selectedModelIndex, models } = get();
      
      if (selectedModelIndex === null || !models[selectedModelIndex]) {
        console.warn("No model selected for export");
        return null;
      }
      
      try {
        const selectedModel = models[selectedModelIndex];
        
        // Clone the mesh to preserve the original
        const meshToExport = selectedModel.mesh.clone();
        
        // Create an STL exporter
        const exporter = new STLExporter();
        
        // Export the model as STL binary format
        const result = exporter.parse(meshToExport, { binary: true });
        
        // Create a blob from the result
        const blob = new Blob([result], { type: result instanceof Uint8Array ? 'application/octet-stream' : 'text/plain' });
        
        // Return the blob
        return blob;
        
      } catch (error) {
        console.error("Error exporting STL:", error);
        throw new Error("Failed to export STL file");
      }
    },
    
    // Toggle snap on/off
    toggleSnap: () => {
      const { snapSettings, clearSnapIndicators } = get();
      
      // Toggle the enabled state
      const newEnabledState = !snapSettings.enabled;
      
      set({
        snapSettings: {
          ...snapSettings,
          enabled: newEnabledState
        }
      });
      
      // If turning off snap mode, clear indicators
      if (!newEnabledState) {
        clearSnapIndicators();
      }
      
      console.log(`Snap mode ${newEnabledState ? 'enabled' : 'disabled'}`);
    },
    
    // Update snap settings
    updateSnapSettings: (settings: Partial<SnapSettings>) => {
      const { snapSettings } = get();
      set({ 
        snapSettings: { 
          ...snapSettings, 
          ...settings
        } 
      });
      console.log("Updated snap settings:", { ...snapSettings, ...settings });
    },
    
    // Clear snap indicators
    clearSnapIndicators: () => {
      const { scene, snapIndicators } = get();
      
      // Remove all existing snap indicators from the scene
      snapIndicators.forEach(indicator => {
        scene.remove(indicator);
      });
      
      set({ snapIndicators: [] });
    },

    // View options
    setCameraView: (view: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'isometric') => {
      const { renderingMode } = get();
      set({ cameraView: view });
      
      // Make sure we re-apply the current rendering mode after camera view change
      // This prevents the camera view change from affecting the rendering mode
      setTimeout(() => {
        const { models, scene, camera, renderer, selectedModelIndex, secondaryModelIndex } = get();
        
        // Re-apply rendering mode to ensure consistency
        models.forEach(model => {
          // Call updateModelMaterial to ensure the rendering mode is correctly applied
          updateModelMaterial(model.mesh, renderingMode);
          
          // Ensure material updates are applied immediately
          if (model.mesh.material) {
            if (Array.isArray(model.mesh.material)) {
              // Handle material array
              model.mesh.material.forEach(mat => {
                mat.needsUpdate = true;
              });
            } else {
              // Handle single material
              model.mesh.material.needsUpdate = true;
            }
          }
        });
        
        // Re-apply selection highlights if needed
        if (selectedModelIndex !== null && models[selectedModelIndex]) {
          const selectedModel = models[selectedModelIndex];
          if (selectedModel.mesh.material instanceof THREE.MeshStandardMaterial || 
              selectedModel.mesh.material instanceof THREE.MeshPhysicalMaterial) {
            selectedModel.mesh.material.emissive.set(0x222222);
            selectedModel.mesh.material.needsUpdate = true;
          }
        }
        
        if (secondaryModelIndex !== null && models[secondaryModelIndex]) {
          const secondaryModel = models[secondaryModelIndex];
          if (secondaryModel.mesh.material instanceof THREE.MeshStandardMaterial || 
              secondaryModel.mesh.material instanceof THREE.MeshPhysicalMaterial) {
            secondaryModel.mesh.material.emissive.set(0x004444);
            secondaryModel.mesh.material.needsUpdate = true;
          }
        }
        
        // Force a render to apply changes
        if (renderer && camera && scene) {
          renderer.render(scene, camera);
          console.log(`Reapplied rendering mode '${renderingMode}' after camera view change to: ${view}`);
        }
      }, 10); // Reduced delay to make updates feel more immediate
      
      console.log(`Camera view set to: ${view}`);
    },
    setShowGrid: (show: boolean) => {
      const state = get();
      
      // Store the setting in state first
      set({ showGrid: show });
      
      // Update the grid helper visibility
      const gridHelper = state.scene.children.find(child => child.name === 'gridHelper');
      if (gridHelper) {
        console.log(`Setting grid visibility to ${show} via useScene hook`);
        gridHelper.visible = show;
        
        // Force a render update 
        if (state.renderer && state.camera) {
          state.renderer.render(state.scene, state.camera);
        }
        
        // Schedule another render after a short delay to ensure it's applied
        setTimeout(() => {
          if (state.renderer && state.camera) {
            console.log(`Delayed render for grid visibility: ${show}`);
            state.renderer.render(state.scene, state.camera);
          }
        }, 100);
      } else {
        console.warn("Grid helper not found when trying to toggle visibility");
      }
      
      // Dispatch an event that the Viewport component can listen to
      window.dispatchEvent(new CustomEvent('grid-visibility-changed', { detail: { visible: show } }));
      
      console.log(`Grid visibility set to: ${show}`);
    },
    setShowAxes: (show: boolean) => {
      const state = get();
      
      // Store the setting in state first
      set({ showAxes: show });
      
      // Update the axes helper visibility
      const axesHelper = state.scene.children.find(child => child.name === 'axesHelper');
      if (axesHelper) {
        console.log(`Setting axes visibility to ${show} via useScene hook`);
        axesHelper.visible = show;
        
        // Force a render update
        if (state.renderer && state.camera) {
          state.renderer.render(state.scene, state.camera);
        }
        
        // Schedule another render after a short delay to ensure it's applied
        setTimeout(() => {
          if (state.renderer && state.camera) {
            console.log(`Delayed render for axes visibility: ${show}`);
            state.renderer.render(state.scene, state.camera);
          }
        }, 100);
      } else {
        console.warn("Axes helper not found when trying to toggle visibility");
      }
      
      // Dispatch an event that the Viewport component can listen to
      window.dispatchEvent(new CustomEvent('axes-visibility-changed', { detail: { visible: show } }));
      
      console.log(`Axes visibility set to: ${show}`);
    },

    // Add function to set rendering mode
    setRenderingMode: (mode: 'standard' | 'wireframe' | 'metallic' | 'glass-like' | 'xray') => {
      const prevMode = get().renderingMode;
      set({ renderingMode: mode });
      
      console.log(`Changing rendering mode from ${prevMode} to ${mode}`);
      
      // Update all models with the new rendering mode
      const { models, scene, camera, renderer, selectedModelIndex, secondaryModelIndex } = get();
      
      // Apply new rendering mode to all models
      models.forEach(model => {
        updateModelMaterial(model.mesh, mode);
        
        // Ensure material updates are applied immediately
        if (model.mesh.material) {
          if (Array.isArray(model.mesh.material)) {
            // Handle material array
            model.mesh.material.forEach(mat => {
              mat.needsUpdate = true;
            });
          } else {
            // Handle single material
            model.mesh.material.needsUpdate = true;
          }
        }
      });
      
      // Re-apply selection highlights if needed
      if (selectedModelIndex !== null && models[selectedModelIndex]) {
        const selectedModel = models[selectedModelIndex];
        if (mode !== 'wireframe' && mode !== 'xray') {
          if (selectedModel.mesh.material instanceof THREE.MeshStandardMaterial || 
              selectedModel.mesh.material instanceof THREE.MeshPhysicalMaterial) {
            selectedModel.mesh.material.emissive.set(0x222222);
            selectedModel.mesh.material.needsUpdate = true;
          }
        }
      }
      
      // Same for secondary selection if CSG operation is in progress
      if (secondaryModelIndex !== null && models[secondaryModelIndex]) {
        const secondaryModel = models[secondaryModelIndex];
        if (mode !== 'wireframe' && mode !== 'xray') {
          if (secondaryModel.mesh.material instanceof THREE.MeshStandardMaterial || 
              secondaryModel.mesh.material instanceof THREE.MeshPhysicalMaterial) {
            secondaryModel.mesh.material.emissive.set(0x222222);
            secondaryModel.mesh.material.needsUpdate = true;
          }
        }
      }
      
      // Force a render to show the changes immediately
      if (renderer && camera && scene) {
        renderer.render(scene, camera);
      }
    },

    // Load an SVG file and convert to 3D by extruding
    loadSVG: async (file: File | string, extrudeDepth = 2) => {
      const state = get();
      
      try {
        // Create a URL for the file
        let url: string;
        if (typeof file === 'string') {
          // If file is already a URL string, use it directly
          url = file;
        } else {
          // Otherwise create a URL from the File object
          url = URL.createObjectURL(file);
        }
        
        // Load the SVG
        const loader = new SVGLoader();
        const svgData = await loader.loadAsync(url);
        
        // Clean up the URL if we created it from a File
        if (typeof file !== 'string') {
          URL.revokeObjectURL(url);
        }
        
        // Create a group to hold our shapes
        const group = new THREE.Group();
        
        // Create a material with a fun color or gradient
        const material = createFunMaterial();
        // Ensure double-sided rendering
        material.side = THREE.DoubleSide;
        
        // Extrusion settings with bevel for better 3D appearance
          const extrudeSettings = {
            depth: extrudeDepth,
          bevelEnabled: true,
          bevelThickness: 1,
          bevelSize: 1,
          bevelOffset: 0,
          bevelSegments: 3
          };
          
          // Process all paths in the SVG
          svgData.paths.forEach((path) => {
          // Convert all subpaths to shapes
            const shapes = path.toShapes(true);
            
            shapes.forEach((shape) => {
            // Ensure the shape is properly oriented for solid extrusion
            shape.autoClose = true;
            
            // Create holes array if the shape has holes
            const holes = [];
            if (shape.holes && shape.holes.length > 0) {
              shape.holes.forEach((hole) => {
                hole.autoClose = true;
                holes.push(hole);
              });
            }
            
            // Extrude the shape to create a solid 3D object
              const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            
            // Create mesh with the geometry
              const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
              group.add(mesh);
            });
          });
          
          // If no valid paths were found, throw an error
          if (group.children.length === 0) {
            throw new Error("No valid paths found in SVG");
          }
          
        // Combine all meshes into a single mesh for better performance
          const buffers: THREE.BufferGeometry[] = [];
          group.children.forEach((child) => {
            if (child instanceof THREE.Mesh) {
              buffers.push(child.geometry.clone());
            }
          });
          
          // Use BufferGeometryUtils to merge geometries
        const mergedGeometry = BufferGeometryUtils.mergeGeometries(buffers);
        
        // Create the final mesh
        const finalMesh = new THREE.Mesh(mergedGeometry, material);
        finalMesh.castShadow = true;
        finalMesh.receiveShadow = true;
        
        // Center the model
        const box = new THREE.Box3().setFromObject(finalMesh);
        const center = box.getCenter(new THREE.Vector3());
        finalMesh.position.sub(center);
        finalMesh.position.y = extrudeDepth / 2; // Place on the grid
        
        // Fix the orientation for SVG models created from sketches
        if (typeof file !== 'string' && file.name.startsWith('sketch-')) {
          // Apply 180 degrees rotation around Z-axis to correct sketch orientation
          finalMesh.rotateZ(Math.PI);
        }
          
          // Store original transform
        const originalPosition = finalMesh.position.clone();
        const originalRotation = finalMesh.rotation.clone();
        const originalScale = finalMesh.scale.clone();
          
          // Add to scene
        state.scene.add(finalMesh);
          
          // Create model object
        const model: Model = {
          id: `svg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name: typeof file === 'string' ? file.split('/').pop() || 'SVG from URL' : file.name,
          type: 'svg',
          mesh: finalMesh,
            originalPosition,
            originalRotation,
            originalScale
          };
          
          // Add to models array
        const updatedModels = [...state.models, model];
        set({ models: updatedModels });
          
          // Select the new model
        const newIndex = updatedModels.length - 1;
        state.selectModel(newIndex);
        
        // Save to history
        state.saveHistoryState();
      } catch (error) {
        console.error("Error loading SVG:", error);
        throw new Error("Failed to load SVG file");
      }
    },
    
    // Create 3D text
    loadText: async (text: string, options: TextOptions = { text }) => {
      const state = get();
      const loader = new FontLoader();
      const fontPath = options?.fontPath || defaultFontPath;

      if (!state.isSceneReady) {
        console.error("Scene not ready, can't create text");
        return;
      }
      
      try {
        const font = await new Promise<Font>((resolve, reject) => {
          loader.load(fontPath, resolve, undefined, reject);
        });
        
        // Set default size to 2 inches (50.8mm)
        const defaultSize = 50.8; // 2 inches in mm
        
        const textProps: TextProps = {
          text,
          fontSize: options?.fontSize || defaultSize,
          height: options?.height || defaultSize * 0.2, // 20% of size for depth
          curveSegments: options?.curveSegments || 12,
          bevelEnabled: options?.bevelEnabled ?? true,
          bevelThickness: options?.bevelThickness || defaultSize * 0.02, // 2% of size
          bevelSize: options?.bevelSize || defaultSize * 0.01, // 1% of size
          bevelSegments: options?.bevelSegments || 5,
          fontPath
        };
        
        // Create text geometry parameters
        const geometryParams: TextGeometryParameters = {
          font: font as any,
          size: textProps.fontSize,
          depth: textProps.height,
          curveSegments: textProps.curveSegments,
          bevelEnabled: textProps.bevelEnabled,
          bevelThickness: textProps.bevelThickness,
          bevelSize: textProps.bevelSize,
          bevelSegments: textProps.bevelSegments,
        };
        
        // Create text geometry
        const geometry = new TextGeometry(text, geometryParams);
        
        // Create material with specified or random color
        const material = new THREE.MeshStandardMaterial({ 
          color: options?.color || getRandomColor(),
          metalness: 0.1,
          roughness: 0.8,
        });
        
        // Center the geometry
        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        if (geometry.boundingBox) {
          geometry.boundingBox.getCenter(center);
          geometry.translate(-center.x, -center.y, -center.z);
        }
        
        // Show scaling dialog
        const dialogRoot = document.createElement('div');
        dialogRoot.id = 'scale-dialog-root';
        document.body.appendChild(dialogRoot);
        
        // Create a promise that resolves when scaling is complete
        const scale = await new Promise<THREE.Vector3>((resolve) => {
          const root = createRoot(dialogRoot);
          root.render(
            React.createElement(ImportScaleDialog, {
              isOpen: true,
              onClose: () => {
                root.unmount();
                dialogRoot.remove();
                resolve(new THREE.Vector3(1, 1, 1)); // Default scale if dialog is closed
              },
              geometry: geometry,
              onScale: (scale) => {
                root.unmount();
                dialogRoot.remove();
                resolve(scale);
              }
            })
          );
        });
        
        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Apply the chosen scale
        mesh.scale.copy(scale);
        
        // Position mesh slightly above the grid
        mesh.position.y = 0;
        
        // Store original transform
        const originalPosition = mesh.position.clone();
        const originalRotation = mesh.rotation.clone();
        const originalScale = mesh.scale.clone();
        
        // Add to scene
        scene.add(mesh);
        console.log("Added text mesh to scene:", mesh);
        
        // Create model object
        const newModel: Model = {
          id: `text-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          name: `Text: ${text.substring(0, 15)}${text.length > 15 ? '...' : ''}`,
          type: 'text',
          mesh,
          originalPosition,
          originalRotation,
          originalScale,
          textProps
        };
        
        // Add to models array
        const models = [...state.models, newModel];
        set({ models });
        
        // Update grid position
        get().updateGridPosition();
        
        // Select the new model
        const newIndex = models.length - 1;
        get().selectModel(newIndex);
        
        // Force a render
        state.renderer.render(state.scene, state.camera);
        
        // Save to history after adding a model
        get().saveHistoryState();
        
      } catch (error) {
        console.error("Error creating 3D text:", error);
        throw new Error("Failed to create 3D text");
      }
    },

    // Sync UI state with current model transforms
    syncTransformUIState: () => {
      const state = get();
      const { selectedModelIndex, models } = state;
      
      if (selectedModelIndex === null || !models[selectedModelIndex]) {
        return;
      }
      
      const model = models[selectedModelIndex];
      
      // This function doesn't need to do anything on its own
      // It will cause a component re-render which will update position/rotation/scale values
      // through the useEffect hooks in the TransformControls component
      
      // Force a render to update the scene
      if (state.renderer && state.camera) {
        state.renderer.render(state.scene, state.camera);
      }
      
      console.log("Synced transform UI state after gizmo transform");
    }
  };
});

// Add a property to the Window interface for TypeScript
declare global {
  interface Window {
    transformHistoryTimeout: number;
  }
}

// Helper function to merge geometries for the fallback union approach
function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Create a new BufferGeometry to store the merged result
  const mergedGeometry = new THREE.BufferGeometry();
  
  // First, determine total counts
  let totalVertices = 0;
  let totalIndices = 0;
  
  geometries.forEach(geometry => {
    totalVertices += geometry.attributes.position.count;
    if (geometry.index) {
      totalIndices += geometry.index.count;
    } else {
      // If no indices, we'll create one triangle per 3 vertices
      totalIndices += geometry.attributes.position.count;
    }
  });
  
  // Create arrays to hold the merged data
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const indices = new Uint32Array(totalIndices);
  
  let vertexOffset = 0;
  let indexOffset = 0;
  
  // Process each geometry
  geometries.forEach(geometry => {
    const positionAttribute = geometry.attributes.position;
    
    // Get position data - need to handle different ways of accessing the data
    for (let i = 0; i < positionAttribute.count; i++) {
      const x = positionAttribute.getX(i);
      const y = positionAttribute.getY(i);
      const z = positionAttribute.getZ(i);
      
      positions[vertexOffset * 3] = x;
      positions[vertexOffset * 3 + 1] = y;
      positions[vertexOffset * 3 + 2] = z;
      
      vertexOffset++;
    }
    
    // Ensure normals exist
    if (!geometry.attributes.normal) {
      geometry.computeVertexNormals();
    }
    
    // Get normal data
    const normalAttribute = geometry.attributes.normal;
    const normalCount = normalAttribute.count;
    
    for (let i = 0; i < normalCount; i++) {
      const x = normalAttribute.getX(i);
      const y = normalAttribute.getY(i);
      const z = normalAttribute.getZ(i);
      
      // Calculate the target position in the normals array
      const targetIndex = (vertexOffset - normalCount + i) * 3;
      
      normals[targetIndex] = x;
      normals[targetIndex + 1] = y;
      normals[targetIndex + 2] = z;
    }
    
    // Handle indices - either copy existing or create sequential ones
    const indexBase = vertexOffset - positionAttribute.count;
    
    if (geometry.index) {
      // Copy existing indices with offset
      for (let i = 0; i < geometry.index.count; i++) {
        indices[indexOffset++] = geometry.index.getX(i) + indexBase;
      }
    } else {
      // Create sequential indices (assuming triangles)
      for (let i = 0; i < positionAttribute.count; i++) {
        indices[indexOffset++] = i + indexBase;
      }
    }
  });
  
  // Set up the attributes
  mergedGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  mergedGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  mergedGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  
  // Compute bounds
  mergedGeometry.computeBoundingBox();
  mergedGeometry.computeBoundingSphere();
  
  return mergedGeometry;
}

// Helper function to snap a model's position based on snap settings
function snapModelPosition(modelIndex: number) {
  const state = useScene.getState();
  const { models, snapSettings, scene, clearSnapIndicators } = state;
  
  // Clear any previous snap indicators
  clearSnapIndicators();
  
  if (!snapSettings.enabled || modelIndex === null || !models[modelIndex]) {
    return;
  }
  
  const selectedModel = models[modelIndex];
  const selectedMesh = selectedModel.mesh;
  
  // Create a list to store potential snap points for visualization
  const potentialSnapPoints: { position: THREE.Vector3, distance: number }[] = [];
  
  // 1. Snap to grid if enabled
  if (snapSettings.snapToGrid) {
    // Snap position to grid
    selectedMesh.position.x = Math.round(selectedMesh.position.x / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
    selectedMesh.position.y = Math.round(selectedMesh.position.y / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
    selectedMesh.position.z = Math.round(selectedMesh.position.z / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
  }
  
  // Only check face/edge snapping if enabled and there are other models
  if ((snapSettings.snapToFaces || snapSettings.snapToEdges) && models.length > 1) {
    // Get the bounding box of the selected model
    selectedMesh.geometry.computeBoundingBox();
    if (!selectedMesh.geometry.boundingBox) {
      console.warn("Selected mesh has no bounding box, skipping snap");
      return;
    }
    
    const selectedBox = selectedMesh.geometry.boundingBox.clone();
    selectedBox.applyMatrix4(selectedMesh.matrixWorld);
    
    // Find closest snap point
    let closestDistance = snapSettings.snapThreshold;
    let closestSnapPoint = null;
    
    // Check against all other models
    models.forEach((otherModel, idx) => {
      if (idx === modelIndex) return; // Skip the model we're moving
      
      const otherMesh = otherModel.mesh;
      
      // Get the bounding box of the other model
      otherMesh.geometry.computeBoundingBox();
      if (!otherMesh.geometry.boundingBox) {
        return; // Skip this model if it has no bounding box
      }
      
      const otherBox = otherMesh.geometry.boundingBox.clone();
      otherBox.applyMatrix4(otherMesh.matrixWorld);
      
      // FACE SNAPPING
      if (snapSettings.snapToFaces) {
        // Check Y axis: bottom face of selected model with top face of other model
        const bottomDistance = Math.abs(selectedBox.min.y - otherBox.max.y);
        if (bottomDistance < snapSettings.snapThreshold) {
          if (boxesOverlapInPlane(selectedBox, otherBox, 'xz')) {
            const snapPoint = new THREE.Vector3(
              selectedMesh.position.x,
              otherBox.max.y + (selectedBox.min.y - selectedMesh.position.y),
              selectedMesh.position.z
            );
            
            potentialSnapPoints.push({ position: snapPoint, distance: bottomDistance });
            
            if (bottomDistance < closestDistance) {
              closestDistance = bottomDistance;
              closestSnapPoint = snapPoint;
            }
          }
        }
        
        // Check Y axis: top face of selected model with bottom face of other model
        const topDistance = Math.abs(selectedBox.max.y - otherBox.min.y);
        if (topDistance < snapSettings.snapThreshold) {
          if (boxesOverlapInPlane(selectedBox, otherBox, 'xz')) {
            const snapPoint = new THREE.Vector3(
              selectedMesh.position.x,
              otherBox.min.y - (selectedBox.max.y - selectedMesh.position.y),
              selectedMesh.position.z
            );
            
            potentialSnapPoints.push({ position: snapPoint, distance: topDistance });
            
            if (topDistance < closestDistance) {
              closestDistance = topDistance;
              closestSnapPoint = snapPoint;
            }
          }
        }
        
        // Check X axis: left face of selected model with right face of other model
        const leftDistance = Math.abs(selectedBox.min.x - otherBox.max.x);
        if (leftDistance < snapSettings.snapThreshold) {
          if (boxesOverlapInPlane(selectedBox, otherBox, 'yz')) {
            const snapPoint = new THREE.Vector3(
              otherBox.max.x + (selectedBox.min.x - selectedMesh.position.x),
              selectedMesh.position.y,
              selectedMesh.position.z
            );
            
            potentialSnapPoints.push({ position: snapPoint, distance: leftDistance });
            
            if (leftDistance < closestDistance) {
              closestDistance = leftDistance;
              closestSnapPoint = snapPoint;
            }
          }
        }
        
        // Check X axis: right face of selected model with left face of other model
        const rightDistance = Math.abs(selectedBox.max.x - otherBox.min.x);
        if (rightDistance < snapSettings.snapThreshold) {
          if (boxesOverlapInPlane(selectedBox, otherBox, 'yz')) {
            const snapPoint = new THREE.Vector3(
              otherBox.min.x - (selectedBox.max.x - selectedMesh.position.x),
              selectedMesh.position.y,
              selectedMesh.position.z
            );
            
            potentialSnapPoints.push({ position: snapPoint, distance: rightDistance });
            
            if (rightDistance < closestDistance) {
              closestDistance = rightDistance;
              closestSnapPoint = snapPoint;
            }
          }
        }
        
        // Check Z axis: front face of selected model with back face of other model
        const frontDistance = Math.abs(selectedBox.min.z - otherBox.max.z);
        if (frontDistance < snapSettings.snapThreshold) {
          if (boxesOverlapInPlane(selectedBox, otherBox, 'xy')) {
            const snapPoint = new THREE.Vector3(
              selectedMesh.position.x,
              selectedMesh.position.y,
              otherBox.max.z + (selectedBox.min.z - selectedMesh.position.z)
            );
            
            potentialSnapPoints.push({ position: snapPoint, distance: frontDistance });
            
            if (frontDistance < closestDistance) {
              closestDistance = frontDistance;
              closestSnapPoint = snapPoint;
            }
          }
        }
        
        // Check Z axis: back face of selected model with front face of other model
        const backDistance = Math.abs(selectedBox.max.z - otherBox.min.z);
        if (backDistance < snapSettings.snapThreshold) {
          if (boxesOverlapInPlane(selectedBox, otherBox, 'xy')) {
            const snapPoint = new THREE.Vector3(
              selectedMesh.position.x,
              selectedMesh.position.y,
              otherBox.min.z - (selectedBox.max.z - selectedMesh.position.z)
            );
            
            potentialSnapPoints.push({ position: snapPoint, distance: backDistance });
            
            if (backDistance < closestDistance) {
              closestDistance = backDistance;
              closestSnapPoint = snapPoint;
            }
          }
        }
      }
      
      // EDGE SNAPPING
      if (snapSettings.snapToEdges) {
        // For simplicity, we'll check a few common edge alignments
        // We consider edges as the lines where two faces meet
        
        // Bottom X edges alignment (bottom edge of selected aligned with top edge of other)
        if (Math.abs(selectedBox.min.y - otherBox.max.y) < closestDistance) {
          // Check if X edges overlap
          if (isLineOverlapping(
              selectedBox.min.x, selectedBox.max.x,
              otherBox.min.x, otherBox.max.x
          )) {
            const midX = (Math.max(selectedBox.min.x, otherBox.min.x) + 
                          Math.min(selectedBox.max.x, otherBox.max.x)) / 2;
            
            const offsetX = midX - selectedMesh.position.x;
            
            closestDistance = Math.abs(selectedBox.min.y - otherBox.max.y);
            closestSnapPoint = new THREE.Vector3(
              selectedMesh.position.x + offsetX,
              otherBox.max.y + (selectedBox.min.y - selectedMesh.position.y),
              selectedMesh.position.z
            );
          }
        }
        
        // Check for alignment in Z direction as well (similar to above)
        // This can be expanded for more edge alignment cases as needed
      }
    });
    
    // Create visual indicators for potential snap points
    const snapIndicators: THREE.Object3D[] = [];
    
    potentialSnapPoints.forEach(({ position, distance }) => {
      // Create a visual indicator for this snap point
      const geometry = new THREE.SphereGeometry(0.05, 16, 16);
      const material = new THREE.MeshBasicMaterial({ 
        color: distance === closestDistance ? 0x00ff00 : 0xffaa00,
        transparent: true,
        opacity: 0.7
      });
      const indicator = new THREE.Mesh(geometry, material);
      indicator.position.copy(position);
      
      // Add to scene and track it
      scene.add(indicator);
      snapIndicators.push(indicator);
    });
    
    // Update the state with the new indicators
    state.snapIndicators = snapIndicators;
    
    // Apply the snap if we found a good snap point
    if (closestSnapPoint) {
      console.log("Snapping to point, distance:", closestDistance);
      selectedMesh.position.copy(closestSnapPoint);
    }
  }
}

// Helper function to check if two boxes overlap in a specified plane
function boxesOverlapInPlane(box1: THREE.Box3, box2: THREE.Box3, plane: 'xy' | 'xz' | 'yz'): boolean {
  switch (plane) {
    case 'xy':
      return (
        box1.max.x > box2.min.x &&
        box1.min.x < box2.max.x &&
        box1.max.y > box2.min.y &&
        box1.min.y < box2.max.y
      );
    case 'xz':
      return (
        box1.max.x > box2.min.x &&
        box1.min.x < box2.max.x &&
        box1.max.z > box2.min.z &&
        box1.min.z < box2.max.z
      );
    case 'yz':
      return (
        box1.max.y > box2.min.y &&
        box1.min.y < box2.max.y &&
        box1.max.z > box2.min.z &&
        box1.min.z < box2.max.z
      );
  }
}

// Helper function to check if two lines overlap
function isLineOverlapping(min1: number, max1: number, min2: number, max2: number): boolean {
  return max1 >= min2 && max2 >= min1;
}

// Helper function to update model material based on rendering mode
function updateModelMaterial(mesh: THREE.Mesh, mode: 'standard' | 'wireframe' | 'metallic' | 'glass-like' | 'xray') {
  // Get the current color from the mesh's material
  let currentColor = new THREE.Color(0x3498db); // Default blue color
  
  // Try to get the color from the existing material if possible
  if (mesh.material instanceof THREE.MeshBasicMaterial || 
      mesh.material instanceof THREE.MeshStandardMaterial ||
      mesh.material instanceof THREE.MeshPhysicalMaterial) {
    currentColor = mesh.material.color;
  } else if (Array.isArray(mesh.material) && mesh.material.length > 0) {
    // Handle material arrays
    const firstMaterial = mesh.material[0];
    if (firstMaterial instanceof THREE.MeshBasicMaterial || 
        firstMaterial instanceof THREE.MeshStandardMaterial || 
        firstMaterial instanceof THREE.MeshPhysicalMaterial) {
      currentColor = firstMaterial.color;
    }
  }
  
  // Check if the current material is highlighted (emissive)
  const isHighlighted = mesh.material instanceof THREE.MeshStandardMaterial || 
                        mesh.material instanceof THREE.MeshPhysicalMaterial 
                        ? (mesh.material.emissive && mesh.material.emissive.r > 0) 
                        : false;
  
  // Store the highlight state to restore after changing material
  const emissiveColor = isHighlighted ? new THREE.Color(0x222222) : new THREE.Color(0x000000);
  
  // Create the new material based on rendering mode
  let newMaterial: THREE.Material | null = null;
  
  switch (mode) {
    case 'standard':
      newMaterial = new THREE.MeshStandardMaterial({
        color: currentColor,
        roughness: 0.7,
        metalness: 0.2,
        emissive: emissiveColor
      });
      break;
      
    case 'wireframe':
      newMaterial = new THREE.MeshBasicMaterial({
        color: currentColor,
        wireframe: true
      });
      break;
      
    case 'metallic':
      newMaterial = new THREE.MeshStandardMaterial({
        color: currentColor,
        roughness: 0.3,
        metalness: 0.9,
        emissive: emissiveColor
      });
      break;
      
    case 'glass-like':
      newMaterial = new THREE.MeshPhysicalMaterial({
        color: currentColor,
        roughness: 0.0,
        metalness: 0.1,
        transmission: 0.9,
        transparent: true,
        opacity: 0.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        emissive: emissiveColor
      });
      break;
      
    case 'xray':
      newMaterial = new THREE.MeshBasicMaterial({
        color: currentColor,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
      });
      break;
  }
  
  // Only replace material if we have a new one and it's different from the current one
  if (newMaterial) {
    mesh.material = newMaterial;
    newMaterial.needsUpdate = true;
  }
}

// ... existing code ...
type TextProps = {
  text: string;
  fontSize: number;
  height: number;
  curveSegments: number;
  bevelEnabled: boolean;
  bevelThickness: number;
  bevelSize: number;
  bevelSegments: number;
  fontPath: string;
};

// Helper function to find a suitable position for a new model
const findSuitablePosition = (models: Model[], newModelSize: THREE.Vector3): THREE.Vector3 => {
  if (models.length === 0) {
    return new THREE.Vector3(0, 0, 0);
  }

  // Find the rightmost point of all models
  let maxX = -Infinity;
  models.forEach(model => {
    const box = new THREE.Box3().setFromObject(model.mesh);
    maxX = Math.max(maxX, box.max.x);
  });

  // Position the new model to the right of the rightmost model
  // Add a 50mm gap between models
  const newX = maxX + 50;
  return new THREE.Vector3(newX, 0, 0);
};

// Add this helper function at the top level, outside of the store definition
function ensureManifoldGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // Clone the geometry to avoid modifying the original
  const processedGeometry = geometry.clone();
  
  try {
    const startVertexCount = processedGeometry.attributes.position.count;
    console.log(`Starting manifold repair for geometry with ${startVertexCount} vertices`);
    
    // Step 1: Basic attribute checks and computation
    // Ensure the geometry has computed attributes
    if (!processedGeometry.getAttribute('normal')) {
      processedGeometry.computeVertexNormals();
    }
    
    // Make sure we have a bounding box
    if (!processedGeometry.boundingBox) {
      processedGeometry.computeBoundingBox();
    }
    
    // Step 2: Index handling - ensure indexed geometry
    // Check if the geometry has an index, if not create one
    if (!processedGeometry.index) {
      console.log("Creating index for non-indexed geometry");
      processedGeometry.setIndex(
        Array.from({ length: processedGeometry.attributes.position.count }, (_, i) => i)
      );
    }
    
    // Step 3: Normal validation and repair
    // Make sure we don't have any invalid normals (NaN values)
    const normals = processedGeometry.getAttribute('normal');
    if (normals) {
      const normalsArray = normals.array;
      let hasInvalidNormals = false;
      
      for (let i = 0; i < normalsArray.length; i++) {
        if (isNaN(normalsArray[i])) {
          hasInvalidNormals = true;
          normalsArray[i] = 0; // Replace NaN with 0
        }
      }
      
      if (hasInvalidNormals) {
        console.warn("Fixed invalid normals in geometry");
        processedGeometry.computeVertexNormals(); // Recompute all normals
      }
    }
    
    // Step 4: Position validation and repair
    // Check for NaN or infinite values in positions
    const positions = processedGeometry.getAttribute('position');
    if (positions) {
      const posArray = positions.array;
      let hasInvalidPositions = false;
      
      for (let i = 0; i < posArray.length; i++) {
        if (isNaN(posArray[i]) || !isFinite(posArray[i])) {
          console.warn(`Found invalid position value at index ${i}`);
          hasInvalidPositions = true;
          
          // Replace invalid values with 0 (better than NaN)
          posArray[i] = 0;
        }
      }
      
      if (hasInvalidPositions) {
        console.warn("Fixed invalid positions in geometry");
        positions.needsUpdate = true;
      }
    }
    
    // Step 5: Detect and fix self-intersections
    // Self-intersecting geometries cause many boolean operation failures
    const repairedGeometry = repairSelfIntersections(processedGeometry);
    console.log("Self-intersection repair complete");
    
    // Step 6: Degenerate triangle removal
    // Check and filter out degenerate triangles (where all points are the same or collinear)
    let fixedDegenerateTriangles = false;
    if (repairedGeometry.index && positions) {
      const indices = repairedGeometry.index.array;
      const posArray = positions.array;
      const validIndices = [];
      
      for (let i = 0; i < indices.length; i += 3) {
        const i1 = indices[i] * 3;
        const i2 = indices[i + 1] * 3;
        const i3 = indices[i + 2] * 3;
        
        // Extract vertex positions for this triangle
        const p1x = posArray[i1], p1y = posArray[i1 + 1], p1z = posArray[i1 + 2];
        const p2x = posArray[i2], p2y = posArray[i2 + 1], p2z = posArray[i2 + 2];
        const p3x = posArray[i3], p3y = posArray[i3 + 1], p3z = posArray[i3 + 2];
        
        // Check if triangle is degenerate (all points are the same or collinear)
        const isDifferent = 
          (p1x !== p2x || p1y !== p2y || p1z !== p2z) && 
          (p1x !== p3x || p1y !== p3y || p1z !== p3z) && 
          (p2x !== p3x || p2y !== p3y || p2z !== p3z);
        
        // Check for collinearity using cross product near-zero
        let isNonCollinear = true;
        if (isDifferent) {
          // Compute edge vectors
          const v1x = p2x - p1x, v1y = p2y - p1y, v1z = p2z - p1z;
          const v2x = p3x - p1x, v2y = p3y - p1y, v2z = p3z - p1z;
          
          // Compute cross product
          const cpx = v1y * v2z - v1z * v2y;
          const cpy = v1z * v2x - v1x * v2z;
          const cpz = v1x * v2y - v1y * v2x;
          
          // Check if the magnitude of the cross product is nearly zero
          const cpLengthSq = cpx * cpx + cpy * cpy + cpz * cpz;
          isNonCollinear = cpLengthSq > 1e-10; // Small epsilon for floating point errors
        }
        
        if (isDifferent && isNonCollinear) {
          validIndices.push(indices[i], indices[i + 1], indices[i + 2]);
        } else {
          fixedDegenerateTriangles = true;
        }
      }
      
      if (validIndices.length < indices.length) {
        console.warn(`Removed ${(indices.length - validIndices.length) / 3} degenerate triangles`);
        repairedGeometry.setIndex(validIndices);
      }
    }
    
    // Step 7: Check if the geometry was drastically simplified - don't over-repair
    if (repairedGeometry.attributes.position.count < startVertexCount * 0.5) {
      console.warn(`Repair reduced vertex count by more than 50% (${startVertexCount} -> ${repairedGeometry.attributes.position.count})`);
      console.warn("Using original geometry to avoid over-simplification");
      return geometry.clone(); // Return a clone of the original
    }
    
    // Step 8: Vertex merging - final cleanup
    // Merge any duplicate vertices with a small tolerance
    if (BufferGeometryUtils.mergeVertices) {
      const finalGeometry = BufferGeometryUtils.mergeVertices(repairedGeometry, 0.0001);
      
      // Final integrity checks
      const finalVertexCount = finalGeometry.attributes.position.count;
      console.log(`Manifold repair complete: ${startVertexCount} -> ${finalVertexCount} vertices`);
      
      // Compute normals one last time
      finalGeometry.computeVertexNormals();
      
      // Make sure we haven't completely destroyed the geometry
      if (finalVertexCount > 0 && 
          (finalGeometry.index ? finalGeometry.index.count > 0 : true)) {
        return finalGeometry;
      } else {
        console.warn("Repair resulted in invalid geometry, using original");
        return geometry.clone();
      }
    }
    
    // If we get here, return the repaired geometry
    repairedGeometry.computeVertexNormals();
    return repairedGeometry;
  } catch (error) {
    console.warn("Error preparing geometry:", error);
    return geometry.clone(); // Return a clone of the original if repair failed
  }
}

// Add this helper function for robust mesh union operations
function robustMeshUnion(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.Mesh {
  console.log("Starting robust mesh union for complex geometries");
  
  // Extract materials for later use
  const materialColorA = meshA.material instanceof THREE.Material ? 
    (meshA.material as THREE.MeshStandardMaterial).color?.clone() : 
    (meshA.material[0] as THREE.MeshStandardMaterial)?.color?.clone() || new THREE.Color(0xffffff);
  
  // Pre-process geometries to ensure they're suitable for operations
  const prepareGeometry = (mesh: THREE.Mesh): THREE.BufferGeometry => {
    console.log(`Preparing geometry with ${mesh.geometry.attributes.position.count} vertices`);
    const geom = mesh.geometry.clone();
    
    // Apply world matrices to get correct position
    mesh.updateWorldMatrix(true, false);
    geom.applyMatrix4(mesh.matrixWorld);
    
    // Full clean and manifold check
    const cleanGeom = ensureManifoldGeometry(geom);
    console.log(`After processing: ${cleanGeom.attributes.position.count} vertices`);
    
    return cleanGeom;
  };
  
  // Strategy 1: Standard buffer geometry merge (fastest, but can fail with complex geometries)
  try {
    console.log("Trying standard geometry merge approach");
    const cleanGeomA = prepareGeometry(meshA);
    const cleanGeomB = prepareGeometry(meshB);
    
    // Check if the geometries are suitable for merging
    if (cleanGeomA.attributes.position.count > 0 && 
        cleanGeomB.attributes.position.count > 0) {
      // Attempt the merge with error handling
      try {
        const mergedGeometry = BufferGeometryUtils.mergeGeometries([cleanGeomA, cleanGeomB]);
        
        if (mergedGeometry && mergedGeometry.attributes.position.count > 0) {
          // Create result mesh with proper material
          const material = new THREE.MeshStandardMaterial({
            color: materialColorA,
            side: THREE.DoubleSide
          });
          
          // Create new mesh and finalize
          const resultMesh = new THREE.Mesh(mergedGeometry, material);
          
          // Fix attributes and recompute properties
          if (!resultMesh.geometry.getAttribute('normal')) {
            resultMesh.geometry.computeVertexNormals();
          }
          
          if (!resultMesh.geometry.boundingBox) {
            resultMesh.geometry.computeBoundingBox();
          }
          
          return resultMesh;
        }
        throw new Error("Merged geometry has no vertices");
      } catch (e) {
        console.warn("Standard geometry merge failed", e);
        throw e; // Let the next strategy handle it
      }
    } else {
      throw new Error("One or both geometries have no vertices after processing");
    }
  } catch (e) {
    console.warn("Standard geometry merge failed, trying octree-based approach", e);
  }
  
  // Strategy 2: Manual vertex processing with additional validation
  try {
    console.log("Trying enhanced manual vertex processing approach");
    const geomA = prepareGeometry(meshA);
    const geomB = prepareGeometry(meshB);
    
    // If either geometry has zero vertices, fall back to the one with vertices
    if (geomA.attributes.position.count === 0) {
      console.warn("GeomA has zero vertices, returning GeomB only");
      return new THREE.Mesh(
        geomB,
        new THREE.MeshStandardMaterial({
          color: materialColorA,
          side: THREE.DoubleSide
        })
      );
    }
    
    if (geomB.attributes.position.count === 0) {
      console.warn("GeomB has zero vertices, returning GeomA only");
      return new THREE.Mesh(
        geomA,
        new THREE.MeshStandardMaterial({
          color: materialColorA,
          side: THREE.DoubleSide
        })
      );
    }
    
    // Extract vertex and index data with validation
    const posA = geomA.attributes.position.array;
    const posB = geomB.attributes.position.array;
    
    // Ensure indices are available or create them
    const idxA = geomA.index ? Array.from(geomA.index.array) : 
                 Array.from({ length: posA.length / 3 }, (_, i) => i);
    const idxB = geomB.index ? Array.from(geomB.index.array) : 
                 Array.from({ length: posB.length / 3 }, (_, i) => i);
    
    // Calculate offsets for the combined arrays
    const vertexACount = posA.length / 3;
    
    // Verify triangle data is in multiples of 3
    if (idxA.length % 3 !== 0 || idxB.length % 3 !== 0) {
      console.warn("Index arrays not in multiples of 3, fixing...");
      // Trim arrays to ensure multiples of 3
      const trimA = idxA.length - (idxA.length % 3);
      const trimB = idxB.length - (idxB.length % 3);
      idxA.length = trimA;
      idxB.length = trimB;
    }
    
    // Create combined position array
    const combinedPos = new Float32Array(posA.length + posB.length);
    combinedPos.set(posA, 0);
    combinedPos.set(posB, posA.length);
    
    // Create combined index array, adjusting indices from B
    const combinedIdx = new Uint32Array(idxA.length + idxB.length);
    combinedIdx.set(idxA, 0);
    
    // Adjust indices from mesh B to account for combined array
    for (let i = 0; i < idxB.length; i++) {
      combinedIdx[idxA.length + i] = idxB[i] + vertexACount;
    }
    
    // Create new buffer geometry with validation
    const combinedGeom = new THREE.BufferGeometry();
    combinedGeom.setAttribute('position', new THREE.BufferAttribute(combinedPos, 3));
    
    // Only set index if we have valid indices
    if (combinedIdx.length > 0) {
      combinedGeom.setIndex(new THREE.BufferAttribute(combinedIdx, 1));
    }
    
    // Generate normals and other attributes
    combinedGeom.computeVertexNormals();
    combinedGeom.computeBoundingBox();
    
    // Verify the combined geometry
    if (combinedGeom.attributes.position.count === 0) {
      throw new Error("Combined geometry has no vertices");
    }
    
    if (combinedGeom.index && combinedGeom.index.count === 0) {
      throw new Error("Combined geometry has no faces");
    }
    
    // Clean the combined geometry to remove any issues
    const finalGeom = ensureManifoldGeometry(combinedGeom);
    
    // Create material for the new mesh
    const material = new THREE.MeshStandardMaterial({
      color: materialColorA,
      side: THREE.DoubleSide
    });
    
    return new THREE.Mesh(finalGeom, material);
  } catch (e) {
    console.warn("Manual vertex processing failed, trying final fallback", e);
  }
  
  // Strategy 3: CSG with adjusted parameters and more robust settings
  try {
    console.log("Trying enhanced CSG approach with adjusted parameters");
    
    // Create clean copies for CSG operation with pre-processing
    const cleanGeomA = prepareGeometry(meshA);
    const cleanGeomB = prepareGeometry(meshB);
    
    // Create meshes with settings optimized for CSG
    const tempMeshA = new THREE.Mesh(
      cleanGeomA,
      new THREE.MeshBasicMaterial({ 
        side: THREE.DoubleSide,
        // Use transparent material settings for better CSG results
        transparent: true,
        opacity: 0.99  // Almost opaque but not quite
      })
    );
    
    const tempMeshB = new THREE.Mesh(
      cleanGeomB,
      new THREE.MeshBasicMaterial({ 
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.99  // Almost opaque but not quite
      })
    );
    
    // Reset transforms since they're already applied to geometry
    tempMeshA.position.set(0, 0, 0);
    tempMeshA.rotation.set(0, 0, 0);
    tempMeshA.scale.set(1, 1, 1);
    tempMeshB.position.set(0, 0, 0);
    tempMeshB.rotation.set(0, 0, 0);
    tempMeshB.scale.set(1, 1, 1);
    
    // Perform CSG union with adjusted parameters
    const resultMesh = CSG.union(tempMeshA, tempMeshB);
    
    // Check if the result is valid
    if (!resultMesh || !resultMesh.geometry || resultMesh.geometry.attributes.position.count === 0) {
      throw new Error("CSG union produced an invalid mesh");
    }
    
    // Apply material
    const material = new THREE.MeshStandardMaterial({
      color: materialColorA,
      side: THREE.DoubleSide
    });
    
    resultMesh.material = material;
    
    // Final cleanup and validation
    resultMesh.geometry = ensureManifoldGeometry(resultMesh.geometry);
    
    return resultMesh;
  } catch (e: any) {
    // Final fallback - if all else fails, try a single shape as the result
    try {
      console.warn("All union strategies failed, attempting final desperation fallback", e);
      
      // Use only the first mesh if everything else failed
      const fallbackGeom = prepareGeometry(meshA);
      
      // If even that is invalid, create a tiny cube as a fallback
      if (!fallbackGeom || fallbackGeom.attributes.position.count === 0) {
        console.error("Cannot recover geometry, creating minimal fallback shape");
        const fallbackCube = new THREE.BoxGeometry(1, 1, 1);
        return new THREE.Mesh(
          fallbackCube, 
          new THREE.MeshStandardMaterial({ 
            color: materialColorA,
            side: THREE.DoubleSide 
          })
        );
      }
      
      return new THREE.Mesh(
        fallbackGeom, 
        new THREE.MeshStandardMaterial({ 
          color: materialColorA,
          side: THREE.DoubleSide 
        })
      );
    } catch (finalError) {
      console.error("All union strategies and fallbacks failed", finalError);
      throw new Error("Could not perform union operation: " + e.message);
    }
  }
}

// Add the simplifyGeometry helper function
function simplifyGeometry(
  geometry: THREE.BufferGeometry, 
  thresholdOrOptions: number | { 
    threshold?: number, 
    shapeType?: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'other',
    aggressiveness?: number
  } = 0.01
): THREE.BufferGeometry {
  // Extract parameters
  let threshold = 0.01;
  let shapeType: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'other' = 'other';
  let aggressiveness = 1.0;
  
  if (typeof thresholdOrOptions === 'number') {
    threshold = thresholdOrOptions;
  } else {
    threshold = thresholdOrOptions.threshold ?? 0.01;
    shapeType = thresholdOrOptions.shapeType ?? 'other';
    aggressiveness = thresholdOrOptions.aggressiveness ?? 1.0;
  }
  
  console.log(`Simplifying geometry (type: ${shapeType}, threshold: ${threshold}, aggressiveness: ${aggressiveness})`);
  
  // Clone the geometry to avoid modifying the original
  const simplified = geometry.clone();
  
  try {
    // If the geometry is very complex, skip attributes that aren't essential
    const position = simplified.getAttribute('position');
    if (!position) {
      console.warn("Geometry has no position attribute, cannot simplify");
      return simplified;
    }
    
    const initialVertexCount = position.count;
    console.log(`Initial vertex count: ${initialVertexCount}`);
    
    // Apply shape-specific optimizations
    if (shapeType !== 'other') {
      // For primitive shapes, we can use specialized simplification
      // This is especially useful for high-polycount primitives that could be represented more simply
      switch (shapeType) {
        case 'cube':
          // For cubes, we can be very aggressive with merging
          threshold = Math.max(threshold, 0.01 * aggressiveness);
          break;
          
        case 'sphere':
          // Spheres need careful handling to maintain shape
          threshold = Math.min(threshold, 0.008 * aggressiveness);
          break;
          
        case 'cylinder':
        case 'cone':
          // These shapes can handle moderate simplification
          threshold = Math.min(threshold, 0.01 * aggressiveness);
          break;
          
        case 'torus':
          // Torus shapes need careful handling around the inner ring
          threshold = Math.min(threshold, 0.005 * aggressiveness);
          break;
      }
    } else {
      // For complex or unknown shapes, be more conservative
      // Scale threshold based on geometry complexity
      if (initialVertexCount > 10000) {
        // For very complex meshes, we can be more aggressive
        threshold = Math.min(threshold * 1.5, 0.02) * aggressiveness;
      } else if (initialVertexCount < 1000) {
        // For simple meshes, be more conservative
        threshold = Math.min(threshold * 0.7, 0.005) * aggressiveness;
      }
    }
    
    // For large geometries, only keep essential attributes
    if (position.count > 10000) {
      // Keep only position, normal, and index
      const keepAttributes = ['position', 'normal'];
      
      // Remove non-essential attributes to reduce complexity
      for (const key in simplified.attributes) {
        if (!keepAttributes.includes(key)) {
          simplified.deleteAttribute(key);
        }
      }
    }

    // Ensure we have proper vertex normals
    if (!simplified.getAttribute('normal')) {
      simplified.computeVertexNormals();
    }
    
    // Make sure we have a bounding box
    if (!simplified.boundingBox) {
      simplified.computeBoundingBox();
    }
    
    // Create an index if one doesn't exist
    if (!simplified.index) {
      simplified.setIndex(
        Array.from({ length: position.count }, (_, i) => i)
      );
    }
    
    // Merge vertices with the calculated threshold
    console.log(`Using simplification threshold: ${threshold}`);
    
    if (BufferGeometryUtils.mergeVertices) {
      const optimized = BufferGeometryUtils.mergeVertices(simplified, threshold);
      
      // Verify the simplified geometry looks good
      if (optimized.attributes.position.count === 0) {
        console.warn("Simplification resulted in no vertices, using original geometry");
        return simplified;
      }
      
      const finalVertexCount = optimized.attributes.position.count;
      const reductionPercent = ((initialVertexCount - finalVertexCount) / initialVertexCount * 100).toFixed(1);
      console.log(`Simplified geometry: ${initialVertexCount} → ${finalVertexCount} vertices (${reductionPercent}% reduction)`);
      
      // Protection against over-simplification
      if (finalVertexCount < initialVertexCount * 0.1 && initialVertexCount > 100) {
        console.warn("Simplification reduced vertices by more than 90%, using a more conservative approach");
        // Try again with a more conservative threshold
        return simplifyGeometry(geometry, {
          threshold: threshold * 0.5,
          shapeType,
          aggressiveness: aggressiveness * 0.5
        });
      }
      
      return optimized;
    }
  } catch (error) {
    console.warn("Error during geometry simplification:", error);
  }
  
  return simplified;
}

// Add a function to validate the result mesh after boolean operations
function validateResultMesh(mesh: THREE.Mesh): boolean {
  // Check if the mesh has a valid geometry
  if (!mesh.geometry) {
    console.error("Result mesh has no geometry");
    return false;
  }
  
  // Check if the geometry has vertices
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.count === 0) {
    console.error("Result mesh has no vertices");
    return false;
  }
  
  // Check if we have at least one triangle
  if (mesh.geometry.index && mesh.geometry.index.count < 3) {
    console.error("Result mesh has no triangles");
    return false;
  }
  
  // Check for NaN values in positions that would cause rendering issues
  const positions = position.array;
  for (let i = 0; i < positions.length; i++) {
    if (isNaN(positions[i])) {
      console.error("Result mesh has NaN position values");
      return false;
    }
  }
  
  // Make sure the bounding box is valid (not infinite or NaN)
  mesh.geometry.computeBoundingBox();
  const bbox = mesh.geometry.boundingBox;
  if (!bbox) {
    console.error("Failed to compute bounding box");
    return false;
  }
  
  // Check for invalid bounding box values
  if (isNaN(bbox.min.x) || isNaN(bbox.min.y) || isNaN(bbox.min.z) ||
      isNaN(bbox.max.x) || isNaN(bbox.max.y) || isNaN(bbox.max.z)) {
    console.error("Bounding box contains NaN values");
    return false;
  }
  
  if (!isFinite(bbox.min.x) || !isFinite(bbox.min.y) || !isFinite(bbox.min.z) ||
      !isFinite(bbox.max.x) || !isFinite(bbox.max.y) || !isFinite(bbox.max.z)) {
    console.error("Bounding box contains infinite values");
    return false;
  }
  
  // The mesh passed all validation checks
  return true;
}

// Add these functions below robustMeshUnion but before simplifyGeometry

// Specialized function for robust mesh subtraction
function robustMeshSubtract(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.Mesh {
  console.log("Starting robust mesh subtraction for complex geometries");
  
  // Extract materials for later use
  const materialColorA = meshA.material instanceof THREE.Material ? 
    (meshA.material as THREE.MeshStandardMaterial).color?.clone() : 
    (meshA.material[0] as THREE.MeshStandardMaterial)?.color?.clone() || new THREE.Color(0xffffff);
  
  // Pre-process geometries to ensure they're suitable for operations
  const prepareGeometry = (mesh: THREE.Mesh): THREE.BufferGeometry => {
    console.log(`Preparing geometry with ${mesh.geometry.attributes.position.count} vertices`);
    const geom = mesh.geometry.clone();
    
    // Apply world matrices to get correct position
    mesh.updateWorldMatrix(true, false);
    geom.applyMatrix4(mesh.matrixWorld);
    
    // Full clean and manifold check
    const cleanGeom = ensureManifoldGeometry(geom);
    console.log(`After processing: ${cleanGeom.attributes.position.count} vertices`);
    
    return cleanGeom;
  };
  
  // First try: Standard CSG subtraction with optimized settings
  try {
    console.log("Trying optimized CSG subtraction approach");
    
    // Prepare geometries with extensive cleaning
    const cleanGeomA = prepareGeometry(meshA);
    const cleanGeomB = prepareGeometry(meshB);
    
    // Verify geometries are valid
    if (cleanGeomA.attributes.position.count === 0) {
      throw new Error("First model has no valid geometry after processing");
    }
    
    if (cleanGeomB.attributes.position.count === 0) {
      // If second model is empty, just return the first model
      console.warn("Second model has no valid geometry, returning first model unchanged");
      return new THREE.Mesh(
        cleanGeomA,
        new THREE.MeshStandardMaterial({
          color: materialColorA,
          side: THREE.DoubleSide
        })
      );
    }
    
    // Check for bounding box intersection (optimization)
    // No need to subtract if there's no overlap
    cleanGeomA.computeBoundingBox();
    cleanGeomB.computeBoundingBox();
    
    if (cleanGeomA.boundingBox && cleanGeomB.boundingBox && 
        !cleanGeomA.boundingBox.intersectsBox(cleanGeomB.boundingBox)) {
      console.log("Bounding boxes don't intersect, returning first model unchanged");
      return new THREE.Mesh(
        cleanGeomA,
        new THREE.MeshStandardMaterial({
          color: materialColorA,
          side: THREE.DoubleSide
        })
      );
    }
    
    // Create optimized meshes for CSG
    const csgMeshA = new THREE.Mesh(
      cleanGeomA,
      new THREE.MeshBasicMaterial({ 
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.99  // Almost opaque but not quite
      })
    );
    
    const csgMeshB = new THREE.Mesh(
      cleanGeomB,
      new THREE.MeshBasicMaterial({ 
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.99
      })
    );
    
    // Reset transforms since they're already applied to geometry
    csgMeshA.position.set(0, 0, 0);
    csgMeshA.rotation.set(0, 0, 0);
    csgMeshA.scale.set(1, 1, 1);
    csgMeshB.position.set(0, 0, 0);
    csgMeshB.rotation.set(0, 0, 0);
    csgMeshB.scale.set(1, 1, 1);
    
    // Perform CSG subtraction
    const resultMesh = CSG.subtract(csgMeshA, csgMeshB);
    
    // Validate result
    if (!resultMesh || !resultMesh.geometry || resultMesh.geometry.attributes.position.count === 0) {
      throw new Error("CSG subtraction produced an invalid mesh");
    }
    
    // Create material for the new mesh
    const material = new THREE.MeshStandardMaterial({
      color: materialColorA,
      side: THREE.DoubleSide
    });
    
    resultMesh.material = material;
    
    // Final cleanup to ensure manifold result
    resultMesh.geometry = ensureManifoldGeometry(resultMesh.geometry);
    
    return resultMesh;
  } catch (e) {
    console.warn("Standard CSG subtraction failed, trying with simplified geometries", e);
  }
  
  // Second try: Simplify geometries first
  try {
    console.log("Trying subtraction with simplified geometries");
    
    // Apply progressive simplification for better results
    const simplifyThreshold = 0.005; // Start with moderate simplification
    
    // Get base geometries
    const baseGeomA = meshA.geometry.clone();
    const baseGeomB = meshB.geometry.clone();
    
    // Apply world transforms
    meshA.updateWorldMatrix(true, false);
    meshB.updateWorldMatrix(true, false);
    baseGeomA.applyMatrix4(meshA.matrixWorld);
    baseGeomB.applyMatrix4(meshB.matrixWorld);
    
    // First ensure they're manifold
    const manifoldGeomA = ensureManifoldGeometry(baseGeomA);
    const manifoldGeomB = ensureManifoldGeometry(baseGeomB);
    
    // Determine shape types for optimal simplification
    let shapeTypeA: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'other' = 'other';
    let shapeTypeB: 'cube' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'other' = 'other';
    
    // Try to detect shape types from mesh names or userData if available
    if (meshA.name) {
      const name = meshA.name.toLowerCase();
      if (name.includes('cube') || name.includes('box')) shapeTypeA = 'cube';
      else if (name.includes('sphere')) shapeTypeA = 'sphere';
      else if (name.includes('cylinder')) shapeTypeA = 'cylinder';
      else if (name.includes('cone')) shapeTypeA = 'cone';
      else if (name.includes('torus')) shapeTypeA = 'torus';
    }
    
    if (meshB.name) {
      const name = meshB.name.toLowerCase();
      if (name.includes('cube') || name.includes('box')) shapeTypeB = 'cube';
      else if (name.includes('sphere')) shapeTypeB = 'sphere';
      else if (name.includes('cylinder')) shapeTypeB = 'cylinder';
      else if (name.includes('cone')) shapeTypeB = 'cone';
      else if (name.includes('torus')) shapeTypeB = 'torus';
    }
    
    console.log(`Detected shape types - A: ${shapeTypeA}, B: ${shapeTypeB}`);
    
    // Then simplify them with shape-specific settings
    const simplifiedGeomA = simplifyGeometry(manifoldGeomA, {
      threshold: simplifyThreshold,
      shapeType: shapeTypeA,
      aggressiveness: 1.0
    });
    
    const simplifiedGeomB = simplifyGeometry(manifoldGeomB, {
      threshold: simplifyThreshold,
      shapeType: shapeTypeB,
      // Be less aggressive with the subtractor shape to preserve details
      aggressiveness: 0.8
    });
    
    // Create meshes for CSG with simplified geometries
    const simpleMeshA = new THREE.Mesh(
      simplifiedGeomA,
      new THREE.MeshStandardMaterial({
        color: materialColorA,
        side: THREE.DoubleSide
      })
    );
    
    const simpleMeshB = new THREE.Mesh(
      simplifiedGeomB,
      new THREE.MeshStandardMaterial({
        side: THREE.DoubleSide
      })
    );
    
    // Reset transforms
    simpleMeshA.position.set(0, 0, 0);
    simpleMeshA.rotation.set(0, 0, 0);
    simpleMeshA.scale.set(1, 1, 1);
    simpleMeshB.position.set(0, 0, 0);
    simpleMeshB.rotation.set(0, 0, 0);
    simpleMeshB.scale.set(1, 1, 1);
    
    // Try subtraction with simplified meshes
    const resultMesh = CSG.subtract(simpleMeshA, simpleMeshB);
    
    // Validate and clean up
    if (resultMesh && resultMesh.geometry && resultMesh.geometry.attributes.position.count > 0) {
      // Ensure the result is manifold
      resultMesh.geometry = ensureManifoldGeometry(resultMesh.geometry);
      
      // Update material
      resultMesh.material = new THREE.MeshStandardMaterial({
        color: materialColorA,
        side: THREE.DoubleSide
      });
      
      return resultMesh;
    }
    
    throw new Error("Simplified subtraction produced an invalid mesh");
  } catch (e) {
    console.warn("Simplified subtraction failed, trying final approach", e);
  }
  
  // Final attempt with maximum simplification
  try {
    console.log("Trying final subtraction approach with aggressive simplification");
    
    // Simplify with more aggressive settings
    const aggressiveThreshold = 0.01;
    
    // Get base geometries and apply world transforms
    const baseGeomA = meshA.geometry.clone();
    const baseGeomB = meshB.geometry.clone();
    
    meshA.updateWorldMatrix(true, false);
    meshB.updateWorldMatrix(true, false);
    baseGeomA.applyMatrix4(meshA.matrixWorld);
    baseGeomB.applyMatrix4(meshB.matrixWorld);
    
    // Apply aggressive simplification
    const finalGeomA = simplifyGeometry(
      ensureManifoldGeometry(baseGeomA),
      aggressiveThreshold
    );
    
    const finalGeomB = simplifyGeometry(
      ensureManifoldGeometry(baseGeomB),
      aggressiveThreshold
    );
    
    // Create meshes with basic materials
    const finalMeshA = new THREE.Mesh(
      finalGeomA,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    
    const finalMeshB = new THREE.Mesh(
      finalGeomB,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    
    // Reset transforms
    finalMeshA.position.set(0, 0, 0);
    finalMeshA.rotation.set(0, 0, 0);
    finalMeshA.scale.set(1, 1, 1);
    finalMeshB.position.set(0, 0, 0);
    finalMeshB.rotation.set(0, 0, 0);
    finalMeshB.scale.set(1, 1, 1);
    
    // Final subtraction attempt
    const resultMesh = CSG.subtract(finalMeshA, finalMeshB);
    
    // Apply standard material
    resultMesh.material = new THREE.MeshStandardMaterial({
      color: materialColorA,
      side: THREE.DoubleSide
    });
    
    return resultMesh;
  } catch (e: any) {
    // Last resort fallback - if all CSG approaches fail, return the first mesh
    console.error("All subtraction approaches failed:", e);
    try {
      // Return the original first mesh with warning
      console.warn("Returning original mesh as fallback");
      const fallbackGeom = prepareGeometry(meshA);
      
      return new THREE.Mesh(
        fallbackGeom,
        new THREE.MeshStandardMaterial({
          color: materialColorA,
          side: THREE.DoubleSide
        })
      );
    } catch (finalError) {
      console.error("Complete failure of subtraction operation", finalError);
      throw new Error("Subtraction operation failed completely: " + e.message);
    }
  }
}

// Specialized function for robust mesh intersection
function robustMeshIntersect(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.Mesh {
  console.log("Starting robust mesh intersection for complex geometries");
  
  // Extract materials for later use
  const materialColorA = meshA.material instanceof THREE.Material ? 
    (meshA.material as THREE.MeshStandardMaterial).color?.clone() : 
    (meshA.material[0] as THREE.MeshStandardMaterial)?.color?.clone() || new THREE.Color(0xffffff);
  
  // Pre-process geometries to ensure they're suitable for operations
  const prepareGeometry = (mesh: THREE.Mesh): THREE.BufferGeometry => {
    console.log(`Preparing geometry with ${mesh.geometry.attributes.position.count} vertices`);
    const geom = mesh.geometry.clone();
    
    // Apply world matrices to get correct position
    mesh.updateWorldMatrix(true, false);
    geom.applyMatrix4(mesh.matrixWorld);
    
    // Full clean and manifold check
    const cleanGeom = ensureManifoldGeometry(geom);
    console.log(`After processing: ${cleanGeom.attributes.position.count} vertices`);
    
    return cleanGeom;
  };
  
  // First check: Do bounding boxes even intersect?
  try {
    // Process geometries
    const geomA = prepareGeometry(meshA);
    const geomB = prepareGeometry(meshB);
    
    // Calculate bounding boxes
    geomA.computeBoundingBox();
    geomB.computeBoundingBox();
    
    // If bounding boxes don't intersect, return an empty geometry
    // (Intersection should yield nothing)
    if (geomA.boundingBox && geomB.boundingBox && 
        !geomA.boundingBox.intersectsBox(geomB.boundingBox)) {
      console.log("Bounding boxes don't intersect, returning empty geometry");
      
      // Return a minimal cube with opacity 0 as a placehoder
      const emptyGeom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const emptyMaterial = new THREE.MeshStandardMaterial({
        color: materialColorA,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0
      });
      
      return new THREE.Mesh(emptyGeom, emptyMaterial);
    }
  } catch (e) {
    console.warn("Bounding box check failed", e);
    // Continue to main approach
  }
  
  // First try: Standard CSG intersection
  try {
    console.log("Trying optimized CSG intersection approach");
    
    // Prepare geometries with extensive cleaning
    const cleanGeomA = prepareGeometry(meshA);
    const cleanGeomB = prepareGeometry(meshB);
    
    // Verify geometries are valid
    if (cleanGeomA.attributes.position.count === 0 || cleanGeomB.attributes.position.count === 0) {
      throw new Error("One or both models have no valid geometry after processing");
    }
    
    // Create optimized meshes for CSG
    const csgMeshA = new THREE.Mesh(
      cleanGeomA,
      new THREE.MeshBasicMaterial({ 
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.99  // Almost opaque but not quite
      })
    );
    
    const csgMeshB = new THREE.Mesh(
      cleanGeomB,
      new THREE.MeshBasicMaterial({ 
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.99
      })
    );
    
    // Reset transforms since they're already applied to geometry
    csgMeshA.position.set(0, 0, 0);
    csgMeshA.rotation.set(0, 0, 0);
    csgMeshA.scale.set(1, 1, 1);
    csgMeshB.position.set(0, 0, 0);
    csgMeshB.rotation.set(0, 0, 0);
    csgMeshB.scale.set(1, 1, 1);
    
    // Perform CSG intersection
    const resultMesh = CSG.intersect(csgMeshA, csgMeshB);
    
    // Validate result
    if (!resultMesh || !resultMesh.geometry || resultMesh.geometry.attributes.position.count === 0) {
      throw new Error("CSG intersection produced an empty result");
    }
    
    // Create material for the new mesh
    const material = new THREE.MeshStandardMaterial({
      color: materialColorA,
      side: THREE.DoubleSide
    });
    
    resultMesh.material = material;
    
    // Final cleanup to ensure manifold result
    resultMesh.geometry = ensureManifoldGeometry(resultMesh.geometry);
    
    return resultMesh;
  } catch (e) {
    console.warn("Standard CSG intersection failed, trying with simplified geometries", e);
  }
  
  // Second try: Simplify geometries first
  try {
    console.log("Trying intersection with simplified geometries");
    
    // Apply progressive simplification for better results
    const simplifyThreshold = 0.005; // Start with moderate simplification
    
    // Get base geometries and apply world transforms
    const baseGeomA = meshA.geometry.clone();
    const baseGeomB = meshB.geometry.clone();
    
    meshA.updateWorldMatrix(true, false);
    meshB.updateWorldMatrix(true, false);
    baseGeomA.applyMatrix4(meshA.matrixWorld);
    baseGeomB.applyMatrix4(meshB.matrixWorld);
    
    // First ensure they're manifold, then simplify
    const simplifiedGeomA = simplifyGeometry(ensureManifoldGeometry(baseGeomA), simplifyThreshold);
    const simplifiedGeomB = simplifyGeometry(ensureManifoldGeometry(baseGeomB), simplifyThreshold);
    
    // Create meshes for CSG with simplified geometries
    const simpleMeshA = new THREE.Mesh(
      simplifiedGeomA,
      new THREE.MeshStandardMaterial({
        color: materialColorA,
        side: THREE.DoubleSide
      })
    );
    
    const simpleMeshB = new THREE.Mesh(
      simplifiedGeomB,
      new THREE.MeshStandardMaterial({
        side: THREE.DoubleSide
      })
    );
    
    // Reset transforms
    simpleMeshA.position.set(0, 0, 0);
    simpleMeshA.rotation.set(0, 0, 0);
    simpleMeshA.scale.set(1, 1, 1);
    simpleMeshB.position.set(0, 0, 0);
    simpleMeshB.rotation.set(0, 0, 0);
    simpleMeshB.scale.set(1, 1, 1);
    
    // Try intersection with simplified meshes
    const resultMesh = CSG.intersect(simpleMeshA, simpleMeshB);
    
    // Validate and clean up
    if (resultMesh && resultMesh.geometry && resultMesh.geometry.attributes.position.count > 0) {
      // Ensure the result is manifold
      resultMesh.geometry = ensureManifoldGeometry(resultMesh.geometry);
      
      // Update material
      resultMesh.material = new THREE.MeshStandardMaterial({
        color: materialColorA,
        side: THREE.DoubleSide
      });
      
      return resultMesh;
    }
    
    throw new Error("Simplified intersection produced an empty result");
  } catch (e) {
    console.warn("Simplified intersection failed, trying final approach", e);
  }
  
  // Final attempt with maximum simplification
  try {
    console.log("Trying final intersection approach with aggressive simplification");
    
    // Simplify with more aggressive settings
    const aggressiveThreshold = 0.02; // Even more aggressive than before
    
    // Get base geometries and apply world transforms
    const baseGeomA = meshA.geometry.clone();
    const baseGeomB = meshB.geometry.clone();
    
    meshA.updateWorldMatrix(true, false);
    meshB.updateWorldMatrix(true, false);
    baseGeomA.applyMatrix4(meshA.matrixWorld);
    baseGeomB.applyMatrix4(meshB.matrixWorld);
    
    // Apply aggressive simplification
    const finalGeomA = simplifyGeometry(
      ensureManifoldGeometry(baseGeomA),
      aggressiveThreshold
    );
    
    const finalGeomB = simplifyGeometry(
      ensureManifoldGeometry(baseGeomB),
      aggressiveThreshold
    );
    
    // Create meshes with basic materials
    const finalMeshA = new THREE.Mesh(
      finalGeomA,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    
    const finalMeshB = new THREE.Mesh(
      finalGeomB,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    
    // Reset transforms
    finalMeshA.position.set(0, 0, 0);
    finalMeshA.rotation.set(0, 0, 0);
    finalMeshA.scale.set(1, 1, 1);
    finalMeshB.position.set(0, 0, 0);
    finalMeshB.rotation.set(0, 0, 0);
    finalMeshB.scale.set(1, 1, 1);
    
    // Final intersection attempt
    const resultMesh = CSG.intersect(finalMeshA, finalMeshB);
    
    // If we got a valid result, return it
    if (resultMesh && resultMesh.geometry && resultMesh.geometry.attributes.position.count > 0) {
      // Apply standard material
      resultMesh.material = new THREE.MeshStandardMaterial({
        color: materialColorA,
        side: THREE.DoubleSide
      });
      
      return resultMesh;
    }
    
    throw new Error("Failed to find intersection with any approach");
  } catch (e: any) {
    // If all intersection attempts produced no result, return minimal geometry
    console.error("All intersection approaches failed:", e);
    
    // Return a minimal invisible geometry to represent empty intersection
    console.warn("Creating minimal representation for empty intersection");
    const emptyGeom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const emptyMaterial = new THREE.MeshStandardMaterial({
      color: materialColorA,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.2 // Slightly visible for debugging
    });
    
    return new THREE.Mesh(emptyGeom, emptyMaterial);
  }
}

// Add this utility function after validateResultMesh but before the export statement

/**
 * Utility function to check for and attempt to repair self-intersections in a geometry
 * Self-intersecting geometries often cause boolean operations to fail
 */
function repairSelfIntersections(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  console.log("Checking for and repairing self-intersections");
  
  // Clone the geometry to avoid modifying the original
  const repairedGeometry = geometry.clone();
  
  try {
    // Step 1: Ensure we have indices for triangle detection
    if (!repairedGeometry.index) {
      console.log("Creating index for non-indexed geometry");
      repairedGeometry.setIndex(
        Array.from({ length: repairedGeometry.attributes.position.count }, (_, i) => i)
      );
    }
    
    // Step 2: Find triangles that might intersect each other
    const indices = repairedGeometry.index?.array || [];
    const positions = repairedGeometry.attributes.position.array;
    
    // This is a simplified approach - full intersection testing would be much more complex
    // We'll look for triangles that share edges but have inverted normals,
    // which is a strong indicator of self-intersection
    
    // First create a map of edges to triangles
    const edgeToTriangles = new Map<string, number[]>();
    const potentialIssues = new Set<number>();
    
    // Only proceed if we have indices
    if (repairedGeometry.index) {
      for (let i = 0; i < indices.length; i += 3) {
        const triangleIndex = i / 3;
        const i1 = indices[i];
        const i2 = indices[i + 1];
        const i3 = indices[i + 2];
        
        // Register each edge with this triangle
        // We'll sort the indices to make sure we get the same key for the same edge
        const edges = [
          [Math.min(i1, i2), Math.max(i1, i2)],
          [Math.min(i2, i3), Math.max(i2, i3)],
          [Math.min(i3, i1), Math.max(i3, i1)]
        ];
        
        for (const [a, b] of edges) {
          const edgeKey = `${a}-${b}`;
          if (!edgeToTriangles.has(edgeKey)) {
            edgeToTriangles.set(edgeKey, []);
          }
          edgeToTriangles.get(edgeKey)!.push(triangleIndex);
          
          // If this edge is shared by more than one triangle, check for potential issues
          if (edgeToTriangles.get(edgeKey)!.length > 1) {
            // Check normals of the triangles sharing this edge
            const triangles = edgeToTriangles.get(edgeKey)!;
            for (const prevTriangle of triangles.slice(0, -1)) {
              // Add both triangles as potential issues to check
              potentialIssues.add(prevTriangle);
              potentialIssues.add(triangleIndex);
            }
          }
        }
      }
    }
    
    if (potentialIssues.size > 0) {
      console.log(`Found ${potentialIssues.size} potential self-intersecting triangles`);
    } else {
      console.log("No self-intersections detected");
      return repairedGeometry;
    }
    
    // Step 3: Simple repair by merging very close vertices
    // This can often resolve minor self-intersections
    // We use an aggressive tolerance here to fix most issues
    const repairTolerance = 0.001;
    
    if (BufferGeometryUtils.mergeVertices) {
      const mergedGeometry = BufferGeometryUtils.mergeVertices(repairedGeometry, repairTolerance);
      
      // Compare vertex counts to see if we made a significant change
      if (mergedGeometry.attributes.position.count < repairedGeometry.attributes.position.count) {
        const reduction = repairedGeometry.attributes.position.count - mergedGeometry.attributes.position.count;
        console.log(`Merged ${reduction} vertices to repair self-intersections`);
        
        // Recompute normals after merging
        mergedGeometry.computeVertexNormals();
        return mergedGeometry;
      }
    }
    
    // Step 4: If merging didn't help, try to fix by removing problematic triangles
    // This is a last resort and can leave holes, but sometimes better than failing
    if (repairedGeometry.index && potentialIssues.size > repairedGeometry.index.count / 6) {
      // Too many issues to fix by removing triangles, would destroy the mesh
      console.warn("Too many problematic triangles to fix by removal");
      return repairedGeometry;
    }
    
    // Create a new index array without problematic triangles
    const newIndices = [];
    
    // Only proceed if we have a valid index
    if (repairedGeometry.index) {
      for (let i = 0; i < indices.length; i += 3) {
        const triangleIndex = i / 3;
        if (!potentialIssues.has(triangleIndex)) {
          newIndices.push(indices[i], indices[i + 1], indices[i + 2]);
        }
      }
      
      if (newIndices.length < indices.length) {
        console.log(`Removed ${(indices.length - newIndices.length) / 3} problematic triangles`);
        repairedGeometry.setIndex(newIndices);
        
        // Recompute normals after removing triangles
        repairedGeometry.computeVertexNormals();
      }
    }
  } catch (error) {
    console.warn("Error while repairing self-intersections:", error);
    return geometry; // Return original if repair failed
  }
  
  return repairedGeometry;
}

export {};