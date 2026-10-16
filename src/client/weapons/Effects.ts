import * as THREE from 'three';

const MAX_PARTICLES = 800;
const TRACER_POOL = 32;
const FLASH_POOL = 12;
const FIREBALL_POOL = 6;

interface Particle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  /** Crece en vez de encogerse (humo). */
  grow: boolean;
}

interface Timed<T extends THREE.Object3D> {
  obj: T;
  life: number;
  maxLife: number;
}

interface Rocket {
  mesh: THREE.Group;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  /** Instante (ms de servidor) en que se disparó. */
  spawnMs: number;
  /** Los cohetes propios se dibujan en "tiempo actual"; los ajenos, en tiempo interpolado. */
  own: boolean;
  smokeTimer: number;
}

export type ImpactKind = 'world' | 'prop' | 'player';

const IMPACT_COLORS: Record<ImpactKind, number[]> = {
  world: [0x8d7b68, 0x6d5d4b, 0xa89880],
  prop: [0xffd166, 0xffe9a8, 0xd9a441],
  player: [0xd63031, 0xff7675, 0xb71c1c],
};

/**
 * Efectos visuales baratos: todas las partículas van en un único InstancedMesh (un draw call)
 * y el resto (trazadoras, fogonazos, bolas de fuego) se reutiliza desde pools.
 */
export class Effects {
  /** Intensidad de temblor de cámara acumulada (la consume Game). */
  shake = 0;
  /** Fracción de partículas que se generan (calidad gráfica). */
  density = 1;

  private group = new THREE.Group();
  private particles: Particle[] = [];
  private particleMesh: THREE.InstancedMesh;
  private tracers: Timed<THREE.Mesh>[] = [];
  private flashes: Timed<THREE.Mesh>[] = [];
  private fireballs: Timed<THREE.Mesh>[] = [];
  private rockets = new Map<number, Rocket>();
  private beams = new Map<number, THREE.Mesh>();
  private beamsSeen = new Set<number>();
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpS = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private tmpC = new THREE.Color();
  private time = 0;

  constructor(private scene: THREE.Scene) {
    this.particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_PARTICLES,
    );
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.setColorAt(0, new THREE.Color());
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.group.add(this.particleMesh);

