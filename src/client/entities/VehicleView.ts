import * as THREE from 'three';
import type { VehicleSpec } from '../../content/props';
import { WHEEL_DROP, propMaterial, wheelGeometry } from './PropGeometry';

/**
 * Ruedas de un vehículo. El chasis lo dibuja PropRenderer como cualquier objeto; aquí solo se
 * colocan las ruedas siguiendo su pose dibujada. El giro de las ruedas y la dirección se
 * estiman en el cliente a partir del movimiento del chasis (el servidor no los envía).
 */
export class VehicleView {
  readonly root = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private spin = 0;
  private steer = 0;
  private lastPos = new THREE.Vector3();
  private lastYaw = 0;
  private hasLast = false;
  private fwd = new THREE.Vector3();
  private delta = new THREE.Vector3();

  constructor(private spec: VehicleSpec) {
    for (const w of spec.wheels) {
      const m = new THREE.Mesh(wheelGeometry(spec, w.radius), propMaterial);
      m.castShadow = true;
      m.position.set(w.pos[0], w.pos[1] - spec.suspensionRest * WHEEL_DROP, w.pos[2]);
      m.rotation.order = 'YXZ';
      this.wheels.push(m);
      this.root.add(m);
    }
  }

  update(pos: THREE.Vector3, rot: THREE.Quaternion, dt: number): void {
    this.root.position.copy(pos);
    this.root.quaternion.copy(rot);
    this.fwd.set(0, 0, -1).applyQuaternion(rot);
    const yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
    if (this.hasLast && dt > 0) {
      const speed = this.delta.subVectors(pos, this.lastPos).dot(this.fwd) / dt;
      let dyaw = yaw - this.lastYaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const yawRate = dyaw / dt;
      // Dirección aparente: giro / velocidad (sin girar las ruedas en parado).
      const target = Math.abs(speed) > 0.5
        ? THREE.MathUtils.clamp((yawRate / Math.abs(speed)) * 2.5, -this.spec.maxSteer, this.spec.maxSteer) * Math.sign(speed)
        : this.steer * 0.9;
      this.steer += (target - this.steer) * Math.min(1, dt * 10);
      this.spin -= (speed / this.spec.wheels[0].radius) * dt;
    }
    this.lastPos.copy(pos);
    this.lastYaw = yaw;
    this.hasLast = true;
    this.spec.wheels.forEach((w, i) => this.wheels[i].rotation.set(this.spin, w.steer ? this.steer : 0, 0));
  }
}
