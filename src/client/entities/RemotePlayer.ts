import * as THREE from 'three';
import type { PlayerInfo } from '../../shared/protocol';
import { SampleBuffer } from '../net/SampleBuffer';
import { PlayerModel } from './PlayerModel';

/** Los nombres se ocultan a partir de esta distancia. */
const LABEL_DISTANCE = 60;
/** Extrapolación máxima si faltan snapshots (ms). */
const MAX_EXTRAPOLATION_MS = 100;

/** Otro jugador: interpola su pose entre snapshots y anima su modelo. */
export class RemotePlayer {
  readonly buffer = new SampleBuffer(MAX_EXTRAPOLATION_MS);
  readonly model: PlayerModel;
  /** Último "en el suelo" recibido (para la animación). */
  grounded = true;
  dead = false;
  /** Objeto sujeto con la gravity gun (0 = ninguno). */
  heldProp = 0;
  weapon = 0;
  /** Vehículo que conduce (0 = a pie). Game lo coloca en el asiento. */
  vehicle = 0;
  private tmpPos = new THREE.Vector3();
  private tmpRot = new THREE.Quaternion();
  private lastPos = new THREE.Vector3();
  private speed = 0;
  private hasPose = false;

  constructor(public info: PlayerInfo, isHost: boolean) {
    this.model = new PlayerModel(info.look, info.name, isHost);
    this.model.root.visible = false;
  }

  get root(): THREE.Group {
    return this.model.root;
  }

  setConnected(connected: boolean): void {
    this.info.connected = connected;
    if (!connected) {
      this.model.root.visible = false;
      this.buffer.clear();
      this.hasPose = false;
    }
  }

  /** Estado de combate del último snapshot. */
  setCombatState(dead: boolean, weapon: number, heldProp: number, vehicle = 0): void {
    if (vehicle !== this.vehicle) {
      this.model.setSeated(vehicle !== 0);
      this.buffer.clear(); // subir/bajar es un "teletransporte": no interpolar desde la posición anterior
    }
    this.vehicle = vehicle;
    if (!dead && this.dead) this.buffer.clear(); // al reaparecer no debe "deslizarse" desde donde murió
    this.dead = dead;
    this.heldProp = heldProp;
    this.weapon = weapon;
    this.model.setWeapon(weapon);
  }

  update(renderTime: number, dt: number, cameraPos: THREE.Vector3): void {
    if (!this.info.connected) return;
    if (this.dead) {
      this.model.root.visible = false;
      this.hasPose = false;
      return;
    }
    const pitch = this.buffer.sample(renderTime, this.tmpPos, this.tmpRot);
    if (pitch === null) return;
    const root = this.model.root;
    root.visible = true;

    // Velocidad horizontal derivada de la pose interpolada (suavizada).
    if (this.hasPose && dt > 0) {
      const v = Math.hypot(this.tmpPos.x - this.lastPos.x, this.tmpPos.z - this.lastPos.z) / dt;
      this.speed += (Math.min(v, 20) - this.speed) * Math.min(1, dt * 10);
    }
    this.lastPos.copy(this.tmpPos);
    this.hasPose = true;

    root.position.copy(this.tmpPos);
    root.quaternion.copy(this.tmpRot);
    this.model.animate(dt, this.speed, pitch, this.grounded);
    this.model.setLabelVisible(cameraPos.distanceTo(this.tmpPos) < LABEL_DISTANCE);
  }

  dispose(): void {
    this.model.dispose();
  }
}
