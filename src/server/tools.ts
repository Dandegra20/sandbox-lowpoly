import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_TOOL, MAX_CONSTRAINTS_PER_PLAYER, MAX_THRUSTERS_PER_PLAYER, PAINT_COLORS, TOOL_BY_ID, type ToolDef } from '../content/tools';
import { PLAYER_EYE_HEIGHT } from '../shared/constants';
import type { InputFrame } from '../shared/input';
import { Button, type ServerMessage, type Vec3 } from '../shared/protocol';
import { aimDirection } from '../shared/weapons';
import type { Constraints } from './Constraints';
import { toLocal } from './Constraints';
import type { PropSystem } from './PropSystem';
import type { ServerPlayer, ServerProp } from './types';

/** Alcance de la tool gun. */
const TOOL_RANGE = 100;

export interface ToolHit {
  point: Vec3;
  normal: Vec3;
  /** Objeto alcanzado (null = mundo: suelo o bloques del mapa). */
  prop: ServerProp | null;
  distance: number;
}

export interface ToolHost {
  readonly world: RAPIER.World;
  readonly propSystem: PropSystem;
  readonly constraints: Constraints;
  isHost(p: ServerPlayer): boolean;
  send(p: ServerPlayer, msg: ServerMessage): void;
  broadcast(msg: ServerMessage, exceptId?: number): void;
  /** Soltar lo que sujeta el jugador (pistola de gravedad o Mover). */
  drop(p: ServerPlayer): void;
}

/** Lo que recibe cada handler al usar una herramienta. */
export interface ToolContext {
  p: ServerPlayer;
  def: ToolDef;
  host: ToolHost;
  eye: Vec3;
  dir: Vec3;
  /** Qué hay delante de la mira (se calcula al pedirlo). */
  hit(): ToolHit | null;
  /** El objeto apuntado, si el jugador puede modificarlo (si no, avisa y devuelve null). */
  target(): ServerProp | null;
  msg(text: string, ok?: boolean): void;
  /** Rayo visible para todos hasta el punto apuntado. */
  fx(): void;
  /** Si otro jugador sujeta ese objeto (pistola de gravedad o Mover). */
  heldByOther(prop: ServerProp): boolean;
}

export interface ToolHandler {
  primary?(ctx: ToolContext): void;
  secondary?(ctx: ToolContext): void;
  reload?(ctx: ToolContext): void;
}

const param = (def: ToolDef, key: string, fallback: number) => def.params?.[key] ?? fallback;