    const tracerGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    for (let i = 0; i < TRACER_POOL; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.visible = false;
      this.tracers.push({ obj: m, life: 0, maxLife: 1 });
      this.group.add(m);
    }
    const flashGeo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < FLASH_POOL; i++) {
      const m = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({
        color: 0xffe08a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      m.visible = false;
      this.flashes.push({ obj: m, life: 0, maxLife: 1 });
      this.group.add(m);
    }
    const ballGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < FIREBALL_POOL; i++) {
      const m = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({
        color: 0xffa040, transparent: true, depthWrite: false,
      }));
      m.visible = false;
      this.fireballs.push({ obj: m, life: 0, maxLife: 1 });
      this.group.add(m);
    }
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ API

  /** Trazadora de un disparo, de `from` a `to`. */
  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.025, life = 0.07): void {
    const t = this.take(this.tracers);
    const len = from.distanceTo(to);
    if (len < 0.01) return;
    t.obj.position.copy(from);
    t.obj.lookAt(to);
    t.obj.scale.set(width, width, len);
    (t.obj.material as THREE.MeshBasicMaterial).color.setHex(color);
    t.life = t.maxLife = life;
    t.obj.visible = true;
  }

  muzzleFlash(pos: THREE.Vector3, color = 0xffe08a, size = 0.09): void {
    const f = this.take(this.flashes);
    f.obj.position.copy(pos);
    f.obj.scale.setScalar(size);
    f.obj.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    (f.obj.material as THREE.MeshBasicMaterial).color.setHex(color);
    f.life = f.maxLife = 0.05;
    f.obj.visible = true;
  }

  impact(pos: THREE.Vector3, kind: ImpactKind): void {
    const colors = IMPACT_COLORS[kind];
    for (let i = 0; i < 7; i++) {
      this.spawn(pos, randomDir(this.tmpV).multiplyScalar(2 + Math.random() * 3), colors[i % colors.length],
        0.05 + Math.random() * 0.05, 0.3 + Math.random() * 0.2, 12, 1);
    }
  }

  explosion(pos: THREE.Vector3, radius: number, cameraPos: THREE.Vector3): void {
    const fb = this.take(this.fireballs);
    fb.obj.position.copy(pos);
    fb.obj.userData.radius = radius * 0.7;
    fb.life = fb.maxLife = 0.4;
    fb.obj.visible = true;
    for (let i = 0; i < 34; i++) {
      const c = [0xffd166, 0xff9f43, 0xee5253, 0xfff3c4][i % 4];
      this.spawn(pos, randomDir(this.tmpV).multiplyScalar(4 + Math.random() * 9), c, 0.12 + Math.random() * 0.15,
        0.35 + Math.random() * 0.3, 2, 3);
    }
    for (let i = 0; i < 14; i++) {
      const v = randomDir(this.tmpV).multiplyScalar(1.5 + Math.random() * 2);
      v.y = Math.abs(v.y) + 1;
      this.spawn(pos, v, i % 2 ? 0x5f6368 : 0x80868b, 0.18 + Math.random() * 0.14, 0.9 + Math.random() * 0.6, -1, 1.5, true);
    }
    for (let i = 0; i < 12; i++) {
      const v = randomDir(this.tmpV).multiplyScalar(5 + Math.random() * 6);
      v.y = Math.abs(v.y) * 1.5 + 2;
      this.spawn(pos, v, 0x3b3b3b, 0.07 + Math.random() * 0.08, 0.9 + Math.random() * 0.5, 18, 0.3);
    }
    const d = cameraPos.distanceTo(pos);
    this.shake = Math.max(this.shake, Math.max(0, 1 - d / (radius * 5)) * 0.6);
  }

  /** Estallido de cubos del color del jugador al morir. */
  deathBurst(pos: THREE.Vector3, color: number): void {
    for (let i = 0; i < 26; i++) {
      const v = randomDir(this.tmpV).multiplyScalar(3 + Math.random() * 4);
      v.y = Math.abs(v.y) * 1.2 + 2;
      const c = this.tmpC.setHex(color).multiplyScalar(0.7 + Math.random() * 0.5).getHex();
      this.spawn(pos, v, c, 0.12 + Math.random() * 0.12, 1 + Math.random() * 0.6, 18, 0.5);
    }
  }

  /** Pulso de la gravity gun (empujón o lanzamiento). */
  punt(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    this.tracer(from, to, color, 0.08, 0.15);
    for (let i = 0; i < 10; i++) {
      this.spawn(to, randomDir(this.tmpV).multiplyScalar(2 + Math.random() * 2), color, 0.06, 0.3, 0, 2);
    }
  }

  /** Llama de un propulsor encendido (sale en `dir`). */
  thrusterFlame(pos: THREE.Vector3, dir: THREE.Vector3): void {
    const v = this.tmpV.copy(dir).multiplyScalar(4 + Math.random() * 2);
    v.x += (Math.random() - 0.5) * 0.8;
    v.y += (Math.random() - 0.5) * 0.8;
    v.z += (Math.random() - 0.5) * 0.8;
    this.spawn(pos, v, Math.random() < 0.5 ? 0xffd166 : 0xff7f2a, 0.12, 0.18, 0, 2);
  }

  /** Destello de la tool gun en el punto donde se usa. */
  toolSpark(pos: THREE.Vector3, color: number): void {
    for (let i = 0; i < 8; i++) {
      this.spawn(pos, randomDir(this.tmpV).multiplyScalar(1.5 + Math.random() * 2), color, 0.05, 0.25, 0, 3);
    }
  }

  addRocket(id: number, origin: THREE.Vector3, dir: THREE.Vector3, speed: number, spawnMs: number, own: boolean, color: number): void {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.45, 6).rotateX(Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x556b2f, flatShading: true }),
    );
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.18, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.31),
      new THREE.MeshLambertMaterial({ color, flatShading: true }),
    );
    const flame = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0, 0.27),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }),
    );
    mesh.add(body, tip, flame);
    mesh.lookAt(dir); // apunta el morro (-Z) en la dirección de vuelo
    mesh.rotateY(Math.PI);
    this.group.add(mesh);
    this.rockets.set(id, {
      mesh, origin: origin.clone(), dir: dir.clone().normalize(), speed, spawnMs, own, smokeTimer: 0,
    });
  }

  /** Quita un cohete (al explotar). Devuelve false si no existía. */
  /** Quita todos los cohetes en vuelo (ronda nueva). */
  clearRockets(): void {
    for (const id of [...this.rockets.keys()]) this.removeRocket(id);
  }

  removeRocket(id: number): boolean {
    const r = this.rockets.get(id);
    if (!r) return false;
    this.group.remove(r.mesh);
    r.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.rockets.delete(id);
    return true;
  }

  /** Rayo continuo de la gravity gun para un jugador (llamar cada frame mientras sujete algo). */
  beam(playerId: number, from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    let m = this.beams.get(playerId);
    if (!m) {
      m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      this.beams.set(playerId, m);
      this.group.add(m);
    }
    const w = 0.03 + Math.sin(this.time * 30 + playerId) * 0.012;
    m.position.copy(from);
    m.lookAt(to);
    m.scale.set(w, w, Math.max(0.01, from.distanceTo(to)));
    m.visible = true;
    this.beamsSeen.add(playerId);
  }

  // ------------------------------------------------------------------ bucle

  /**
   * @param nowServerMs     tiempo actual estimado del servidor (cohetes propios)
   * @param renderServerMs  tiempo interpolado (cohetes de los demás)
   */
  update(dt: number, nowServerMs: number, renderServerMs: number): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 1.8);

    // Rayos que nadie ha renovado este frame: ocultar.
    for (const [id, m] of this.beams) if (!this.beamsSeen.has(id)) m.visible = false;
    this.beamsSeen.clear();

    for (const r of this.rockets.values()) {
      const t = ((r.own ? nowServerMs : renderServerMs) - r.spawnMs) / 1000;
      r.mesh.position.copy(r.origin).addScaledVector(r.dir, r.speed * Math.max(0, t));
      r.mesh.visible = t >= 0;
      r.smokeTimer -= dt;
      if (t >= 0 && r.smokeTimer <= 0) {
        r.smokeTimer = 0.02;
        this.spawn(r.mesh.position, this.tmpV.set(0, 0.5, 0), 0x9aa0a6, 0.12, 0.6, -0.5, 1, true);
      }
    }

    for (const t of this.tracers) {
      if (!t.obj.visible) continue;
      t.life -= dt;
      (t.obj.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) t.obj.visible = false;
    }
    for (const f of this.flashes) {
      if (!f.obj.visible) continue;
      f.life -= dt;
      if (f.life <= 0) f.obj.visible = false;
    }
    for (const f of this.fireballs) {
      if (!f.obj.visible) continue;
      f.life -= dt;
      const k = 1 - f.life / f.maxLife;
      f.obj.scale.setScalar(0.3 + (f.obj.userData.radius as number) * Math.sqrt(k));
      const mat = f.obj.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 1 - k);
      mat.color.setHex(k < 0.3 ? 0xfff3c4 : 0xff9f43);
      if (f.life <= 0) f.obj.visible = false;
    }
    this.updateParticles(dt);
  }

  private updateParticles(dt: number): void {
    const mesh = this.particleMesh;
    let n = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.03 && p.gravity > 0) {
        p.pos.y = 0.03;
        p.vel.y *= -0.3;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      const k = p.life / p.maxLife;
      const s = p.grow ? p.size * (1 + (1 - k) * 1.5) * Math.min(1, k * 3) : p.size * k;
      this.tmpQ.setFromAxisAngle(this.tmpV.set(1, 1, 0).normalize(), p.life * 6);
      mesh.setMatrixAt(n, this.tmpM.compose(p.pos, this.tmpQ, this.tmpS.setScalar(s)));
      mesh.setColorAt(n, p.color);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  private spawn(
    pos: THREE.Vector3, vel: THREE.Vector3, color: number, size: number, life: number,
    gravity: number, drag: number, grow = false,
  ): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    if (this.density < 1 && Math.random() > this.density) return;
    this.particles.push({
      pos: pos.clone(), vel: vel.clone(), color: new THREE.Color(color), size, life, maxLife: life, gravity, drag, grow,
    });
  }

  /** Toma el elemento libre (o el más gastado) de un pool. */
  private take<T extends THREE.Object3D>(pool: Timed<T>[]): Timed<T> {
    let best = pool[0];
    for (const it of pool) {
      if (!it.obj.visible) return it;
      if (it.life < best.life) best = it;
    }
    return best;
  }

  dispose(): void {
    for (const id of [...this.rockets.keys()]) this.removeRocket(id);
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}

function randomDir(out: THREE.Vector3): THREE.Vector3 {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(a), u, r * Math.sin(a));
}
