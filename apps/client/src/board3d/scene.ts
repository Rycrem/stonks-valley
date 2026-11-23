import { allianceOf, board, markets, regions, type Cell, type GameState } from "@stonks/engine";
import type { Look } from "@stonks/shared";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { allianceColor, companyById, PLAYER_COLORS } from "../format";
import { pawnDataUrl } from "../pawn";
import { ownerGlow, stepOf, tower } from "./buildings";

// Outer ring: 4 corners + 11 cells per side; inner raised ring of hubs: 4 corners + 7 per side.
const W = 1.1, CORNER = 1.6, N = 11;
const HALF = (N * W + 2 * CORNER) / 2;
const IW = 1.1, ICORNER = 1.3, IN = 7;
const IHALF = (IN * IW + 2 * ICORNER) / 2;
const INNER_Y = 0.35;
const OUTER_COUNT = 4 * (N + 1);
const MOAT = (HALF - CORNER + IHALF) / 2;

const regionColor = new Map(regions.map((r) => [r.id, r.color]));
const SPECIAL: Record<string, { color: string; label: string }> = {
  depart: { color: "#f6efe0", label: "DÉPART" },
  encheres: { color: "#e94f6f", label: "ENCHÈRES" },
  mondial: { color: "#7b3fc4", label: "CHOIX MONDIAL" },
  levee: { color: "#17c3a5", label: "LEVÉE DE FONDS" },
  actu: { color: "#2a9fd6", label: "ACTU TECH" },
  atout: { color: "#ffcf4a", label: "ATOUT" },
  ipo: { color: "#d4a72c", label: "INTRO EN BOURSE" },
  krach: { color: "#5a2a3a", label: "KRACH" },
};

interface Pose { x: number; y: number; z: number; rot: number; w: number; d: number; corner: boolean; inner: boolean }

// The game walks the outer ring, then the inner ring in the opposite direction so the two passages never cross
export function cellPose(i: number): Pose {
  const inner = i >= OUTER_COUNT;
  const [half, corner, w, n] = inner ? [IHALF, ICORNER, IW, IN] : [HALF, CORNER, W, N];
  const r = inner ? (4 * (IN + 1) - (i - OUTER_COUNT)) % (4 * (IN + 1)) : i;
  const s = Math.floor(r / (n + 1));
  const k = r % (n + 1);
  const dir = [[-1, 0], [0, -1], [1, 0], [0, 1]][s]!;
  const out = [[0, 1], [-1, 0], [0, -1], [1, 0]][s]!;
  const start = [[half, half], [-half, half], [-half, -half], [half, -half]][s]!;
  const along = k === 0 ? corner / 2 : corner + w * (k - 1) + w / 2;
  return {
    x: start[0]! + dir[0]! * along - (out[0]! * corner) / 2,
    z: start[1]! + dir[1]! * along - (out[1]! * corner) / 2,
    y: inner ? INNER_Y : 0,
    // the far row is not flipped, so its names read upright and its buildings stand behind them
    rot: [0, -Math.PI / 2, 0, Math.PI / 2][s]!,
    w: k === 0 ? corner : w,
    d: corner,
    corner: k === 0,
    inner,
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function wrap(g: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = [];
  let line = "";
  for (const wd of text.split(" ")) {
    const t = line ? `${line} ${wd}` : wd;
    if (g.measureText(t).width > max && line) {
      out.push(line);
      line = wd;
    } else line = t;
  }
  out.push(line);
  return out;
}

function labelTexture(lines: [string, number, string?][], band: string) {
  return canvasTexture(256, 384, (g) => {
    g.fillStyle = "#f4ecd8";
    g.fillRect(0, 0, 256, 384);
    g.fillStyle = band;
    g.fillRect(0, 0, 256, 92);
    g.textAlign = "center";
    let y = 254;
    for (const [text, size, color] of lines) {
      g.font = `800 ${size}px Inter, Arial, sans-serif`;
      g.fillStyle = color ?? "#1b2433";
      for (const l of wrap(g, text, 225)) {
        g.fillText(l, 128, y);
        y += size * 1.1;
      }
      y += size * 0.3;
    }
  });
}

function solidTexture(color: string, text: string, w: number, h: number) {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255,255,255,.35)";
    g.lineWidth = 10;
    g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = ["#f6efe0", "#ffcf4a", "#d4a72c"].includes(color) ? "#1b2433" : "#ffffff";
    g.textAlign = "center";
    const words = text.split(" ");
    let size = 48;
    g.font = `900 ${size}px Inter, Arial, sans-serif`;
    while (Math.max(...words.map((wd) => g.measureText(wd).width)) > w * 0.84) {
      size -= 2;
      g.font = `900 ${size}px Inter, Arial, sans-serif`;
    }
    const y0 = h * 0.68 - (words.length - 1) * size * 0.5;
    words.forEach((wd, i) => g.fillText(wd, w / 2, y0 + i * size * 1.05));
  });
}

const mat = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, ...o });