/**
 * Comportamiento de cada herramienta (mismo id que en content/tools.ts).
 * Todo se ejecuta en el servidor con la mira del input del jugador: el cliente no elige objetivos.
 */
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  remover: {
    primary(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      ctx.fx();
      ctx.host.propSystem.remove(prop.id);
    },
    secondary(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      ctx.fx();
      let n = 0;
      for (const id of ctx.host.constraints.connected(prop.id)) {
        const other = ctx.host.propSystem.props.get(id);
        if (other && canModify(ctx, other)) {
          ctx.host.propSystem.remove(id);
          n++;
        }
      }
      ctx.msg(`Borrados ${n} objetos.`);
    },
  },

  mover: {
    primary(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      // Dos jugadores tirando del mismo objeto se pelean y, al soltar uno, el objeto recupera la
      // gravedad aunque el otro lo siga sujetando.
      if (ctx.heldByOther(prop)) return ctx.msg('Otro jugador lo está sujetando.', false);
      const { p, def } = ctx;
      ctx.host.drop(p);
      ctx.host.propSystem.setFrozen(prop, false);
      const t = prop.body.translation();
      const r = prop.body.rotation();
      p.heldProp = prop.id;
      p.holdMode = 'move';
      p.holdRot = [r.x, r.y, r.z, r.w];
      p.holdDistance = clamp(Math.hypot(t.x - ctx.eye[0], t.y - ctx.eye[1], t.z - ctx.eye[2]),
        param(def, 'minHold', 1.5), param(def, 'maxHold', 60));
      prop.body.setGravityScale(0, true);
      ctx.fx();
    },
    secondary(ctx) {
      const { p } = ctx;
      // Sujetando: congelar donde está y soltar. Si no: congelar/descongelar lo apuntado.
      const held = p.heldProp ? ctx.host.propSystem.props.get(p.heldProp) : null;
      if (held) {
        ctx.host.drop(p);
        ctx.host.propSystem.setFrozen(held, true);
        return ctx.msg('Congelado.');
      }
      const prop = ctx.target();
      if (!prop) return;
      const frozen = !prop.body.isFixed();
      ctx.host.propSystem.setFrozen(prop, frozen);
      ctx.fx();
      ctx.msg(frozen ? 'Congelado.' : 'Descongelado.');
    },
    reload(ctx) {
      // Girar 45º en vertical el objeto que se arrastra.
      const { p } = ctx;
      if (!p.heldProp) return;
      const s = Math.sin(Math.PI / 8), c = Math.cos(Math.PI / 8);
      const [x, y, z, w] = p.holdRot;
      p.holdRot = [c * x + s * z, c * y + s * w, c * z - s * x, c * w - s * y];
    },
  },

  weld: {
    primary(ctx) {
      twoClick(ctx, false, (a, b) => {
        if (b && a.id === b.id) return ctx.msg('Elige dos objetos distintos.', false);
        ctx.host.constraints.weld(ctx.p.info.id, a, b);
        ctx.msg(b ? 'Soldados.' : 'Soldado al suelo.');
      });
    },
    secondary(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      ctx.fx();
      ctx.msg(`Quitadas ${ctx.host.constraints.removeFor(prop.id, 'weld')} soldaduras.`);
    },
  },

  rope: {
    primary(ctx) {
      twoClick(ctx, true, (a, b, pa, pb) => {
        if (b && a.id === b.id) return ctx.msg('Elige dos objetos distintos.', false);
        ctx.host.constraints.rope(ctx.p.info.id, a, pa, b, pb, param(ctx.def, 'slack', 0.2));
        ctx.msg('Cuerda atada.');
      });
    },
    secondary(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      ctx.fx();
      ctx.msg(`Quitadas ${ctx.host.constraints.removeFor(prop.id, 'rope')} cuerdas.`);
    },
  },

  thruster: {
    primary(ctx) {
      const hit = ctx.hit();
      const prop = ctx.target();
      if (!hit || !prop) return;
      if (ctx.host.constraints.countByOwner(ctx.p.info.id).thrusters >= MAX_THRUSTERS_PER_PLAYER) {
        return ctx.msg(`Límite de ${MAX_THRUSTERS_PER_PLAYER} propulsores.`, false);
      }
      // Empuja hacia dentro de la cara en la que se pega.
      const dir: Vec3 = [-hit.normal[0], -hit.normal[1], -hit.normal[2]];
      ctx.host.constraints.addThruster(ctx.p.info.id, prop, hit.point, dir, param(ctx.def, 'force', 1500));
      ctx.fx();
      ctx.msg('Propulsor puesto. Clic derecho en el objeto para encenderlo.');
    },
    secondary(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      const state = ctx.host.constraints.toggleThrusters(prop.id);
      ctx.fx();
      ctx.msg(state === null ? 'Ese objeto no tiene propulsores.' : state ? 'Propulsores encendidos.' : 'Propulsores apagados.', state !== null);
    },
    reload(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      ctx.fx();
      ctx.msg(`Quitados ${ctx.host.constraints.removeThrusters(prop.id)} propulsores.`);
    },
  },

  paint: {
    primary(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      ctx.host.propSystem.setTint(prop, ctx.p.toolColor);
      ctx.fx();
    },
    secondary(ctx) {
      const prop = ctx.target();
      if (!prop) return;
      ctx.host.propSystem.setTint(prop, 0xffffff);
      ctx.fx();
    },
  },

  scale: {
    primary: (ctx) => rescale(ctx, (s) => s * param(ctx.def, 'step', 1.25)),
    secondary: (ctx) => rescale(ctx, (s) => s / param(ctx.def, 'step', 1.25)),
    reload: (ctx) => rescale(ctx, () => 1),
  },
};

