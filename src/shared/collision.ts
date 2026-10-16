// Colisiones de la cápsula del jugador contra formas simples.
// Código determinista compartido: el servidor lo usa para mover a los jugadores y el
// cliente para predecir su propio movimiento, así ambos llegan al mismo resultado.
// La cápsula del jugador es siempre vertical: segmento de (y - halfHeight) a (y + halfHeight).

import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from './constants';

export type Quat4 = [number, number, number, number];

/**
 * Pieza de un objeto (los objetos se componen de varias). La usan los registros de contenido:
 * el servidor crea un colisionador de Rapier por pieza y el cliente fusiona su geometría.
 * `pos` es relativa al origen del objeto. Los cilindros van a lo largo de `axis` (por defecto Y);
 * los conos, con la punta hacia +Y.
 */
export type PartShape =
  | { kind: 'box'; size: [number, number, number] }
  | { kind: 'ball'; radius: number }
  | { kind: 'cylinder'; radius: number; height: number; axis?: 'x' | 'y' | 'z' }
  | { kind: 'cone'; radius: number; height: number };

export type PartDesc = PartShape & {
  pos?: [number, number, number];
  /** Solo decorativa: se dibuja pero no colisiona. */
  visualOnly?: boolean;
};

export type Shape =
  /** Losa del suelo del mapa: superficie en y = 0, cuadrada de lado 2*half. */
  | { kind: 'ground'; half: number }
  /** Caja orientada (q = null => sin rotación). */
  | { kind: 'box'; x: number; y: number; z: number; hx: number; hy: number; hz: number; q: Quat4 | null; propId?: number }
  | { kind: 'sphere'; x: number; y: number; z: number; r: number; propId?: number }
  /** Otro jugador (cápsula vertical). */
  | { kind: 'capsule'; x: number; y: number; z: number; half: number; r: number; playerId?: number };

export interface Contact {
  /** Normal que saca a la cápsula de la forma. */
  nx: number;
  ny: number;
  nz: number;
  depth: number;
}

/** Profundidad máxima por debajo del suelo que aún se resuelve (más abajo => caes del mapa). */
const GROUND_THICKNESS = 4;

const Q_X90: Quat4 = [0, 0, Math.SQRT1_2, Math.SQRT1_2]; // Y -> X (90º sobre Z)
const Q_Z90: Quat4 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // Y -> Z (90º sobre X)

/** Rotación local de una pieza (los cilindros tumbados). */
export function partRotation(p: PartDesc): Quat4 | null {
  if (p.kind !== 'cylinder' || !p.axis || p.axis === 'y') return null;
  return p.axis === 'x' ? Q_X90 : Q_Z90;
}

/**
 * Cuaternión a partir de ángulos de Euler en orden 'YXZ' (el de THREE.Euler(x, y, z, 'YXZ')):
 * primero el giro Z, luego X (inclinación) y por último Y (orientación). Para rampas:
 * x = pendiente, y = hacia dónde mira.
 */
export function eulerYXZ(x: number, y: number, z: number): Quat4 {
  const qy: Quat4 = [0, Math.sin(y / 2), 0, Math.cos(y / 2)];
  const qx: Quat4 = [Math.sin(x / 2), 0, 0, Math.cos(x / 2)];
  const qz: Quat4 = [0, 0, Math.sin(z / 2), Math.cos(z / 2)];
  return quatMul(quatMul(qy, qx), qz);
}

/** Producto de cuaterniones a * b. */
export function quatMul(a: Quat4, b: Quat4): Quat4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

const tmpP = [0, 0, 0];

/**
 * Añade a `out` las formas de colisión de un objeto (una por pieza sólida) en su pose.
 * Para el controlador del jugador los cilindros y conos se aproximan con cajas orientadas:
 * basta para chocar y subirse encima, y mantiene el código de colisión simple.
 */
