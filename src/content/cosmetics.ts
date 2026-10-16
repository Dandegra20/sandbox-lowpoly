// Registro de personalización del personaje. Añadir un sombrero, unas gafas, una mochila o un
// patrón = añadir una entrada a su lista. Todo se genera por código: los accesorios son piezas
// low-poly y los patrones se dibujan en un canvas que se aplica al torso.

import type { PartShape } from '../shared/collision';
import type { Vec3 } from '../shared/protocol';

/** Aspecto de un jugador: se guarda en localStorage y viaja al servidor al entrar. */
export interface Appearance {
  body: number;
  arms: number;
  legs: number;
  head: number;
  /** Color de detalle: patrón del torso y partes "accent" de los accesorios. */
  accent: number;
  hat: string;
  glasses: string;
  backpack: string;
  pattern: string;
}

export type CosmeticSlot = 'hat' | 'glasses' | 'backpack';

/** Color de una pieza: fijo, o el del jugador ('accent' / 'body'). */
export type CosmeticColor = number | 'accent' | 'body';

export type CosmeticPart = PartShape & {
  /** Relativa al punto de anclaje del hueco (ver abajo). Frente del personaje = -Z. */
  pos?: Vec3;
  /** Rotación en radianes (orden XYZ). */
  rot?: Vec3;
  color: CosmeticColor;
  segments?: number;
};

export interface CosmeticDef {
  id: string;
  name: string;
  slot: CosmeticSlot;
  parts: CosmeticPart[];
}

export interface PatternDef {
  id: string;
  name: string;
  /** Dibuja el patrón en un canvas cuadrado ya relleno con el color del cuerpo. */
  draw(ctx: CanvasRenderingContext2D, size: number, accent: string): void;
}

// Puntos de anclaje (los aplica PlayerModel):
// - hat:      centro de la parte superior de la cabeza.
// - glasses:  centro de la cara (superficie delantera de la cabeza, a la altura de los ojos).
// - backpack: centro de la espalda (superficie trasera del torso); hacia fuera = +Z.

const DARK = 0x2d3436;
const GOLD = 0xf9ca24;
const WHITE = 0xf5f6fa;
const METAL = 0x95a5a6;
const BROWN = 0x8d5a2b;

