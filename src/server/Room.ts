import RAPIER from '@dimforge/rapier3d-compat';
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  CHAT_MAX_LENGTH, CHAT_RATE_COUNT, CHAT_RATE_WINDOW_MS, FULL_SNAPSHOT_EVERY, GRAVITY,
  INPUT_STARVE_TICKS, KILL_Y, MAX_INPUT_QUEUE, MAX_INPUTS_PER_TICK,
  MAX_PLAYERS_PER_ROOM, PING_INTERVAL_MS, PLAYER_COLORS, PLAYER_EYE_HEIGHT, PLAYER_HALF_HEIGHT, PLAYER_MASS,
  PLAYER_MAX_HEALTH, PLAYER_PUSH_STRENGTH, PLAYER_RADIUS, RECONNECT_GRACE_MS, SNAPSHOT_RATE,
  SPAWN_COOLDOWN_MS, TICK_DT, TICK_RATE,
} from '../shared/constants';
import {
  Button, WEAPON_FALL, type ErrorCode, type LeaveReason, type PlayerInfo, type ServerMessage, type Vec3,
} from '../shared/protocol';
import type { InputFrame } from '../shared/input';
import { createMoveState, stepPlayer, type PushContact } from '../shared/playerController';
import type { Shape } from '../shared/collision';
import { encodeSnapshot, type PlayerState, type PropState } from '../shared/snapshot';
import { aimDirection, createFireState } from '../shared/weapons';
import { getMap, partQuat, staticShapes, type MapDef } from '../content/maps';
import { getMode, validKillLimit } from '../content/modes';
import { WEAPONS } from '../content/weapons';
import { capsuleContact, partRotation, quatMul, type Contact } from '../shared/collision';
import { DEFAULT_TOOL, PAINT_COLORS } from '../content/tools';
import { sanitizeLook } from '../content/cosmetics';
import { Combat, HISTORY_LENGTH } from './Combat';
import { Constraints } from './Constraints';
import { GameMode } from './GameMode';
import { PropSystem } from './PropSystem';
import { ToolSystem } from './tools';
import { Vehicles } from './Vehicles';
import { PLAYER_GROUPS, type CombatHost, type ServerPlayer, type ServerProp } from './types';

export type JoinResult = { ok: true; id: number } | { ok: false; code: ErrorCode; message: string };

const SNAPSHOT_INTERVAL = Math.round(TICK_RATE / SNAPSHOT_RATE);
const STATS_INTERVAL = Math.round((PING_INTERVAL_MS / 1000) * TICK_RATE);
/**
 * Por encima de esto el socket va atrasado (conexión lenta): se salta un snapshot en vez de
 * acumular. Antes era 256 KB, que con una subida lenta suponía segundos de retraso para ese
 * jugador; 48 KB son unos pocos snapshots grandes.
 */
const MAX_BUFFERED_BYTES = 48 * 1024;

export class Room implements CombatHost {
  readonly map: MapDef;
  readonly world: RAPIER.World;
  readonly players = new Map<number, ServerPlayer>();
  readonly propSystem: PropSystem;
  readonly constraints: Constraints;
  private tools: ToolSystem;
  readonly mode: GameMode;
  /** Altura por debajo de la cual se muere (depende del mapa: en la Isla, el mar). */
  private killY: number;
  private vehicles: Vehicles;
  /** Cuerpo fijo del suelo (referencia para soldar o atar al mundo). */
  private ground!: RAPIER.RigidBody;
  private combat: Combat;
  private staticShapes: Shape[];
  private hostId = -1;
  private banned = new Set<string>();
  tick = 0;
  private snapshotCount = 0;
  private spawnShapes: Shape[] = [];
  private spawnContact: Contact = { nx: 0, ny: 0, nz: 0, depth: 0 };
  /** Formas de colisión de este tick (estáticas + objetos + jugadores), reutilizadas. */
  private shapes: Shape[] = [];
  private pushes: PushContact[] = [];

