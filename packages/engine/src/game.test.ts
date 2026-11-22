import { describe, expect, it } from "vitest";
import { board, companies, config, markets } from "./data";
import { ATOUTS, applyAction, buyableStock, buyCost, createGame, royaltyFor, rollTurnOrder, royaltyQuote, type Action } from "./game";
import { rollDie } from "./rng";
import type { GameState } from "./state";

const P = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
  { id: "c", name: "Chloé" },
];

function ok(state: GameState, action: Action): GameState {
  const r = applyAction(state, action);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

function err(state: GameState, action: Action): string {
  const r = applyAction(state, action);
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

// Finds a seed whose next two dice (not a double) move the current player onto `cellId`
function landOn(state: GameState, cellId: string): GameState {
  const target = board.findIndex((c) => c.id === cellId);
  const pos = state.players[state.current]!.position;
  const need = (target - pos + board.length) % board.length;
  for (let seed = 1; seed < 100000; seed++) {
    const [d1, s1] = rollDie(seed);
    const [d2] = rollDie(s1);
    if (d1 + d2 === need && d1 !== d2) return ok({ ...state, seed }, { type: "ROLL", playerId: state.players[state.current]!.id });
  }
  throw new Error(`no seed lands on ${cellId}`);
}

function at(state: GameState, cellId: string): GameState {
  const s = structuredClone(state);
  // a flat market keeps royalties at their base value
  s.market = {};
  // place the player 3 cells before so a roll of 1 + 2 reaches the target
  s.players[s.current]!.position = (board.findIndex((c) => c.id === cellId) - 3 + board.length) % board.length;
  return landOn(s, cellId);
}

const price = (id: string) => companies.find((c) => c.id === id)!.pricePerPercent;
const royalty = (id: string) => companies.find((c) => c.id === id)!.royaltyPerPercent;

describe("setup", () => {
  it("gives each city one royalty company, the same count per company", () => {
    const g = createGame(P, 7);
    const counts: Record<string, number> = {};
    for (const c of Object.values(g.royalties)) counts[c] = (counts[c] ?? 0) + 1;
    expect(Object.keys(g.royalties)).toHaveLength(48);
    for (const c of companies) expect(counts[c.id]).toBe(config.royaltyTokensPerCompany);
  });

  it("is deterministic for a seed and varies across seeds", () => {
    expect(createGame(P, 7).royalties).toEqual(createGame(P, 7).royalties);
    expect(createGame(P, 7).royalties).not.toEqual(createGame(P, 8).royalties);
  });

  it("rejects too few players", () => {
    expect(() => createGame([P[0]!], 1)).toThrow();
  });
});

describe("starting cash", () => {
  it("uses the chosen amount and rejects others", () => {
    expect(createGame(P, 1, "classique", 30000).players.every((p) => p.cash === 30000)).toBe(true);
    expect(() => createGame(P, 1, "classique", 7)).toThrow(/invalide/);
  });
});

describe("turn order", () => {
  it("only the current player can roll", () => {
    const g = createGame(P, 1);
    expect(err(g, { type: "ROLL", playerId: "b" })).toMatch(/dés/);
  });

  it("accepts chosen dice, between 1 and 6", () => {
    const g = createGame(P, 1);
    expect(err(g, { type: "ROLL", playerId: "a", dice: [0, 7] })).toMatch(/invalides/);
    expect(ok(g, { type: "ROLL", playerId: "a", dice: [2, 3] }).lastRoll).toEqual([2, 3]);
  });

  it("passes to the next player after END_TURN", () => {
    let g = createGame(P, 1);
    g = ok(g, { type: "ROLL", playerId: "a" });
    if (g.phase === "auction") return;
    g = ok(g, { type: "END_TURN", playerId: "a" });
    expect(g.players[g.current]!.id).toBe("b");
    expect(g.phase).toBe("roll");
  });
});

describe("buying", () => {
  it("shows the city's stock and buys any split up to 30 %", () => {
    let g = at(createGame(P, 1), "pekin-hub");
    expect(buyableStock(g)).toEqual({ appel: 9, amazone: 15, tesler: 15, sonyx: 10 });
    const cash = g.players[0]!.cash;
    g = ok(g, { type: "BUY", playerId: "a", purchases: { amazone: 10 } });
    expect(g.players[0]!.holdings.amazone).toBe(10);
    expect(g.players[0]!.cash).toBe(cash - 10 * price("amazone"));
    expect(g.stocks["pekin-hub"]!.amazone).toBe(5);
  });

  it("caps the cumulative purchase at 30 % per landing", () => {
    let g = at(createGame(P, 1), "pekin-hub");
    g.players[0]!.cash = 1_000_000;
    g = ok(g, { type: "BUY", playerId: "a", purchases: { amazone: 15, appel: 9 } });
    expect(err(g, { type: "BUY", playerId: "a", purchases: { tesler: 7 } })).toMatch(/30/);
    g = ok(g, { type: "BUY", playerId: "a", purchases: { tesler: 6 } });
    expect(g.boughtThisTurn).toBe(30);
  });

  it("refuses more than the city has, or more than the player can pay", () => {
    let g = at(createGame(P, 1), "paris");
    expect(err(g, { type: "BUY", playerId: "a", purchases: { xiaomy: 8 } })).toMatch(/Stock/);
    g.players[0]!.cash = 0;
    expect(err(g, { type: "BUY", playerId: "a", purchases: { xiaomy: 1 } })).toMatch(/argent/);
  });

  it("other players cannot buy during someone else's turn", () => {
    const g = at(createGame(P, 1), "paris");
    expect(err(g, { type: "BUY", playerId: "b", purchases: { xiaomy: 1 } })).toMatch(/impossible/);
  });

  it("regional choice sells every company of the region, even on the first lap", () => {
    const g = at(createGame(P, 1), "choix-europe");
    expect(buyableStock(g)).toEqual({ amb: 23, sonyx: 10, appel: 9, netflox: 12, samsong: 9, spotifaille: 23, macrosoft: 12, meto: 9, xiaomy: 7, intol: 9, gogol: 9, tesler: 7, nvidio: 7, amazone: 7, oracul: 5, tsmb: 4 });
  });

  it("an Atout is free and can be taken even with two players left", () => {
    const g = at(createGame(P.slice(0, 2), 1), "atout-1");
    expect(g.canBuyAtout).toBe(true);
    expect(ATOUTS.map((a) => a.id)).toContain(g.atoutCard);
    const card = g.atoutCard!;
    const g2 = ok(g, { type: "BUY_ATOUT", playerId: "a" });
    expect(g2.players[0]!.atouts).toEqual([card]);
    expect(g2.atoutCard).toBeNull();
    expect(g2.players[0]!.cash).toBe(g.players[0]!.cash);
  });

  it("Exonération waives the next royalty, Dividende doubles the next one received", () => {
    let g = createGame(P, 1);
    g.royalties.berlin = "intol";
    g.players[1]!.holdings = { intol: 30 };
    g.players[0]!.atouts = ["exoneration"];
    g.players[1]!.atouts = ["dividende"];
    const [a0, b0] = [g.players[0]!.cash, g.players[1]!.cash];
    g = at(g, "berlin");
    expect(g.players[0]!.cash).toBe(a0);
    expect(g.players[0]!.atouts).toEqual([]);
    expect(g.players[1]!.atouts).toEqual(["dividende"]);
    let h = createGame(P, 1);
    h.royalties.berlin = "intol";
    h.players[1]!.holdings = { intol: 30 };
    h.players[1]!.atouts = ["dividende"];
    h = at(h, "berlin");
    const paid = h.events.find((e) => e.kind === "royalty")!.amount;
    expect(h.players[1]!.cash).toBe(b0 + paid * 2);
    expect(h.players[1]!.atouts).toEqual([]);
  });

  it("Rachat express is spent only when a buy goes past 30 %", () => {
    let g = createGame(P, 1);
    g.phase = "act";
    g.buyScope = { kind: "world" };
    g.players[0]!.cash = 10_000_000;
    g.players[0]!.atouts = ["rachat"];
    g = ok(g, { type: "BUY", playerId: "a", purchases: { intol: 30 } });
    expect(g.players[0]!.atouts).toEqual(["rachat"]);
    g = ok(g, { type: "BUY", playerId: "a", purchases: { appel: 15 } });
    expect(g.players[0]!.atouts).toEqual([]);
    expect(err(g, { type: "BUY", playerId: "a", purchases: { nvidio: 1 } })).toMatch(/Maximum/);
  });

  it("world choice sells any company from every city, from the first lap", () => {
    let g = createGame(P, 1);
    g = at(g, "mondial-1");
    expect(Object.keys(buyableStock(g))).toHaveLength(companies.length);
  });
  it("past 50 % held, each further % from the bank costs more and more", () => {
    const base = price("nvidio");
    expect(buyCost("nvidio", 0, 10)).toBe(10 * base);
    expect(buyCost("nvidio", 50, 1)).toBe(Math.round(base * config.dominanceGrowth));
    expect(buyCost("nvidio", 60, 10)).toBeGreaterThan(buyCost("nvidio", 50, 10));
    expect(buyCost("nvidio", 50, 10)).toBeGreaterThan(10 * base);
  });
});

describe("spiral board", () => {
  it("goes from the outer ring straight into the hubs, then back to Départ with a new lap", () => {
    let g = createGame(P, 3);
    g.players[0]!.position = 45;
    g = landOn(g, "ipo-1");
    expect(g.players[0]!.laps).toBe(0);
    g = ok(g, { type: "END_TURN", playerId: "a" });
    g = { ...g, current: 0, phase: "roll" };
    g.players[0]!.position = 78;
    g = landOn(g, "seattle");
    expect(g.players[0]!.position).toBe(1);
    expect(g.players[0]!.laps).toBe(1);
    const lap = g.events.find((e) => e.kind === "lap");
    expect(lap).toMatchObject({ playerId: "a", amount: config.lapBonus });
  });

  it("Introduction en Bourse pays a bonus, Krach takes a share of the cash", () => {
    const ipo = at(createGame(P, 1), "ipo-1");
    expect(ipo.players[0]!.cash).toBe(config.startingCash + config.ipoBonus);
    const krach = at(createGame(P, 1), "krach-1");
    expect(krach.players[0]!.cash).toBe(config.startingCash - (config.startingCash * config.krachPercent) / 100);
  });
});

describe("events", () => {
  it("records the roll, the card and the purchases of the turn, with growing ids", () => {
    let g = at(createGame(P, 1), "pekin-hub");
    g = ok(g, { type: "BUY", playerId: "a", purchases: { amazone: 10 } });
    g = ok(g, { type: "BUY", playerId: "a", purchases: { amazone: 5, tesler: 5 } });
    g = ok(g, { type: "END_TURN", playerId: "a" });
    expect(g.events.map((e) => e.kind)).toEqual(["roll", "buys"]);
    expect(g.events[1]).toMatchObject({ playerId: "a", items: [{ company: "amazone", percent: 15, total: 15 }, { company: "tesler", percent: 5, total: 5 }] });
    expect(g.events[1]!.id).toBeGreaterThan(g.events[0]!.id);
    expect(g.turnBuys).toEqual({});
  });

  it("the end-of-turn recap also lists sales to the bank and trades between players", () => {
    let g = at(createGame(P, 1), "depart");
    g.players[0]!.holdings = { appel: 10 };
    g.players[1]!.holdings = { tesler: 20 };
    g = ok(g, { type: "SELL_TO_BANK", playerId: "a", company: "appel", percent: 4 });
    g = ok(g, { type: "SELL_TO_BANK", playerId: "a", company: "appel", percent: 2 });
    g = ok(g, { type: "OFFER", playerId: "a", ownerId: "b", company: "tesler", percent: 10, price: 700 });
    g = ok(g, { type: "RESPOND_OFFER", playerId: "b", accept: true });
    g = ok(g, { type: "END_TURN", playerId: "a" });
    const recap = g.events.at(-1)!;
    expect(recap).toMatchObject({
      kind: "buys",
      items: [],
      deals: [
        { sellerId: "a", buyerId: null, company: "appel", percent: 6, price: Math.floor(6 * price("appel") * config.bankBuybackRatio) },
        { sellerId: "b", buyerId: "a", company: "tesler", percent: 10, price: 700 },
      ],
    });
  });

  it("rolls the turn order: highest dice first, shown to everyone", () => {
    const g = rollTurnOrder(createGame(P, 5));
    const e = g.events.at(-1)!;
    if (e.kind !== "order") throw new Error("no order event");
    expect(e.rolls.map((r) => r.playerId)).toEqual(g.players.map((p) => p.id));
    const sums = e.rolls.map((r) => r.dice[0] + r.dice[1]);
    expect([...sums].sort((a, b) => b - a)).toEqual(sums);
    expect(new Set(g.players.map((p) => p.id)).size).toBe(P.length);
  });

  it("a Levée de fonds card shows the dice and the cash before and after", () => {
    const g = at(createGame(P, 1), "levee-1");
    const e = g.events.at(-1)!;
    expect(e).toMatchObject({ kind: "levee", amount: 3 * config.leveeFundsPerPip, dice: g.lastRoll, before: config.startingCash, after: config.startingCash + 3 * config.leveeFundsPerPip });
  });
});

describe("stock exchange tower", () => {
  it("a market trend raises or lowers the royalty of its companies", () => {
    let g = createGame(P, 1);
    g.royalties.berlin = "nvidio";
    g.players[1]!.holdings = { nvidio: 40 };
    const a = g.players[0]!.cash;
    g = at(g, "berlin");
    g = { ...g, market: { puces: 20 } };
    expect(royaltyQuote(g, "nvidio").share).toBe(Math.floor((40 * royalty("nvidio") * 120) / 100));
    expect(g.players[0]!.cash).toBe(a - 40 * royalty("nvidio"));
  });

  it("the market stays flat until the leader completes the first lap", () => {
    let g = landOn(createGame(P, 1), board[5]!.id);
    expect(Object.keys(g.market).sort()).toEqual(markets.map((m) => m.id).sort());
    for (let i = 0; i < 4; i++) {
      g = ok({ ...g, phase: "act" }, { type: "END_TURN", playerId: g.players[g.current]!.id });
      expect(Object.values(g.market).every((v) => v === 0)).toBe(true);
    }
  });

  it("only the leader passing Départ draws a new trend, between -30 and +30 %", () => {
    const pass = (g: GameState, laps: number[]) => {
      const s = structuredClone(g);
      s.players.forEach((p, i) => (p.laps = laps[i]!));
      s.players[s.current]!.position = board.length - 3;
      return landOn(s, board[1]!.id);
    };
    const g = createGame(P, 1);
    const lead = pass(g, [0, 0, 0]);
    expect(lead.players[0]!.laps).toBe(1);
    expect(lead.events.at(-1)).toMatchObject({ kind: "market", playerId: lead.players[0]!.id, market: lead.market });
    for (const v of Object.values(lead.market)) expect(Math.abs(v) >= 10 && Math.abs(v) <= 30).toBe(true);
    const behind = pass(g, [0, 1, 0]);
    expect(behind.events.some((e) => e.kind === "market")).toBe(false);
    expect(Object.values(behind.market).every((v) => v === 0)).toBe(true);
    const tied = pass(g, [1, 2, 0]);
    expect(Object.values(tied.market).every((v) => v === 0)).toBe(true);
  });

  it("fines go to the pot, and only the jackpot card wins it", () => {
    let g = at(createGame(P, 1), "krach-1");
    const loss = Math.floor((config.startingCash * config.krachPercent) / 100);
    expect(g.pot).toBe(loss);
    g = ok(g, { type: "END_TURN", playerId: "a" });
    const b = g.players[g.current]!;
    g.actuDeck = ["actu-jackpot", ...g.actuDeck.filter((id) => id !== "actu-jackpot")];
    const before = b.cash;
    g = at(g, "actu-1");
    expect(g.players.find((p) => p.id === b.id)!.cash).toBe(before + loss);
    expect(g.pot).toBe(0);
    expect(g.events.at(-1)).toMatchObject({ kind: "jackpot", amount: loss });
  });

  it("a double earns a bonus", () => {
    let g = createGame(P, 1);
    for (let seed = 1; ; seed++) {
      const [d1, s1] = rollDie(seed);
      const [d2] = rollDie(s1);
      if (d1 === d2) {
        g = ok({ ...g, seed }, { type: "ROLL", playerId: "a" });
        break;
      }
    }
    expect(g.events.find((e) => e.kind === "double")).toMatchObject({ playerId: "a", amount: config.doubleBonus });
  });
});

describe("royalties", () => {
  function withRoyalty(company: string): GameState {
    const g = createGame(P, 1);
    g.royalties.berlin = company;
    return g;
  }

  it("pays only the biggest holder, proportionally to their percent", () => {
    let g = withRoyalty("nvidio");
    g.players[1]!.holdings = { nvidio: 40 };
    g.players[2]!.holdings = { nvidio: 20 };
    const [a, b, c] = g.players.map((p) => p.cash);
    g = at(g, "berlin");
    expect(g.players[0]!.cash).toBe(a! - 40 * royalty("nvidio"));
    expect(g.players[1]!.cash).toBe(b! + 40 * royalty("nvidio"));
    expect(g.players[2]!.cash).toBe(c);
  });

  it("a payer who holds as much as the biggest holder pays nothing", () => {
    let g = withRoyalty("nvidio");
    g.players[0]!.holdings = { nvidio: 30 };
    g.players[1]!.holdings = { nvidio: 30 };
    const [a, b] = g.players.map((p) => p.cash);
    g = at(g, "berlin");
    expect(g.players[0]!.cash).toBe(a);
    expect(g.players[1]!.cash).toBe(b);
    expect(g.events.some((e) => e.kind === "royalty")).toBe(false);
  });

  it("splits a tie equally", () => {
    let g = withRoyalty("nvidio");
    g.players[1]!.holdings = { nvidio: 30 };
    g.players[2]!.holdings = { nvidio: 30 };
    const a = g.players[0]!.cash;
    g = at(g, "berlin");
    const share = Math.floor((30 * royalty("nvidio")) / 2);
    expect(g.players[0]!.cash).toBe(a - 2 * share);
    expect(g.players[1]!.cash).toBe(config.startingCash + share);
  });

  it("grows faster past 50 % and doubles at 100 %", () => {
    expect(royaltyFor("intol", 50, 0)).toBe(50 * royalty("intol"));
    expect(royaltyFor("intol", 60, 0)).toBeGreaterThan(60 * royalty("intol"));
    expect(royaltyFor("intol", 100, 0)).toBeGreaterThan(2 * royaltyFor("intol", 99, 0));
    let g = withRoyalty("intol");
    g.players[1]!.holdings = { intol: 100 };
    g = at(g, "berlin");
    expect(g.players[1]!.cash).toBe(config.startingCash + royaltyFor("intol", 100, 0));
  });

  it("the biggest holder landing on their own company pays nothing", () => {
    let g = withRoyalty("nvidio");
    g.players[0]!.holdings = { nvidio: 40 };
    g = at(g, "berlin");
    expect(g.players[0]!.cash).toBe(config.startingCash);
  });

  it("goes into debt, then selling everything is not enough: bankruptcy", () => {
    let g = withRoyalty("intol");
    g.players[1]!.holdings = { intol: 100 };
    g.players[0]!.cash = 0;
    g.players[0]!.holdings = { sonyx: 10 };
    g = at(g, "berlin");
    expect(g.players[0]!.cash).toBeLessThan(0);
    expect(g.debt).toMatchObject({ debtorId: "a", creditorId: "b" });
    expect(err(g, { type: "END_TURN", playerId: "a" })).toMatch(/dette/);
    g = ok(g, { type: "SETTLE_DEBT", playerId: "a" });
    const alice = g.players[0]!;
    expect(alice.bankrupt).toBe(true);
    expect(g.eliminated).toEqual(["a"]);
    expect(g.players[g.current]!.id).toBe("b");
    expect(g.stocks["dubai"]!.sonyx).toBe(15);
  });
});

describe("trading with other players", () => {
  it("only the current player makes offers; owner can counter, buyer accepts", () => {
    let g = at(createGame(P, 1), "depart");
    g.players[1]!.holdings = { tesler: 20 };
    expect(err(g, { type: "OFFER", playerId: "b", ownerId: "a", company: "tesler", percent: 5, price: 100 })).toMatch(/impossible/);
    g = ok(g, { type: "OFFER", playerId: "a", ownerId: "b", company: "tesler", percent: 10, price: 500 });
    g = ok(g, { type: "RESPOND_OFFER", playerId: "b", accept: false, counterPrice: 900 });
    expect(g.offer?.awaiting).toBe("a");
    g = ok(g, { type: "RESPOND_OFFER", playerId: "a", accept: true });
    expect(g.players[0]!.holdings.tesler).toBe(10);
    expect(g.players[1]!.holdings.tesler).toBe(10);
    expect(g.players[1]!.cash).toBe(config.startingCash + 900);
  });

  it("a refused offer changes nothing", () => {
    let g = at(createGame(P, 1), "depart");
    g.players[1]!.holdings = { tesler: 20 };
    g = ok(g, { type: "OFFER", playerId: "a", ownerId: "b", company: "tesler", percent: 10, price: 500 });
    g = ok(g, { type: "RESPOND_OFFER", playerId: "b", accept: false });
    expect(g.offer).toBeNull();
    expect(g.players[1]!.holdings.tesler).toBe(20);
  });
});

describe("auctions", () => {
  // Alice lands on Enchères; Bob owns 50 % of Appel
  function auction(): GameState {
    const g = createGame(P, 1);
    g.players[1]!.holdings = { appel: 50 };
    return at(g, "encheres-1");
  }

  it("the lander picks an opponent's company; dice x 5 % go to the highest bidder, the owner is paid", () => {
    let g = auction();
    expect(g.phase).toBe("auction");
    const toSell = g.auction!.percentToSell;
    expect(err(g, { type: "AUCTION_CHOOSE", playerId: "a", ownerId: "c", company: "appel" })).toMatch(/détient pas/);
    g = ok(g, { type: "AUCTION_CHOOSE", playerId: "a", ownerId: "b", company: "appel" });
    expect(g.auction!.startPrice).toBe(Math.floor(toSell * price("appel") * config.bankBuybackRatio));
    expect(err(g, { type: "BID", playerId: "b", amount: 99999 })).toMatch(/interdite/);
    g = ok(g, { type: "BID", playerId: "a", amount: g.auction!.startPrice });
    expect(err(g, { type: "BID", playerId: "c", amount: g.auction!.highestBid + 1 })).toMatch(/minimum/);
    const bid = g.auction!.highestBid + config.minBidIncrement;
    g = ok(g, { type: "BID", playerId: "c", amount: bid });
    expect(g.auction!.bids.map((x) => x.playerId)).toEqual(["a", "c"]);
    g = ok(g, { type: "AUCTION_CLOSE" });
    expect(g.players[2]!.holdings.appel).toBe(toSell);
    expect(g.players[1]!.holdings.appel).toBe(50 - toSell);
    expect(g.players[1]!.cash).toBe(config.startingCash + bid);
    expect(g.events.at(-1)).toMatchObject({ kind: "auction", winnerId: "c", price: bid, sellerId: "b" });
    expect(g.phase).toBe("act");
  });

  it("without bids the bank buys at 75 % and refills city stock", () => {
    let g = auction();
    g = ok(g, { type: "AUCTION_CHOOSE", playerId: "a", ownerId: "b", company: "appel" });
    const start = g.auction!.startPrice;
    g = ok(g, { type: "AUCTION_CLOSE" });
    expect(g.players[1]!.cash).toBe(config.startingCash + start);
  });

  it("the targeted owner can cancel it with an Atout", () => {
    let g = createGame(P, 1);
    g.players[1]!.atouts = ["bouclier"];
    g.players[1]!.holdings = { appel: 50 };
    g = at(g, "encheres-1");
    g = ok(g, { type: "AUCTION_CHOOSE", playerId: "a", ownerId: "b", company: "appel" });
    g = ok(g, { type: "USE_ATOUT", playerId: "b" });
    expect(g.phase).toBe("act");
    expect(g.players[1]!.holdings.appel).toBe(50);
    expect(g.players[1]!.atouts).toEqual([]);
  });

  it("the lander may put fewer percent up for auction, never more than the dice allow", () => {
    let g = auction();
    const most = g.auction!.percentToSell;
    expect(err(g, { type: "AUCTION_CHOOSE", playerId: "a", ownerId: "b", company: "appel", percent: most + 1 })).toMatch(/Entre 1/);
    expect(err(g, { type: "AUCTION_CHOOSE", playerId: "a", ownerId: "b", company: "appel", percent: 0 })).toMatch(/Entre 1/);
    g = ok(g, { type: "AUCTION_CHOOSE", playerId: "a", ownerId: "b", company: "appel", percent: 1 });
    expect(g.auction!.percent).toBe(1);
  });

  it("never puts more than 15 % up for auction", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = createGame(P, seed);
      g.players[1]!.holdings = { appel: 50 };
      expect(at(g, "encheres-1").auction!.percentToSell).toBeLessThanOrEqual(config.auctionMaxPercent);
    }
  });

  it("works from the first lap, and does nothing when no opponent holds anything", () => {
    expect(auction().phase).toBe("auction");
    expect(at(createGame(P, 1), "encheres-1").phase).toBe("act");
  });
});

