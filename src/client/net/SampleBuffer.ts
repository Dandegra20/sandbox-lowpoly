import { Quaternion, Vector3 } from 'three';
import { SNAPSHOT_MS } from '../../shared/constants';

interface Sample {
  t: number;
  pos: Vector3;
  rot: Quaternion;
  /** Valor escalar extra interpolado (p. ej. el pitch de la cabeza de un jugador). */
  aux: number;
  /** Salto brusco respecto a la muestra anterior: no se interpola, se cambia de golpe. */
  teleport: boolean;
}

const MAX_SAMPLES = 32;
/** Distancia a partir de la cual dos muestras seguidas se consideran un teletransporte. */
const TELEPORT_DISTANCE = 6;

/**
 * Historial de poses de una entidad remota para interpolar entre snapshots.
 * Tiempo en ms del servidor (tick * duración del tick).
 */
export class SampleBuffer {
  private samples: Sample[] = [];

  /** @param maxExtrapolateMs  Cuánto se puede extrapolar si faltan snapshots (pérdida/jitter). */
  constructor(private maxExtrapolateMs = 0) {}

  push(t: number, pos: Vector3, rot: Quaternion, aux = 0): void {
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;
    // Si hubo un hueco (p. ej. el objeto dormía y no se enviaba), fijamos la pose anterior
    // justo antes de la nueva para no "arrastrar" el movimiento durante todo el hueco.
    if (last && t - last.t > SNAPSHOT_MS * 2.5) {
      this.samples.push({ t: t - SNAPSHOT_MS, pos: last.pos.clone(), rot: last.rot.clone(), aux: last.aux, teleport: false });
    }
    const teleport = !!last && last.pos.distanceTo(pos) > TELEPORT_DISTANCE;
    this.samples.push({ t, pos: pos.clone(), rot: rot.clone(), aux, teleport });
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  get latest(): Sample | undefined {
    return this.samples[this.samples.length - 1];
  }

  get isEmpty(): boolean {
    return this.samples.length === 0;
  }

  /** Velocidad (unidades/ms) entre las dos últimas muestras; 0 si no hay o hubo teletransporte. */
  velocity(out: Vector3): Vector3 {
    const n = this.samples.length;
    if (n < 2 || this.samples[n - 1].teleport) return out.set(0, 0, 0);
    const a = this.samples[n - 2];
    const b = this.samples[n - 1];
    return out.subVectors(b.pos, a.pos).divideScalar(b.t - a.t);
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** Escribe en out* la pose en el instante t. Devuelve el aux interpolado, o null si no hay datos. */
  sample(t: number, outPos: Vector3, outRot: Quaternion): number | null {
    const s = this.samples;
    const n = s.length;
    if (n === 0) return null;
    if (t <= s[0].t || n === 1) {
      outPos.copy(s[0].pos);
      outRot.copy(s[0].rot);
      return s[0].aux;
    }

    const last = s[n - 1];
    if (t >= last.t) {
      // Sin datos nuevos: extrapolar un poco con la velocidad de las dos últimas muestras.
      const prev = s[n - 2];
      const ahead = Math.min(t - last.t, this.maxExtrapolateMs);
      outPos.copy(last.pos);
      if (ahead > 0 && !last.teleport) {
        outPos.addScaledVector(prev.pos, -1).multiplyScalar(ahead / (last.t - prev.t)).add(last.pos);
      }
      outRot.copy(last.rot);
      return last.aux;
    }

    for (let i = n - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (t < a.t) continue;
      if (b.teleport) {
        const pick = t - a.t < (b.t - a.t) / 2 ? a : b;
        outPos.copy(pick.pos);
        outRot.copy(pick.rot);
        return pick.aux;
      }
      const k = (t - a.t) / (b.t - a.t);
      outPos.lerpVectors(a.pos, b.pos, k);
      outRot.slerpQuaternions(a.rot, b.rot, k);
      return a.aux + (b.aux - a.aux) * k;
    }
    return null;
  }
}