// ---------------------------------------------------------------- utilidades de los handlers

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Se pueden modificar los objetos propios y los del mapa; el anfitrión, todos. */
function canModify(ctx: ToolContext, prop: ServerProp): boolean {
  return prop.owner === -1 || prop.owner === ctx.p.info.id || ctx.host.isHost(ctx.p);
}

function rescale(ctx: ToolContext, f: (s: number) => number): void {
  const prop = ctx.target();
  if (!prop) return;
  if (prop.def.vehicle || prop.group) return ctx.msg('Los vehículos y los ragdolls no se pueden escalar.', false);
  if (ctx.host.constraints.hasAny(prop.id)) return ctx.msg('Quita antes sus soldaduras, cuerdas y propulsores.', false);
  const s = clamp(f(prop.scale), param(ctx.def, 'min', 0.25), param(ctx.def, 'max', 4));
  if (Math.abs(s - prop.scale) < 1e-3) return ctx.msg('Ya está en el límite de tamaño.', false);
  ctx.host.propSystem.setScale(prop, Math.round(s * 1000) / 1000);
  ctx.fx();
}

/**
 * Herramientas de dos clics: el primero fija un punto sobre un objeto (o sobre el mundo, si
 * `allowWorldFirst`), el segundo completa la acción. El segundo puede ser el mundo (b = null).
 */
function twoClick(
  ctx: ToolContext, allowWorldFirst: boolean,
  done: (a: ServerProp, b: ServerProp | null, pa: Vec3, pb: Vec3) => void,
): void {
  const hit = ctx.hit();
  if (!hit) return ctx.msg('No hay nada ahí.', false);
  const { p, host } = ctx;
  if (hit.prop && !canModify(ctx, hit.prop)) return ctx.msg('Ese objeto no es tuyo.', false);
  ctx.fx();
  const stage = p.toolStage;
  if (!stage) {
    if (!hit.prop && !allowWorldFirst) return ctx.msg('Empieza haciendo clic en un objeto.', false);
    p.toolStage = { prop: hit.prop?.id ?? 0, local: hit.prop ? toLocal(hit.prop.body, hit.point) : hit.point, world: hit.point };
    return ctx.msg('Ahora haz clic en el segundo punto (otro objeto o el suelo).');
  }
  p.toolStage = null;
  const first = stage.prop ? host.propSystem.props.get(stage.prop) : null;
  if (stage.prop && !first) return ctx.msg('El primer objeto ya no existe.', false);
  // Punto actual del primer clic (el objeto puede haberse movido desde entonces).
  let pa = stage.world;
  if (first) {
    const t = first.body.translation();
    const r = first.body.rotation();
    const l = stage.local;
    const tx = 2 * (r.y * l[2] - r.z * l[1]), ty = 2 * (r.z * l[0] - r.x * l[2]), tz = 2 * (r.x * l[1] - r.y * l[0]);
    pa = [t.x + l[0] + r.w * tx + (r.y * tz - r.z * ty), t.y + l[1] + r.w * ty + (r.z * tx - r.x * tz), t.z + l[2] + r.w * tz + (r.x * ty - r.y * tx)];
  }
  if (!first && !hit.prop) return ctx.msg('Al menos uno de los dos puntos debe estar sobre un objeto.', false);
  if (host.constraints.countByOwner(p.info.id).constraints >= MAX_CONSTRAINTS_PER_PLAYER) {
    return ctx.msg(`Límite de ${MAX_CONSTRAINTS_PER_PLAYER} uniones.`, false);
  }
  // Siempre "a" es un objeto; "b" puede ser el mundo.
  if (first) done(first, hit.prop, pa, hit.point);
  else done(hit.prop!, null, hit.point, pa);
}

