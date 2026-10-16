// Registro de mapas. Cada mapa es solo datos: el servidor crea los colisionadores, el
// controlador del jugador usa las mismas formas y el cliente genera la geometría low-poly
// (todas las piezas fusionadas en una malla). Añadir un mapa = añadir una entrada a `defs`.
// Las funciones de ayuda (rampas, edificios, árboles...) solo construyen listas de piezas.

import { addPropShapes, eulerYXZ, type PartShape, type Shape } from '../shared/collision';
import type { Vec3 } from '../shared/protocol';

/** Pieza estática del mapa. `rot` en radianes, orden 'YXZ' (x = pendiente, y = orientación). */
export type MapPart = PartShape & {
  pos: Vec3;
  rot?: Vec3;
  color: number;
  /** false = solo decorativa (sin colisión). */
  solid?: boolean;
  segments?: number;
};

export interface MapDef {
  id: string;
  name: string;
  description: string;
  /** Lado del suelo cuadrado (m), centrado en el origen, superficie en y = 0. */
  groundSize: number;
  groundColors: number[];
  skyTop: number;
  skyBottom: number;
  fog: [near: number, far: number];
  /** Puntos de aparición (Deathmatch elige el más alejado de los demás). */
  spawnPoints: Vec3[];
  parts: MapPart[];
  /** Objetos físicos colocados al crear la sala (y al empezar cada ronda). */
  props: { type: string; pos: Vec3 }[];
  /** Agua decorativa alrededor (la Isla). */
  water?: { level: number; color: number };
  /** Por debajo de esta altura se muere (por defecto -30). */
  killY?: number;
}

// ---------------------------------------------------------------- ayudas

const box = (pos: Vec3, size: Vec3, color: number, extra: Partial<MapPart> = {}): MapPart =>
  ({ kind: 'box', pos, size, color, ...extra }) as MapPart;

/** Bloque apoyado en el suelo (o en `base`) con su cara superior a `top`. */
const block = (x: number, z: number, w: number, d: number, top: number, color: number, base = 0): MapPart =>
  box([x, (top + base) / 2, z], [w, top - base, d], color);

/**
 * Rampa centrada en (x, z) que sube `rise` metros a lo largo de `length` metros (horizontal),
 * desde `base`. Sin girar (`yaw` = 0) sube hacia -Z; yaw gira como la mirada del jugador.
 */
function ramp(x: number, z: number, yaw: number, length: number, rise: number, width: number, color: number, base = 0): MapPart {
  const slope = Math.atan2(rise, length);
  const t = 0.3;
  return box([x, base + rise / 2 - (t / 2) * Math.cos(slope), z], [width, t, Math.hypot(length, rise)], color, { rot: [slope, yaw, 0] });
}

/** Árbol low-poly: tronco sólido y copa decorativa de conos. */
function tree(x: number, z: number, s = 1): MapPart[] {
  return [
    { kind: 'cylinder', radius: 0.22 * s, height: 2 * s, pos: [x, s, z], color: 0x8d5a2b, segments: 6 },
    { kind: 'cone', radius: 1.3 * s, height: 2 * s, pos: [x, 2.6 * s, z], color: 0x2e8b57, segments: 7, solid: false },
    { kind: 'cone', radius: 1 * s, height: 1.6 * s, pos: [x, 3.6 * s, z], color: 0x3aa76d, segments: 7, solid: false },
  ];
}

/** Palmera: tronco inclinado y hojas como tablas inclinadas. */
function palm(x: number, z: number, lean = 0.15): MapPart[] {
  const top: Vec3 = [x + Math.sin(lean) * 3.5, 3.5, z];
  return [
    { kind: 'cylinder', radius: 0.2, height: 3.6, pos: [x + Math.sin(lean) * 1.75, 1.8, z], rot: [0, 0, -lean], color: 0xa0784a, segments: 6 },
    ...[0, 1, 2, 3, 4].map((i) => box(
      [top[0] + Math.sin((i * 2 * Math.PI) / 5) * 0.9, top[1] - 0.15, top[2] + Math.cos((i * 2 * Math.PI) / 5) * 0.9],
      [0.5, 0.06, 2], 0x27ae60, { rot: [0.35, (i * 2 * Math.PI) / 5, 0], solid: false },
    )),
  ];
}

