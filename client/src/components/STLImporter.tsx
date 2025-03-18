import React, { useEffect, useState } from 'react';
import { toast } from "sonner";
import { Socket, io } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { useScene } from '@/hooks/use-scene';
import { AlertCircle, CheckCircle, XCircle, ArrowUpCircle, RotateCw } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useCallback } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import * as THREE from 'three';
import axios from 'axios';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, Download, ExternalLink, ChevronRight } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useToast } from '@/hooks/use-toast';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Define the allowed origins - ensure this matches what's in the server
const ALLOWED_ORIGINS = ["https://fishcad.com", "https://www.fishcad.com", "http://localhost:3000", "http://localhost:3001", "http://localhost:5173"];

// Define the API endpoint
const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? window.location.hostname === 'www.fishcad.com' 
    ? 'https://www.fishcad.com/api' // Use same domain as current page
    : 'https://fishcad.com/api'
  : 'http://localhost:3001/api';

// Define import job status types
type ImportJobStatus = 'pending' | 'downloading' | 'processing' | 'completed' | 'failed';

// Define import message structure
interface STLImportMessage {
  type: string;
  stlUrl?: string;
  stlBase64?: string;
  fileName?: string;
  metadata?: {
    name?: string;
    description?: string;
    author?: string;
    license?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

// Define import job structure
interface ImportJob {
  id: string;
  status: ImportJobStatus;
  source: string;
  fileName: string;
  metadata: Record<string, any>;
  error?: string;
  filePath?: string;
  importedAt: Date;
  updatedAt: Date;
}

// Define active import structure
interface ActiveImport {
  id: string;
  job: ImportJob;
  source: string;
  progress: number;
}

// Add this function to handle chunked file reading for larger STL files
function readFileChunked(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
    const fileReader = new FileReader();
    let offset = 0;
    let result = '';
    
    // Process the file in chunks
    const readNextChunk = () => {
      const blob = file.slice(offset, offset + CHUNK_SIZE);
      fileReader.readAsArrayBuffer(blob);
    };
    
    fileReader.onload = (e) => {
      if (!e.target?.result) {
        reject(new Error('Failed to read file chunk'));
        return;
      }
      
      // Convert the chunk to a base64 string and append to result
      const chunk = Buffer.from(e.target.result as ArrayBuffer).toString('base64');
      result += chunk;
      
      // Move to the next chunk or finish
      offset += CHUNK_SIZE;
      if (offset < file.size) {
        readNextChunk();
      } else {
        resolve(result);
      }
    };
    
    fileReader.onerror = (error) => {
      reject(error);
    };
    
    // Start reading the first chunk
    readNextChunk();
  });
}