export const COSMETICS: CosmeticDef[] = [
  // ---------------------------------------------------------------- sombreros
  { id: 'none', name: 'Ninguno', slot: 'hat', parts: [] },
  {
    id: 'cap', name: 'Gorra', slot: 'hat', parts: [
      { kind: 'box', size: [0.46, 0.12, 0.46], pos: [0, 0.06, 0], color: 'accent' },
      { kind: 'box', size: [0.4, 0.03, 0.22], pos: [0, 0.015, -0.3], color: 'accent' },
    ],
  },
  {
    id: 'tophat', name: 'Chistera', slot: 'hat', parts: [
      { kind: 'cylinder', radius: 0.32, height: 0.03, pos: [0, 0.015, 0], color: DARK, segments: 12 },
      { kind: 'cylinder', radius: 0.2, height: 0.38, pos: [0, 0.21, 0], color: DARK, segments: 12 },
      { kind: 'cylinder', radius: 0.205, height: 0.06, pos: [0, 0.07, 0], color: 'accent', segments: 12 },
    ],
  },
  {
    id: 'hardhat', name: 'Casco de obra', slot: 'hat', parts: [
      { kind: 'cylinder', radius: 0.26, height: 0.15, pos: [0, 0.075, 0], color: GOLD, segments: 10 },
      { kind: 'cylinder', radius: 0.31, height: 0.03, pos: [0, 0.015, 0], color: GOLD, segments: 10 },
      { kind: 'box', size: [0.06, 0.05, 0.5], pos: [0, 0.16, 0], color: GOLD },
    ],
  },
  {
    id: 'beanie', name: 'Gorro de lana', slot: 'hat', parts: [
      { kind: 'box', size: [0.46, 0.16, 0.46], pos: [0, 0.06, 0], color: 'accent' },
      { kind: 'box', size: [0.47, 0.06, 0.47], pos: [0, 0.0, 0], color: WHITE },
      { kind: 'ball', radius: 0.07, pos: [0, 0.19, 0], color: WHITE },
    ],
  },
  {
    id: 'crown', name: 'Corona', slot: 'hat', parts: [
      { kind: 'cylinder', radius: 0.22, height: 0.12, pos: [0, 0.06, 0], color: GOLD, segments: 6 },
      ...[0, 1, 2, 3, 4, 5].map((i) => ({
        kind: 'cone' as const, radius: 0.05, height: 0.12, color: GOLD, segments: 4,
        pos: [Math.cos((i * Math.PI) / 3) * 0.19, 0.17, Math.sin((i * Math.PI) / 3) * 0.19] as Vec3,
      })),
      { kind: 'ball', radius: 0.04, pos: [0, 0.07, -0.22], color: 0xe74c3c },
    ],
  },
  {
    id: 'party', name: 'Gorro de fiesta', slot: 'hat', parts: [
      { kind: 'cone', radius: 0.16, height: 0.4, pos: [0, 0.2, 0], color: 'accent', segments: 8 },
      { kind: 'ball', radius: 0.05, pos: [0, 0.42, 0], color: WHITE },
    ],
  },
  {
    id: 'cowboy', name: 'Sombrero vaquero', slot: 'hat', parts: [
      { kind: 'box', size: [0.72, 0.03, 0.6], pos: [0, 0.015, 0], color: BROWN },
      { kind: 'box', size: [0.36, 0.18, 0.34], pos: [0, 0.11, 0], color: BROWN },
      { kind: 'box', size: [0.37, 0.04, 0.35], pos: [0, 0.04, 0], color: DARK },
    ],
  },

  // ---------------------------------------------------------------- gafas
  { id: 'none', name: 'Ninguna', slot: 'glasses', parts: [] },
  {
    id: 'sunglasses', name: 'Gafas de sol', slot: 'glasses', parts: [
      { kind: 'box', size: [0.14, 0.08, 0.03], pos: [-0.09, 0.0, -0.015], color: DARK },
      { kind: 'box', size: [0.14, 0.08, 0.03], pos: [0.09, 0.0, -0.015], color: DARK },
      { kind: 'box', size: [0.06, 0.02, 0.02], pos: [0, 0.02, -0.015], color: DARK },
    ],
  },
  {
    id: 'round', name: 'Gafas redondas', slot: 'glasses', parts: [
      { kind: 'cylinder', radius: 0.065, height: 0.02, axis: 'z', pos: [-0.09, 0, -0.012], color: DARK, segments: 10 },
      { kind: 'cylinder', radius: 0.065, height: 0.02, axis: 'z', pos: [0.09, 0, -0.012], color: DARK, segments: 10 },
      { kind: 'cylinder', radius: 0.05, height: 0.024, axis: 'z', pos: [-0.09, 0, -0.012], color: 0xa5d8ff, segments: 10 },
      { kind: 'cylinder', radius: 0.05, height: 0.024, axis: 'z', pos: [0.09, 0, -0.012], color: 0xa5d8ff, segments: 10 },
    ],
  },
  {
    id: 'goggles', name: 'Gafas de esquí', slot: 'glasses', parts: [
      { kind: 'box', size: [0.44, 0.13, 0.05], pos: [0, 0, -0.025], color: 'accent' },
      { kind: 'box', size: [0.36, 0.09, 0.06], pos: [0, 0, -0.03], color: 0x74b9ff },
    ],
  },
  {
    id: 'monocle', name: 'Monóculo', slot: 'glasses', parts: [
      { kind: 'cylinder', radius: 0.07, height: 0.02, axis: 'z', pos: [0.09, 0, -0.012], color: GOLD, segments: 10 },
      { kind: 'cylinder', radius: 0.055, height: 0.024, axis: 'z', pos: [0.09, 0, -0.012], color: 0xdff9fb, segments: 10 },
      { kind: 'box', size: [0.01, 0.2, 0.01], pos: [0.15, -0.1, -0.012], color: GOLD },
    ],
  },
  {
    id: '3d', name: 'Gafas 3D', slot: 'glasses', parts: [
      { kind: 'box', size: [0.4, 0.11, 0.02], pos: [0, 0, -0.01], color: WHITE },
      { kind: 'box', size: [0.13, 0.07, 0.025], pos: [-0.09, 0, -0.015], color: 0xe74c3c },
      { kind: 'box', size: [0.13, 0.07, 0.025], pos: [0.09, 0, -0.015], color: 0x00cec9 },
    ],
  },

  // ---------------------------------------------------------------- mochilas
  { id: 'none', name: 'Ninguna', slot: 'backpack', parts: [] },
  {
    id: 'backpack', name: 'Mochila', slot: 'backpack', parts: [
      { kind: 'box', size: [0.46, 0.5, 0.2], pos: [0, 0, 0.1], color: 'accent' },
      { kind: 'box', size: [0.32, 0.18, 0.06], pos: [0, -0.12, 0.22], color: DARK },
    ],
  },
  {
    id: 'jetpack', name: 'Jetpack', slot: 'backpack', parts: [
      { kind: 'cylinder', radius: 0.09, height: 0.45, pos: [-0.11, 0, 0.12], color: METAL, segments: 8 },
      { kind: 'cylinder', radius: 0.09, height: 0.45, pos: [0.11, 0, 0.12], color: METAL, segments: 8 },
      { kind: 'cone', radius: 0.08, height: 0.12, pos: [-0.11, -0.28, 0.12], rot: [Math.PI, 0, 0], color: DARK, segments: 8 },
      { kind: 'cone', radius: 0.08, height: 0.12, pos: [0.11, -0.28, 0.12], rot: [Math.PI, 0, 0], color: DARK, segments: 8 },
      { kind: 'box', size: [0.42, 0.08, 0.2], pos: [0, 0.1, 0.12], color: 'accent' },
    ],
  },
  {
    id: 'wings', name: 'Alas', slot: 'backpack', parts: [
      { kind: 'box', size: [0.55, 0.32, 0.03], pos: [-0.3, 0.08, 0.08], rot: [0, -0.5, 0.3], color: 'accent' },
      { kind: 'box', size: [0.55, 0.32, 0.03], pos: [0.3, 0.08, 0.08], rot: [0, 0.5, -0.3], color: 'accent' },
    ],
  },
  {
    id: 'cape', name: 'Capa', slot: 'backpack', parts: [
      { kind: 'box', size: [0.64, 0.8, 0.03], pos: [0, -0.18, 0.06], rot: [-0.12, 0, 0], color: 'accent' },
      { kind: 'box', size: [0.66, 0.06, 0.06], pos: [0, 0.22, 0.03], color: GOLD },
    ],
  },
  {
    id: 'tank', name: 'Botella de buceo', slot: 'backpack', parts: [
      { kind: 'cylinder', radius: 0.12, height: 0.55, pos: [0, 0, 0.14], color: 0xf1c40f, segments: 10 },
      { kind: 'cylinder', radius: 0.04, height: 0.1, pos: [0, 0.32, 0.14], color: METAL, segments: 6 },
      { kind: 'box', size: [0.5, 0.05, 0.05], pos: [0, 0.12, 0.04], color: DARK },
    ],
  },
];