function add(group: THREE.Object3D, mesh: THREE.Mesh, x = 0, y = 0, z = 0) {
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  group.add(mesh);
  return mesh;
}

function icon(group: THREE.Group, kind: Cell["type"]) {
  if (kind === "encheres") {
    add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 16), mat("#8b5a2b")), 0, 0.42, 0).rotation.z = Math.PI / 2;
    add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), mat("#a0703c")), 0, 0.2, 0);
    add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.08, 20), mat("#5b3a1c")), 0.25, 0.04, 0.2);
  } else if (kind === "levee" || kind === "ipo") {
    for (let i = 0; i < 5; i++) add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 24), mat("#e8b93a", { metalness: 0.9, roughness: 0.25 })), (i % 2) * 0.03, 0.04 + i * 0.065, 0);
    if (kind === "ipo") add(group, new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), mat("#3fd17b", { emissive: "#1a7a40", emissiveIntensity: 0.6 })), 0.3, 0.5, 0);
  } else if (kind === "atout") {
    add(group, new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.04, 0.6, 2, 0.02), mat("#fff7e0")), 0, 0.3, 0).rotation.x = -0.9;
    add(group, new THREE.Mesh(new THREE.OctahedronGeometry(0.12), mat("#ffcf4a", { metalness: 0.7, roughness: 0.2, emissive: "#8a6a10", emissiveIntensity: 0.4 })), 0, 0.6, 0);
  } else if (kind === "actu") {
    add(group, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.38), mat("#ffffff")), 0, 0.08, 0).rotation.y = 0.3;
    add(group, new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.38), mat("#e5e5e5")), 0.05, 0.13, 0.03).rotation.y = 0.1;
    add(group, new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.06), mat("#2a9fd6")), -0.2, 0.3, -0.12);
  } else if (kind === "choix-regional" || kind === "mondial") {
    add(group, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), mat("#8b5a2b")), 0, 0.35, 0);
    add(group, new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.03), mat("#ffffff")), 0.12, 0.6, 0).rotation.y = 0.4;
    add(group, new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.03), mat("#ffcf4a")), -0.1, 0.44, 0).rotation.y = -0.6;
    if (kind === "mondial") add(group, new THREE.Mesh(new THREE.SphereGeometry(0.28, 32, 16), mat("#2e86ab", { emissive: "#0e3a5a", emissiveIntensity: 0.5 })), 0.35, 0.3, 0.3);
  } else if (kind === "krach") {
    [0.5, 0.38, 0.24, 0.1].forEach((h, i) => add(group, new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 0.1), mat("#ff4d6d", { emissive: "#7a1020", emissiveIntensity: 0.5 })), -0.2 + i * 0.13, h / 2, 0));
  } else if (kind === "depart") {
    const arrow = add(group, new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 3), mat("#17c3a5")), 0, 0.12, 0);
    arrow.rotation.x = Math.PI / 2;
    arrow.rotation.z = Math.PI / 2;
  }
}

function floorLabel(scene: THREE.Scene, text: string, color: string, x: number, z: number, rot: number) {
  const tex = canvasTexture(768, 96, (g) => {
    g.fillStyle = color;
    g.font = "900 64px Inter, Arial";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 384, 48);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  sign.rotation.set(-Math.PI / 2, 0, rot);
  sign.position.set(x, 0.03, z);
  scene.add(sign);
}

// Glowing stepping-stone staircase along a smooth curve, with an arch at the arrival
function passage(scene: THREE.Scene, points: [number, number, number][], color: string) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const n = Math.max(4, Math.round(curve.getLength() / 0.36));
  const stone = mat("#2a3b55", { metalness: 0.3 });
  const glow = mat(color, { emissive: color, emissiveIntensity: 0.55, roughness: 0.3 });
  const chev = mat("#1b2433");
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(tan.x, tan.z);
    scene.add(g);
    const h = Math.max(0.05, p.y);
    add(g, new THREE.Mesh(new RoundedBoxGeometry(0.3, h, 0.26, 2, 0.04), stone), 0, h / 2, 0).receiveShadow = true;
    g.add(new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.04, 0.28, 2, 0.015), glow)).position.y = h + 0.01;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 3), chev);
    c.rotation.x = Math.PI / 2;
    c.scale.y = 0.35;
    c.position.y = h + 0.04;
    g.add(c);
  }
  const end = curve.getPointAt(1);
  const tan = curve.getTangentAt(1);
  const arch = new THREE.Group();
  arch.position.set(end.x, end.y + 0.04, end.z);
  arch.rotation.y = Math.atan2(tan.x, tan.z) + Math.PI / 2;
  scene.add(arch);
  add(arch, new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.035, 12, 32, Math.PI), glow));
  for (const x of [-0.28, 0.28]) add(arch, new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 12), mat("#c9a23a", { metalness: 0.8, roughness: 0.3 })), x, 0.01, 0);
}

