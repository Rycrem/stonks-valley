import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cosmeticById, DEFAULT_LOOK, STARTER_ITEMS, type AccountRow, type Look, type Slot } from "@stonks/shared";
import type { ProfileView } from "@stonks/shared";

interface Profile {
  token: string;
  name: string;
  points: number;
  owned: string[];
  look: Look;
  account?: string;
  hash?: string;
  email?: string;
  created?: number;
  reset?: { token: string; expires: number };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AdminConfig {
  name: string;
  // password required to create the admin account; without it the name stays reserved
  password?: string;
}

const RESET_MS = 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function checkPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const expected = Buffer.from(hash!, "hex");
  return timingSafeEqual(scryptSync(password, salt!, 64), expected);
}

const key = (name: string) => name.trim().toLowerCase();

export class Profiles {
  private profiles = new Map<string, Profile>();
  private file: string | null;

  // dir = null keeps profiles in memory only (tests)
  constructor(
    dir: string | null,
    private admin: AdminConfig = { name: "Rycrem" },
  ) {
    this.file = dir ? join(dir, "profiles.json") : null;
    if (!dir || !this.file) return;
    mkdirSync(dir, { recursive: true });
    try {
      for (const p of JSON.parse(readFileSync(this.file, "utf8")) as Profile[]) {
        // free items added after the profile was created
        p.owned = [...new Set([...p.owned, ...STARTER_ITEMS])];
        this.profiles.set(p.token, p);
      }
    } catch {
      // first start: no file yet
    }
  }

