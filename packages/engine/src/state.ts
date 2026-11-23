import type { CompanyId } from "./types";

export type PlayerId = string;

export interface Player {
  id: PlayerId;
  name: string;
  cash: number;
  position: number;
  holdings: Record<CompanyId, number>;
  // Atout cards held, by id (see ATOUTS)
  atouts: string[];
  laps: number;
  bankrupt: boolean;
}

export type BuyScope =
  | { kind: "city"; cellId: string }
  | { kind: "region"; region: string }
  | { kind: "world" };

// The player who lands on Enchères picks an opponent and one of their companies; everyone else bids
export interface Auction {
  chooserId: PlayerId;
  sellerId: PlayerId | null;
  percentToSell: number;
  company: CompanyId | null;
  percent: number;
  startPrice: number;
  highestBid: number;
  highestBidderId: PlayerId | null;
  bids: { playerId: PlayerId; amount: number }[];
}

export interface Offer {
  buyerId: PlayerId;
  ownerId: PlayerId;
  company: CompanyId;
  percent: number;
  price: number;
  awaiting: PlayerId;
}

export interface Alliance {
  id: string;
  members: PlayerId[];
}

export interface AllianceInvite {
  from: PlayerId;
  to: PlayerId;
}

// A royalty the payer could not cover. The debtor may offer shares to the creditor instead of cash.
export interface Debt {
  debtorId: PlayerId;
  creditorId: PlayerId;
  amount: number;
  offer: Record<string, number> | null;
}

// The borrower gives loanShare % of every income to the lender until loanCap % of the amount is paid back
export interface Loan {
  lenderId: PlayerId;
  borrowerId: PlayerId;
  amount: number;
  repaid: number;
}

// A sale to the bank (no buyerId) or between players during a turn
export interface Deal {
  sellerId: PlayerId;
  buyerId: PlayerId | null;
  company: string;
  percent: number;
  price: number;
}

// Everything worth showing as an animated card, in order; clients play the ones they have not seen yet
export type GameEvent =
  | { id: number; kind: "roll"; playerId: PlayerId; dice: [number, number]; from: number; to: number }
  | { id: number; kind: "actu" | "ipo" | "krach" | "lap" | "atout" | "double" | "jackpot"; playerId: PlayerId; text: string; amount: number; before: number; after: number }
  | { id: number; kind: "levee"; playerId: PlayerId; text: string; amount: number; dice: [number, number]; before: number; after: number }
  | { id: number; kind: "royalty"; playerId: PlayerId; company: string; amount: number; to: PlayerId[] }
  | { id: number; kind: "buys"; playerId: PlayerId; items: { company: string; percent: number; total: number }[]; deals: Deal[] }
  | { id: number; kind: "auction"; playerId: PlayerId; sellerId: PlayerId; company: string; percent: number; price: number; winnerId: PlayerId | null; cancelled: boolean }
  | { id: number; kind: "order"; rolls: { playerId: PlayerId; dice: [number, number] }[] }
  | { id: number; kind: "market"; playerId: PlayerId; market: Record<string, number> }
  | { id: number; kind: "bankrupt"; playerId: PlayerId; heirs: PlayerId[] }
  | { id: number; kind: "win"; playerId: PlayerId };
export type NewGameEvent = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, "id"> : never) : never;

// Totals kept for the end of game stats (events only keep the last few)
export interface PlayerStats {
  rolls: number;
  doubles: number;
  distance: number;
  royaltiesPaid: number;
  royaltiesReceived: number;
  biggestPaid: number;
  biggestReceived: number;
  cardsGain: number;
  cardsLoss: number;
  spentOnStocks: number;
  percentBought: number;
  salesIncome: number;
  auctionsWon: number;
  auctionSpent: number;
  auctionIncome: number;
  atouts: number;
  peakWorth: number;
}

export interface GameStats {
  players: Record<PlayerId, PlayerStats>;
  // times each board cell was landed on
  landings: Record<number, number>;
  // royalties paid per company
  companyRoyalties: Record<string, number>;
  // net worth of each player at the end of each round
  history: Record<PlayerId, number>[];
}

export type Phase = "roll" | "act" | "auction" | "gameOver";
export type GameMode = "classique" | "chrono";

export interface GameState {
  seed: number;
  mode: GameMode;
  players: Player[];
  current: number;
  phase: Phase;
  stocks: Record<string, Record<CompanyId, number>>;
  royalties: Record<string, CompanyId>;
  actuDeck: string[];
  lastRoll: [number, number] | null;
  buyScope: BuyScope | null;
  boughtThisTurn: number;
  auction: Auction | null;
  offer: Offer | null;
  // allied players add up their % to be the biggest holder and share the royalty
  alliances: Alliance[];
  allianceInvites: AllianceInvite[];
  nextAllianceId: number;
  events: GameEvent[];
  nextEventId: number;
  // % bought per company during the current turn, shown to everyone when the turn ends
  turnBuys: Record<CompanyId, number>;
  turnDeals: Deal[];
  debt: Debt | null;
  loans: Loan[];
  loanOffers: { lenderId: PlayerId; borrowerId: PlayerId; amount: number }[];
  eliminated: PlayerId[];
  winner: PlayerId | null;
  log: string[];
  // royalty trend of each market this turn, in percent (-30 to +30)
  market: Record<string, number>;
  // fines and taxes collected by the stock exchange tower, won with the jackpot card
  pot: number;
  stats: GameStats;
}
