import { board, markets, type GameEvent, type GameState } from "@stonks/engine";
import { useEffect, useRef, useState } from "react";
import { play, steps, type Sfx } from "./audio";
import { companyById, money, PLAYER_COLORS } from "./format";
import { useStore } from "./store";

const WALK_DELAY = 2.2;
const STEP = 0.24;
const LEAVE_MS = 380;

const HEAD: Record<string, { color: string; icon: string; title: string }> = {
  actu: { color: "#2a9fd6", icon: "📰", title: "ACTU TECH" },
  levee: { color: "#17c3a5", icon: "💰", title: "LEVÉE DE FONDS" },
  ipo: { color: "#d4a72c", icon: "🔔", title: "INTRODUCTION EN BOURSE" },
  krach: { color: "#5a2a3a", icon: "📉", title: "KRACH BOURSIER" },
  lap: { color: "#0a9d6e", icon: "🏁", title: "TOUR COMPLET" },
  atout: { color: "#e8b93a", icon: "⭐", title: "ATOUT" },
  bankrupt: { color: "#3a3f4b", icon: "💸", title: "FAILLITE" },
  double: { color: "#9b5de5", icon: "🎲", title: "DOUBLE" },
  jackpot: { color: "#e8c45a", icon: "🏦", title: "CAGNOTTE DE LA BOURSE" },
};

function sound(e: GameEvent, you: string | null) {
  // someone landed on one of my cells: the till rings
  if (e.kind === "royalty" && you && e.to.includes(you)) return play("cash");
  if (e.kind === "roll") {
    play("dice");
    return steps((e.to - e.from + board.length) % board.length, WALK_DELAY, STEP);
  }
  const map: Partial<Record<GameEvent["kind"], Sfx>> = { market: "bid", order: "dice", krach: "loss", royalty: "coin", buys: "buy", auction: "bid", bankrupt: "bankrupt", win: "win" };
  const amount = "amount" in e ? e.amount : 0;
  play(map[e.kind] ?? (e.kind === "atout" ? "buy" : amount >= 0 ? "coin" : "loss"));
}

// how long a card stays, then how long to wait before the next one (the pawn walk after a roll)
function timing(e: GameEvent): [number, number] {
  if (e.kind === "roll") return [WALK_DELAY * 1000 - LEAVE_MS, ((e.to - e.from + board.length) % board.length) * STEP * 1000 + 150];
  if (e.kind === "order") return [2000 + e.rolls.length * 700, 0];
  if (e.kind === "buys") return [3200 + e.deals.length * 600, 0];
  if (e.kind === "royalty") return [2400, 0];
  if (e.kind === "market") return [4200, 0];
  if (e.kind === "bankrupt") return [4500, 600];
  return [2800, 0];
}

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[27, 27], [73, 73]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[27, 27], [73, 27], [27, 73], [73, 73]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[27, 22], [73, 22], [27, 50], [73, 50], [27, 78], [73, 78]],
};

function Die({ value, delay, small }: { value: number; delay: number; small?: boolean }) {
  const [face, setFace] = useState(1 + Math.floor(Math.random() * 6));
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const spin = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
    const stop = setTimeout(() => {
      clearInterval(spin);
      setFace(value);
      setSettled(true);
    }, 650 + delay);
    return () => {
      clearInterval(spin);
      clearTimeout(stop);
    };
  }, [value, delay]);
  return (
    <div className={`big-die ${small ? "small" : ""} ${settled ? "settled" : "rolling"}`}>
      {PIPS[face]!.map(([x, y], i) => (
        <i key={i} style={{ left: `${x}%`, top: `${y}%` }} />
      ))}
    </div>
  );
}

export function StockCard({ company, percent, badge, small }: { company: string; percent: number; badge?: string; small?: boolean }) {
  const c = companyById.get(company)!;
  return (
    <div className={`stock-card ${small ? "small" : ""}`} style={{ background: `linear-gradient(160deg, ${c.color}, ${c.color}cc)` }}>
      {badge && <div className="badge">{badge}</div>}
      <div className="logo">
        <img src={`/logos/${company}.svg`} alt="" />
      </div>
      <div className="pct">{percent} %</div>
      <div className="name">{c.name}</div>
    </div>
  );
}

