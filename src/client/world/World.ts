import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { staticShapes, type MapDef, type MapPart } from '../../content/maps';
import type { Shape } from '../../shared/collision';
import type { QualitySpec } from '../core/Settings';

/** Generador pseudoaleatorio con semilla: el mapa se ve igual en todos los clientes. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Construye cielo, luces, suelo y decorado low-poly a partir de la definición del mapa. */
export class World {
  readonly sun: THREE.DirectionalLight;
  /** Mallas sólidas del mapa (para el rayo de la cámara en 3ª persona). */
  readonly obstacles: THREE.Object3D[] = [];
  /** Formas de colisión estáticas (suelo y bloques), las mismas que usa el servidor. */
  readonly staticShapes: Shape[];
  private group = new THREE.Group();
  private mountains: THREE.InstancedMesh;

  constructor(private scene: THREE.Scene, readonly map: MapDef) {
    const rand = rng(1234);
    this.staticShapes = staticShapes(map);
    scene.background = new THREE.Color(map.skyBottom);
    scene.fog = new THREE.Fog(map.skyBottom, map.fog[0], map.fog[1]);

    this.group.add(this.buildSky());
    this.group.add(new THREE.HemisphereLight(map.skyTop, 0x4a5a3a, 1.2));

    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -30;
    sc.right = sc.top = 30;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0005;
    // Sombras suaves y claras: borde difuminado (PCF) y solo un 55 % de oscurecimiento.
    this.sun.shadow.radius = 4;
    this.sun.shadow.intensity = 0.55;
    this.group.add(this.sun, this.sun.target);

    const ground = this.buildGround(rand);
    this.obstacles.push(ground);
    this.group.add(ground);
    if (map.parts.length) {
      const parts = this.buildParts(map.parts);
      this.obstacles.push(parts);
      this.group.add(parts);
    }
    if (map.water) this.group.add(this.buildWater(map.water.level, map.water.color));
    this.mountains = this.buildMountains(rand);
    this.group.add(this.mountains);
    scene.add(this.group);
  }

  /** Sombras (tamaño del shadow map) y decorado según la calidad gráfica. */
  setQuality(q: QualitySpec): void {
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      // Se vuelve a crear con el tamaño nuevo en el siguiente render.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.mountains.visible = q.scenery;
  }

  /** La sombra sigue al jugador para que un solo shadow map pequeño baste. */
  followShadow(target: THREE.Vector3): void {
    this.sun.position.set(target.x + 30, target.y + 60, target.z + 20);
    this.sun.target.position.copy(target);
  }

  private buildSky(): THREE.Mesh {
    const geo = new THREE.IcosahedronGeometry(400, 2);
    const top = new THREE.Color(this.map.skyTop);
    const bottom = new THREE.Color(this.map.skyBottom);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const k = THREE.MathUtils.clamp(pos.getY(i) / 400, 0, 1);
      c.copy(bottom).lerp(top, Math.pow(k, 0.6));
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -1;
    return sky;
  }

  /** Suelo como losa gruesa con triángulos de colores alternos (look low-poly sin texturas). */
  private buildGround(rand: () => number): THREE.Mesh {
    const size = this.map.groundSize;
    const seg = 30;
    const geo = new THREE.BoxGeometry(size, 4, size, seg, 1, seg).toNonIndexed();
    geo.translate(0, -2, 0);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const palette = this.map.groundColors.map((h) => new THREE.Color(h));
    const dirt = new THREE.Color(0x7a5a3a);
    for (let tri = 0; tri < pos.count / 3; tri++) {
      // Cara superior: color de la paleta; laterales: tierra.
      const isTop = pos.getY(tri * 3) > -0.01 && pos.getY(tri * 3 + 1) > -0.01 && pos.getY(tri * 3 + 2) > -0.01;
      const col = isTop ? palette[Math.floor(rand() * palette.length)] : dirt;
      for (let v = 0; v < 3; v++) col.toArray(colors, (tri * 3 + v) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Sin flatShading: calcula la normal con derivadas de pantalla y, en triángulos grandes
    // vistos de cerca, algunas GPUs dan normales nulas (suelo negro). La caja ya trae normales por cara.
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Todas las piezas del mapa en una sola malla (un draw call): cada pieza se convierte en
   * geometría no indexada con normales por cara, se gira y coloca, y se le pone su color.
   */
  private buildParts(parts: readonly MapPart[]): THREE.Mesh {
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    const geos = parts.map((p) => {
      let g: THREE.BufferGeometry;
      switch (p.kind) {
        case 'box': g = new THREE.BoxGeometry(...p.size); break;
        case 'ball': g = new THREE.IcosahedronGeometry(p.radius, 1); break;
        case 'cylinder':
          g = new THREE.CylinderGeometry(p.radius, p.radius, p.height, p.segments ?? 10);
          if (p.axis === 'x') g.rotateZ(Math.PI / 2);
          else if (p.axis === 'z') g.rotateX(Math.PI / 2);
          break;
        case 'cone': g = new THREE.ConeGeometry(p.radius, p.height, p.segments ?? 8); break;
      }
      g = g.toNonIndexed();
      g.deleteAttribute('uv');
      if (p.rot) g.applyMatrix4(m.makeRotationFromEuler(euler.set(...p.rot)));
      g.translate(...p.pos);
      g.computeVertexNormals();
      const n = g.attributes.position.count;
      const colors = new Float32Array(n * 3);
      color.setHex(p.color);
      for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return g;
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshLambertMaterial({ vertexColors: true }));
    geos.forEach((g) => g.dispose());
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  /** Mar alrededor del mapa: plano grande semitransparente. */
  private buildWater(level: number, color: number): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.82 }),
    );
    mesh.position.y = level;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** Montañas decorativas lejanas (instanciadas, sin colisión, fuera del área jugable). */
  private buildMountains(rand: () => number): THREE.InstancedMesh {
    const count = 28;
    const geo = new THREE.ConeGeometry(1, 1, 5, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x5d7d5a, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.2;
      const r = 170 + rand() * 40;
      const radius = 25 + rand() * 25;
      p.set(Math.cos(a) * r, -45, Math.sin(a) * r);
      s.set(radius, 50 + rand() * 50, radius);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    return mesh;
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
