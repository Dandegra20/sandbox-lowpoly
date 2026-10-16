import RAPIER from '@dimforge/rapier3d-compat';
import { TICK_DT } from '../shared/constants';
import type { ConstraintInfo, ServerMessage, ThrusterInfo, Vec3 } from '../shared/protocol';
import type { ServerProp } from './types';

type Q = { x: number; y: number; z: number; w: number };

interface ServerConstraint {
  info: ConstraintInfo;
  joint: RAPIER.ImpulseJoint;
  owner: number;
}

interface ServerThruster {
  info: ThrusterInfo;
  owner: number;
  force: number;
}

interface ConstraintHost {
  readonly world: RAPIER.World;
  readonly props: Map<number, ServerProp>;
  /** Cuerpo fijo del suelo (para soldar o atar al mundo). */
  readonly ground: RAPIER.RigidBody;
  broadcast(msg: ServerMessage): void;
}

// --- Cuaterniones (Rapier usa {x,y,z,w}) ---
const conj = (q: Q): Q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const mul = (a: Q, b: Q): Q => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
export function rotateVec(q: Q, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v[2] - q.z * v[1]);
  const ty = 2 * (q.z * v[0] - q.x * v[2]);
  const tz = 2 * (q.x * v[1] - q.y * v[0]);
  return [v[0] + q.w * tx + (q.y * tz - q.z * ty), v[1] + q.w * ty + (q.z * tx - q.x * tz), v[2] + q.w * tz + (q.x * ty - q.y * tx)];
}
/** Punto del mundo -> espacio local del cuerpo. */
export function toLocal(body: RAPIER.RigidBody, p: Vec3): Vec3 {
  const t = body.translation();
  return rotateVec(conj(body.rotation()), [p[0] - t.x, p[1] - t.y, p[2] - t.z]);
}
const vec = (v: Vec3) => ({ x: v[0], y: v[1], z: v[2] });
const r3 = (v: Vec3): Vec3 => v.map((n) => Math.round(n * 1000) / 1000) as Vec3;

/**
 * Uniones creadas con la tool gun: soldaduras (junta fija en la pose relativa actual),
 * cuerdas (junta de cuerda con longitud máxima) y propulsores (impulso en un punto cada tick).
 * Todo vive en el servidor; los clientes reciben la lista para dibujar cuerdas y propulsores.
 */
export class Constraints {
  private constraints = new Map<number, ServerConstraint>();
  private thrusters = new Map<number, ServerThruster>();
  private nextId = 1;

  constructor(private host: ConstraintHost) {}

  get constraintList(): ConstraintInfo[] {
    return [...this.constraints.values()].map((c) => c.info);
  }

  get thrusterList(): ThrusterInfo[] {
    return [...this.thrusters.values()].map((t) => t.info);
  }

  countByOwner(owner: number): { constraints: number; thrusters: number } {
    let constraints = 0, thrusters = 0;
    for (const c of this.constraints.values()) if (c.owner === owner) constraints++;
    for (const t of this.thrusters.values()) if (t.owner === owner) thrusters++;
    return { constraints, thrusters };
  }

  /** Soldar a con b (o con el mundo) tal y como están ahora. */
  weld(owner: number, a: ServerProp, b: ServerProp | null): ConstraintInfo {
    const ba = a.body;
    const bb = b ? b.body : this.host.ground;
    // Junta fija: el origen de A queda en `anchor2` del espacio de B, con la rotación relativa actual.
    const anchor2 = toLocal(bb, v3(ba.translation()));
    const frame2 = mul(conj(bb.rotation()), ba.rotation());
    const data = RAPIER.JointData.fixed({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, vec(anchor2), frame2);
    const joint = this.host.world.createImpulseJoint(data, ba, bb, true);
    joint.setContactsEnabled(false); // lo soldado no choca entre sí (evita temblores)
    return this.add(owner, { id: this.nextId++, kind: 'weld', a: a.id, b: b?.id ?? 0, la: [0, 0, 0], lb: r3(anchor2) }, joint);
  }

  /** Cuerda entre dos puntos del mundo (cada uno sobre un objeto o sobre el mundo). */
  rope(owner: number, a: ServerProp, pa: Vec3, b: ServerProp | null, pb: Vec3, slack: number): ConstraintInfo {
    const la = toLocal(a.body, pa);
    const lb = b ? toLocal(b.body, pb) : toLocal(this.host.ground, pb);
    const length = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) + slack;
    const data = RAPIER.JointData.rope(length, vec(la), vec(lb));
    const joint = this.host.world.createImpulseJoint(data, a.body, b ? b.body : this.host.ground, true);
    // Para dibujarla, el extremo en el mundo se envía en coordenadas del mundo.
    return this.add(owner, { id: this.nextId++, kind: 'rope', a: a.id, b: b?.id ?? 0, la: r3(la), lb: r3(b ? lb : pb) }, joint);
  }

