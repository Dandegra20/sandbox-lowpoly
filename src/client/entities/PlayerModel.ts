import * as THREE from 'three';
import { getCosmetic, type Appearance } from '../../content/cosmetics';
import { WEAPONS } from '../../content/weapons';
import { PLAYER_FOOT_OFFSET } from '../../shared/constants';
import { buildWeaponMesh } from '../weapons/WeaponModels';
import { buildCosmetic, colorMaterial, torsoMaterial } from './Cosmetics';

// Muñeco low-poly hecho de cajas. El origen es el centro de la cápsula (pies en -PLAYER_FOOT_OFFSET).
const FEET = -PLAYER_FOOT_OFFSET;
const LEG_LEN = 0.75;
const HIP_Y = FEET + LEG_LEN;
const TORSO_H = 0.6;
const HEAD = 0.42;
const SHOULDER_Y = HIP_Y + TORSO_H - 0.08;

// Geometrías compartidas por todos los jugadores (pivotes desplazados para poder rotar).
const legGeo = new THREE.BoxGeometry(0.24, LEG_LEN, 0.26).translate(0, -LEG_LEN / 2, 0);
const armGeo = new THREE.BoxGeometry(0.18, 0.6, 0.2).translate(0, -0.27, 0);
const torsoGeo = new THREE.BoxGeometry(0.66, TORSO_H, 0.38);
const headGeo = new THREE.BoxGeometry(HEAD, HEAD, HEAD).translate(0, HEAD / 2, 0);
const visorGeo = new THREE.BoxGeometry(HEAD * 0.8, 0.13, 0.06);
const visorMat = new THREE.MeshLambertMaterial({ color: 0x1b2633 });

// Puntos de anclaje de los accesorios (ver content/cosmetics.ts).
const HAT_ANCHOR = new THREE.Vector3(0, HEAD, 0); // en el grupo de la cabeza
const GLASSES_ANCHOR = new THREE.Vector3(0, HEAD * 0.6, -HEAD / 2 - 0.02); // en el grupo de la cabeza
const BACK_ANCHOR = new THREE.Vector3(0, HIP_Y + TORSO_H / 2, 0.19); // en la raíz

/**
 * Modelo de un jugador (local en 3ª persona, remoto o vista previa del editor): muñeco low-poly
 * con los colores, patrón y accesorios de su aspecto, animación de caminar y su nombre encima.
 */
export class PlayerModel {
  readonly root = new THREE.Group();
  private head = new THREE.Group();
  private torso: THREE.Mesh;
  private headMesh: THREE.Mesh;
  private visor: THREE.Mesh;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private label: THREE.Sprite;
  private accessories: THREE.Group[] = [];
  private phase = 0;
  private swing = 0;
  private weapon: THREE.Group | null = null;
  private weaponIndex = -1;
  private seated = false;
  /** Mallas sólidas del muñeco (para rayos de impacto en el cliente; sin el nombre). */
  readonly hitMeshes: THREE.Mesh[];

  constructor(look: Appearance, name: string, isHost = false) {
    // Los materiales salen de cachés compartidas (Cosmetics.ts); setLook los asigna.
    this.torso = new THREE.Mesh(torsoGeo);
    this.torso.position.y = HIP_Y + TORSO_H / 2;
    this.legL = new THREE.Mesh(legGeo);
    this.legR = new THREE.Mesh(legGeo);
    this.legL.position.set(-0.17, HIP_Y, 0);
    this.legR.position.set(0.17, HIP_Y, 0);
    this.armL = new THREE.Mesh(armGeo);
    this.armR = new THREE.Mesh(armGeo);
    this.armL.position.set(-0.43, SHOULDER_Y, 0);
    this.armR.position.set(0.43, SHOULDER_Y, 0);

    this.headMesh = new THREE.Mesh(headGeo);
    this.visor = new THREE.Mesh(visorGeo, visorMat);
    this.visor.position.set(0, HEAD * 0.6, -HEAD / 2 - 0.02); // la cara "delantera" es -Z
    this.head.add(this.headMesh, this.visor);
    this.head.position.y = HIP_Y + TORSO_H;

    this.hitMeshes = [this.torso, this.legL, this.legR, this.armL, this.armR, this.headMesh];
    for (const m of this.hitMeshes) m.castShadow = true;
    this.root.add(this.torso, this.legL, this.legR, this.armL, this.armR, this.head);

    this.label = makeLabel(name, isHost);
    // Por encima del sombrero más alto (~0,47 m sobre la cabeza) para que no lo tape.
    this.label.position.y = HIP_Y + TORSO_H + HEAD + 0.85;
    this.root.add(this.label);
    this.setLook(look);
  }