  constructor(readonly code: string, mapId?: string, modeId?: unknown, killLimit?: unknown) {
    this.map = getMap(mapId);
    this.killY = this.map.killY ?? KILL_Y;
    const modeDef = getMode(modeId);
    this.mode = new GameMode(modeDef, validKillLimit(modeDef, killLimit), {
      players: this.players,
      broadcast: (m) => this.broadcast(m),
      resetRound: () => this.resetRound(),
    });
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = TICK_DT;
    this.staticShapes = staticShapes(this.map);
    this.combat = new Combat(this);
    this.vehicles = new Vehicles({
      world: this.world,
      players: this.players,
      damage: (t, a, by, w, from) => this.combat.damage(t, a, by, w, from),
    });
    this.propSystem = new PropSystem({
      world: this.world,
      broadcast: (m) => this.broadcast(m),
      onPropCreated: (prop) => {
        if (prop.def.vehicle) this.vehicles.add(prop);
      },
      onPropRemoved: (prop) => {
        for (const p of this.players.values()) {
          if (p.heldProp === prop.id) this.combat.drop(p);
          if (p.toolStage?.prop === prop.id) p.toolStage = null;
        }
        this.constraints.onPropRemoved(prop.id);
        if (prop.def.vehicle) this.vehicles.remove(prop);
      },
    });
    this.buildStatic();
    const room = this;
    this.constraints = new Constraints({
      world: this.world,
      get props() { return room.props; },
      ground: this.ground,
      broadcast: (m) => this.broadcast(m),
    });
    this.tools = new ToolSystem({
      world: this.world,
      propSystem: this.propSystem,
      constraints: this.constraints,
      isHost: (p) => p.info.id === this.hostId,
      send: (p, m) => this.send(p, m),
      broadcast: (m, except) => this.broadcast(m, except),
      drop: (p) => this.combat.drop(p),
    }, this.players);
    this.createMapProps(false);
  }

  get props(): Map<number, ServerProp> {
    return this.propSystem.props;
  }