/** Edificio: bloque sólido, cornisa en el tejado y franjas de "ventanas" decorativas. */
function building(x: number, z: number, w: number, d: number, h: number, color: number, trim = 0x2f3640): MapPart[] {
  const parts: MapPart[] = [block(x, z, w, d, h, color), box([x, h + 0.15, z], [w + 0.3, 0.3, d + 0.3], trim, { solid: false })];
  for (let y = 2.2; y < h - 1; y += 3) parts.push(box([x, y, z], [w + 0.04, 0.9, d + 0.04], 0x74b9ff, { solid: false }));
  return parts;
}

/** Roca: esfera sólida achatada visualmente con pocos polígonos. */
const rock = (x: number, z: number, r: number, color = 0x7f8c8d): MapPart =>
  ({ kind: 'ball', radius: r, pos: [x, r * 0.4, z], color });

/** Farola: poste sólido y foco decorativo. */
function lamp(x: number, z: number): MapPart[] {
  return [
    { kind: 'cylinder', radius: 0.1, height: 4, pos: [x, 2, z], color: 0x2f3640, segments: 6 },
    box([x, 4.05, z], [0.5, 0.2, 0.5], 0xffeaa7, { solid: false }),
  ];
}

/** Coche aparcado (estático): carrocería y cabina. */
function parkedCar(x: number, z: number, yaw: number, color: number): MapPart[] {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return [
    box([x, 0.55, z], [1.8, 0.7, 4], color, { rot: [0, yaw, 0] }),
    box([x + s * 0.3, 1.2, z + c * 0.3], [1.6, 0.6, 2], 0x2d3436, { rot: [0, yaw, 0] }),
  ];
}

// ---------------------------------------------------------------- Flatgrass

const flatgrass: MapDef = {
  id: 'flatgrass',
  name: 'Flatgrass',
  description: 'Pradera enorme y vacía: el clásico para construir.',
  groundSize: 120,
  groundColors: [0x6fbf4a, 0x67b545, 0x78c752, 0x62ad40],
  skyTop: 0x4a90d9,
  skyBottom: 0xcfe8ff,
  fog: [60, 220],
  spawnPoints: [[0, 2, 8], [3, 2, 8], [-3, 2, 8], [0, 2, 11], [3, 2, 11], [-3, 2, 11], [6, 2, 8], [-6, 2, 8]],
  parts: [
    // Zona de pruebas: escalones, plataforma y un muro.
    block(12, -6, 3, 3, 0.5, 0xb0a090),
    block(12, -9, 3, 3, 1, 0xa89884),
    block(12, -12, 3, 3, 1.5, 0xa08f78),
    block(12, -17, 6, 7, 2, 0x98866c),
    block(-12, -12, 8, 0.6, 3, 0x9aa3ad),
    ramp(18, -17, Math.PI / 2, 6, 2, 3, 0xa08f78),
    ...tree(-30, 20), ...tree(-36, -14, 1.2), ...tree(28, 30, 0.9), ...tree(40, -30, 1.3), ...tree(-20, -40),
  ],
  props: [
    { type: 'crate', pos: [0, 0.5, 0] },
    { type: 'crate', pos: [2, 0.5, -1] },
    { type: 'crate', pos: [2, 1.5, -1] },
    { type: 'crate_big', pos: [-4, 1, -3] },
    { type: 'ball', pos: [5, 0.6, 2] },
  ],
};

// ---------------------------------------------------------------- Arena

