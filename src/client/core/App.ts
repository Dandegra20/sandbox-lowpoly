import { RECONNECT_GRACE_MS } from '../../shared/constants';
import type { ClientMessage, ErrorCode, ServerMessage } from '../../shared/protocol';
import { Connection } from '../net/Connection';
import { CharacterEditor, loadLook } from '../ui/CharacterEditor';
import { Chat } from '../ui/Chat';
import { Menu } from '../ui/Menu';
import { SettingsPanel } from '../ui/SettingsPanel';
import { loadServerInfo } from '../net/ServerInfo';
import { sound } from '../audio/Sound';
import { Game, type Welcome } from './Game';

const SESSION_KEY = 'sandbox.session';
const CLIENT_ID_KEY = 'sandbox.clientId';
/** Esperas entre intentos de reconexión (ms); el último se repite hasta agotar el plazo. */
const RETRY_DELAYS = [300, 1000, 2000, 3000, 5000];
/** Errores tras los que tiene sentido seguir reintentando. */
const RETRYABLE: ErrorCode[] = ['session_in_use'];

interface SavedSession {
  code: string;
  token: string;
}

type EnterResult = { ok: true } | { ok: false; code: ErrorCode | 'network'; message: string };

/**
 * Ciclo de vida de la sesión: menú → conectar → partida, reconexión automática si se cae
 * la conexión (o se recarga la página), expulsión y salida voluntaria.
 */
export class App {
  private menu = new Menu();
  private chat = new Chat();
  private editor = new CharacterEditor();
  private settingsPanel = new SettingsPanel();
  private game: Game | null = null;
  private conn: Connection | null = null;
  private reconnecting = false;
  private readonly clientId = loadClientId();

  constructor(private container: HTMLElement) {
    this.menu.onCreate = (name, opts) => this.enterFromMenu({
      t: 'create_room', name, clientId: this.clientId, look: loadLook(), map: opts.map, mode: opts.mode, killLimit: opts.killLimit,
    });
    this.menu.onJoin = (name, code) => this.enterFromMenu({ t: 'join_room', code, name, clientId: this.clientId, look: loadLook() });
    this.menu.onEditor = () => this.editor.open();
    this.menu.onSettings = () => this.settingsPanel.open();
    loadServerInfo();
    // Clic de interfaz en cualquier botón (menús, pausa, editor, ajustes).
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest?.('button')) sound.play('ui_click');
    }, true);
    // En partida, el nuevo aspecto se envía al servidor (que lo valida y lo reparte a todos).
    this.editor.onSave = (look) => this.conn?.send({ t: 'look', look });
  }

  /** Si venimos de una recarga con sesión guardada para esta sala, reconecta directamente. */
  async start(): Promise<void> {
    const saved = loadSession();
    const urlCode = new URLSearchParams(location.search).get('sala')?.toUpperCase();
    if (saved && saved.code === urlCode) {
      this.menu.setBusy(true);
      this.menu.setError('Reconectando…');
      const res = await this.enter({ t: 'rejoin', code: saved.code, token: saved.token });
      if (res.ok) return;
      clearSession();
      this.menu.show('');
    }
  }

  private async enterFromMenu(msg: ClientMessage): Promise<void> {
    this.menu.setBusy(true);
    this.menu.setError('');
    const res = await this.enter(msg);
    if (!res.ok) this.menu.show(res.message);
  }

  /** Conecta, envía el mensaje de entrada y espera el welcome (o un error). */
  private async enter(msg: ClientMessage): Promise<EnterResult> {
    const conn = new Connection();
    try {
      await conn.connect();
    } catch (e) {
      return { ok: false, code: 'network', message: (e as Error).message };
    }

    return new Promise<EnterResult>((resolve) => {
      conn.onClose = () => resolve({ ok: false, code: 'network', message: 'Se cerró la conexión.' });
      conn.onMessage = (m) => {
        if (m.t === 'welcome') {
          this.startGame(conn, m);
          resolve({ ok: true });
        } else if (m.t === 'error') {
          conn.close();
          resolve({ ok: false, code: m.code, message: m.message });
        }
      };
      conn.send(msg);
    });
  }

  private startGame(conn: Connection, welcome: Welcome): void {
    const isRejoin = this.game !== null;
    this.game?.dispose();
    this.conn?.close();
    this.conn = conn;
    saveSession({ code: welcome.roomCode, token: welcome.token });
    history.replaceState(null, '', `?sala=${welcome.roomCode}`);
    this.menu.hide();

    this.game = new Game(this.container, conn, welcome, this.chat, {
      onLeave: () => this.leave(),
      onEditor: () => this.editor.open(),
      onSettings: () => this.settingsPanel.open(),
    });
    if (isRejoin) this.chat.addSystem('Reconectado.');
    else this.chat.addSystem(`Has entrado en la sala ${welcome.roomCode}. Pulsa T para chatear.`);

    conn.onMessage = (m: ServerMessage) => {
      if (m.t === 'kicked') this.onKicked();
      else this.game?.handleMessage(m);
    };
    conn.onClose = () => this.onConnectionLost();
  }

  private leave(): void {
    this.conn?.send({ t: 'leave' });
    this.endSession('');
  }

  private onKicked(): void {
    this.endSession('Has sido expulsado de la sala.');
  }

  /** Vuelve al menú cerrando todo; no se intentará reconectar. */
  private endSession(message: string): void {
    clearSession();
    this.conn?.close();
    this.conn = null;
    this.game?.dispose();
    this.game = null;
    this.reconnecting = false;
    this.menu.show(message);
  }

  /** Conexión perdida sin querer: reintentar con el token durante el periodo de gracia. */
  private async onConnectionLost(): Promise<void> {
    if (this.reconnecting) return;
    const saved = loadSession();
    if (!saved || !this.game) return this.endSession('Se perdió la conexión con el servidor.');

    this.reconnecting = true;
    this.conn = null;
    // El servidor puede tardar hasta ~20 s en notar la caída (heartbeat) y luego guarda el hueco.
    const deadline = performance.now() + RECONNECT_GRACE_MS + 20_000;
    for (let attempt = 0; this.reconnecting && performance.now() < deadline; attempt++) {
      this.game?.setConnectionLost(`Conexión perdida. Reconectando… (intento ${attempt + 1})`);
      await sleep(RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]);
      if (!this.reconnecting) return;
      const res = await this.enter({ t: 'rejoin', code: saved.code, token: saved.token });
      if (res.ok) {
        this.reconnecting = false;
        return;
      }
      if (res.code !== 'network' && !RETRYABLE.includes(res.code)) break;
    }
    if (this.reconnecting) this.endSession('No se pudo recuperar la conexión con la sala.');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// sessionStorage es por pestaña: dos pestañas del mismo navegador son jugadores distintos.
function loadSession(): SavedSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SavedSession) : null;
  } catch {
    return null;
  }
}

function saveSession(s: SavedSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch { /* ignorar */ }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignorar */ }
}

/** Id persistente del navegador (localStorage), usado para que un expulsado no vuelva a entrar. */
function loadClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2);
  }
}
