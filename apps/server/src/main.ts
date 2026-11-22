import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientToServer, ServerToClient } from "@stonks/shared";
import { Server } from "socket.io";
import { mailEnabled, sendMail } from "./mail";
import { Profiles } from "./profiles";
import { Rooms } from "./rooms";

const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = fileURLToPath(new URL("../../client/dist", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const http = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]!)).replace(/^(\.\.[/\\])+/, "");
  const file = join(STATIC_DIR, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file.startsWith(STATIC_DIR) ? file : join(STATIC_DIR, "index.html"));
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    try {
      res.writeHead(200, { "content-type": TYPES[".html"] });
      res.end(await readFile(join(STATIC_DIR, "index.html")));
    } catch {
      res.writeHead(404).end("Client non construit : lancer pnpm build");
    }
  }
});

const io = new Server<ClientToServer, ServerToClient>(http, { cors: { origin: true } });
const profiles = new Profiles(process.env.DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url)), {
  name: process.env.ADMIN_USER ?? "Rycrem",
  password: process.env.ADMIN_PASSWORD,
});
// each player gets their own view (private messages and groups are filtered)
const rooms = new Rooms(profiles, (room) => {
  for (const m of room.members) io.to(`${room.code}:${m.id}`).emit("room:state", rooms.view(room, m.id));
});

io.on("connection", (socket) => {
  let session: { code: string; playerId: string } | null = null;

  const enter = (code: string, playerId: string) => {
    if (session) socket.leave(`${session.code}:${session.playerId}`);
    session = { code, playerId };
    socket.join(`${code}:${playerId}`);
    const room = rooms.get(code);
    if (room) socket.emit("room:state", rooms.view(room, playerId));
  };

  socket.on("room:create", (name, profileToken, ack) => {
    const r = rooms.create(String(name ?? ""), String(profileToken ?? ""));
    if (r.ok) enter(r.data.code, r.data.playerId);
    ack(r);
  });

  socket.on("room:join", (code, name, profileToken, ack) => {
    const r = rooms.join(String(code ?? ""), String(name ?? ""), String(profileToken ?? ""));
    if (r.ok) enter(r.data.code, r.data.playerId);
    ack(r);
  });

  socket.on("room:rejoin", (code, token, ack) => {
    const r = rooms.rejoin(String(code ?? ""), String(token ?? ""));
    if (r.ok) enter(r.data.code, r.data.playerId);
    ack(r);
  });

  socket.on("room:start", (mode, startingCash, ack) => {
    if (!session) return ack({ ok: false, error: "Pas dans une partie" });
    ack(rooms.start(session.code, session.playerId, mode === "chrono" ? "chrono" : "classique", startingCash));
  });

  socket.on("room:kick", (playerId, ack) => {
    if (!session) return ack({ ok: false, error: "Pas dans une partie" });
    const { code } = session;
    const target = String(playerId ?? "");
    const r = rooms.kick(code, session.playerId, target);
    if (r.ok) {
      io.to(`${code}:${target}`).emit("room:kicked");
      io.in(`${code}:${target}`).socketsLeave(`${code}:${target}`);
    }
    ack(r);
  });

  socket.on("game:action", (action, ack) => {
    if (!session) return ack({ ok: false, error: "Pas dans une partie" });
    ack(rooms.act(session.code, session.playerId, action));
  });
  socket.on("admin:dice", (target, dice, ack) => {
    if (!session) return ack({ ok: false, error: "Pas dans une partie" });
    ack(rooms.setDice(session.code, session.playerId, String(target ?? ""), Array.isArray(dice) ? [Number(dice[0]), Number(dice[1])] : null));
  });

  socket.on("chat:send", (channel, text, ack) => {
    if (!session) return ack({ ok: false, error: "Pas dans une partie" });
    ack(rooms.sendChat(session.code, session.playerId, String(channel ?? ""), String(text ?? "")));
  });
  socket.on("chat:group", (name, members, ack) => {
    if (!session) return ack({ ok: false, error: "Pas dans une partie" });
    ack(rooms.createGroup(session.code, session.playerId, String(name ?? ""), Array.isArray(members) ? members.map(String) : []));
  });
  socket.on("chat:leave", (groupId, ack) => {
    if (!session) return ack({ ok: false, error: "Pas dans une partie" });
    ack(rooms.leaveGroup(session.code, session.playerId, String(groupId ?? "")));
  });

  socket.on("profile:get", (token, ack) => ack(profiles.fetch(String(token ?? ""))));
  socket.on("profile:buy", (token, itemId, ack) => {
    const r = profiles.buy(String(token ?? ""), String(itemId ?? ""));
    if (r.ok) rooms.refreshLook(String(token));
    ack(r);
  });
  socket.on("profile:equip", (token, slot, itemId, ack) => {
    const r = profiles.equip(String(token ?? ""), slot, String(itemId ?? ""));
    if (r.ok) rooms.refreshLook(String(token));
    ack(r);
  });

  socket.on("account:login", (name, password, current, ack) =>
    ack(profiles.login(String(name ?? ""), String(password ?? ""), String(current ?? ""))),
  );
  socket.on("account:email", (token, email, ack) => ack(profiles.setEmail(String(token ?? ""), String(email ?? ""))));
  socket.on("account:forgot", async (name, ack) => {
    if (!mailEnabled) return ack({ ok: false, error: "L'envoi d'e-mails n'est pas configuré : demande à l'admin de réinitialiser ton mot de passe" });
    const r = profiles.forgot(String(name ?? ""));
    const done = "Si ce compte a un e-mail, un lien de réinitialisation vient d'y être envoyé (valable 1 h)";
    if (!r) return ack({ ok: true, data: done });
    const base = process.env.PUBLIC_URL ?? socket.handshake.headers.origin ?? `http://localhost:${PORT}`;
    try {
      await sendMail(r.email, "Stonks Valley : nouveau mot de passe", `Pour choisir un nouveau mot de passe, ouvre ce lien (valable 1 h) :\n${base}/?reset=${r.token}\n\nSi tu n'as rien demandé, ignore cet e-mail.`);
      ack({ ok: true, data: done });
    } catch (e) {
      console.error("envoi e-mail", e);
      ack({ ok: false, error: "L'e-mail n'a pas pu être envoyé" });
    }
  });
  socket.on("account:reset", (resetToken, password, ack) => ack(profiles.reset(String(resetToken ?? ""), String(password ?? ""))));
  socket.on("admin:list", (token, ack) => ack(profiles.accounts(String(token ?? ""))));
  socket.on("admin:password", (token, name, password, ack) =>
    ack(profiles.adminPassword(String(token ?? ""), String(name ?? ""), String(password ?? ""))),
  );
  socket.on("admin:points", (token, name, points, ack) => ack(profiles.adminPoints(String(token ?? ""), String(name ?? ""), Number(points))));

  const leave = () => {
    if (!session) return;
    rooms.setConnected(session.code, session.playerId, false);
    socket.leave(`${session.code}:${session.playerId}`);
    session = null;
  };
  socket.on("room:leave", leave);
  socket.on("disconnect", leave);
});

http.listen(PORT, () => console.log(`Stonks Valley sur http://localhost:${PORT}`));