export function addPropShapes(
  parts: readonly PartDesc[], x: number, y: number, z: number, q: Quat4, propId: number | undefined, out: Shape[], scale = 1,
): void {
  const s = scale;
  for (const p of parts) {
    if (p.visualOnly) continue;
    let cx = x, cy = y, cz = z;
    if (p.pos) {
      rotate(q, p.pos[0] * s, p.pos[1] * s, p.pos[2] * s, false, tmpP);
      cx += tmpP[0]; cy += tmpP[1]; cz += tmpP[2];
    }
    switch (p.kind) {
      case 'ball':
        out.push({ kind: 'sphere', x: cx, y: cy, z: cz, r: p.radius * s, propId });
        break;
      case 'box':
        out.push({ kind: 'box', x: cx, y: cy, z: cz, hx: (p.size[0] / 2) * s, hy: (p.size[1] / 2) * s, hz: (p.size[2] / 2) * s, q, propId });
        break;
      case 'cylinder': {
        const r = p.radius * 0.95 * s, h = (p.height / 2) * s;
        const [hx, hy, hz] = p.axis === 'x' ? [h, r, r] : p.axis === 'z' ? [r, r, h] : [r, h, r];
        out.push({ kind: 'box', x: cx, y: cy, z: cz, hx, hy, hz, q, propId });
        break;
      }
      case 'cone': {
        const r = p.radius * 0.7 * s;
        out.push({ kind: 'box', x: cx, y: cy, z: cz, hx: r, hy: (p.height / 2) * s, hz: r, q, propId });
        break;
      }
    }
  }
}

/** Radio de una esfera que envuelve la forma (para descartar formas lejanas). */
export function boundingRadius(s: Shape): number {
  switch (s.kind) {
    case 'ground': return Infinity;
    case 'box': return Math.hypot(s.hx, s.hy, s.hz);
    case 'sphere': return s.r;
    case 'capsule': return s.half + s.r;
  }
}

