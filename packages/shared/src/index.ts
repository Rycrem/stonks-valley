import type { Action, GameMode, GameState } from "@stonks/engine";
import type { Look, Slot } from "./cosmetics";

export * from "./cosmetics";

export interface LobbyPlayer {
  id: string;
  name: string;
  connected: boolean;
  look: Look;
}

export interface ProfileView {
  name: string;
  points: number;
  owned: string[];
  look: Look;
  // account name once logged in with a password, null for a browser-only profile
  account: string | null;
  email: string | null;
  admin: boolean;
}

export interface AccountRow {
  name: string;
  email: string | null;
  points: number;
  owned: number;
  created: number;
}

export interface ChatMessage {
  id: number;
  at: number;
  // player id, or "system"
  from: string;
  // "public", "dm:<id>:<id>" (ids sorted) or "group:<id>"
  channel: string;
  text: string;
}

export interface ChatGroup {
  id: string;
  name: string;
  members: string[];
  // set for the group that follows an in-game alliance
  allianceId: string | null;
}

// Only what the viewer may read: public, their private conversations, their groups
export interface ChatView {
  messages: ChatMessage[];
  groups: ChatGroup[];
}

export const dmChannel = (a: string, b: string) => `dm:${[a, b].sort().join(":")}`;

export interface RoomView {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
  game: GameState | null;
  // epoch ms when the running auction or offer times out
  deadline: number | null;
  // points earned by each player at the end of the game
  rewards: Record<string, number> | null;
  // filled only for the admin: dice forced for each player's next roll
  nextDice: Record<string, [number, number]>;
  chat: ChatView;
}

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServer {
  "room:create": (name: string, profileToken: string, ack: Ack<Session>) => void;
  "room:join": (code: string, name: string, profileToken: string, ack: Ack<Session>) => void;
  "room:rejoin": (code: string, token: string, ack: Ack<Session>) => void;
  "room:start": (mode: GameMode, startingCash: number, ack: Ack<null>) => void;
  "room:leave": () => void;
  "room:kick": (playerId: string, ack: Ack<null>) => void;
  "game:action": (action: Action, ack: Ack<null>) => void;
  "admin:dice": (target: string, dice: [number, number] | null, ack: Ack<null>) => void;
  "chat:send": (channel: string, text: string, ack: Ack<null>) => void;
  "chat:group": (name: string, members: string[], ack: Ack<string>) => void;
  "chat:leave": (groupId: string, ack: Ack<null>) => void;
  "profile:get": (token: string, ack: Ack<ProfileView & { token: string }>) => void;
  "profile:buy": (token: string, itemId: string, ack: Ack<ProfileView>) => void;
  "profile:equip": (token: string, slot: Slot, itemId: string, ack: Ack<ProfileView>) => void;
  "account:login": (name: string, password: string, currentToken: string, ack: Ack<ProfileView & { token: string }>) => void;
  "account:email": (token: string, email: string, ack: Ack<ProfileView>) => void;
  "account:forgot": (name: string, ack: Ack<string>) => void;
  "account:reset": (resetToken: string, password: string, ack: Ack<ProfileView & { token: string }>) => void;
  "admin:list": (token: string, ack: Ack<AccountRow[]>) => void;
  "admin:password": (token: string, name: string, password: string, ack: Ack<null>) => void;
  "admin:points": (token: string, name: string, points: number, ack: Ack<null>) => void;
}

export interface ServerToClient {
  "room:state": (room: RoomView) => void;
  "room:kicked": () => void;
}

// Actions only the server may trigger (timers, end of game)
export const SYSTEM_ACTIONS = ["OFFER_TIMEOUT", "AUCTION_CLOSE", "END_GAME", "KICK"] as const;