function pipTexture(n: number) {
  const P: Record<number, [number, number][]> = {
    1: [[64, 64]],
    2: [[34, 34], [94, 94]],
    3: [[30, 30], [64, 64], [98, 98]],
    4: [[34, 34], [94, 34], [34, 94], [94, 94]],
    5: [[30, 30], [98, 30], [64, 64], [30, 98], [98, 98]],
    6: [[34, 28], [94, 28], [34, 64], [94, 64], [34, 100], [94, 100]],
  };
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = "#fbfbf7";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#c4161c";
    for (const [x, y] of P[n]!) {
      g.beginPath();
      g.arc(x, y, 12, 0, 7);
      g.fill();
    }
  });
}

function center(scene: THREE.Scene) {
  const c = new THREE.Group();
  c.position.y = INNER_Y;
  scene.add(c);
  add(c, new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.12, 64), mat("#2c3d58", { metalness: 0.2 })), 0, 0.06, 0).receiveShadow = true;
  add(c, new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.05, 8, 96), mat("#5ad7ff", { emissive: "#2aa7ff", emissiveIntensity: 0.9 })), 0, 0.12, 0).rotation.x = Math.PI / 2;
  const titleTex = canvasTexture(1024, 1024, (g) => {
    g.translate(512, 512);
    g.fillStyle = "#e8c45a";
    g.font = "900 70px Inter, Arial";
    g.textAlign = "center";
    const t = "STONKS VALLEY · STONKS VALLEY · ";
    for (let i = 0; i < t.length; i++) {
      g.save();
      g.rotate((i / t.length) * Math.PI * 2);
      g.fillText(t[i]!, 0, -430);
      g.restore();
    }
  });
  const title = new THREE.Mesh(new THREE.CircleGeometry(2.55, 64), new THREE.MeshStandardMaterial({ map: titleTex, transparent: true }));
  title.rotation.x = -Math.PI / 2;
  title.position.y = 0.125;
  c.add(title);
  for (let i = 0; i < 16; i++) {
    const ang = (i / 16) * Math.PI * 2;
    const h = 0.25 + i * 0.09;
    const up = i > 11;
    add(c, new THREE.Mesh(new RoundedBoxGeometry(0.22, h, 0.22, 2, 0.04), mat(up ? "#3fd17b" : "#17c3a5", { emissive: up ? "#1a7a40" : "#0a5a4a", emissiveIntensity: 0.4, roughness: 0.3 })), Math.cos(ang) * 1.85, 0.12 + h / 2, Math.sin(ang) * 1.85);
  }
  const tower = mat("#a9d4ff", { metalness: 0.8, roughness: 0.12, emissive: "#1f4f7f", emissiveIntensity: 0.35 });
  let ty = 0.12;
  for (const [w, h] of [[0.9, 1.0], [0.7, 0.9], [0.5, 0.8], [0.32, 0.6]] as const) {
    add(c, new THREE.Mesh(new RoundedBoxGeometry(w, h, w, 2, 0.05), tower), 0, ty + h / 2, 0);
    ty += h;
  }
  add(c, new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 4), mat("#e8c45a", { metalness: 0.9, roughness: 0.2 })), 0, ty + 0.35, 0);
  // live ticker: the trend of each market and the pot of fines held by the tower
  const tickCanvas = document.createElement("canvas");
  tickCanvas.width = 2048;
  tickCanvas.height = 96;
  const tickTex = new THREE.CanvasTexture(tickCanvas);
  tickTex.colorSpace = THREE.SRGBColorSpace;
  tickTex.anisotropy = 8;
  const drawTicker = (market: Record<string, number>, pot: number) => {
    const g = tickCanvas.getContext("2d")!;
    g.fillStyle = "#081018";
    g.fillRect(0, 0, 2048, 96);
    g.font = "800 46px Inter, Arial";
    let x = 20;
    const items = markets.map((m) => ({ text: `${m.name.toUpperCase()} ${market[m.id]! > 0 ? "▲" : market[m.id]! < 0 ? "▼" : "="} ${Math.abs(market[m.id] ?? 0)} %`, color: (market[m.id] ?? 0) > 0 ? "#3fd17b" : (market[m.id] ?? 0) < 0 ? "#ff4d6d" : "#c9d3e6" }));
    items.push({ text: `CAGNOTTE ${pot.toLocaleString("fr-FR")} k$`, color: "#e8c45a" });
    for (const it of items) {
      g.fillStyle = it.color;
      g.fillText(it.text, x, 64);
      x += g.measureText(it.text).width + 56;
    }
    tickTex.needsUpdate = true;
  };
  const ticker = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.22, 64, 1, true), new THREE.MeshStandardMaterial({ map: tickTex, emissive: "#ffffff", emissiveMap: tickTex, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
  ticker.position.y = 1.55;
  ticker.rotation.y = -0.6;
  c.add(ticker);
  const pts = [[-1.6, 0.6, 1.2], [-0.9, 1.1, 1.3], [-0.5, 0.9, 1.35], [0.3, 1.7, 1.3], [0.7, 1.5, 1.25], [1.5, 2.5, 1.0]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const green = mat("#3fd17b", { emissive: "#2fbf6b", emissiveIntensity: 0.9 });
  add(c, new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.1), 80, 0.07, 10), green));
  const head = add(c, new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 16), green), pts[5]!.x, pts[5]!.y, pts[5]!.z);
  head.lookAt(new THREE.Vector3(2.5, 4.0, 0.6));
  head.rotateX(Math.PI / 2);
  // the tower glows green when the markets rise on average, red when they fall
  const setMarket = (market: Record<string, number>, pot: number) => {
    drawTicker(market, pot);
    const avg = Object.values(market).reduce((a, v) => a + v, 0) / Math.max(1, Object.values(market).length);
    tower.emissive.set(avg > 0 ? "#1f8f4f" : avg < 0 ? "#a3202f" : "#1f4f7f");
    tower.emissiveIntensity = 0.35 + Math.min(0.5, Math.abs(avg) / 40);
  };
  return { group: c, setMarket };
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    if (!(x instanceof THREE.Mesh || x instanceof THREE.Sprite)) return;
    x.geometry.dispose();
    for (const m of ([] as THREE.Material[]).concat(x.material)) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

