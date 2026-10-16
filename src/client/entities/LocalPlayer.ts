import { Vector3 } from 'three';
import type { Shape } from '../../shared/collision';
import type { InputFrame } from '../../shared/input';
import { copyMoveState, createMoveState, stepPlayer, type MoveState } from '../../shared/playerController';
import type { PlayerState } from '../../shared/snapshot';

/**
 * Mundo de colisión para predecir `leadTicks` ticks por delante del último snapshot
 * (los objetos en movimiento se extrapolan con su velocidad hasta ese instante).
 */
export type ShapeProvider = (leadTicks: number) => readonly Shape[];

/** Correcciones mayores se aplican de golpe (teletransporte, respawn...). */
const SNAP_DISTANCE = 3;
const MAX_PENDING = 180;

/**
 * Predicción del jugador local con "rebobinar y repetir":
 * - Cada tick aplicamos el input con el MISMO controlador que el servidor (shared/playerController).
 * - Al llegar un snapshot, tomamos el estado autoritativo (tras el input `lastInputSeq`) y
 *   volvemos a aplicar encima los inputs que el servidor aún no ha procesado.
 * Si el mundo coincide, el resultado es idéntico y no hay corrección visible; si no
 * (p. ej. una caja se movió), la diferencia se disipa suavemente con visualOffset.
 */
export class LocalPlayer {
  readonly state: MoveState = createMoveState();
  private prevPos = new Vector3();
  private pending: InputFrame[] = [];
  /** Desfase visual que se reduce a 0 tras una corrección (evita saltos bruscos). */
  private visualOffset = new Vector3();
  private before = new Vector3();
  initialized = false;
  /** Según el último snapshot: muerto (no se mueve) y objeto sujeto (no colisiona con él). */
  dead = false;
  heldProp = 0;
  /** Distancia de agarre según el servidor (sin los clics de rueda aún no procesados). */
  holdDistance = 0;
  /** Vehículo que conduce: sin predicción (lo mueve el servidor). */
  vehicle = 0;

  constructor(private readonly id: number, private shapes: ShapeProvider) {}

  /** Un tick fijo de simulación local. */
  tick(input: InputFrame): void {
    this.prevPos.set(this.state.x, this.state.y, this.state.z);
    if (!this.dead && !this.vehicle) stepPlayer(this.state, input.buttons, input.yaw, this.shapes(this.pending.length), this.id, undefined, this.heldProp);
    this.pending.push(input);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  reconcile(server: PlayerState): void {
    const s = this.state;
    this.dead = server.dead;
    this.heldProp = server.heldProp;
    this.holdDistance = server.holdDistance;
    this.vehicle = server.vehicle;
    if (!this.initialized) {
      copyMoveState(s, server);
      this.prevPos.set(s.x, s.y, s.z);
      this.initialized = true;
      return;
    }
    this.before.set(s.x, s.y, s.z);

    // Descartar los inputs ya procesados por el servidor y repetir el resto.
    while (this.pending.length && this.pending[0].seq <= server.lastInputSeq) this.pending.shift();
    copyMoveState(s, server);
    this.prevPos.set(s.x, s.y, s.z);
    // El servidor no mueve con el controlador a un jugador muerto o conduciendo: aquí tampoco.
    if (!this.dead && !this.vehicle) {
      this.pending.forEach((input, i) => {
        this.prevPos.set(s.x, s.y, s.z);
        stepPlayer(s, input.buttons, input.yaw, this.shapes(i), this.id, undefined, this.heldProp);
      });
    }

    // Diferencia entre lo que mostrábamos y el nuevo estado => desfase visual que se disipa.
    const dx = this.before.x - s.x, dy = this.before.y - s.y, dz = this.before.z - s.z;
    if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE) {
      this.visualOffset.set(0, 0, 0);
      this.prevPos.set(s.x, s.y, s.z);
    } else {
      this.visualOffset.x += dx;
      this.visualOffset.y += dy;
      this.visualOffset.z += dz;
    }
  }

  /** Posición a dibujar: interpolada entre ticks (alpha) + desfase de corrección. */
  renderPosition(alpha: number, frameDt: number, out: Vector3): Vector3 {
    this.visualOffset.multiplyScalar(Math.exp(-frameDt * 15));
    return out
      .set(this.state.x, this.state.y, this.state.z)
      .sub(this.prevPos)
      .multiplyScalar(alpha)
      .add(this.prevPos)
      .add(this.visualOffset);
  }

  /**
   * Distancia de agarre predicha: la del servidor más los clics de rueda de los inputs que
   * aún no ha procesado (mismo cálculo que el servidor, con el mismo recorte).
   */
  predictedHoldDistance(step: number, min: number, max: number): number {
    let d = this.holdDistance;
    for (const input of this.pending) {
      if (input.wheel) d = Math.max(min, Math.min(max, d + input.wheel * step));
    }
    return d;
  }

  /** Velocidad horizontal actual (para la animación del modelo en tercera persona). */
  get horizontalSpeed(): number {
    return Math.hypot(this.state.vx, this.state.vz);
  }
}