/** Rota v por q (o por su inversa) y lo escribe en out. */
function rotate(q: Quat4, vx: number, vy: number, vz: number, inverse: boolean, out: number[]): void {
  const qx = inverse ? -q[0] : q[0];
  const qy = inverse ? -q[1] : q[1];
  const qz = inverse ? -q[2] : q[2];
  const qw = q[3];
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const tmpA = [0, 0, 0];
const tmpB = [0, 0, 0];

/**
 * Contacto entre la cápsula del jugador (centro px,py,pz) y una forma.
 * Devuelve true y rellena `out` si se penetran.
 */
export function capsuleContact(px: number, py: number, pz: number, s: Shape, out: Contact): boolean {
  const R = PLAYER_RADIUS;
  const H = PLAYER_HALF_HEIGHT;

  switch (s.kind) {
    case 'ground': {
      if (Math.abs(px) > s.half || Math.abs(pz) > s.half) return false;
      const feet = py - H - R;
      if (feet >= 0 || feet < -GROUND_THICKNESS) return false;
      out.nx = 0; out.ny = 1; out.nz = 0; out.depth = -feet;
      return true;
    }

    case 'sphere': {
      const cy = clamp(s.y, py - H, py + H);
      return sphereResult(px - s.x, cy - s.y, pz - s.z, R + s.r, out);
    }

    case 'capsule': {
      // Dos segmentos verticales: punto más cercano por alturas.
      let y1 = clamp(s.y, py - H, py + H);
      const y2 = clamp(y1, s.y - s.half, s.y + s.half);
      y1 = clamp(y2, py - H, py + H);
      return sphereResult(px - s.x, y1 - y2, pz - s.z, R + s.r, out);
    }

    case 'box': {
      // Pasar el segmento al espacio local de la caja.
      const q = s.q;
      if (q) {
        rotate(q, px - s.x, py - H - s.y, pz - s.z, true, tmpA);
        rotate(q, px - s.x, py + H - s.y, pz - s.z, true, tmpB);
      } else {
        tmpA[0] = px - s.x; tmpA[1] = py - H - s.y; tmpA[2] = pz - s.z;
        tmpB[0] = tmpA[0]; tmpB[1] = py + H - s.y; tmpB[2] = tmpA[2];
      }
      const ax = tmpA[0], ay = tmpA[1], az = tmpA[2];
      const dx = tmpB[0] - ax, dy = tmpB[1] - ay, dz = tmpB[2] - az;
      const len2 = dx * dx + dy * dy + dz * dz;

      // Punto del segmento más cercano a la caja: alternamos proyecciones (converge rápido en convexos).
      let t = clamp(-(ax * dx + ay * dy + az * dz) / len2, 0, 1);
      let sx = 0, sy = 0, sz = 0, cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 4; i++) {
        sx = ax + dx * t; sy = ay + dy * t; sz = az + dz * t;
        cx = clamp(sx, -s.hx, s.hx); cy = clamp(sy, -s.hy, s.hy); cz = clamp(sz, -s.hz, s.hz);
        t = clamp(((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2, 0, 1);
      }
      sx = ax + dx * t; sy = ay + dy * t; sz = az + dz * t;
      cx = clamp(sx, -s.hx, s.hx); cy = clamp(sy, -s.hy, s.hy); cz = clamp(sz, -s.hz, s.hz);

      let nx = sx - cx, ny = sy - cy, nz = sz - cz;
      const dist = Math.hypot(nx, ny, nz);
      let depth: number;
      if (dist > 1e-5) {
        if (dist >= R) return false;
        nx /= dist; ny /= dist; nz /= dist;
        depth = R - dist;
      } else {
        // El eje de la cápsula está dentro de la caja: salir por la cara más cercana.
        const ex = s.hx - Math.abs(sx), ey = s.hy - Math.abs(sy), ez = s.hz - Math.abs(sz);
        nx = ny = nz = 0;
        if (ey <= ex && ey <= ez) { ny = sy >= 0 ? 1 : -1; depth = ey + R; }
        else if (ex <= ez) { nx = sx >= 0 ? 1 : -1; depth = ex + R; }
        else { nz = sz >= 0 ? 1 : -1; depth = ez + R; }
      }
      if (q) {
        rotate(q, nx, ny, nz, false, tmpA);
        nx = tmpA[0]; ny = tmpA[1]; nz = tmpA[2];
      }
      out.nx = nx; out.ny = ny; out.nz = nz; out.depth = depth;
      return true;
    }
  }
}

function sphereResult(dx: number, dy: number, dz: number, minDist: number, out: Contact): boolean {
  const dist = Math.hypot(dx, dy, dz);
  if (dist >= minDist) return false;
  if (dist < 1e-5) {
    out.nx = 0; out.ny = 1; out.nz = 0;
  } else {
    out.nx = dx / dist; out.ny = dy / dist; out.nz = dz / dist;
  }
  out.depth = minDist - dist;
  return true;
}

/**
 * Rayo (origen o, dirección normalizada d) contra una cápsula vertical.
 * Devuelve la distancia al primer impacto (<= maxT) o null.
 */
export function rayCapsule(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  half: number, r: number, maxT: number,
): number | null {
  let best = Infinity;
  // Cuerpo cilíndrico (en el plano XZ).
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = 2 * (px * dx + pz * dz);
    const c = px * px + pz * pz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      const y = oy + dy * t;
      if (t >= 0 && y >= cy - half && y <= cy + half) best = t;
    }
  }
  // Semiesferas de los extremos.
  for (const ey of [cy - half, cy + half]) {
    const qx = ox - cx, qy = oy - ey, qz = oz - cz;
    const b = qx * dx + qy * dy + qz * dz;
    const c = qx * qx + qy * qy + qz * qz - r * r;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t >= 0 && t < best) best = t;
  }
  return best <= maxT ? best : null;
}

/** Distancia de un punto a la superficie de una cápsula vertical (0 si está dentro). */
export function pointCapsuleDistance(
  x: number, y: number, z: number,
  cx: number, cy: number, cz: number,
  half: number, r: number,
): number {
  const ny = clamp(y, cy - half, cy + half);
  return Math.max(0, Math.hypot(x - cx, y - ny, z - cz) - r);
}