function Card({ e, nameOf, colorOf }: { e: GameEvent; nameOf: (id: string) => string; colorOf: (id: string) => string }) {
  if (e.kind === "order")
    return (
      <div className="buys order">
        <div className="buys-title">Ordre de passage</div>
        {e.rolls.map((r, i) => (
          <div key={r.playerId} className="order-row" style={{ animationDelay: `${150 + i * 250}ms` }}>
            <span className="rank">{i + 1}</span>
            <span className="dot" style={{ background: colorOf(r.playerId) }} />
            <strong>{nameOf(r.playerId)}</strong>
            <span className="spacer" />
            <Die value={r.dice[0]} delay={i * 250} small />
            <Die value={r.dice[1]} delay={i * 250 + 100} small />
            <span className="eq">{r.dice[0] + r.dice[1]}</span>
          </div>
        ))}
      </div>
    );
  const who = (
    <div className="who">
      <span className="dot" style={{ background: colorOf(e.playerId) }} />
      {nameOf(e.playerId)}
    </div>
  );
  if (e.kind === "market")
    return (
      <div className="event-card market-card">
        <div className="head" style={{ background: "#1f6fd1" }}>
          <span className="icon">📈</span>
          LA BOURSE BOUGE
        </div>
        <div className="body">
          {who}
          <div className="sub">passe le Départ en tête : nouvelles tendances des redevances</div>
          <div className="market-moves">
            {markets.map((m, i) => {
              const t = e.market[m.id] ?? 0;
              return (
                <div key={m.id} className="market-move" style={{ animationDelay: `${200 + i * 150}ms` }}>
                  <span>{m.name}</span>
                  <strong className={t > 0 ? "plus" : t < 0 ? "minus" : ""}>
                    {t > 0 ? "▲" : t < 0 ? "▼" : "="} {Math.abs(t)} %
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  if (e.kind === "roll")
    return (
      <div className="big-dice">
        <Die value={e.dice[0]} delay={0} />
        <Die value={e.dice[1]} delay={120} />
        <div className="eq">= {e.dice[0] + e.dice[1]}</div>
      </div>
    );
  if (e.kind === "buys")
    return (
      <div className="buys">
        {who}
        {e.items.length > 0 && (
          <>
            <div className="buys-title">a acheté</div>
            <div className="tray">
              {e.items.map((it, i) => (
                <div key={it.company} className="tray-item" style={{ animationDelay: `${150 + i * 120}ms` }}>
                  <StockCard company={it.company} percent={it.total} badge={`+${it.percent} %`} />
                </div>
              ))}
            </div>
          </>
        )}
        {e.deals.length > 0 && (
          <>
            <div className="buys-title deals-title">ventes et échanges</div>
            <div className="tray">
              {e.deals.map((d, i) => (
                <div key={i} className="tray-item deal" style={{ animationDelay: `${150 + (e.items.length + i) * 120}ms` }}>
                  <StockCard company={d.company} percent={d.percent} badge={money(d.price)} small />
                  <small>
                    {nameOf(d.sellerId)} → {d.buyerId ? nameOf(d.buyerId) : "la banque"}
                  </small>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  if (e.kind === "royalty") {
    const c = companyById.get(e.company)!;
    return (
      <div className="event-card">
        <div className="head" style={{ background: c.color }}>
          <img src={`/logos/${e.company}.svg`} alt="" className="head-logo" />
          REDEVANCE {c.name.toUpperCase()}
        </div>
        <div className="body">
          {who}
          <div className="text">
            paie {e.to.map(nameOf).join(" + ")}
          </div>
          <div className="amount minus">−{money(e.amount)}</div>
        </div>
      </div>
    );
  }
  if (e.kind === "win") return null;
  if (e.kind === "auction") {
    const name = companyById.get(e.company)!.name;
    const Person = ({ id }: { id: string }) => (
      <span className="person">
        <span className="dot" style={{ background: colorOf(id) }} />
        {nameOf(id)}
      </span>
    );
    return (
      <div className="event-card auction-card">
        <div className="head" style={{ background: "#e94f6f" }}>
          <span className="icon">⚖</span>
          ENCHÈRES
        </div>
        <div className="body">
          <div className="lot-card">
            <StockCard company={e.company} percent={e.percent} />
          </div>
          <div className="text">
            {e.cancelled ? "Enchère annulée avec un Atout" : e.winnerId ? `${e.percent} % de ${name} adjugés` : `Aucune offre pour ${e.percent} % de ${name}`}
          </div>
          <div className="parties">
            <div className="party">
              <small>Vendeur</small>
              <Person id={e.sellerId} />
            </div>
            <div className="arrow">→</div>
            <div className="party">
              <small>{e.cancelled ? "Garde ses parts" : "Acheteur"}</small>
              {e.cancelled ? <Person id={e.sellerId} /> : e.winnerId ? <Person id={e.winnerId} /> : <span className="person">La banque</span>}
            </div>
          </div>
          {!e.cancelled && <div className="amount plus">{money(e.price)}</div>}
          {!e.cancelled && <div className="sub">payés à {nameOf(e.sellerId)}</div>}
        </div>
      </div>
    );
  }
  const h = HEAD[e.kind]!;
  return (
    <div className="event-card">
      <div className="head" style={{ background: h.color }}>
        <span className="icon">{h.icon}</span>
        {h.title}
      </div>
      <div className="body">
        {who}
        {e.kind === "bankrupt" ? (
          <div className="text">fait faillite. {e.heirs.length ? "Ses actions sont réparties entre les autres joueurs." : "Ses actions retournent à la banque."}</div>
        ) : (
          <>
            <div className="text">{e.text}</div>
            {e.kind === "levee" && (
              <div className="mini-dice">
                <span>{e.dice[0]}</span>
                <span>{e.dice[1]}</span>
              </div>
            )}
            {e.amount !== 0 && (
              <>
                <div className={`amount ${e.amount >= 0 ? "plus" : "minus"}`}>
                  {e.amount >= 0 ? "+" : "−"}
                  {money(Math.abs(e.amount))}
                </div>
                <div className="sub">
                  Trésorerie : {money(e.before)} → {money(e.after)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Confetti() {
  const colors = ["#ffd166", "#06d6a0", "#ef476f", "#3dd6d0", "#9b5de5", "#ffffff"];
  return (
    <div className="confetti">
      {Array.from({ length: 80 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 20) * 0.12}s`,
            animationDuration: `${2.4 + (i % 7) * 0.3}s`,
          }}
        />
      ))}
    </div>
  );
}

// Plays the game's new events one after the other as animated cards, the same for every player
export function EventOverlay({ game }: { game: GameState }) {
  const seen = useRef<number | null>(null);
  const [queue, setQueue] = useState<GameEvent[]>([]);
  const [current, setCurrent] = useState<{ e: GameEvent; leaving: boolean; show: number; gap: number } | null>(null);
  const [winner, setWinner] = useState<{ id: string; leaving: boolean } | null>(null);
  // the card stays while the player touches or scrolls it
  const [held, setHeld] = useState(false);
  const nameOf = (id: string) => game.players.find((p) => p.id === id)?.name ?? "?";
  const colorOf = (id: string) => PLAYER_COLORS[game.players.findIndex((p) => p.id === id)] ?? "#fff";

  useEffect(() => {
    const max = Math.max(0, ...game.events.map((e) => e.id));
    // joining a game in progress skips its past events; a brand new game shows its turn order
    if (seen.current === null && game.lastRoll !== null) {
      seen.current = max;
      return;
    }
    seen.current ??= 0;
    const fresh = game.events.filter((e) => e.id > seen.current!);
    if (!fresh.length) return;
    seen.current = max;
    setQueue((q) => [...q, ...fresh]);
  }, [game.events]);

  useEffect(() => {
    if (current || !queue.length) return;
    const [e, ...rest] = queue;
    setQueue(rest);
    sound(e!, useStore.getState().you);
    if (e!.kind === "win") {
      setWinner({ id: e!.playerId, leaving: false });
      return;
    }
    // catch up when events piled up, but never cut a pawn walk short
    const speed = rest.length >= 4 ? 0.35 : rest.length >= 2 ? 0.6 : 1;
    const [show, gap] = timing(e!);
    setCurrent({ e: e!, leaving: false, show: show * speed, gap: e!.kind === "roll" ? gap : gap * speed });
  }, [queue, current]);

  // a card removed under the pointer never fires pointerleave: release the hold for the next one
  const shownId = current?.e.id;
  useEffect(() => setHeld(false), [shownId]);

  useEffect(() => {
    if (!current || held) return;
    const t = setTimeout(() => (current.leaving ? setCurrent(null) : setCurrent({ ...current, leaving: true })), current.leaving ? LEAVE_MS + current.gap : current.show);
    return () => clearTimeout(t);
  }, [current, held]);

  return (
    <>
      {current && current.e.kind !== "win" && (
        <div
          className={`overlay-slot ${current.leaving ? "leaving" : "entering"}`}
          key={current.e.id}
          onPointerEnter={() => setHeld(true)}
          onPointerDown={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
          onPointerUp={(ev) => ev.pointerType !== "mouse" && setHeld(false)}
        >
          <Card e={current.e} nameOf={nameOf} colorOf={colorOf} />
        </div>
      )}
      {winner && (
        <div className={`win-screen ${winner.leaving ? "leaving" : "entering"}`}>
          <Confetti />
          <div className="win-card">
            <div className="trophy">🏆</div>
            <div className="who">
              <span className="dot" style={{ background: colorOf(winner.id) }} />
              {nameOf(winner.id)}
            </div>
            <div className="win-title">remporte la partie !</div>
            <button className="primary" onClick={() => (setWinner({ ...winner, leaving: true }), setTimeout(() => setWinner(null), LEAVE_MS))}>
              Voir le classement
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Counts up or down to the new value and flashes green or red, instead of jumping
export function AnimatedMoney({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<"" | "up" | "down">("");
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    setFlash(value > start ? "up" : "down");
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      const v = Math.round(start + (value - start) * (1 - (1 - k) ** 3));
      setShown(v);
      from.current = v;
      if (k < 1) raf = requestAnimationFrame(tick);
      else setTimeout(() => setFlash(""), 400);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={`money ${flash}`}>{money(shown)}</span>;
}
