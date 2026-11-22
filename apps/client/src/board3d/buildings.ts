import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Tier by the biggest holder's %: 0 = 1-9 %, 1 = 10-29 %, 2 = 30-59 %, 3 = 60-99 %, 4 = 100 %
export function tierOf(percent: number): number {
  return percent >= 100 ? 4 : percent >= 60 ? 3 : percent >= 30 ? 2 : percent >= 10 ? 1 : 0;
}

const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.45, ...o });
const glass = () => std("#a9d8ff", { metalness: 0.7, roughness: 0.08, emissive: "#2d6ea8", emissiveIntensity: 0.3 });
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

// Cities: a skyscraper that grows floor by floor, gets a spire, then a gold crown at 100 %
export function skyscraper(tier: number, color: string, logo?: THREE.Texture) {
  const g = new THREE.Group();
  const floors = [2, 4, 7, 10, 12][tier]!;
  const fh = 0.11;
  const w = [0.3, 0.32, 0.34, 0.36, 0.36][tier]!;
  const facade = new THREE.MeshStandardMaterial({ map: windowsTex(shade(color, -0.12).getStyle(), floors, 3), roughness: 0.3, metalness: 0.3 });
  const plain = std(color);
  mesh(g, new RoundedBoxGeometry(w + 0.08, 0.06, w + 0.08, 2, 0.02), std(shade(color, -0.2)), 0, 0.03, 0);
  const h = floors * fh;
  mesh(g, new THREE.BoxGeometry(w, h, w), [facade, facade, plain, plain, facade, facade], 0, 0.06 + h / 2, 0);
  if (tier >= 2) mesh(g, new THREE.BoxGeometry(w * 0.7, 0.18, w * 0.7), plain, 0, 0.06 + h + 0.09, 0);
  if (tier >= 3) mesh(g, new THREE.ConeGeometry(0.03, 0.35, 8), std("#dfe6ee", { metalness: 0.8 }), 0, 0.06 + h + 0.36, 0);
  if (tier === 4) {
    const crown = mesh(g, new THREE.CylinderGeometry(0.16, 0.13, 0.12, 6, 1, true), gold(), 0, 0.06 + h + 0.24, 0);
    (crown.material as THREE.Material).side = THREE.DoubleSide;
    monopolyAura(g, h + 0.5);
  }
  logoPanel(g, logo, w * 0.8, 0, 0.06 + h - w * 0.5, w / 2 + 0.005);
  return g;
}

// Tech hubs: start-up garage, offices, glass HQ, campus, then a ring HQ at 100 %
export function campus(tier: number, color: string, logo?: THREE.Texture) {
  const g = new THREE.Group();
  if (tier === 0) {
    mesh(g, new THREE.BoxGeometry(0.34, 0.2, 0.3), std("#e9e1d0"), 0, 0.14, 0);
    const roof = mesh(g, new THREE.CylinderGeometry(0.01, 0.24, 0.14, 4), std(color), 0, 0.31, 0);
    roof.rotation.y = Math.PI / 4;
    mesh(g, new THREE.BoxGeometry(0.2, 0.13, 0.01), std("#7a8794"), 0, 0.105, 0.151);
    logoPanel(g, logo, 0.12, 0, 0.36, 0.13);
  } else if (tier === 1) {
    mesh(g, new RoundedBoxGeometry(0.5, 0.28, 0.36, 2, 0.03), std("#eef2f6"), 0, 0.18, 0);
    mesh(g, new THREE.BoxGeometry(0.5, 0.08, 0.37), glass(), 0, 0.22, 0);
    mesh(g, new THREE.BoxGeometry(0.52, 0.03, 0.38), std(color), 0, 0.335, 0);
    logoPanel(g, logo, 0.16, 0, 0.2, 0.19);
  } else if (tier === 2) {
    mesh(g, new RoundedBoxGeometry(0.56, 0.5, 0.4, 2, 0.04), glass(), 0, 0.29, 0);
    for (let i = 0; i < 4; i++) mesh(g, new THREE.BoxGeometry(0.57, 0.02, 0.41), std(color), 0, 0.12 + i * 0.13, 0);
    logoPanel(g, logo, 0.2, 0, 0.36, 0.205);
  } else if (tier === 3) {
    mesh(g, new RoundedBoxGeometry(0.4, 0.62, 0.3, 2, 0.04), glass(), -0.12, 0.35, -0.08);
    mesh(g, new RoundedBoxGeometry(0.28, 0.36, 0.26, 2, 0.04), std("#eef2f6"), 0.2, 0.22, 0.12);
    mesh(g, new THREE.BoxGeometry(0.42, 0.03, 0.32), std(color), -0.12, 0.67, -0.08);
    mesh(g, new THREE.BoxGeometry(0.06, 0.04, 0.3), glass(), 0.05, 0.3, 0.04).rotation.y = 0.7;
    logoPanel(g, logo, 0.2, -0.12, 0.45, 0.075);
  } else {
    const ring = mesh(g, new THREE.TorusGeometry(0.27, 0.085, 16, 48), glass(), 0, 0.12, 0);
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 1.5;
    const top = mesh(g, new THREE.TorusGeometry(0.27, 0.09, 16, 48), std(color), 0, 0.2, 0);
    top.rotation.x = Math.PI / 2;
    top.scale.z = 0.25;
    mesh(g, new RoundedBoxGeometry(0.16, 0.62, 0.16, 2, 0.03), gold(), 0, 0.36, 0);
    logoPanel(g, logo, 0.13, 0, 0.55, 0.082);
    monopolyAura(g, 0.7);
  }
  // drawn for a 4 cm lawn that is gone: set everything down on the cell
  for (const c of g.children) c.position.y -= 0.04;
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
