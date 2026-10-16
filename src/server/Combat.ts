import RAPIER from '@dimforge/rapier3d-compat';
import { WEAPONS, type GravitySpec, type ProjectileSpec, type WeaponDef } from '../content/weapons';
import { pointCapsuleDistance, rayCapsule } from '../shared/collision';
import {
  HEADSHOT_HEIGHT, MAX_LAG_COMPENSATION_MS, PLAYER_EYE_HEIGHT, PLAYER_HALF_HEIGHT, PLAYER_MAX_HEALTH,
  PLAYER_RADIUS, RESPAWN_MS, SPAWN_PROTECTION_MS, TICK_DT, TICK_RATE,
} from '../shared/constants';
import type { InputFrame } from '../shared/input';
import { createMoveState } from '../shared/playerController';
import { WEAPON_EXPLOSION, type Vec3 } from '../shared/protocol';
import { aimDirection, gravityAction, pelletDirections, stepFire } from '../shared/weapons';
import type { CombatHost, HistoryEntry, ServerPlayer, ServerProp } from './types';

export const HISTORY_LENGTH = 32;
const MAX_REWIND_TICKS = Math.round((MAX_LAG_COMPENSATION_MS / 1000) * TICK_RATE);
/** Los rayos de disparo ignoran los cuerpos cinemáticos (jugadores): esos se comprueban aparte. */
const WORLD_ONLY = RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
/** Cambio de velocidad máximo que una explosión da a un objeto (evita que salgan disparados al infinito). */
const MAX_EXPLOSION_DV = 25;
const HOLD_STIFFNESS = 12;
const HOLD_MAX_SPEED = 45;
/** Si el objeto sujeto se queda atascado más lejos de esto (p. ej. tras una pared), se suelta. */
const HOLD_BREAK_DISTANCE = 12;

const enum HitKind { World = 0, Player = 1, Prop = 2, None = 3 }

interface TraceResult {
  kind: HitKind;
  x: number;
  y: number;
  z: number;
  player?: ServerPlayer;
  prop?: ServerProp;
  headshot: boolean;
}

/** Parámetros de una explosión (de un cohete o de un bidón). */
interface Blast {
  radius: number;
  damage: number;
  impulse: number;
  knockback: number;
  selfDamage: number;
}

/** Bidón reventado que explotará en unos ticks (las reacciones en cadena se ven mejor escalonadas). */
interface PendingBlast {
  ticks: number;
  pos: Vec3;
  blast: Blast;
  attacker: number;
}

const CHAIN_DELAY_TICKS = 6;

interface Projectile {
  id: number;
  owner: number;
  weapon: number;
  spec: ProjectileSpec;
  x: number;
  y: number;
  z: number;
  dir: Vec3;
  ticksLeft: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Armas en el servidor: valida y aplica disparos (con compensación de lag), proyectiles,
 * explosiones, gravity gun, daño, muertes y reapariciones. Todo lo decide el servidor;
 * los clientes solo envían botones y dirección de la mirada.
 */
export class Combat {
  private projectiles: Projectile[] = [];
  private nextProjectileId = 1;
  private pendingBlasts: PendingBlast[] = [];

  constructor(private host: CombatHost) {}

  /** Procesa la parte de armas de un input (ya validado y en orden). Solo jugadores vivos. */
  onInput(p: ServerPlayer, input: InputFrame, pressed: number): void {
    const res = stepFire(p.fire, input.buttons, input.weapon);
    if (res.switched && p.heldProp) this.drop(p);
    const def = WEAPONS[p.fire.weapon];
    if (def.tool) return this.host.toolInput(p, input, res.primary, res.secondary, pressed);
    if (def.gravity) {
      const holding = p.heldProp !== 0 && p.holdMode === 'gravity';
      return this.gravityInput(p, def.gravity, input, gravityAction(input.buttons, res, holding));
    }
    if (def.hitscan && res.primary) this.fireHitscan(p, def, input);
    else if (def.projectile && res.primary) this.fireProjectile(p, def, input);
  }

  /** Ronda nueva: se descartan los cohetes en vuelo y las explosiones en cadena pendientes. */
  reset(): void {
    this.projectiles.length = 0;
    this.pendingBlasts.length = 0;
  }

