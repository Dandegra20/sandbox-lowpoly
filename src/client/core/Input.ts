import { Button } from '../../shared/protocol';
import { settings } from './Settings';

/** Radianes por píxel con sensibilidad 1 (los ajustes la multiplican). */
const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

/** Teclas de acción (pulsación, no mantener) que se notifican vía onAction. */
const ACTION_KEYS = new Set([
  'KeyV', 'KeyT', 'Enter', 'KeyQ', 'KeyZ',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
]);

/** Teclado + ratón con pointer lock. Usa event.code (tecla física): WASD funciona en cualquier distribución. */
export class Input {
  yaw = 0;
  pitch = 0;
  onLockChange: (locked: boolean) => void = () => {};
  /** Pulsación de una tecla de acción (V, T, Enter, números) mientras se juega. */
  onAction: (code: string) => void = () => {};
  /** Rueda del ratón mientras se juega: +1 abajo, -1 arriba. */
  onWheel: (dir: number) => void = () => {};

  private keys = new Set<string>();
  /** Teclas pulsadas desde el último buttons(): una pulsación más corta que un tick no se pierde. */
  private latched = new Set<string>();
  private suspended = false;
  private disposers: (() => void)[] = [];

  constructor(private canvas: HTMLElement) {
    this.listen(window, 'keydown', (e) => {
      // Tab nunca debe mover el foco por la página mientras se juega.
      if (e.code === 'Tab') e.preventDefault();
      if (!this.locked || this.suspended) return;
      if (e.code === 'Space') e.preventDefault();
      if (ACTION_KEYS.has(e.code)) {
        if (!e.repeat) {
          e.preventDefault(); // evita que la "t" acabe escrita en el chat al abrirlo
          this.onAction(e.code);
        }
        return;
      }
      this.keys.add(e.code);
      this.latched.add(e.code);
    });
    this.listen(window, 'keyup', (e) => this.keys.delete(e.code));
    // Botones del ratón: se guardan como teclas "Mouse0" (izquierdo) y "Mouse2" (derecho).
    this.listen(document, 'mousedown', (e) => {
      if (this.locked && !this.suspended) {
        this.keys.add(`Mouse${e.button}`);
        this.latched.add(`Mouse${e.button}`);
      }
    });
    this.listen(document, 'mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    this.listen(document, 'contextmenu', (e) => this.locked && e.preventDefault());
    this.listen(document, 'wheel', (e) => {
      if (this.locked && !this.suspended && e.deltaY !== 0) this.onWheel(Math.sign(e.deltaY));
    });
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(document, 'pointerlockchange', () => {
      if (!this.locked) this.keys.clear();
      this.onLockChange(this.locked);
    });
    this.listen(document, 'mousemove', (e) => {
      if (!this.locked) return;
      // Algunos navegadores en Windows dan picos enormes de movementX al bloquear: se recortan.
      const dx = Math.max(-300, Math.min(300, e.movementX));
      const dy = Math.max(-300, Math.min(300, e.movementY));
      const { sensitivity, invertY } = settings.get();
      const k = MOUSE_SENSITIVITY * sensitivity;
      this.yaw -= dx * k;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * k * (invertY ? -1 : 1)));
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Mientras está suspendido (p. ej. escribiendo en el chat) no se registran teclas de juego. */
  setSuspended(value: boolean): void {
    this.suspended = value;
    if (value) {
      this.keys.clear();
      this.latched.clear();
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  requestLock(): void {
    this.canvas.requestPointerLock()?.catch?.(() => {});
  }

  /** Botones de este tick (teclas mantenidas + las pulsadas y soltadas desde el tick anterior). */
  buttons(): number {
    const k = this.latched.size ? new Set([...this.keys, ...this.latched]) : this.keys;
    this.latched.clear();
    let b = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) b |= Button.Forward;
    if (k.has('KeyS') || k.has('ArrowDown')) b |= Button.Back;
    if (k.has('KeyA') || k.has('ArrowLeft')) b |= Button.Left;
    if (k.has('KeyD') || k.has('ArrowRight')) b |= Button.Right;
    if (k.has('Space')) b |= Button.Jump;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) b |= Button.Sprint;
    if (k.has('Mouse0')) b |= Button.Fire;
    if (k.has('Mouse2')) b |= Button.AltFire;
    if (k.has('KeyE')) b |= Button.Use;
    if (k.has('KeyR')) b |= Button.Reload;
    return b;
  }

  private listen<K extends keyof DocumentEventMap>(
    target: Window | Document,
    type: K,
    fn: (e: DocumentEventMap[K]) => void,
  ): void {
    target.addEventListener(type, fn as EventListener);
    this.disposers.push(() => target.removeEventListener(type, fn as EventListener));
  }

  dispose(): void {
    this.disposers.forEach((d) => d());
    if (this.locked) document.exitPointerLock();
  }
}
