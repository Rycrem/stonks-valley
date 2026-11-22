import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.45, ...o });
const gold = () => std("#ffcf4a", { metalness: 0.85, roughness: 0.22, emissive: "#8a6a10", emissiveIntensity: 0.35 });
const shade = (hex: string, k: number) => new THREE.Color(hex).offsetHSL(0, 0, k);

function mesh(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  group.add(m);
  return m;
}

function logoPanel(group: THREE.Group, logo: THREE.Texture | undefined, size: number, x: number, y: number, z: number) {
  if (!logo) return;
  const p = mesh(group, new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: logo, emissive: "#ffffff", emissiveMap: logo, emissiveIntensity: 0.35 }), x, y, z);
  p.castShadow = false;
}

function windowsTex(color: string, rows: number, cols: number, lit = 0.6) {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 256);
  const cw = 128 / cols;
  const rh = 256 / rows;
  for (let r = 0; r < rows; r++)
    for (let k = 0; k < cols; k++) {
      g.fillStyle = Math.sin(r * 12.9 + k * 78.2) * 0.5 + 0.5 < lit ? "#ffe9a8" : "#24405e";
      g.fillRect(k * cw + cw * 0.18, r * rh + rh * 0.2, cw * 0.64, rh * 0.55);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function monopolyAura(group: THREE.Group, height: number) {
  const ring = mesh(group, new THREE.TorusGeometry(0.36, 0.025, 8, 48), gold(), 0, 0.03, 0);
  ring.rotation.x = Math.PI / 2;
  const star = mesh(group, new THREE.OctahedronGeometry(0.09), gold(), 0, height + 0.25, 0);
  star.scale.y = 1.4;
}

// One step every 10 % held: 0 = 1-9 %, 1 = 10-19 % ... 9 = 90-99 %, 10 = 100 %
export function stepOf(percent: number): number {
  return Math.min(10, Math.floor(percent / 10));
}

// A skyscraper that gains one floor every 10 %, with setbacks, an antenna, then a spire; a giant tapered tower at 100 %
export function tower(step: number, color: string, logo?: THREE.Texture) {
  if (step >= 10) return giantTower(color, logo);
  const g = new THREE.Group();
  const floors = 2 + step;
  const fh = 0.1;
  const w = 0.28 + step * 0.008;
  const facade = new THREE.MeshStandardMaterial({ map: windowsTex(shade(color, -0.12).getStyle(), floors, 3), roughness: 0.3, metalness: 0.3 });
  const plain = std(color);
  mesh(g, new RoundedBoxGeometry(w + 0.08, 0.06, w + 0.08, 2, 0.02), std(shade(color, -0.2)), 0, 0.03, 0);
  let top = 0.06 + floors * fh;
  mesh(g, new THREE.BoxGeometry(w, floors * fh, w), [facade, facade, plain, plain, facade, facade], 0, 0.06 + (floors * fh) / 2, 0);
  if (step >= 3) {
    mesh(g, new THREE.BoxGeometry(w * 0.72, 0.14, w * 0.72), [facade, facade, plain, plain, facade, facade], 0, top + 0.07, 0);
    top += 0.14;
  }
  if (step >= 5) {
    mesh(g, new THREE.BoxGeometry(w * 0.48, 0.12, w * 0.48), plain, 0, top + 0.06, 0);
    top += 0.12;
  }
  if (step >= 7) mesh(g, new THREE.CylinderGeometry(0.012, 0.012, step >= 9 ? 0.42 : 0.22, 6), std("#dfe6ee", { metalness: 0.8 }), 0, top + (step >= 9 ? 0.21 : 0.11), 0);
  if (step >= 9) mesh(g, new THREE.BoxGeometry(w * 0.5, 0.025, w * 0.5), gold(), 0, top + 0.012, 0);
  logoPanel(g, logo, w * 0.8, 0, 0.06 + floors * fh - w * 0.5, w / 2 + 0.005);
  return g;
}

// 100 %: a very tall tower narrowing in steps around a central core, with three wings and a long spire
function giantTower(color: string, logo?: THREE.Texture) {
  const g = new THREE.Group();
  const sizes = [0.42, 0.36, 0.31, 0.26, 0.21, 0.17, 0.13, 0.09, 0.06];
  const heights = [0.42, 0.36, 0.32, 0.28, 0.24, 0.2, 0.17, 0.14, 0.12];
  const facade = new THREE.MeshStandardMaterial({ map: windowsTex(shade(color, -0.1).getStyle(), 4, 3, 0.7), roughness: 0.25, metalness: 0.45 });
  const plain = std(color, { metalness: 0.3 });
  mesh(g, new RoundedBoxGeometry(0.5, 0.06, 0.5, 2, 0.02), std(shade(color, -0.2)), 0, 0.03, 0);
  let y = 0.06;
  sizes.forEach((s, i) => {
    const h = heights[i]!;
    mesh(g, new THREE.CylinderGeometry(s * 0.42, s * 0.46, h, 6), facade, 0, y + h / 2, 0);
    // three wings around the core, shrinking with it
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3 + i * 0.25;
      const wing = mesh(g, new THREE.BoxGeometry(s * 0.34, h, s * 0.22), facade, Math.cos(a) * s * 0.34, y + h / 2, Math.sin(a) * s * 0.34);
      wing.rotation.y = -a;
    }
    mesh(g, new THREE.CylinderGeometry(s * 0.47, s * 0.47, 0.018, 6), i % 3 === 2 ? gold() : plain, 0, y + h, 0);
    y += h;
  });
  mesh(g, new THREE.CylinderGeometry(0.008, 0.03, 0.7, 8), std("#e8eef5", { metalness: 0.9, roughness: 0.15 }), 0, y + 0.35, 0);
  logoPanel(g, logo, 0.16, 0, 0.32, 0.2);
  monopolyAura(g, y + 0.6);
  return g;
}

// Neon trim in the color of the biggest holder: a glowing pad and ring around the base, and a beacon on top
export function ownerGlow(building: THREE.Group, color: string) {
  const box = new THREE.Box3().setFromObject(building);
  const size = box.getSize(new THREE.Vector3());
  const neon = new THREE.MeshBasicMaterial({ color });
  const r = Math.max(size.x, size.z) / 2 + 0.04;
  const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.012;
  building.add(pad);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 48), neon);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  building.add(ring);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), neon);
  beacon.position.y = box.max.y + 0.08;
  building.add(beacon);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }));
  halo.position.copy(beacon.position);
  building.add(halo);
}
