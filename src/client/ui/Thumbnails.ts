import * as THREE from 'three';
import { getProp, type PropDef } from '../../content/props';
import type { SpawnableDef } from '../../content/spawnables';
import { WHEEL_DROP, propGeometry, wheelGeometry } from '../entities/PropGeometry';

const SIZE = 112;

/** Modelo de un spawnable (objeto suelto o grupo), con ruedas si es un vehículo. */
function buildModel(s: SpawnableDef, materials: THREE.Material[]): THREE.Group {
  const group = new THREE.Group();
  const parts = s.group ? s.group.parts : [{ type: s.prop!, pos: [0, 0, 0] as [number, number, number], tint: 0xffffff }];
  for (const part of parts) {
    const def: PropDef = getProp(part.type);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, color: part.tint ?? 0xffffff });
    materials.push(mat);
    const mesh = new THREE.Mesh(propGeometry(def), mat);
    mesh.position.set(...part.pos);
    group.add(mesh);
    for (const w of def.vehicle?.wheels ?? []) {
      const wheel = new THREE.Mesh(wheelGeometry(def.vehicle!, w.radius), mat);
      wheel.position.set(w.pos[0], w.pos[1] - def.vehicle!.suspensionRest * WHEEL_DROP, w.pos[2]);
      group.add(wheel);
    }
  }
  // Los ragdolls, tumbados: se ven mejor en la miniatura.
  if (s.group) group.rotation.z = 0.25;
  return group;
}

/**
 * Genera una miniatura (data URL) por spawnable renderizando su modelo una vez con un
 * renderer temporal. Se hace la primera vez que se abre el menú y luego se libera.
 */
export function renderThumbnails(list: SpawnableDef[]): Map<string, string> {
  const out = new Map<string, string>();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out; // sin WebGL extra: el menú mostrará solo nombres
  }
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-2, 4, -3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  for (const s of list) {
    const materials: THREE.Material[] = [];
    const model = buildModel(s, materials);
    scene.add(model);
    box.setFromObject(model).getCenter(center);
    box.getSize(size);
    const r = Math.max(size.length() / 2, 0.3);
    // Vista desde delante (los modelos miran a -Z), un poco en diagonal y desde arriba.
    const dist = r / Math.sin(THREE.MathUtils.degToRad(15)) * 0.95;
    camera.position.copy(center).add(new THREE.Vector3(0.75, 0.6, -1).normalize().multiplyScalar(dist));
    camera.lookAt(center);
    renderer.render(scene, camera);
    out.set(s.id, renderer.domElement.toDataURL());
    scene.remove(model);
    materials.forEach((m) => m.dispose());
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
