import { actuCards, board, companies, config, markets } from "./data";
import { nextRandom, rollDie } from "./rng";
import type { Deal, GameMode, GameState, Loan, NewGameEvent, Player, PlayerId, PlayerStats } from "./state";
import type { CompanyId } from "./types";

export type Action =
  | { type: "ROLL"; playerId: PlayerId; dice?: [number, number] }
  | { type: "BUY"; playerId: PlayerId; purchases: Record<CompanyId, number> }
  | { type: "SELL_TO_BANK"; playerId: PlayerId; company: CompanyId; percent: number }
  | { type: "OFFER"; playerId: PlayerId; ownerId: PlayerId; company: CompanyId; percent: number; price: number }
  | { type: "RESPOND_OFFER"; playerId: PlayerId; accept: boolean; counterPrice?: number }
  | { type: "OFFER_TIMEOUT" }
  | { type: "AUCTION_CHOOSE"; playerId: PlayerId; ownerId: PlayerId; company: CompanyId; percent?: number }
  | { type: "SETTLE_DEBT"; playerId: PlayerId }
  | { type: "USE_ATOUT"; playerId: PlayerId; atout?: string }
  | { type: "BID"; playerId: PlayerId; amount: number }
  | { type: "AUCTION_CLOSE" }
  | { type: "AUCTION_PASS"; playerId: PlayerId }
  | { type: "END_TURN"; playerId: PlayerId }
  | { type: "ALLIANCE_INVITE"; playerId: PlayerId; targetId: PlayerId }
  | { type: "ALLIANCE_ANSWER"; playerId: PlayerId; fromId: PlayerId; accept: boolean }
  | { type: "ALLIANCE_LEAVE"; playerId: PlayerId }
  | { type: "DEBT_DEAL_OFFER"; playerId: PlayerId; shares: Record<CompanyId, number> }
  | { type: "DEBT_DEAL_ANSWER"; playerId: PlayerId; accept: boolean }
  | { type: "DECLARE_BANKRUPTCY"; playerId: PlayerId; split?: Record<PlayerId, Record<CompanyId, number>> }
  | { type: "LOAN_OFFER"; playerId: PlayerId; borrowerId: PlayerId; amount: number }
  | { type: "LOAN_ANSWER"; playerId: PlayerId; lenderId: PlayerId; accept: boolean }
  | { type: "END_GAME" }
  | { type: "KICK"; targetId: PlayerId };

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

const companyById = new Map(companies.map((c) => [c.id, c]));
const cityStockOrigin = board.flatMap((c) => (c.type === "city" ? [c] : []));

// Atout cards: one is drawn at random on each Atout cell and given to the player
export const ATOUTS = [
  { id: "bouclier", name: "Bouclier anti-OPA", text: "Annule la prochaine enchère forcée sur tes actions." },
  { id: "exoneration", name: "Exonération", text: "Ta prochaine redevance à payer est offerte." },
  { id: "dividende", name: "Dividende exceptionnel", text: "La prochaine redevance que tu touches est doublée par la banque." },
  { id: "rachat", name: "Rachat express", text: "Se déclenche tout seul si tu achètes plus de 30 % dans un tour : +15 % d'achat autorisé ce tour-ci." },
] as const;
export const atoutById = new Map<string, (typeof ATOUTS)[number]>(ATOUTS.map((a) => [a.id, a]));
export const RACHAT_BONUS = 15;

// Removes one card of that kind, returns whether the player had it
function spendAtout(p: Player, id: string): boolean {
  const i = p.atouts.indexOf(id);
  if (i < 0) return false;
  p.atouts.splice(i, 1);
  return true;
}

// Starting cash the host can pick before the game
export const STARTING_CASH_OPTIONS = [15000, 20000, 25000, 30000, 40000, 50000];
// a custom amount is allowed too, within these bounds
export const isStartingCash = (v: number) => Number.isInteger(v) && v >= 1000 && v <= 1000000;

export function createGame(players: { id: PlayerId; name: string }[], seed: number, mode: GameMode = "classique", startingCash = config.startingCash): GameState {
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`Il faut entre ${config.minPlayers} et ${config.maxPlayers} joueurs`);
  }
  if (!isStartingCash(startingCash)) throw new Error("Argent de départ invalide");
  let s = seed >>> 0;
  const tokens = companies.flatMap((c) => Array<CompanyId>(config.royaltyTokensPerCompany).fill(c.id));
  [s] = shuffle(tokens, s);
  const deck = actuCards.map((c) => c.id);
  [s] = shuffle(deck, s);
  const royalties: Record<string, CompanyId> = {};
  cityStockOrigin.forEach((city, i) => (royalties[city.id] = tokens[i]!));
  // flat market until the leader completes the first lap
  const market: Record<string, number> = Object.fromEntries(markets.map((m) => [m.id, 0]));
  return {
    seed: s,
    market,
    pot: 0,
    mode,
    players: players.map((p) => ({ ...p, cash: startingCash, position: 0, holdings: {}, atouts: [], laps: 0, bankrupt: false })),
    current: 0,
    phase: "roll",
    stocks: Object.fromEntries(cityStockOrigin.map((c) => [c.id, { ...c.stock }])),
    royalties,
    actuDeck: deck,
    lastRoll: null,
    buyScope: null,
    boughtThisTurn: 0,
    auction: null,
    offer: null,
    alliances: [],
    allianceInvites: [],
    nextAllianceId: 1,
    events: [],
    nextEventId: 1,
    stats: { players: {}, landings: {}, companyRoyalties: {}, history: [] },
    turnBuys: {},
    turnDeals: [],
    debt: null,
    loans: [],
    loanOffers: [],
    eliminated: [],
    winner: null,
    log: [],
  };
}