const STONE = 0x8395a7;
const arena: MapDef = {
  id: 'arena',
  name: 'Arena',
  description: 'Recinto amurallado con plataforma central, rampas y coberturas. Ideal para Deathmatch.',
  groundSize: 60,
  groundColors: [0xd9b779, 0xd1ad6c, 0xe0c088, 0xc9a462],
  skyTop: 0x5d8fd1,
  skyBottom: 0xf3e2c3,
  fog: [50, 160],
  spawnPoints: [
    [-22, 3.5, -22], [22, 1, -22], [-22, 1, 22], [22, 3.5, 22], [0, 1, -23], [0, 1, 23], [-23, 1, 0], [23, 1, 0],
  ],
  parts: [
    // Murallas
    block(0, -28.5, 58, 1, 4, STONE), block(0, 28.5, 58, 1, 4, STONE),
    block(-28.5, 0, 1, 56, 4, STONE), block(28.5, 0, 1, 56, 4, STONE),
    // Plataforma central con cuatro rampas
    block(0, 0, 10, 10, 2, 0x9c8868),
    ramp(0, -8, Math.PI, 6, 2, 4, 0xb8a27e), ramp(0, 8, 0, 6, 2, 4, 0xb8a27e),
    ramp(8, 0, Math.PI / 2, 6, 2, 4, 0xb8a27e), ramp(-8, 0, -Math.PI / 2, 6, 2, 4, 0xb8a27e),
    // Pilares y muros bajos de cobertura
    block(-14, -14, 1.5, 1.5, 4, STONE), block(14, -14, 1.5, 1.5, 4, STONE),
    block(-14, 14, 1.5, 1.5, 4, STONE), block(14, 14, 1.5, 1.5, 4, STONE),
    block(-18, 0, 0.6, 5, 1.2, 0x7f8c8d), block(18, 0, 0.6, 5, 1.2, 0x7f8c8d),
    block(0, -18, 5, 0.6, 1.2, 0x7f8c8d), block(0, 18, 5, 0.6, 1.2, 0x7f8c8d),
    block(-9, -20, 4, 0.6, 1.2, 0x7f8c8d), block(9, 20, 4, 0.6, 1.2, 0x7f8c8d),
    // Pasarelas elevadas en dos esquinas con su rampa
    block(-22, -22, 6, 6, 2.5, 0x9c8868), ramp(-22, -15, 0, 8, 2.5, 3, 0xb8a27e),
    block(22, 22, 6, 6, 2.5, 0x9c8868), ramp(22, 15, Math.PI, 8, 2.5, 3, 0xb8a27e),
  ],
  props: [
    { type: 'drum_explosive', pos: [-6, 0.5, -14] },
    { type: 'drum_explosive', pos: [6, 0.5, 14] },
    { type: 'drum_explosive', pos: [16, 0.5, -6] },
    { type: 'crate', pos: [-16, 0.5, 6] },
    { type: 'crate', pos: [-16, 1.5, 6] },
    { type: 'crate', pos: [10, 0.5, -10] },
    { type: 'barrel', pos: [-10, 0.55, 10] },
  ],
};

// ---------------------------------------------------------------- Ciudad pequeña

const SIDEWALK = 0xa4b0be;
const city: MapDef = {
  id: 'city',
  name: 'Ciudad pequeña',
  description: 'Calles, edificios, una plaza con fuente y una azotea a la que se sube por una rampa.',
  groundSize: 110,
  groundColors: [0x535c68, 0x4b5460, 0x57606f, 0x4f5966],
  skyTop: 0x6c8eb8,
  skyBottom: 0xdfe6e9,
  fog: [45, 170],
  spawnPoints: [
    [-16, 1, -16], [16, 1, -16], [-16, 1, 16], [16, 1, 16], [0, 1, -16], [0, 1, 16], [-16, 1, 0], [16, 1, 0],
  ],
  parts: [
    // Aceras (bordillo bajo: se sube andando) y edificios en una cuadrícula 3x3 sin el centro.
    ...[-32, 0, 32].flatMap((x) => [-32, 0, 32].flatMap((z): MapPart[] => {
      if (x === 0 && z === 0) return [];
      const seed = Math.abs(x * 7 + z * 13);
      const h = 6 + (seed % 4) * 4;
      const colors = [0xe17055, 0xfdcb6e, 0x74b9ff, 0xa29bfe, 0x55efc4, 0xfab1a0, 0xdfe6e9, 0xffeaa7];
      return [
        box([x, 0.075, z], [24, 0.15, 24], SIDEWALK),
        ...building(x, z, 14 + (seed % 3) * 2, 14 - (seed % 2) * 2, h, colors[seed % colors.length]),
        ...lamp(x - 11, z - 11), ...lamp(x + 11, z + 11),
      ];
    })),
    // Rampa hasta la azotea (6 m) del edificio de la esquina (-32, -32), desde la calle de al lado
    ramp(-32, -17.5, 0, 15, 6, 3, 0x95a5a6),
    // Plaza central con fuente
    box([0, 0.075, 0], [20, 0.15, 20], 0xc8d6e5),
    { kind: 'cylinder', radius: 3, height: 0.7, pos: [0, 0.35, 0], color: 0xb2bec3, segments: 12 },
    { kind: 'cylinder', radius: 2.6, height: 0.1, pos: [0, 0.68, 0], color: 0x48dbfb, segments: 12, solid: false },
    { kind: 'cylinder', radius: 0.35, height: 2, pos: [0, 1, 0], color: 0xb2bec3, segments: 8 },
    // Líneas de la carretera (decorativas)
    ...[-16, 16].flatMap((c) => [-48, -40, -24, -8, 8, 24, 40, 48].flatMap((t) => [
      box([c, 0.01, t], [0.3, 0.02, 3], 0xf5f6fa, { solid: false }),
      box([t, 0.01, c], [3, 0.02, 0.3], 0xf5f6fa, { solid: false }),
    ])),
    // Coches aparcados
    ...parkedCar(-14.5, 5, 0, 0xc0392b), ...parkedCar(14.5, -6, Math.PI, 0x2980b9), ...parkedCar(4, 17.5, Math.PI / 2, 0x27ae60),
  ],
  props: [
    { type: 'cone', pos: [-14, 0.4, 10] },
    { type: 'cone', pos: [-14, 0.4, 12] },
    { type: 'barrier', pos: [14, 0.5, 10] },
    { type: 'drum_blue', pos: [20, 0.65, -20] },
    { type: 'cardboard', pos: [-20, 0.45, 20] },
    { type: 'bench', pos: [6, 0.5, -6] },
    { type: 'buggy', pos: [0, 1, 24] },
  ],
};

