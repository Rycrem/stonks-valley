import { applyAction, createGame, rollTurnOrder, type Action, type GameMode, type GameState } from "@stonks/engine";
import { DEFAULT_LOOK, STARTER_ITEMS, type AccountRow, type ClientToServer, type Look, type ProfileView, type RoomView, type ServerToClient, type Session, type Slot } from "@stonks/shared";
import { io, type Socket } from "socket.io-client";
import { create } from "zustand";

const SESSION_KEY = "stonks-session";
const PROFILE_KEY = "stonks-profile";

function profileToken(): string {
  try {
    return localStorage.getItem(PROFILE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveProfileToken(token: string) {
  try {
    localStorage.setItem(PROFILE_KEY, token);
  } catch {
    // storage unavailable: the profile only lives for this visit
  }
}

function saveSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode): reconnection after reload just won't work
  }
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let socket: Socket<ServerToClient, ClientToServer> | null = null;

interface Store {
  online: boolean;
  you: string | null;
  room: RoomView | null;
  game: GameState | null;
  error: string | null;
  notice: string | null;
  profile: ProfileView;
  loadProfile: () => void;
  login: (name: string, password: string) => void;
  logout: () => void;
  setEmail: (email: string) => void;
  forgot: (name: string) => void;
  resetPassword: (resetToken: string, password: string) => Promise<boolean>;
  adminList: () => Promise<AccountRow[]>;
  adminPassword: (name: string, password: string) => Promise<boolean>;
  adminPoints: (name: string, points: number) => Promise<boolean>;
  buy: (itemId: string) => void;
  equip: (slot: Slot, itemId: string) => void;
  bots: string[];
  startLocal: (names: string[], mode: GameMode, bots?: boolean[], startingCash?: number) => void;
  createRoom: (name: string) => void;
  joinRoom: (code: string, name: string) => void;
  resume: () => void;
  startOnline: (mode: GameMode, startingCash: number) => void;
  kick: (playerId: string) => void;
  dispatch: (action: Action) => boolean;
  // admin: dice forced for each player's next roll on this screen (online they live on the server)
  localDice: Record<string, [number, number]>;
  setNextDice: (playerId: string, dice: [number, number] | null) => void;
  sendChat: (channel: string, text: string) => void;
  createGroup: (name: string, members: string[]) => Promise<string | null>;
  leaveGroup: (groupId: string) => void;
  inspect: { cell: number } | { company: string } | { market: string } | null;
  setInspect: (i: { cell: number } | { company: string } | { market: string } | null) => void;
  clearError: () => void;
  quit: () => void;
}

export const useStore = create<Store>((set, get) => {
  function connect(): Socket<ServerToClient, ClientToServer> {
    if (socket) return socket;
    socket = io({ autoConnect: true });
    socket.on("room:state", (room) => {
      // ignore late updates from a room we just left
      if (get().online) set({ room, game: room.game });
    });
    socket.on("room:kicked", () => {
      saveSession(null);
      set({ online: false, you: null, room: null, game: null, bots: [], error: null, notice: "L'hôte t'a exclu de la partie" });
    });
    socket.on("connect", () => {
      // after a network drop, take our seat back automatically
      const s = loadSession();
      if (s && get().online) socket!.emit("room:rejoin", s.code, s.token, () => {});
    });
    return socket;
  }

  const onProfile = (res: { ok: true; data: ProfileView } | { ok: false; error: string }) => {
    if (res.ok) {
      const { name, points, owned, look, account, email, admin } = res.data;
      set({ profile: { name, points, owned, look, account, email, admin }, error: null });
    } else set({ error: res.error, notice: null });
  };

  const onLogin = (res: { ok: true; data: ProfileView & { token: string } } | { ok: false; error: string }) => {
    if (res.ok) saveProfileToken(res.data.token);
    onProfile(res);
  };

  type Res<T> = { ok: true; data: T } | { ok: false; error: string };
  function adminCall<T>(run: (s: Socket<ServerToClient, ClientToServer>, done: (r: Res<T>) => void) => void): Promise<Res<T>> {
    return new Promise((resolve) =>
      run(connect(), (r) => {
        set({ error: r.ok ? null : r.error, notice: null });
        resolve(r);
      }),
    );
  }

  const onSession = (res: { ok: true; data: Session } | { ok: false; error: string }) => {
    if (!res.ok) {
      if (res.error === "Session expirée") saveSession(null);
      return set({ online: false, error: res.error });
    }
    saveSession(res.data);
    set({ online: true, you: res.data.playerId, error: null });
  };

  return {
    online: false,
    you: null,
    room: null,
    game: null,
    error: null,
    notice: null,
    profile: { name: "", points: 0, owned: STARTER_ITEMS, look: DEFAULT_LOOK as Look, account: null, email: null, admin: false },
    loadProfile: () => connect().emit("profile:get", profileToken(), onLogin),
    login: (name, password) => connect().emit("account:login", name, password, profileToken(), onLogin),
    logout: () => {
      saveProfileToken("");
      connect().emit("profile:get", "", onLogin);
    },
    setEmail: (email) =>
      connect().emit("account:email", profileToken(), email, (res) => {
        onProfile(res);
        if (res.ok) set({ notice: email.trim() ? "E-mail enregistré" : "E-mail retiré" });
      }),
    forgot: (name) =>
      connect().emit("account:forgot", name, (res) => set(res.ok ? { notice: res.data, error: null } : { error: res.error, notice: null })),
    resetPassword: (resetToken, password) =>
      new Promise((resolve) =>
        connect().emit("account:reset", resetToken, password, (res) => {
          onLogin(res);
          if (res.ok) set({ notice: "Mot de passe changé, te voilà connecté" });
          resolve(res.ok);
        }),
      ),
    adminList: async () => {
      const r = await adminCall<AccountRow[]>((s, done) => s.emit("admin:list", profileToken(), done));
      return r.ok ? r.data : [];
    },
    adminPassword: async (name, password) => (await adminCall<null>((s, done) => s.emit("admin:password", profileToken(), name, password, done))).ok,
    adminPoints: async (name, points) => (await adminCall<null>((s, done) => s.emit("admin:points", profileToken(), name, points, done))).ok,
    buy: (itemId) => connect().emit("profile:buy", profileToken(), itemId, onProfile),
    equip: (slot, itemId) => connect().emit("profile:equip", profileToken(), slot, itemId, onProfile),
    bots: [],
    startLocal: (names, mode, bots = [], startingCash) =>
      set({
        online: false,
        // solo: the screen belongs to the only human, bots play the other seats
        you: bots.some(Boolean) ? "p1" : null,
        bots: names.flatMap((_, i) => (bots[i] ? [`p${i + 1}`] : [])),
        room: null,
        game: rollTurnOrder(
          createGame(
            names.map((name, i) => ({ id: `p${i + 1}`, name })),
            Math.floor(Math.random() * 2 ** 31),
            mode,
            startingCash,
          ),
        ),
        error: null,
      }),
    createRoom: (name) => {
      set({ online: true });
      connect().emit("room:create", name, profileToken(), onSession);
    },
    joinRoom: (code, name) => {
      set({ online: true });
      connect().emit("room:join", code.trim().toUpperCase(), name, profileToken(), onSession);
    },
    resume: () => {
      const s = loadSession();
      if (!s) return;
      set({ online: true });
      connect().emit("room:rejoin", s.code, s.token, onSession);
    },
    startOnline: (mode, startingCash) =>
      socket?.emit("room:start", mode, startingCash, (res) => {
        if (!res.ok) set({ error: res.error });
      }),
    kick: (playerId) =>
      socket?.emit("room:kick", playerId, (res) => {
        if (!res.ok) set({ error: res.error });
      }),
    localDice: {},
    setNextDice: (playerId, dice) => {
      if (get().online) return void socket?.emit("admin:dice", playerId, dice, (res) => set({ error: res.ok ? null : res.error }));
      const { [playerId]: _, ...rest } = get().localDice;
      set({ localDice: dice ? { ...rest, [playerId]: dice } : rest });
    },
    dispatch: (action) => {
      if (get().online) {
        socket?.emit("game:action", action, (res) => set({ error: res.ok ? null : res.error }));
        return true;
      }
      const game = get().game;
      if (!game) return false;
      const { [action.type === "ROLL" ? action.playerId : ""]: forced, ...rest } = get().localDice;
      if (forced && action.type === "ROLL") action = { ...action, dice: forced };
      const r = applyAction(game, action);
      if (!r.ok) {
        set({ error: r.error });
        return false;
      }
      set({ game: r.state, error: null, ...(forced && { localDice: rest }) });
      return true;
    },
    sendChat: (channel, text) =>
      socket?.emit("chat:send", channel, text, (res) => {
        if (!res.ok) set({ error: res.error });
      }),
    createGroup: (name, members) =>
      new Promise((resolve) => {
        if (!socket) return resolve(null);
        socket.emit("chat:group", name, members, (res) => {
          if (!res.ok) set({ error: res.error });
          resolve(res.ok ? res.data : null);
        });
      }),
    leaveGroup: (groupId) =>
      socket?.emit("chat:leave", groupId, (res) => {
        if (!res.ok) set({ error: res.error });
      }),
    inspect: null,
    setInspect: (inspect) => set({ inspect }),
    clearError: () => set({ error: null, notice: null }),
    quit: () => {
      if (get().online) {
        socket?.emit("room:leave");
        saveSession(null);
      }
      set({ online: false, you: null, room: null, game: null, error: null, bots: [] });
    },
  };
});

export function hasSavedSession(): boolean {
  return loadSession() !== null;
}
