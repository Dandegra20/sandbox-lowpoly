import RAPIER from '@dimforge/rapier3d-compat';
import type { VehicleSpec } from '../content/props';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS, TICK_DT, VEHICLE_ENTER_DISTANCE } from '../shared/constants';
import { createMoveState } from '../shared/playerController';
import { Button, WEAPON_VEHICLE, type Vec3 } from '../shared/protocol';
import type { ServerPlayer, ServerProp } from './types';

interface Vehicle {
  prop: ServerProp;
  spec: VehicleSpec;
  controller: RAPIER.DynamicRayCastVehicleController;
  driver: ServerPlayer | null;
  steer: number;
  /** Semiextensiones del chasis (para el atropello). */
  half: Vec3;
}

interface VehicleHost {
  readonly world: RAPIER.World;
  readonly players: Map<number, ServerPlayer>;
  damage(target: ServerPlayer, amount: number, attacker: ServerPlayer | null, weapon: number, from: Vec3): void;
}

/** Velocidad a partir de la cual un vehículo hace daño al chocar con un jugador (m/s). */
const RUN_OVER_SPEED = 6;
const RUN_OVER_COOLDOWN_MS = 600;

const v3 = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

/** Rota v por q ({x,y,z,w}) o por su inversa. */
function rot(q: RAPIER.Rotation, v: Vec3, inverse = false): Vec3 {
  const qx = inverse ? -q.x : q.x, qy = inverse ? -q.y : q.y, qz = inverse ? -q.z : q.z, qw = q.w;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
}

/**
 * Vehículos conducibles (solo servidor). Usa el controlador de vehículo por rayos de Rapier:
 * el chasis es un cuerpo dinámico y cada rueda es un rayo con suspensión. El conductor deja de
 * moverse con su controlador y va "pegado" al asiento; sus botones mueven el vehículo.
 * El frente del chasis es -Z (como el resto de modelos).
 */
export class Vehicles {
  private vehicles = new Map<number, Vehicle>();

  constructor(private host: VehicleHost) {}

  get(propId: number): Vehicle | undefined {
    return this.vehicles.get(propId);
  }

  add(prop: ServerProp): void {
    const spec = prop.def.vehicle!;
    const controller = this.host.world.createVehicleController(prop.body);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;
    spec.wheels.forEach((w, i) => {
      controller.addWheel({ x: w.pos[0], y: w.pos[1], z: w.pos[2] }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspensionRest, w.radius);
      controller.setWheelSuspensionStiffness(i, spec.suspensionStiffness);
      controller.setWheelSuspensionCompression(i, 0.85 * 2 * Math.sqrt(spec.suspensionStiffness) * 0.2);
      controller.setWheelSuspensionRelaxation(i, 0.88 * 2 * Math.sqrt(spec.suspensionStiffness) * 0.2);
      controller.setWheelMaxSuspensionForce(i, prop.def.mass * 60);
      controller.setWheelFrictionSlip(i, 2.2);
    });
    const main = prop.def.parts.find((p) => p.kind === 'box' && !p.visualOnly);
    const half: Vec3 = main && main.kind === 'box' ? [main.size[0] / 2, main.size[1] / 2, main.size[2] / 2] : [1, 0.5, 1.5];
    this.vehicles.set(prop.id, { prop, spec, controller, driver: null, steer: 0, half });
  }

  /** Al borrar el objeto: baja al conductor y libera el controlador. */
  remove(prop: ServerProp): void {
    const v = this.vehicles.get(prop.id);
    if (!v) return;
    if (v.driver) this.exit(v.driver);
    this.host.world.removeVehicleController(v.controller);
    this.vehicles.delete(prop.id);
  }

