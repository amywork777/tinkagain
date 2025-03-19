import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function performBoolean(
  meshA: THREE.Mesh,
  meshB: THREE.Mesh,
  operation: 'union' | 'subtract' | 'intersect'
): THREE.Mesh {
  try {
    // Always try direct merge for union operation - more reliable for complex geometry
    if (operation === 'union') {
      return performDirectMerge(meshA, meshB);
    }
    
    // For subtract and intersect operations, use the CSG approach
    const bspA = CSG.fromMesh(meshA);
    const bspB = CSG.fromMesh(meshB);
    
    let result;
    switch (operation) {
      case 'union':
        result = bspA.union(bspB);
        break;
      case 'subtract':
        result = bspA.subtract(bspB);
        break;
      case 'intersect':
        result = bspA.intersect(bspB);
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    const resultMesh = CSG.toMesh(result, meshA.matrix);
    
    // Post-process the mesh to ensure clean geometry
    cleanupMesh(resultMesh, operation);
    
    return resultMesh;
  } catch (error) {
    console.error(`CSG operation '${operation}' failed:`, error);
    
    // If CSG failed but operation was union, try direct merge as fallback
    if (operation === 'union') {
      try {
        console.warn("CSG union failed, trying direct merge as fallback");
        return performDirectMerge(meshA, meshB);
      } catch (mergeError) {
        console.error("Both CSG and direct merge failed:", mergeError);
      }
    }
    
    throw new Error(`The ${operation} operation failed. The models may have complex geometry or non-manifold surfaces.`);
  }
}

// Helper function for direct merge (more reliable for union operations)
function performDirectMerge(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.Mesh {
  // Clone the geometries and apply transformations
  const geomA = meshA.geometry.clone();
  const geomB = meshB.geometry.clone();
  
  // Apply world matrices
  meshA.updateWorldMatrix(true, false);
  meshB.updateWorldMatrix(true, false);
  geomA.applyMatrix4(meshA.matrixWorld);
  geomB.applyMatrix4(meshB.matrixWorld);
  
  // Merge using BufferGeometryUtils
  const mergedGeometry = BufferGeometryUtils.mergeGeometries([geomA, geomB]);
  
  // Create mesh with proper material
  const material = new THREE.MeshStandardMaterial({
    color: meshA.material instanceof THREE.Material ? 
          (meshA.material as THREE.MeshStandardMaterial).color.clone() : 
          (meshA.material[0] as THREE.MeshStandardMaterial).color.clone(),
    side: THREE.DoubleSide
  });
  
  const resultMesh = new THREE.Mesh(mergedGeometry, material);
  
  // Clean up the resulting mesh
  cleanupMesh(resultMesh, 'union');
  
  return resultMesh;
}

// Helper to clean up mesh after CSG operations
function cleanupMesh(mesh: THREE.Mesh, operation: 'union' | 'subtract' | 'intersect'): void {
  if (!mesh.geometry) return;
  
  // Use appropriate tolerance - unions need smaller values to avoid losing detail
  const tolerance = operation === 'union' ? 0.0001 : 0.001;
  
  try {
    // Merge vertices to remove duplicates and fix non-manifold edges
    if (typeof BufferGeometryUtils.mergeVertices === 'function') {
      mesh.geometry = BufferGeometryUtils.mergeVertices(mesh.geometry, tolerance);
    }
    
    // Recompute normals for proper lighting
    mesh.geometry.computeVertexNormals();
    
    // Update bounding information
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  } catch (error) {
    console.warn("Error during mesh cleanup:", error);
    // Still try to compute normals even if other cleanup steps fail
    mesh.geometry.computeVertexNormals();
  }
}