export interface BoardScene {
  update(game: GameState, looks: Look[]): void;
  // green fill where the company can be bought, blue frame where it collects royalties
  highlight(buy: number[], pay: number[]): void;
  recenter(animate?: boolean): void;
  dispose(): void;
}

export interface BoardEvents {
  // cell under the mouse (or null), with the mouse position in the page
  onHover?: (cell: number | null, x: number, y: number) => void;
  onSelect?: (cell: number) => void;
}

export function createBoardScene(host: HTMLElement, events: BoardEvents = {}): BoardScene {
  // render only when something changed, so an idle board costs nothing
  let dirty = true;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.45;
  scene.background = new THREE.Color("#0d1724");
  scene.add(new THREE.HemisphereLight("#cfe3ff", "#1b2433", 1.1));
  const sun = new THREE.DirectionalLight("#fff3dc", 3.2);
  sun.position.set(-10, 22, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight("#7fb8ff", 0.6);
  rim.position.set(12, 8, -14);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.3;
  controls.minDistance = 5;
  controls.maxDistance = 45;
  controls.zoomToCursor = true;
  // rotation is handled below so the view turns around the central tower, not the focused point
  controls.enableRotate = false;

  // table, slab and raised inner plateau
  const table = new THREE.Mesh(new THREE.CircleGeometry(60, 64), mat("#16202e", { roughness: 0.95 }));
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.42;
  table.receiveShadow = true;
  scene.add(table);
  add(scene, new THREE.Mesh(new RoundedBoxGeometry(HALF * 2 + 0.9, 0.5, HALF * 2 + 0.9, 4, 0.18), mat("#1d2a3e", { roughness: 0.6, metalness: 0.1 })), 0, -0.25, 0).receiveShadow = true;
  add(scene, new THREE.Mesh(new RoundedBoxGeometry(HALF * 2 + 1.05, 0.3, HALF * 2 + 1.05, 4, 0.12), mat("#c9a23a", { roughness: 0.35, metalness: 0.8 })), 0, -0.32, 0);
  add(scene, new THREE.Mesh(new THREE.BoxGeometry((HALF - CORNER) * 2, 0.02, (HALF - CORNER) * 2), mat("#14304a", { roughness: 0.2, metalness: 0.3, emissive: "#0a2a44", emissiveIntensity: 0.6 })));
  add(scene, new THREE.Mesh(new RoundedBoxGeometry(IHALF * 2 + 0.3, 0.35, IHALF * 2 + 0.3, 4, 0.1), mat("#24324a", { roughness: 0.5 })), 0, 0.17, 0).receiveShadow = true;
  add(scene, new THREE.Mesh(new RoundedBoxGeometry(IHALF * 2 + 0.42, 0.2, IHALF * 2 + 0.42, 4, 0.08), mat("#c9a23a", { roughness: 0.35, metalness: 0.8 })), 0, 0.1, 0);

  // cells
  const side = mat("#d9cfb8", { roughness: 0.7 });
  const decos: THREE.Group[] = [];
  const cellGroups: THREE.Group[] = [];
  const marks: { fill: THREE.Mesh; frame: THREE.Mesh; top: THREE.MeshStandardMaterial; g: THREE.Group; rot: number; y: number; flipped: boolean; spin: number }[] = [];
  let marked = false;
  board.forEach((cell, i) => {
    const p = cellPose(i);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rot;
    g.userData.cell = i;
    g.userData.depth = p.d;
    cellGroups.push(g);
    scene.add(g);
    let tex: THREE.Texture;
    if (cell.type === "city") {
      const hub = cell.region === "hubs";
      tex = labelTexture([[cell.name.toUpperCase(), cell.name.length > 10 ? 34 : 40], [hub ? "HUB TECH" : "", 24, "#9a7a2a"]], regionColor.get(cell.region)!);
    } else if (cell.type === "choix-regional") {
      tex = labelTexture([["CHOIX", 40], ["RÉGIONAL", 34]], regionColor.get(cell.region)!);
    } else {
      const sp = SPECIAL[cell.type]!;
      tex = p.corner ? solidTexture(sp.color, cell.name.toUpperCase(), 384, 384) : solidTexture(sp.color, sp.label, 256, 384);
    }
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 });
    const tile = new THREE.Mesh(new RoundedBoxGeometry(p.w - 0.06, 0.16, p.d - 0.06, 3, 0.04), [side, side, top, side, side, side]);
    tile.position.y = 0.08;
    tile.receiveShadow = tile.castShadow = true;
    g.add(tile);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.1, p.d - 0.1), new THREE.MeshBasicMaterial({ color: "#00c853", transparent: true, opacity: 0, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.175;
    fill.visible = false;
    g.add(fill);
    const outer = new THREE.Shape().setFromPoints([
      new THREE.Vector2(-p.w / 2, -p.d / 2), new THREE.Vector2(p.w / 2, -p.d / 2), new THREE.Vector2(p.w / 2, p.d / 2), new THREE.Vector2(-p.w / 2, p.d / 2),
    ]);
    const iw = p.w / 2 - 0.09;
    const id = p.d / 2 - 0.09;
    outer.holes.push(new THREE.Path().setFromPoints([new THREE.Vector2(-iw, -id), new THREE.Vector2(-iw, id), new THREE.Vector2(iw, id), new THREE.Vector2(iw, -id)]));
    const frame = new THREE.Mesh(new THREE.ShapeGeometry(outer), new THREE.MeshBasicMaterial({ color: "#3a86ff", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    frame.rotation.x = -Math.PI / 2;
    frame.position.y = 0.18;
    frame.visible = false;
    g.add(frame);
    marks.push({ fill, frame, top, g, rot: p.rot, y: p.y, flipped: false, spin: 0 });
    const deco = new THREE.Group();
    // buildings stand at the top of the cell, above its name
    deco.position.set(0, 0.16, -p.d / 2 + 0.38);
    g.add(deco);
    decos.push(deco);
    if (cell.type !== "city") icon(deco, cell.type);
  });

  // spiral passages: end of the outer ring -> into the hubs; end of the hubs -> back to Départ
  passage(scene, [[HALF - CORNER - 0.05, 0.16, HALF - CORNER - 0.75], [MOAT, 0.2, HALF - CORNER - 1.15], [IHALF + 0.05, 0.5, IHALF - ICORNER + 0.35]], "#3fd17b");
  passage(scene, [[IHALF - ICORNER - IW / 2, 0.5, IHALF + 0.05], [IHALF - ICORNER, 0.25, MOAT], [IHALF + 0.15, 0.12, MOAT + 0.1], [HALF - CORNER + 0.35, 0.16, HALF - CORNER - 0.05]], "#ffcf4a");
  floorLabel(scene, "VERS LES HUBS", "#3fd17b", MOAT, 2.4, Math.PI / 2);
  floorLabel(scene, "RETOUR AU DÉPART", "#ffcf4a", 1.2, MOAT, 0);

  const { group: mid, setMarket } = center(scene);
  const diceMats = new Map<number, THREE.MeshStandardMaterial>();
  const dieMat = (n: number) => diceMats.get(n) ?? diceMats.set(n, new THREE.MeshStandardMaterial({ map: pipTexture(n), roughness: 0.3 })).get(n)!;
  const dice = [[1.2, 1.9, 0.5], [1.75, 1.55, 1.1]].map(([x, z, r]) => {
    const d = add(mid, new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.36, 0.36, 3, 0.06), [1, 6, 5, 2, 4, 3].map(dieMat)), x, 0.3, z);
    d.rotation.y = r!;
    return d;
  });

  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.34, 4), mat("#ffffff", { emissive: "#ffffff", emissiveIntensity: 0.5 }));
  marker.rotation.x = Math.PI;
  scene.add(marker);

  // logos are rasterized SVGs on a black rounded square, readable on every cell color
  const logos = new Map<string, THREE.CanvasTexture>();
  const logoTex = (id: string) => {
    let t = logos.get(id);
    if (t) return t;
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    logos.set(id, t);
    const img = new Image();
    img.onload = () => {
      const g = c.getContext("2d")!;
      g.fillStyle = "#111111";
      g.beginPath();
      g.roundRect(4, 4, 152, 152, 30);
      g.fill();
      g.drawImage(img, 22, 22, 116, 116);
      t!.needsUpdate = true;
      dirty = true;
    };
    img.src = `/logos/${id}.svg`;
    return t;
  };

  // small tween engine: everything that changes on the board moves instead of popping
  type Tween = { t0: number; dur: number; step: (k: number) => void; done?: () => void };
  let tweens: Tween[] = [];
  const now = () => performance.now() / 1000;
  const tween = (dur: number, step: (k: number) => void, done?: () => void, delay = 0) => {
    const tw = { t0: now() + delay, dur, step, done };
    tweens.push(tw);
    dirty = true;
    return tw;
  };
  const cancel = (tw: Tween | null) => (tweens = tweens.filter((t) => t !== tw));
  const easeOut = (k: number) => 1 - (1 - k) ** 3;
  const easeBack = (k: number) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
  // the big dice overlay plays first, then the pawn walks
  const WALK_DELAY = 2.2;
  const STEP = 0.24;

  const built = new Map<number, string>();
  const pawnTex = new Map<string, THREE.Texture>();
  const pawns: { sprite: THREE.Sprite; cell: number; key: string; walking: Tween | null; to: number; out: boolean }[] = [];
  let first = true;
  let current = -1;
  let follow = false;
  let lastRoll = 0;
  let diceSpin: Tween[] = [];

  function biggestHolding(game: GameState, company: string) {
    const groups = new Map<string, number>();
    for (const p of game.players) {
      if (p.bankrupt || !p.holdings[company]) continue;
      const key = allianceOf(game, p.id)?.id ?? p.id;
      groups.set(key, (groups.get(key) ?? 0) + p.holdings[company]!);
    }
    return Math.max(0, ...groups.values());
  }

  // color of the player or alliance holding the most of a company, null when nobody or a tie
  function topHolderColor(game: GameState, company: string): string | null {
    const groups = new Map<string, { held: number; color: string }>();
    game.players.forEach((p, i) => {
      if (p.bankrupt || !p.holdings[company]) return;
      const alliance = allianceOf(game, p.id);
      const key = alliance?.id ?? p.id;
      const g = groups.get(key) ?? { held: 0, color: alliance ? allianceColor(alliance.id) : PLAYER_COLORS[i]! };
      g.held += p.holdings[company]!;
      groups.set(key, g);
    });
    const all = [...groups.values()];
    const max = Math.max(0, ...all.map((g) => g.held));
    const top = all.filter((g) => g.held === max);
    return max > 0 && top.length === 1 ? top[0]!.color : null;
  }

  function highlight(buy: number[], pay: number[]) {
    marks.forEach((m, i) => {
      m.fill.visible = buy.includes(i);
      m.frame.visible = pay.includes(i);
    });
    const was = marked;
    marked = buy.length + pay.length > 0;
    // grey out every other cell so the highlighted ones stand out
    marks.forEach((m, i) => m.top.color.set(marked && !buy.includes(i) && !pay.includes(i) ? "#4a4f5c" : "#ffffff"));
    // step back to the overview so every highlighted cell is in sight
    if (marked && !was) recenter(true);
    dirty = true;
  }

  function texFor(look: Look, idx: number) {
    const key = `${idx}:${JSON.stringify(look)}`;
    let tex = pawnTex.get(key);
    if (!tex) {
      const img = new Image();
      img.src = pawnDataUrl(look, PLAYER_COLORS[idx]!, 120);
      tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      const t = tex;
      img.onload = () => {
        t.needsUpdate = true;
        dirty = true;
      };
      pawnTex.set(key, tex);
    }
    return { key, tex };
  }

  // where pawn `idx` stands on `cell`, spread out when several pawns share it
  function spot(cell: number, idx: number) {
    const sharing = pawns.map((p, i) => [p, i] as const).filter(([p]) => !p.out && !p.walking && p.cell === cell).map(([, i]) => i);
    const slot = Math.max(0, sharing.indexOf(idx));
    const pose = cellPose(cell);
    const v = new THREE.Vector3(-0.28 + (slot % 3) * 0.28, 0, 0.12 + Math.floor(slot / 3) * 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), pose.rot);
    return new THREE.Vector3(pose.x + v.x, pose.y + 0.16, pose.z + v.z);
  }

  function place() {
    pawns.forEach((p, i) => !p.walking && p.sprite.position.copy(spot(p.cell, i)));
  }

  function walk(idx: number, to: number) {
    const p = pawns[idx]!;
    const from = p.cell;
    const steps = (to - from + board.length) % board.length;
    p.to = to;
    p.walking = tween(
      steps * STEP,
      (k) => {
        const f = k * steps;
        const i = Math.min(steps - 1, Math.floor(f));
        const a = spot((from + i) % board.length, idx);
        const b = spot((from + i + 1) % board.length, idx);
        p.sprite.position.lerpVectors(a, b, f - i);
        p.sprite.position.y += Math.sin((f - i) * Math.PI) * 0.45;
      },
      () => {
        p.walking = null;
        p.cell = to;
        place();
      },
      WALK_DELAY,
    );
    place();
  }

  function update(game: GameState, looks: Look[]) {
    setMarket(game.market, game.pot);
    dirty = true;
    board.forEach((cell, i) => {
      if (cell.type !== "city") return;
      const company = companyById.get(game.royalties[cell.id]!)!;
      const pct = biggestHolding(game, company.id);
      const holder = topHolderColor(game, company.id);
      const key = `${company.id}:${pct ? stepOf(pct) : -1}:${holder}`;
      if (built.get(i) === key) return;
      built.set(i, key);
      const deco = decos[i]!;
      const old = [...deco.children];
      // the logo lies flat on the cell, in front of the building
      if (!deco.userData.logo) {
        const tex = logoTex(company.id);
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshStandardMaterial({ map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.5 }));
        plate.rotation.x = -Math.PI / 2;
        // near the bottom edge, inside the cell on both rings
        plate.position.set(0, 0.168, deco.parent!.userData.depth / 2 - 0.16);
        deco.parent!.add(plate);
        deco.userData.logo = true;
      }
      // nobody holds it yet: the lot stays empty
      const b = !pct ? new THREE.Group() : tower(stepOf(pct), company.color);
      const size = 0.8;
      if (pct && holder) ownerGlow(b, holder);
      deco.add(b);
      if (first) {
        old.forEach((o) => (disposeTree(o), deco.remove(o)));
        b.scale.setScalar(size);
        return;
      }
      b.scale.setScalar(0.001);
      tween(0.35, (k) => old.forEach((o) => o.scale.setScalar(Math.max(0.001, size * (1 - easeOut(k))))), () => old.forEach((o) => (disposeTree(o), deco.remove(o))));
      tween(0.6, (k) => b.scale.setScalar(Math.max(0.001, size * easeBack(k))), undefined, 0.3);
    });

    game.players.forEach((p, idx) => {
      const { key, tex } = texFor(looks[idx]!, idx);
      let pawn = pawns[idx];
      if (!pawn) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
        sprite.center.set(0.5, 0);
        sprite.scale.set(0.5, 0.8, 1);
        scene.add(sprite);
        pawn = pawns[idx] = { sprite, cell: p.position, key, walking: null, to: p.position, out: false };
      }
      if (pawn.key !== key) {
        pawn.sprite.material.map = tex;
        pawn.key = key;
      }
      if (p.bankrupt && !pawn.out) {
        pawn.out = true;
        const m = pawn.sprite.material;
        tween(0.8, (k) => (m.opacity = 1 - k), () => (pawn!.sprite.visible = false));
      }
      // a new move cuts the walk in progress: the pawn jumps to where it was going, then walks again
      if (pawn.walking && pawn.to !== p.position) {
        cancel(pawn.walking);
        pawn.walking = null;
        pawn.cell = pawn.to;
      }
      if (!p.bankrupt && pawn.cell !== p.position && !pawn.walking) {
        if (first) pawn.cell = p.position;
        else walk(idx, p.position);
      }
    });
    place();

    if (game.current !== current) {
      current = game.current;
      if (!first) follow = true;
      const color = PLAYER_COLORS[game.current]!;
      marker.material.color.set(color);
      marker.material.emissive.set(color);
    }
    if (pawns[game.current]?.walking) follow = true;

    const roll = [...game.events].reverse().find((e) => e.kind === "roll")?.id ?? 0;
    if (game.lastRoll && roll !== lastRoll) {
      lastRoll = roll;
      const [a, b] = game.lastRoll;
      diceSpin.forEach(cancel);
      diceSpin = dice.map((d, k) => {
        const r0 = d.rotation.clone();
        return tween(
          first ? 0.001 : 1.1,
          (t) => {
            d.rotation.set(r0.x + (1 - t) * 9, r0.y, r0.z + (1 - t) * 7);
            d.position.y = 0.3 + Math.sin(t * Math.PI) * 0.6;
          },
          () => {
            (d.material as THREE.Material[])[2] = dieMat(k ? b : a);
            d.rotation.set(0, d.rotation.y, 0);
          },
        );
      });
    }
    first = false;
    dirty = true;
  }

  function recenter(animate = false) {
    follow = false;
    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    const k = Math.max(0.9, 1.2 / aspect);
    // phones in portrait: a steeper, closer view so the board fills the narrow screen
    const portrait = aspect < 1;
    const target = new THREE.Vector3(0, 0, portrait ? 0.4 : 0.9);
    const pos = portrait ? new THREE.Vector3(0, 19 * k, 7 * k) : new THREE.Vector3(0, 21 * k, 16.5 * k);
    if (!animate) {
      controls.target.copy(target);
      camera.position.copy(pos);
      controls.update();
      dirty = true;
      return;
    }
    const t0 = controls.target.clone();
    const p0 = camera.position.clone();
    tween(0.8, (x) => {
      const e = easeOut(x);
      controls.target.lerpVectors(t0, target, e);
      camera.position.lerpVectors(p0, pos, e);
    });
  }

  const resize = () => {
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(() => {
    resize();
    dirty = true;
  });
  resize();
  recenter();

  let frame = 0;
  const focus = new THREE.Vector3();
  const loop = () => {
    frame = requestAnimationFrame(loop);
    const t = now();
    if (tweens.length) {
      const running = tweens;
      // done() callbacks may queue new tweens into the fresh list
      tweens = [];
      for (const tw of running) {
        if (t < tw.t0) {
          tweens.push(tw);
          continue;
        }
        const k = Math.min(1, (t - tw.t0) / tw.dur);
        tw.step(k);
        if (k < 1) tweens.push(tw);
        else tw.done?.();
      }
      dirty = true;
    }
    if (marked) {
      const o = 0.55 + 0.2 * Math.sin(t * 4);
      for (const m of marks) {
        (m.fill.material as THREE.MeshBasicMaterial).opacity = o;
        (m.frame.material as THREE.MeshBasicMaterial).opacity = 0.4 + o;
      }
      dirty = true;
    }
    const me = pawns[current];
    // the marker only spins while something else is moving, so an idle board does not redraw
    if (me && (dirty || follow)) {
      marker.position.set(me.sprite.position.x, me.sprite.position.y + 1.25, me.sprite.position.z);
      marker.rotation.y = t * 1.5;
      // ease the camera onto the active pawn, keeping the user's angle, a bit closer than the overview
      if (follow) {
        focus.copy(me.sprite.position).setY(0.2);
        const offset = camera.position.clone().sub(controls.target);
        const dist = host.clientWidth < host.clientHeight ? 26 : 17;
        const want = THREE.MathUtils.lerp(offset.length(), dist, 0.04);
        controls.target.lerp(focus, 0.06);
        camera.position.copy(controls.target).add(offset.setLength(want));
        if (controls.target.distanceTo(focus) < 0.02 && !me.walking && Math.abs(offset.length() - dist) < 0.2) follow = false;
      }
    }
    if (controls.update() || dirty) {
      // turn each cell around so its name always reads upright from where the camera looks
      const fx = controls.target.x - camera.position.x;
      const fz = controls.target.z - camera.position.z;
      const fl = Math.hypot(fx, fz) || 1;
      for (const m of marks) {
        const facing = (-Math.sin(m.rot) * fx - Math.cos(m.rot) * fz) / fl;
        if (facing < -0.2 !== m.flipped && Math.abs(facing) > 0.2) {
          m.flipped = !m.flipped;
          // a short half turn, lifted a little so the cell clears its neighbours
          const from = m.g.rotation.y;
          const to = m.rot + (m.flipped ? Math.PI : 0);
          const id = ++m.spin;
          tween(0.5, (k) => {
            if (m.spin !== id) return;
            m.g.rotation.y = from + (to - from) * k * k * (3 - 2 * k);
            m.g.position.y = m.y + Math.sin(Math.PI * k) * 0.3;
          });
        }
      }
      dirty = false;
      renderer.render(scene, camera);
    }
  };
  loop();
  // hover and click on cells
  const ray = new THREE.Raycaster();
  const pick = (e: PointerEvent): number | null => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    let o: THREE.Object3D | null = ray.intersectObjects(cellGroups, true)[0]?.object ?? null;
    while (o && o.userData.cell === undefined) o = o.parent;
    return o ? (o.userData.cell as number) : null;
  };
  let downAt: { x: number; y: number } | null = null;
  const onMove = (e: PointerEvent) => events.onHover?.(downAt ? null : pick(e), e.clientX, e.clientY);
  const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) {
      const cell = pick(e);
      if (cell !== null) events.onSelect?.(cell);
    }
    downAt = null;
  };
  const onLeave = () => events.onHover?.(null, 0, 0);

  // one-finger or left-button drag: sideways turns camera and target around the tower axis, up/down tilts
  const pointers = new Map<number, { x: number; y: number }>();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const onOrbitDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onOrbitMove = (e: PointerEvent) => {
    const last = pointers.get(e.pointerId);
    if (!last) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size !== 1) return;
    const h = renderer.domElement.clientHeight || 1;
    const yaw = (-2 * Math.PI * (e.clientX - last.x)) / h;
    const pitch = (-2 * Math.PI * (e.clientY - last.y)) / h;
    if (!yaw && !pitch) return;
    follow = false;
    camera.position.applyAxisAngle(yAxis, yaw);
    controls.target.applyAxisAngle(yAxis, yaw);
    const offset = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.phi = THREE.MathUtils.clamp(sph.phi + pitch, 0.05, controls.maxPolarAngle);
    camera.position.copy(controls.target).add(offset.setFromSpherical(sph));
    dirty = true;
  };
  const onOrbitUp = (e: PointerEvent) => pointers.delete(e.pointerId);
  renderer.domElement.addEventListener("pointerdown", onOrbitDown);
  window.addEventListener("pointermove", onOrbitMove);
  window.addEventListener("pointerup", onOrbitUp);
  window.addEventListener("pointercancel", onOrbitUp);
  renderer.domElement.addEventListener("pointermove", onMove);
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointerleave", onLeave);

  const invalidate = () => (dirty = true);
  controls.addEventListener("change", invalidate);
  controls.addEventListener("start", () => (follow = false));
  ro.observe(host);

  return {
    update,
    highlight,
    recenter,
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerdown", onOrbitDown);
      window.removeEventListener("pointermove", onOrbitMove);
      window.removeEventListener("pointerup", onOrbitUp);
      window.removeEventListener("pointercancel", onOrbitUp);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      disposeTree(scene);
      for (const t of [...pawnTex.values(), ...logos.values(), env]) t.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