  /** Pulsación de E: subir al vehículo libre más cercano, o bajar. */
  use(p: ServerPlayer): void {
    if (p.vehicle) return this.exit(p);
    let best: Vehicle | null = null;
    let bestD = VEHICLE_ENTER_DISTANCE;
    for (const v of this.vehicles.values()) {
      // Ocupado, o alguien lo está arrastrando con la pistola de gravedad o con Mover.
      if (v.driver || [...this.host.players.values()].some((q) => q.heldProp === v.prop.id)) continue;
      const t = v.prop.body.translation();
      const d = Math.hypot(t.x - p.move.x, (t.y - p.move.y) * 0.5, t.z - p.move.z) - Math.max(v.half[0], v.half[2]) * 0.6;
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (!best) return;
    best.driver = p;
    p.vehicle = best.prop.id;
    p.collider.setEnabled(false);
    best.prop.body.wakeUp();
    this.placeDriver(best);
  }

  exit(p: ServerPlayer): void {
    const v = this.vehicles.get(p.vehicle);
    p.vehicle = 0;
    if (!p.dead) p.collider.setEnabled(true);
    if (!v) return;
    v.driver = null;
    const body = v.prop.body;
    const t = body.translation();
    const off = rot(body.rotation(), v.spec.exit);
    const lv = body.linvel();
    const pos: Vec3 = [t.x + off[0], Math.max(t.y + off[1], 1), t.z + off[2]];
    Object.assign(p.move, createMoveState(...pos), { vx: lv.x, vy: Math.max(0, lv.y), vz: lv.z });
    p.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
  }

  /** Antes del paso de física: aplica motor, freno y dirección a cada vehículo. */
  update(): void {
    for (const v of this.vehicles.values()) {
      const body = v.prop.body;
      const c = v.controller;
      const n = v.spec.wheels.length;
      if (!v.driver && body.isSleeping()) continue;

      const b = v.driver?.lastInput.buttons ?? 0;
      // currentVehicleSpeed es a lo largo de +Z (hacia atrás): adelante = negativo.
      const forwardSpeed = -c.currentVehicleSpeed();
      let engine = 0;
      let brake = v.driver ? 0 : v.spec.brakeForce * 0.5; // sin conductor: freno de mano suave
      if (b & Button.Forward) {
        if (forwardSpeed < -1) brake = v.spec.brakeForce;
        else if (forwardSpeed < v.spec.maxSpeed) engine = -v.spec.engineForce;
      } else if (b & Button.Back) {
        if (forwardSpeed > 1) brake = v.spec.brakeForce;
        else if (forwardSpeed > -v.spec.maxSpeed * 0.4) engine = v.spec.engineForce * 0.7;
      }
      if (b & Button.Jump) brake = v.spec.brakeForce * 2;

      // Dirección suavizada, con menos giro a alta velocidad.
      const target = (((b & Button.Left) ? 1 : 0) - ((b & Button.Right) ? 1 : 0))
        * v.spec.maxSteer * (1 - Math.min(0.6, Math.abs(forwardSpeed) / 40));
      v.steer += Math.max(-TICK_DT * 4, Math.min(TICK_DT * 4, target - v.steer));

      for (let i = 0; i < n; i++) {
        const w = v.spec.wheels[i];
        c.setWheelSteering(i, w.steer ? v.steer : 0);
        c.setWheelEngineForce(i, w.drive ? engine : 0);
        c.setWheelBrake(i, brake);
      }
      if (v.driver) body.wakeUp();
      // Las ruedas no detectan su propio chasis ni a los jugadores.
      c.updateVehicle(TICK_DT, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC, undefined,
        (col) => col.parent()?.handle !== body.handle);

      // Volcado: con el conductor pulsando Espacio casi parado, se endereza.
      if (v.driver && b & Button.Jump && Math.abs(forwardSpeed) < 2) {
        const up = rot(body.rotation(), [0, 1, 0]);
        if (up[1] < 0.4) {
          const q = body.rotation();
          const fwd = rot(q, [0, 0, -1]);
          const yaw = Math.atan2(-fwd[0], -fwd[2]);
          const t = body.translation();
          body.setTranslation({ x: t.x, y: t.y + 1.5, z: t.z }, true);
          body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }
  }

  /** Después del paso de física: conductores al asiento y atropellos. */
  afterStep(): void {
    const now = Date.now();
    for (const v of this.vehicles.values()) {
      if (v.driver) this.placeDriver(v);
      const body = v.prop.body;
      if (body.isSleeping()) continue;
      const lv = body.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      if (speed < RUN_OVER_SPEED) continue;
      const t = body.translation();
      const q = body.rotation();
      for (const p of this.host.players.values()) {
        if (p.dead || !p.socket || p.vehicle || now - p.runOverAt < RUN_OVER_COOLDOWN_MS) continue;
        // Posición del jugador en el espacio del chasis: ¿dentro de la caja ampliada?
        const l = rot(q, [p.move.x - t.x, p.move.y - t.y, p.move.z - t.z], true);
        const m = PLAYER_RADIUS + 0.15;
        if (Math.abs(l[0]) > v.half[0] + m || Math.abs(l[2]) > v.half[2] + m || Math.abs(l[1]) > v.half[1] + PLAYER_HALF_HEIGHT + 0.6) continue;
        p.runOverAt = now;
        p.move.vx = lv.x * 0.9;
        p.move.vy = 5 + Math.max(0, lv.y);
        p.move.vz = lv.z * 0.9;
        p.move.grounded = false;
        p.move.coyote = 0;
        this.host.damage(p, (speed - RUN_OVER_SPEED + 2) * 6, v.driver, WEAPON_VEHICLE, v3(t));
      }
    }
  }

  /** Coloca la cápsula del conductor en el asiento. */
  private placeDriver(v: Vehicle): void {
    const p = v.driver!;
    const body = v.prop.body;
    const t = body.translation();
    const s = rot(body.rotation(), v.spec.seat);
    const lv = body.linvel();
    const m = p.move;
    m.x = t.x + s[0];
    m.y = t.y + s[1];
    m.z = t.z + s[2];
    m.vx = lv.x;
    m.vy = lv.y;
    m.vz = lv.z;
    m.grounded = true;
    p.body.setNextKinematicTranslation({ x: m.x, y: m.y, z: m.z });
  }
}
