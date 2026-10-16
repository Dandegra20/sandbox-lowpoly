/**
 * Direcciones para invitar a otros (pregunta a /api/info del servidor). El servidor solo
 * las da a quien abre el juego en el propio PC (localhost), así que esto sirve al anfitrión:
 * si juega en "localhost", el enlace que copia debe ser el de la LAN o el del túnel.
 */
export interface ServerInfo {
  /** URLs de la red local, p. ej. http://192.168.1.42:3000 */
  lan: string[];
  /** URL pública del túnel (si se arrancó con start-online.bat). */
  tunnel: string | null;
  /** El túnel está arrancando: vale la pena volver a preguntar. */
  tunnelPending: boolean;
}

const EMPTY: ServerInfo = { lan: [], tunnel: null, tunnelPending: false };
let info: ServerInfo = EMPTY;
const listeners = new Set<(i: ServerInfo) => void>();
let polls = 0;

const isLocalPage = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

async function poll(): Promise<void> {
  try {
    const res = await fetch('/api/info', { cache: 'no-store' });
    if (res.ok) info = { ...EMPTY, ...(await res.json()) as Partial<ServerInfo> };
  } catch { /* servidor antiguo o sin red: sin información */ }
  listeners.forEach((l) => l(info));
  // El túnel tarda unos segundos en dar su URL.
  if (info.tunnelPending && ++polls < 30) setTimeout(poll, 2000);
}

/** Pide la información una vez (solo si la página se abrió en este mismo PC). */
export function loadServerInfo(): void {
  if (isLocalPage()) void poll();
}

export function onServerInfo(fn: (i: ServerInfo) => void): void {
  listeners.add(fn);
  fn(info);
}

/** Origen que hay que compartir con los amigos: túnel > LAN > el de la página. */
export function shareOrigin(): string {
  if (!isLocalPage()) return location.origin;
  return info.tunnel ?? info.lan[0] ?? location.origin;
}
