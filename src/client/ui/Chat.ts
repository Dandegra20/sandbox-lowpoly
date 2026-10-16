import { CHAT_MAX_LENGTH } from '../../shared/constants';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Las líneas se desvanecen pasado este tiempo (siguen visibles con el chat abierto). */
const FADE_MS = 10_000;
const MAX_LINES = 60;

/**
 * Chat de texto. Vive fuera de Game para conservar el historial tras una reconexión.
 * El texto se inserta siempre con textContent (nunca HTML) para evitar inyecciones.
 */
export class Chat {
  /** Se llama con el texto a enviar al pulsar Enter. */
  onSend: (text: string) => void = () => {};
  /** Se llama al abrir/cerrar (para suspender el input de juego). */
  onToggle: (open: boolean) => void = () => {};

  private root = $('chat');
  private log = $('chat-log');
  private input = $<HTMLInputElement>('chat-input');

  constructor() {
    this.input.maxLength = CHAT_MAX_LENGTH;
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // que las teclas no lleguen al juego
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.onSend(text);
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
    this.input.addEventListener('blur', () => this.close());
  }

  get isOpen(): boolean {
    return !this.input.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.input.hidden = false;
    this.input.value = '';
    this.root.classList.add('open');
    this.input.focus();
    this.log.scrollTop = this.log.scrollHeight;
    this.onToggle(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.input.hidden = true;
    this.input.blur();
    this.root.classList.remove('open');
    this.onToggle(false);
  }

  addMessage(name: string, color: number, text: string): void {
    const line = document.createElement('div');
    line.className = 'line';
    const who = document.createElement('b');
    who.style.color = `#${color.toString(16).padStart(6, '0')}`;
    who.textContent = `${name}: `;
    line.append(who, document.createTextNode(text));
    this.push(line);
  }

  addSystem(text: string): void {
    const line = document.createElement('div');
    line.className = 'line system';
    line.textContent = text;
    this.push(line);
  }

  private push(line: HTMLElement): void {
    this.log.append(line);
    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild!.remove();
    this.log.scrollTop = this.log.scrollHeight;
    setTimeout(() => line.classList.add('old'), FADE_MS);
  }
}
