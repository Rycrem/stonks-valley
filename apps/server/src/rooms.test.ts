import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "@stonks/engine";
import { cosmeticById, pointsForRank } from "@stonks/shared";
import { Profiles } from "./profiles";
import { AFK_SECONDS, Rooms, type Room } from "./rooms";

function setup() {
  const changes: Room[] = [];
  const profiles = new Profiles(null);
  const rooms = new Rooms(profiles, (r) => changes.push(r));
  const host = rooms.create("Alice", "tok-a");
  if (!host.ok) throw new Error();
  const guest = rooms.join(host.data.code, "Bob", "tok-b");
  if (!guest.ok) throw new Error();
  return { rooms, profiles, host: host.data, guest: guest.data, changes };
}

afterEach(() => vi.useRealTimers());

describe("rooms", () => {
  it("creates a room with a 4-char code and lets others join", () => {
    const { rooms, host } = setup();
    expect(host.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(rooms.view(rooms.get(host.code)!, "p1").players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("the host picks the starting cash, a preset or any amount within bounds", () => {
    const { rooms, host } = setup();
    expect(rooms.start(host.code, host.playerId, "classique", 500).ok).toBe(false);
    expect(rooms.start(host.code, host.playerId, "classique", 1234.5).ok).toBe(false);
    expect(rooms.start(host.code, host.playerId, "classique", 42000).ok).toBe(true);
    expect(rooms.get(host.code)!.game!.players.every((p) => p.cash === 42000)).toBe(true);
  });

  it("only the host starts, and nobody joins after the start", () => {
    const { rooms, host, guest } = setup();
    expect(rooms.start(host.code, guest.playerId, "classique").ok).toBe(false);
    expect(rooms.start(host.code, host.playerId, "classique").ok).toBe(true);
    expect(rooms.join(host.code, "Chloé", "tok-c").ok).toBe(false);
  });

  it("only the admin account chooses the next roll of any player", () => {
    const profiles = new Profiles(null, { name: "Rycrem", password: "secret" });
    const admin = profiles.login("Rycrem", "secret", "tok-r");
    if (!admin.ok) throw new Error();
    const rooms = new Rooms(profiles, () => {});
    const host = rooms.create("Rycrem", admin.data.token);
    if (!host.ok) throw new Error();
    const guest = rooms.join(host.data.code, "Bob", "tok-b");
    if (!guest.ok) throw new Error();
    const code = host.data.code;
    const bob = guest.data.playerId;
    rooms.start(code, host.data.playerId, "classique");
    const room = rooms.get(code)!;
    expect(rooms.act(code, bob, { type: "ROLL", playerId: bob, dice: [2, 3] }).ok).toBe(false);
    expect(rooms.setDice(code, bob, bob, [6, 6]).ok).toBe(false);
    expect(rooms.setDice(code, host.data.playerId, bob, [2, 3]).ok).toBe(true);
    expect(rooms.view(room, bob).nextDice).toEqual({});
    expect(rooms.view(room, host.data.playerId).nextDice).toEqual({ [bob]: [2, 3] });
    room.game!.current = room.game!.players.findIndex((p) => p.id === bob);
    expect(rooms.act(code, bob, { type: "ROLL", playerId: bob }).ok).toBe(true);
    expect(room.game!.lastRoll).toEqual([2, 3]);
    expect(room.nextDice).toEqual({});
  });

  it("players can only act for themselves", () => {
    const { rooms, host, guest } = setup();
    rooms.start(host.code, host.playerId, "classique");
    const first = rooms.get(host.code)!.game!.players[0]!.id;
    const other = first === host.playerId ? guest.playerId : host.playerId;
    expect(rooms.act(host.code, other, { type: "ROLL", playerId: first })).toMatchObject({ ok: false });
    expect(rooms.act(host.code, first, { type: "AUCTION_CLOSE" })).toMatchObject({ ok: false });
    expect(rooms.act(host.code, first, { type: "ROLL", playerId: first })).toMatchObject({ ok: true });
  });

  it("reconnects a player with their token", () => {
    const { rooms, host, guest } = setup();
    rooms.start(host.code, host.playerId, "classique");
    rooms.setConnected(host.code, guest.playerId, false);
    expect(rooms.view(rooms.get(host.code)!, "p1").players[1]!.connected).toBe(false);
    expect(rooms.rejoin(host.code, guest.token)).toMatchObject({ ok: true, data: { playerId: "p2" } });
    expect(rooms.rejoin(host.code, "bad").ok).toBe(false);
  });

  it("removes a lobby player who disconnects before the start", () => {
    const { rooms, host, guest } = setup();
    rooms.setConnected(host.code, guest.playerId, false);
    expect(rooms.get(host.code)!.members).toHaveLength(1);
  });

  it("only the host kicks, from the lobby or during a game", () => {
    const { rooms, host, guest } = setup();
    const third = rooms.join(host.code, "Chloé", "tok-c");
    if (!third.ok) throw new Error();
    expect(rooms.kick(host.code, guest.playerId, host.playerId).ok).toBe(false);
    expect(rooms.kick(host.code, host.playerId, host.playerId).ok).toBe(false);
    expect(rooms.kick(host.code, host.playerId, third.data.playerId).ok).toBe(true);
    expect(rooms.get(host.code)!.members).toHaveLength(2);
    const fourth = rooms.join(host.code, "Dan", "tok-d");
    if (!fourth.ok) throw new Error();
    rooms.start(host.code, host.playerId, "classique");
    expect(rooms.kick(host.code, host.playerId, guest.playerId).ok).toBe(true);
    const room = rooms.get(host.code)!;
    expect(room.game!.players.find((p) => p.id === guest.playerId)!.bankrupt).toBe(true);
    expect(rooms.rejoin(host.code, guest.token).ok).toBe(false);
    expect(rooms.sendChat(host.code, guest.playerId, "public", "coucou").ok).toBe(false);
  });

  it("expires an offer after the timeout", () => {
    vi.useFakeTimers();
    const { rooms, host } = setup();
    rooms.start(host.code, host.playerId, "classique");
    const room = rooms.get(host.code)!;
    room.game!.phase = "act";
    const [buyer, owner] = room.game!.players;
    owner!.holdings = { nvidio: 10 };
    expect(rooms.act(host.code, buyer!.id, { type: "OFFER", playerId: buyer!.id, ownerId: owner!.id, company: "nvidio", percent: 5, price: 100 }).ok).toBe(true);
    expect(room.deadline).not.toBeNull();
    vi.advanceTimersByTime(config.offerTimeoutSeconds * 1000);
    expect(room.game!.offer).toBeNull();
    expect(room.deadline).toBeNull();
  });

  it("plays automatically for a disconnected player after a delay", () => {
    vi.useFakeTimers();
    const { rooms, host, guest } = setup();
    rooms.start(host.code, host.playerId, "classique");
    const room = rooms.get(host.code)!;
    // the dice decide who starts
    const [first, second] = room.game!.players.map((p) => p.id);
    rooms.setConnected(host.code, first!, false);
    vi.advanceTimersByTime(AFK_SECONDS * 1000);
    expect(room.game!.lastRoll).not.toBeNull();
    vi.advanceTimersByTime(AFK_SECONDS * 1000 * 3);
    expect(room.game!.players[room.game!.current]!.id).toBe(second);
  });

  it("credits points by rank once at the end of the game", () => {
    const { rooms, profiles, host } = setup();
    rooms.start(host.code, host.playerId, "chrono");
    const room = rooms.get(host.code)!;
    room.game!.players.find((p) => p.id === "p2")!.cash = 99999;
    expect(rooms.act(host.code, host.playerId, { type: "END_GAME" }).ok).toBe(true);
    expect(room.rewards).toEqual({ p2: pointsForRank(0), p1: pointsForRank(1) });
    expect(profiles.fetch("tok-b")).toMatchObject({ data: { points: pointsForRank(0) } });
    expect(profiles.fetch("tok-a")).toMatchObject({ data: { points: pointsForRank(1) } });
  });

  it("shows a bought cosmetic on the player's pawn in the lobby", () => {
    const { rooms, profiles, host } = setup();
    profiles.award("tok-a", 500);
    expect(profiles.buy("tok-a", "hat-couronne").ok).toBe(true);
    rooms.refreshLook("tok-a");
    expect(rooms.view(rooms.get(host.code)!, "p1").players[0]!.look.hat).toBe("hat-couronne");
  });
});

describe("profiles", () => {
  it("cannot buy without enough points, nor equip what is not owned", () => {
    const profiles = new Profiles(null);
    profiles.get("t");
    const crown = cosmeticById.get("hat-couronne")!;
    expect(profiles.buy("t", crown.id)).toMatchObject({ ok: false });
    expect(profiles.equip("t", "hat", crown.id)).toMatchObject({ ok: false });
    profiles.award("t", crown.price);
    expect(profiles.buy("t", crown.id)).toMatchObject({ ok: true, data: { points: 0 } });
    expect(profiles.equip("t", "hat", "hat-casquette")).toMatchObject({ ok: true, data: { look: { hat: "hat-casquette" } } });
  });
});

describe("chat", () => {
  function three() {
    const s = setup();
    const third = s.rooms.join(s.host.code, "Chloé", "tok-c");
    if (!third.ok) throw new Error();
    return { ...s, code: s.host.code, room: s.rooms.get(s.host.code)! };
  }
  const texts = (s: ReturnType<typeof three>, viewer: string) => s.rooms.view(s.room, viewer).chat.messages.map((m) => m.text);

  it("public messages reach everyone, private ones only the two players", () => {
    const s = three();
    expect(s.rooms.sendChat(s.code, "p1", "public", "salut").ok).toBe(true);
    expect(s.rooms.sendChat(s.code, "p1", "dm:p1:p2", "psst").ok).toBe(true);
    expect(s.rooms.sendChat(s.code, "p3", "dm:p1:p2", "espion").ok).toBe(false);
    expect(s.rooms.sendChat(s.code, "p1", "dm:p1:p9", "?").ok).toBe(false);
    expect(texts(s, "p2")).toEqual(["salut", "psst"]);
    expect(texts(s, "p3")).toEqual(["salut"]);
  });

  it("groups are visible to their members only, and vanish when one member is left", () => {
    const s = three();
    const g = s.rooms.createGroup(s.code, "p1", "Les loups", ["p2"]);
    if (!g.ok) throw new Error(g.error);
    s.rooms.sendChat(s.code, "p2", `group:${g.data}`, "on vise Chloé");
    expect(s.rooms.sendChat(s.code, "p3", `group:${g.data}`, "moi aussi").ok).toBe(false);
    expect(texts(s, "p1")).toContain("on vise Chloé");
    expect(texts(s, "p3")).toEqual([]);
    expect(s.rooms.view(s.room, "p3").chat.groups).toEqual([]);
    s.rooms.leaveGroup(s.code, "p2", g.data);
    expect(s.rooms.view(s.room, "p1").chat.groups).toEqual([]);
    expect(texts(s, "p1")).toEqual([]);
  });

  it("an alliance creates a group that is removed when the alliance ends", () => {
    const s = three();
    s.rooms.start(s.code, "p1", "classique");
    s.rooms.act(s.code, "p1", { type: "ALLIANCE_INVITE", playerId: "p1", targetId: "p2" });
    s.rooms.act(s.code, "p2", { type: "ALLIANCE_ANSWER", playerId: "p2", fromId: "p1", accept: true });
    const [group] = s.rooms.view(s.room, "p2").chat.groups;
    expect(group).toMatchObject({ name: "Alliance", members: ["p1", "p2"] });
    expect(s.rooms.view(s.room, "p3").chat.groups).toEqual([]);
    expect(s.rooms.leaveGroup(s.code, "p1", group!.id).ok).toBe(false);
    s.rooms.sendChat(s.code, "p1", `group:${group!.id}`, "secret");
    s.rooms.act(s.code, "p2", { type: "ALLIANCE_LEAVE", playerId: "p2" });
    expect(s.rooms.view(s.room, "p1").chat.groups).toEqual([]);
    expect(texts(s, "p1")).not.toContain("secret");
  });
});