  private save(): void {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.profiles.values()]));
    renameSync(tmp, this.file);
  }

  private view(p: Profile): ProfileView {
    return {
      name: p.name,
      points: p.points,
      owned: p.owned,
      look: p.look,
      account: p.account ?? null,
      email: p.email ?? null,
      admin: this.isAdmin(p),
    };
  }

  isAdminToken(token: string): boolean {
    return this.isAdmin(this.profiles.get(token));
  }

  private isAdmin(p: Profile | undefined): boolean {
    return !!p?.account && key(p.account) === key(this.admin.name);
  }

  private byAccount(name: string): Profile | undefined {
    const k = key(name);
    for (const p of this.profiles.values()) if (p.account && key(p.account) === k) return p;
    return undefined;
  }

  private session(p: Profile): Result<ProfileView & { token: string }> {
    return { ok: true, data: { ...this.view(p), token: p.token } };
  }

  // Unknown or empty token creates a new profile; the client keeps the returned token
  get(token: string): Profile {
    let p = this.profiles.get(token);
    if (!p) {
      p = { token: token || randomUUID(), name: "", points: 0, owned: [...STARTER_ITEMS], look: { ...DEFAULT_LOOK } };
      this.profiles.set(p.token, p);
      this.save();
    }
    return p;
  }

  fetch(token: string): Result<ProfileView & { token: string }> {
    return this.session(this.get(token));
  }

  look(token: string): Look {
    return this.profiles.get(token)?.look ?? { ...DEFAULT_LOOK };
  }

  setName(token: string, name: string): void {
    const p = this.profiles.get(token);
    if (!p || p.name === name) return;
    p.name = name;
    this.save();
  }

  // First login with a name creates the account (keeping the browser's points); then the password must match
  login(name: string, password: string, currentToken: string): Result<ProfileView & { token: string }> {
    const clean = name.trim();
    if (clean.length < 2 || clean.length > 20) return { ok: false, error: "Pseudo de 2 à 20 caractères" };
    if (password.length < 4) return { ok: false, error: "Mot de passe de 4 caractères minimum" };
    const existing = this.byAccount(clean);
    if (existing) {
      if (!existing.hash || !checkPassword(password, existing.hash)) return { ok: false, error: "Mauvais mot de passe" };
      return this.session(existing);
    }
    if (key(clean) === key(this.admin.name) && (!this.admin.password || password !== this.admin.password))
      return { ok: false, error: "Ce pseudo est réservé" };
    const current = this.profiles.get(currentToken);
    const p = current && !current.account ? current : this.get(randomUUID());
    p.account = clean;
    p.name = clean;
    p.hash = hashPassword(password);
    p.created = Date.now();
    this.save();
    return this.session(p);
  }

  setEmail(token: string, email: string): Result<ProfileView> {
    const p = this.profiles.get(token);
    if (!p?.account) return { ok: false, error: "Connecte-toi d'abord" };
    const clean = email.trim();
    if (clean && !EMAIL_RE.test(clean)) return { ok: false, error: "Adresse e-mail invalide" };
    p.email = clean || undefined;
    this.save();
    return { ok: true, data: this.view(p) };
  }

  // Returns where to send the reset link, or null when the account has no e-mail
  forgot(name: string): { email: string; token: string } | null {
    const p = this.byAccount(name);
    if (!p?.email) return null;
    p.reset = { token: randomBytes(24).toString("hex"), expires: Date.now() + RESET_MS };
    this.save();
    return { email: p.email, token: p.reset.token };
  }

  reset(resetToken: string, password: string): Result<ProfileView & { token: string }> {
    if (password.length < 4) return { ok: false, error: "Mot de passe de 4 caractères minimum" };
    const p = [...this.profiles.values()].find((x) => resetToken && x.reset?.token === resetToken);
    if (!p || p.reset!.expires < Date.now()) return { ok: false, error: "Lien expiré ou invalide" };
    p.hash = hashPassword(password);
    delete p.reset;
    this.save();
    return this.session(p);
  }

  accounts(adminToken: string): Result<AccountRow[]> {
    if (!this.isAdmin(this.profiles.get(adminToken))) return { ok: false, error: "Réservé à l'admin" };
    const rows = [...this.profiles.values()]
      .filter((p) => p.account)
      .map((p) => ({ name: p.account!, email: p.email ?? null, points: p.points, owned: p.owned.length, created: p.created ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, data: rows };
  }

  adminPassword(adminToken: string, name: string, password: string): Result<null> {
    if (!this.isAdmin(this.profiles.get(adminToken))) return { ok: false, error: "Réservé à l'admin" };
    if (password.length < 4) return { ok: false, error: "Mot de passe de 4 caractères minimum" };
    const p = this.byAccount(name);
    if (!p) return { ok: false, error: "Compte inconnu" };
    p.hash = hashPassword(password);
    this.save();
    return { ok: true, data: null };
  }

  adminPoints(adminToken: string, name: string, points: number): Result<null> {
    if (!this.isAdmin(this.profiles.get(adminToken))) return { ok: false, error: "Réservé à l'admin" };
    if (!Number.isInteger(points) || points < 0) return { ok: false, error: "Nombre de points invalide" };
    const p = this.byAccount(name);
    if (!p) return { ok: false, error: "Compte inconnu" };
    p.points = points;
    this.save();
    return { ok: true, data: null };
  }

  buy(token: string, itemId: string): Result<ProfileView> {
    const p = this.profiles.get(token);
    const item = cosmeticById.get(itemId);
    if (!p || !item) return { ok: false, error: "Objet inconnu" };
    if (p.owned.includes(itemId)) return { ok: false, error: "Déjà possédé" };
    if (p.points < item.price) return { ok: false, error: `Il faut ${item.price} points` };
    p.points -= item.price;
    p.owned.push(itemId);
    p.look[item.slot] = itemId;
    this.save();
    return { ok: true, data: this.view(p) };
  }

  equip(token: string, slot: Slot, itemId: string): Result<ProfileView> {
    const p = this.profiles.get(token);
    const item = cosmeticById.get(itemId);
    if (!p || !item || item.slot !== slot) return { ok: false, error: "Objet inconnu" };
    if (!p.owned.includes(itemId)) return { ok: false, error: "Objet non possédé" };
    p.look[slot] = itemId;
    this.save();
    return { ok: true, data: this.view(p) };
  }

  award(token: string, points: number): void {
    const p = this.profiles.get(token);
    if (!p) return;
    p.points += points;
    this.save();
  }
}