// Everyone rolls two dice; the highest total plays first, ties are broken at random
export function rollTurnOrder(state: GameState): GameState {
  let s = state.seed;
  const roll = (): [number, number] => {
    const [a, s1] = rollDie(s);
    const [b, s2] = rollDie(s1);
    s = s2;
    return [a, b];
  };
  const shown = new Map(state.players.map((p) => [p.id, roll()]));
  const tiebreak = new Map(state.players.map((p) => [p.id, 0]));
  const sum = (id: PlayerId) => shown.get(id)![0] + shown.get(id)![1];
  for (const p of state.players) {
    while (state.players.some((o) => o.id !== p.id && sum(o.id) === sum(p.id) && tiebreak.get(o.id) === tiebreak.get(p.id))) {
      const [r, next] = nextRandom(s);
      s = next;
      tiebreak.set(p.id, r);
    }
  }
  const players = [...state.players].sort((a, b) => sum(b.id) - sum(a.id) || tiebreak.get(b.id)! - tiebreak.get(a.id)!);
  const next = { ...state, seed: s, players, events: [...state.events] };
  emit(next, { kind: "order", rolls: players.map((p) => ({ playerId: p.id, dice: shown.get(p.id)! })) });
  return next;
}

const MAX_EVENTS = 40;

function blankStats(): PlayerStats {
  return { rolls: 0, doubles: 0, distance: 0, royaltiesPaid: 0, royaltiesReceived: 0, biggestPaid: 0, biggestReceived: 0, cardsGain: 0, cardsLoss: 0, spentOnStocks: 0, percentBought: 0, salesIncome: 0, auctionsWon: 0, auctionSpent: 0, auctionIncome: 0, atouts: 0, peakWorth: 0 };
}

export function statsOf(state: GameState, id: PlayerId): PlayerStats {
  state.stats ??= { players: {}, landings: {}, companyRoyalties: {}, history: [] };
  return (state.stats.players[id] ??= blankStats());
}

function record(state: GameState, e: NewGameEvent): void {
  switch (e.kind) {
    case "roll": {
      const s = statsOf(state, e.playerId);
      s.rolls += 1;
      s.distance += e.dice[0] + e.dice[1];
      if (e.dice[0] === e.dice[1]) s.doubles += 1;
      state.stats.landings[e.to] = (state.stats.landings[e.to] ?? 0) + 1;
      break;
    }
    case "actu": case "ipo": case "krach": case "lap": case "double": case "jackpot": case "levee": {
      const s = statsOf(state, e.playerId);
      if (e.amount > 0) s.cardsGain += e.amount;
      else s.cardsLoss -= e.amount;
      break;
    }
    case "atout":
      if (e.text.startsWith("Atout pris")) statsOf(state, e.playerId).atouts += 1;
      break;
    case "royalty": {
      const s = statsOf(state, e.playerId);
      s.royaltiesPaid += e.amount;
      s.biggestPaid = Math.max(s.biggestPaid, e.amount);
      state.stats.companyRoyalties[e.company] = (state.stats.companyRoyalties[e.company] ?? 0) + e.amount;
      break;
    }
    case "buys":
      for (const d of e.deals) statsOf(state, d.sellerId).salesIncome += d.price;
      break;
    case "auction":
      if (e.cancelled) break;
      statsOf(state, e.sellerId).auctionIncome += e.price;
      if (e.winnerId) {
        statsOf(state, e.winnerId).auctionsWon += 1;
        statsOf(state, e.winnerId).auctionSpent += e.price;
      }
      break;
  }
}

// Net worth of everyone, once per round and at the end
function snapshot(state: GameState): void {
  const row: Record<PlayerId, number> = {};
  for (const p of state.players) {
    row[p.id] = p.bankrupt ? 0 : netWorth(p);
    const s = statsOf(state, p.id);
    s.peakWorth = Math.max(s.peakWorth, row[p.id]!);
  }
  state.stats.history.push(row);
}

function emit(state: GameState, e: NewGameEvent): void {
  record(state, e);
  if (e.kind === "win") snapshot(state);
  state.events.push({ ...e, id: state.nextEventId++ } as GameState["events"][number]);
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

// Cash change shown on a card: who, why, how much, before and after
function money(state: GameState, p: Player, kind: "actu" | "ipo" | "krach" | "lap" | "atout" | "double" | "jackpot", text: string, amount: number): void {
  const before = p.cash;
  if (amount >= 0) earn(state, p, amount);
  else {
    // fines and taxes pile up in the stock exchange tower
    state.pot += -amount;
    charge(state, p, -amount);
  }
  emit(state, { kind, playerId: p.id, text, amount, before, after: p.cash });
}

// Any income: a share of it goes to the player's lenders until each loan is paid back
function earn(state: GameState, p: Player, amount: number): void {
  p.cash += amount;
  for (const loan of state.loans.filter((l) => l.borrowerId === p.id)) {
    const cut = Math.min(Math.floor((amount * config.loanShare) / 100), loanLeft(loan));
    if (cut <= 0) continue;
    p.cash -= cut;
    player(state, loan.lenderId)!.cash += cut;
    loan.repaid += cut;
  }
  state.loans = state.loans.filter((l) => loanLeft(l) > 0);
}

export const loanLeft = (l: Loan) => Math.ceil((l.amount * config.loanCap) / 100) - l.repaid;

function shuffle<T>(arr: T[], seed: number): [number] {
  let s = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    const [r, next] = nextRandom(s);
    s = next;
    const j = Math.floor(r * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return [s];
}

// With a single possible bidder there is no race: the auction ends on their bid or pass, without a timer
export function soleBidder(state: GameState): PlayerId | null {
  const a = state.auction;
  if (!a?.company) return null;
  const bidders = activePlayers(state).filter((p) => p.id !== a.sellerId);
  return bidders.length === 1 ? bidders[0]!.id : null;
}

function closeAuction(state: GameState): void {
  const a = state.auction!;
  if (!a.company || !a.sellerId) return;
  const seller = player(state, a.sellerId)!;
  // the seller may have sold to the bank meanwhile
  const percent = Math.min(a.percent, seller.holdings[a.company] ?? 0);
  const winner = a.highestBidderId ? player(state, a.highestBidderId)! : null;
  removeHolding(seller, a.company, percent);
  if (winner && winner.cash >= a.highestBid) {
    winner.cash -= a.highestBid;
    seller.cash += a.highestBid;
    winner.holdings[a.company] = (winner.holdings[a.company] ?? 0) + percent;
    emit(state, { kind: "auction", playerId: a.chooserId, sellerId: seller.id, company: a.company, percent, price: a.highestBid, winnerId: winner.id, cancelled: false });
  } else {
    const price = bankPrice(a.company, percent);
    seller.cash += price;
    returnToStock(state, a.company, percent);
    emit(state, { kind: "auction", playerId: a.chooserId, sellerId: seller.id, company: a.company, percent, price, winnerId: null, cancelled: false });
  }
  state.auction = null;
  state.phase = "act";
}

export function activePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.bankrupt);
}

