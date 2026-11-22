import { currentPlayer, type GameState } from "@stonks/engine";
import { useEffect, useState } from "react";
import { PLAYER_COLORS } from "./format";
import { AnimatedMoney } from "./Overlay";
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
    if (game.phase !== "roll") return;
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
