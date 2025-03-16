import React, { useRef, useEffect, useCallback, useContext } from 'react';
import { Button } from "@/components/ui/button";
import { useScene } from "@/hooks/use-scene";
import { Download, Trash, Box, Type, Paintbrush, Upload, Shapes, Bot, Circle, Triangle, CircleDot, Layers, Droplets, Badge, Sparkles, Zap, Pencil, Printer, X, FileText, Layout, Undo, Redo, Image as ImageIcon, Crown, LibraryBig, PencilRuler, Palette } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ModelList } from "./ModelList";
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { Font } from "three/examples/jsm/loaders/FontLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Slider } from "./ui/slider";
import { Checkbox } from "./ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { Model } from "@/types/model";
import { TaiyakiLibrary } from "@/components/TaiyakiLibrary";
import { MagicFishAI } from "@/components/MagicFishAI";
import { AssetLibrary } from "@/components/AssetLibrary";
import { imageToSvg } from "@/lib/imageToSvg";
import { useSubscription } from '@/context/SubscriptionContext';
import { ThangsEmbed } from "@/components/ThangsEmbed";
import { ThingiverseEmbed } from "@/components/ThingiverseEmbed";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { FreeModeContext } from "@/pages/FreePage";

// Font options with their display names and paths
const FONTS = [
  { name: "Roboto", path: "https://threejs.org/examples/fonts/helvetiker_regular.typeface.json" },
  { name: "Times New Roman", path: "https://threejs.org/examples/fonts/gentilis_regular.typeface.json" },
  { name: "Courier", path: "https://threejs.org/examples/fonts/droid/droid_serif_regular.typeface.json" }
];

// Add this helper function before the Sidebar component
const findNonCollidingPosition = (models: Array<Model>, newBoundingBox: THREE.Box3): THREE.Vector3 => {
  const position = new THREE.Vector3(0, 0, 0);
  
  // If no models exist, return origin
  if (models.length === 0) return position;
  
  // Check if position is available at origin first
  let hasCollision = false;
  for (const model of models) {
    const modelBounds = new THREE.Box3().setFromObject(model.mesh);
    if (newBoundingBox.intersectsBox(modelBounds)) {
      hasCollision = true;
      break;
    }
  }
  
  // If no collision at origin, use that
  if (!hasCollision) return position;
  
  // Otherwise, find the first available position in a spiral pattern
  const spacing = 60; // ~2.36 inches
  let ring = 1;
  let angle = 0;
  
  while (ring < 10) { // Limit search to reasonable area
    for (angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      position.x = Math.cos(angle) * (spacing * ring);
      position.z = Math.sin(angle) * (spacing * ring);
      
      // Move bounding box to test position
      const testBox = newBoundingBox.clone().translate(position);
      
      // Check for collisions
      hasCollision = false;
      for (const model of models) {
        const modelBounds = new THREE.Box3().setFromObject(model.mesh);
        if (testBox.intersectsBox(modelBounds)) {
          hasCollision = true;
          break;
        }
      }
      
      if (!hasCollision) {
        return position;
      }
    }
    ring++;
  }
  
  return position;
};