/** Patrones del torso (canvas pequeño, se ve "pixelado" a propósito). */
export const PATTERNS: PatternDef[] = [
  { id: 'none', name: 'Liso', draw: () => {} },
  {
    id: 'stripes_h', name: 'Rayas', draw(ctx, s, accent) {
      ctx.fillStyle = accent;
      for (let y = 0; y < s; y += s / 4) ctx.fillRect(0, y, s, s / 8);
    },
  },
  {
    id: 'stripes_v', name: 'Rayas verticales', draw(ctx, s, accent) {
      ctx.fillStyle = accent;
      for (let x = 0; x < s; x += s / 4) ctx.fillRect(x, 0, s / 8, s);
    },
  },
  {
    id: 'checker', name: 'Cuadros', draw(ctx, s, accent) {
      ctx.fillStyle = accent;
      const c = s / 4;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) ctx.fillRect(x * c, y * c, c, c);
    },
  },
  {
    id: 'dots', name: 'Lunares', draw(ctx, s, accent) {
      ctx.fillStyle = accent;
      const c = s / 4;
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          ctx.beginPath();
          ctx.arc(x * c + c / 2 + (y % 2) * (c / 4), y * c + c / 2, c / 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    id: 'zigzag', name: 'Zigzag', draw(ctx, s, accent) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = s / 12;
      for (let row = 0; row < 3; row++) {
        const y = s * (0.2 + row * 0.3);
        ctx.beginPath();
        for (let i = 0; i <= 8; i++) ctx.lineTo((i / 8) * s, y + (i % 2 ? s / 12 : -s / 12));
        ctx.stroke();
      }
    },
  },
  {
    id: 'number', name: 'Dorsal', draw(ctx, s, accent) {
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, s, s / 10);
      ctx.font = `bold ${Math.round(s * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('7', s / 2, s * 0.58);
    },
  },
];

/** Colores propuestos en el editor (también se puede elegir cualquiera). */
export const LOOK_COLORS = [
  0xe74c3c, 0xe67e22, 0xf1c40f, 0x2ecc71, 0x1abc9c, 0x3498db, 0x2c3e50, 0x9b59b6,
  0xfd79a8, 0xffeaa7, 0xf3c9a6, 0xc68642, 0x8d5524, 0xffffff, 0x95a5a6, 0x111111,
];

export const COSMETICS_BY_SLOT: Record<CosmeticSlot, CosmeticDef[]> = {
  hat: COSMETICS.filter((c) => c.slot === 'hat'),
  glasses: COSMETICS.filter((c) => c.slot === 'glasses'),
  backpack: COSMETICS.filter((c) => c.slot === 'backpack'),
};

export function getCosmetic(slot: CosmeticSlot, id: string): CosmeticDef {
  return COSMETICS_BY_SLOT[slot].find((c) => c.id === id) ?? COSMETICS_BY_SLOT[slot][0];
}

export function getPattern(id: string): PatternDef {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS[0];
}

export const DEFAULT_LOOK: Appearance = {
  body: 0x3498db, arms: 0x3498db, legs: 0x2c3e50, head: 0xf3c9a6, accent: 0xf1c40f,
  hat: 'none', glasses: 'none', backpack: 'none', pattern: 'none',
};

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** Aspecto aleatorio (el primero de cada jugador, para que no todos salgan iguales). */
export function randomLook(): Appearance {
  const body = pick(LOOK_COLORS.slice(0, 9));
  return {
    body, arms: body, legs: pick([0x2c3e50, 0x34495e, 0x8d5524, 0x111111]),
    head: pick([0xf3c9a6, 0xc68642, 0x8d5524, 0xffeaa7]), accent: pick(LOOK_COLORS.slice(0, 9)),
    hat: pick(COSMETICS_BY_SLOT.hat).id, glasses: Math.random() < 0.4 ? pick(COSMETICS_BY_SLOT.glasses).id : 'none',
    backpack: Math.random() < 0.4 ? pick(COSMETICS_BY_SLOT.backpack).id : 'none', pattern: pick(PATTERNS).id,
  };
}

/**
 * Valida un aspecto recibido (servidor) o leído de localStorage (cliente): colores enteros
 * 0..0xffffff y accesorios que existan en el registro. Lo inválido toma el valor por defecto.
 */
export function sanitizeLook(raw: unknown): Appearance {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const color = (v: unknown, d: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff ? v : d;
  const item = (slot: CosmeticSlot, v: unknown) =>
    typeof v === 'string' && COSMETICS_BY_SLOT[slot].some((c) => c.id === v) ? v : 'none';
  return {
    body: color(r.body, DEFAULT_LOOK.body),
    arms: color(r.arms, DEFAULT_LOOK.arms),
    legs: color(r.legs, DEFAULT_LOOK.legs),
    head: color(r.head, DEFAULT_LOOK.head),
    accent: color(r.accent, DEFAULT_LOOK.accent),
    hat: item('hat', r.hat),
    glasses: item('glasses', r.glasses),
    backpack: item('backpack', r.backpack),
    pattern: typeof r.pattern === 'string' && PATTERNS.some((p) => p.id === r.pattern) ? r.pattern : 'none',
  };
}
