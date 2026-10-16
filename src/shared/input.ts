import { BinaryType } from './protocol';

/** Input de un tick del cliente. Se envía una vez por tick (60 Hz). */
export interface InputFrame {
  seq: number;
  buttons: number;
  yaw: number;
  pitch: number;
  /** Índice del arma seleccionada (en WEAPONS). */
  weapon: number;
  /**
   * Tick del servidor que el cliente estaba viendo (interpolación) al generar el input.
   * El servidor lo usa para rebobinar a los demás jugadores al validar un disparo.
   */
  viewTick: number;
  /** Clics de rueda en este tick (pistola de gravedad: + aleja, - acerca). */
  wheel: number;
}

// Layout: u8 type | u32 seq | u16 buttons | f32 yaw | f32 pitch | u8 weapon | u32 viewTick | i8 wheel => 21 bytes
const INPUT_SIZE = 21;

export function encodeInput(input: InputFrame): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_SIZE);
  const v = new DataView(buf);
  v.setUint8(0, BinaryType.Input);
  v.setUint32(1, input.seq, true);
  v.setUint16(5, input.buttons, true);
  v.setFloat32(7, input.yaw, true);
  v.setFloat32(11, input.pitch, true);
  v.setUint8(15, input.weapon);
  v.setUint32(16, Math.max(0, Math.floor(input.viewTick)), true);
  v.setInt8(20, Math.max(-8, Math.min(8, input.wheel | 0)));
  return buf;
}

export function decodeInput(view: DataView): InputFrame | null {
  if (view.byteLength < INPUT_SIZE || view.getUint8(0) !== BinaryType.Input) return null;
  const yaw = view.getFloat32(7, true);
  const pitch = view.getFloat32(11, true);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  return {
    seq: view.getUint32(1, true),
    buttons: view.getUint16(5, true),
    // El pitch se recorta: un cliente no puede apuntar "más allá" de la vertical.
    yaw,
    pitch: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)),
    weapon: view.getUint8(15),
    viewTick: view.getUint32(16, true),
    wheel: Math.max(-8, Math.min(8, view.getInt8(20))),
  };
}