/**
 * Tool gun en el servidor: elige el handler de la herramienta seleccionada y lo ejecuta con la
 * mira del input (clic izquierdo = primary, derecho = secondary, R = reload). La herramienta
 * Mover usa el mismo "sujetar" que la pistola de gravedad (Combat.updateHeld) en modo 'move'.
 */
export class ToolSystem {
  constructor(private host: ToolHost, private players: Map<number, ServerPlayer>) {}

  /** Selección de herramienta y color (mensaje JSON del cliente). */
  select(p: ServerPlayer, id: unknown, color: unknown): void {
    const tool = typeof id === 'string' && TOOL_BY_ID[id] ? id : DEFAULT_TOOL;
    if (tool !== p.tool) {
      p.toolStage = null;
      if (p.heldProp && p.holdMode === 'move') this.host.drop(p);
    }
    p.tool = tool;
    if (typeof color === 'number' && (PAINT_COLORS.includes(color) || (color >= 0 && color <= 0xffffff))) p.toolColor = color | 0;
  }

  onInput(p: ServerPlayer, input: InputFrame, primary: boolean, secondary: boolean, pressed: number): void {
    const def = TOOL_BY_ID[p.tool] ?? TOOL_BY_ID[DEFAULT_TOOL];
    const handler = TOOL_HANDLERS[def.id];
    const moving = p.heldProp && p.holdMode === 'move';

    // Mover: sujetar mientras se mantiene el clic izquierdo; la rueda cambia la distancia.
    if (moving) {
      if (input.wheel) {
        p.holdDistance = clamp(p.holdDistance + input.wheel * param(def, 'wheelStep', 1.5),
          param(def, 'minHold', 1.5), param(def, 'maxHold', 60));
      }
      if (!(input.buttons & Button.Fire)) this.host.drop(p);
    }
    if (!primary && !secondary && !(pressed & Button.Reload)) return;

    const eye: Vec3 = [p.move.x, p.move.y + PLAYER_EYE_HEIGHT, p.move.z];
    const dir = aimDirection(input.yaw, input.pitch);
    let cached: ToolHit | null | undefined;
    const ctx: ToolContext = {
      p, def, host: this.host, eye, dir,
      hit: () => (cached === undefined ? (cached = this.trace(eye, dir)) : cached),
      target: () => {
        const prop = ctx.hit()?.prop ?? null;
        if (!prop) return null;
        if (!canModify(ctx, prop)) {
          ctx.msg('Ese objeto no es tuyo.', false);
          return null;
        }
        if (prop.def.vehicle && [...this.players.values()].some((q) => q.vehicle === prop.id)) {
          ctx.msg('Ese vehículo tiene conductor.', false);
          return null;
        }
        return prop;
      },
      msg: (text, ok = true) => this.host.send(p, { t: 'tool_msg', text, ok }),
      heldByOther: (prop) => [...this.players.values()].some((q) => q !== p && q.heldProp === prop.id),
      fx: () => {
        const to = ctx.hit()?.point ?? [eye[0] + dir[0] * TOOL_RANGE, eye[1] + dir[1] * TOOL_RANGE, eye[2] + dir[2] * TOOL_RANGE];
        this.host.broadcast({ t: 'tool_fx', by: p.info.id, tool: def.id, o: eye, to: to.map((n) => Math.round(n * 100) / 100) as Vec3 }, p.info.id);
      },
    };
    if (primary && !moving) handler.primary?.(ctx);
    if (secondary) handler.secondary?.(ctx);
    if (pressed & Button.Reload) handler.reload?.(ctx);
  }

  private trace(eye: Vec3, dir: Vec3): ToolHit | null {
    const ray = new RAPIER.Ray({ x: eye[0], y: eye[1], z: eye[2] }, { x: dir[0], y: dir[1], z: dir[2] });
    const hit = this.host.world.castRayAndGetNormal(ray, TOOL_RANGE, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    const body = hit.collider.parent();
    return {
      point: [eye[0] + dir[0] * t, eye[1] + dir[1] * t, eye[2] + dir[2] * t],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      prop: body ? this.host.propSystem.byBodyHandle(body.handle) ?? null : null,
      distance: t,
    };
  }
}
