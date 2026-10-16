import * as THREE from 'three';
import type { ConstraintInfo, ThrusterInfo } from '../../shared/protocol';
import type { PropRenderer } from '../entities/PropRenderer';
import type { Effects } from '../weapons/Effects';

const MAX_ROPES = 128;
const MAX_THRUSTERS = 96;
const FLAME_INTERVAL = 0.03;

/**
 * Lo que dejan las herramientas en el mundo: cuerdas (una sola LineSegments para todas) y
 * propulsores (un InstancedMesh con su llama cuando están encendidos). Las soldaduras no se
 * dibujan. Las posiciones se calculan cada frame a partir de la pose dibujada de los objetos.
 */
export class ToolVisuals {
  private ropes = new Map<number, ConstraintInfo>();
  private thrusters = new Map<number, ThrusterInfo>();
  private ropeLines: THREE.LineSegments;
  private ropePositions = new Float32Array(MAX_ROPES * 6);
  private thrusterMesh: THREE.InstancedMesh;
  private flameTimer = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private one = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private scene: THREE.Scene, private props: PropRenderer, private effects: Effects) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.ropePositions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.ropeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x8d6e4a }));
    this.ropeLines.frustumCulled = false;

    // Tobera: el eje +Y apunta hacia fuera de la superficie (por donde sale la llama).
    const nozzle = new THREE.CylinderGeometry(0.1, 0.16, 0.28, 8).translate(0, 0.14, 0).toNonIndexed();
    nozzle.computeVertexNormals();
    this.thrusterMesh = new THREE.InstancedMesh(nozzle, new THREE.MeshLambertMaterial({ color: 0x636e72 }), MAX_THRUSTERS);
    this.thrusterMesh.count = 0;
    this.thrusterMesh.frustumCulled = false;
    this.thrusterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.ropeLines, this.thrusterMesh);
  }

  addConstraint(c: ConstraintInfo): void {
    if (c.kind === 'rope') this.ropes.set(c.id, c);
  }

  removeConstraint(id: number): void {
    this.ropes.delete(id);
  }

  addThruster(t: ThrusterInfo): void {
    this.thrusters.set(t.id, { ...t });
  }

  removeThruster(id: number): void {
    this.thrusters.delete(id);
  }

  setThrusterActive(id: number, active: boolean): void {
    const t = this.thrusters.get(id);
    if (t) t.active = active;
  }

  /** Punto local de un objeto en el mundo (con su escala); false si el objeto no está. */
  private toWorld(propId: number, local: readonly number[], out: THREE.Vector3): boolean {
    const pose = this.props.renderedPose(propId);
    if (!pose) return false;
    out.set(local[0], local[1], local[2]).multiplyScalar(pose.scale).applyQuaternion(pose.rot).add(pose.pos);
    return true;
  }

  update(dt: number): void {
    // Cuerdas.
    let n = 0;
    for (const r of this.ropes.values()) {
      if (n >= MAX_ROPES) break;
      if (!this.toWorld(r.a, r.la, this.a)) continue;
      if (r.b) {
        if (!this.toWorld(r.b, r.lb, this.b)) continue;
      } else {
        this.b.set(...r.lb);
      }
      this.a.toArray(this.ropePositions, n * 6);
      this.b.toArray(this.ropePositions, n * 6 + 3);
      n++;
    }
    this.ropeLines.geometry.setDrawRange(0, n * 2);
    this.ropeLines.geometry.attributes.position.needsUpdate = true;

    // Propulsores (y sus llamas).
    this.flameTimer -= dt;
    const flame = this.flameTimer <= 0;
    if (flame) this.flameTimer = FLAME_INTERVAL;
    let i = 0;
    for (const t of this.thrusters.values()) {
      if (i >= MAX_THRUSTERS) break;
      const pose = this.props.renderedPose(t.prop);
      if (!pose || !this.toWorld(t.prop, t.pos, this.a)) continue;
      // La tobera mira hacia fuera: al contrario de la dirección de empuje.
      this.dir.set(-t.dir[0], -t.dir[1], -t.dir[2]).applyQuaternion(pose.rot);
      this.q.setFromUnitVectors(this.up, this.dir);
      this.thrusterMesh.setMatrixAt(i++, this.m.compose(this.a, this.q, this.one));
      if (t.active && flame) this.effects.thrusterFlame(this.b.copy(this.a).addScaledVector(this.dir, 0.3), this.dir);
    }
    this.thrusterMesh.count = i;
    this.thrusterMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.ropeLines, this.thrusterMesh);
    this.ropeLines.geometry.dispose();
    (this.ropeLines.material as THREE.Material).dispose();
    this.thrusterMesh.geometry.dispose();
    (this.thrusterMesh.material as THREE.Material).dispose();
    this.thrusterMesh.dispose();
  }
}
