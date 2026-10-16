import * as THREE from 'three';
import { getMap } from '../../content/maps';
import { MODES } from '../../content/modes';
import { WEAPONS } from '../../content/weapons';
import { DEFAULT_TOOL, PAINT_COLORS, TOOL_BY_ID } from '../../content/tools';
import {
  PING_INTERVAL_MS, PLAYER_EYE_HEIGHT, PLAYER_HALF_HEIGHT, PLAYER_MAX_HEALTH, PLAYER_RADIUS, TICK_RATE,
  VEHICLE_ENTER_DISTANCE,
} from '../../shared/constants';
import { addPropShapes, type Shape } from '../../shared/collision';
import { encodeInput, type InputFrame } from '../../shared/input';
import {
  WEAPON_EXPLOSION, WEAPON_FALL, WEAPON_VEHICLE, type ModeState, type PlayerInfo, type ServerMessage,
} from '../../shared/protocol';
import { aimDirection } from '../../shared/weapons';
import type { Snapshot } from '../../shared/snapshot';
import { LocalPlayer } from '../entities/LocalPlayer';
import { PlayerModel } from '../entities/PlayerModel';
import { PropRenderer } from '../entities/PropRenderer';
import { RemotePlayer } from '../entities/RemotePlayer';
import type { Connection } from '../net/Connection';
import { ServerClock } from '../net/ServerClock';
import type { Chat } from '../ui/Chat';
import { Hud } from '../ui/Hud';
import { SpawnMenu } from '../ui/SpawnMenu';
import { ToolVisuals } from '../tools/ToolVisuals';
import { Effects } from '../weapons/Effects';
import { ViewModel } from '../weapons/ViewModel';
import { WeaponController, type HitTargets } from '../weapons/WeaponController';
import { World } from '../world/World';
import { sound } from '../audio/Sound';
import { CameraController } from './CameraController';
import { Input } from './Input';
import { Performance } from './Performance';
import { settings, type SettingsData } from './Settings';

export type Welcome = Extract<ServerMessage, { t: 'welcome' }>;

export interface GameCallbacks {
  /** El jugador pulsó "Salir de la sala". */
  onLeave: () => void;
  /** El jugador pulsó "Personalizar personaje" en la pausa. */
  onEditor: () => void;
  /** El jugador pulsó "Ajustes" en la pausa. */
  onSettings: () => void;
}

const TICK_MS = 1000 / TICK_RATE;
/** Distancia (m) hasta la que los objetos cuentan para la predicción del jugador local. */
const NEAR_PROPS_RADIUS = 14;
const TOOLGUN_SLOT = WEAPONS.find((w) => w.tool)?.slot ?? 6;

// Herramienta y color elegidos: sobreviven a una reconexión (nueva instancia de Game).
let selectedTool = DEFAULT_TOOL;
let paintColor = PAINT_COLORS[0];

