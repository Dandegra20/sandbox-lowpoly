import * as THREE from 'three';
import type { ModelPart, WeaponDef } from '../../content/weapons';

// Geometrías y materiales compartidos entre todas las copias de un arma
// (vista en 1ª persona y la de cada jugador en 3ª persona).
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<number, THREE.Material>();

function partGeometry(p: ModelPart): THREE.BufferGeometry {
  const key = p.kind === 'box' ? `b${p.size.join(',')}` : `c${p.radius},${p.length}`;
  let g = geoCache.get(key);
  if (!g) {
    g = p.kind === 'box'
      ? new THREE.BoxGeometry(...p.size)
      : new THREE.CylinderGeometry(p.radius, p.radius, p.length, 8).rotateX(Math.PI / 2);
    geoCache.set(key, g);
  }
  return g;
}

function partMaterial(color: number): THREE.Material {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    matCache.set(color, m);
  }
  return m;
}

/** Construye el modelo low-poly de un arma a partir de sus piezas (cañón hacia -Z). */
export function buildWeaponMesh(def: WeaponDef, castShadow = false): THREE.Group {
  const group = new THREE.Group();
  for (const part of def.model) {
    const mesh = new THREE.Mesh(partGeometry(part), partMaterial(part.color));
    mesh.position.set(...part.pos);
    mesh.castShadow = castShadow;
    group.add(mesh);
  }
  return group;
}