// ---------------------------------------------------------------- Isla

const island: MapDef = {
  id: 'island',
  name: 'Isla',
  description: 'Isla tropical con colina, palmeras, rocas y un muelle. ¡Cuidado con el mar!',
  groundSize: 56,
  groundColors: [0xf6e58d, 0xf0dc7a, 0xf9eaa0, 0xead27a],
  skyTop: 0x48a9e6,
  skyBottom: 0xfde3c0,
  fog: [70, 260],
  spawnPoints: [
    [18, 1, 18], [-18, 1, 18], [18, 1, -18], [-18, 1, -18], [22, 1, 0], [0, 1, 22], [-22, 1, 4], [6, 1, -22],
  ],
  water: { level: -0.5, color: 0x1e90ff },
  killY: -1.5,
  parts: [
    // Colina en terrazas con rampas
    block(-6, -6, 22, 22, 1.2, 0x6ab04c),
    block(-6, -6, 14, 14, 2.4, 0x5c9e40, 1.2),
    block(-6, -6, 7, 7, 3.6, 0x4f8c36, 2.4),
    ramp(-6, 8, 0, 5, 1.2, 3, 0x6ab04c),
    ramp(-6, 3.5, 0, 4, 1.2, 2.5, 0x5c9e40, 1.2),
    ramp(-6, -0.75, 0, 3, 1.2, 2, 0x4f8c36, 2.4),
    // Palmeras y rocas en la playa
    ...palm(16, 12, 0.2), ...palm(20, -8, -0.15), ...palm(-20, 16, 0.18), ...palm(10, -20, 0.1), ...palm(-22, -20, -0.2),
    rock(14, 22, 1.2), rock(-24, 6, 1.6, 0x95a5a6), rock(23, -22, 1.1), rock(-10, 22, 0.9, 0x95a5a6),
    // Muelle sobre el agua
    box([34, 0.2, 10], [14, 0.2, 3], 0xa0784a),
    ...[29, 33, 37, 41].map((x) => ({ kind: 'cylinder', radius: 0.15, height: 1.2, pos: [x, -0.4, 11.3], color: 0x6e4219, segments: 6, solid: false }) as MapPart),
    // Cabaña
    ...building(12, 4, 5, 4, 3, 0xd6a368, 0x8d5a2b),
  ],
  props: [
    { type: 'barrel', pos: [15, 0.55, 2] },
    { type: 'crate', pos: [9, 0.5, 9] },
    { type: 'ball', pos: [0, 0.6, 18] },
    { type: 'drum_explosive', pos: [-16, 0.5, -12] },
    { type: 'buggy', pos: [20, 1, 20] },
  ],
};

