import type RAPIER from '@dimforge/rapier3d-compat';
import type { WebSocket } from 'ws';
import type { PropDef } from '../content/props';
import type { InputFrame } from '../shared/input';
import type { MoveState } from '../shared/playerController';
import type { PlayerInfo, ServerMessage, Vec3 } from '../shared/protocol';
import type { FireState } from '../shared/weapons';

/** Posición pasada de un jugador (para la compensación de lag). */
export interface HistoryEntry {
  tick: number;
  x: number;
  y: number;
  z: number;
  alive: boolean;
}

export interface ServerPlayer {
  /** Datos públicos (nombre, color, marcador...). */
  info: PlayerInfo;
  /** Secreto para reconectar a este hueco. */
  token: string;
  /** Identificador persistente del navegador (para expulsiones). */
  clientId: string;
  /** null mientras está desconectado (hueco reservado). */
  socket: WebSocket | null;
  disconnectedAt: number;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  move: MoveState;
  inputQueue: InputFrame[];
  lastInput: InputFrame;
  lastAppliedSeq: number;
  starvedTicks: number;
  rtt: number;
  chatTimes: number[];

  // --- Combate ---
  health: number;
  dead: boolean;
  respawnAt: number;
  /** Invulnerable hasta este instante (ms, Date.now). */
  protectedUntil: number;
  fire: FireState;
  /** Objeto sujeto con la pistola de gravedad (0 = ninguno). */
  heldProp: number;
  /** Distancia (desde los ojos) a la que se sujeta el objeto. */
  holdDistance: number;
  /** Anillo de posiciones recientes, indexado por tick % longitud. */
  history: HistoryEntry[];

  // --- Objetos y vehículos ---
  /** Vehículo que conduce (id de prop, 0 = a pie). */
  vehicle: number;
  /** Botones del input anterior (para detectar pulsaciones de E). */
  prevButtons: number;
  lastSpawnAt: number;
  lastLookAt: number;
  /** Último atropello recibido (para no encadenar daño cada tick). */
  runOverAt: number;

  // --- Tool gun ---
  tool: string;
  toolColor: number;
  /** Primer punto de las herramientas de dos clics (soldar, cuerda). */
  toolStage: { prop: number; local: Vec3; world: Vec3 } | null;
  /** Cómo se sujeta heldProp: pistola de gravedad o herramienta Mover (sin girar). */
  holdMode: 'gravity' | 'move';
  holdRot: [number, number, number, number];
}

export interface ServerProp {
  id: number;
  type: string;
  def: PropDef;
  body: RAPIER.RigidBody;
  /** Jugador que lo creó (-1 = del mapa). */
  owner: number;
  /** Grupo al que pertenece (ragdoll), 0 = ninguno. Deshacer borra el grupo entero. */
  group: number;
  tint: number;
  /** Escala uniforme (herramienta Escalar). */
  scale: number;
  /** Vida restante (solo objetos explosivos). */
  health: number;
  /** Si estaba despierto en el último snapshot (para enviar su pose final al dormirse). */
  sentAwake: boolean;
}

/** Lo que el sistema de combate necesita de la sala. */
export interface CombatHost {
  readonly world: RAPIER.World;
  readonly players: Map<number, ServerPlayer>;
  readonly props: Map<number, ServerProp>;
  readonly tick: number;
  propByBody(handle: number): ServerProp | undefined;
  removeProp(id: number): void;
  broadcast(msg: ServerMessage, exceptId?: number): void;
  send(p: ServerPlayer, msg: ServerMessage): void;
  randomSpawn(self?: ServerPlayer): Vec3;
  /** Saca al jugador de su vehículo (al morir). */
  exitVehicle(p: ServerPlayer): void;
  /** El modo permite hacer daño (no durante la pantalla de resultados). */
  canDamage(): boolean;
  /** Tras contar una baja (el modo comprueba el límite). */
  onKill(killer: ServerPlayer | null): void;
  /** Uso de la tool gun (lo procesa ToolSystem). */
  toolInput(p: ServerPlayer, input: InputFrame, primary: boolean, secondary: boolean, pressed: number): void;
}

// Grupos de colisión de Rapier: (pertenencia << 16) | filtro. Dos colisionadores chocan si
// cada uno pertenece a algún grupo del filtro del otro.
export const GROUP_STATIC = 0x0001;
export const GROUP_PROP = 0x0002;
export const GROUP_PLAYER = 0x0004;
export const GROUP_VEHICLE = 0x0008;
export const collisionGroups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;
/** Los jugadores (cinemáticos) no chocan con vehículos en Rapier: si no, un coche se pararía en seco
 *  contra ellos. El controlador del jugador sí trata el vehículo como sólido y hay daño por atropello. */
export const PLAYER_GROUPS = collisionGroups(GROUP_PLAYER, GROUP_STATIC | GROUP_PROP);
export const VEHICLE_GROUPS = collisionGroups(GROUP_VEHICLE, GROUP_STATIC | GROUP_PROP | GROUP_VEHICLE);
export const PROP_GROUPS = collisionGroups(GROUP_PROP, 0xffff);