describe("debts", () => {
  it("a player who can cover a payment by selling picks what to sell before ending the turn", () => {
    let g = createGame(P, 1);
    g.royalties.berlin = "intol";
    g.players[1]!.holdings = { intol: 50 };
    g.players[0]!.cash = 0;
    g.players[0]!.holdings = { nvidio: 60 };
    g = at(g, "berlin");
    const due = 50 * royalty("intol");
    expect(g.players[0]!.cash).toBe(-due);
    expect(g.players[0]!.bankrupt).toBe(false);
    expect(err(g, { type: "END_TURN", playerId: "a" })).toMatch(/dette/);
    g = ok(g, { type: "SELL_TO_BANK", playerId: "a", company: "nvidio", percent: 60 });
    expect(g.players[0]!.cash).toBeGreaterThanOrEqual(0);
    g = ok(g, { type: "END_TURN", playerId: "a" });
  });

  it("SETTLE_DEBT sells the cheapest holdings automatically, just enough", () => {
    let g = createGame(P, 1);
    g.players[0]!.cash = -100;
    g.players[0]!.holdings = { nvidio: 10, sonyx: 10 };
    g = ok(g, { type: "SETTLE_DEBT", playerId: "a" });
    expect(g.players[0]!.cash).toBeGreaterThanOrEqual(0);
    expect(g.players[0]!.holdings.nvidio).toBe(10);
    expect(g.players[0]!.holdings.sonyx).toBeLessThan(10);
  });
});

