import * as THREE from 'three';
import { getProp, type PropDef } from '../../content/props';
import type { PropInfo } from '../../shared/protocol';
import { SampleBuffer } from '../net/SampleBuffer';
import { propGeometry, propMaterial } from './PropGeometry';
import { VehicleView } from './VehicleView';

/** Un InstancedMesh por tipo de objeto: un draw call por tipo, sin importar cuántos haya. */
interface Batch {
  def: PropDef;
  mesh: THREE.InstancedMesh;
  /** índice de instancia -> id de prop */
  ids: number[];
}

interface ClientProp {
  id: number;
  owner: number;
  batch: Batch;
  index: number;
  buffer: SampleBuffer;
  tint: THREE.Color;
  scale: number;
  frozen: boolean;
  vehicle?: VehicleView;
  /** Pose dibujada en el último update. */
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
}

const INITIAL_CAPACITY = 16;

export class PropRenderer {
  private batches = new Map<string, Batch>();
  private props = new Map<number, ClientProp>();
  private pos = new THREE.Vector3();
  private rot = new THREE.Quaternion();
  private scaleV = new THREE.Vector3(1, 1, 1);
  private mat = new THREE.Matrix4();
  private vel = new THREE.Vector3();
  private color = new THREE.Color();
  private castShadows = true;
  /** Objeto sujeto por el jugador local: se dibuja donde lo predice el cliente (sin retardo). */
  private override = { id: 0, pos: new THREE.Vector3(), weight: 0, lastId: 0 };

  constructor(private scene: THREE.Scene) {}

  add(info: PropInfo, t: number): void {
    if (this.props.has(info.id)) return;
    const batch = this.batchFor(info.type);
    if (batch.ids.length >= batch.mesh.instanceMatrix.count) this.grow(batch);
    const prop: ClientProp = {
      id: info.id, owner: info.owner, batch, index: batch.ids.length, buffer: new SampleBuffer(),
      tint: new THREE.Color(info.tint ?? 0xffffff), scale: info.scale ?? 1, frozen: !!info.frozen,
      pos: new THREE.Vector3(...info.pos), rot: new THREE.Quaternion(...info.rot),
    };
    batch.ids.push(info.id);
    batch.mesh.count = batch.ids.length;
    batch.mesh.setColorAt(prop.index, prop.tint);
    batch.mesh.instanceColor!.needsUpdate = true;
    prop.buffer.push(t, prop.pos, prop.rot);
    if (batch.def.vehicle) {
      prop.vehicle = new VehicleView(batch.def.vehicle);
      this.scene.add(prop.vehicle.root);
    }
    this.props.set(info.id, prop);
  }

  remove(id: number): void {
    const prop = this.props.get(id);
    if (!prop) return;
    const { batch, index } = prop;
    // Quitar intercambiando con la última instancia (O(1)).
    const lastIndex = batch.ids.length - 1;
    const lastId = batch.ids[lastIndex];
    if (index !== lastIndex) {
      batch.mesh.getMatrixAt(lastIndex, this.mat);
      batch.mesh.setMatrixAt(index, this.mat);
      batch.mesh.getColorAt(lastIndex, this.color);
      batch.mesh.setColorAt(index, this.color);
      batch.ids[index] = lastId;
      this.props.get(lastId)!.index = index;
    }
    batch.ids.pop();
    batch.mesh.count = batch.ids.length;
    batch.mesh.instanceMatrix.needsUpdate = true;
    batch.mesh.instanceColor!.needsUpdate = true;
    if (prop.vehicle) this.scene.remove(prop.vehicle.root);
    this.props.delete(id);
  }

  pushSample(id: number, t: number, pos: THREE.Vector3, rot: THREE.Quaternion): void {
    this.props.get(id)?.buffer.push(t, pos, rot);
  }

  /** Fija (o quita con id = 0) la posición predicha del objeto sujeto por el jugador local. */
  setOverride(id: number, pos?: THREE.Vector3): void {
    const o = this.override;
    if (id) {
      o.id = o.lastId = id;
      o.pos.copy(pos!);
    } else {
      o.id = 0;
    }
  }

  update(renderTime: number, dt = 0): void {
    // Al soltar, se vuelve a la pose del servidor de forma gradual (sin saltos).
    const o = this.override;
    o.weight = o.id ? Math.min(1, o.weight + dt * 10) : Math.max(0, o.weight - dt * 4);
    for (const prop of this.props.values()) {
      // sample() devuelve el valor auxiliar (0 en objetos) o null si no hay datos: comparar con null.
      if (prop.buffer.sample(renderTime, this.pos, this.rot) === null) continue;
      if (o.weight > 0 && prop.id === o.lastId) this.pos.lerp(o.pos, o.weight);
      prop.pos.copy(this.pos);
      prop.rot.copy(this.rot);
      prop.batch.mesh.setMatrixAt(prop.index, this.mat.compose(this.pos, this.rot, this.scaleV.setScalar(prop.scale)));
      prop.vehicle?.update(this.pos, this.rot, dt);
    }
    for (const b of this.batches.values()) {
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.computeBoundingSphere();
    }
  }