  /** Aplica un aspecto: colores, patrón del torso y accesorios. */
  setLook(look: Appearance): void {
    this.torso.material = torsoMaterial(look);
    this.armL.material = this.armR.material = colorMaterial(look.arms);
    this.legL.material = this.legR.material = colorMaterial(look.legs);
    this.headMesh.material = colorMaterial(look.head);

    for (const a of this.accessories) a.removeFromParent();
    this.accessories = [];
    const hat = getCosmetic('hat', look.hat);
    const glasses = getCosmetic('glasses', look.glasses);
    const back = getCosmetic('backpack', look.backpack);
    const add = (group: THREE.Group, parent: THREE.Object3D, anchor: THREE.Vector3) => {
      group.position.copy(anchor);
      parent.add(group);
      this.accessories.push(group);
    };
    if (hat.parts.length) add(buildCosmetic(hat, look), this.head, HAT_ANCHOR);
    if (glasses.parts.length) add(buildCosmetic(glasses, look), this.head, GLASSES_ANCHOR);
    if (back.parts.length) add(buildCosmetic(back, look), this.root, BACK_ANCHOR);
    // Con gafas no se ve la "visera" de los ojos.
    this.visor.visible = !glasses.parts.length;
  }

  setName(name: string, isHost: boolean): void {
    this.root.remove(this.label);
    const y = this.label.position.y;
    disposeSprite(this.label);
    this.label = makeLabel(name, isHost);
    this.label.position.y = y;
    this.root.add(this.label);
  }

  setLabelVisible(visible: boolean): void {
    this.label.visible = visible;
  }

  /** Pone el arma `index` (de WEAPONS) en la mano derecha. */
  setWeapon(index: number): void {
    if (index === this.weaponIndex || !WEAPONS[index]) return;
    if (this.weapon) this.armR.remove(this.weapon);
    this.weaponIndex = index;
    this.weapon = buildWeaponMesh(WEAPONS[index], true);
    // En el espacio del brazo, el brazo cuelga hacia -Y: el cañón (-Z del arma) debe ir hacia -Y.
    this.weapon.rotation.x = -Math.PI / 2;
    this.weapon.position.set(0, -0.55, -0.05);
    this.weapon.visible = !this.seated;
    this.armR.add(this.weapon);
  }

  /** Sentado (conduciendo): piernas hacia delante, manos al volante y sin arma visible. */
  setSeated(seated: boolean): void {
    this.seated = seated;
    if (this.weapon) this.weapon.visible = !seated;
  }

  /** Punta del cañón del arma en coordenadas del mundo (o null si no lleva). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.weapon) return null;
    this.root.updateMatrixWorld(true);
    return this.weapon.localToWorld(out.set(...WEAPONS[this.weaponIndex].muzzle));
  }

  /**
   * @param speed     velocidad horizontal (m/s), para el balanceo de piernas y brazos
   * @param pitch     inclinación de la cabeza (rad)
   * @param grounded  en el aire las piernas se quedan quietas
   */
  animate(dt: number, speed: number, pitch: number, grounded: boolean): void {
    if (this.seated) {
      this.legL.rotation.set(Math.PI / 2, 0, 0.05);
      this.legR.rotation.set(Math.PI / 2, 0, -0.05);
      this.armL.rotation.set(1.2, 0, 0.25);
      this.armR.rotation.set(1.2, 0, -0.25);
      this.head.rotation.x = pitch * 0.4;
      return;
    }
    const target = grounded ? Math.min(1, speed / 6) * 0.8 : 0.25;
    this.swing += (target - this.swing) * Math.min(1, dt * 10);
    this.phase += dt * (2 + speed * 1.5);
    const a = grounded ? Math.sin(this.phase) * this.swing : this.swing;
    this.legL.rotation.x = a;
    this.legR.rotation.x = grounded ? -a : -a * 0.5;
    this.head.rotation.x = pitch * 0.6;
    if (this.weapon) {
      // Con arma: los dos brazos apuntan hacia donde mira (π/2 = horizontal hacia delante).
      this.armR.rotation.set(Math.PI / 2 + pitch, 0, -0.15);
      this.armL.rotation.set(Math.PI / 2 + pitch, 0, 0.45);
    } else {
      this.armL.rotation.set(-a * 0.8, 0, 0);
      this.armR.rotation.set(a * 0.8, 0, 0);
    }
  }

  dispose(): void {
    // Geometrías y materiales son compartidos (cachés): solo se libera el nombre.
    disposeSprite(this.label);
  }
}

function disposeSprite(s: THREE.Sprite): void {
  s.material.map?.dispose();
  s.material.dispose();
}

function makeLabel(text: string, isHost: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const label = isHost ? `★ ${text}` : text;
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.min(250, ctx.measureText(label).width + 24);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 10, w, 44, 8);
  ctx.fill();
  ctx.fillStyle = isHost ? '#ffe066' : '#fff';
  ctx.fillText(label, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}