  /** Por tick, antes del paso de física. */
  update(): void {
    this.updateHeld();
    this.updateProjectiles();
    this.updatePendingBlasts();
    const now = Date.now();
    for (const p of this.host.players.values()) {
      if (p.dead && p.socket && now >= p.respawnAt) this.respawn(p);
    }
  }

  /** Por tick, después del paso de física: guarda dónde estaba cada jugador. */
  recordHistory(): void {
    const tick = this.host.tick;
    for (const p of this.host.players.values()) {
      const h = p.history[tick % HISTORY_LENGTH];
      h.tick = tick;
      h.x = p.move.x;
      h.y = p.move.y;
      h.z = p.move.z;
      h.alive = !p.dead && p.socket !== null;
    }
  }

  // ------------------------------------------------------------------ disparos

  private eye(p: ServerPlayer): Vec3 {
    return [p.move.x, p.move.y + PLAYER_EYE_HEIGHT, p.move.z];
  }

  private fireHitscan(p: ServerPlayer, def: WeaponDef, input: InputFrame): void {
    const spec = def.hitscan!;
    const o = this.eye(p);
    const rewindTick = Math.max(this.host.tick - MAX_REWIND_TICKS, Math.min(this.host.tick, input.viewTick));
    const damage = new Map<ServerPlayer, number>();
    const ends: [number, number, number, number][] = [];

    for (const d of pelletDirections(def, input.yaw, input.pitch, p.info.id, input.seq)) {
      const hit = this.trace(o, d, spec.range, p, rewindTick);
      ends.push([r2(hit.x), r2(hit.y), r2(hit.z), hit.kind]);
      if (hit.player) {
        const amount = spec.damage * (hit.headshot ? spec.headshotMultiplier : 1);
        damage.set(hit.player, (damage.get(hit.player) ?? 0) + amount);
      } else if (hit.prop) {
        const j = spec.impulse;
        hit.prop.body.applyImpulseAtPoint({ x: d[0] * j, y: d[1] * j, z: d[2] * j }, { x: hit.x, y: hit.y, z: hit.z }, true);
        this.damageProp(hit.prop, spec.damage, p);
      }
    }
    for (const [target, amount] of damage) this.damage(target, amount, p, WEAPONS.indexOf(def), o);
    this.host.broadcast({ t: 'shot', by: p.info.id, w: WEAPONS.indexOf(def), o: o.map(r2) as Vec3, e: ends }, p.info.id);
  }

  /**
   * Rayo contra el mundo (Rapier, sin jugadores) y contra las cápsulas de los demás
   * jugadores tal y como estaban en `rewindTick` (lo que veía el que dispara).
   */
  private trace(o: Vec3, d: Vec3, range: number, shooter: ServerPlayer | null, rewindTick: number): TraceResult {
    let maxT = range;
    let kind = HitKind.None;
    let prop: ServerProp | undefined;
    let player: ServerPlayer | undefined;
    let headshot = false;

    const ray = new RAPIER.Ray({ x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] });
    const hit = this.host.world.castRay(ray, range, true, WORLD_ONLY);
    if (hit) {
      maxT = hit.timeOfImpact;
      const body = hit.collider.parent();
      prop = body ? this.host.propByBody(body.handle) : undefined;
      kind = prop ? HitKind.Prop : HitKind.World;
    }

    for (const q of this.host.players.values()) {
      if (q === shooter || q.dead || !q.socket) continue;
      const pos = this.positionAt(q, rewindTick);
      if (!pos) continue;
      const t = rayCapsule(o[0], o[1], o[2], d[0], d[1], d[2], pos.x, pos.y, pos.z, PLAYER_HALF_HEIGHT, PLAYER_RADIUS, maxT);
      if (t !== null && t < maxT) {
        maxT = t;
        kind = HitKind.Player;
        player = q;
        prop = undefined;
        headshot = o[1] + d[1] * t - pos.y > HEADSHOT_HEIGHT;
      }
    }
    return {
      kind, player, prop, headshot,
      x: o[0] + d[0] * maxT, y: o[1] + d[1] * maxT, z: o[2] + d[2] * maxT,
    };
  }

  /** Posición del jugador en un tick pasado (o la actual si no hay histórico de ese tick). */
  private positionAt(p: ServerPlayer, tick: number): HistoryEntry | { x: number; y: number; z: number } | null {
    const h = p.history[tick % HISTORY_LENGTH];
    if (h.tick === tick) return h.alive ? h : null;
    return p.move;
  }