/** Orquesta escena, red, predicción local, interpolación remota, cámara y UI en partida. */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  private cameraCtl: CameraController;
  private world: World;
  private props: PropRenderer;
  private remotes = new Map<number, RemotePlayer>();
  private players = new Map<number, PlayerInfo>();
  private pings = new Map<number, number>();
  private local: LocalPlayer;
  private localModel: PlayerModel;
  private input: Input;
  private hud: Hud;
  private clock = new ServerClock();
  private readonly myId: number;
  private hostId: number;
  private online = true;
  private effects: Effects;
  private viewModel = new ViewModel();
  private weapons: WeaponController;
  private hitTargets: HitTargets = { objects: [], players: new Set(), props: new Set() };
  private eye = new THREE.Vector3();
  private beamFrom = new THREE.Vector3();
  private heldTarget = new THREE.Vector3();
  private spawnMenu = new SpawnMenu();
  private mode: ModeState;
  private toolVisuals!: ToolVisuals;
  private seat = new THREE.Vector3();
  private perf: Performance;
  private unsubSettings: () => void;
  /** Estado del frame anterior para detectar cambios que suenan (pasos, aterrizar, subir a un coche...). */
  private audio = { grounded: true, airTime: 0, step: 0, vehicle: 0, held: 0 };
  private remoteAudio = new Map<number, { x: number; z: number; step: number; vehicle: number; held: number }>();
  private vehicleSpeed = new Map<number, { x: number; y: number; z: number; speed: number }>();

  private seq = 0;
  private acc = 0;
  private lastFrame = performance.now();
  private raf = 0;
  private renderPos = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private shapes: Shape[] = [];
  private stats = { frames: 0, bytes: 0, since: performance.now() };
  private pingTimer: ReturnType<typeof setInterval>;
  private pingSent = new Map<number, number>();
  private pingN = 0;
  private rtt = 0;

  constructor(
    private container: HTMLElement,
    private conn: Connection,
    welcome: Welcome,
    private chat: Chat,
    private cb: GameCallbacks,
  ) {
    this.myId = welcome.playerId;
    this.hostId = welcome.hostId;
    this.mode = welcome.mode;

    // El antialiasing solo se puede elegir al crear el renderer (se aplica al entrar en una sala).
    this.perf = new Performance();
    this.renderer = new THREE.WebGLRenderer({ antialias: this.perf.spec.antialias, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Dos pasadas por frame (mundo + arma en 1ª persona): se limpia a mano, y las estadísticas
    // de render también (si no, solo contarían la última pasada).
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);
    this.cameraCtl = new CameraController(this.camera);

    this.world = new World(this.scene, getMap(welcome.map));
    this.props = new PropRenderer(this.scene);
    for (const p of welcome.props) this.props.add(p, 0);
    for (const p of welcome.players) {
      this.players.set(p.id, p);
      if (p.id !== this.myId) this.addRemote(p);
    }

    const me = this.players.get(this.myId)!;
    this.local = new LocalPlayer(this.myId, this.collisionShapes);
    this.localModel = new PlayerModel(me.look, me.name);
    this.localModel.setLabelVisible(false);
    this.localModel.root.visible = false;
    this.scene.add(this.localModel.root);

    this.input = new Input(this.renderer.domElement);
    this.hud = new Hud(welcome.roomCode, {
      onResume: () => this.input.requestLock(),
      onLeave: () => this.cb.onLeave(),
      onKick: (p) => {
        if (confirm(`¿Expulsar a ${p.name} de la sala?`)) this.conn.send({ t: 'kick', id: p.id });
      },
      onEditor: () => this.cb.onEditor(),
      onSettings: () => this.cb.onSettings(),
    });
    this.hud.setPaused(true);
    this.hud.setHealth(PLAYER_MAX_HEALTH);
    this.refreshPlayerList();

    this.effects = new Effects(this.scene);
    this.toolVisuals = new ToolVisuals(this.scene, this.props, this.effects);
    for (const c of welcome.constraints) this.toolVisuals.addConstraint(c);
    for (const t of welcome.thrusters) this.toolVisuals.addThruster(t);
    conn.send({ t: 'tool', id: selectedTool, color: paintColor });
    this.weapons = new WeaponController({
      myId: this.myId,
      effects: this.effects,
      viewModel: this.viewModel,
      muzzle: (out) => this.cameraCtl.mode === 'third'
        ? this.localModel.muzzleWorld(out) ?? out.copy(this.camera.position)
        : this.viewModel.muzzleWorld(this.camera, out),
      hitTargets: () => this.collectHitTargets(),
      onSelect: (i) => {
        this.hud.setWeapon(i);
        this.localModel.setWeapon(i);
      },
      holding: () => this.local.heldProp !== 0 && !this.local.dead,
      toolId: () => selectedTool,
      weaponAllowed: (i) => MODES[this.mode.id].building || !WEAPONS[i]?.tool,
    });
    this.hud.setWeaponsAvailable((i) => MODES[this.mode.id].building || !WEAPONS[i]?.tool);
    this.updateModeInfo();
    if (this.mode.state === 'ended') this.showResults();
    // Rueda: cambia de arma, salvo sujetando algo con la pistola de gravedad
    // (entonces lo acerca/aleja; rueda hacia arriba = más lejos).
    this.input.onWheel = (dir) => {
      if (this.weapons.wheelControlsDistance) this.weapons.addWheel(-dir);
      else this.weapons.cycle(dir);
    };

    // Al abrir el menú de spawn se suelta el ratón, pero eso no es una pausa.
    this.input.onLockChange = (locked) => {
      this.hud.setPaused(!locked && !this.spawnMenu.isOpen);
      if (!locked) this.chat.close();
    };
    this.spawnMenu.onSpawn = (id) => this.conn.send({ t: 'spawn', id });
    this.spawnMenu.onUndo = () => this.conn.send({ t: 'undo' });
    this.spawnMenu.onClear = () => this.conn.send({ t: 'clear_props' });
    this.spawnMenu.onSelectTool = (id) => {
      selectedTool = id;
      this.conn.send({ t: 'tool', id, color: paintColor });
      this.weapons.selectSlot(TOOLGUN_SLOT);
      this.spawnMenu.setToolState(selectedTool, paintColor);
    };
    this.spawnMenu.onSelectColor = (color) => {
      paintColor = color;
      this.conn.send({ t: 'tool', id: selectedTool, color });
    };
    this.spawnMenu.setToolState(selectedTool, paintColor);
    this.spawnMenu.onClose = (relock) => {
      if (relock) this.input.requestLock();
      else this.hud.setPaused(true);
    };
    this.input.onAction = (code) => {
      if (code === 'KeyV') this.cameraCtl.toggle();
      else if (code === 'KeyT' || code === 'Enter') this.chat.open();
      else if (code.startsWith('Digit')) this.weapons.selectSlot(Number(code.slice(5)));
      else if (code === 'KeyQ') this.openSpawnMenu();
      else if (code === 'KeyZ') this.conn.send({ t: 'undo' });
    };
    this.chat.onToggle = (open) => this.input.setSuspended(open);
    this.chat.onSend = (text) => this.conn.send({ t: 'chat', text });
    this.renderer.domElement.addEventListener('click', () => this.input.requestLock());

    // Calidad gráfica: la elegida en ajustes, o la automática según los fps medidos.
    this.perf.onApply = (spec, notice) => {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, spec.pixelRatio));
      this.renderer.shadowMap.enabled = spec.shadows;
      this.world.setQuality(spec);
      this.props.setShadows(spec.propShadows);
      this.effects.density = spec.particles;
      // Activar o quitar sombras cambia los shaders: hay que recompilar los materiales.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
      this.onResize();
      if (notice) this.hud.toolMessage(notice, true);
    };
    this.unsubSettings = settings.onChange((s) => this.applySettings(s));

    conn.onSnapshot = (snap, bytes) => this.onSnapshot(snap, bytes);
    this.pingTimer = setInterval(() => this.sendPing(), PING_INTERVAL_MS);
    this.sendPing();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onResize();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ red

  handleMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case 'player_joined':
        this.players.set(msg.player.id, msg.player);
        if (msg.player.id !== this.myId) this.addRemote(msg.player);
        this.chat.addSystem(`${msg.player.name} se ha unido.`);
        sound.play('player_join');
        this.refreshPlayerList();
        break;
      case 'player_left': {
        const name = this.players.get(msg.id)?.name ?? 'Alguien';
        this.players.delete(msg.id);
        this.pings.delete(msg.id);
        this.removeRemote(msg.id);
        const why = { left: 'ha salido', timeout: 'se ha desconectado', kicked: 'ha sido expulsado' }[msg.reason];
        this.chat.addSystem(`${name} ${why}.`);
        sound.play('player_leave');
        this.refreshPlayerList();
        break;
      }
      case 'player_status': {
        const p = this.players.get(msg.id);
        if (!p) break;
        p.connected = msg.connected;
        this.remotes.get(msg.id)?.setConnected(msg.connected);
        this.chat.addSystem(msg.connected ? `${p.name} ha vuelto.` : `${p.name} ha perdido la conexión…`);
        this.refreshPlayerList();
        break;
      }
      case 'round_end':
        this.mode = msg.mode;
        this.showResults();
        sound.play('round_end');
        break;
      case 'round_start':
        this.mode = msg.mode;
        for (const p of this.players.values()) Object.assign(p, { kills: 0, deaths: 0 });
        this.hud.showResults(null);
        this.hud.hideDeath();
        this.effects.clearRockets();
        this.refreshPlayerList();
        this.chat.addSystem('¡Nueva ronda!');
        sound.play('round_start');
        break;
      case 'player_look': {
        const p = this.players.get(msg.id);
        if (p) p.look = msg.look;
        if (msg.id === this.myId) this.localModel.setLook(msg.look);
        else this.remotes.get(msg.id)?.model.setLook(msg.look);
        break;
      }
      case 'host_changed': {
        const prev = this.hostId;
        this.hostId = msg.id;
        this.updateLabel(prev);
        this.updateLabel(msg.id);
        const name = msg.id === this.myId ? 'Ahora eres' : `${this.players.get(msg.id)?.name ?? '?'} es ahora`;
        this.chat.addSystem(`${name} el anfitrión de la sala.`);
        this.refreshPlayerList();
        break;
      }
      case 'chat': {
        const p = this.players.get(msg.from);
        if (p) this.chat.addMessage(p.name, p.color, msg.text);
        if (msg.from !== this.myId) sound.play('chat');
        break;
      }
      case 'pong': {
        const sent = this.pingSent.get(msg.n);
        if (sent !== undefined) {
          this.rtt = Math.round(performance.now() - sent);
          this.pingSent.delete(msg.n);
        }
        break;
      }
      case 'stats':
        this.pings = new Map(msg.pings);
        this.refreshPlayerList();
        break;
      case 'prop_added':
        this.props.add(msg.prop, 0);
        sound.play('prop_spawn', { pos: this.tmpV.set(...msg.prop.pos) });
        if (msg.prop.owner === this.myId) this.spawnMenu.setCount(this.props.countByOwner(this.myId));
        break;
      case 'prop_removed': {
        const at = this.props.renderedPosition(msg.id);
        if (at) sound.play('prop_remove', { pos: at });
        this.props.remove(msg.id);
        this.vehicleSpeed.delete(msg.id);
        this.spawnMenu.setCount(this.props.countByOwner(this.myId));
        break;
      }
      case 'prop_update':
        this.props.applyUpdate(msg.id, msg);
        break;
      case 'constraint_added':
        this.toolVisuals.addConstraint(msg.c);
        break;
      case 'constraint_removed':
        this.toolVisuals.removeConstraint(msg.id);
        break;
      case 'thruster_added':
        this.toolVisuals.addThruster(msg.th);
        break;
      case 'thruster_removed':
        this.toolVisuals.removeThruster(msg.id);
        break;
      case 'thruster_active':
        this.toolVisuals.setThrusterActive(msg.id, msg.active);
        break;
      case 'tool_msg':
        this.hud.toolMessage(msg.text, msg.ok);
        if (!msg.ok) sound.play('error');
        break;
      case 'tool_fx': {
        const color = TOOL_BY_ID[msg.tool]?.color ?? 0x74b9ff;
        const from = this.remoteMuzzle(msg.by, this.beamFrom.set(...msg.o));
        this.tmpV.set(...msg.to);
        this.effects.tracer(from, this.tmpV, color, 0.02, 0.12);
        this.effects.toolSpark(this.tmpV, color);
        sound.play('tool', { pos: this.tmpV });
        break;
      }
      case 'error':
        this.chat.addSystem(msg.message);
        sound.play('error');
        break;
      default:
        this.handleCombat(msg);
    }
  }

  /** Eventos de combate: efectos, HUD y marcador. */
  private handleCombat(msg: ServerMessage): void {
    const v = this.tmpV;
    switch (msg.t) {
      case 'shot': {
        const def = WEAPONS[msg.w];
        if (!def) break;
        const from = this.remoteMuzzle(msg.by, this.beamFrom.set(...msg.o));
        for (const [x, y, z, k] of msg.e) {
          v.set(x, y, z);
          this.effects.tracer(from, v, def.tracerColor);
          if (k === 3) continue;
          this.effects.impact(v, k === 1 ? 'player' : k === 2 ? 'prop' : 'world');
          sound.play(k === 1 ? 'impact_player' : 'impact', { pos: v, volume: 0.6 });
        }
        this.effects.muzzleFlash(from);
        sound.play(def.sound, { pos: from });
        break;
      }
      case 'punt': {
        if (msg.by === this.myId) break; // ya se mostró al disparar
        const g = WEAPONS.find((w) => w.gravity)?.gravity;
        const from = this.remoteMuzzle(msg.by, this.beamFrom.set(...msg.o));
        this.effects.punt(from, v.set(...msg.to), g?.beamColor ?? 0x6fe7ff);
        sound.play('gravity_punt', { pos: from });
        break;
      }
      case 'projectile': {
        const spec = WEAPONS[msg.w]?.projectile;
        if (!spec) break;
        const own = msg.by === this.myId;
        this.effects.addRocket(msg.id, v.set(...msg.pos), new THREE.Vector3(...msg.dir), spec.speed,
          ServerClock.tickToMs(msg.tick), own, spec.color);
        if (!own) {
          this.effects.muzzleFlash(this.remoteMuzzle(msg.by, this.beamFrom.set(...msg.pos)), 0xffa040, 0.16);
          sound.play(WEAPONS[msg.w].sound, { pos: this.beamFrom });
        }
        break;
      }
      case 'explode': {
        this.effects.removeRocket(msg.id);
        this.effects.explosion(v.set(...msg.pos), msg.r, this.camera.position);
        sound.play('explosion', { pos: v, volume: Math.min(1.3, msg.r / 4) });
        break;
      }
      case 'damage':
        if (msg.target === this.myId) {
          this.hud.hurt();
          this.hud.setHealth(msg.health);
          if (msg.health > 0) sound.play('hurt');
        } else if (msg.by === this.myId) {
          this.hud.hitMarker(msg.health <= 0);
          sound.play(msg.health <= 0 ? 'kill_confirm' : 'hitmarker');
        }
        break;
      case 'kill': {
        for (const [id, kills, deaths] of msg.scores) {
          const p = this.players.get(id);
          if (p) Object.assign(p, { kills, deaths });
        }
        this.refreshPlayerList();
        const victim = this.players.get(msg.victim);
        const killer = msg.killer >= 0 && msg.killer !== msg.victim ? this.players.get(msg.killer) : undefined;
        const weapon = msg.w === WEAPON_FALL ? 'caída'
          : msg.w === WEAPON_VEHICLE ? 'atropello'
          : msg.w === WEAPON_EXPLOSION ? 'explosión'
          : msg.killer === msg.victim ? 'suicidio' : WEAPONS[msg.w]?.name ?? '?';
        if (victim) {
          this.hud.addKill(killer ?? null, victim, weapon, msg.victim === this.myId || msg.killer === this.myId);
          this.effects.deathBurst(v.set(...msg.pos), victim.color);
          if (msg.victim !== this.myId) sound.play('death', { pos: v });
        }
        if (msg.victim === this.myId) {
          const text = killer ? `Te ha eliminado ${killer.name}`
            : msg.w === WEAPON_FALL ? (this.world.map.water ? 'Te has caído al mar' : 'Te has caído del mapa')
            : 'Te has eliminado a ti mismo';
          this.hud.showDeath(text, msg.respawnMs);
          this.hud.setHealth(0);
          sound.play('you_died');
        }
        break;
      }
    }
  }

  /** Cañón del arma de otro jugador (o `fallback` si no se le ve). */
  private remoteMuzzle(id: number, fallback: THREE.Vector3): THREE.Vector3 {
    const r = this.remotes.get(id);
    if (r && r.root.visible) r.model.muzzleWorld(fallback);
    return fallback;
  }

  /** Objetos para los rayos visuales de los disparos propios. */
  private collectHitTargets(): HitTargets {
    const t = this.hitTargets;
    t.objects.length = 0;
    t.players.clear();
    t.props.clear();
    t.objects.push(...this.world.obstacles);
    for (const m of this.props.meshes) {
      t.objects.push(m);
      t.props.add(m);
    }
    for (const r of this.remotes.values()) {
      if (!r.root.visible) continue;
      for (const m of r.model.hitMeshes) {
        t.objects.push(m);
        t.players.add(m);
      }
    }
    return t;
  }

  /** La conexión se cayó: congelamos la simulación local hasta reconectar. */
  setConnectionLost(text: string | null): void {
    this.online = text === null;
    this.hud.setBanner(text);
  }

  private sendPing(): void {
    const n = ++this.pingN;
    this.pingSent.set(n, performance.now());
    if (this.pingSent.size > 10) this.pingSent.delete(this.pingSent.keys().next().value!);
    this.conn.send({ t: 'ping', n, rtt: this.rtt });
  }

  private onSnapshot(snap: Snapshot, bytes: number): void {
    this.stats.bytes += bytes;
    this.clock.onSnapshot(snap.tick, performance.now());
    const t = ServerClock.tickToMs(snap.tick);

    // Primero las poses de los demás y de los objetos, para que la repetición de inputs
    // del jugador local use el mundo más reciente.
    for (const p of snap.props) {
      this.tmpQ.set(p.qx, p.qy, p.qz, p.qw);
      this.props.pushSample(p.id, t, this.tmpV.set(p.x, p.y, p.z), this.tmpQ);
    }
    let mine = null;
    for (const p of snap.players) {
      if (p.id === this.myId) {
        mine = p;
        continue;
      }
      const r = this.remotes.get(p.id);
      if (!r) continue;
      r.setCombatState(p.dead, p.weapon, p.heldProp, p.vehicle);
      this.tmpQ.setFromEuler(this.tmpE.set(0, p.yaw, 0));
      r.buffer.push(t, this.tmpV.set(p.x, p.y, p.z), this.tmpQ, p.pitch);
      r.grounded = p.grounded;
    }
    if (mine) {
      const wasDead = this.local.dead;
      this.local.reconcile(mine);
      if (wasDead && !mine.dead) {
        this.hud.hideDeath();
        sound.play('respawn');
      }
      this.hud.setHealth(mine.health);
    }
  }

  // ------------------------------------------------------------------ jugadores

  private addRemote(info: PlayerInfo): void {
    const r = new RemotePlayer(info, info.id === this.hostId);
    this.remotes.set(info.id, r);
    this.scene.add(r.root);
  }

  private removeRemote(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.root);
    r.dispose();
    this.remotes.delete(id);
  }

  private updateLabel(id: number): void {
    const r = this.remotes.get(id);
    if (r) r.model.setName(r.info.name, id === this.hostId);
  }

  private refreshPlayerList(): void {
    this.hud.setPlayers({ players: [...this.players.values()], myId: this.myId, hostId: this.hostId, pings: this.pings });
    this.updateModeInfo();
  }

  /** Línea del modo en el HUD: mapa, modo, límite y líder. */
  private updateModeInfo(): void {
    const def = MODES[this.mode.id];
    let text = `${def.name} · ${this.world.map.name}`;
    if (this.mode.killLimit) {
      const leader = [...this.players.values()].sort((a, b) => b.kills - a.kills)[0];
      text += ` · a ${this.mode.killLimit} bajas`;
      if (leader?.kills) text += ` · líder: ${leader.name} (${leader.kills})`;
    }
    this.hud.setModeInfo(text);
  }

  /** Pantalla de resultados con la clasificación del servidor. */
  private showResults(): void {
    const m = this.mode;
    const winner = this.players.get(m.winner ?? -1);
    this.hud.hideDeath(); // los resultados sustituyen al aviso de muerte
    this.hud.showResults({
      title: m.winner === this.myId ? '¡Has ganado!' : `¡${winner?.name ?? 'Alguien'} gana la ronda!`,
      restartMs: m.restartMs ?? 0,
      rows: (m.ranking ?? []).map(([id, kills, deaths]) => {
        const p = this.players.get(id);
        return { name: p?.name ?? '?', color: p?.color ?? 0xffffff, kills, deaths, winner: id === m.winner, me: id === this.myId };
      }),
    });
  }

  /**
   * Mundo de colisión para la predicción local: el mismo que usa el servidor (formas
   * estáticas + objetos + otros jugadores) con las poses del último snapshot, extrapoladas
   * `leadTicks` hacia delante con su velocidad. Así, al empujar una caja, la predicción
   * "sabe" que la caja se aparta y no se queda frenada contra su pose antigua.
   */
  private collisionShapes = (leadTicks: number): readonly Shape[] => {
    const leadMs = leadTicks * TICK_MS;
    const shapes = this.shapes;
    shapes.length = 0;
    for (const s of this.world.staticShapes) shapes.push(s);
    // Solo los objetos cercanos: el controlador descarta los lejanos igualmente, y esto se
    // llama por cada input pendiente al corregir (con 200 objetos y un túnel lento, mucho trabajo).
    const me = this.local.state;
    this.props.forEachLatest((def, pos, rot, id, vel, scale) => {
      const dx = pos.x - me.x, dy = pos.y - me.y, dz = pos.z - me.z;
      if (dx * dx + dy * dy + dz * dz > NEAR_PROPS_RADIUS * NEAR_PROPS_RADIUS * Math.max(1, scale)) return;
      addPropShapes(
        def.parts, pos.x + vel.x * leadMs, pos.y + vel.y * leadMs, pos.z + vel.z * leadMs,
        [rot.x, rot.y, rot.z, rot.w], id, shapes, scale,
      );
    });
    for (const r of this.remotes.values()) {
      const s = r.buffer.latest;
      if (!r.info.connected || r.dead || r.vehicle || !s) continue;
      const v = r.buffer.velocity(this.tmpV);
      shapes.push({
        kind: 'capsule', x: s.pos.x + v.x * leadMs, y: s.pos.y + v.y * leadMs, z: s.pos.z + v.z * leadMs,
        half: PLAYER_HALF_HEIGHT, r: PLAYER_RADIUS, playerId: r.info.id,
      });
    }
    return shapes;
  };

  // ------------------------------------------------------------------ bucle

  private simTick(): void {
    const input: InputFrame = {
      seq: ++this.seq,
      buttons: this.input.buttons(),
      yaw: this.input.yaw,
      pitch: this.input.pitch,
      weapon: this.weapons.selected,
      // Lo que estamos viendo de los demás (para la compensación de lag del servidor).
      viewTick: Math.max(0, Math.floor(this.clock.renderTime(performance.now()) / TICK_MS)),
      wheel: this.weapons.takeWheel(),
    };
    this.local.tick(input);
    this.conn.sendBinary(encodeInput(input));
    if (!this.local.dead && !this.local.vehicle) {
      const st = this.local.state;
      this.weapons.onLocalTick(input, this.eye.set(st.x, st.y + PLAYER_EYE_HEIGHT, st.z));
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dtMs = Math.min(now - this.lastFrame, 250);
    const dt = dtMs / 1000;
    this.lastFrame = now;
    this.perf.frame(dtMs, this.input.locked);

    // Simulación local a paso fijo (60 Hz), independiente de los fps.
    if (this.local.initialized && this.online) {
      this.acc = Math.min(this.acc + dtMs, TICK_MS * 8);
      while (this.acc >= TICK_MS) {
        this.acc -= TICK_MS;
        this.simTick();
      }
    }

    this.local.renderPosition(this.acc / TICK_MS, dt, this.renderPos);
    // Los objetos primero: el vehículo que se conduce decide dónde va la cámara.
    const renderTime = this.clock.renderTime(now);
    this.updateHeldProp();
    this.props.update(renderTime, dt);
    this.toolVisuals.update(dt);

    const driving = this.local.vehicle ? this.seatPose(this.local.vehicle, this.seat) : null;
    if (driving) this.renderPos.copy(this.seat);
    const third = this.cameraCtl.mode === 'third';
    const obstacles = third || driving ? [...this.world.obstacles, ...this.props.meshes] : [];
    if (driving) {
      this.cameraCtl.updateOrbit(driving.pos, this.input.yaw, this.input.pitch, dt, 6.5, this.world.obstacles);
    } else {
      this.cameraCtl.update(this.renderPos, this.input.yaw, this.input.pitch, dt, obstacles);
    }

    // Temblor de cámara (explosiones cercanas).
    if (this.effects.shake > 0) {
      const k = this.effects.shake * 0.12;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.rotation.z += (Math.random() - 0.5) * k * 0.3;
    }

    // Modelo propio: visible en 3ª persona o conduciendo (sentado en el asiento).
    const alive = !this.local.dead;
    const showSelf = (third || !!driving) && this.local.initialized && alive;
    this.localModel.root.visible = showSelf;
    this.localModel.setSeated(!!driving);
    if (showSelf) {
      this.localModel.root.position.copy(this.renderPos);
      if (driving) this.localModel.root.quaternion.copy(driving.rot);
      else this.localModel.root.rotation.set(0, this.input.yaw, 0);
      this.localModel.animate(dt, this.local.horizontalSpeed, this.input.pitch, this.local.state.grounded);
    }

    for (const r of this.remotes.values()) {
      r.update(renderTime, dt, this.camera.position);
      // Conductor: sentado en su vehículo (misma pose interpolada que el chasis).
      if (r.vehicle && !r.dead && r.info.connected) {
        const pose = this.seatPose(r.vehicle, this.seat);
        if (pose) {
          r.root.position.copy(this.seat);
          r.root.quaternion.copy(pose.rot);
          r.root.visible = true;
        }
      }
    }
    this.updateBeams();
    this.effects.update(dt, renderTime + this.clock.delay, renderTime);
    this.world.followShadow(this.renderPos);
    this.hud.setTabListVisible(this.input.locked && this.input.isDown('Tab'));
    this.hud.updateDeathTimer();
    this.hud.updateResultsTimer();
    this.updateHint(!!driving, alive);
    const toolDef = WEAPONS[this.weapons.current]?.tool && alive && !driving ? TOOL_BY_ID[selectedTool] : null;
    this.hud.setTool(toolDef, paintColor);

    this.viewModel.visible = !third && !driving && alive && this.local.initialized;
    this.viewModel.update(dt, this.camera.aspect, this.local.horizontalSpeed, this.local.state.grounded);
    this.updateAudio(dt, !!driving, alive);
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.viewModel.render(this.renderer);
    this.updateStats(now);
  };

  /**
   * Sonidos que salen del estado y no de un mensaje: pasos, salto y aterrizaje, agarrar y
   * soltar con la pistola de gravedad, subir y bajar de un vehículo y el motor de los coches.
   */
  private updateAudio(dt: number, driving: boolean, alive: boolean): void {
    sound.setListener(this.camera.position, this.input.yaw);
    const a = this.audio;
    const st = this.local.state;
    if (this.local.initialized && alive && !driving) {
      if (st.grounded) {
        if (!a.grounded && a.airTime > 0.3) sound.play('land', { volume: Math.min(1, a.airTime) });
        a.airTime = 0;
        // Un paso cada ~2 m (algo más al esprintar).
        a.step += this.local.horizontalSpeed * dt;
        if (a.step > (st.sprinting ? 2.6 : 2.1)) {
          a.step = 0;
          sound.play('footstep', { volume: 0.5 });
        }
      } else {
        if (a.grounded && st.vy > 1) sound.play('jump', { volume: 0.6 });
        a.airTime += dt;
      }
    }
    a.grounded = st.grounded;

    const held = this.local.dead ? 0 : this.local.heldProp;
    if (held !== a.held) sound.play(held ? 'gravity_grab' : 'gravity_drop');
    a.held = held;
    if (this.local.vehicle !== a.vehicle) sound.play('vehicle_door');
    a.vehicle = this.local.vehicle;

    // Los demás: pasos (a partir de lo que se mueven en pantalla), vehículo y agarrar.
    for (const r of this.remotes.values()) {
      let ra = this.remoteAudio.get(r.info.id);
      const p = r.root.position;
      if (!ra) {
        ra = { x: p.x, z: p.z, step: 0, vehicle: r.vehicle, held: r.heldProp };
        this.remoteAudio.set(r.info.id, ra);
      }
      const moved = Math.hypot(p.x - ra.x, p.z - ra.z);
      ra.x = p.x;
      ra.z = p.z;
      if (r.root.visible && !r.dead && !r.vehicle && r.grounded && moved < 1) {
        ra.step += moved;
        if (ra.step > 2.2) {
          ra.step = 0;
          sound.play('footstep', { pos: p, volume: 0.6 });
        }
      }
      if (r.vehicle !== ra.vehicle) sound.play('vehicle_door', { pos: p });
      if (r.heldProp !== ra.held && !r.dead) sound.play(r.heldProp ? 'gravity_grab' : 'gravity_drop', { pos: p, volume: 0.7 });
      ra.vehicle = r.vehicle;
      ra.held = r.heldProp;
    }

    // Motor de cada vehículo con conductor; el tono sigue a la velocidad dibujada.
    const drivers = new Set<number>();
    if (this.local.vehicle) drivers.add(this.local.vehicle);
    for (const r of this.remotes.values()) if (r.vehicle && !r.dead) drivers.add(r.vehicle);
    for (const id of drivers) {
      const pose = this.props.renderedPose(id);
      if (!pose) continue;
      let vs = this.vehicleSpeed.get(id);
      if (!vs) {
        vs = { x: pose.pos.x, y: pose.pos.y, z: pose.pos.z, speed: 0 };
        this.vehicleSpeed.set(id, vs);
      }
      if (dt > 0) {
        const v = Math.hypot(pose.pos.x - vs.x, pose.pos.y - vs.y, pose.pos.z - vs.z) / dt;
        vs.speed += (Math.min(v, 40) - vs.speed) * Math.min(1, dt * 6);
      }
      vs.x = pose.pos.x;
      vs.y = pose.pos.y;
      vs.z = pose.pos.z;
      sound.engine(`v${id}`, pose.pos, vs.speed, id === this.local.vehicle ? 1 : 0.8);
    }
    sound.endFrame();
  }

  /** Ajustes que se aplican en caliente (los de calidad los gestiona `Performance`). */
  private applySettings(s: Readonly<SettingsData>): void {
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.hud.setStatsVisible(s.showStats);
    this.perf.setLevel(s.quality);
  }

  private openSpawnMenu(): void {
    if (!MODES[this.mode.id].building) {
      this.hud.toolMessage(`El menú de objetos no está disponible en ${MODES[this.mode.id].name}.`, false);
      return;
    }
    this.spawnMenu.setCount(this.props.countByOwner(this.myId));
    this.spawnMenu.open();
    this.input.releaseLock();
  }

  /** Posición del asiento de un vehículo (en `out`) y la pose dibujada del vehículo. */
  private seatPose(vehicleId: number, out: THREE.Vector3): { pos: THREE.Vector3; rot: THREE.Quaternion } | null {
    const pose = this.props.renderedPose(vehicleId);
    const spec = this.props.defOf(vehicleId)?.vehicle;
    if (!pose || !spec) return null;
    out.set(...spec.seat).applyQuaternion(pose.rot).add(pose.pos);
    return pose;
  }

  /** Pistas de vehículo: "E para conducir" cerca de uno libre; controles al conducir. */
  private updateHint(driving: boolean, alive: boolean): void {
    if (driving) {
      this.hud.setHint('W/S acelerar y frenar · A/D girar · Espacio freno (o enderezar si vuelca) · E bajar');
      return;
    }
    let near = false;
    if (alive && this.local.initialized) {
      const busy = new Set([...this.remotes.values()].map((r) => r.vehicle));
      const st = this.local.state;
      this.props.forEachVehicle((id, def, pos) => {
        if (busy.has(id)) return;
        const d = Math.hypot(pos.x - st.x, (pos.y - st.y) * 0.5, pos.z - st.z);
        const half = Math.max(...def.parts.filter((p) => p.kind === 'box').map((p) => (p.kind === 'box' ? Math.max(p.size[0], p.size[2]) / 2 : 0)));
        if (d - half * 0.6 < VEHICLE_ENTER_DISTANCE) near = true;
      });
    }
    this.hud.setHint(near ? 'Pulsa E para conducir' : null);
  }

  /**
   * El objeto que sujeta el jugador local se dibuja donde lo pondrá el servidor (delante de
   * la cámara), sin esperar al snapshot: si no, se quedaría atrás al girar.
   */
  private updateHeldProp(): void {
    const id = this.local.dead ? 0 : this.local.heldProp;
    const def = id ? this.props.defOf(id) : undefined;
    const hold = this.holdParams();
    if (!id || !def || !hold) {
      this.props.setOverride(0);
      return;
    }
    const [dx, dy, dz] = aimDirection(this.input.yaw, this.input.pitch);
    const dist = this.local.predictedHoldDistance(hold.step, hold.min, hold.max);
    this.heldTarget.set(
      this.renderPos.x + dx * dist, this.renderPos.y + PLAYER_EYE_HEIGHT + dy * dist, this.renderPos.z + dz * dist,
    );
    this.props.setOverride(id, this.heldTarget);
  }

  /** Parámetros de "sujetar" del arma actual: pistola de gravedad o herramienta Mover. */
  private holdParams(): { step: number; min: number; max: number } | null {
    const w = WEAPONS[this.weapons.current];
    if (w?.gravity) return { step: w.gravity.wheelStep, min: w.gravity.minHoldDistance, max: w.gravity.maxHoldDistance };
    const p = w?.tool && selectedTool === 'mover' ? TOOL_BY_ID.mover.params : null;
    return p ? { step: p.wheelStep, min: p.minHold, max: p.maxHold } : null;
  }

  /** Rayo de cada jugador que sujeta algo (pistola de gravedad, o herramienta Mover). */
  private updateBeams(): void {
    const gravityColor = WEAPONS.find((w) => w.gravity)?.gravity?.beamColor ?? 0x6fe7ff;
    const moverColor = TOOL_BY_ID.mover.color;
    if (this.local.heldProp && !this.local.dead) {
      const to = this.props.renderedPosition(this.local.heldProp);
      const color = WEAPONS[this.weapons.current]?.tool ? moverColor : gravityColor;
      if (to) this.effects.beam(this.myId, this.weapons.muzzleWorld(this.beamFrom), to, color);
    }
    for (const r of this.remotes.values()) {
      if (!r.heldProp || r.dead || !r.root.visible) continue;
      const to = this.props.renderedPosition(r.heldProp);
      const from = r.model.muzzleWorld(this.beamFrom);
      if (to && from) this.effects.beam(r.info.id, from, to, WEAPONS[r.weapon]?.tool ? moverColor : gravityColor);
    }
  }

  private updateStats(now: number): void {
    this.stats.frames++;
    const elapsed = now - this.stats.since;
    if (elapsed < 500) return;
    const fps = Math.round((this.stats.frames * 1000) / elapsed);
    const kbps = ((this.stats.bytes / 1024) * 1000) / elapsed;
    this.hud.setStats(
      `${fps} fps · ping ${this.rtt} ms · red ${kbps.toFixed(1)} KB/s · interp ${Math.round(this.clock.delay)} ms · `
      + `draw ${this.renderer.info.render.calls} · calidad ${this.perf.label}`,
    );
    this.stats = { frames: 0, bytes: 0, since: now };
  }

  /** Al ocultar la pestaña rAF se detiene: enviamos un input "quieto" para no seguir andando. */
  private onVisibility = (): void => {
    if (document.hidden && this.local.initialized) {
      this.conn.sendBinary(encodeInput({
        seq: ++this.seq, buttons: 0, yaw: this.input.yaw, pitch: this.input.pitch,
        weapon: this.weapons.selected, viewTick: 0, wheel: 0,
      }));
    }
  };

  private onResize = (): void => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.pingTimer);
    this.unsubSettings();
    sound.stopAll();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.chat.close();
    this.spawnMenu.dispose();
    this.chat.onSend = () => {};
    this.chat.onToggle = () => {};
    this.input.dispose();
    this.hud.dispose();
    for (const r of this.remotes.values()) r.dispose();
    this.localModel.dispose();
    this.toolVisuals.dispose();
    this.effects.dispose();
    this.props.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
