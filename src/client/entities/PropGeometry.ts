import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PropDef, PropPart, VehicleSpec } from '../../content/props';

const cache = new Map<string, THREE.BufferGeometry>();
const tmpColor = new THREE.Color();

/** Geometría de una pieza, centrada en su posición, con color por vértice y normales planas. */
function partGeometry(p: PropPart, color: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  switch (p.kind) {
    case 'box':
      g = new THREE.BoxGeometry(...p.size);
      break;
    case 'ball':
      g = new THREE.IcosahedronGeometry(p.radius, p.radius > 1 ? 2 : 1);
      break;
    case 'cylinder':
      g = new THREE.CylinderGeometry(p.radius, p.radius, p.height, p.segments ?? 10);
      if (p.axis === 'x') g.rotateZ(Math.PI / 2);
      else if (p.axis === 'z') g.rotateX(Math.PI / 2);
      break;
    case 'cone':
      g = new THREE.ConeGeometry(p.radius, p.height, p.segments ?? 8);
      break;
  }
  // No indexada + normales recalculadas = una normal por cara (aspecto low-poly sin flatShading).
  g = g.toNonIndexed();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  if (p.pos) g.translate(...p.pos);
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  tmpColor.setHex(p.color ?? color);
  for (let i = 0; i < n; i++) tmpColor.toArray(colors, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** Modelo completo de un objeto: todas sus piezas fusionadas en una sola geometría (1 draw call). */
export function propGeometry(def: PropDef): THREE.BufferGeometry {
  let g = cache.get(def.id);
  if (!g) {
    g = mergeGeometries(def.parts.map((p) => partGeometry(p, def.color)))!;
    g.computeBoundingSphere();
    cache.set(def.id, g);
  }
  return g;
}

/** Geometría de una rueda de vehículo (eje X), con tapacubos. */
export function wheelGeometry(spec: VehicleSpec, radius: number): THREE.BufferGeometry {
  const key = `wheel:${radius}:${spec.wheelWidth}:${spec.wheelColor}`;
  let g = cache.get(key);
  if (!g) {
    g = mergeGeometries([
      partGeometry({ kind: 'cylinder', radius, height: spec.wheelWidth, axis: 'x', segments: 10 }, spec.wheelColor),
      partGeometry({ kind: 'cylinder', radius: radius * 0.5, height: spec.wheelWidth + 0.02, axis: 'x', segments: 6 }, 0xbdc3c7),
    ])!;
    cache.set(key, g);
  }
  return g;
}

/**
 * Material común a todos los objetos: colores por vértice + tinte por instancia.
 * El tinte no se multiplica tal cual (madera × azul saldría casi negro): un objeto pintado toma
 * el color de la pintura modulado por la luminosidad de su color original, así conserva los
 * detalles (aristas oscuras, franjas). Con tinte blanco se ven los colores originales, y una
 * pieza blanca tintada (ragdolls) queda exactamente del color del tinte.
 */
export const propMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
propMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `
    vColor = vec4( 1.0 );
    vColor.rgb *= color;
    #ifdef USE_INSTANCING_COLOR
      if ( instanceColor.r + instanceColor.g + instanceColor.b < 2.999 ) {
        float luma = dot( vColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
        vColor.rgb = instanceColor.rgb * min( 1.0, 0.45 + 0.9 * luma );
      }
    #endif
  `);
};
propMaterial.customProgramCacheKey = () => 'prop-paint';

/** Bajada aproximada de la rueda respecto a su anclaje con el vehículo en reposo. */
export const WHEEL_DROP = 0.55;
