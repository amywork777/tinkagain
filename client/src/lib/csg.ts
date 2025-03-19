import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function performBoolean(
  meshA: THREE.Mesh,
  meshB: THREE.Mesh,
  operation: 'union' | 'subtract' | 'intersect'
): THREE.Mesh {
  try {
    console.log(`Attempting ${operation} operation between two meshes`);
    
    // For union operations, always use direct merge instead of CSG
    if (operation === 'union') {
      console.log("Using direct mesh merge for union operation");
      return performDirectMerge(meshA, meshB);
    }
    
    // For subtract and intersect operations, use the CSG approach with extra precautions
    console.log("Using CSG library for boolean operation");
    
    // Prepare meshes for CSG
    const preparedMeshA = prepareForBoolean(meshA); 
    const preparedMeshB = prepareForBoolean(meshB);
    
    // Start CSG operation
    const bspA = CSG.fromMesh(preparedMeshA);
    const bspB = CSG.fromMesh(preparedMeshB);
    
    let result;
    switch (operation) {
      case 'subtract':
        result = bspA.subtract(bspB);
        break;
      case 'intersect':
        result = bspA.intersect(bspB);
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    // Convert back to mesh
    const resultMesh = CSG.toMesh(result, meshA.matrix);
    
    // Ensure material is properly set
    if (meshA.material instanceof THREE.Material) {
      resultMesh.material = meshA.material.clone();
    } else if (Array.isArray(meshA.material) && meshA.material.length > 0) {
      resultMesh.material = meshA.material[0].clone();
    }
    
    // Post-process the mesh to ensure clean geometry
    cleanupMesh(resultMesh, operation);
    
    console.log(`${operation} operation completed successfully`);
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
    } else {
      // For subtract/intersect, try with simplified geometries as fallback
      try {
        console.warn(`${operation} failed, trying fallback with simplified geometries`);
        const simplifiedMeshA = simplifyMesh(meshA.clone(), 0.05);
        const simplifiedMeshB = simplifyMesh(meshB.clone(), 0.05);
        
        // Try the operation again with simplified meshes
        return performBoolean(simplifiedMeshA, simplifiedMeshB, operation);
      } catch (simplifyError) {
        console.error("Simplified operation also failed:", simplifyError);
      }
    }
    
    throw new Error(`The ${operation} operation failed. The models may have complex geometry or non-manifold surfaces.`);
  }
}

// Helper to prepare a mesh for boolean operations
function prepareForBoolean(mesh: THREE.Mesh): THREE.Mesh {
  // Clone the mesh to avoid modifying the original
  const clonedMesh = mesh.clone();
  
  // Ensure geometry has correct winding order and is clean
  const geometry = clonedMesh.geometry.clone();
  
  // Apply any world transformations to geometry vertices
  geometry.applyMatrix4(mesh.matrixWorld);
  
  // Make sure the geometry has vertex normals
  geometry.computeVertexNormals();
  
  // Create a new mesh with the processed geometry
  const preparedMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      color: mesh.material instanceof THREE.Material ? 
             (mesh.material as THREE.MeshStandardMaterial).color : 
             (mesh.material[0] as THREE.MeshStandardMaterial).color
    })
  );
  
  // Reset the transformations since they're now baked into the geometry
  preparedMesh.position.set(0, 0, 0);
  preparedMesh.rotation.set(0, 0, 0);
  preparedMesh.scale.set(1, 1, 1);
  
  return preparedMesh;
}

// Helper to simplify a mesh for fallback operations
function simplifyMesh(mesh: THREE.Mesh, simplificationRatio: number): THREE.Mesh {
  console.log(`Simplifying mesh to ${simplificationRatio * 100}% of original complexity`);
  
  // For now, just use a simpler approach by merging vertices
  if (mesh.geometry && typeof BufferGeometryUtils.mergeVertices === 'function') {
    mesh.geometry = BufferGeometryUtils.mergeVertices(mesh.geometry, 0.05);
    mesh.geometry.computeVertexNormals();
  }
  
  return mesh;
}

// Helper function for direct merge (more reliable for union operations)
function performDirectMerge(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.Mesh {
  console.log("Performing direct merge of two meshes");
  
  // Clone the geometries and apply transformations
  const geomA = meshA.geometry.clone();
  const geomB = meshB.geometry.clone();
  
  // Apply world matrices to ensure correct positioning
  meshA.updateWorldMatrix(true, false);
  meshB.updateWorldMatrix(true, false);
  geomA.applyMatrix4(meshA.matrixWorld);
  geomB.applyMatrix4(meshB.matrixWorld);
  
  // Ensure both geometries have vertex normals
  geomA.computeVertexNormals();
  geomB.computeVertexNormals();
  
  // Ensure both geometries have the same attributes for proper merging
  const attributesA = Object.keys(geomA.attributes);
  const attributesB = Object.keys(geomB.attributes);
  
  // Make sure both geometries have all attributes needed
  for (const attr of attributesA) {
    if (!attributesB.includes(attr)) {
      console.log(`Adding missing attribute ${attr} to geometry B`);
      // Handle missing attributes on second geometry
      if (attr === 'normal') {
        geomB.computeVertexNormals();
      }
    }
  }
  
  for (const attr of attributesB) {
    if (!attributesA.includes(attr)) {
      console.log(`Adding missing attribute ${attr} to geometry A`);
      // Handle missing attributes on first geometry
      if (attr === 'normal') {
        geomA.computeVertexNormals();
      }
    }
  }
  
  // Merge using BufferGeometryUtils
  console.log("Merging geometries");
  const mergedGeometry = BufferGeometryUtils.mergeGeometries([geomA, geomB]);
  
  // Create material from the primary mesh
  const materialColor = meshA.material instanceof THREE.Material ? 
                        (meshA.material as THREE.MeshStandardMaterial).color.clone() : 
                        (meshA.material[0] as THREE.MeshStandardMaterial).color.clone();
                        
  const material = new THREE.MeshStandardMaterial({
    color: materialColor,
    side: THREE.DoubleSide,
    flatShading: false // Smooth shading for better appearance
  });
  
  // Create the result mesh
  const resultMesh = new THREE.Mesh(mergedGeometry, material);
  
  // Further optimize the mesh to fix any issues
  const optimizedGeom = optimizeGeometry(resultMesh.geometry);
  resultMesh.geometry = optimizedGeom;
  
  // Clean up the resulting mesh
  cleanupMesh(resultMesh, 'union');
  
  console.log("Direct merge successful");
  return resultMesh;
}

// Helper function to optimize geometry
function optimizeGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  // Make a clone to avoid modifying the original
  const optimized = geometry.clone();
  
  // Merge vertices to remove duplicates (important for cleaner normals)
  if (typeof BufferGeometryUtils.mergeVertices === 'function') {
    // Use a very small tolerance for high precision
    const mergedGeom = BufferGeometryUtils.mergeVertices(optimized, 0.0001);
    
    // Compute proper normals
    mergedGeom.computeVertexNormals();
    
    return mergedGeom;
  }
  
  return optimized;
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