export function currentPlayer(state: GameState): Player {
  return state.players[state.current]!;
}

function player(state: GameState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

function percentPrice(company: CompanyId, percent: number): number {
  return companyById.get(company)!.pricePerPercent * percent;
}

// Buying from the bank: past dominanceFrom % held, each further % costs dominanceGrowth times the previous one
export function buyCost(company: CompanyId, held: number, percent: number): number {
  const base = companyById.get(company)!.pricePerPercent;
  let cost = 0;
  for (let k = 1; k <= percent; k++) cost += base * config.dominanceGrowth ** Math.max(0, held + k - config.dominanceFrom);
  return Math.round(cost);
}

// Royalty for the biggest holder owning `percent`: past dominanceFrom each % earns dominanceGrowth times the previous one,
// doubled at 100 %, then the market trend of the turn
export function royaltyFor(company: CompanyId, percent: number, trend: number): number {
  const base = companyById.get(company)!.royaltyPerPercent;
  let sum = 0;
  for (let k = 1; k <= percent; k++) sum += base * config.dominanceGrowth ** Math.max(0, k - config.dominanceFrom);
  const multiplier = percent === 100 ? config.monopolyMultiplier : 1;
  return Math.floor((sum * multiplier * (100 + trend)) / 100);
}

function bankPrice(company: CompanyId, percent: number): number {
  return Math.floor(percentPrice(company, percent) * config.bankBuybackRatio);
}

// Percent returned to the bank goes back to the cities that originally held it, in board order
function returnToStock(state: GameState, company: CompanyId, percent: number): void {
  let left = percent;
  for (const city of cityStockOrigin) {
    const max = city.stock[company] ?? 0;
    const stock = state.stocks[city.id]!;
    const room = max - (stock[company] ?? 0);
    if (room <= 0) continue;
    const put = Math.min(room, left);
    stock[company] = (stock[company] ?? 0) + put;
    left -= put;
    if (left === 0) return;
  }
}

function removeHolding(p: Player, company: CompanyId, percent: number): void {
  const left = (p.holdings[company] ?? 0) - percent;
  if (left > 0) p.holdings[company] = left;
  else delete p.holdings[company];
}

// Sells holdings to the bank, cheapest first, until cash is back to `target`
// Repeated sales of the same company by the same player add up into one line of the recap
function recordDeal(state: GameState, deal: Deal): void {
  const same = state.turnDeals.find((d) => d.sellerId === deal.sellerId && d.buyerId === deal.buyerId && d.company === deal.company);
  if (!same) return void state.turnDeals.push(deal);
  same.percent += deal.percent;
  same.price += deal.price;
}

function autoSell(state: GameState, p: Player, target: number): void {
  const sellable = Object.keys(p.holdings).sort((a, b) => percentPrice(a, 1) - percentPrice(b, 1));
  for (const company of sellable) {
    while (p.cash < target && (p.holdings[company] ?? 0) > 0) {
      removeHolding(p, company, 1);
      returnToStock(state, company, 1);
      p.cash += bankPrice(company, 1);
      recordDeal(state, { sellerId: p.id, buyerId: null, company, percent: 1, price: bankPrice(company, 1) });
    }
  }
}

// Pays `amount`. Short of cash, it goes negative: before ending the turn the player sells shares,
// makes a deal with the creditor, borrows, or declares bankruptcy.
function charge(state: GameState, p: Player, amount: number): void {
  p.cash -= amount;
}

// Shares go back to the bank, or with `share` are dealt 1 % at a time to the players left, in turn order
function bankrupt(state: GameState, p: Player, message = `${p.name} fait faillite`, share = false): void {
  const i = state.players.indexOf(p);
  const heirs = share ? [...state.players.slice(i + 1), ...state.players.slice(0, i)].filter((o) => !o.bankrupt) : [];
  let next = 0;
  for (const [company, pct] of Object.entries(p.holdings)) {
    if (!heirs.length) returnToStock(state, company, pct);
    else for (let k = 0; k < pct; k++) {
      const h = heirs[next++ % heirs.length]!;
      h.holdings[company] = (h.holdings[company] ?? 0) + 1;
    }
  }
  p.holdings = {};
  p.cash = 0;
  p.bankrupt = true;
  // anything waiting on the player is cancelled
  const a = state.auction;
  if (a && [a.chooserId, a.sellerId, a.highestBidderId].includes(p.id)) {
    state.auction = null;
    state.phase = "act";
  }
  if (state.offer && [state.offer.buyerId, state.offer.ownerId].includes(p.id)) state.offer = null;
  leaveAlliance(state, p.id);
  state.allianceInvites = state.allianceInvites.filter((i) => i.from !== p.id && i.to !== p.id);
  state.loans = state.loans.filter((l) => l.lenderId !== p.id && l.borrowerId !== p.id);
  state.loanOffers = state.loanOffers.filter((l) => l.lenderId !== p.id && l.borrowerId !== p.id);
  if (state.debt && [state.debt.debtorId, state.debt.creditorId].includes(p.id)) state.debt = null;
  state.eliminated.push(p.id);
  state.log.push(message);
  emit(state, { kind: "bankrupt", playerId: p.id, heirs: heirs.map((h) => h.id) });
  const alive = activePlayers(state);
  if (alive.length === 1) {
    state.phase = "gameOver";
    state.winner = alive[0]!.id;
    emit(state, { kind: "win", playerId: alive[0]!.id });
  }
}

export function allianceOf(state: GameState, playerId: PlayerId) {
  return state.alliances.find((a) => a.members.includes(playerId)) ?? null;
}

function leaveAlliance(state: GameState, playerId: PlayerId): void {
  for (const a of state.alliances) a.members = a.members.filter((m) => m !== playerId);
  // an alliance that includes every player left has no one to play against
  const alive = activePlayers(state).length;
  state.alliances = state.alliances.filter((a) => a.members.length >= 2 && a.members.length < alive);
}

// The biggest holder is a solo player or a whole alliance (members' % added up).
// Allies never pay each other; inside an alliance the royalty is split by each member's %.
export function royaltyQuote(state: GameState, company: CompanyId): { winners: Player[][]; max: number; share: number } {
  const groups = new Map<string, Player[]>();
  for (const p of activePlayers(state)) {
    if (!(p.holdings[company] ?? 0)) continue;
    const key = allianceOf(state, p.id)?.id ?? p.id;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const total = (members: Player[]) => members.reduce((a, p) => a + (p.holdings[company] ?? 0), 0);
  const max = Math.max(0, ...[...groups.values()].map(total));
  if (max === 0) return { winners: [], max: 0, share: 0 };
  const winners = [...groups.values()].filter((g) => total(g) === max);
  const amount = royaltyFor(company, max, trendOf(state, company));
  return { winners, max, share: Math.floor(amount / winners.length) };
}

function payRoyalty(state: GameState, payer: Player, cellId: string): void {
  const company = state.royalties[cellId]!;
  const { winners, max, share } = royaltyQuote(state, company);
  if (max === 0) return;
  const name = companyById.get(company)!.name;
  const payerGroup = allianceOf(state, payer.id)?.id ?? payer.id;
  // a payer who holds as much as the biggest holder (alone or with allies) owes nothing
  const payerMembers = activePlayers(state).filter((p) => (allianceOf(state, p.id)?.id ?? p.id) === payerGroup);
  if (payerMembers.reduce((a, p) => a + (p.holdings[company] ?? 0), 0) === max) return;
  if (winners.some((members) => (allianceOf(state, members[0]!.id)?.id ?? members[0]!.id) !== payerGroup) && spendAtout(payer, "exoneration")) {
    state.log.push(`${payer.name} utilise Exonération : pas de redevance ${name}`);
    emit(state, { kind: "atout", playerId: payer.id, text: `Exonération : la redevance ${name} est offerte.`, amount: 0, before: payer.cash, after: payer.cash });
    return;
  }
  for (const members of winners) {
    if ((allianceOf(state, members[0]!.id)?.id ?? members[0]!.id) === payerGroup) continue;
    // a lender landing on the borrower's city lowers what is still owed instead of paying
    let owed = share;
    for (const m of members) {
      let part = Math.floor((share * (m.holdings[company] ?? 0)) / max);
      const loan = state.loans.find((l) => l.lenderId === payer.id && l.borrowerId === m.id);
      if (loan) {
        const off = Math.min(part, loanLeft(loan));
        loan.repaid += off;
        part -= off;
        owed -= off;
        if (off) state.log.push(`${payer.name} déduit ${off} k$ du prêt de ${m.name} au lieu de payer`);
      }
      // the bank covers a bankrupt player's debt, so holders are always paid in full
      earn(state, m, part);
      const ms = statsOf(state, m.id);
      ms.royaltiesReceived += part;
      ms.biggestReceived = Math.max(ms.biggestReceived, part);
      if (part > 0 && spendAtout(m, "dividende")) money(state, m, "atout", `Dividende exceptionnel : la banque double ta redevance ${name}.`, part);
    }
    state.loans = state.loans.filter((l) => loanLeft(l) > 0);
    charge(state, payer, owed);
    if (payer.cash < 0) {
      const creditor = [...members].sort((a, b) => (b.holdings[company] ?? 0) - (a.holdings[company] ?? 0))[0]!;
      state.debt = { debtorId: payer.id, creditorId: creditor.id, amount: share, offer: null };
    }
    const to = members.length === 1 ? members[0]!.name : `l'alliance ${members.map((m) => m.name).join(" + ")}`;
    state.log.push(`${payer.name} paie ${share} k$ à ${to} (${name})`);
    emit(state, { kind: "royalty", playerId: payer.id, company, amount: share, to: members.map((m) => m.id) });
  }
}

function landOn(state: GameState, p: Player, pips: number): void {
  const cell = board[p.position]!;
  state.buyScope = null;
  state.phase = "act";
  switch (cell.type) {
    case "city":
      payRoyalty(state, p, cell.id);
      state.buyScope = { kind: "city", cellId: cell.id };
      break;
    case "choix-regional":
      state.buyScope = { kind: "region", region: cell.region };
      break;
    case "mondial":
      state.buyScope = { kind: "world" };
      break;
    case "levee": {
      const before = p.cash;
      earn(state, p, pips * config.leveeFundsPerPip);
      emit(state, { kind: "levee", playerId: p.id, text: `Vos investisseurs suivent : ${pips} aux dés × ${config.leveeFundsPerPip} k$`, amount: pips * config.leveeFundsPerPip, dice: state.lastRoll!, before, after: p.cash });
      break;
    }
    case "atout": {
      const [r, next] = nextRandom(state.seed);
      state.seed = next;
      const card = ATOUTS[Math.floor(r * ATOUTS.length)]!;
      emit(state, { kind: "atout", playerId: p.id, text: `Atout pris : ${card.name}. ${card.text}`, amount: 0, before: p.cash, after: p.cash });
      p.atouts.push(card.id);
      break;
    }
    case "actu": {
      const id = state.actuDeck.shift()!;
      state.actuDeck.push(id);
      const card = actuCards.find((c) => c.id === id)!;
      state.log.push(`${p.name} : ${card.text}`);
      if (card.jackpot) {
        const pot = state.pot;
        state.pot = 0;
        money(state, p, "jackpot", pot > 0 ? card.text : "Délit d'initié réussi... mais la cagnotte de la Bourse est vide.", pot);
      } else money(state, p, "actu", card.text, card.amount);
      break;
    }
    case "encheres": {
      if (!activePlayers(state).some((o) => o.id !== p.id && Object.keys(o.holdings).length > 0)) {
        state.log.push("Enchères : aucun adversaire n'a d'actions à mettre en vente");
        break;
      }
      state.phase = "auction";
      state.auction = {
        chooserId: p.id,
        sellerId: null,
        percentToSell: config.auctionMaxPercent,
        company: null,
        percent: 0,
        startPrice: 0,
        highestBid: 0,
        highestBidderId: null,
        bids: [],
      };
      break;
    }
    case "ipo":
      state.log.push(`${p.name} réussit son introduction en Bourse : +${config.ipoBonus} k$`);
      money(state, p, "ipo", "Votre entreprise entre en Bourse !", config.ipoBonus);
      break;
    case "krach": {
      const loss = Math.max(0, Math.floor((p.cash * config.krachPercent) / 100));
      state.log.push(`Krach boursier : ${p.name} perd ${loss} k$`);
      money(state, p, "krach", `Les marchés plongent : vous perdez ${config.krachPercent} % de votre trésorerie.`, -loss);
      break;
    }
    case "depart":
      break;
  }
}

function availableStock(state: GameState, p: Player): Record<CompanyId, { cellId: string; percent: number }[]> {
  const scope = state.buyScope;
  const out: Record<CompanyId, { cellId: string; percent: number }[]> = {};
  if (!scope) return out;
  for (const cell of board) {
    if (cell.type !== "city") continue;
    if (scope.kind === "city" && cell.id !== scope.cellId) continue;
    if (scope.kind === "region" && cell.region !== scope.region) continue;
    for (const [company, pct] of Object.entries(state.stocks[cell.id]!)) {
      if (pct <= 0) continue;
      (out[company] ??= []).push({ cellId: cell.id, percent: pct });
    }
  }
  return out;
}

export function buyableStock(state: GameState): Record<CompanyId, number> {
  const stock = availableStock(state, currentPlayer(state));
  return Object.fromEntries(Object.entries(stock).map(([c, list]) => [c, list.reduce((a, x) => a + x.percent, 0)]));
}

const TRENDS = [-30, -25, -20, -15, -10, 10, 15, 20, 25, 30];

// Each market gets a new trend, each time the leader passes Départ
function moveMarket(market: Record<string, number>, seed: number): number {
  let s = seed;
  for (const m of markets) {
    const [r, next] = nextRandom(s);
    s = next;
    market[m.id] = TRENDS[Math.floor(r * TRENDS.length)]!;
  }
  return s;
}

export function trendOf(state: GameState, company: CompanyId): number {
  const m = markets.find((x) => x.companies.includes(company));
  return m ? (state.market[m.id] ?? 0) : 0;
}

function nextTurn(state: GameState): void {
  const n = state.players.length;
  let i = state.current;
  do i = (i + 1) % n;
  while (state.players[i]!.bankrupt);
  if (i <= state.current) snapshot(state);
  state.current = i;
  state.phase = "roll";
  state.buyScope = null;
  state.boughtThisTurn = 0;
  state.offer = null;
  state.turnBuys = {};
  state.turnDeals = [];
  state.debt = null;
}

export function netWorth(p: Player): number {
  return p.cash + Object.entries(p.holdings).reduce((a, [c, pct]) => a + percentPrice(c, pct), 0);
}

export function applyAction(prev: GameState, action: Action): Result {
  if (prev.phase === "gameOver") return { ok: false, error: "Partie terminée" };
  const state = structuredClone(prev);
  const cur = currentPlayer(state);
  const isCurrent = "playerId" in action && action.playerId === cur.id;

  switch (action.type) {
    case "ROLL": {
      if (!isCurrent || state.phase !== "roll") return { ok: false, error: "Ce n'est pas le moment de lancer les dés" };
      if (action.dice && !action.dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) return { ok: false, error: "Dés invalides" };
      // forced dice: only the admin may send them, checked by the server
      const [d1, s1] = action.dice ? [action.dice[0], state.seed] : rollDie(state.seed);
      const [d2, s2] = action.dice ? [action.dice[1], s1] : rollDie(s1);
      state.seed = s2;
      state.lastRoll = [d1, d2];
      const to = cur.position + d1 + d2;
      emit(state, { kind: "roll", playerId: cur.id, dice: [d1, d2], from: cur.position, to: to % board.length });
      cur.position = to % board.length;
      if (d1 === d2) money(state, cur, "double", `Double ${d1} ! La Bourse vous récompense.`, config.doubleBonus);
      if (to >= board.length) {
        cur.laps += 1;
        money(state, cur, "lap", "Vous repassez par le Départ.", config.lapBonus);
        if (state.players.every((p) => p === cur || p.laps < cur.laps)) {
          state.seed = moveMarket(state.market, state.seed);
          emit(state, { kind: "market", playerId: cur.id, market: { ...state.market } });
        }
      }
      landOn(state, cur, d1 + d2);
      if (cur.bankrupt && (state.phase as string) !== "gameOver") nextTurn(state);
      return { ok: true, state };
    }

    case "BUY": {
      if (!isCurrent || state.phase !== "act" || state.offer) return { ok: false, error: "Achat impossible maintenant" };
      const wanted = Object.entries(action.purchases).filter(([, pct]) => pct !== 0);
      const total = wanted.reduce((a, [, pct]) => a + pct, 0);
      if (wanted.some(([, pct]) => !Number.isInteger(pct) || pct < 0)) return { ok: false, error: "Pourcentage invalide" };
      if (state.boughtThisTurn + total > config.maxPurchasePercent) {
        // Rachat express kicks in only when the buy goes past the limit
        if (state.boughtThisTurn - RACHAT_BONUS + total > config.maxPurchasePercent || !spendAtout(cur, "rachat")) {
          return { ok: false, error: `Maximum ${config.maxPurchasePercent} % par achat` };
        }
        state.boughtThisTurn -= RACHAT_BONUS;
        state.log.push(`${cur.name} utilise Rachat express : +${RACHAT_BONUS} % d'achat ce tour`);
      }
      const stock = availableStock(state, cur);
      let cost = 0;
      for (const [company, pct] of wanted) {
        const have = (stock[company] ?? []).reduce((a, x) => a + x.percent, 0);
        if (pct > have) return { ok: false, error: `Stock insuffisant pour ${company}` };
        cost += buyCost(company, cur.holdings[company] ?? 0, pct);
      }
      if (cost > cur.cash) return { ok: false, error: "Pas assez d'argent" };
      for (const [company, pct] of wanted) {
        let left = pct;
        for (const src of stock[company]!) {
          const take = Math.min(left, src.percent);
          state.stocks[src.cellId]![company]! -= take;
          left -= take;
          if (left === 0) break;
        }
        cur.holdings[company] = (cur.holdings[company] ?? 0) + pct;
        state.turnBuys[company] = (state.turnBuys[company] ?? 0) + pct;
      }
      cur.cash -= cost;
      state.boughtThisTurn += total;
      statsOf(state, cur.id).spentOnStocks += cost;
      statsOf(state, cur.id).percentBought += total;
      return { ok: true, state };
    }

    case "SELL_TO_BANK": {
      const p = player(state, action.playerId);
      if (!p || p.bankrupt || state.phase === "auction") return { ok: false, error: "Vente impossible maintenant" };
      if (!Number.isInteger(action.percent) || action.percent <= 0 || (p.holdings[action.company] ?? 0) < action.percent) {
        return { ok: false, error: "Pourcentage invalide" };
      }
      removeHolding(p, action.company, action.percent);
      returnToStock(state, action.company, action.percent);
      p.cash += bankPrice(action.company, action.percent);
      recordDeal(state, { sellerId: p.id, buyerId: null, company: action.company, percent: action.percent, price: bankPrice(action.company, action.percent) });
      return { ok: true, state };
    }

    case "OFFER": {
      if (!isCurrent || state.phase !== "act" || state.offer) return { ok: false, error: "Offre impossible maintenant" };
      const owner = player(state, action.ownerId);
      if (!owner || owner.bankrupt || owner.id === cur.id) return { ok: false, error: "Joueur invalide" };
      if (!Number.isInteger(action.percent) || action.percent <= 0 || (owner.holdings[action.company] ?? 0) < action.percent) {
        return { ok: false, error: "Le joueur ne détient pas ce pourcentage" };
      }
      if (!Number.isInteger(action.price) || action.price < 0 || action.price > cur.cash) return { ok: false, error: "Prix invalide" };
      state.offer = { buyerId: cur.id, ownerId: owner.id, company: action.company, percent: action.percent, price: action.price, awaiting: owner.id };
      return { ok: true, state };
    }

    case "RESPOND_OFFER": {
      const offer = state.offer;
      if (!offer || offer.awaiting !== action.playerId) return { ok: false, error: "Aucune offre en attente pour ce joueur" };
      if (action.counterPrice !== undefined) {
        if (!Number.isInteger(action.counterPrice) || action.counterPrice < 0) return { ok: false, error: "Prix invalide" };
        offer.price = action.counterPrice;
        offer.awaiting = offer.awaiting === offer.ownerId ? offer.buyerId : offer.ownerId;
        return { ok: true, state };
      }
      if (action.accept) {
        const buyer = player(state, offer.buyerId)!;
        const owner = player(state, offer.ownerId)!;
        if (buyer.cash < offer.price) return { ok: false, error: "L'acheteur n'a pas assez d'argent" };
        if ((owner.holdings[offer.company] ?? 0) < offer.percent) return { ok: false, error: "Le vendeur ne détient plus ce pourcentage" };
        buyer.cash -= offer.price;
        owner.cash += offer.price;
        removeHolding(owner, offer.company, offer.percent);
        buyer.holdings[offer.company] = (buyer.holdings[offer.company] ?? 0) + offer.percent;
        recordDeal(state, { sellerId: owner.id, buyerId: buyer.id, company: offer.company, percent: offer.percent, price: offer.price });
      }
      state.offer = null;
      return { ok: true, state };
    }

    case "OFFER_TIMEOUT": {
      if (!state.offer) return { ok: false, error: "Aucune offre" };
      state.offer = null;
      return { ok: true, state };
    }

    case "USE_ATOUT": {
      const a = state.auction;
      const seller = a?.sellerId ? player(state, a.sellerId) : undefined;
      if (state.phase !== "auction" || !a || !seller || seller.id !== action.playerId) return { ok: false, error: "Atout inutilisable maintenant" };
      if (!spendAtout(seller, "bouclier")) return { ok: false, error: "Aucun Bouclier anti-OPA" };
      emit(state, { kind: "auction", playerId: a.chooserId, sellerId: seller.id, company: a.company!, percent: a.percent, price: 0, winnerId: null, cancelled: true });
      state.auction = null;
      state.phase = "act";
      return { ok: true, state };
    }

    case "AUCTION_CHOOSE": {
      const a = state.auction;
      if (state.phase !== "auction" || !a || a.company || a.chooserId !== action.playerId) return { ok: false, error: "Choix impossible" };
      const owner = player(state, action.ownerId);
      if (!owner || owner.bankrupt || owner.id === a.chooserId) return { ok: false, error: "Joueur invalide" };
      const held = owner.holdings[action.company] ?? 0;
      if (held <= 0) return { ok: false, error: "Ce joueur ne détient pas cette entreprise" };
      a.sellerId = owner.id;
      a.company = action.company;
      const most = Math.min(held, a.percentToSell);
      const pct = action.percent ?? most;
      if (!Number.isInteger(pct) || pct < 1 || pct > most) return { ok: false, error: `Entre 1 et ${most} %` };
      a.percent = pct;
      a.startPrice = bankPrice(action.company, a.percent);
      return { ok: true, state };
    }

    case "BID": {
      const a = state.auction;
      const bidder = player(state, action.playerId);
      if (state.phase !== "auction" || !a || !a.company) return { ok: false, error: "Aucune enchère en cours" };
      if (!bidder || bidder.bankrupt || bidder.id === a.sellerId) return { ok: false, error: "Enchère interdite" };
      const min = a.highestBidderId ? a.highestBid + config.minBidIncrement : a.startPrice;
      if (!Number.isInteger(action.amount) || action.amount < min) return { ok: false, error: `Enchère minimum : ${min}` };
      if (action.amount > bidder.cash) return { ok: false, error: "Pas assez d'argent" };
      a.highestBid = action.amount;
      a.highestBidderId = bidder.id;
      a.bids.push({ playerId: bidder.id, amount: action.amount });
      if (soleBidder(state) === bidder.id) closeAuction(state);
      return { ok: true, state };
    }

    case "AUCTION_CLOSE": {
      const a = state.auction;
      if (state.phase !== "auction" || !a || !a.company || !a.sellerId) return { ok: false, error: "Aucune enchère à clore" };
      closeAuction(state);
      return { ok: true, state };
    }

    case "AUCTION_PASS": {
      if (state.phase !== "auction" || !state.auction?.company || soleBidder(state) !== action.playerId) return { ok: false, error: "Impossible de passer" };
      closeAuction(state);
      return { ok: true, state };
    }

    case "SETTLE_DEBT": {
      const p = player(state, action.playerId);
      if (!p || p.cash >= 0) return { ok: false, error: "Aucune dette" };
      autoSell(state, p, 0);
      if (p.cash < 0) {
        bankrupt(state, p);
        if (state.phase !== "gameOver" && cur.id === p.id) nextTurn(state);
      }
      return { ok: true, state };
    }

    // Shares instead of cash: if the creditor accepts, the debt of that royalty is wiped
    case "DEBT_DEAL_OFFER": {
      const d = state.debt;
      if (!d || d.debtorId !== action.playerId || cur.cash >= 0 || d.offer) return { ok: false, error: "Aucun accord possible maintenant" };
      const shares = Object.entries(action.shares).filter(([, pct]) => pct !== 0);
      if (!shares.length || shares.some(([c, pct]) => !Number.isInteger(pct) || pct < 0 || (cur.holdings[c] ?? 0) < pct)) {
        return { ok: false, error: "Pourcentage invalide" };
      }
      d.offer = Object.fromEntries(shares);
      state.log.push(`${cur.name} propose des actions à ${player(state, d.creditorId)!.name} pour effacer sa dette`);
      return { ok: true, state };
    }

    case "DEBT_DEAL_ANSWER": {
      const d = state.debt;
      if (!d?.offer || d.creditorId !== action.playerId) return { ok: false, error: "Aucun accord en attente" };
      const debtor = player(state, d.debtorId)!;
      const creditor = player(state, d.creditorId)!;
      const offer = d.offer;
      d.offer = null;
      if (!action.accept) {
        state.log.push(`${creditor.name} refuse l'accord de ${debtor.name}`);
        return { ok: true, state };
      }
      if (Object.entries(offer).some(([c, pct]) => (debtor.holdings[c] ?? 0) < pct)) return { ok: false, error: "Le joueur ne détient plus ces actions" };
      for (const [c, pct] of Object.entries(offer)) {
        removeHolding(debtor, c, pct);
        creditor.holdings[c] = (creditor.holdings[c] ?? 0) + pct;
        recordDeal(state, { sellerId: debtor.id, buyerId: creditor.id, company: c, percent: pct, price: 0 });
      }
      const wiped = Math.max(0, Math.min(d.amount, -debtor.cash, creditor.cash));
      creditor.cash -= wiped;
      debtor.cash += wiped;
      state.debt = null;
      state.log.push(`${creditor.name} accepte des actions de ${debtor.name} : ${wiped} k$ de dette effacés`);
      return { ok: true, state };
    }

    // At any time; the shares left are dealt to the other players instead of the bank
    case "DECLARE_BANKRUPTCY": {
      const p = player(state, action.playerId);
      if (!p || p.bankrupt) return { ok: false, error: "Joueur introuvable" };
      // the player picks who gets what; anything left unassigned is dealt out in turn order
      const split = Object.entries(action.split ?? {});
      const given: Record<CompanyId, number> = {};
      for (const [id, shares] of split) {
        const heir = player(state, id);
        if (!heir || heir.bankrupt || heir === p) return { ok: false, error: "Joueur introuvable" };
        for (const [c, pct] of Object.entries(shares)) {
          if (!Number.isInteger(pct) || pct < 0) return { ok: false, error: "Pourcentage invalide" };
          given[c] = (given[c] ?? 0) + pct;
        }
      }
      if (Object.entries(given).some(([c, pct]) => pct > (p.holdings[c] ?? 0))) return { ok: false, error: "Tu ne détiens pas autant d'actions" };
      for (const [id, shares] of split) {
        const heir = player(state, id)!;
        for (const [c, pct] of Object.entries(shares)) {
          if (!pct) continue;
          removeHolding(p, c, pct);
          heir.holdings[c] = (heir.holdings[c] ?? 0) + pct;
        }
      }
      bankrupt(state, p, `${p.name} déclare faillite et répartit ses actions`, true);
      if (state.phase !== "gameOver" && cur.id === p.id) nextTurn(state);
      return { ok: true, state };
    }

    case "LOAN_OFFER": {
      const lender = player(state, action.playerId);
      const borrower = player(state, action.borrowerId);
      if (!lender || !borrower || lender.bankrupt || borrower.bankrupt || lender === borrower) return { ok: false, error: "Joueur introuvable" };
      if (!Number.isInteger(action.amount) || action.amount <= 0 || action.amount > lender.cash) return { ok: false, error: "Montant invalide" };
      if (state.loanOffers.some((o) => o.lenderId === lender.id && o.borrowerId === borrower.id)) return { ok: false, error: "Proposition déjà envoyée" };
      state.loanOffers.push({ lenderId: lender.id, borrowerId: borrower.id, amount: action.amount });
      state.log.push(`${lender.name} propose de prêter ${action.amount} k$ à ${borrower.name}`);
      return { ok: true, state };
    }

    case "LOAN_ANSWER": {
      const o = state.loanOffers.find((x) => x.lenderId === action.lenderId && x.borrowerId === action.playerId);
      if (!o) return { ok: false, error: "Aucun prêt proposé" };
      state.loanOffers = state.loanOffers.filter((x) => x !== o);
      const lender = player(state, o.lenderId)!;
      const borrower = player(state, o.borrowerId)!;
      if (!action.accept) {
        state.log.push(`${borrower.name} refuse le prêt de ${lender.name}`);
        return { ok: true, state };
      }
      if (lender.cash < o.amount) return { ok: false, error: "Le prêteur n'a plus assez d'argent" };
      lender.cash -= o.amount;
      borrower.cash += o.amount;
      state.loans.push({ lenderId: lender.id, borrowerId: borrower.id, amount: o.amount, repaid: 0 });
      state.log.push(`${lender.name} prête ${o.amount} k$ à ${borrower.name}`);
      return { ok: true, state };
    }

    case "END_TURN": {
      if (!isCurrent || state.phase !== "act" || state.offer) return { ok: false, error: "Impossible de finir le tour maintenant" };
      if (cur.cash < 0) return { ok: false, error: "Vendez des actions pour rembourser votre dette avant de finir le tour" };
      const items = Object.entries(state.turnBuys).map(([company, percent]) => ({ company, percent, total: cur.holdings[company] ?? 0 }));
      if (items.length || state.turnDeals.length) emit(state, { kind: "buys", playerId: cur.id, items, deals: state.turnDeals });
      nextTurn(state);
      return { ok: true, state };
    }

    case "ALLIANCE_INVITE": {
      const from = state.players.find((p) => p.id === action.playerId);
      const to = state.players.find((p) => p.id === action.targetId);
      if (!from || !to || from.bankrupt || to.bankrupt || from === to) return { ok: false, error: "Joueur introuvable" };
      if (allianceOf(state, to.id)) return { ok: false, error: `${to.name} est déjà dans une alliance` };
      const size = allianceOf(state, from.id)?.members.length ?? 1;
      if (size + 1 >= activePlayers(state).length) return { ok: false, error: "Il doit rester au moins un adversaire hors de l'alliance" };
      if (state.allianceInvites.some((i) => i.from === from.id && i.to === to.id)) return { ok: false, error: "Invitation déjà envoyée" };
      if (leadersTogether(state, [...(allianceOf(state, from.id)?.members ?? [from.id]), to.id])) return { ok: false, error: "Les deux joueurs en tête ne peuvent pas s'allier" };
      state.allianceInvites.push({ from: from.id, to: to.id });
      state.log.push(`${from.name} propose une alliance à ${to.name}`);
      return { ok: true, state };
    }

    case "ALLIANCE_ANSWER": {
      const invite = state.allianceInvites.find((i) => i.from === action.fromId && i.to === action.playerId);
      if (!invite) return { ok: false, error: "Aucune invitation" };
      state.allianceInvites = state.allianceInvites.filter((i) => i !== invite);
      const from = state.players.find((p) => p.id === invite.from)!;
      const to = state.players.find((p) => p.id === invite.to)!;
      if (!action.accept) {
        state.log.push(`${to.name} refuse l'alliance de ${from.name}`);
        return { ok: true, state };
      }
      const existing = allianceOf(state, from.id);
      if (leadersTogether(state, [...(existing?.members ?? [from.id]), to.id])) return { ok: false, error: "Les deux joueurs en tête ne peuvent pas s'allier" };
      if (allianceOf(state, to.id) || (existing?.members.length ?? 1) + 1 >= activePlayers(state).length) {
        return { ok: false, error: "Cette alliance n'est plus possible" };
      }
      if (existing) existing.members.push(to.id);
      else state.alliances.push({ id: `a${state.nextAllianceId++}`, members: [from.id, to.id] });
      state.allianceInvites = state.allianceInvites.filter((i) => i.to !== to.id);
      state.log.push(`${to.name} rejoint l'alliance de ${from.name}`);
      return { ok: true, state };
    }

    case "ALLIANCE_LEAVE": {
      const p = state.players.find((x) => x.id === action.playerId);
      if (!p || !allianceOf(state, p.id)) return { ok: false, error: "Pas dans une alliance" };
      leaveAlliance(state, p.id);
      state.log.push(`${p.name} quitte son alliance`);
      return { ok: true, state };
    }

    // The host removes a player: their shares go back to the bank, anything waiting on them is cancelled
    case "KICK": {
      const p = player(state, action.targetId);
      if (!p || p.bankrupt) return { ok: false, error: "Joueur introuvable" };
      bankrupt(state, p, `${p.name} est exclu de la partie`);
      if (state.phase !== "gameOver" && cur.id === p.id) nextTurn(state);
      return { ok: true, state };
    }

    case "END_GAME": {
      const ranked = [...activePlayers(state)].sort((x, y) => netWorth(y) - netWorth(x));
      state.phase = "gameOver";
      state.winner = ranked[0]!.id;
      emit(state, { kind: "win", playerId: ranked[0]!.id });
      return { ok: true, state };
    }
  }
}

// The two richest players may never share an alliance
function leadersTogether(state: GameState, members: PlayerId[]): boolean {
  const [first, second, third] = [...activePlayers(state)].sort((a, b) => netWorth(b) - netWorth(a));
  // a tie for second place leaves no clear pair of leaders
  if (!first || !second || (third && netWorth(third) >= netWorth(second))) return false;
  return members.includes(first.id) && members.includes(second.id);
}

// Final order: winner, then remaining players by net worth, then eliminated players (last eliminated first)
export function ranking(state: GameState): PlayerId[] {
  const alive = activePlayers(state)
    .filter((p) => p.id !== state.winner)
    .sort((a, b) => netWorth(b) - netWorth(a))
    .map((p) => p.id);
  return [...(state.winner ? [state.winner] : []), ...alive, ...[...state.eliminated].reverse()];
}
