import RAPIER from '@dimforge/rapier3d-compat';
import { getProp, partVolume, propBottom, propRadius } from '../content/props';
import { SPAWNABLE_BY_ID, spawnableCost, type SpawnableDef } from '../content/spawnables';
import { addPropShapes, partRotation, type Quat4, type Shape } from '../shared/collision';
import { MAX_DYNAMIC_PROPS, MAX_PROPS_PER_PLAYER, SPAWN_MAX_DISTANCE } from '../shared/constants';
import type { PropInfo, ServerMessage, Vec3 } from '../shared/protocol';
import { PROP_GROUPS, VEHICLE_GROUPS, type ServerProp } from './types';
export type { Quat4 };

export type SpawnResult = { ok: true; ids: number[] } | { ok: false; message: string };

interface PropHost {
  readonly world: RAPIER.World;
  broadcast(msg: ServerMessage): void;
  /** Antes de borrar un objeto (soltarlo, bajar al conductor...). */
  onPropRemoved(prop: ServerProp): void;
  /** Tras crear un objeto (crear el controlador si es un vehículo). */
  onPropCreated(prop: ServerProp): void;
}

interface Group {
  owner: number;
  ids: number[];
}

/** Rota v por el cuaternión q. */
function rotate(q: Quat4, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

const yawQuat = (yaw: number): Quat4 => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/**
 * Objetos físicos de una sala: creación a partir del registro (un colisionador por pieza),
 * grupos con juntas (ragdolls), dueño, límites por jugador, deshacer y borrado.
 */
export class PropSystem {
  readonly props = new Map<number, ServerProp>();
  private byBody = new Map<number, ServerProp>();
  private groups = new Map<number, Group>();
  /** Orden de creación por jugador (para deshacer): ids de grupo o -id de objeto suelto. */
  private history = new Map<number, number[]>();
  private nextId = 1;
  private nextGroup = 1;

  constructor(private host: PropHost) {}

  byBodyHandle(handle: number): ServerProp | undefined {
    return this.byBody.get(handle);
  }

  countByOwner(owner: number): number {
    let n = 0;
    for (const p of this.props.values()) if (p.owner === owner) n++;
    return n;
  }

  info(p: ServerProp): PropInfo {
    const t = p.body.translation();
    const r = p.body.rotation();
    return {
      id: p.id, type: p.type, pos: [t.x, t.y, t.z], rot: [r.x, r.y, r.z, r.w], owner: p.owner, tint: p.tint,
      scale: p.scale, frozen: p.body.isFixed(),
    };
  }

  /** Crea un cuerpo a partir de su definición. No comprueba límites de jugador. */
  create(type: string, pos: Vec3, rot: Quat4 = [0, 0, 0, 1], owner = -1, tint = 0xffffff, group = 0, sleep = false): ServerProp | null {
    if (this.props.size >= MAX_DYNAMIC_PROPS) return null;
    const def = getProp(type);
    const body = this.host.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...pos)
        .setRotation({ x: rot[0], y: rot[1], z: rot[2], w: rot[3] })
        .setCanSleep(true)
        // Algo de amortiguación: lo redondo deja de rodar y se duerme antes.
        .setAngularDamping(0.25)
        .setLinearDamping(0.02),
    );
    if (sleep) body.sleep();

    const prop: ServerProp = {
      id: this.nextId++, type, def, body, owner, group, tint, scale: 1,
      health: def.explosive?.health ?? 0, sentAwake: false,
    };
    this.buildColliders(prop);
    this.props.set(prop.id, prop);
    this.byBody.set(body.handle, prop);
    this.host.onPropCreated(prop);
    return prop;
  }

  /**
   * (Re)crea los colisionadores del objeto a su escala actual: uno por pieza sólida, con la
   * masa total (× escala³) repartida según el volumen de cada pieza.
   */
  private buildColliders(prop: ServerProp): void {
    const { body, def, scale: k } = prop;
    for (let i = body.numColliders() - 1; i >= 0; i--) this.host.world.removeCollider(body.collider(i), false);
    const solid = def.parts.filter((p) => !p.visualOnly);
    const totalVolume = solid.reduce((a, p) => a + partVolume(p), 0) || 1;
    const groups = def.vehicle ? VEHICLE_GROUPS : PROP_GROUPS;
    for (const part of solid) {
      let desc: RAPIER.ColliderDesc;
      switch (part.kind) {
        case 'box': desc = RAPIER.ColliderDesc.cuboid((part.size[0] / 2) * k, (part.size[1] / 2) * k, (part.size[2] / 2) * k); break;
        case 'ball': desc = RAPIER.ColliderDesc.ball(part.radius * k); break;
        case 'cylinder': desc = RAPIER.ColliderDesc.cylinder((part.height / 2) * k, part.radius * k); break;
        case 'cone': desc = RAPIER.ColliderDesc.cone((part.height / 2) * k, part.radius * k); break;
      }
      if (part.pos) desc.setTranslation(part.pos[0] * k, part.pos[1] * k, part.pos[2] * k);
      const r = partRotation(part);
      if (r) desc.setRotation({ x: r[0], y: r[1], z: r[2], w: r[3] });
      desc.setMass((def.mass * k ** 3 * partVolume(part)) / totalVolume)
        .setFriction(def.friction ?? 0.6)
        .setRestitution(def.restitution ?? 0.1)
        .setCollisionGroups(groups);
      this.host.world.createCollider(desc, body);
    }
  }

  // ---------------------------------------------------------------- herramientas

  setTint(prop: ServerProp, tint: number): void {
    prop.tint = tint & 0xffffff;
    this.host.broadcast({ t: 'prop_update', id: prop.id, tint: prop.tint });
  }

  setScale(prop: ServerProp, scale: number): void {
    prop.scale = scale;
    this.buildColliders(prop);
    prop.body.wakeUp();
    this.host.broadcast({ t: 'prop_update', id: prop.id, scale });
  }

  /** Congelar = cuerpo fijo (no le afectan fuerzas ni gravedad). */
  setFrozen(prop: ServerProp, frozen: boolean): void {
    if (prop.body.isFixed() === frozen) return;
    prop.body.setBodyType(frozen ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    if (!frozen) prop.body.wakeUp();
    this.host.broadcast({ t: 'prop_update', id: prop.id, frozen });
  }

  /**
   * Crea un spawnable del menú delante del jugador: donde apunta, apoyado en la superficie,
   * girado hacia donde mira. Valida límites de sala y de jugador.
   */
  spawn(owner: number, id: string, eye: Vec3, dir: Vec3, yaw: number): SpawnResult {
    const s: SpawnableDef | undefined = SPAWNABLE_BY_ID[id];
    if (!s) return { ok: false, message: 'Ese objeto no existe.' };
    const cost = spawnableCost(s);
    if (this.countByOwner(owner) + cost > MAX_PROPS_PER_PLAYER) {
      return { ok: false, message: `Has llegado al límite de ${MAX_PROPS_PER_PLAYER} objetos. Pulsa Z para deshacer.` };
    }
    if (this.props.size + cost > MAX_DYNAMIC_PROPS) return { ok: false, message: 'La sala está llena de objetos.' };

    // Tamaño y "suelo" del spawnable (para un grupo: el de su pieza más baja/lejana).
    const parts = s.group ? s.group.parts : [{ type: s.prop!, pos: [0, 0, 0] as Vec3 }];
    let radius = 0;
    let bottom = 0;
    for (const p of parts) {
      const def = getProp(p.type);
      radius = Math.max(radius, Math.hypot(...p.pos) + propRadius(def));
      bottom = Math.min(bottom, p.pos[1] + propBottom(def));
    }

    // Punto de aparición: donde apunta la mira (o a la distancia máxima), sin meterlo en la superficie.
    const ray = new RAPIER.Ray({ x: eye[0], y: eye[1], z: eye[2] }, { x: dir[0], y: dir[1], z: dir[2] });
    const hit = this.host.world.castRayAndGetNormal(ray, SPAWN_MAX_DISTANCE, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    const reach = hit ? hit.timeOfImpact : SPAWN_MAX_DISTANCE;
    let base: Vec3;
    if (hit && hit.normal.y > 0.6) {
      // Sobre un suelo: apoyado encima del punto de impacto.
      base = [eye[0] + dir[0] * reach, eye[1] + dir[1] * reach - bottom + 0.05, eye[2] + dir[2] * reach];
    } else {
      // Contra una pared o en el aire: separado lo que mide el objeto, hacia el jugador.
      const back = Math.min(reach, radius + 0.1);
      base = [eye[0] + dir[0] * (reach - back), eye[1] + dir[1] * (reach - back), eye[2] + dir[2] * (reach - back)];
      base[1] = Math.max(base[1], -bottom + 0.05);
    }
    // Nunca más cerca de 1,5 m de los ojos (no aparecer dentro del jugador).
    const toBase = Math.hypot(base[0] - eye[0], base[2] - eye[2]);
    if (toBase < 1.5 + radius * 0.5) {
      const k = 1.5 + radius * 0.5;
      const hx = dir[0], hz = dir[2], hl = Math.hypot(hx, hz) || 1;
      base[0] = eye[0] + (hx / hl) * k;
      base[2] = eye[2] + (hz / hl) * k;
    }

    const q = yawQuat(yaw);
    const ids: number[] = [];
    if (s.prop) {
      const prop = this.create(s.prop, base, q, owner);
      if (!prop) return { ok: false, message: 'No se pudo crear.' };
      ids.push(prop.id);
      this.pushHistory(owner, -prop.id);
    } else {
      const gid = this.nextGroup++;
      const bodies: ServerProp[] = [];
      for (const part of s.group!.parts) {
        const off = rotate(q, part.pos);
        const prop = this.create(part.type, [base[0] + off[0], base[1] + off[1], base[2] + off[2]], q, owner, part.tint ?? 0xffffff, gid);
        if (!prop) break;
        // Ragdolls: algo de amortiguación para que no se agiten sin parar.
        prop.body.setAngularDamping(1.5);
        prop.body.setLinearDamping(0.1);
        bodies.push(prop);
        ids.push(prop.id);
      }
      // Las juntas usan anclajes locales: como todas las piezas comparten rotación, basta
      // con restar la posición de cada pieza al punto de unión (en el espacio del grupo).
      for (const j of s.group!.joints) {
        const a = bodies[j.a], b = bodies[j.b];
        if (!a || !b) continue;
        const pa = s.group!.parts[j.a].pos, pb = s.group!.parts[j.b].pos;
        const data = RAPIER.JointData.spherical(
          { x: j.at[0] - pa[0], y: j.at[1] - pa[1], z: j.at[2] - pa[2] },
          { x: j.at[0] - pb[0], y: j.at[1] - pb[1], z: j.at[2] - pb[2] },
        );
        const joint = this.host.world.createImpulseJoint(data, a.body, b.body, true);
        joint.setContactsEnabled(!!j.contacts);
      }
      // Un empujoncito aleatorio al torso: un muñeco no debe quedarse de pie haciendo equilibrio.
      const a = Math.random() * Math.PI * 2;
      bodies[0]?.body.setLinvel({ x: Math.cos(a) * 1.2, y: 0, z: Math.sin(a) * 1.2 }, true);
      this.groups.set(gid, { owner, ids });
      this.pushHistory(owner, gid);
    }
    for (const id of ids) this.host.broadcast({ t: 'prop_added', prop: this.info(this.props.get(id)!) });
    return { ok: true, ids };
  }

  private pushHistory(owner: number, entry: number): void {
    let h = this.history.get(owner);
    if (!h) this.history.set(owner, (h = []));
    h.push(entry);
  }

  /** Deshace el último spawn del jugador que siga existiendo. Devuelve si borró algo. */
  undo(owner: number): boolean {
    const h = this.history.get(owner);
    while (h && h.length) {
      const entry = h.pop()!;
      if (entry < 0) {
        if (this.props.has(-entry)) {
          this.remove(-entry);
          return true;
        }
      } else if (this.groups.has(entry)) {
        this.removeGroup(entry);
        return true;
      }
    }
    return false;
  }

  /** Borra todos los objetos de un jugador. */
  clearOwner(owner: number): number {
    const ids = [...this.props.values()].filter((p) => p.owner === owner).map((p) => p.id);
    for (const id of ids) this.remove(id);
    this.history.delete(owner);
    return ids.length;
  }

  removeGroup(gid: number): void {
    const g = this.groups.get(gid);
    if (!g) return;
    this.groups.delete(gid);
    for (const id of g.ids) this.remove(id);
  }

  /** Borra un objeto (y sus juntas, que Rapier elimina con el cuerpo). */
  remove(id: number): void {
    const prop = this.props.get(id);
    if (!prop) return;
    this.host.onPropRemoved(prop);
    this.host.world.removeRigidBody(prop.body);
    this.props.delete(id);
    this.byBody.delete(prop.body.handle);
    if (prop.group) {
      const g = this.groups.get(prop.group);
      if (g) {
        g.ids = g.ids.filter((x) => x !== id);
        if (!g.ids.length) this.groups.delete(prop.group);
      }
    }
    this.host.broadcast({ t: 'prop_removed', id });
  }

  /** Añade las formas de colisión de todos los objetos (para el controlador de los jugadores). */
  addShapes(out: Shape[]): void {
    for (const prop of this.props.values()) {
      const t = prop.body.translation();
      const r = prop.body.rotation();
      addPropShapes(prop.def.parts, t.x, t.y, t.z, [r.x, r.y, r.z, r.w], prop.id, out, prop.scale);
    }
  }
}

export { yawQuat };
