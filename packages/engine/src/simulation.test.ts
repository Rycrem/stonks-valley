import { describe, expect, it } from "vitest";
import { companies, config } from "./data";
import { activePlayers, applyAction, buyableStock, buyCost, currentPlayer, type Action } from "./game";
import { createGame } from "./game";
import type { GameState } from "./state";

function step(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(`${action.type}: ${r.error}`);
  return r.state;
}

// Simple bot: buys up to 30 % while keeping a cash reserve, auctions an opponent's smallest holding, others bid once
function botTurn(state: GameState): GameState {
  const me = currentPlayer(state);
  let g = step(state, { type: "ROLL", playerId: me.id });
  if (g.phase === "gameOver" || currentPlayer(g).id !== me.id) return g;
  if (g.phase === "auction") {
    const self = currentPlayer(g);
    const target = activePlayers(g).find((p) => p.id !== self.id && Object.keys(p.holdings).length > 0)!;
    const smallest = Object.entries(target.holdings).sort((x, y) => x[1] - y[1])[0]![0];
    g = step(g, { type: "AUCTION_CHOOSE", playerId: self.id, ownerId: target.id, company: smallest });
    if (target.atouts.includes("bouclier")) g = step(g, { type: "USE_ATOUT", playerId: target.id });
    else {
      const bidder = activePlayers(g).find((p) => p.id !== target.id && p.cash > g.auction!.startPrice * 2);
      if (bidder) g = step(g, { type: "BID", playerId: bidder.id, amount: g.auction!.startPrice });
      g = step(g, { type: "AUCTION_CLOSE" });
    }
  }
  if (currentPlayer(g).cash < 0) {
    g = step(g, { type: "SETTLE_DEBT", playerId: me.id });
    if (g.phase === "gameOver" || currentPlayer(g).id !== me.id) return g;
  }
  const self = currentPlayer(g);
  let budget = config.maxPurchasePercent;
  for (const [company, available] of Object.entries(buyableStock(g))) {
    const pricePer = companies.find((c) => c.id === company)!.pricePerPercent;
    const held = currentPlayer(g).holdings[company] ?? 0;
    let pct = Math.min(available, budget, Math.floor((currentPlayer(g).cash - 1500) / pricePer));
    while (pct > 0 && buyCost(company, held, pct) > currentPlayer(g).cash - 1500) pct--;
    if (pct <= 0) continue;
    g = step(g, { type: "BUY", playerId: self.id, purchases: { [company]: pct } });
    budget -= pct;
  }
  if (g.canBuyAtout) g = step(g, { type: "BUY_ATOUT", playerId: self.id });
  // bots ally with the poorest outsider, accept every invite, and leave alliances now and then
  const outsider = activePlayers(g).filter((p) => p.id !== self.id && !g.alliances.some((a) => a.members.includes(p.id))).sort((x, y) => x.cash - y.cash)[0];
  if (outsider && g.log.length % 7 === 0) {
    const r = applyAction(g, { type: "ALLIANCE_INVITE", playerId: self.id, targetId: outsider.id });
    if (r.ok) g = r.state;
  }
  for (const invite of [...g.allianceInvites]) {
    const r = applyAction(g, { type: "ALLIANCE_ANSWER", playerId: invite.to, fromId: invite.from, accept: true });
    if (r.ok) g = r.state;
  }
  if (g.log.length % 11 === 0 && g.alliances.some((a) => a.members.includes(self.id))) g = step(g, { type: "ALLIANCE_LEAVE", playerId: self.id });
  return step(g, { type: "END_TURN", playerId: self.id });
}

function checkInvariants(g: GameState): void {
  for (const c of companies) {
    const held = g.players.reduce((a, p) => a + (p.holdings[c.id] ?? 0), 0);
    const stock = Object.values(g.stocks).reduce((a, s) => a + (s[c.id] ?? 0), 0);
    expect(held + stock, c.id).toBe(100);
  }
  for (const p of g.players) expect(p.cash).toBeGreaterThanOrEqual(0);
  const alive = activePlayers(g).length;
  for (const a of g.alliances) {
    expect(a.members.length).toBeGreaterThanOrEqual(2);
    expect(a.members.length).toBeLessThan(alive);
    for (const m of a.members) expect(g.players.find((p) => p.id === m)!.bankrupt).toBe(false);
  }
}

describe("simulated games", () => {
  it("keeps every company at 100 % and cash >= 0 across 30 bot games", () => {
    let finished = 0;
    let totalTurns = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let g = createGame(
        [1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `Bot ${i}` })),
        seed,
      );
      let turns = 0;
      while (g.phase !== "gameOver" && turns < 3000) {
        g = botTurn(g);
        checkInvariants(g);
        turns++;
      }
      if (g.phase === "gameOver") {
        finished++;
        totalTurns += turns;
        expect(activePlayers(g)).toHaveLength(1);
        expect(g.winner).toBe(activePlayers(g)[0]!.id);
        const st = g.stats.players;
        expect(Object.values(st).reduce((a, s) => a + s.rolls, 0)).toBe(Object.values(g.stats.landings).reduce((a, n) => a + n, 0));
        expect(Object.values(st).reduce((a, s) => a + s.royaltiesPaid, 0)).toBe(Object.values(g.stats.companyRoyalties).reduce((a, n) => a + n, 0));
        expect(g.stats.history.at(-1)![g.winner!]).toBeGreaterThan(0);
      }
    }
    console.log(`${finished}/30 parties terminées, ${finished ? Math.round(totalTurns / finished) : 0} tours en moyenne`);
  });
});