// ---------------------------------------------------------------- Parkour / rampas

const P1 = 0xff7675, P2 = 0x74b9ff, P3 = 0x55efc4, P4 = 0xfdcb6e;
const parkour: MapDef = {
  id: 'parkour',
  name: 'Parkour y rampas',
  description: 'Recorrido de saltos hasta lo alto de una torre, tobogán gigante y rampas para coches.',
  groundSize: 90,
  groundColors: [0xa4b0be, 0x95a5b5, 0xb2bec3, 0x9aa8b6],
  skyTop: 0x6c5ce7,
  skyBottom: 0xfab1a0,
  fog: [60, 200],
  spawnPoints: [[-3, 1, 28], [0, 1, 28], [3, 1, 28], [-3, 1, 31], [0, 1, 31], [3, 1, 31], [-6, 1, 29], [6, 1, 29]],
  parts: [
    // Rampa de salida y saltos entre pilares cada vez más altos
    ramp(0, 21, 0, 6, 2, 4, P1),
    block(0, 15, 6, 6, 2, P1),
    block(0, 8.5, 3, 3, 2.5, P2),
    block(3, 3, 3, 3, 3, P3),
    block(-2, -2.5, 3, 3, 3.5, P4),
    block(0, -9, 6, 6, 4, P1),
    // Rampa hasta la plataforma alta y viga de equilibrio hacia la torre
    ramp(0, -16, 0, 8, 3, 3, P2, 4),
    block(0, -23, 6, 6, 7, P3),
    box([0, 7.05, -30.5], [1.2, 0.3, 9], P4),
    // Torre con plataformas en espiral
    block(0, -40, 4, 4, 16, 0xdfe6e9),
    ...Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI / 2 + (i * Math.PI) / 4;
      return block(Math.cos(a) * 4.2, -40 + Math.sin(a) * 4.2, 2.6, 2.6, 8.2 + i * 1.1, [P1, P2, P3, P4][i % 4], 7.6 + i * 1.1);
    }),
    // Tobogán gigante desde lo alto de la torre (lado -X: las plataformas de la espiral quedan debajo)
    ramp(-14, -40, -Math.PI / 2, 24, 16, 4, P1),
    // Zona de rampas para vehículos
    ramp(-30, 10, 0, 5, 1.5, 6, P2), ramp(-30, -10, Math.PI, 5, 1.5, 6, P2),
    ramp(-20, -25, Math.PI / 2, 6, 2.5, 6, P3),
    block(-30, 0, 6, 6, 1.5, P4),
    ramp(30, 0, -Math.PI / 2, 10, 4, 6, P3),
  ],
  props: [
    { type: 'buggy', pos: [-30, 1, 22] },
    { type: 'buggy', pos: [-24, 1, 22] },
    { type: 'ball_giant', pos: [10, 1.5, 20] },
    { type: 'cone', pos: [-30, 0.4, 16] },
    { type: 'cone', pos: [-27, 0.4, 16] },
  ],
};

const defs: MapDef[] = [flatgrass, arena, city, island, parkour];

export const MAPS: Record<string, MapDef> = Object.fromEntries(defs.map((d) => [d.id, d]));
export const MAP_LIST: readonly MapDef[] = defs;
export const DEFAULT_MAP = 'flatgrass';

export function getMap(id: string | undefined): MapDef {
  return (id && MAPS[id]) || MAPS[DEFAULT_MAP];
}

/** Rotación de una pieza del mapa como cuaternión. */
export function partQuat(p: MapPart): [number, number, number, number] {
  return p.rot ? eulerYXZ(p.rot[0], p.rot[1], p.rot[2]) : [0, 0, 0, 1];
}

/** Formas de colisión estáticas del mapa para el controlador del jugador (servidor y cliente). */
export function staticShapes(map: MapDef): Shape[] {
  const shapes: Shape[] = [{ kind: 'ground', half: map.groundSize / 2 }];
  for (const p of map.parts) {
    if (p.solid === false) continue;
    addPropShapes([{ ...p, pos: undefined }], p.pos[0], p.pos[1], p.pos[2], partQuat(p), undefined, shapes);
  }
  return shapes;
}
