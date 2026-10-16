import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface TunnelState {
  status: 'starting' | 'ready' | 'missing' | 'closed';
  url: string | null;
}

/** Rutas donde suele quedar cloudflared al instalarlo con winget o con el .msi (por si no está en el PATH). */
function findCloudflared(): string {
  const candidates = [
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)']!, 'cloudflared', 'cloudflared.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'cloudflared', 'cloudflared.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? 'cloudflared';
}

/**
 * Abre un "quick tunnel" de Cloudflare (gratis, sin cuenta) hacia el puerto del juego y
 * muestra la URL pública. Si cloudflared no está instalado, explica cómo instalarlo.
 */
export function startTunnel(port: number): TunnelState {
  const state: TunnelState = { status: 'starting', url: null };
  let child: ChildProcess;
  try {
    child = spawn(findCloudflared(), ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    return missing(state);
  }

  child.on('error', () => missing(state));
  const onData = (buf: Buffer) => {
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
    if (!m || state.url) return;
    state.url = m[0];
    state.status = 'ready';
    const line = '='.repeat(64);
    console.log(`\n  ${line}`);
    console.log('  JUEGO ONLINE LISTO. Comparte esta dirección con tus amigos:');
    console.log(`\n      ${state.url}\n`);
    console.log('  (Cambia cada vez que arrancas. Puede tardar unos segundos más en funcionar.)');
    console.log(`  ${line}\n`);
  };
  child.stdout!.on('data', onData);
  child.stderr!.on('data', onData);
  child.on('exit', (code) => {
    if (state.status === 'missing') return;
    state.status = 'closed';
    state.url = null;
    console.log(`  [túnel] cloudflared se ha cerrado (código ${code}). El juego sigue funcionando en LAN.`);
  });
  // Al cerrar el servidor, cerrar también el túnel.
  const stop = () => child.kill();
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      stop();
      process.exit(0);
    });
  }
  console.log('  [túnel] Abriendo el túnel de Cloudflare...');
  return state;
}

function missing(state: TunnelState): TunnelState {
  if (state.status === 'missing') return state;
  state.status = 'missing';
  console.log('\n  [túnel] No se encuentra "cloudflared", así que de momento solo se puede jugar en LAN.');
  console.log('  Para jugar por internet, instálalo (una sola vez) en PowerShell:');
  console.log('      winget install --id Cloudflare.cloudflared');
  console.log('  y vuelve a abrir start-online.bat. Más opciones (ngrok) en el README.\n');
  return state;
}
