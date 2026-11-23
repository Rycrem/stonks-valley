import { currentPlayer, type GameState } from "@stonks/engine";
import { useEffect, useState } from "react";
import { PLAYER_COLORS } from "./format";
import { AnimatedMoney, PIPS } from "./Overlay";
import { useStore } from "./store";

// My cash in the top right corner of the board; on a shared screen, the cash of whoever plays
export function CashHud({ game }: { game: GameState }) {
  const you = useStore((s) => s.you);
  const i = you ? game.players.findIndex((p) => p.id === you) : game.current;
  const p = game.players[i];
  if (!p) return null;
  return (
    <div className="cash-hud">
      <span className="dot" style={{ background: PLAYER_COLORS[i] }} />
      {!you && <span className="cash-hud-name">{p.name}</span>}
      <AnimatedMoney value={p.cash} />
    </div>
  );
}

// "Au tour de ..." banner each time the turn passes to another player
export function TurnBanner({ game }: { game: GameState }) {
  const you = useStore((s) => s.you);
  const p = currentPlayer(game);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    // the dice are thrown: the banner gives way to the roll
    if (game.phase !== "roll") return setShown(null);
    setShown(p.id);
    const t = setTimeout(() => setShown(null), 2400);
    return () => clearTimeout(t);
  }, [p.id, game.phase === "roll"]);
  if (shown !== p.id || game.phase === "gameOver") return null;
  const i = game.players.findIndex((x) => x.id === p.id);
  return (
    <div className="turn-popup" key={p.id}>
      <div className="event-card">
        <div className="head" style={{ background: PLAYER_COLORS[i] }}>
          <span className="icon">🎲</span>
          NOUVEAU TOUR
        </div>
        <div className="body">
          <div className="turn-name" style={{ color: PLAYER_COLORS[i] }}>
            {p.name}
          </div>
          <div className="text">{you === p.id ? "À toi de jouer !" : "va jouer"}</div>
        </div>
      </div>
    </div>
  );
}

const FLICK = 40;

// The dice wait in the middle of the board on my turn: a tap or a flick upwards throws them
export function DiceLauncher({ game }: { game: GameState }) {
  const { you, bots, dispatch, error } = useStore();
  const [drag, setDrag] = useState<{ id: number; y: number; dy: number } | null>(null);
  const [thrown, setThrown] = useState(false);
  const p = currentPlayer(game);
  const mine = game.phase === "roll" && (you === null ? !bots.includes(p.id) : you === p.id);
  useEffect(() => setThrown(false), [game.lastRoll, p.id, error]);
  if (!mine || thrown) return null;
  const roll = () => {
    setThrown(true);
    dispatch({ type: "ROLL", playerId: p.id });
  };
  const dy = drag ? Math.min(0, drag.dy) : 0;
  return (
    <button
      className={`dice-launcher ${drag ? "dragging" : ""}`}
      style={{ "--dy": `${Math.max(-120, dy)}px` } as React.CSSProperties}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ id: e.pointerId, y: e.clientY, dy: 0 });
      }}
      onPointerMove={(e) => drag?.id === e.pointerId && setDrag({ ...drag, dy: e.clientY - drag.y })}
      onPointerUp={(e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const moved = e.clientY - drag.y;
        setDrag(null);
        // a tap or a flick upwards; dragging down cancels
        if (moved <= -FLICK || Math.abs(moved) < 10) roll();
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), roll())}
    >
      <span className="dice-pair">
        {[5, 3].map((v, k) => (
          <span key={k} className="big-die small">
            {PIPS[v]!.map(([x, y], i) => (
              <i key={i} style={{ left: `${x}%`, top: `${y}%` }} />
            ))}
          </span>
        ))}
      </span>
      <strong>Lancer les dés</strong>
      <small>Touche ou glisse vers le haut</small>
    </button>
  );
}