// STL Importer component
export function STLImporter() {
  // State for socket and active imports
  const [socket, setSocket] = useState<Socket | null>(null);
  const [activeImports, setActiveImports] = useState<Record<string, ActiveImport>>({});
  const [expanded, setExpanded] = useState(false);
  const [isReady, setIsReady] = useState(false);
  
  // Get the scene functions
  const { loadSTL, selectModel, models } = useScene();
  
  // State for file handling
  const [file, setFile] = useState<File | null>(null);
  const [stlData, setStlData] = useState<THREE.BufferGeometry | null>(null);
  const [base64Data, setBase64Data] = useState<string | null>(null);
  const [processingFile, setProcessingFile] = useState(false);
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState('');
  const [stlInfo, setStlInfo] = useState<{
    vertices: number;
    triangles: number;
    volume: number;
    size: string;
  } | null>(null);
  
  const [modelName, setModelName] = useState('');
  const [modelWidth, setModelWidth] = useState('100');
  const [modelHeight, setModelHeight] = useState('100');
  const [modelDepth, setModelDepth] = useState('100');
  const [material, setMaterial] = useState('PLA');
  const [infill, setInfill] = useState(20);
  const [email, setEmail] = useState('');
  
  // Add these new states for the download dialog
  const [isDownloadDialogOpen, setIsDownloadDialogOpen] = useState(false);
  const [downloadInfo, setDownloadInfo] = useState<{
    url: string;
    fileName: string;
    checkoutUrl: string;
    modelId: string;
  } | null>(null);
  const [hasCopiedLink, setHasCopiedLink] = useState(false);
  
  const { toast } = useToast();
  
  // Initialize socket connection
  useEffect(() => {
    // Connect to the server socket
    try {
      // Use the same origin as the current page to avoid CORS issues
      const currentOrigin = window.location.origin;
      const socketUrl = process.env.NODE_ENV === 'production'
        ? currentOrigin // Use same origin in production
        : API_BASE_URL.replace('/api', '');
      
      console.log(`Connecting to Socket.IO at: ${socketUrl}`);
      
      const newSocket = io(socketUrl, {
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 20000,
        transports: ['websocket', 'polling'], // Try websocket first, fallback to polling
        path: '/socket.io/', // Ensure path is consistent
        withCredentials: true
      });
      
      // Set the socket to state
      setSocket(newSocket);
      
      // Connection event handlers
      newSocket.on('connect', () => {
        console.log('Socket.IO connected with ID:', newSocket.id);
        setIsReady(true);
      });
      
      newSocket.on('disconnect', () => {
        console.log('Socket.IO disconnected');
        setIsReady(false);
      });
      
      newSocket.on('connect_error', (error: Error) => {
        console.error('Socket.IO connection error:', error);
        console.log('Connection error details:', error.message);
        setIsReady(false);
      });
      
      // Cleanup on unmount
      return () => {
        console.log('Disconnecting Socket.IO');
        newSocket.disconnect();
      };
    } catch (error) {
      console.error('Error initializing Socket.IO:', error);
      return () => {/* no cleanup needed */};
    }
  }, []);
  
  // Announce readiness to parent frames
  useEffect(() => {
    if (!isReady) return;
    
    // Function to announce readiness
    const announceReady = () => {
      try {
        // Announce to potential parent windows
        if (window.parent && window.parent !== window) {
          console.log('Announcing FISHCAD ready to parent window');
          window.parent.postMessage({
            type: 'fishcad-ready',
            ready: true,
            version: '1.0'
          }, '*');
        }
        
        // Also send to any potential openers (when opened in new window)
        if (window.opener) {
          console.log('Announcing FISHCAD ready to opener window');
          window.opener.postMessage({
            type: 'fishcad-ready',
            ready: true,
            version: '1.0'
          }, '*');
        }
      } catch (error) {
        console.error('Error announcing readiness:', error);
      }
    };
    
    // Announce immediately
    announceReady();
    
    // And also set a timeout to do it again after a second
    // (some parent frames might not be ready to receive messages immediately)
    const timeoutId = setTimeout(announceReady, 1000);
    
    return () => clearTimeout(timeoutId);
  }, [isReady]);
  
  // Set up event listeners for window messages
  useEffect(() => {
    // Message handler function
    const handleMessage = async (event: MessageEvent) => {
      // Uncomment for debugging all messages
      // console.log("Received message:", event.origin, event.data);
      
      // Validate origin (more permissive for development)
      const validOrigin = process.env.NODE_ENV === 'development' ? 
        true : // In development, accept messages from any origin for easier testing
        ALLOWED_ORIGINS.includes(event.origin); // In production, strictly check origins
      
      // Security check for allowed origins
      if (!validOrigin) {
        if (event.data && typeof event.data === 'object' && 'type' in event.data) {
          // Log the rejected message type for debugging
          console.log(`Ignored message with type '${event.data.type}' from non-allowed origin: ${event.origin}`);
        }
        return;
      }
      
      // Check if data exists and is in the expected format
      if (!event.data || typeof event.data !== 'object') {
        console.log('Ignored message: Invalid data format');
        return;
      }
      
      // Parse the message data
      const message = event.data as STLImportMessage;
      
      // Log the message type for debugging
      console.log(`Processing message from ${event.origin} with type: ${message.type}`);
      
      try {
        // Handle STL URL import
        if ((message.type === 'import-stl' || message.type === 'stl-import') && message.stlUrl) {
          console.log(`Received STL URL import request from ${event.origin}`, message);
          await handleSTLUrlImport(message, event.origin);
        }
        // Handle direct base64 import
        else if ((message.type === 'import-stl' || message.type === 'stl-import') && message.stlBase64) {
          console.log(`Received STL base64 import request from ${event.origin} (${(message.stlBase64 as string).length} chars)`);
          await handleSTLBase64Import(message, event.origin);
        }
        // Handle direct file upload
        else if (message.type === 'stl-upload') {
          console.log(`Received STL file upload request from ${event.origin}`);
          await handleSTLDirectUpload(message, event.origin);
        }
        // Handle ready check
        else if (message.type === 'fishcad-ready-check') {
          console.log(`Received ready check from ${event.origin}`);
          sendResponseToOrigin(event.origin, {
            type: 'fishcad-ready-response',
            ready: isReady,
            version: '1.0'
          });
        }
        // Handle ping (for connection testing)
        else if (message.type === 'ping') {
          console.log(`Received ping from ${event.origin}`);
          sendResponseToOrigin(event.origin, {
            type: 'pong',
            timestamp: Date.now(),
            originalMessage: message
          });
        }
      } catch (error) {
        console.error(`Error handling message of type ${message.type}:`, error);
        
        // Send generic error response
        try {
          sendResponseToOrigin(event.origin, {
            type: `${message.type}-response`,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        } catch (responseError) {
          console.error('Error sending error response:', responseError);
        }
      }
    };
    
    // Add message event listener
    window.addEventListener('message', handleMessage);
    
    // Log that we're listening for messages
    console.log('STLImporter: Listening for postMessage events');
    
    // Cleanup
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [socket, activeImports, isReady]);
  
  // Handle STL URL import
  const handleSTLUrlImport = async (message: STLImportMessage, origin: string) => {
    try {
      // Show loading notification
      toast.loading(`Importing model from ${origin}...`, {
        id: "import-toast"
      });
      
      // Send the request to the server
      const response = await fetch(`${API_BASE_URL}/import-stl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          stlUrl: message.stlUrl,
          fileName: message.fileName || 'model.stl',
          source: origin,
          metadata: message.metadata || {}
        }),
        credentials: 'include'
      });
      
      // Check for network errors
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      // Parse response
      const data = await response.json();
      
      if (data.success && data.importId) {
        // Join the socket room for this import
        if (socket) {
          socket.emit('join-import-room', data.importId);
        }
        
        // Add the import to active imports
        setActiveImports(prev => ({
          ...prev,
          [data.importId]: {
            id: data.importId,
            job: data.job,
            source: origin,
            progress: 0
          }
        }));
        
        // Expand the panel if it's the first import
        if (Object.keys(activeImports).length === 0) {
          setExpanded(true);
        }
        
        // Send success response back to origin
        sendResponseToOrigin(origin, {
          type: 'stl-import-response',
          success: true,
          importId: data.importId,
          message: 'Import started successfully'
        });
        
        // Update the toast
        toast.success(`Import started: ${message.fileName || 'model.stl'}`, {
          id: "import-toast"
        });
      } else {
        throw new Error(data.error || 'Failed to start import');
      }
    } catch (error) {
      console.error('Error starting import:', error);
      
      // Show error notification
      toast.error(`Failed to import model: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        id: "import-toast"
      });
      
      // Send error response back to origin
      sendResponseToOrigin(origin, {
        type: 'stl-import-response',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
  
  // Handle STL base64 import
  const handleSTLBase64Import = async (message: STLImportMessage, origin: string) => {
    try {
      // Show loading notification
      toast.loading(`Processing base64 model from ${origin}...`, {
        id: "import-toast-base64"
      });

      // Check if we should use direct embed or server approach
      const stlBase64 = message.stlBase64 as string;
      
      // Determine size - rough estimation of base64 size
      const estimatedSize = stlBase64.length * 0.75; // base64 is ~4/3 the size of binary
      console.log(`Estimated STL size: ${Math.round(estimatedSize / 1024)} KB`);
      
      // If smaller than 5MB, try direct embed
      if (estimatedSize < 5 * 1024 * 1024) {
        try {
          // Try to load directly into the scene
          await loadSTL(stlBase64, message.fileName);
          
          // Select the newly added model
          selectModel(models.length - 1);
          
          // Show success notification
          toast.success(`Imported model from ${origin}`, {
            id: "import-toast-base64"
          });
          
          // Send success response back to origin
          sendResponseToOrigin(origin, {
            type: 'stl-import-response',
            success: true,
            message: 'Model imported successfully'
          });
          
          return;
        } catch (directError) {
          // If direct import fails, fall back to server approach
          console.warn('Direct base64 import failed, falling back to server:', directError);
        }
      }
      
      // Create a file blob from the base64 data
      let binary: Blob;
      
      // Check if it's a data URL or raw base64
      if (stlBase64.startsWith('data:')) {
        // It's a data URL, extract the base64 part
        const base64Content = stlBase64.split(',')[1];
        if (!base64Content) {
          throw new Error('Invalid base64 data URL format');
        }
        const binaryString = atob(base64Content);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        binary = new Blob([bytes.buffer], { type: 'model/stl' });
      } else {
        // It's raw base64
        const binaryString = atob(stlBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        binary = new Blob([bytes.buffer], { type: 'model/stl' });
      }
      
      // Create form data for upload
      const formData = new FormData();
      formData.append('file', binary, message.fileName || 'model.stl');
      formData.append('source', origin);
      
      if (message.metadata) {
        formData.append('metadata', JSON.stringify(message.metadata));
      }
      
      if (message.fileName) {
        formData.append('fileName', message.fileName);
      }
      
      // Send to the server
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
        // Do not set Content-Type header, browser will set it with boundary
        credentials: 'include'
      });
      
      // Check for network errors
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      // Parse response
      const data = await response.json();
      
      if (data.success && data.importId) {
        // Join the socket room for this import
        if (socket) {
          socket.emit('join-import-room', data.importId);
        }
        
        // Add the import to active imports
        setActiveImports(prev => ({
          ...prev,
          [data.importId]: {
            id: data.importId,
            job: data.job,
            source: origin,
            progress: getProgressForStatus(data.job.status)
          }
        }));
        
        // Expand the panel if it's the first import
        if (Object.keys(activeImports).length === 0) {
          setExpanded(true);
        }
        
        // Send success response back to origin
        sendResponseToOrigin(origin, {
          type: 'stl-import-response',
          success: true,
          importId: data.importId,
          message: 'Import started successfully'
        });
        
        // Update the toast
        toast.success(`Import successful: ${message.fileName || 'model.stl'}`, {
          id: "import-toast-base64"
        });
      } else {
        throw new Error(data.error || 'Failed to upload model');
      }
    } catch (error) {
      console.error('Error processing base64 model:', error);
      
      // Show error notification
      toast.error(`Failed to import model: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        id: "import-toast-base64"
      });
      
      // Send error response back to origin
      sendResponseToOrigin(origin, {
        type: 'stl-import-response',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
  
  // Handle direct file upload from external site
  const handleSTLDirectUpload = async (message: STLImportMessage, origin: string) => {
    try {
      // Show loading notification
      toast.loading(`Processing upload request from ${origin}...`, {
        id: "import-toast-upload"
      });
      
      // Extract the file from the message
      const { fileData } = message;
      
      if (!fileData) {
        throw new Error('No file data provided');
      }
      
      // Notify the external site we're preparing to receive the file
      sendResponseToOrigin(origin, {
        type: 'stl-upload-ready',
        success: true
      });
      
      // Update the toast
      toast.loading(`Ready to receive file from ${origin}...`, {
        id: "import-toast-upload"
      });
      
      // The external site should now send the actual file data in another message
      // We'll handle that in the main message handler event
      
    } catch (error) {
      console.error('Error handling upload request:', error);
      
      // Show error notification
      toast.error(`Failed to process upload: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        id: "import-toast-upload"
      });
      
      // Send error response back to origin
      sendResponseToOrigin(origin, {
        type: 'stl-upload-response',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
  
  // Set up socket event listeners for import updates
  useEffect(() => {
    if (!socket) return;
    
    // Import status update handler
    const handleStatusUpdate = (data: { importId: string; status: ImportJobStatus; job: ImportJob }) => {
      const { importId, status, job } = data;
      
      // Update the import in state
      setActiveImports(prev => {
        if (!prev[importId]) return prev;
        
        const updatedImport = {
          ...prev[importId],
          job: job,
          progress: getProgressForStatus(status)
        };
        
        return {
          ...prev,
          [importId]: updatedImport
        };
      });
    };
    
    // Import completed handler
    const handleImportCompleted = async (data: { importId: string; job: ImportJob }) => {
      const { importId, job } = data;
      
      // Get the import from state
      const activeImport = activeImports[importId];
      if (!activeImport) return;
      
      // Show success notification
      toast.success(`Model imported successfully: ${job.fileName}`, {
        id: `import-toast-${importId}`
      });
      
      try {
        // Load the model into the scene
        const modelUrl = `${API_BASE_URL}/models/${importId}`;
        await loadSTL(modelUrl, job.fileName);
        
        // Select the newly added model
        selectModel(models.length - 1);
        
        // Send success response to origin
        sendResponseToOrigin(activeImport.source, {
          type: 'stl-import-response',
          success: true,
          importId,
          message: 'Model loaded into scene'
        });
      } catch (error) {
        console.error('Error loading model into scene:', error);
        
        // Show error notification
        toast.error(`Failed to load model into scene: ${error instanceof Error ? error.message : 'Unknown error'}`, {
          id: `import-toast-${importId}`
        });
      }
    };
    
    // Import failed handler
    const handleImportFailed = (data: { importId: string; error: string; job: ImportJob }) => {
      const { importId, error, job } = data;
      
      // Show error notification
      toast.error(`Import failed: ${error}`, {
        id: `import-toast-${importId}`
      });
      
      // Get the import from state
      const activeImport = activeImports[importId];
      if (!activeImport) return;
      
      // Send error response to origin
      sendResponseToOrigin(activeImport.source, {
        type: 'stl-import-response',
        success: false,
        importId,
        error
      });
    };
    
    // Add event listeners
    socket.on('import-status-update', handleStatusUpdate);
    socket.on('import-completed', handleImportCompleted);
    socket.on('import-failed', handleImportFailed);
    
    // Cleanup
    return () => {
      socket.off('import-status-update', handleStatusUpdate);
      socket.off('import-completed', handleImportCompleted);
      socket.off('import-failed', handleImportFailed);
    };
  }, [socket, activeImports, loadSTL, selectModel, models]);
  
  // Helper function to send a response to the origin
  const sendResponseToOrigin = (origin: string, data: any) => {
    // Don't send to invalid origins
    if (!origin || origin === 'null') {
      console.warn(`Cannot send response to invalid origin: ${origin}`);
      return;
    }
    
    // First try window.parent approach (for all origins)
    let sentToParent = false;
    try {
      if (window.parent && window.parent !== window) {
        // Try to send to the parent window first
        window.parent.postMessage(data, origin);
        sentToParent = true;
        console.log(`Sent response to parent window (${origin}):`, data);
      }
    } catch (parentError) {
      console.warn(`Error sending to parent window (${origin}):`, parentError);
    }
    
    // If we couldn't send to parent or still want to try iframes
    if (!sentToParent) {
      // Find all iframes in the document
      const iframes = document.querySelectorAll('iframe');
      let found = false;
      
      // Check each iframe
      iframes.forEach(iframe => {
        try {
          // Try to get the iframe's origin
          const iframeOrigin = new URL(iframe.src).origin;
          
          // If the origins match, send the message
          if (iframeOrigin === origin) {
            iframe.contentWindow?.postMessage(data, origin);
            found = true;
            console.log(`Sent response to iframe (${origin}):`, data);
          }
        } catch (error) {
          // Ignore errors when trying to access iframe origins
          console.warn("Could not access iframe origin", error);
        }
      });
      
      // If no matching iframe was found, try a direct window.opener approach
      if (!found) {
        try {
          if (window.opener) {
            // Send to the opener window
            window.opener.postMessage(data, origin);
            console.log(`Sent response to opener window (${origin}):`, data);
          } else {
            console.warn(`No suitable target found for origin ${origin}`);
          }
        } catch (openerError) {
          console.warn(`Could not send response to opener (${origin}):`, openerError);
        }
      }
    }
  };
  
  // Helper function to get progress percentage for a status
  const getProgressForStatus = (status: ImportJobStatus): number => {
    switch (status) {
      case 'pending':
        return 0;
      case 'downloading':
        return 30;
      case 'processing':
        return 70;
      case 'completed':
        return 100;
      case 'failed':
        return 100;
      default:
        return 0;
    }
  };
  
  // Helper function to get status icon
  const getStatusIcon = (status: ImportJobStatus) => {
    switch (status) {
      case 'pending':
        return <RotateCw className="animate-spin h-4 w-4 text-yellow-500" />;
      case 'downloading':
        return <ArrowUpCircle className="h-4 w-4 text-blue-500" />;
      case 'processing':
        return <RotateCw className="animate-spin h-4 w-4 text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };
  
  const handleCheckout = async () => {
    if (!file || !base64Data) {
      setError('Please upload an STL file first');
      return;
    }
    
    setProcessingCheckout(true);
    setError(null);
    
    try {
      // Prepare checkout data
      const checkoutData = {
        stlBase64: base64Data,
        stlFileName: file.name,
        modelName: modelName || file.name.replace(/\.stl$/i, ''),
        dimensions: `${modelWidth}x${modelHeight}x${modelDepth}`,
        material,
        infillPercentage: infill,
        price: calculatePrice(), // in cents
        email,
      };
      
      // Send checkout request
      const response = await axios.post('/api/checkout', checkoutData, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 60000, // 60 second timeout for large files
      });
      
      // Check for successful response
      if (response.data && response.data.success) {
        // Extract the STL URL and other info
        if (response.data.stlInfo && response.data.stlInfo.url) {
          setDownloadInfo({
            url: response.data.stlInfo.url,
            fileName: response.data.stlInfo.fileName || file.name,
            checkoutUrl: response.data.url,
            modelId: response.data.stlInfo.modelId || ''
          });
          
          // Show the download dialog
          setIsDownloadDialogOpen(true);
          
          // Don't redirect automatically, let the user choose
        } else if (response.data.url) {
          // No download link, just redirect to Stripe
          window.location.href = response.data.url;
        } else {
          setError('Checkout succeeded but no redirect URL was provided');
          toast({
            title: 'Checkout Error',
            description: 'Unable to proceed to payment page. Please try again.',
            variant: 'destructive',
          });
        }
      } else {
        // Handle server-side error
        setError(response.data.error || 'Checkout failed. Please try again.');
        toast({
          title: 'Checkout Failed',
          description: response.data.error || 'Unable to process checkout. Please try again.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      
      // Extract error message from axios error
      let errorMessage = 'Network error. Please check your connection and try again.';
      
      if (error.response) {
        // Server responded with error status
        errorMessage = error.response.data?.error || 
                      `Server error: ${error.response.status} ${error.response.statusText}`;
      } else if (error.request) {
        // Request was made but no response received
        errorMessage = 'Server did not respond. Please try again later.';
      } else if (error.message) {
        // Other errors
        errorMessage = error.message;
      }
      
      setError(errorMessage);
      toast({
        title: 'Checkout Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setProcessingCheckout(false);
    }
  };
  
  // Add function to handle download
  const handleDownload = () => {
    if (downloadInfo?.url) {
      // Create a hidden anchor element for download
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = downloadInfo.url;
      a.download = downloadInfo.fileName;
      
      // Add to DOM, click, and remove
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
      }, 100);
      
      toast({
        title: 'Download Started',
        description: `Your STL file "${downloadInfo.fileName}" is downloading.`,
      });
    }
  };
  
  // Add function to copy link to clipboard
  const copyLinkToClipboard = () => {
    if (downloadInfo?.url) {
      navigator.clipboard.writeText(downloadInfo.url)
        .then(() => {
          setHasCopiedLink(true);
          toast({
            title: 'Link Copied',
            description: 'Download link copied to clipboard',
          });
          
          // Reset the copied state after 3 seconds
          setTimeout(() => {
            setHasCopiedLink(false);
          }, 3000);
        })
        .catch((error) => {
          console.error('Failed to copy link:', error);
          toast({
            title: 'Failed to Copy',
            description: 'Could not copy link to clipboard',
            variant: 'destructive',
          });
        });
    }
  };
  
  // Function to proceed to Stripe checkout
  const proceedToStripeCheckout = () => {
    if (downloadInfo?.checkoutUrl) {
      window.location.href = downloadInfo.checkoutUrl;
    } else {
      toast({
        title: 'Error',
        description: 'Checkout URL is missing',
        variant: 'destructive',
      });
    }
  };
  
  // If there are no active imports and the panel is not expanded, render nothing
  if (Object.keys(activeImports).length === 0 && !expanded) {
    return null;
  }
  
  // Render the importer UI
  return (
    <Card className="fixed bottom-4 right-4 z-50 w-80 shadow-lg border border-border max-h-[80vh] overflow-hidden flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <CardTitle className="text-sm">STL Imports</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide' : 'Show'}
          </Button>
        </div>
        {expanded && (
          <CardDescription className="text-xs">
            Manage STL models imported from external sites
          </CardDescription>
        )}
      </CardHeader>
      
      {expanded && (
        <CardContent className="overflow-y-auto">
          {Object.keys(activeImports).length === 0 ? (
            <div className="text-center text-gray-500 py-4">
              No active imports
            </div>
          ) : (
            <Accordion type="multiple" className="w-full">
              {Object.values(activeImports).map((importItem) => (
                <AccordionItem key={importItem.id} value={importItem.id}>
                  <AccordionTrigger className="text-sm">
                    <div className="flex items-center space-x-2">
                      {getStatusIcon(importItem.job.status)}
                      <span className="truncate max-w-[180px]">
                        {importItem.job.fileName}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span>Status:</span>
                        <span className="capitalize">{importItem.job.status}</span>
                      </div>
                      
                      <Progress value={importItem.progress} className="h-1" />
                      
                      <div className="flex justify-between">
                        <span>Source:</span>
                        <span className="truncate max-w-[140px]">{importItem.source}</span>
                      </div>
                      
                      {importItem.job.error && (
                        <div className="text-red-500 mt-1">
                          Error: {importItem.job.error}
                        </div>
                      )}
                      
                      {importItem.job.status === 'failed' && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="w-full mt-2"
                          onClick={() => {
                            // Retry logic here
                            console.log('Retry import:', importItem.id);
                          }}
                        >
                          Retry Import
                        </Button>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default STLImporter; 