// Define styles for the premium crown icons
const premiumIconBaseStyle = {
  position: "absolute" as const,
  width: "12px",
  height: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const libraryPremiumIconStyle = {
  ...premiumIconBaseStyle,
  top: "10px",     // Moved down a bit
  right: "10px",   // Moved more inward (left)
};

const aiPremiumIconStyle = {
  ...premiumIconBaseStyle,
  top: "2px",
  right: "2px",
};

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { 
    loadSTL, 
    loadSVG,
    exportSelectedModelAsSTL, 
    selectedModelIndex,
    removeModel,
    scene,
    selectModel,
    saveHistoryState,
    loadText,
    models,
    renderingMode,
    setRenderingMode,
    showGrid,
    setShowGrid,
    showAxes,
    setShowAxes,
    camera,
    performCSGOperation
  } = useScene();
  const { toast } = useToast();
  const { subscription } = useSubscription();
  const [activeTab, setActiveTab] = useState("models");
  
  // State for copied model
  const [copiedModel, setCopiedModel] = useState<any>(null);
  
  // Text form state
  const [text, setText] = useState("Text");
  const [height, setHeight] = useState(20); // Default depth 20mm
  const [bevelThickness, setBevelThickness] = useState(1); // Default bevel thickness 1mm
  const [selectedFont, setSelectedFont] = useState(FONTS[0].path);
  const [isLoading, setIsLoading] = useState(false);
  const [editingTextModelId, setEditingTextModelId] = useState<string | null>(null);
  
  // Material states
  const [materialColor, setMaterialColor] = useState("#3498db");
  const [backgroundColor, setBackgroundColor] = useState("#f0f0f0");
  const [backgroundType, setBackgroundType] = useState("solid"); // solid, gradient, or skybox
  const [gradientTopColor, setGradientTopColor] = useState("#87ceeb"); // sky blue
  const [gradientBottomColor, setGradientBottomColor] = useState("#ffffff"); // white
  
  // Check if the currently selected model is a text model that can be edited
  const selectedTextModel = selectedModelIndex !== null && models[selectedModelIndex] 
    ? models[selectedModelIndex].type === 'text' ? models[selectedModelIndex] as Model : null 
    : null;

  // Sketch state
  const [sketchLines, setSketchLines] = useState<Array<{points: Array<{x: number, y: number}>}>>([]);
  const [currentLine, setCurrentLine] = useState<Array<{x: number, y: number}>>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [extrusionDepth, setExtrusionDepth] = useState(50.8); // Default to 2 inches
  const [sketchMode, setSketchMode] = useState<'freeform' | 'precise' | 'rectangle' | 'circle'>('freeform');
  const [startPoint, setStartPoint] = useState<{x: number, y: number} | null>(null);
  const [previewLine, setPreviewLine] = useState<Array<{x: number, y: number}> | null>(null);
  const [gridSize, setGridSize] = useState(20); // Grid size in pixels
  const [snapToGrid, setSnapToGrid] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Add state for sketch conversion
  const [isSketchProcessing, setIsSketchProcessing] = useState(false);
  
  // Add preview canvas ref
  const textPreviewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Use FreeModeContext if available
  const freeModeCtx = useContext(FreeModeContext);
  
  // Components to use based on mode
  const TaiyakiLibraryComponent = freeModeCtx?.TaiyakiLibraryComponent || TaiyakiLibrary;
  const MagicFishAIComponent = freeModeCtx?.MagicFishAIComponent || MagicFishAI;
  
  // Helper function to adjust color brightness
  const adjustColor = (color: string, amount: number) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.slice(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.slice(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.slice(4, 6), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };
  
  // Function to update text preview
  const updateTextPreview = useCallback(() => {
    const canvas = textPreviewCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size with high DPI support
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas with light gray background
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    // Calculate font size based on canvas dimensions and text length
    const fontSize = Math.min(
      canvas.height / (3 * dpr),
      (canvas.width / (text.length * 1.2)) / dpr
    );

    // Set font family based on selection
    let fontFamily = 'Arial';
    if (selectedFont === FONTS[0].path) {
      fontFamily = 'Roboto, Arial';
    } else if (selectedFont === FONTS[1].path) {
      fontFamily = 'Times New Roman, serif';
    } else if (selectedFont === FONTS[2].path) {
      fontFamily = 'Courier, monospace';
    }

    // Set text properties
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const centerX = canvas.width / (2 * dpr);
    const centerY = canvas.height / (2 * dpr);

    // Draw main text fill
    ctx.fillStyle = '#000000';
    ctx.fillText(text || 'Preview Text', centerX, centerY);

  }, [text, selectedFont, bevelThickness]);

  // Update preview when settings change or component mounts
  useEffect(() => {
    if (activeTab !== 'text') return;

    // Load Roboto font
    const loadRobotoFont = async () => {
      try {
        const robotoFont = new FontFace('Roboto', 'url(https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5Q.ttf)');
        await robotoFont.load();
        document.fonts.add(robotoFont);
        updateTextPreview();
      } catch (error) {
        console.error('Error loading Roboto font:', error);
        updateTextPreview(); // Still try to show preview even if font fails
      }
    };
    loadRobotoFont();
  }, [text, selectedFont, bevelThickness, updateTextPreview, activeTab]);

  // Update preview when canvas is resized
  useEffect(() => {
    updateTextPreview();
    
    const resizeObserver = new ResizeObserver(() => {
      updateTextPreview();
    });

    if (textPreviewCanvasRef.current) {
      resizeObserver.observe(textPreviewCanvasRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [updateTextPreview]);
  
  // Add keyboard event handler for copy, paste, and delete
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're not in an input field or textarea
      const activeElement = document.activeElement;
      const isInputActive = activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.getAttribute('contenteditable') === 'true'
      );
      
      if (isInputActive) return;
      
      // Copy with Ctrl+C or Command+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        handleCopyModel();
      }
      
      // Paste with Ctrl+V or Command+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        handlePasteModel();
      }
      
      // Delete with Delete key
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteSelectedModel();
      }

      // Undo with Ctrl+Z or Command+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        const { canUndo, undo } = useScene.getState();
        if (canUndo) {
          undo();
          toast({
            title: "Action undone",
            duration: 2000,
          });
        }
      }
      
      // Redo with Ctrl+Y or Ctrl+Shift+Z or Command+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        const { canRedo, redo } = useScene.getState();
        if (canRedo) {
          redo();
          toast({
            title: "Action redone",
            duration: 2000,
          });
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedModelIndex, models, copiedModel]);
  
  // Function to handle copying a model
  const handleCopyModel = () => {
    if (selectedModelIndex === null || !models[selectedModelIndex]) return;
    
    const modelToCopy = models[selectedModelIndex];
    setCopiedModel(modelToCopy);
    
    toast({
      title: "Model Copied",
      description: `${modelToCopy.name} copied to clipboard`,
      duration: 2000,
    });
  };
  
  // Function to handle pasting a model
  const handlePasteModel = () => {
    if (!copiedModel) {
      toast({
        title: "Nothing to Paste",
        description: "Copy a model first",
        variant: "destructive",
        duration: 2000,
      });
      return;
    }
    
    // Clone the geometry
    const originalGeometry = copiedModel.mesh.geometry;
    const clonedGeometry = originalGeometry.clone();
    
    // Clone the material
    let clonedMaterial;
    if (Array.isArray(copiedModel.mesh.material)) {
      clonedMaterial = copiedModel.mesh.material.map((mat: THREE.Material) => mat.clone());
    } else {
      clonedMaterial = copiedModel.mesh.material.clone();
    }
    
    // Create a new mesh
    const newMesh = new THREE.Mesh(clonedGeometry, clonedMaterial);
    newMesh.castShadow = true;
    newMesh.receiveShadow = true;
    
    // Position the new mesh slightly offset from the original
    newMesh.position.copy(copiedModel.mesh.position);
    newMesh.position.x += 2; // Offset to make it visible
    newMesh.rotation.copy(copiedModel.mesh.rotation);
    newMesh.scale.copy(copiedModel.mesh.scale);
    
    // Store original transform
    const originalPosition = newMesh.position.clone();
    const originalRotation = newMesh.rotation.clone();
    const originalScale = newMesh.scale.clone();
    
    // Add to scene
    scene.add(newMesh);
    
    // Create a new model object
    const newModel = {
      id: `${copiedModel.type || 'model'}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: `${copiedModel.name} (Copy)`,
      type: copiedModel.type || 'model',
      mesh: newMesh,
      originalPosition,
      originalRotation,
      originalScale,
      // Copy any additional properties if needed
      ...(copiedModel.textProps ? { textProps: { ...copiedModel.textProps } } : {})
    };
    
    // Add to models array
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    
    // Select the new model
    const newIndex = updatedModels.length - 1;
    selectModel(newIndex);
    
    // Save to history
    saveHistoryState();
    
    toast({
      title: "Model Pasted",
      description: `${newModel.name} added to scene`,
      duration: 2000,
    });
  };
  
  // Function to handle deleting the selected model
  const handleDeleteSelectedModel = () => {
    if (selectedModelIndex === null) return;
    
    const modelName = models[selectedModelIndex].name;
    removeModel(selectedModelIndex);
    
    toast({
      title: "Model Deleted",
      description: `${modelName} removed from scene`,
      duration: 2000,
    });
  };
  
  // When a text model is selected, load its parameters into the form
  useEffect(() => {
    if (selectedTextModel) {
      setEditingTextModelId(selectedTextModel.id);
      
      // If the model has text properties, set them in the form
      if (selectedTextModel.textProps) {
        setText(selectedTextModel.textProps.text || "Text");
        setHeight(selectedTextModel.textProps.height || 20);
        setBevelThickness(selectedTextModel.textProps.bevelThickness || 1);
        setSelectedFont(selectedTextModel.textProps.fontPath || FONTS[0].path);
      }
    } else {
      setEditingTextModelId(null);
    }
  }, [selectedModelIndex, models]);

  const handleCreateText = async () => {
    if (!text.trim()) {
      toast({
        title: "Error",
        description: "Text cannot be empty",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const textProps = {
        text,
        height,
        bevelThickness,
        bevelEnabled: true, // Always enable bevel
        bevelSize: bevelThickness, // Match bevel size to thickness
        bevelSegments: 3, // Add segments for smoother bevel
        fontPath: selectedFont
      };
      
      await loadText(text, textProps);
      
      toast({
        title: "Success",
        description: "3D text created successfully",
      });
      
      const { models } = useScene.getState();
      const newIndex = models.length - 1;
      selectModel(newIndex);
      
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create 3D text",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleUpdateText = async () => {
    if (!text.trim() || !editingTextModelId || selectedModelIndex === null) {
      return;
    }
    
    setIsLoading(true);
    
    try {
      const textProps = {
        text,
        height,
        bevelThickness,
        bevelEnabled: true, // Always enable bevel
        bevelSize: bevelThickness, // Match bevel size to thickness
        bevelSegments: 3, // Add segments for smoother bevel
        fontPath: selectedFont
      };
      
      await loadText(text, textProps);
      
      toast({
        title: "Success",
        description: "3D text updated successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update 3D text",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  // Function to handle tab change
  const handleTabChange = (value: string) => {
    setActiveTab(value);
  };
  
  // Function to get a random fun color for shapes
  const getRandomColor = () => {
    // Define an array of fun, vibrant colors
    const vibrantColors = [
      // Original vibrant colors
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
      '#33FF9E', // Mint green
      '#FF00CC', // Neon pink
      '#00FFCC', // Bright turquoise
      '#CCFF00', // Lime yellow
      '#FF66B2', // Pastel pink
      '#66FFB2', // Pastel mint
      '#B266FF', // Lavender
      '#FF9966', // Peach
      '#1E90FF', // Dodger blue
      '#ADFF2F', // Green yellow
      '#FF8C00', // Dark orange
      
      // New super fun, fresh colors
      '#FF1493', // Deep pink
      '#00FF00', // Lime
      '#FF4500', // OrangeRed
      '#8A2BE2', // BlueViolet
      '#FF00FF', // Fuchsia
      '#00FFFF', // Aqua
      '#FFD700', // Gold
      '#FF6347', // Tomato
      '#DA70D6', // Orchid
      '#FF69B4', // HotPink
      '#32CD32', // LimeGreen
      '#BA55D3', // MediumOrchid
      '#00FA9A', // MediumSpringGreen
      '#9370DB', // MediumPurple
      '#7B68EE', // MediumSlateBlue
      '#20B2AA', // LightSeaGreen
      '#9932CC', // DarkOrchid
      '#FF6EB4', // HotPink
      '#FF00AA', // Vivid pink
      '#AAFF00', // Bright lime
      '#00AAFF', // Vivid sky blue
      '#AA00FF', // Vivid purple
      '#FFAA00', // Bright amber
      '#FFFF00', // Electric yellow
      '#FF0000', // Pure red
      '#00FF00', // Pure green
      '#0000FF', // Pure blue
      '#FF7700', // Bright orange
      '#FF00BB', // Hot magenta
      '#BBFF00', // Chartreuse
      '#00BBFF', // Bright azure
      '#BB00FF', // Electric violet
      '#FFBB00', // Sunflower
      '#00FFBB', // Spring green
      '#7700FF', // Electric indigo
      '#FF0077', // Raspberry
      '#77FF00', // Yellow-green
      '#00FF77', // Mint
      '#7700FF', // Violet
      '#FF7700'  // Pumpkin
    ];
    
    // Select a random color from the vibrant palette
    const randomIndex = Math.floor(Math.random() * vibrantColors.length);
    return new THREE.Color(vibrantColors[randomIndex]);
  };
  
  // Function to create a fun material for a shape
  const createFunMaterial = () => {
    // Always return a standard vibrant material
    return new THREE.MeshStandardMaterial({
      color: getRandomColor(),
      metalness: 0.2,
      roughness: 0.5
    });
  };

  // Function to create a new model with the correct type
  const createModel = (mesh: THREE.Mesh, type: Model['type'], name: string) => {
    const originalPosition = mesh.position.clone();
    const originalRotation = mesh.rotation.clone();
    const originalScale = mesh.scale.clone();
    
    return {
      id: `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name,
      type,
      mesh,
      originalPosition,
      originalRotation,
      originalScale
    } as Model;
  };

  const handleAddCube = () => {
    const geometry = new THREE.BoxGeometry(50.8, 50.8, 50.8);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    
    // Calculate bounding box and find position
    const boundingBox = new THREE.Box3().setFromObject(mesh);
    const position = findNonCollidingPosition(models, boundingBox);
    mesh.position.copy(position);
    
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const newModel = createModel(mesh, 'cube', 'Cube');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();
    
    toast({
      title: "Success",
      description: "Cube added to scene",
    });
  };

  const handleAddSphere = () => {
    const geometry = new THREE.SphereGeometry(25.4, 32, 32);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    
    // Calculate bounding box and find position
    const boundingBox = new THREE.Box3().setFromObject(mesh);
    const position = findNonCollidingPosition(models, boundingBox);
    mesh.position.copy(position);
    
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const newModel = createModel(mesh, 'sphere', 'Sphere');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();

    toast({
      title: "Success",
      description: "Sphere added to scene",
    });
  };

  const handleAddCylinder = () => {
    const geometry = new THREE.CylinderGeometry(25.4, 25.4, 50.8, 32, 2, false); // Increased segments, closed ends
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    
    const newModel = createModel(mesh, 'cylinder', 'Cylinder');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();

    toast({
      title: "Success",
      description: "Cylinder added to scene",
    });
  };

  const handleAddCone = () => {
    const geometry = new THREE.ConeGeometry(25.4, 50.8, 32, 2, false);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    
    const newModel = createModel(mesh, 'cone', 'Cone');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();
    
    toast({
      title: "Success",
      description: "Cone added to scene",
    });
  };

  const handleAddTorus = () => {
    const geometry = new THREE.TorusGeometry(25.4, 7.62, 16, 32);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    
    const newModel = createModel(mesh, 'torus', 'Torus');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();
    
    toast({
      title: "Success",
      description: "Torus added to scene",
    });
  };

  const handleAddTorusKnot = () => {
    const geometry = new THREE.TorusKnotGeometry(20, 5, 100, 16);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    
    const newModel = createModel(mesh, 'torusknot', 'Torus Knot');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();

    toast({
      title: "Success",
      description: "Torus Knot added to scene",
    });
  };

  const handleAddOctahedron = () => {
    const geometry = new THREE.OctahedronGeometry(25.4, 0);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const newModel = createModel(mesh, 'octahedron', 'Octahedron');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();
    
    toast({
      title: "Success",
      description: "Octahedron added to scene",
    });
  };

  const handleAddIcosahedron = () => {
    const geometry = new THREE.IcosahedronGeometry(25.4, 0);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const newModel = createModel(mesh, 'icosahedron', 'Icosahedron');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();

    toast({
      title: "Success",
      description: "Icosahedron added to scene",
    });
  };

  const handleAddDodecahedron = () => {
    const geometry = new THREE.DodecahedronGeometry(25.4, 0);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    
    const newModel = createModel(mesh, 'dodecahedron', 'Dodecahedron');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();

    toast({
      title: "Success",
      description: "Dodecahedron added to scene",
    });
  };

  const handleAddCapsule = () => {
    const geometry = new THREE.CapsuleGeometry(15, 30, 16, 16);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const newModel = createModel(mesh, 'capsule', 'Capsule');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();
    
    toast({
      title: "Success",
      description: "Capsule added to scene",
    });
  };

  const handleAddPyramid = () => {
    // Use TetrahedronGeometry which is guaranteed to be watertight
    const geometry = new THREE.TetrahedronGeometry(30);
    
    // Scale to make it more pyramid-like with square base
    geometry.scale(1.5, 1.7, 1.5);
    
    // Rotate to make the pointy end up
    geometry.rotateX(Math.PI);
    
    // Move it so the base is at y=0
    geometry.translate(0, 15, 0);

    const material = new THREE.MeshStandardMaterial({ 
      color: getRandomColor(),
      flatShading: true // Better for 3D printing
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const newModel = createModel(mesh, 'pyramid', 'Pyramid');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();

    toast({
      title: "Success",
      description: "Pyramid added to scene",
    });
  };

  const handleAddTube = () => {
    // Complex geometry with a custom path
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3( -40, 0, 0 ),
      new THREE.Vector3( -10, 40, 20 ),
      new THREE.Vector3( 0, 0, 0 ),
      new THREE.Vector3( 10, -40, -20 ),
      new THREE.Vector3( 40, 0, 0 )
    ]);
    
    const geometry = new THREE.TubeGeometry(path, 64, 8, 16, false);
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    
    const newModel = createModel(mesh, 'model', 'Tube');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();

    toast({
      title: "Success",
      description: "Tube added to scene",
    });
  };

  const handleAddPrism = () => {
    // Create a triangular prism using custom geometry
    const geometry = new THREE.BufferGeometry();
    
    // Define vertices for a triangular prism
    const vertices = new Float32Array([
      // Triangle base 1
      -20, 0, -20,
      20, 0, -20,
      0, 0, 20,
      
      // Triangle base 2
      -20, 40, -20,
      20, 40, -20,
      0, 40, 20
    ]);
    
    // Define faces indices
    const indices = [
      // Base triangles
      0, 1, 2, // Bottom
      5, 4, 3, // Top (reversed orientation)
      
      // Side faces (rectangles split into triangles)
      0, 3, 1, // Side 1a
      1, 3, 4, // Side 1b
      1, 4, 2, // Side 2a
      2, 4, 5, // Side 2b
      0, 2, 3, // Side 3a
      2, 5, 3  // Side 3b
    ];
    
    // Set geometry attributes
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    
    // Create a mesh
    const material = createFunMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const newModel = createModel(mesh, 'model', 'Prism');
    const updatedModels = [...models, newModel];
    useScene.setState({ models: updatedModels });
    selectModel(updatedModels.length - 1);
    saveHistoryState();
    
    toast({
      title: "Success",
      description: "Prism added to scene",
    });
  };
  
  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.stl,.svg,.jpg,.jpeg,.png,.gif,.webp';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const fileExt = file.name.split('.').pop()?.toLowerCase();
        
        if (fileExt === 'stl') {
          await loadSTL(file);
          toast({
            title: "Import Successful",
            description: `Imported STL: ${file.name}`
          });
        } else if (fileExt === 'svg') {
          await loadSVG(file);
          toast({
            title: "Import Successful",
            description: `Converted SVG to 3D: ${file.name}`
          });
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(fileExt || '')) {
          // Show loading toast
          toast({
            title: "Converting Image",
            description: "Converting image to SVG... This may take a moment.",
          });
          
          // Convert image to SVG
          const svgData = await imageToSvg(file);
          
          // Create a blob from the SVG data
          const svgBlob = new Blob([svgData], { type: 'image/svg+xml' });
          
          // Create a File object from the blob
          const fileName = file.name.replace(/\.[^/.]+$/, '') + '.svg';
          const svgFile = new File([svgBlob], fileName, { type: 'image/svg+xml' });
          
          // Load the SVG file
          await loadSVG(svgFile);
          
          toast({
            title: "Conversion Successful",
            description: `Converted image to SVG and imported as 3D model`
          });
        } else {
          toast({
            title: "Import Failed",
            description: "Unsupported file format. Please use STL, SVG, or common image formats.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Import error:", error);
        toast({
          title: "Import Failed",
          description: "There was an error importing your file",
          variant: "destructive",
        });
      }
    };
    input.click();
  };
  
  // Dedicated function for image imports
  const handleImageImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jpg,.jpeg,.png,.gif,.webp';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        // Show loading toast
        toast({
          title: "Converting Image",
          description: "Converting image to SVG... This may take a moment.",
        });
        
        // Convert image to SVG
        const svgData = await imageToSvg(file);
        
        // Create a blob from the SVG data
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml' });
        
        // Create a File object from the blob
        const fileName = file.name.replace(/\.[^/.]+$/, '') + '.svg';
        const svgFile = new File([svgBlob], fileName, { type: 'image/svg+xml' });
        
        // The default extrude depth for converted images (in mm)
        const extrudeDepth = 2;
        
        // Load the SVG file with an extrusion depth
        await loadSVG(svgFile, extrudeDepth);
        
        toast({
          title: "Conversion Successful",
          description: `Converted image to SVG and imported as 3D model`
        });
      } catch (error) {
        console.error("Error converting image:", error);
        toast({
          title: "Conversion Failed",
          description: "There was an error converting your image to SVG",
          variant: "destructive",
        });
      }
    };
    input.click();
  };
  
  const handleExportModel = () => {
    if (selectedModelIndex !== null) {
      try {
        // Get the blob from the export function
        const blob = exportSelectedModelAsSTL();
        if (!blob) {
          throw new Error("Failed to generate STL file");
        }
        
        // Create a download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `model-export-${Date.now()}.stl`;
        link.click();
        
        // Clean up
        URL.revokeObjectURL(url);
        
        toast({
          title: "Export Successful",
          description: "Your model has been exported as STL"
        });
      } catch (error) {
        console.error("Export error:", error);
        toast({
          title: "Export Failed",
          description: "There was an error exporting your model",
          variant: "destructive",
        });
      }
    }
  };
  
  // Apply color to model
  const applyColorToModel = () => {
    if (selectedModelIndex === null || !models[selectedModelIndex]) return;
    
    const model = models[selectedModelIndex];
    const mesh = model.mesh;
    
    // Get the current material and update its color
    const currentMaterial = mesh.material;
    if (currentMaterial) {
      if (Array.isArray(currentMaterial)) {
        // Handle multi-material objects
        currentMaterial.forEach(mat => {
          if (mat.color) mat.color.set(materialColor);
        });
      } else {
        // Single material
        if (currentMaterial.color) currentMaterial.color.set(materialColor);
      }
    }
    
    // Force a render
    if (scene.needsUpdate !== undefined) {
    scene.needsUpdate = true;
    }
    
    // Save state for undo/redo
    saveHistoryState();
    
    toast({
      title: "Color Updated",
      description: "Applied new color to model",
      duration: 2000,
    });
  };

  // Apply background changes
  const applyBackgroundChange = () => {
    if (backgroundType === "solid") {
      scene.background = new THREE.Color(backgroundColor);
    } else if (backgroundType === "gradient") {
      // Create a canvas for gradient
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      
      const context = canvas.getContext('2d');
      if (context) {
        const gradient = context.createLinearGradient(0, 0, 0, 2);
        gradient.addColorStop(0, gradientTopColor);
        gradient.addColorStop(1, gradientBottomColor);
        
        context.fillStyle = gradient;
        context.fillRect(0, 0, 2, 2);
        
        const texture = new THREE.CanvasTexture(canvas);
        scene.background = texture;
      }
    }
    
    // Force a render
    scene.needsUpdate = true;
    
    toast({
      title: "Background Updated",
      description: `Applied ${backgroundType} background`,
      duration: 2000,
    });
  };

  // Toggle visibility of grid and axes
  const toggleGridVisibility = (checked: boolean) => {
    // Use the setter from useScene which will handle updating the scene
    setShowGrid(checked);
  };
  
  const toggleAxesVisibility = (checked: boolean) => {
    // Use the setter from useScene which will handle updating the scene
    setShowAxes(checked);
  };

  // Function to sync color when selecting a model
  useEffect(() => {
    if (selectedModelIndex !== null && models[selectedModelIndex]) {
      const model = models[selectedModelIndex];
      const material = model.mesh.material;
      
      // Set color
      if (material && 'color' in material && material.color) {
        setMaterialColor('#' + material.color.getHexString());
      }
    }
  }, [selectedModelIndex, models]);

  // Initialize canvas when component mounts or tab changes
  useEffect(() => {
      const canvas = canvasRef.current;
    if (!canvas || activeTab !== 'sketch') return;
      
    // Set canvas size with high DPI support
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas and draw grid
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGrid(ctx, canvas.width, canvas.height);

    // Draw existing lines
    ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      
      sketchLines.forEach(line => {
        if (line.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(line.points[0].x, line.points[0].y);
          for (let i = 1; i < line.points.length; i++) {
            ctx.lineTo(line.points[i].x, line.points[i].y);
          }
        
        // Add a line back to the first point to ensure the shape is closed
        // Only do this if the last point isn't the same as the first point
        if (line.points.length > 2 && 
            (line.points[0].x !== line.points[line.points.length - 1].x || 
             line.points[0].y !== line.points[line.points.length - 1].y)) {
          ctx.lineTo(line.points[0].x, line.points[0].y);
        }
          
          ctx.stroke();
        }
      });
  }, [activeTab, sketchLines, gridSize]);

  // Function to get canvas coordinates
  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Calculate coordinates taking into account DPI scaling and canvas CSS size
    const x = ((e.clientX - rect.left) * (canvas.width / rect.width)) / dpr;
    const y = ((e.clientY - rect.top) * (canvas.height / rect.height)) / dpr;
    
    return { x, y };
  };

  // Function to snap point to grid
  const snapToGridPoint = (point: {x: number, y: number}) => {
    if (!snapToGrid) return point;
    return {
      x: Math.round(point.x / gridSize) * gridSize,
      y: Math.round(point.y / gridSize) * gridSize
    };
  };

  // Function to calculate distance between points
  const calculateDistance = (p1: {x: number, y: number}, p2: {x: number, y: number}) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Function to draw grid
  const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.save();
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 0.5;

    // Draw vertical lines
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw horizontal lines
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.restore();
  };

  // Function to draw rectangle
  const drawRectangle = (ctx: CanvasRenderingContext2D, start: {x: number, y: number}, end: {x: number, y: number}, isDashed = false) => {
    if (isDashed) ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.rect(
      Math.min(start.x, end.x),
      Math.min(start.y, end.y),
      Math.abs(end.x - start.x),
      Math.abs(end.y - start.y)
    );
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Function to draw circle
  const drawCircle = (ctx: CanvasRenderingContext2D, center: {x: number, y: number}, end: {x: number, y: number}, isDashed = false) => {
    const radius = calculateDistance(center, end);
    if (isDashed) ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Modified draw function
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const { x: rawX, y: rawY } = getCanvasCoordinates(e);
    const { x, y } = snapToGrid ? snapToGridPoint({ x: rawX, y: rawY }) : { x: rawX, y: rawY };
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
      
    // Reset transforms and set styles
    ctx.setTransform(1, 0, 0, 1, 0, 0);
      const dpr = window.devicePixelRatio || 1;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#000';
      
    // Clear and redraw grid
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, canvas.width, canvas.height);

    // Redraw existing lines
    sketchLines.forEach(line => {
      if (line.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(line.points[0].x, line.points[0].y);
        for (let i = 1; i < line.points.length; i++) {
          ctx.lineTo(line.points[i].x, line.points[i].y);
        }
        ctx.stroke();
      }
    });

    // Draw current line if in freeform mode
    if (sketchMode === 'freeform' && isDrawing && currentLine.length > 0) {
      ctx.beginPath();
      ctx.moveTo(currentLine[0].x, currentLine[0].y);
      for (let i = 1; i < currentLine.length; i++) {
        ctx.lineTo(currentLine[i].x, currentLine[i].y);
      }
      // Draw line to current mouse position
      ctx.lineTo(x, y);
      
      // Just draw the current line without auto-closing
      ctx.stroke();
    }

    if (startPoint) {
      switch (sketchMode) {
        case 'precise':
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(startPoint.x, startPoint.y);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.setLineDash([]);
          setPreviewLine([startPoint, { x, y }]);
          break;

        case 'rectangle':
          drawRectangle(ctx, startPoint, { x, y }, true);
          setPreviewLine([
            startPoint,
            { x, y: startPoint.y },
            { x, y },
            { x: startPoint.x, y },
            startPoint
          ]);
          break;

        case 'circle':
          drawCircle(ctx, startPoint, { x, y }, true);
          const radius = calculateDistance(startPoint, { x, y });
          const points = [];
          const segments = 32;
          for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push({
              x: startPoint.x + Math.cos(angle) * radius,
              y: startPoint.y + Math.sin(angle) * radius
            });
          }
          setPreviewLine(points);
          break;
      }
    } else if (sketchMode === 'freeform' && isDrawing) {
      setCurrentLine([...currentLine, { x, y }]);
    }
  };
  
  // Function to convert sketch to SVG and extrude
  const convertSketchToModel = async () => {
    if (sketchLines.length === 0) {
      toast({
        title: "No sketch found",
        description: "Please draw something first",
        variant: "destructive",
      });
      return;
    }
    
    setIsSketchProcessing(true);
    
    try {
    // Create an SVG from the sketch
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const canvas = canvasRef.current;
    if (!canvas) return;
      
      // Get canvas dimensions
      const width = canvas.width;
      const height = canvas.height;
      
      svg.setAttribute('width', width.toString());
      svg.setAttribute('height', height.toString());
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      
      // Create a single path for all lines
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let d = '';
      
      // Process the sketch lines into a unified path
      if (sketchLines.length === 1) {
        // If there's only one line/shape, handle it according to mode
        const line = sketchLines[0];
        if (line.points.length > 2) {
          // Start the path
          const firstPoint = line.points[0];
          d += `M ${firstPoint.x} ${firstPoint.y}`;
          
          // Add all other points
          for (let i = 1; i < line.points.length; i++) {
            const point = line.points[i];
            d += ` L ${point.x} ${point.y}`;
          }
          
          // Only auto-close for non-freeform modes
          if (sketchMode !== 'freeform') {
            // Make sure to close the path if the last point isn't already the same as the first
            const lastPoint = line.points[line.points.length - 1];
            if (firstPoint.x !== lastPoint.x || firstPoint.y !== lastPoint.y) {
              d += ` L ${firstPoint.x} ${firstPoint.y}`;
            }
          }
        }
      } else if (sketchLines.length > 1) {
        // For multiple lines, create a compound path
        // Find all valid lines (with enough points)
        const validLines = sketchLines.filter(line => line.points.length > 2);
        
        if (validLines.length > 0) {
          // Process each line as a separate subpath
          validLines.forEach((line, index) => {
            // For each new subpath, start with M
            const firstPoint = line.points[0];
            d += `${index > 0 ? ' M' : 'M'} ${firstPoint.x} ${firstPoint.y}`;
            
            // Add all other points
            for (let i = 1; i < line.points.length; i++) {
              const point = line.points[i];
              d += ` L ${point.x} ${point.y}`;
            }
            
            // Only auto-close for non-freeform modes
            if (sketchMode !== 'freeform') {
              // Close this subpath if needed
              const lastPoint = line.points[line.points.length - 1];
              if (firstPoint.x !== lastPoint.x || firstPoint.y !== lastPoint.y) {
                d += ` L ${firstPoint.x} ${firstPoint.y}`;
              }
              
              // Close the subpath explicitly 
              d += ' Z';
            }
          });
        }
      }
      
      // Make sure the overall path is closed
      if (!d.endsWith(' Z')) {
        // Don't auto-close paths for freeform mode
        if (sketchMode !== 'freeform') {
          d += ' Z';
        }
      }
      
      path.setAttribute('d', d);
      path.setAttribute('fill', sketchMode === 'freeform' ? 'none' : 'black');
      path.setAttribute('stroke', 'black');
      path.setAttribute('stroke-width', '1');
      svg.appendChild(path);
    
    // Convert SVG to blob
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      
      // Add extra SVG attributes to ensure proper rendering
      const processedSvgString = svgString.replace('<svg', 
        '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
      
      const blob = new Blob([processedSvgString], { type: 'image/svg+xml' });
      const file = new File([blob], `sketch-${Date.now()}.svg`, { type: 'image/svg+xml' });
      
      // Load the SVG and extrude it with the current settings
      await loadSVG(file, extrusionDepth); // Use the user's specified extrusion depth
      
      // Get the last added model which should be our newly created one
      const currentModels = useScene.getState().models;
      const lastModel = currentModels[currentModels.length - 1];
      
      if (lastModel && lastModel.mesh) {
        // Apply default scale of 1
        lastModel.mesh.scale.set(1, 1, 1);
        
        // Calculate bounding box and find position
        const boundingBox = new THREE.Box3().setFromObject(lastModel.mesh);
        const position = findNonCollidingPosition(currentModels.slice(0, -1), boundingBox);
        
        // Center the model at the found position
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);
        lastModel.mesh.position.copy(position).sub(center);
        
        // Update original properties
        lastModel.originalPosition.copy(lastModel.mesh.position);
        lastModel.originalScale.copy(lastModel.mesh.scale);
      }
      
      toast({
        title: "Success",
        description: "Sketch converted to 3D model",
      });
      
      // Clear the sketch
      setSketchLines([]);
      setCurrentLine([]);
      setStartPoint(null);
      setPreviewLine(null);
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawGrid(ctx, canvas.width, canvas.height);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to convert sketch to 3D model",
        variant: "destructive",
      });
      console.error("Error converting sketch to 3D:", error);
    } finally {
      setIsSketchProcessing(false);
    }
  };

  // Add mouse event handlers for sketching
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(e);
    const snappedPoint = snapToGrid ? snapToGridPoint({ x, y }) : { x, y };

    if (sketchMode === 'freeform') {
      setIsDrawing(true);
      setCurrentLine([snappedPoint]);
    } else {
      setStartPoint(snappedPoint);
    }
  };

  const endDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (sketchMode === 'freeform' && isDrawing) {
      // Simply add the current line as is, without auto-closing
      setSketchLines([...sketchLines, { points: currentLine }]);
      setCurrentLine([]);
      setIsDrawing(false);
    } else if (startPoint && previewLine) {
      setSketchLines([...sketchLines, { points: previewLine }]);
      setStartPoint(null);
      setPreviewLine(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 flex items-center justify-between border-b">
        <h1 className="text-xl font-bold">FishCAD</h1>
        <div className="flex items-center">
          <ThemeToggle className="mr-2" />
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      
      <div className="flex-1 flex flex-col">
        <Tabs 
          defaultValue="models" 
          className="flex-1 flex flex-row h-full"
          value={activeTab}
          onValueChange={handleTabChange}
        >
          <TabsList className="flex flex-col h-full py-4 border-r space-y-2 w-20 shrink-0 overflow-y-auto overflow-x-hidden">
            <TabsTrigger value="models" className="flex justify-center items-center flex-col py-3 px-2">
              <Layers className="h-5 w-5" />
              <span className="text-xs mt-1">Models</span>
            </TabsTrigger>
            <TabsTrigger value="shapes" className="flex justify-center items-center flex-col py-3 px-2">
              <Box className="h-5 w-5" />
              <span className="text-xs mt-1">Shapes</span>
            </TabsTrigger>
            <TabsTrigger value="ai" className="flex justify-center items-center flex-col py-3 px-2 relative">
              <Bot className="h-5 w-5" />
              <span className="text-xs mt-1">AI</span>
            </TabsTrigger>
            <TabsTrigger value="sketch" className="flex justify-center items-center flex-col py-3 px-2">
              <Pencil className="h-5 w-5" />
              <span className="text-xs mt-1">Sketch</span>
            </TabsTrigger>
            <TabsTrigger value="text" className="flex justify-center items-center flex-col py-3 px-2">
              <Type className="h-5 w-5" />
              <span className="text-xs mt-1">Text</span>
            </TabsTrigger>
            <TabsTrigger value="appearance" className="flex justify-center items-center flex-col py-3 px-2">
              <Paintbrush className="h-5 w-5" />
              <span className="text-xs mt-1">Appearance</span>
            </TabsTrigger>
            <TabsTrigger value="library" className="flex justify-center items-center flex-col py-3 px-2 relative">
              <Shapes className="h-5 w-5" />
              <span className="text-xs mt-1">Library</span>
            </TabsTrigger>
            <TabsTrigger value="thingiverse" className="flex justify-center items-center flex-col py-3 px-2">
              <LibraryBig className="h-5 w-5" />
              <span className="text-xs mt-1">Thingiverse</span>
            </TabsTrigger>
          </TabsList>
          
          <div className="flex-1 overflow-hidden">
            {/* Models Tab */}
            <TabsContent value="models" className="flex-1 overflow-y-auto p-3 space-y-4 h-full">
              <div className="flex flex-col space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={handleImportClick}
                >
                  <Upload className="mr-1 h-4 w-4" />
                  Import STL, SVG or Image
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={handleExportModel}
                  disabled={selectedModelIndex === null}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Export STL
                </Button>
              </div>
              
              <div className="text-xs text-muted-foreground mt-1 mb-2">
                Keyboard shortcuts:
                <ul className="list-disc pl-5 mt-1 space-y-1">
                  <li>Copy model: Ctrl/Cmd + C</li>
                  <li>Paste model: Ctrl/Cmd + V</li>
                  <li>Delete model: Delete key</li>
                </ul>
              </div>
              
              <ModelList />
            </TabsContent>
            
            {/* Library Tab - Moved to match new tab order */}
            <TabsContent value="library" className="flex-1 overflow-y-auto p-0 h-full" forceMount style={{ display: activeTab === 'library' ? 'block' : 'none' }}>
              <TaiyakiLibraryComponent />
            </TabsContent>
            
            {/* Removed Drafts/Assets tab content */}
            
            {/* Shapes Tab */}
            <TabsContent value="shapes" className="flex-1 overflow-y-auto p-3 h-full">
              <div className="flex flex-col space-y-6">
                {/* Basic Shapes Section */}
                <Card className="p-4">
                  <h3 className="text-lg font-medium mb-3">Basic Shapes</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={handleAddCube} className="justify-center w-full">
                      Cube
                </Button>
                    <Button variant="outline" size="sm" onClick={handleAddSphere} className="justify-center w-full">
                      Sphere
                </Button>
                    <Button variant="outline" size="sm" onClick={handleAddCylinder} className="justify-center w-full">
                      Cylinder
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleAddCone} className="justify-center w-full">
                      Cone
                    </Button>
                  </div>
                </Card>

                {/* Extended Shapes Section */}
                <Card className="p-4">
                  <h3 className="text-lg font-medium mb-3">Extended Shapes</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={handleAddTorus} className="justify-center w-full">
                      Torus
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleAddCapsule} className="justify-center w-full">
                      Capsule
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleAddPyramid} className="justify-center w-full">
                      Pyramid
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleAddPrism} className="justify-center w-full">
                      Prism
                    </Button>
                  </div>
                </Card>

                {/* Advanced Shapes Section */}
                <Card className="p-4">
                  <h3 className="text-lg font-medium mb-3">Advanced Shapes</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={handleAddTorusKnot} className="justify-center w-full">
                      Torus Knot
                </Button>
                    <Button variant="outline" size="sm" onClick={handleAddOctahedron} className="justify-center w-full">
                      Octahedron
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleAddIcosahedron} className="justify-center w-full">
                      Icosahedron
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleAddDodecahedron} className="justify-center w-full">
                      Dodecahedron
                    </Button>
                  </div>
                </Card>

                {/* Description Card */}
                <Card className="p-4 bg-muted/40">
                  <p className="text-sm text-muted-foreground">
                    All dimensions are in millimeters (mm). Basic shapes are sized to approximately 2 inches (50.8 mm).
                  </p>
                </Card>
              </div>
            </TabsContent>

            {/* AI Tab - Set forceMount to maintain iframe state when switching tabs */}
            <TabsContent value="ai" className="flex-1 overflow-y-auto p-3 h-full" forceMount style={{ display: activeTab === 'ai' ? 'block' : 'none' }}>
              <MagicFishAIComponent />
            </TabsContent>
            
            {/* Sketch Tab */}
            <TabsContent value="sketch" className="flex-1 overflow-y-auto p-3 h-full">
              <div className="flex flex-col space-y-4">
                <h3 className="text-lg font-medium">Sketch & Extrude</h3>
                <p className="text-sm text-muted-foreground">
                  Draw a shape and convert it to a 3D model
                </p>
                
                {/* Drawing tools */}
                <div className="flex items-center space-x-2">
                  <Select
                    value={sketchMode}
                    onValueChange={(value: 'freeform' | 'precise' | 'rectangle' | 'circle') => setSketchMode(value)}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Select sketch mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="freeform">Freeform</SelectItem>
                      <SelectItem value="precise">Line</SelectItem>
                      <SelectItem value="rectangle">Rectangle</SelectItem>
                      <SelectItem value="circle">Circle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Grid settings */}
                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="snap-to-grid"
                      checked={snapToGrid}
                      onCheckedChange={(checked) => setSnapToGrid(checked === true)}
                    />
                    <Label htmlFor="snap-to-grid">Snap to Grid</Label>
                  </div>
                </div>
                
                {/* Canvas for drawing */}
                <div className="border rounded-md p-2 bg-white" style={{ height: '300px' }}>
                  <canvas 
                    ref={canvasRef}
                    className="w-full h-full cursor-crosshair"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={endDrawing}
                    onMouseLeave={endDrawing}
                  />
                </div>
                
                {/* Action buttons */}
                <div className="flex flex-col space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSketchLines([]);
                      setCurrentLine([]);
                      setStartPoint(null);
                      setPreviewLine(null);
                      const canvas = canvasRef.current;
                      if (canvas) {
                        const ctx = canvas.getContext('2d');
                        if (ctx) {
                          ctx.clearRect(0, 0, canvas.width, canvas.height);
                          drawGrid(ctx, canvas.width, canvas.height);
                        }
                      }
                    }}
                  >
                    Clear Sketch
                  </Button>
                  
                  <Button
                    onClick={convertSketchToModel}
                    disabled={isSketchProcessing || sketchLines.length === 0}
                  >
                    {isSketchProcessing ? "Creating 3D Model..." : "Create 3D Model"}
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            {/* Text Tab */}
            <TabsContent value="text" className="flex-1 overflow-y-auto p-3 h-full">
              <div className="flex flex-col space-y-4">
                <h3 className="text-lg font-medium">Create 3D Text</h3>
                <p className="text-sm text-muted-foreground">
                  {editingTextModelId 
                    ? "Edit your 3D text with the settings below" 
                    : "Configure your text settings and add it to the scene"}
                </p>

                {/* Preview Canvas */}
                <div className="p-4">
                  <h4 className="text-sm font-medium mb-2">Preview</h4>
                  <canvas
                    ref={textPreviewCanvasRef}
                    className="w-full"
                    style={{ height: '100px', backgroundColor: '#ffffff' }}
                  />
                </div>
                
                <div className="flex flex-col space-y-4">
                  {/* Text Input */}
                  <div className="grid grid-cols-4 items-center gap-2">
                    <Label htmlFor="text-input" className="text-right text-sm">
                      Text
                    </Label>
                    <Input
                      id="text-input"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      className="col-span-3"
                    />
                  </div>
                  
                  {/* Font Selection */}
                  <div className="grid grid-cols-4 items-center gap-2">
                    <Label htmlFor="font-select" className="text-right text-sm">
                      Font
                    </Label>
                    <Select value={selectedFont} onValueChange={setSelectedFont}>
                      <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select a font" />
                      </SelectTrigger>
                      <SelectContent>
                        {FONTS.map((font) => (
                          <SelectItem key={font.path} value={font.path}>
                            {font.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {/* Create or Update Button */}
                  <Button 
                    onClick={editingTextModelId ? handleUpdateText : handleCreateText} 
                    disabled={isLoading || Boolean(editingTextModelId && !selectedTextModel)}
                    className="mb-4"
                  >
                    {isLoading 
                      ? "Processing..." 
                      : editingTextModelId 
                        ? "Update 3D Text" 
                        : "Create 3D Text"}
                  </Button>
                  
                  {/* Settings Heading */}
                  <div className="border-t pt-4 mt-2">
                    <h4 className="text-sm font-medium mb-4">
                      {editingTextModelId 
                        ? "Adjust Text Properties" 
                        : "Text Properties"}
                    </h4>
                  </div>
                  
                  {/* Text Style Controls */}
                  <div className="grid gap-6">
                    {/* Bevel thickness control */}
                        <div className="flex items-center gap-4">
                          <Label className="w-24 text-right text-sm">Thickness</Label>
                          <div className="flex-1 flex items-center gap-3">
                            <Slider
                              value={[bevelThickness]}
                          min={0}
                          max={5}
                          step={0.1}
                              onValueChange={(value) => setBevelThickness(value[0])}
                              className="flex-1"
                            />
                        <span className="w-12 text-sm text-center">
                          {bevelThickness}mm
                            </span>
                          </div>
                        </div>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            {/* Materials Tab - Now Appearance Tab */}
            <TabsContent value="appearance" className="flex-1 overflow-y-auto p-3 h-full">
              <div className="flex flex-col space-y-4">
                <h3 className="text-lg font-medium">Appearance & Environment</h3>
                
                {/* Model Appearance */}
                <div className="border rounded-md p-4 space-y-4">
                  <h4 className="text-sm font-medium mb-2">Model Appearance</h4>
                  
                  {selectedModelIndex === null ? (
                    <div className="flex flex-col items-center justify-center py-4">
                      <Paintbrush className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground text-center">
                        Select a model to change its appearance
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Color Picker */}
                      <div className="flex flex-col space-y-3">
                        <div className="flex items-center gap-4">
                          <Label className="w-20 text-sm">Color</Label>
                          <input 
                            type="color" 
                            value={materialColor}
                            onChange={(e) => setMaterialColor(e.target.value)}
                            className="w-10 h-8 border cursor-pointer"
                          />
                        </div>
                        <Button 
                          onClick={applyColorToModel}
                          size="sm"
                        >
                          Apply Color
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                
                
                {/* Scene Visibility */}
                <div className="border rounded-md p-4 space-y-4">
                  <h4 className="text-sm font-medium mb-2">Scene Elements</h4>
                  
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id="show-grid"
                        checked={showGrid}
                        onCheckedChange={toggleGridVisibility}
                      />
                      <Label htmlFor="show-grid" className="text-sm font-normal cursor-pointer">
                        Show Grid
                      </Label>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Checkbox 
                        id="show-axes"
                        checked={showAxes}
                        onCheckedChange={toggleAxesVisibility}
                      />
                      <Label htmlFor="show-axes" className="text-sm font-normal cursor-pointer">
                        Show Axes
                      </Label>
                    </div>
                  </div>
                </div>
                
                {/* Environment Settings */}
                <div className="border rounded-md p-4 space-y-4">
                  <h4 className="text-sm font-medium mb-2">Background</h4>
                  
                  {/* Background Type */}
                  <div className="space-y-3">
                    <Label className="text-sm">Background Type</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button 
                        variant={backgroundType === "solid" ? "default" : "outline"} 
                        size="sm"
                        onClick={() => setBackgroundType("solid")}
                        className="flex items-center justify-center gap-1 h-9"
                      >
                        <span>Solid Color</span>
                      </Button>
                      <Button 
                        variant={backgroundType === "gradient" ? "default" : "outline"} 
                        size="sm"
                        onClick={() => setBackgroundType("gradient")}
                        className="flex items-center justify-center gap-1 h-9"
                      >
                        <span>Gradient</span>
                      </Button>
                    </div>
                  </div>
                  
                  {/* Background Color Settings */}
                  {backgroundType === "solid" ? (
                    <div className="flex items-center gap-4">
                      <Label className="w-20 text-sm">Color</Label>
                      <input 
                        type="color" 
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="w-10 h-8 border cursor-pointer"
                      />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-4">
                        <Label className="w-20 text-sm">Top Color</Label>
                        <input 
                          type="color" 
                          value={gradientTopColor}
                          onChange={(e) => setGradientTopColor(e.target.value)}
                          className="w-10 h-8 border cursor-pointer"
                        />
                      </div>
                      <div className="flex items-center gap-4">
                        <Label className="w-20 text-sm">Bottom Color</Label>
                        <input 
                          type="color" 
                          value={gradientBottomColor}
                          onChange={(e) => setGradientBottomColor(e.target.value)}
                          className="w-10 h-8 border cursor-pointer"
                        />
                      </div>
                    </div>
                  )}
                  
                  {/* Apply Background Button */}
                  <Button 
                    onClick={applyBackgroundChange}
                    className="w-full"
                  >
                    Apply Background
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            {/* Thingiverse Tab */}
            <TabsContent value="thingiverse" className="flex-1 h-full overflow-hidden" forceMount style={{ display: activeTab === 'thingiverse' ? 'block' : 'none' }}>
              <ThingiverseEmbed />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
