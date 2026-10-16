// Constantes compartidas entre cliente y servidor. Cambiar aquí afecta a ambos lados.

export const SERVER_PORT = 3000;
export const WS_PATH = '/ws';

/** Ticks de simulación por segundo (servidor y predicción del cliente). */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;
/** Snapshots enviados por segundo (cada TICK_RATE / SNAPSHOT_RATE ticks). */
export const SNAPSHOT_RATE = 20;
export const SNAPSHOT_MS = 1000 / SNAPSHOT_RATE;
/** Cada cuántos snapshots se envían también los objetos dormidos (estado completo). */
export const FULL_SNAPSHOT_EVERY = 20;
/** Límites del retardo de interpolación adaptativo de entidades remotas (ms). */
export const INTERP_DELAY_MIN_MS = 70;
export const INTERP_DELAY_MAX_MS = 250;

export const MAX_PLAYERS_PER_ROOM = 6;
export const ROOM_CODE_LENGTH = 4;
/** Sin letras ambiguas (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const MAX_NAME_LENGTH = 16;

/** Tiempo que se guarda el hueco de un jugador desconectado para que pueda reconectar. */
export const RECONNECT_GRACE_MS = 30_000;
export const PING_INTERVAL_MS = 2000;

// --- Chat ---
export const CHAT_MAX_LENGTH = 200;
/** Máximo de mensajes por ventana de tiempo (anti-spam). */
export const CHAT_RATE_COUNT = 5;
export const CHAT_RATE_WINDOW_MS = 5000;

/** Límite de cuerpos dinámicos por sala. */
export const MAX_DYNAMIC_PROPS = 200;
/** Límite de cuerpos que puede crear cada jugador (un ragdoll cuenta como sus 6 piezas). */
export const MAX_PROPS_PER_PLAYER = 40;
/** Tiempo mínimo entre dos spawns del mismo jugador. */
export const SPAWN_COOLDOWN_MS = 250;
/** Distancia máxima delante del jugador a la que aparece un objeto. */
export const SPAWN_MAX_DISTANCE = 8;
/** Distancia a la que se puede subir a un vehículo con E. */
export const VEHICLE_ENTER_DISTANCE = 3.2;

// --- Red: inputs ---
/** Inputs máximos que el servidor procesa de un jugador en un mismo tick (absorbe ráfagas). */
export const MAX_INPUTS_PER_TICK = 3;
/** Inputs máximos en cola; si se supera se descartan los más viejos (evita speedhacks y latencia). */
export const MAX_INPUT_QUEUE = 12;
/** Ticks sin inputs tras los que el servidor simula al jugador "quieto" (pestaña oculta, lag). */
export const INPUT_STARVE_TICKS = 15;

// --- Jugador ---
export const GRAVITY = 20;
export const PLAYER_RADIUS = 0.4;
/** Semialtura del cilindro de la cápsula (sin las semiesferas). */
export const PLAYER_HALF_HEIGHT = 0.5;
/** Distancia del centro de la cápsula a los pies. */
export const PLAYER_FOOT_OFFSET = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
export const PLAYER_EYE_HEIGHT = 0.7; // por encima del centro
export const PLAYER_WALK_SPEED = 6;
export const PLAYER_SPRINT_SPEED = 10;
export const PLAYER_GROUND_ACCEL = 70;
export const PLAYER_AIR_ACCEL = 18;
export const PLAYER_JUMP_SPEED = 7.5;
export const PLAYER_MAX_FALL_SPEED = 50;
/** Ticks tras salir de un borde en los que aún se puede saltar. */
export const PLAYER_COYOTE_TICKS = 6;
/** Ticks que se recuerda una pulsación de salto hecha justo antes de tocar el suelo. */
export const PLAYER_JUMP_BUFFER_TICKS = 6;
/** Distancia a la que el jugador "se pega" al suelo al bajar escalones/rampas. */
export const PLAYER_GROUND_SNAP = 0.25;
/** Normal mínima (componente Y) para considerar una superficie como suelo. */
export const WALKABLE_NORMAL_Y = 0.65;
export const PLAYER_MASS = 80;
/** Fuerza con la que el jugador empuja objetos al caminar contra ellos (0..1). */
export const PLAYER_PUSH_STRENGTH = 0.35;
/** Por debajo de esta altura el jugador reaparece. */
export const KILL_Y = -30;

/** Colores asignados a los jugadores por orden de hueco en la sala. */
export const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22];

// --- Combate ---
export const PLAYER_MAX_HEALTH = 100;
export const RESPAWN_MS = 3000;
/** Invulnerabilidad tras reaparecer. */
export const SPAWN_PROTECTION_MS = 1500;
/** Tiempo para sacar un arma tras cambiar (no se puede disparar mientras). */
export const WEAPON_SWITCH_MS = 300;
/** Máximo que el servidor "rebobina" a los demás jugadores al validar un disparo (compensación de lag). */
export const MAX_LAG_COMPENSATION_MS = 300;
/** Por encima del centro de la cápsula a partir de esta altura, el impacto cuenta como en la cabeza. */
export const HEADSHOT_HEIGHT = 0.45;
