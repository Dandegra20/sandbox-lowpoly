import * as THREE from 'three';
import { getPattern, type Appearance, type CosmeticDef, type CosmeticPart } from '../../content/cosmetics';

// Cachés compartidas por todos los personajes (y por la vista previa del editor):
// geometrías por forma, materiales por color y texturas de patrón por combinación.
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<number, THREE.MeshLambertMaterial>();
const patternCache = new Map<string, THREE.MeshLambertMaterial>();

/** Material liso de un color (compartido). */
export function colorMaterial(color: number): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Material del torso: color del cuerpo con el patrón dibujado en un canvas pequeño. */
export function torsoMaterial(look: Appearance): THREE.MeshLambertMaterial {
  if (look.pattern === 'none') return colorMaterial(look.body);
  const key = `${look.pattern}:${look.body}:${look.accent}`;
  let m = patternCache.get(key);
  if (!m) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = hex(look.body);
    ctx.fillRect(0, 0, size, size);
    getPattern(look.pattern).draw(ctx, size, hex(look.accent));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    // Píxeles nítidos: encaja con el estilo low-poly.
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    m = new THREE.MeshLambertMaterial({ map: tex });
    patternCache.set(key, m);
  }
  return m;
}

function partGeometry(p: CosmeticPart): THREE.BufferGeometry {
  const key = JSON.stringify([p.kind, 'size' in p ? p.size : 0, 'radius' in p ? p.radius : 0, 'height' in p ? p.height : 0,
    'axis' in p ? p.axis : 0, p.segments ?? 0]);
  let g = geoCache.get(key);
  if (!g) {
    switch (p.kind) {
      case 'box': g = new THREE.BoxGeometry(...p.size); break;
      case 'ball': g = new THREE.IcosahedronGeometry(p.radius, 1); break;
      case 'cylinder':
        g = new THREE.CylinderGeometry(p.radius, p.radius, p.height, p.segments ?? 10);
        if (p.axis === 'x') g.rotateZ(Math.PI / 2);
        else if (p.axis === 'z') g.rotateX(Math.PI / 2);
        break;
      case 'cone': g = new THREE.ConeGeometry(p.radius, p.height, p.segments ?? 8); break;
    }
    g = g.toNonIndexed();
    g.computeVertexNormals(); // normales por cara: aspecto low-poly
    geoCache.set(key, g);
  }
  return g;
}

/** Modelo de un accesorio (sombrero, gafas, mochila) con los colores del jugador. */
export function buildCosmetic(def: CosmeticDef, look: Appearance): THREE.Group {
  const group = new THREE.Group();
  for (const p of def.parts) {
    const color = p.color === 'accent' ? look.accent : p.color === 'body' ? look.body : p.color;
    const mesh = new THREE.Mesh(partGeometry(p), colorMaterial(color));
    if (p.pos) mesh.position.set(...p.pos);
    if (p.rot) mesh.rotation.set(...p.rot);
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}
