import { randomBytes, randomUUID } from "node:crypto";
import { applyAction, config, createGame, ranking, rollTurnOrder, isStartingCash, type Action, type GameMode, type GameState } from "@stonks/engine";
import { dmChannel, pointsForRank, SYSTEM_ACTIONS, type ChatGroup, type ChatMessage, type LobbyPlayer, type RoomView, type Session } from "@stonks/shared";
import type { Profiles } from "./profiles";

interface Member extends LobbyPlayer {
  token: string;
  profileToken: string;
  kicked?: boolean;
}

export interface Room {
  code: string;
  hostId: string;
  members: Member[];
  game: GameState | null;
  timer: ReturnType<typeof setTimeout> | null;
  timerKey: string | null;
  deadline: number | null;
  rewards: Record<string, number> | null;
  messages: ChatMessage[];
  groups: ChatGroup[];
  nextChatId: number;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const AFK_SECONDS = 20;
const MAX_MESSAGES = 300;
const MAX_TEXT = 300;

// What the server plays for a disconnected player whose turn it is
function afkAction(room: Room): Action | null {
  const g = room.game!;
  const actorId = g.phase === "auction" && g.auction && !g.auction.company ? g.auction.chooserId : g.players[g.current]!.id;
  if (room.members.find((m) => m.id === actorId)?.connected !== false) return null;
  const actor = g.players.find((p) => p.id === actorId)!;
  if (g.phase === "roll") return { type: "ROLL", playerId: actorId };
  if (g.phase === "act") return actor.cash < 0 ? { type: "SETTLE_DEBT", playerId: actorId } : { type: "END_TURN", playerId: actorId };
  if (g.phase === "auction" && g.auction && !g.auction.company) {
    const owner = g.players.find((p) => p.id !== actorId && !p.bankrupt && Object.keys(p.holdings).length > 0)!;
    const smallest = Object.entries(owner.holdings).sort((a, b) => a[1] - b[1])[0]![0];
    return { type: "AUCTION_CHOOSE", playerId: actorId, ownerId: owner.id, company: smallest };
  }
  return null;
}

export class Rooms {
  private rooms = new Map<string, Room>();