  /** Jugadores conectados o con hueco reservado. */
  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.socket) n++;
    return n;
  }

  private buildStatic(): void {
    const half = this.map.groundSize / 2;
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(half, 0.5, half), ground);
    this.ground = ground;
    // Piezas del mapa: un colisionador fijo por pieza sólida, con su rotación.
    const statics = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const p of this.map.parts) {
      if (p.solid === false) continue;
      let desc: RAPIER.ColliderDesc;
      switch (p.kind) {
        case 'box': desc = RAPIER.ColliderDesc.cuboid(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2); break;
        case 'ball': desc = RAPIER.ColliderDesc.ball(p.radius); break;
        case 'cylinder': desc = RAPIER.ColliderDesc.cylinder(p.height / 2, p.radius); break;
        case 'cone': desc = RAPIER.ColliderDesc.cone(p.height / 2, p.radius); break;
      }
      const axis = partRotation(p);
      const q = axis ? quatMul(partQuat(p), axis) : partQuat(p);
      desc.setTranslation(...p.pos).setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
      this.world.createCollider(desc, statics);
    }
  }

  /** Objetos iniciales del mapa (al crear la sala y en cada ronda nueva). */
  private createMapProps(announce: boolean): void {
    for (const p of this.map.props) {
      const prop = this.propSystem.create(p.type, p.pos, undefined, -1, 0xffffff, 0, true);
      if (prop && announce) this.broadcast({ t: 'prop_added', prop: this.propSystem.info(prop) });
    }
  }

  /** Ronda nueva (Deathmatch): marcadores a cero, todos reaparecen y el mapa vuelve a su estado inicial. */
  private resetRound(): void {
    // Los cohetes en vuelo de la ronda anterior no deben explotar en la nueva.
    this.combat.reset();
    for (const id of [...this.props.keys()]) this.propSystem.remove(id);
    this.createMapProps(true);
    for (const p of this.players.values()) {
      p.info.kills = 0;
      p.info.deaths = 0;
      this.exitVehicle(p);
      this.combat.drop(p);
      if (p.socket) this.combat.respawn(p);
    }
  }

  canDamage(): boolean {
    return this.mode.canDamage;
  }

  onKill(killer: ServerPlayer | null): void {
    this.mode.onKill(killer);
  }

  propByBody(handle: number): ServerProp | undefined {
    return this.propSystem.byBodyHandle(handle);
  }

  removeProp(id: number): void {
    this.propSystem.remove(id);
  }

  exitVehicle(p: ServerPlayer): void {
    if (p.vehicle) this.vehicles.exit(p);
  }

  toolInput(p: ServerPlayer, input: InputFrame, primary: boolean, secondary: boolean, pressed: number): void {
    if (this.mode.building) this.tools.onInput(p, input, primary, secondary, pressed);
  }

  /** Herramienta elegida en el menú (mensaje JSON del cliente). */
  selectTool(id: number, tool: unknown, color: unknown): void {
    const p = this.players.get(id);
    if (p) this.tools.select(p, tool, color);
  }

  /**
   * Punto de aparición para `self` (o para un jugador nuevo). Se descartan los puntos tapados
   * por objetos y los que tienen a otro jugador encima (con 4–6 jugadores, dos podían aparecer
   * en el mismo sitio y salir despedidos). En Deathmatch, el más alejado de los demás; si no,
   * uno libre al azar.
   */
  randomSpawn(self?: ServerPlayer): Vec3 {
    const others = [...this.players.values()].filter((p) => p !== self && p.socket && !p.dead);
    this.spawnShapes.length = 0;
    this.propSystem.addShapes(this.spawnShapes);
    const scored = this.map.spawnPoints.map((s) => ({
      s,
      near: others.length ? Math.min(...others.map((p) => Math.hypot(p.move.x - s[0], p.move.z - s[2]))) : 1e9,
      blocked: this.spawnBlocked(s),
    }));
    const free = scored.filter((x) => !x.blocked);
    const pool = free.length ? free : scored;
    let pick: (typeof scored)[number];
    if (this.mode.def.id === 'deathmatch') {
      // El más alejado (con un poco de azar para desempatar).
      pick = pool.reduce((a, b) => (b.near + Math.random() * 0.5 > a.near ? b : a));
    } else {
      const roomy = pool.filter((x) => x.near > 2.5);
      pick = roomy.length ? roomy[Math.floor(Math.random() * roomy.length)] : pool.reduce((a, b) => (b.near > a.near ? b : a));
    }
    return [pick.s[0], pick.s[1], pick.s[2]];
  }

  /** ¿Hay un objeto donde aparecería la cápsula (en el aire o ya apoyada en el suelo)? */
  private spawnBlocked(s: Vec3): boolean {
    for (const dy of [0, -0.9]) {
      for (const sh of this.spawnShapes) {
        if (capsuleContact(s[0], s[1] + dy, s[2], sh, this.spawnContact) && this.spawnContact.depth > 0.05) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- jugadores

  addPlayer(socket: WebSocket, name: string, clientId: string, look?: unknown): JoinResult {
    if (this.banned.has(clientId)) return { ok: false, code: 'banned', message: 'Has sido expulsado de esta sala.' };
    if (this.players.size >= MAX_PLAYERS_PER_ROOM) return { ok: false, code: 'room_full', message: 'La sala está llena.' };
    // Primer hueco libre: determina id y color.
    let id = 0;
    while (this.players.has(id)) id++;

    const spawn = this.randomSpawn();
    // Cuerpo cinemático: lo mueve el controlador compartido; Rapier solo lo usa para que
    // los objetos choquen con el jugador.
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...spawn));
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS).setCollisionGroups(PLAYER_GROUPS), body,
    );

    const info: PlayerInfo = {
      id, name, color: PLAYER_COLORS[id % PLAYER_COLORS.length], connected: true, kills: 0, deaths: 0,
      look: sanitizeLook(look),
    };
    const player: ServerPlayer = {
      info, token: randomBytes(16).toString('hex'), clientId, socket, disconnectedAt: 0,
      body, collider, move: createMoveState(...spawn),
      inputQueue: [], lastInput: idleInput(0, 0), lastAppliedSeq: 0,
      starvedTicks: 0, rtt: 0, chatTimes: [],
      health: PLAYER_MAX_HEALTH, dead: false, respawnAt: 0, protectedUntil: 0,
      fire: createFireState(), heldProp: 0, holdDistance: 0,
      history: Array.from({ length: HISTORY_LENGTH }, () => ({ tick: -1, x: 0, y: 0, z: 0, alive: false })),
      vehicle: 0, prevButtons: 0, lastSpawnAt: 0, lastLookAt: 0, runOverAt: 0,
      tool: DEFAULT_TOOL, toolColor: PAINT_COLORS[0], toolStage: null, holdMode: 'gravity', holdRot: [0, 0, 0, 1],
    };

    this.broadcast({ t: 'player_joined', player: info });
    this.players.set(id, player);
    if (this.hostId < 0) this.hostId = id;
    this.sendWelcome(player);
    return { ok: true, id };
  }

  /** Reconexión al hueco reservado identificado por el token. */
  resumePlayer(socket: WebSocket, token: string): JoinResult {
    const p = [...this.players.values()].find((pl) => pl.token === token);
    if (!p) return { ok: false, code: 'session_invalid', message: 'La sesión ha caducado.' };
    if (p.socket && p.socket.readyState === p.socket.OPEN) {
      return { ok: false, code: 'session_in_use', message: 'Esa sesión sigue abierta en otra pestaña.' };
    }
    p.socket = socket;
    p.info.connected = true;
    p.collider.setEnabled(!p.dead);
    // El cliente empieza de nuevo la numeración de inputs.
    p.inputQueue.length = 0;
    p.lastAppliedSeq = 0;
    p.prevButtons = 0;
    p.lastInput = idleInput(p.lastInput.yaw, p.lastInput.pitch, p.fire.weapon);
    this.sendWelcome(p);
    this.broadcast({ t: 'player_status', id: p.info.id, connected: true }, p.info.id);
    return { ok: true, id: p.info.id };
  }

  private sendWelcome(p: ServerPlayer): void {
    this.send(p, {
      t: 'welcome',
      playerId: p.info.id,
      hostId: this.hostId,
      token: p.token,
      roomCode: this.code,
      map: this.map.id,
      players: [...this.players.values()].map((pl) => pl.info),
      props: [...this.props.values()].map((pr) => this.propSystem.info(pr)),
      mode: this.mode.info,
      constraints: this.constraints.constraintList,
      thrusters: this.constraints.thrusterList,
    });
  }

  /** El socket se cerró sin "leave": se reserva el hueco durante RECONNECT_GRACE_MS. */
  disconnectPlayer(id: number, socket: WebSocket): boolean {
    const p = this.players.get(id);
    if (!p || p.socket !== socket) return false; // ya reconectado con otro socket, o ya eliminado
    this.exitVehicle(p);
    p.socket = null;
    p.info.connected = false;
    p.disconnectedAt = Date.now();
    p.collider.setEnabled(false);
    p.inputQueue.length = 0;
    this.combat.drop(p);
    this.broadcast({ t: 'player_status', id, connected: false });
    return true;
  }

  /** Salida definitiva: también se borran sus objetos. */
  removePlayer(id: number, reason: LeaveReason): void {
    const p = this.players.get(id);
    if (!p) return;
    this.exitVehicle(p);
    this.combat.drop(p);
    this.world.removeRigidBody(p.body);
    this.players.delete(id);
    this.broadcast({ t: 'player_left', id, reason });
    this.propSystem.clearOwner(id);
    if (id === this.hostId) this.pickNewHost();
  }

  private pickNewHost(): void {
    const candidates = [...this.players.values()].sort(
      (a, b) => Number(!!b.socket) - Number(!!a.socket) || a.info.id - b.info.id,
    );
    this.hostId = candidates[0]?.info.id ?? -1;
    if (this.hostId >= 0) this.broadcast({ t: 'host_changed', id: this.hostId });
  }

  kick(byId: number, targetId: number): void {
    const by = this.players.get(byId);
    if (!by) return;
    if (byId !== this.hostId) return this.sendError(by, 'not_host', 'Solo el anfitrión puede expulsar.');
    const target = this.players.get(targetId);
    if (!target || targetId === byId) return;
    this.banned.add(target.clientId);
    if (target.socket) this.send(target, { t: 'kicked' });
    const socket = target.socket;
    this.removePlayer(targetId, 'kicked');
    socket?.close(4001, 'kicked');
  }

  chat(id: number, raw: unknown): void {
    const p = this.players.get(id);
    if (!p || typeof raw !== 'string') return;
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    const now = Date.now();
    p.chatTimes = p.chatTimes.filter((t) => now - t < CHAT_RATE_WINDOW_MS);
    if (p.chatTimes.length >= CHAT_RATE_COUNT) {
      return this.sendError(p, 'rate_limited', 'Vas demasiado rápido, espera un momento.');
    }
    p.chatTimes.push(now);
    this.broadcast({ t: 'chat', from: id, text });
  }

  /** Cambio de aspecto desde el editor de personaje (validado y como mucho 2 por segundo). */
  setLook(id: number, raw: unknown): void {
    const p = this.players.get(id);
    if (!p) return;
    const now = Date.now();
    if (now - p.lastLookAt < 500) return this.sendError(p, 'rate_limited', 'Espera un momento antes de volver a cambiar de aspecto.');
    p.lastLookAt = now;
    p.info.look = sanitizeLook(raw);
    this.broadcast({ t: 'player_look', id, look: p.info.look });
  }

  ping(id: number, n: unknown, rtt: unknown): void {
    const p = this.players.get(id);
    if (!p || typeof n !== 'number') return;
    if (typeof rtt === 'number' && Number.isFinite(rtt)) p.rtt = Math.max(0, Math.min(9999, Math.round(rtt)));
    this.send(p, { t: 'pong', n });
  }

  // ---------------------------------------------------------------- objetos (menú de spawn)

  /** Crea un objeto del menú donde apunta el jugador (validado: vivo, cadencia y límites). */
  spawn(id: number, raw: unknown): void {
    const p = this.players.get(id);
    if (!p || typeof raw !== 'string' || p.dead) return;
    if (!this.mode.building) return this.sendError(p, 'not_allowed', `El menú de objetos no está disponible en ${this.mode.def.name}.`);
    const now = Date.now();
    if (now - p.lastSpawnAt < SPAWN_COOLDOWN_MS) return;
    p.lastSpawnAt = now;
    const m = p.move;
    const res = this.propSystem.spawn(
      id, raw, [m.x, m.y + PLAYER_EYE_HEIGHT, m.z], aimDirection(p.lastInput.yaw, p.lastInput.pitch), p.lastInput.yaw,
    );
    if (!res.ok) this.sendError(p, 'limit_reached', res.message);
  }

  undo(id: number): void {
    if (this.players.has(id)) this.propSystem.undo(id);
  }

  clearProps(id: number): void {
    if (this.players.has(id)) this.propSystem.clearOwner(id);
  }

  handleInput(id: number, input: InputFrame): void {
    const p = this.players.get(id);
    if (!p || !p.socket) return;
    const lastQueued = p.inputQueue.length ? p.inputQueue[p.inputQueue.length - 1].seq : p.lastAppliedSeq;
    if (input.seq <= lastQueued) return; // duplicado o desordenado
    p.inputQueue.push(input);
    if (p.inputQueue.length > MAX_INPUT_QUEUE) p.inputQueue.shift();
  }

  // ---------------------------------------------------------------- simulación

  /** Formas para el controlador: estáticas + objetos + jugadores a pie. */
  private buildShapes(): void {
    const shapes = this.shapes;
    shapes.length = 0;
    for (const s of this.staticShapes) shapes.push(s);
    this.propSystem.addShapes(shapes);
    for (const p of this.players.values()) {
      if (!p.socket || p.dead || p.vehicle) continue;
      const m = p.move;
      shapes.push({ kind: 'capsule', x: m.x, y: m.y, z: m.z, half: PLAYER_HALF_HEIGHT, r: PLAYER_RADIUS, playerId: p.info.id });
    }
  }

  /**
   * Aplica los inputs pendientes del jugador: uno por tick normalmente, hasta
   * MAX_INPUTS_PER_TICK si llegaron en ráfaga. Cada input avanza exactamente un tick del
   * controlador, igual que en el cliente, así la predicción coincide.
   */
  private simulatePlayer(p: ServerPlayer): void {
    if (!p.socket) return;
    let processed = 0;
    while (p.inputQueue.length && processed < MAX_INPUTS_PER_TICK) {
      const input = p.inputQueue.shift()!;
      // Armas que el modo no permite (tool gun en Deathmatch): se ignora el cambio.
      if (!this.mode.building && WEAPONS[input.weapon]?.tool) input.weapon = p.fire.weapon;
      const pressed = input.buttons & ~p.prevButtons;
      p.prevButtons = input.buttons;
      p.lastInput = input;
      p.lastAppliedSeq = input.seq;
      processed++;
      // Muerto: se confirman los inputs (para que el cliente no los repita) pero no se aplican.
      if (p.dead) continue;
      if (pressed & Button.Use) {
        this.combat.drop(p);
        this.vehicles.use(p);
      }
      // Conduciendo: los botones los lee el vehículo; el jugador no se mueve ni dispara.
      if (p.vehicle) continue;
      stepPlayer(p.move, input.buttons, input.yaw, this.shapes, p.info.id, this.pushes, p.heldProp);
      this.combat.onInput(p, input, pressed);
    }
    if (processed > 0) {
      p.starvedTicks = 0;
    } else if (++p.starvedTicks > INPUT_STARVE_TICKS && !p.dead && !p.vehicle) {
      // Sin inputs durante un rato (pestaña oculta, lag): seguir simulando sin botones.
      stepPlayer(p.move, 0, p.lastInput.yaw, this.shapes, p.info.id, undefined, p.heldProp);
    }
    if (p.dead || p.vehicle) return;

    if (p.move.y < this.killY) {
      this.combat.kill(p, null, WEAPON_FALL);
      return;
    }
    p.body.setNextKinematicTranslation({ x: p.move.x, y: p.move.y, z: p.move.z });
  }

  /** Convierte los choques jugador→objeto en impulsos horizontales. */
  private applyPushes(): void {
    // Un solo empujón por objeto y tick (el más fuerte).
    const best = new Map<number, PushContact>();
    for (const c of this.pushes) {
      const prev = best.get(c.propId);
      if (!prev || c.speed > prev.speed) best.set(c.propId, c);
    }
    this.pushes.length = 0;
    for (const c of best.values()) {
      const prop = this.props.get(c.propId);
      if (!prop) continue;
      const v = prop.body.linvel();
      const rel = c.speed - (v.x * c.dx + v.z * c.dz);
      if (rel <= 0) continue;
      // Los objetos ligeros se mueven casi a la velocidad del jugador; los pesados, menos.
      const j = Math.min(prop.body.mass(), PLAYER_MASS) * rel * PLAYER_PUSH_STRENGTH;
      prop.body.applyImpulse({ x: c.dx * j, y: 0, z: c.dz * j }, true);
    }
  }

  step(): void {
    this.buildShapes();
    for (const p of this.players.values()) this.simulatePlayer(p);
    this.mode.update();
    this.combat.update();
    this.vehicles.update();
    this.constraints.update();
    this.applyPushes();
    this.world.step();
    this.tick++;
    this.vehicles.afterStep();
    this.combat.recordHistory();

    for (const prop of [...this.props.values()]) {
      if (prop.body.translation().y < this.killY - 5) this.propSystem.remove(prop.id);
    }

    // Huecos reservados caducados.
    const now = Date.now();
    for (const p of [...this.players.values()]) {
      if (!p.socket && now - p.disconnectedAt > RECONNECT_GRACE_MS) this.removePlayer(p.info.id, 'timeout');
    }

    if (this.tick % SNAPSHOT_INTERVAL === 0) this.sendSnapshot();
    if (this.tick % STATS_INTERVAL === 0) {
      this.broadcast({ t: 'stats', pings: [...this.players.values()].map((p) => [p.info.id, p.rtt]) });
    }
  }

  private sendSnapshot(): void {
    const full = this.snapshotCount++ % FULL_SNAPSHOT_EVERY === 0;

    const players: PlayerState[] = [];
    for (const p of this.players.values()) {
      if (!p.socket) continue;
      players.push({
        ...p.move, id: p.info.id, yaw: p.lastInput.yaw, pitch: p.lastInput.pitch, lastInputSeq: p.lastAppliedSeq,
        health: p.health, dead: p.dead, weapon: p.fire.weapon, heldProp: p.heldProp, holdDistance: p.holdDistance,
        vehicle: p.vehicle,
      });
    }

    // Solo props despiertos (o que se acaban de dormir); todos en los snapshots completos.
    const props: PropState[] = [];
    for (const prop of this.props.values()) {
      // Los congelados (cuerpo fijo) no se mueven: cuentan como dormidos.
      const sleeping = prop.body.isSleeping() || prop.body.isFixed();
      if (!full && sleeping && !prop.sentAwake) continue;
      prop.sentAwake = !sleeping;
      const t = prop.body.translation();
      const r = prop.body.rotation();
      props.push({ id: prop.id, x: t.x, y: t.y, z: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w, sleeping });
    }

    const buf = encodeSnapshot({ tick: this.tick, players, props });
    for (const p of this.players.values()) {
      if (p.socket && p.socket.readyState === p.socket.OPEN && p.socket.bufferedAmount < MAX_BUFFERED_BYTES) {
        p.socket.send(buf);
      }
    }
  }

  send(p: ServerPlayer, msg: ServerMessage): void {
    if (p.socket && p.socket.readyState === p.socket.OPEN) p.socket.send(JSON.stringify(msg));
  }

  private sendError(p: ServerPlayer, code: ErrorCode, message: string): void {
    this.send(p, { t: 'error', code, message });
  }

  broadcast(msg: ServerMessage, exceptId = -1): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.info.id !== exceptId && p.socket && p.socket.readyState === p.socket.OPEN) p.socket.send(data);
    }
  }

  dispose(): void {
    this.world.free();
  }
}

function idleInput(yaw: number, pitch: number, weapon = 0): InputFrame {
  return { seq: 0, buttons: 0, yaw, pitch, weapon, viewTick: 0, wheel: 0 };
}
