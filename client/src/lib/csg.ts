import * as THREE from 'three';
import { CSG } from 'three-csg-ts';
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

export function performBoolean(
  meshA: THREE.Mesh,
  meshB: THREE.Mesh,
  operation: 'union' | 'subtract' | 'intersect'
): THREE.Mesh {
  // For union operations, use completely non-destructive approaches
  if (operation === 'union') {
    try {
      console.log("UNION: Using non-destructive geometry combination");
      
      // Try the simplest approach first - just group the meshes
      // This is guaranteed to work and never break surfaces
      return superSimpleUnion(meshA, meshB);
      
    } catch (error) {
      console.error("Even the simplest union approach failed:", error);
      
      // This should never happen, but just in case:
      // Create an empty mesh with the same material
      const fallbackMesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        meshA.material instanceof THREE.Material ? 
          meshA.material.clone() : 
          new THREE.MeshStandardMaterial({ color: 0x3080FF })
      );
      
      return fallbackMesh;
    }
  }
  
  // For subtract and intersect operations, try to use CSG
  try {
    console.log(`Attempting ${operation} operation using CSG`);
    
    // Prepare meshes for CSG operation
    const bspA = CSG.fromMesh(meshA);
    const bspB = CSG.fromMesh(meshB);
    
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
    
    // Just compute normals - don't do anything else that might break the mesh
    resultMesh.geometry.computeVertexNormals();
    
    console.log(`${operation} operation completed successfully`);
    return resultMesh;
  } catch (error) {
    console.error(`${operation} operation failed:`, error);
    
    // For all operations, return meshA as fallback
    console.warn(`${operation} operation failed - using first mesh as fallback`);
    return meshA.clone();
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

// Absolute simplest approach to combine two meshes - just keeps the original meshes
function superSimpleUnion(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.Mesh {
  console.log("Using superSimpleUnion - completely non-destructive approach");
  
  // Clone both meshes to avoid modifying originals
  const meshAClone = meshA.clone();
  const meshBClone = meshB.clone();
  
  // Use a mesh to act as a group container
  const parentMesh = new THREE.Mesh();
  
  // Get material from first mesh
  let material;
  if (meshA.material instanceof THREE.Material) {
    material = meshA.material.clone();
  } else if (Array.isArray(meshA.material) && meshA.material.length > 0) {
    material = meshA.material[0].clone();
  } else {
    material = new THREE.MeshStandardMaterial({
      color: 0x3080FF,
      side: THREE.DoubleSide
    });
  }
  
  // Set the parent mesh to use the same material
  parentMesh.material = material;
  
  // Create empty geometry for the parent
  parentMesh.geometry = new THREE.BufferGeometry();
  
  // Add cloned meshes as children
  parentMesh.add(meshAClone);
  parentMesh.add(meshBClone);
  
  // Reset positions of mesh clones since they'll inherit from parent
  meshAClone.position.copy(meshA.position);
  meshBClone.position.copy(meshB.position);
  
  // Set matrix world to ensure correct positioning
  meshAClone.updateMatrix();
  meshBClone.updateMatrix();
  
  console.log("Super simple mesh union completed");
  return parentMesh;
}

// Original direct merge function - kept as a fallback
function performDirectMerge(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.Mesh {
  console.log("Performing advanced direct merge of two meshes");
  
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

// Alternative implementation that uses BufferGeometryUtils.mergeGeometries
function simpleMergeUnion(meshA: THREE.Mesh, meshB: THREE.Mesh): THREE.Mesh {
  console.log("Using simpleMergeUnion as fallback");
  
  try {
    // Clone geometries
    const geomA = meshA.geometry.clone();
    const geomB = meshB.geometry.clone();
    
    // Apply transformations
    meshA.updateWorldMatrix(true, false);
    meshB.updateWorldMatrix(true, false);
    geomA.applyMatrix4(meshA.matrixWorld);
    geomB.applyMatrix4(meshB.matrixWorld);
    
    // Simply merge - don't do any boolean operations
    const mergedGeom = BufferGeometryUtils.mergeGeometries([geomA, geomB], false);
    
    // Get material from first mesh
    let material;
    if (meshA.material instanceof THREE.Material) {
      material = meshA.material.clone();
    } else if (Array.isArray(meshA.material) && meshA.material.length > 0) {
      material = meshA.material[0].clone();
    } else {
      material = new THREE.MeshStandardMaterial({
        color: 0x3080FF,
        side: THREE.DoubleSide
      });
    }
    
    // Create result mesh
    const resultMesh = new THREE.Mesh(mergedGeom, material);
    
    // Just compute normals
    resultMesh.geometry.computeVertexNormals();
    
    return resultMesh;
  } catch (error) {
    console.error("Simple merge failed:", error);
    
    // If even simple merge fails, just group them
    return superSimpleUnion(meshA, meshB);
  }
}

// Helper to clean up mesh after CSG operations
function cleanupMesh(mesh: THREE.Mesh, operation: 'union' | 'subtract' | 'intersect'): void {
  if (!mesh.geometry) return;
  
  try {
    // Just compute normals - don't do any other processing that might break things
    mesh.geometry.computeVertexNormals();
    
    // Update bounding information
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  } catch (error) {
    console.warn("Error during mesh cleanup:", error);
  }
}
