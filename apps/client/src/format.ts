import { companies } from "@stonks/engine";
import type { Look } from "@stonks/shared";

export const companyById = new Map(companies.map((c) => [c.id, c]));

export function money(k: number): string {
  return `${k.toLocaleString("fr-FR")} k$`;
}

export const PLAYER_COLORS = ["#ff5d73", "#3dd6d0", "#ffd166", "#9b5de5", "#06d6a0", "#f78c6b"];
// alliances get their own colors, distinct from the players'
export const ALLIANCE_COLORS = ["#ffffff", "#a0c4ff", "#ffc6ff"];
export const allianceColor = (id: string) => ALLIANCE_COLORS[(Number(id.slice(1)) - 1) % ALLIANCE_COLORS.length]!;

// Varied free looks for players on the same screen
export const STARTER_LOOKS: Look[] = [
  { hat: "hat-casquette", head: "head-rond", body: "body-tshirt", legs: "legs-droites" },
  { hat: "hat-beret", head: "head-carre", body: "body-hoodie", legs: "legs-baskets" },
  { hat: "hat-none", head: "head-smiley", body: "body-tshirt", legs: "legs-baskets" },
  { hat: "hat-casquette", head: "head-carre", body: "body-hoodie", legs: "legs-droites" },
  { hat: "hat-beret", head: "head-smiley", body: "body-tshirt", legs: "legs-droites" },
  { hat: "hat-none", head: "head-rond", body: "body-hoodie", legs: "legs-baskets" },
];