  private fireProjectile(p: ServerPlayer, def: WeaponDef, input: InputFrame): void {
    const spec = def.projectile!;
    const o = this.eye(p);
    const dir = aimDirection(input.yaw, input.pitch);
    const proj: Projectile = {
      id: this.nextProjectileId++, owner: p.info.id, weapon: WEAPONS.indexOf(def), spec,
      x: o[0], y: o[1], z: o[2], dir, ticksLeft: Math.round(spec.lifetime * TICK_RATE),
    };
    this.projectiles.push(proj);
    this.host.broadcast({
      t: 'projectile', id: proj.id, by: p.info.id, w: proj.weapon,
      pos: o.map(r2) as Vec3, dir, tick: this.host.tick,
    });
  }

  private updateProjectiles(): void {
    this.projectiles = this.projectiles.filter((pr) => {
      const step = pr.spec.speed * TICK_DT;
      const owner = this.host.players.get(pr.owner) ?? null;
      // Barrido del tramo de este tick contra mundo y jugadores (salvo el que disparó).
      const hit = this.trace([pr.x, pr.y, pr.z], pr.dir, step, owner, this.host.tick);
      if (hit.kind !== HitKind.None) {
        // Explota un poco antes de la superficie para no quedar "dentro" de la pared.
        this.explodeProjectile(pr, hit.x - pr.dir[0] * 0.1, hit.y - pr.dir[1] * 0.1, hit.z - pr.dir[2] * 0.1);
        return false;
      }
      pr.x = hit.x;
      pr.y = hit.y;
      pr.z = hit.z;
      if (--pr.ticksLeft <= 0) {
        this.explodeProjectile(pr, pr.x, pr.y, pr.z);
        return false;
      }
      return true;
    });
  }

  private explodeProjectile(pr: Projectile, x: number, y: number, z: number): void {
    const { spec } = pr;
    this.explodeAt([x, y, z], {
      radius: spec.explosionRadius, damage: spec.damage, impulse: spec.impulse, knockback: spec.knockback, selfDamage: spec.selfDamage,
    }, this.host.players.get(pr.owner) ?? null, pr.weapon, pr.id);
  }

