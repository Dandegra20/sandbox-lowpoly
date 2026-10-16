import * as THREE from 'three';
import { WEAPONS } from '../../content/weapons';
import { TOOL_BY_ID } from '../../content/tools';
import { Button } from '../../shared/protocol';
import type { InputFrame } from '../../shared/input';
import { aimDirection, createFireState, gravityAction, pelletDirections, stepFire } from '../../shared/weapons';
import { sound } from '../audio/Sound';
import type { Effects, ImpactKind } from './Effects';
import type { ViewModel } from './ViewModel';

/** Lo que el controlador necesita de la partida para dibujar los disparos propios. */
export interface WeaponContext {
  myId: number;
  effects: Effects;
  viewModel: ViewModel;
  /** Punta del cañón del arma propia en el mundo (1ª o 3ª persona). */
  muzzle(out: THREE.Vector3): THREE.Vector3;
  /** Objetos contra los que se comprueban visualmente los disparos propios. */
  hitTargets(): HitTargets;
  onSelect(index: number): void;
  /** Si el jugador local sujeta algo con la pistola de gravedad (según el último snapshot). */
  holding(): boolean;
  /** Herramienta seleccionada de la tool gun. */
  toolId(): string;
  /** Si el modo de juego permite el arma (la tool gun no está en Deathmatch). */
  weaponAllowed(index: number): boolean;
}

/** Alcance visual de la tool gun (el mismo que en el servidor). */
const TOOL_RANGE = 100;

export interface HitTargets {
  objects: THREE.Object3D[];
  players: Set<THREE.Object3D>;
  props: Set<THREE.Object3D>;
}

/**
 * Armas del jugador local: selección (números y rueda) y predicción de los disparos.
 * Ejecuta la misma lógica que el servidor (shared/weapons.ts) para mostrar fogonazo,
 * trazadoras e impactos al instante; el daño real lo decide siempre el servidor.
 */
export class WeaponController {
  selected = 0;
  private fire = createFireState();
  private wheel = 0;
  private prevButtons = 0;
  private raycaster = new THREE.Raycaster();
  private origin = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private muzzle = new THREE.Vector3();
  private end = new THREE.Vector3();

  constructor(private ctx: WeaponContext) {
    ctx.viewModel.setWeapon(0);
    ctx.onSelect(0);
  }

  get current(): number {
    return this.fire.weapon;
  }

  /** Punta del cañón del arma propia (1ª o 3ª persona). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.ctx.muzzle(out);
  }

  /** Pistola de gravedad sujetando algo: la rueda acerca/aleja en vez de cambiar de arma. */
  get wheelControlsDistance(): boolean {
    const def = WEAPONS[this.fire.weapon];
    return (!!def.gravity || (!!def.tool && this.ctx.toolId() === 'mover')) && this.ctx.holding();
  }

  /** Acumula clics de rueda para el próximo input (+ aleja, - acerca). */
  addWheel(clicks: number): void {
    this.wheel = Math.max(-8, Math.min(8, this.wheel + clicks));
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  selectSlot(slot: number): void {
    const i = WEAPONS.findIndex((w) => w.slot === slot);
    if (i >= 0) this.select(i);
  }

  cycle(dir: number): void {
    let i = this.selected;
    for (let n = 0; n < WEAPONS.length; n++) {
      i = (i + dir + WEAPONS.length) % WEAPONS.length;
      if (this.ctx.weaponAllowed(i)) return this.select(i);
    }
  }

  private select(index: number): void {
    if (index === this.selected || !this.ctx.weaponAllowed(index)) return;
    this.selected = index;
    sound.play('weapon_switch');
    this.ctx.viewModel.setWeapon(index);
    this.ctx.onSelect(index);
  }

  /** Mismo paso que hace el servidor con este input; si dispara, muestra los efectos ya. */
  onLocalTick(input: InputFrame, eye: THREE.Vector3): void {
    const res = stepFire(this.fire, input.buttons, input.weapon);
    const reload = (input.buttons & Button.Reload) !== 0 && !(this.prevButtons & Button.Reload);
    this.prevButtons = input.buttons;

    // Tool gun: rayo del color de la herramienta al usarla (el efecto real lo decide el servidor).
    if (WEAPONS[this.fire.weapon].tool && this.fire.switching === 0 && (res.primary || res.secondary || reload)) {
      const tool = TOOL_BY_ID[this.ctx.toolId()];
      this.ctx.muzzle(this.muzzle);
      const kind = this.cast(eye, this.dir.set(...aimDirection(input.yaw, input.pitch)), TOOL_RANGE, this.end);
      this.ctx.effects.tracer(this.muzzle, this.end, tool?.color ?? 0x74b9ff, 0.02, 0.12);
      if (kind) this.ctx.effects.toolSpark(this.end, tool?.color ?? 0x74b9ff);
      this.ctx.viewModel.kick(WEAPONS[this.fire.weapon].recoil);
      sound.play(WEAPONS[this.fire.weapon].sound, { volume: 0.7 });
      return;
    }
    if (!res.primary && !res.secondary) return;
    const def = WEAPONS[this.fire.weapon];
    const { effects, viewModel } = this.ctx;
    this.ctx.muzzle(this.muzzle);

    if (def.gravity) {
      // Agarrar se ve cuando llega el snapshot (aparece el rayo); empujar/lanzar, al instante.
      const action = gravityAction(input.buttons, res, this.ctx.holding());
      if (action === 'punt' || action === 'throw') {
        this.cast(eye, this.dir.set(...aimDirection(input.yaw, input.pitch)), def.gravity.puntRange, this.end);
        effects.punt(this.muzzle, this.end, def.gravity.beamColor);
        viewModel.kick(def.recoil);
        sound.play(def.sound);
      }
      return;
    }

    if (def.hitscan && res.primary) {
      for (const d of pelletDirections(def, input.yaw, input.pitch, this.ctx.myId, input.seq)) {
        const kind = this.cast(eye, this.dir.set(...d), def.hitscan.range, this.end);
        effects.tracer(this.muzzle, this.end, def.tracerColor);
        if (kind) {
          effects.impact(this.end, kind);
          sound.play(kind === 'player' ? 'impact_player' : 'impact', { pos: this.end, volume: 0.5 });
        }
      }
      effects.muzzleFlash(this.muzzle);
      viewModel.kick(def.recoil);
      sound.play(def.sound, { volume: 0.8 });
    } else if (def.projectile && res.primary) {
      effects.muzzleFlash(this.muzzle, 0xffa040, 0.16);
      viewModel.kick(def.recoil);
      sound.play(def.sound, { volume: 0.8 });
    }
  }

  /** Rayo visual desde los ojos. Devuelve qué se ha alcanzado (o null) y el punto en `out`. */
  private cast(eye: THREE.Vector3, dir: THREE.Vector3, range: number, out: THREE.Vector3): ImpactKind | null {
    const targets = this.ctx.hitTargets();
    this.raycaster.set(this.origin.copy(eye), dir);
    this.raycaster.far = range;
    const hit = this.raycaster.intersectObjects(targets.objects, false)[0];
    if (!hit) {
      out.copy(eye).addScaledVector(dir, range);
      return null;
    }
    out.copy(hit.point);
    if (targets.players.has(hit.object)) return 'player';
    if (targets.props.has(hit.object)) return 'prop';
    return 'world';
  }
}
