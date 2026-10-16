import * as THREE from 'three';
import { PLAYER_EYE_HEIGHT } from '../../shared/constants';

export type CameraMode = 'first' | 'third';

const THIRD_DISTANCE = 3.6;
/** Desplazamiento lateral (cámara "sobre el hombro" derecho). */
const THIRD_SHOULDER = 0.55;
const THIRD_HEIGHT = 0.35;
/** Separación mínima respecto a la pared que bloquea la cámara. */
const WALL_MARGIN = 0.25;

/**
 * Cámara en 1ª persona (en los ojos) o 3ª persona (detrás del hombro), con un rayo que
 * acerca la cámara si hay algo entre ella y el jugador para no atravesar paredes ni objetos.
 */
export class CameraController {
  mode: CameraMode = 'first';
  private raycaster = new THREE.Raycaster();
  private distance = THIRD_DISTANCE;
  private pivot = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  toggle(): CameraMode {
    this.mode = this.mode === 'first' ? 'third' : 'first';
    this.distance = THIRD_DISTANCE;
    return this.mode;
  }

  /** Cámara orbitando un punto (el vehículo que se conduce), con la mirada del ratón. */
  updateOrbit(center: THREE.Vector3, yaw: number, pitch: number, dt: number, distance: number, obstacles: THREE.Object3D[]): void {
    const cam = this.camera;
    // Mirar un poco hacia abajo por defecto para ver el vehículo.
    const p = Math.max(-1.2, Math.min(0.6, pitch - 0.25));
    cam.rotation.set(p, yaw, 0);
    this.euler.set(p, yaw, 0);
    const back = this.dir.set(0, 0, 1).applyEuler(this.euler);
    const pivot = this.pivot.copy(center);
    pivot.y += 1.2;
    this.raycaster.set(pivot, back);
    this.raycaster.far = distance + WALL_MARGIN;
    const hit = this.raycaster.intersectObjects(obstacles, false)[0];
    const target = hit ? Math.max(1, hit.distance - WALL_MARGIN) : distance;
    this.distance = target < this.distance ? target : this.distance + (target - this.distance) * Math.min(1, dt * 4);
    cam.position.copy(pivot).addScaledVector(back, this.distance);
  }

  /**
   * @param playerPos   centro de la cápsula del jugador (posición dibujada)
   * @param obstacles   mallas contra las que choca la cámara en 3ª persona
   */
  update(playerPos: THREE.Vector3, yaw: number, pitch: number, dt: number, obstacles: THREE.Object3D[]): void {
    const cam = this.camera;
    cam.rotation.set(pitch, yaw, 0);
    const eye = this.pivot.set(playerPos.x, playerPos.y + PLAYER_EYE_HEIGHT, playerPos.z);

    if (this.mode === 'first') {
      cam.position.copy(eye);
      return;
    }

    // Pivote sobre el hombro, y la cámara detrás en la dirección contraria a la mirada.
    this.euler.set(pitch, yaw, 0);
    const right = this.dir.set(1, 0, 0).applyEuler(this.euler);
    eye.addScaledVector(right, THIRD_SHOULDER).y += THIRD_HEIGHT;
    const back = this.dir.set(0, 0, 1).applyEuler(this.euler);

    this.raycaster.set(eye, back);
    this.raycaster.far = THIRD_DISTANCE + WALL_MARGIN;
    const hit = this.raycaster.intersectObjects(obstacles, false)[0];
    const target = hit ? Math.max(0.3, hit.distance - WALL_MARGIN) : THIRD_DISTANCE;
    // Acercarse de golpe (no atravesar), alejarse suavemente.
    this.distance = target < this.distance ? target : this.distance + (target - this.distance) * Math.min(1, dt * 6);
    cam.position.copy(eye).addScaledVector(back, this.distance);
  }
}