describe("game end", () => {
  it("END_GAME (chrono) picks the richest player", () => {
    const g = createGame(P, 1, "chrono");
    g.players[2]!.holdings = { nvidio: 10 };
    const r = applyAction(g, { type: "END_GAME" });
    expect(r.ok && r.state.winner).toBe("c");
  });
});

describe("kick", () => {
  it("removes the current player and passes the turn", () => {
    const g = createGame(P, 1);
    g.players[0]!.holdings = { nvidio: 10 };
    const r = applyAction(g, { type: "KICK", targetId: g.players[0]!.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players[0]!.bankrupt).toBe(true);
    expect(r.state.players[0]!.holdings).toEqual({});
    expect(r.state.current).toBe(1);
    expect(r.state.phase).toBe("roll");
  });

  it("ends the game when one player is left", () => {
    const g = createGame(P, 1);
    const r1 = applyAction(g, { type: "KICK", targetId: "b" });
    const r2 = r1.ok ? applyAction(r1.state, { type: "KICK", targetId: "c" }) : r1;
    expect(r2.ok && r2.state.winner).toBe("a");
  });
});

describe("ranking", () => {
  it("orders winner, survivors by net worth, then last eliminated first", async () => {
    const { ranking } = await import("./game");
    const g = createGame([...P, { id: "d", name: "Dan" }], 1);
    g.players[1]!.bankrupt = true;
    g.players[3]!.bankrupt = true;
    g.eliminated = ["d", "b"];
    g.players[2]!.cash = 99999;
    g.winner = "a";
    expect(ranking(g)).toEqual(["a", "c", "b", "d"]);
  });
});

describe("alliances", () => {
  const P4 = [{ id: "a", name: "Alice" }, { id: "b", name: "Bob" }, { id: "c", name: "Chloé" }, { id: "d", name: "Dan" }];
  const allied = (players = P4) => {
    let g = createGame(players, 1);
    g = ok(g, { type: "ALLIANCE_INVITE", playerId: "b", targetId: "c" });
    return ok(g, { type: "ALLIANCE_ANSWER", playerId: "c", fromId: "b", accept: true });
  };

  it("invite, accept, then leave dissolves a two-player alliance", () => {
    let g = allied();
    expect(g.alliances).toEqual([{ id: "a1", members: ["b", "c"] }]);
    expect(g.allianceInvites).toEqual([]);
    g = ok(g, { type: "ALLIANCE_LEAVE", playerId: "c" });
    expect(g.alliances).toEqual([]);
  });

  it("refusing removes the invite, and someone must stay outside the alliance", () => {
    let g = createGame(P, 1);
    g = ok(g, { type: "ALLIANCE_INVITE", playerId: "a", targetId: "b" });
    g = ok(g, { type: "ALLIANCE_ANSWER", playerId: "b", fromId: "a", accept: false });
    expect(g.allianceInvites).toEqual([]);
    expect(g.alliances).toEqual([]);
    g = ok(g, { type: "ALLIANCE_INVITE", playerId: "a", targetId: "b" });
    g = ok(g, { type: "ALLIANCE_ANSWER", playerId: "b", fromId: "a", accept: true });
    expect(err(g, { type: "ALLIANCE_INVITE", playerId: "a", targetId: "c" })).toMatch(/adversaire/);
    expect(err(g, { type: "ALLIANCE_INVITE", playerId: "c", targetId: "a" })).toMatch(/déjà dans une alliance/);
  });

  it("the two richest players cannot ally", () => {
    let g = createGame(P4, 1);
    g.players.find((p) => p.id === "a")!.cash += 5000;
    g.players.find((p) => p.id === "d")!.cash += 3000;
    expect(err(g, { type: "ALLIANCE_INVITE", playerId: "a", targetId: "d" })).toMatch(/en tête/);
    g = ok(g, { type: "ALLIANCE_INVITE", playerId: "a", targetId: "b" });
    g = ok(g, { type: "ALLIANCE_INVITE", playerId: "d", targetId: "c" });
    // d became second richest... the invite from a to b stays valid while b is not a leader
    g = ok(g, { type: "ALLIANCE_ANSWER", playerId: "b", fromId: "a", accept: true });
    expect(err(g, { type: "ALLIANCE_INVITE", playerId: "b", targetId: "d" })).toMatch(/en tête/);
  });

  it("allies add up their % to beat a bigger solo holder and split the royalty by %", () => {
    let g = allied();
    g.royalties.berlin = "nvidio";
    g.players[1]!.holdings = { nvidio: 20 };
    g.players[2]!.holdings = { nvidio: 10 };
    g.players[3]!.holdings = { nvidio: 25 };
    g = at(g, "berlin");
    const share = 30 * royalty("nvidio");
    expect(g.players[0]!.cash).toBe(config.startingCash - share);
    expect(g.players[1]!.cash).toBe(config.startingCash + Math.floor((share * 20) / 30));
    expect(g.players[2]!.cash).toBe(config.startingCash + Math.floor((share * 10) / 30));
    expect(g.players[3]!.cash).toBe(config.startingCash);
  });

  it("allies do not pay each other", () => {
    let g = allied();
    g = ok(g, { type: "ALLIANCE_INVITE", playerId: "a", targetId: "d" });
    g.royalties.berlin = "nvidio";
    g.alliances[0]!.members = ["a", "b"];
    g.players[1]!.holdings = { nvidio: 30 };
    g = at(g, "berlin");
    expect(g.players[0]!.cash).toBe(config.startingCash);
    expect(g.players[1]!.cash).toBe(config.startingCash);
  });

  it("the alliance ends when a bankruptcy leaves it covering every player", () => {
    let g = allied(P);
    expect(g.alliances).toHaveLength(1);
    g.royalties.berlin = "intol";
    g.players[1]!.holdings = { intol: 100 };
    g.players[0]!.cash = 0;
    g = at(g, "berlin");
    g = ok(g, { type: "SETTLE_DEBT", playerId: "a" });
    expect(g.players[0]!.bankrupt).toBe(true);
    expect(g.alliances).toEqual([]);
  });
});

describe("debts and loans", () => {
  function inDebt(): GameState {
    const g = createGame(P, 1);
    g.royalties.berlin = "intol";
    g.players[1]!.holdings = { intol: 100 };
    g.players[0]!.cash = 0;
    g.players[0]!.holdings = { sonyx: 10, tesler: 3 };
    return at(g, "berlin");
  }

  it("the creditor can take shares instead of the money owed", () => {
    let g = inDebt();
    const owed = -g.players[0]!.cash;
    const bobCash = g.players[1]!.cash;
    expect(err(g, { type: "DEBT_DEAL_OFFER", playerId: "a", shares: { sonyx: 20 } })).toMatch(/invalide/);
    g = ok(g, { type: "DEBT_DEAL_OFFER", playerId: "a", shares: { sonyx: 5 } });
    expect(err(g, { type: "DEBT_DEAL_ANSWER", playerId: "c", accept: true })).toMatch(/Aucun/);
    g = ok(g, { type: "DEBT_DEAL_ANSWER", playerId: "b", accept: true });
    expect(g.players[0]!.cash).toBe(0);
    expect(g.players[0]!.holdings).toEqual({ sonyx: 5, tesler: 3 });
    expect(g.players[1]!.holdings.sonyx).toBe(5);
    expect(g.players[1]!.cash).toBe(bobCash - owed);
    expect(g.debt).toBeNull();
    g = ok(g, { type: "END_TURN", playerId: "a" });
  });

  it("a refused deal keeps the debt", () => {
    let g = inDebt();
    g = ok(g, { type: "DEBT_DEAL_OFFER", playerId: "a", shares: { tesler: 1 } });
    g = ok(g, { type: "DEBT_DEAL_ANSWER", playerId: "b", accept: false });
    expect(g.players[0]!.cash).toBeLessThan(0);
    expect(g.debt?.offer).toBeNull();
  });

  it("declaring bankruptcy deals the shares left to the other players", () => {
    let g = createGame(P, 1);
    g.players[0]!.holdings = { sonyx: 5, tesler: 2 };
    g = ok(g, { type: "DECLARE_BANKRUPTCY", playerId: "a" });
    expect(g.players[1]!.holdings).toEqual({ sonyx: 3, tesler: 1 });
    expect(g.players[g.current]!.id).toBe("b");
    g = inDebt();
    g = ok(g, { type: "DECLARE_BANKRUPTCY", playerId: "a" });
    expect(g.players[0]!.bankrupt).toBe(true);
    expect(g.players[1]!.holdings).toMatchObject({ sonyx: 5, tesler: 2 });
    expect(g.players[2]!.holdings).toEqual({ sonyx: 5, tesler: 1 });
    expect(g.players[g.current]!.id).toBe("b");
  });

  it("a loan is paid back with a share of every income, up to the cap", () => {
    let g = createGame(P, 1);
    g = ok(g, { type: "LOAN_OFFER", playerId: "b", borrowerId: "a", amount: 1000 });
    expect(err(g, { type: "LOAN_OFFER", playerId: "b", borrowerId: "a", amount: 1000 })).toMatch(/déjà/);
    const [a0, b0] = [g.players[0]!.cash, g.players[1]!.cash];
    g = ok(g, { type: "LOAN_ANSWER", playerId: "a", lenderId: "b", accept: true });
    expect(g.players[0]!.cash).toBe(a0 + 1000);
    expect(g.loans).toHaveLength(1);
    g.royalties.berlin = "intol";
    g.players[0]!.holdings = { intol: 100 };
    g.current = 2;
    g = at(g, "berlin");
    const paid = g.events.find((e) => e.kind === "royalty")!.amount;
    const cut = Math.min(Math.floor((paid * config.loanShare) / 100), (1000 * config.loanCap) / 100);
    expect(g.players[0]!.cash).toBe(a0 + 1000 + paid - cut);
    expect(g.players[1]!.cash).toBe(b0 - 1000 + cut);
    if (cut === (1000 * config.loanCap) / 100) expect(g.loans).toEqual([]);
  });

  it("the bankrupt player can choose who gets which shares", () => {
    let g = createGame(P, 1);
    g.players[0]!.holdings = { sonyx: 10, tesler: 4 };
    expect(err(g, { type: "DECLARE_BANKRUPTCY", playerId: "a", split: { c: { sonyx: 11 } } })).toMatch(/autant/);
    expect(err(g, { type: "DECLARE_BANKRUPTCY", playerId: "a", split: { a: { sonyx: 1 } } })).toMatch(/introuvable/);
    g = ok(g, { type: "DECLARE_BANKRUPTCY", playerId: "a", split: { c: { sonyx: 10 }, b: { tesler: 1 } } });
    expect(g.players[2]!.holdings.sonyx).toBe(10);
    // the 3 % of Tesler left unassigned are dealt out in turn order: b, c, b
    expect(g.players[1]!.holdings).toEqual({ tesler: 3 });
    expect(g.players[2]!.holdings.tesler).toBe(1);
  });

  it("a lender landing on the borrower's city lowers the loan instead of paying", () => {
    let g = createGame(P, 1);
    g = ok(g, { type: "LOAN_OFFER", playerId: "a", borrowerId: "b", amount: 5000 });
    g = ok(g, { type: "LOAN_ANSWER", playerId: "b", lenderId: "a", accept: true });
    g.royalties.berlin = "intol";
    g.players[1]!.holdings = { intol: 30 };
    const [a0, b0] = [g.players[0]!.cash, g.players[1]!.cash];
    g = at(g, "berlin");
    const paid = g.events.find((e) => e.kind === "royalty")!.amount;
    expect(paid).toBeGreaterThan(0);
    expect(g.players[0]!.cash).toBe(a0);
    expect(g.players[1]!.cash).toBe(b0);
    expect(g.loans[0]!.repaid).toBe(paid);
  });
});
