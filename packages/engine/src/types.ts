export type CompanyId = string;
export type RegionId = string;

export interface Company {
  id: CompanyId;
  name: string;
  sector: string;
  color: string;
  pricePerPercent: number;
  royaltyPerPercent: number;
}

export interface Region {
  id: RegionId;
  name: string;
  color: string;
}

export type Cell =
  | { id: string; type: "depart"; name: string }
  | { id: string; type: "city"; name: string; region: RegionId; stock: Record<CompanyId, number> }
  | { id: string; type: "choix-regional"; name: string; region: RegionId }
  | { id: string; type: "mondial" | "encheres" | "atout" | "actu" | "levee" | "ipo" | "krach"; name: string };

export interface ActuCard {
  id: string;
  text: string;
  amount: number;
  // wins the pot of fines held by the stock exchange tower
  jackpot?: boolean;
}

// A group of companies whose royalties rise or fall together, turn after turn
export interface Market {
  id: string;
  name: string;
  companies: string[];
}

export interface GameConfig {
  startingCash: number;
  doubleBonus: number;
  dominanceFrom: number;
  dominanceGrowth: number;
  loanShare: number;
  loanCap: number;
  maxPurchasePercent: number;
  leveeFundsPerPip: number;
  auctionMaxPercent: number;
  minBidIncrement: number;
  auctionTimeoutSeconds: number;
  auctionBidExtraSeconds: number;
  offerTimeoutSeconds: number;
  monopolyMultiplier: number;
  bankBuybackRatio: number;
  royaltyTokensPerCompany: number;
  minPlayers: number;
  maxPlayers: number;
  ipoBonus: number;
  krachPercent: number;
  lapBonus: number;
}