  private add(owner: number, info: ConstraintInfo, joint: RAPIER.ImpulseJoint): ConstraintInfo {
    this.constraints.set(info.id, { info, joint, owner });
    this.host.broadcast({ t: 'constraint_added', c: info });
    return info;
  }

  /** Quita las uniones de un tipo que tocan a un objeto. Devuelve cuántas. */
  removeFor(propId: number, kind: ConstraintInfo['kind']): number {
    let n = 0;
    for (const c of [...this.constraints.values()]) {
      if (c.info.kind !== kind || (c.info.a !== propId && c.info.b !== propId)) continue;
      this.removeConstraint(c);
      n++;
    }
    return n;
  }

  private removeConstraint(c: ServerConstraint): void {
    if (c.joint.isValid()) this.host.world.removeImpulseJoint(c.joint, true);
    this.constraints.delete(c.info.id);
    this.host.broadcast({ t: 'constraint_removed', id: c.info.id });
  }

  /** Propulsor en `point` (mundo) que empuja en `dir` (mundo). */
  addThruster(owner: number, prop: ServerProp, point: Vec3, dir: Vec3, force: number): ThrusterInfo {
    const q = prop.body.rotation();
    const info: ThrusterInfo = {
      // Posición local sin escala (se multiplica por la escala actual al usarla).
      id: this.nextId++, prop: prop.id, pos: r3(toLocal(prop.body, point).map((n) => n / prop.scale) as Vec3),
      dir: r3(rotateVec(conj(q), dir)), active: false,
    };
    this.thrusters.set(info.id, { info, owner, force });
    this.host.broadcast({ t: 'thruster_added', th: info });
    return info;
  }

  /** Enciende o apaga los propulsores de un objeto (todos al mismo estado). Devuelve el nuevo estado. */
  toggleThrusters(propId: number): boolean | null {
    const list = [...this.thrusters.values()].filter((t) => t.info.prop === propId);
    if (!list.length) return null;
    const active = !list.some((t) => t.info.active);
    for (const t of list) {
      t.info.active = active;
      this.host.broadcast({ t: 'thruster_active', id: t.info.id, active });
    }
    if (active) this.host.props.get(propId)?.body.wakeUp();
    return active;
  }

  removeThrusters(propId: number): number {
    let n = 0;
    for (const t of [...this.thrusters.values()]) {
      if (t.info.prop !== propId) continue;
      this.thrusters.delete(t.info.id);
      this.host.broadcast({ t: 'thruster_removed', id: t.info.id });
      n++;
    }
    return n;
  }

  hasAny(propId: number): boolean {
    for (const c of this.constraints.values()) if (c.info.a === propId || c.info.b === propId) return true;
    for (const t of this.thrusters.values()) if (t.info.prop === propId) return true;
    return false;
  }

  /** Antes de borrar un objeto: sus uniones y propulsores desaparecen con él. */
  onPropRemoved(propId: number): void {
    for (const c of [...this.constraints.values()]) {
      if (c.info.a === propId || c.info.b === propId) this.removeConstraint(c);
    }
    this.removeThrusters(propId);
  }

  /** Todos los objetos unidos (soldadura o cuerda) a uno, incluido él mismo. */
  connected(propId: number): number[] {
    const seen = new Set([propId]);
    const queue = [propId];
    while (queue.length) {
      const id = queue.pop()!;
      for (const c of this.constraints.values()) {
        const other = c.info.a === id ? c.info.b : c.info.b === id ? c.info.a : 0;
        if (other && !seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    return [...seen];
  }

  /** Por tick, antes del paso de física: empuje de los propulsores encendidos. */
  update(): void {
    for (const t of this.thrusters.values()) {
      if (!t.info.active) continue;
      const prop = this.host.props.get(t.info.prop);
      if (!prop || prop.body.isFixed()) continue;
      const body = prop.body;
      const q = body.rotation();
      const p = body.translation();
      const lp = rotateVec(q, t.info.pos.map((n) => n * prop.scale) as Vec3);
      const d = rotateVec(q, t.info.dir);
      const j = t.force * TICK_DT;
      body.applyImpulseAtPoint({ x: d[0] * j, y: d[1] * j, z: d[2] * j }, { x: p.x + lp[0], y: p.y + lp[1], z: p.z + lp[2] }, true);
    }
  }
}

function v3(v: { x: number; y: number; z: number }): Vec3 {
  return [v.x, v.y, v.z];
}
