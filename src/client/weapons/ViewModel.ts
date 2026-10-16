import * as THREE from 'three';
import { WEAPONS } from '../../content/weapons';
import { WEAPON_SWITCH_MS } from '../../shared/constants';
import { buildWeaponMesh } from './WeaponModels';

/** Posición de reposo del arma respecto a la cámara (derecha, abajo, delante). */
const BASE = new THREE.Vector3(0.26, -0.24, -0.48);

/**
 * Arma en 1ª persona. Se dibuja en una escena aparte, después de limpiar el buffer de
 * profundidad, para que nunca se meta dentro de las paredes. Anima el cambio de arma,
 * el retroceso y un pequeño balanceo al andar.
 */
export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.01, 10);
  private holder = new THREE.Group();
  private models = new Map<number, THREE.Group>();
  private current = -1;
  /** 1 = arma bajada (recién cambiada), 0 = lista. */
  private raise = 0;
  private recoil = 0;
  private bob = 0;
  private bobAmount = 0;
  visible = true;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(1, 2, 1);
    this.scene.add(sun, this.holder);
  }

  setWeapon(index: number): void {
    if (index === this.current) return;
    if (this.current >= 0) this.models.get(this.current)!.visible = false;
    let model = this.models.get(index);
    if (!model) {
      model = buildWeaponMesh(WEAPONS[index]);
      this.models.set(index, model);
      this.holder.add(model);
    }
    model.visible = true;
    this.current = index;
    this.raise = 1;
  }

  kick(amount: number): void {
    this.recoil = Math.min(1.5, this.recoil + amount);
  }

  update(dt: number, aspect: number, speed: number, grounded: boolean): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.raise = Math.max(0, this.raise - dt / (WEAPON_SWITCH_MS / 1000));
    this.recoil *= Math.exp(-dt * 14);
    const moving = grounded ? Math.min(1, speed / 6) : 0;
    this.bobAmount += (moving - this.bobAmount) * Math.min(1, dt * 8);
    this.bob += dt * (6 + speed);

    const h = this.holder;
    h.position.copy(BASE);
    h.position.x += Math.sin(this.bob) * 0.012 * this.bobAmount;
    h.position.y += -Math.abs(Math.cos(this.bob)) * 0.012 * this.bobAmount - this.raise * this.raise * 0.35;
    h.position.z += this.recoil * 0.1;
    h.rotation.set(this.recoil * 0.22 - this.raise * 0.6, 0, 0);
  }

  /** Punta del cañón en coordenadas del mundo (aproximada a partir de la cámara principal). */
  muzzleWorld(mainCamera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
    const def = WEAPONS[Math.max(0, this.current)];
    this.holder.updateMatrix();
    out.set(...def.muzzle).applyMatrix4(this.holder.matrix);
    return mainCamera.localToWorld(out);
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible || this.current < 0) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
