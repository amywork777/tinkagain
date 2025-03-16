import { useScene } from "@/hooks/use-scene";
import { toast } from "sonner";
import * as THREE from 'three';
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

// The allowed origins for messages - allowing all origins by making this check always pass
const ALLOWED_ORIGINS = ["*"]; // Allow all origins

/**
 * CORS Requirements for STL loading:
 * 
 * The server hosting the STL files must include the following CORS headers:
 * - Access-Control-Allow-Origin: https://fishcad.com (or appropriate domain)
 * - Access-Control-Allow-Methods: GET
 * - Access-Control-Allow-Headers: Content-Type, Accept
 * 
 * Without these headers, the browser's security policy will prevent loading the STL files.
 */

// Interface for the message data structure
interface STLImportMessage {
  type: string;
  stlUrl?: string;
  stlBase64?: string; // New field for base64 encoded STL data
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

// Import statistics tracking
interface ImportStats {
  totalImports: number;
  importsByOrigin: Record<string, number>;
  lastImportTime: Date | null;
  importErrors: number;
  successfulImports: number;
}

// Initialize import statistics
const importStats: ImportStats = {
  totalImports: 0,
  importsByOrigin: {},
  lastImportTime: null,
  importErrors: 0,
  successfulImports: 0
};

/**
 * Loads an STL model directly from base64 encoded data
 * @param base64Data The base64 encoded STL data
 * @param fileName Optional file name for the model
 * @param metadata Additional metadata about the model
 * @param origin The origin of the request
 * @returns A Promise that resolves when the model is loaded
 */
async function loadSTLFromBase64(base64Data: string, fileName?: string, metadata?: STLImportMessage['metadata'], origin?: string): Promise<void> {
  // Show loading notification
  toast.loading(`Importing model from ${origin || "external source"}...`, {
    id: "import-toast"
  });
  
  try {
    console.log("Loading STL from base64 data");
    
    // Use the scene store's functions
    const { models, saveHistoryState, updateGridPosition } = useScene.getState();
    
    // Parse the base64 data
    let binary: ArrayBuffer;
    
    // Check if the base64 string includes a data URL prefix
    if (base64Data.startsWith('data:')) {
      // Handle data URL format (e.g., data:model/stl;base64,...)
      const base64Content = base64Data.split(',')[1];
      if (!base64Content) {
        throw new Error('Invalid base64 data URL format');
      }
      binary = _base64ToArrayBuffer(base64Content);
    } else {
      // Handle raw base64 string
      binary = _base64ToArrayBuffer(base64Data);
    }
    
    // Parse the STL data
    const loader = new STLLoader();
    const geometry = loader.parse(binary);
    
    // Access the direct scene store state
    const sceneState = useScene.getState();
    
    // Directly call loadSTL with a Blob to use the existing infrastructure
    const blob = new Blob([binary], { type: 'model/stl' });
    const file = new File([blob], fileName || 'model.stl', { type: 'model/stl' });
    
    // Load the STL file using the existing method
    await sceneState.loadSTL(file, metadata?.name || fileName);
    
    // Update import statistics
    updateImportStats(origin || "unknown", true);
    
    // Show success notification
    toast.success(`Imported model from ${origin || "external source"}`, {
      id: "import-toast"
    });
    
    // Send success response back to origin
    if (origin) {
      sendResponseToOrigin(origin, {
        type: "stl-import-response",
        success: true,
        message: "Model imported successfully"
      });
    }
  } catch (error) {
    // Update error statistics
    updateImportStats(origin || "unknown", false);
    
    // Show error notification
    toast.error(`Failed to import model: ${(error as Error).message}`, {
      id: "import-toast"
    });
    
    // Send error response back to origin
    if (origin) {
      sendResponseToOrigin(origin, {
        type: "stl-import-response",
        success: false,
        error: (error as Error).message
      });
    }
    
    console.error("Error loading STL from base64:", error);
  }
}

/**
 * Helper function to convert base64 to ArrayBuffer
 * @param base64 The base64 string to convert
 * @returns The resulting ArrayBuffer
 */
function _base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  
  return bytes.buffer;
}

/**
 * Loads an STL model from a URL
 * @param url The URL of the STL file to load
 * @param metadata Additional metadata about the model
 * @param origin The origin of the request
 * @returns A Promise that resolves when the model is loaded
 */
async function loadSTLFromUrl(url: string, metadata?: STLImportMessage['metadata'], origin?: string): Promise<void> {
  // Show loading notification
  toast.loading(`Importing model from ${origin || "external source"}...`, {
    id: "import-toast"
  });
  
  try {
    // Use the scene store's loadSTL function directly with the URL
    const { loadSTL, selectModel, models } = useScene.getState();
    
    // Fetch the STL file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // Convert response to blob
    const blob = await response.blob();
    
    // Create object URL
    const objectUrl = URL.createObjectURL(blob);
    
    // Load the STL file using the object URL
    await loadSTL(objectUrl, metadata?.name);
    
    // Revoke the object URL to free memory
    URL.revokeObjectURL(objectUrl);
    
    // Select the newly added model
    selectModel(models.length - 1);
    
    // Update import statistics
    updateImportStats(origin || "unknown", true);
    
    // Show success notification
    toast.success(`Imported model from ${origin || "external source"}`, {
      id: "import-toast"
    });
    
    // Send success response back to origin
    if (origin) {
      sendResponseToOrigin(origin, {
        type: "stl-import-response",
        success: true,
        message: "Model imported successfully"
      });
    }
  } catch (error) {
    // Update error statistics
    updateImportStats(origin || "unknown", false);
    
    // Show error notification
    toast.error(`Failed to import model: ${(error as Error).message}`, {
      id: "import-toast"
    });
    
    // Send error response back to origin
    if (origin) {
      sendResponseToOrigin(origin, {
        type: "stl-import-response",
        success: false,
        error: (error as Error).message
      });
    }
    
    console.error("Error loading STL from URL:", error);
  }
}