  constructor(
    private profiles: Profiles,
    private onChange: (room: Room) => void,
  ) {}

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  private newCode(): string {
    let code: string;
    do code = Array.from(randomBytes(4), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    while (this.rooms.has(code));
    return code;
  }

  private addMember(room: Room, name: string, profileToken: string): Session {
    const profile = this.profiles.get(profileToken);
    const clean = name.trim().slice(0, 20);
    this.profiles.setName(profile.token, clean);
    const id = `p${Math.max(0, ...room.members.map((m) => Number(m.id.slice(1)))) + 1}`;
    const member: Member = { id, name: clean, connected: true, token: randomUUID(), profileToken: profile.token, look: profile.look };
    room.members.push(member);
    return { code: room.code, playerId: member.id, token: member.token };
  }

  create(name: string, profileToken: string): Result<Session> {
    if (!name.trim()) return { ok: false, error: "Pseudo requis" };
    const room: Room = { code: this.newCode(), hostId: "p1", members: [], game: null, timer: null, timerKey: null, deadline: null, rewards: null, messages: [], groups: [], nextChatId: 1 };
    this.rooms.set(room.code, room);
    return { ok: true, data: this.addMember(room, name, profileToken) };
  }

  join(code: string, name: string, profileToken: string): Result<Session> {
    const room = this.get(code);
    if (!room) return { ok: false, error: "Partie introuvable" };
    if (room.game) return { ok: false, error: "La partie a déjà commencé" };
    if (!name.trim()) return { ok: false, error: "Pseudo requis" };
    if (room.members.length >= config.maxPlayers) return { ok: false, error: "Partie complète" };
    const session = this.addMember(room, name, profileToken);
    this.onChange(room);
    return { ok: true, data: session };
  }

  rejoin(code: string, token: string): Result<Session> {
    const room = this.get(code);
    const member = room?.members.find((m) => m.token === token);
    if (!room || !member || member.kicked) return { ok: false, error: "Session expirée" };
    member.connected = true;
    if (room.game) this.schedule(room);
    this.onChange(room);
    return { ok: true, data: { code: room.code, playerId: member.id, token } };
  }

  setConnected(code: string, playerId: string, connected: boolean): void {
    const room = this.get(code);
    const member = room?.members.find((m) => m.id === playerId);
    if (!room || !member) return;
    member.connected = connected;
    if (!room.game && !connected) {
      room.members = room.members.filter((m) => m.id !== playerId);
      if (room.members.length === 0) return this.remove(room);
      if (room.hostId === playerId) room.hostId = room.members[0]!.id;
    }
    if (room.game && room.members.every((m) => !m.connected)) return this.remove(room);
    if (room.game) this.schedule(room);
    this.onChange(room);
  }

  private remove(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    this.rooms.delete(room.code);
  }

  start(code: string, playerId: string, mode: GameMode, startingCash = config.startingCash): Result<null> {
    const room = this.get(code);
    if (!room) return { ok: false, error: "Partie introuvable" };
    if (room.hostId !== playerId) return { ok: false, error: "Seul l'hôte peut lancer la partie" };
    if (room.game) return { ok: false, error: "Déjà lancée" };
    if (room.members.length < config.minPlayers) return { ok: false, error: `Il faut au moins ${config.minPlayers} joueurs` };
    if (!isStartingCash(startingCash)) return { ok: false, error: "Argent de départ invalide" };
    room.game = rollTurnOrder(
      createGame(
        room.members.map((m) => ({ id: m.id, name: m.name })),
        randomBytes(4).readUInt32LE(),
        mode,
        startingCash,
      ),
    );
    this.onChange(room);
    return { ok: true, data: null };
  }

  // The host removes a player: from the lobby they are just dropped; in a game their shares go back to the bank
  // and they keep their seat in the list, unable to act, rejoin or earn points
  kick(code: string, hostId: string, targetId: string): Result<null> {
    const room = this.get(code);
    if (!room) return { ok: false, error: "Partie introuvable" };
    if (room.hostId !== hostId) return { ok: false, error: "Seul l'hôte peut exclure un joueur" };
    const target = room.members.find((m) => m.id === targetId);
    if (!target || target.kicked || targetId === hostId) return { ok: false, error: "Joueur introuvable" };
    if (!room.game) {
      room.members = room.members.filter((m) => m !== target);
      this.onChange(room);
      return { ok: true, data: null };
    }
    target.kicked = true;
    target.connected = false;
    if (room.game.phase !== "gameOver") return this.apply(room, { type: "KICK", targetId });
    this.onChange(room);
    return { ok: true, data: null };
  }

  act(code: string, playerId: string, action: Action): Result<null> {
    const room = this.get(code);
    if (!room?.game) return { ok: false, error: "Aucune partie en cours" };
    if (room.members.find((m) => m.id === playerId)?.kicked) return { ok: false, error: "Tu as été exclu de la partie" };
    if ((SYSTEM_ACTIONS as readonly string[]).includes(action.type)) {
      if (action.type !== "END_GAME" || room.hostId !== playerId || room.game.mode !== "chrono") {
        return { ok: false, error: "Action réservée" };
      }
    } else if ("playerId" in action && action.playerId !== playerId) {
      return { ok: false, error: "Vous ne pouvez agir que pour vous-même" };
    }
    return this.apply(room, action);
  }

  private apply(room: Room, action: Action): Result<null> {
    const r = applyAction(room.game!, action);
    if (!r.ok) return { ok: false, error: r.error };
    room.game = r.state;
    this.syncAllianceGroups(room);
    if (room.game.phase === "gameOver" && !room.rewards) this.reward(room);
    this.schedule(room);
    this.onChange(room);
    return { ok: true, data: null };
  }

  // Server-side timers: an auction closes N s after the lot is chosen, offers expire,
  // and a disconnected player's turn is played automatically
  private schedule(room: Room): void {
    if (!room.game) return;
    const g = room.game!;
    let key: string | null = null;
    let seconds = 0;
    let action: Action | null = null;
    if (g.phase === "auction" && g.auction?.company) {
      // each bid adds a few seconds to the time left
      const lot = `auction:${g.auction.sellerId}:${g.auction.company}:${g.events.at(-1)?.id}:`;
      key = lot + g.auction.bids.length;
      seconds = room.timerKey?.startsWith(lot) && room.deadline ? (room.deadline - Date.now()) / 1000 + config.auctionBidExtraSeconds : config.auctionTimeoutSeconds;
      action = { type: "AUCTION_CLOSE" };
    } else if (g.offer) {
      key = `offer:${g.offer.price}:${g.offer.awaiting}`;
      seconds = config.offerTimeoutSeconds;
      action = { type: "OFFER_TIMEOUT" };
    } else if (g.phase !== "gameOver") {
      action = afkAction(room);
      if (action) {
        key = `afk:${JSON.stringify(action)}:${g.log.length}:${g.lastRoll}`;
        seconds = AFK_SECONDS;
      }
    }
    if (key === room.timerKey) return;
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.timerKey = key;
    room.deadline = null;
    if (!action) return;
    room.deadline = Date.now() + seconds * 1000;
    room.timer = setTimeout(() => {
      room.timer = null;
      room.timerKey = null;
      room.deadline = null;
      if (this.rooms.has(room.code)) this.apply(room, action);
    }, seconds * 1000);
  }

  // Points by final rank, credited once per game to each player's profile
  private reward(room: Room): void {
    room.rewards = {};
    ranking(room.game!).forEach((playerId, rank) => {
      const member = room.members.find((m) => m.id === playerId);
      const points = pointsForRank(rank);
      room.rewards![playerId] = points;
      if (member && !member.kicked) this.profiles.award(member.profileToken, points);
    });
  }

  private post(room: Room, from: string, channel: string, text: string): void {
    room.messages.push({ id: room.nextChatId++, at: Date.now(), from, channel, text });
    if (room.messages.length > MAX_MESSAGES) room.messages.splice(0, room.messages.length - MAX_MESSAGES);
  }

  private canRead(room: Room, playerId: string, channel: string): boolean {
    if (channel === "public") return true;
    if (channel.startsWith("dm:")) return channel.split(":").slice(1).includes(playerId);
    return !!room.groups.find((g) => `group:${g.id}` === channel)?.members.includes(playerId);
  }

  sendChat(code: string, playerId: string, channel: string, text: string): Result<null> {
    const room = this.get(code);
    if (!room) return { ok: false, error: "Partie introuvable" };
    if (room.members.find((m) => m.id === playerId)?.kicked) return { ok: false, error: "Tu as été exclu de la partie" };
    const clean = text.trim().slice(0, MAX_TEXT);
    if (!clean) return { ok: false, error: "Message vide" };
    if (channel.startsWith("dm:")) {
      const ids = channel.split(":").slice(1);
      const other = ids.find((id) => id !== playerId);
      if (ids.length !== 2 || !other || channel !== dmChannel(playerId, other) || !room.members.some((m) => m.id === other)) {
        return { ok: false, error: "Destinataire inconnu" };
      }
    } else if (!this.canRead(room, playerId, channel)) return { ok: false, error: "Conversation inconnue" };
    this.post(room, playerId, channel, clean);
    this.onChange(room);
    return { ok: true, data: null };
  }

  createGroup(code: string, playerId: string, name: string, members: string[]): Result<string> {
    const room = this.get(code);
    if (!room) return { ok: false, error: "Partie introuvable" };
    const ids = [...new Set([playerId, ...members])].filter((id) => room.members.some((m) => m.id === id));
    if (ids.length < 2) return { ok: false, error: "Choisis au moins un autre joueur" };
    const group: ChatGroup = { id: `g${room.nextChatId++}`, name: name.trim().slice(0, 24) || "Groupe", members: ids, allianceId: null };
    room.groups.push(group);
    this.post(room, "system", `group:${group.id}`, `Groupe créé par ${room.members.find((m) => m.id === playerId)!.name}`);
    this.onChange(room);
    return { ok: true, data: group.id };
  }

  leaveGroup(code: string, playerId: string, groupId: string): Result<null> {
    const room = this.get(code);
    const group = room?.groups.find((g) => g.id === groupId && g.members.includes(playerId));
    if (!room || !group) return { ok: false, error: "Groupe introuvable" };
    if (group.allianceId) return { ok: false, error: "Quitte l'alliance pour quitter ce groupe" };
    group.members = group.members.filter((m) => m !== playerId);
    if (group.members.length < 2) this.dropGroup(room, group);
    else this.post(room, "system", `group:${group.id}`, `${room.members.find((m) => m.id === playerId)!.name} a quitté le groupe`);
    this.onChange(room);
    return { ok: true, data: null };
  }

  private dropGroup(room: Room, group: ChatGroup): void {
    room.groups = room.groups.filter((g) => g !== group);
    room.messages = room.messages.filter((m) => m.channel !== `group:${group.id}`);
  }

  // Each in-game alliance has its own group, removed with its messages when the alliance ends
  private syncAllianceGroups(room: Room): void {
    const alliances = room.game?.alliances ?? [];
    for (const group of room.groups.filter((g) => g.allianceId && !alliances.some((a) => a.id === g.allianceId))) this.dropGroup(room, group);
    for (const a of alliances) {
      const group = room.groups.find((g) => g.allianceId === a.id);
      const names = a.members.map((id) => room.members.find((m) => m.id === id)?.name ?? id);
      if (!group) {
        room.groups.push({ id: `al-${a.id}`, name: "Alliance", members: [...a.members], allianceId: a.id });
        this.post(room, "system", `group:al-${a.id}`, `Alliance formée : ${names.join(", ")}`);
      } else if (group.members.join() !== a.members.join()) {
        group.members = [...a.members];
        this.post(room, "system", `group:${group.id}`, `Alliance : ${names.join(", ")}`);
      }
    }
  }

  // A player changed their pawn in the lobby
  refreshLook(profileToken: string): void {
    for (const room of this.rooms.values()) {
      const member = room.members.find((m) => m.profileToken === profileToken);
      if (!member || room.game) continue;
      member.look = this.profiles.look(profileToken);
      this.onChange(room);
    }
  }

  view(room: Room, viewerId: string): RoomView {
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.members.map(({ id, name, connected, look }) => ({ id, name, connected, look })),
      game: room.game,
      deadline: room.deadline,
      rewards: room.rewards,
      chat: {
        messages: room.messages.filter((m) => this.canRead(room, viewerId, m.channel)),
        groups: room.groups.filter((g) => g.members.includes(viewerId)),
      },
    };
  }
}