  /**
   * Explosión: daño y empujón a jugadores (con caída lineal hasta el borde), impulso a objetos
   * y daño a otros objetos explosivos (reacción en cadena).
   */
  explodeAt(pos: Vec3, b: Blast, owner: ServerPlayer | null, weapon: number, id = 0): void {
    const [x, y, z] = pos;
    const R = b.radius;
    this.host.broadcast({ t: 'explode', id, pos: [r2(x), r2(y), r2(z)], w: weapon, r: R });

    for (const q of this.host.players.values()) {
      if (q.dead || !q.socket) continue;
      const m = q.move;
      const dist = pointCapsuleDistance(x, y, z, m.x, m.y, m.z, PLAYER_HALF_HEIGHT, PLAYER_RADIUS);
      if (dist >= R) continue;
      const f = 1 - dist / R;
      // Empujón alejándose de la explosión (con un extra hacia arriba: rocket jumps).
      if (!q.vehicle) {
        let dx = m.x - x, dy = m.y - y, dz = m.z - z;
        const len = Math.hypot(dx, dy, dz) || 1;
        dx /= len; dy /= len; dz /= len;
        m.vx += dx * b.knockback * f;
        m.vy += dy * b.knockback * f + 3 * f;
        m.vz += dz * b.knockback * f;
        m.grounded = false;
        m.coyote = 0;
      }
      this.damage(q, b.damage * f * (q === owner ? b.selfDamage : 1), owner, weapon, [r2(x), r2(y), r2(z)]);
    }

    for (const prop of [...this.host.props.values()]) {
      const t = prop.body.translation();
      let dx = t.x - x, dy = t.y - y, dz = t.z - z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist >= R) continue;
      const f = 1 - dist / R;
      const len = dist || 1;
      dx /= len; dy /= len; dz /= len;
      const mass = prop.body.mass();
      const dv = Math.min(b.impulse / mass, MAX_EXPLOSION_DV) * f;
      const j = mass * dv;
      // Aplicado un poco hacia la explosión para que además gire.
      prop.body.applyImpulseAtPoint(
        { x: dx * j, y: (dy + 0.3) * j, z: dz * j },
        { x: t.x - dx * 0.3, y: t.y - dy * 0.3, z: t.z - dz * 0.3 },
        true,
      );
      this.damageProp(prop, b.damage * f, owner);
    }
  }

  /** Daño a un objeto: solo afecta a los explosivos, que revientan al quedarse sin vida. */
  private damageProp(prop: ServerProp, amount: number, attacker: ServerPlayer | null): void {
    const ex = prop.def.explosive;
    if (!ex || prop.health <= 0) return;
    prop.health -= amount;
    if (prop.health > 0) return;
    const t = prop.body.translation();
    this.pendingBlasts.push({
      ticks: CHAIN_DELAY_TICKS, pos: [t.x, t.y, t.z], attacker: attacker?.info.id ?? -1,
      blast: { radius: ex.radius, damage: ex.damage, impulse: ex.impulse, knockback: ex.knockback, selfDamage: 1 },
    });
    this.host.removeProp(prop.id);
  }

  private updatePendingBlasts(): void {
    if (!this.pendingBlasts.length) return;
    const ready = this.pendingBlasts.filter((b) => --b.ticks <= 0);
    this.pendingBlasts = this.pendingBlasts.filter((b) => b.ticks > 0);
    for (const b of ready) this.explodeAt(b.pos, b.blast, this.host.players.get(b.attacker) ?? null, WEAPON_EXPLOSION);
  }

  // ------------------------------------------------------------------ gravity gun

  private heldBySomeone(propId: number): boolean {
    for (const p of this.host.players.values()) if (p.heldProp === propId) return true;
    return false;
  }

  /** Pistola de gravedad: agarrar, arrastrar (rueda = distancia), soltar, lanzar o empujar. */
  private gravityInput(p: ServerPlayer, g: GravitySpec, input: InputFrame, action: ReturnType<typeof gravityAction>): void {
    const o = this.eye(p);
    const d = aimDirection(input.yaw, input.pitch);

    if (p.heldProp && input.wheel) {
      p.holdDistance = clamp(p.holdDistance + input.wheel * g.wheelStep, g.minHoldDistance, g.maxHoldDistance);
    }

    switch (action) {
      case 'grab': {
        const hit = this.trace(o, d, g.grabRange, p, this.host.tick);
        const prop = hit.prop;
        // Los objetos congelados (cuerpo fijo) solo se mueven con la herramienta Mover.
        if (!prop || prop.body.isFixed() || prop.body.mass() > g.maxMass || this.heldBySomeone(prop.id)) return;
        // Se sujeta a la distancia a la que estaba (como la physgun de GMod).
        const t = prop.body.translation();
        p.heldProp = prop.id;
        p.holdMode = 'gravity';
        p.holdDistance = clamp(Math.hypot(t.x - o[0], t.y - o[1], t.z - o[2]), g.minHoldDistance, g.maxHoldDistance);
        prop.body.setGravityScale(0, true);
        return;
      }
      case 'drop':
        // Se suelta con la velocidad que llevaba: girar rápido y soltar = lanzarlo.
        return this.drop(p);
      case 'throw': {
        const prop = this.host.props.get(p.heldProp);
        this.drop(p);
        if (!prop) return;
        const speed = g.launchSpeed * Math.min(1, Math.max(0.35, 40 / prop.body.mass()));
        prop.body.setLinvel({ x: d[0] * speed, y: d[1] * speed, z: d[2] * speed }, true);
        const t = prop.body.translation();
        this.host.broadcast({ t: 'punt', by: p.info.id, o: o.map(r2) as Vec3, to: [r2(t.x), r2(t.y), r2(t.z)] });
        return;
      }
      case 'punt': {
        const hit = this.trace(o, d, g.puntRange, p, this.host.tick);
        if (hit.player) {
          const m = hit.player.move;
          m.vx += d[0] * g.playerKnockback;
          m.vy += Math.max(0, d[1]) * g.playerKnockback + 3;
          m.vz += d[2] * g.playerKnockback;
          m.grounded = false;
          m.coyote = 0;
        } else if (hit.prop) {
          const mass = hit.prop.body.mass();
          const j = mass * g.puntSpeed * Math.min(1.5, Math.max(0.3, 40 / mass));
          hit.prop.body.applyImpulseAtPoint({ x: d[0] * j, y: d[1] * j, z: d[2] * j }, { x: hit.x, y: hit.y, z: hit.z }, true);
        }
        this.host.broadcast({ t: 'punt', by: p.info.id, o: o.map(r2) as Vec3, to: [r2(hit.x), r2(hit.y), r2(hit.z)] });
        return;
      }
    }
  }

  /**
   * Lleva cada objeto sujeto hacia el punto al que apunta quien lo sujeta, a su distancia.
   * Con la pistola de gravedad el objeto puede girar; con la herramienta Mover mantiene la
   * rotación elegida (holdRot).
   */
  private updateHeld(): void {
    for (const p of this.host.players.values()) {
      if (!p.heldProp) continue;
      const prop = this.host.props.get(p.heldProp);
      const def = WEAPONS[p.fire.weapon];
      const allowed = p.holdMode === 'move' ? !!def.tool : !!def.gravity;
      if (!prop || p.dead || !p.socket || !allowed || prop.body.isFixed()) {
        this.drop(p);
        continue;
      }
      const [ex, ey, ez] = this.eye(p);
      const d = aimDirection(p.lastInput.yaw, p.lastInput.pitch);
      const dist = p.holdDistance;
      const t = prop.body.translation();
      const dx = ex + d[0] * dist - t.x, dy = ey + d[1] * dist - t.y, dz = ez + d[2] * dist - t.z;
      const len = Math.hypot(dx, dy, dz);
      if (len > HOLD_BREAK_DISTANCE) {
        this.drop(p);
        continue;
      }
      const k = Math.min(HOLD_STIFFNESS, HOLD_MAX_SPEED / Math.max(len, 1e-3));
      prop.body.setLinvel({ x: dx * k, y: dy * k, z: dz * k }, true);
      if (p.holdMode === 'move') {
        const [x, y, z, w] = p.holdRot;
        prop.body.setRotation({ x, y, z, w }, true);
        prop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      } else {
        const w = prop.body.angvel();
        prop.body.setAngvel({ x: w.x * 0.8, y: w.y * 0.8, z: w.z * 0.8 }, true);
      }
    }
  }

  drop(p: ServerPlayer): void {
    if (!p.heldProp) return;
    this.host.props.get(p.heldProp)?.body.setGravityScale(1, true);
    p.heldProp = 0;
  }

  // ------------------------------------------------------------------ vida y muerte

  damage(target: ServerPlayer, amount: number, attacker: ServerPlayer | null, weapon: number, from: Vec3): void {
    if (target.dead || !target.socket || amount <= 0 || !this.host.canDamage()) return;
    if (Date.now() < target.protectedUntil) return;
    target.health = Math.max(0, target.health - Math.round(amount));
    const msg = {
      t: 'damage' as const, target: target.info.id, by: attacker?.info.id ?? -1,
      amount: Math.round(amount), health: target.health, from,
    };
    this.host.send(target, msg);
    if (attacker && attacker !== target) this.host.send(attacker, msg);
    if (target.health <= 0) this.kill(target, attacker, weapon);
  }

  kill(victim: ServerPlayer, killer: ServerPlayer | null, weapon: number): void {
    if (victim.dead) return;
    if (victim.vehicle) this.host.exitVehicle(victim);
    victim.dead = true;
    victim.health = 0;
    victim.respawnAt = Date.now() + RESPAWN_MS;
    this.drop(victim);
    victim.collider.setEnabled(false);
    victim.info.deaths++;
    if (killer && killer !== victim) killer.info.kills++;
    const scores: [number, number, number][] = [[victim.info.id, victim.info.kills, victim.info.deaths]];
    if (killer && killer !== victim) scores.push([killer.info.id, killer.info.kills, killer.info.deaths]);
    this.host.broadcast({
      t: 'kill', victim: victim.info.id, killer: killer?.info.id ?? -1, w: weapon,
      pos: [r2(victim.move.x), r2(victim.move.y), r2(victim.move.z)], respawnMs: RESPAWN_MS, scores,
    });
    if (killer && killer !== victim) this.host.onKill(killer);
  }

  respawn(p: ServerPlayer): void {
    const s = this.host.randomSpawn(p);
    Object.assign(p.move, createMoveState(...s));
    p.body.setTranslation({ x: s[0], y: s[1], z: s[2] }, true);
    p.body.setNextKinematicTranslation({ x: s[0], y: s[1], z: s[2] });
    p.health = PLAYER_MAX_HEALTH;
    p.dead = false;
    p.protectedUntil = Date.now() + SPAWN_PROTECTION_MS;
    p.collider.setEnabled(true);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