  renderedPosition(id: number): THREE.Vector3 | undefined {
    return this.props.get(id)?.pos;
  }

  /** Pose dibujada (posición, rotación y escala) de un objeto. */
  renderedPose(id: number): { pos: THREE.Vector3; rot: THREE.Quaternion; scale: number } | undefined {
    return this.props.get(id);
  }

  /** Cambios de la tool gun: pintura, escala y congelado. */
  applyUpdate(id: number, u: { tint?: number; scale?: number; frozen?: boolean }): void {
    const prop = this.props.get(id);
    if (!prop) return;
    if (u.tint !== undefined) {
      prop.tint.setHex(u.tint);
      prop.batch.mesh.setColorAt(prop.index, prop.tint);
      prop.batch.mesh.instanceColor!.needsUpdate = true;
    }
    if (u.scale !== undefined) prop.scale = u.scale;
    if (u.frozen !== undefined) prop.frozen = u.frozen;
  }

  isFrozen(id: number): boolean {
    return !!this.props.get(id)?.frozen;
  }

  defOf(id: number): PropDef | undefined {
    return this.props.get(id)?.batch.def;
  }

  /** Cuántos objetos ha creado un jugador. */
  countByOwner(owner: number): number {
    let n = 0;
    for (const p of this.props.values()) if (p.owner === owner) n++;
    return n;
  }

  /** Vehículos con su pose dibujada (para la pista "E para subir"). */
  forEachVehicle(fn: (id: number, def: PropDef, pos: THREE.Vector3) => void): void {
    for (const p of this.props.values()) if (p.vehicle) fn(p.id, p.batch.def, p.pos);
  }

  /** Recorre la pose más reciente de cada prop (para la predicción del jugador local). */
  forEachLatest(fn: (def: PropDef, pos: THREE.Vector3, rot: THREE.Quaternion, id: number, vel: THREE.Vector3, scale: number) => void): void {
    for (const prop of this.props.values()) {
      const s = prop.buffer.latest;
      if (s) fn(prop.batch.def, s.pos, s.rot, prop.id, prop.buffer.velocity(this.vel), prop.scale);
    }
  }

  /** Mallas instanciadas actuales (para el rayo de la cámara y de los disparos). */
  get meshes(): THREE.Object3D[] {
    return [...this.batches.values()].map((b) => b.mesh);
  }

  private batchFor(type: string): Batch {
    let batch = this.batches.get(type);
    if (!batch) {
      const def = getProp(type);
      const mesh = this.createMesh(def, INITIAL_CAPACITY);
      batch = { def, mesh, ids: [] };
      this.batches.set(type, batch);
      this.scene.add(mesh);
    }
    return batch;
  }

  /** Calidad baja/media: los objetos no proyectan sombra (una pasada menos por tipo). */
  setShadows(cast: boolean): void {
    this.castShadows = cast;
    for (const b of this.batches.values()) b.mesh.castShadow = cast;
    for (const p of this.props.values()) p.vehicle?.root.traverse((o) => (o.castShadow = cast));
  }

  private createMesh(def: PropDef, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(propGeometry(def), propMaterial, capacity);
    mesh.count = 0;
    mesh.castShadow = this.castShadows;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, this.color.set(0xffffff)); // crea el atributo de tinte por instancia
    return mesh;
  }

  private grow(batch: Batch): void {
    const old = batch.mesh;
    const mesh = this.createMesh(batch.def, old.instanceMatrix.count * 2);
    for (let i = 0; i < batch.ids.length; i++) {
      old.getMatrixAt(i, this.mat);
      mesh.setMatrixAt(i, this.mat);
      old.getColorAt(i, this.color);
      mesh.setColorAt(i, this.color);
    }
    mesh.count = batch.ids.length;
    this.scene.remove(old);
    old.dispose();
    this.scene.add(mesh);
    batch.mesh = mesh;
  }

  dispose(): void {
    // Geometrías y material son compartidos (caché de PropGeometry): no se liberan aquí.
    for (const b of this.batches.values()) {
      this.scene.remove(b.mesh);
      b.mesh.dispose();
    }
    for (const p of this.props.values()) if (p.vehicle) this.scene.remove(p.vehicle.root);
    this.batches.clear();
    this.props.clear();
  }
}