/**
 * Update the import statistics
 * @param origin The origin of the import
 * @param success Whether the import was successful
 */
function updateImportStats(origin: string, success: boolean): void {
  // Update total imports
  importStats.totalImports++;
  
  // Update imports by origin
  importStats.importsByOrigin[origin] = (importStats.importsByOrigin[origin] || 0) + 1;
  
  // Update last import time
  importStats.lastImportTime = new Date();
  
  // Update success/error counts
  if (success) {
    importStats.successfulImports++;
  } else {
    importStats.importErrors++;
  }
  
  // Log the import statistics
  console.log("Import statistics:", importStats);
}

/**
 * Send a response message back to the origin
 * @param origin The origin to send the message to
 * @param data The data to send
 */
function sendResponseToOrigin(origin: string, data: any): void {
  // Find all iframes in the document
  const iframes = document.querySelectorAll('iframe');
  let found = false;
  
  // Check each iframe
  iframes.forEach(iframe => {
    try {
      // Try to get the iframe's origin
      const iframeOrigin = new URL(iframe.src).origin;
      
      // Less restrictive origin matching - allow communication to any iframe 
      // with the source origin or all iframes if origin is "*"
      if (origin === "*" || iframeOrigin === origin) {
        iframe.contentWindow?.postMessage(data, iframeOrigin);
        found = true;
      }
    } catch (error) {
      // Ignore errors when trying to access iframe origins
      console.warn("Could not access iframe origin", error);
    }
  });
  
  // If no matching iframe was found, log a warning
  if (!found) {
    console.warn(`No iframe found with origin ${origin} to send response to`);
  }
}

/**
 * Handle incoming messages
 * @param event The message event
 */
async function handleIncomingMessage(event: MessageEvent): Promise<void> {
  // Origin check removed - allow all origins
  // Log the origin but don't restrict it
  console.log(`Received message from origin: ${event.origin}`);
  
  // Check if data exists and is in the expected format
  if (!event.data || typeof event.data !== 'object') {
    console.log('Ignored message: Invalid data format');
    return;
  }
  
  // Parse the message data
  const message = event.data as STLImportMessage;
  console.log("Received message:", message);
  
  // Handle direct download request (new)
  if (message.type === 'direct_download' && message.url) {
    try {
      // Initiate automatic download
      initiateAutomaticDownload(message.url, message.fileName || 'download.stl');
      
      // Send response back to origin
      if (event.origin) {
        sendResponseToOrigin(event.origin, {
          type: "download-response",
          success: true,
          message: "Download initiated",
          requestId: message.requestId
        });
      }
      return;
    } catch (error) {
      console.error("Error initiating automatic download:", error);
      // Send error response
      if (event.origin) {
        sendResponseToOrigin(event.origin, {
          type: "download-response",
          success: false,
          error: (error as Error).message,
          requestId: message.requestId
        });
      }
      return;
    }
  }
  
  // Check if this is an STL import message with URL
  if ((message.type === 'import-stl' || message.type === 'stl-import') && message.stlUrl) {
    console.log(`Received STL import request from ${event.origin} with URL`, message);
    
    // Log import request
    console.log("Import request (URL):", {
      origin: event.origin,
      url: message.stlUrl,
      metadata: message.metadata
    });
    
    // If autoDownload flag is set, initiate direct download instead of import
    if (message.autoDownload) {
      initiateAutomaticDownload(message.stlUrl, message.fileName || 'model.stl');
      return;
    }
    
    // Load the STL file from URL
    await loadSTLFromUrl(message.stlUrl, message.metadata, event.origin);
  }
  // Check if this is an STL import message with base64 data
  else if ((message.type === 'import-stl' || message.type === 'stl-import') && message.stlBase64) {
    console.log(`Received STL import request from ${event.origin} with base64 data`);
    
    // Log import request (without the full base64 data for brevity)
    console.log("Import request (base64):", {
      origin: event.origin,
      fileName: message.fileName || 'model.stl',
      metadata: message.metadata,
      base64DataLength: message.stlBase64.length
    });
    
    // Load the STL file from base64 data
    await loadSTLFromBase64(message.stlBase64, message.fileName, message.metadata, event.origin);
  }
}

/**
 * Initialize the message listener for STL imports
 */
export function initFishCadMessageListener(): () => void {
  // Add the event listener
  window.addEventListener('message', handleIncomingMessage);
  
  // Log initialization
  console.log(`FISHCAD Integration initialized with allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  
  // Return a cleanup function
  return () => {
    window.removeEventListener('message', handleIncomingMessage);
  };
}

/**
 * Get the import statistics
 * @returns The current import statistics
 */
export function getImportStats(): ImportStats {
  return { ...importStats };
}

/**
 * Help facilitate automatic downloads without prompts
 * @param url URL to download
 * @param fileName Suggested filename
 */
function initiateAutomaticDownload(url: string, fileName: string): void {
  try {
    console.log(`Initiating automatic download for ${fileName} from ${url}`);
    
    // Create a hidden anchor element
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName || 'download';
    
    // Add to DOM, click it, and remove it
    document.body.appendChild(a);
    a.click();
    
    // Small timeout before removal to ensure download begins
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    
    console.log('Automatic download initiated');
  } catch (error) {
    console.error('Failed to initiate automatic download:', error);
  }
}

export default initFishCadMessageListener; 