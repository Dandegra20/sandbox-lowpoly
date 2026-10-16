import { WS_PATH } from '../../shared/constants';
import { BinaryType, type ClientMessage, type ServerMessage } from '../../shared/protocol';
import { decodeSnapshot, type Snapshot } from '../../shared/snapshot';

/** Envoltorio del WebSocket: JSON para control, binario para inputs/snapshots. */
export class Connection {
  onMessage: (msg: ServerMessage) => void = () => {};
  onSnapshot: (snap: Snapshot, bytes: number) => void = () => {};
  onClose: () => void = () => {};

  private ws: WebSocket | null = null;

  /** Misma URL que la página: funciona en localhost, LAN, Vite (proxy) y túneles https. */
  connect(timeoutMs = 5000): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const view = new DataView(ev.data);
        if (view.getUint8(0) === BinaryType.Snapshot) this.onSnapshot(decodeSnapshot(view), ev.data.byteLength);
      } else {
        this.onMessage(JSON.parse(ev.data as string) as ServerMessage);
      }
    };

    return new Promise((resolve, reject) => {
      const fail = () => {
        clearTimeout(timer);
        ws.onopen = ws.onerror = ws.onclose = null;
        ws.close();
        reject(new Error('No se pudo conectar con el servidor.'));
      };
      const timer = setTimeout(fail, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.onerror = null;
        ws.onclose = () => this.onClose();
        resolve();
      };
      ws.onerror = fail;
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendBinary(buf: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(buf);
  }

  /** Cierra sin disparar onClose (cierre voluntario). */
  close(): void {
    if (!this.ws) return;
    this.ws.onclose = null;
    this.ws.onmessage = null;
    this.ws.close(1000);
    this.ws = null;
  }
}
