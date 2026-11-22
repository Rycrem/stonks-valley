import type { GameState } from "@stonks/engine";
import { useEffect, useState } from "react";
import { PLAYER_COLORS } from "./format";
import { useStore } from "./store";

const FACES = [1, 2, 3, 4, 5, 6];

// Admin only: Ctrl + / opens a panel to choose the next roll of each player
export function DiceAdmin({ game }: { game: GameState }) {
  const { profile, online, room, localDice, setNextDice } = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!profile.admin) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "/" || e.code === "Slash" || e.code === "NumpadDivide")) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profile.admin]);
  if (!profile.admin || !open) return null;
  const next = online ? (room?.nextDice ?? {}) : localDice;
  return (
    <div className="dice-admin">
      <h4>Admin : prochain lancer de chaque joueur</h4>
      {game.players.map((p, i) => {
        const dice = next[p.id];
        const pick = (d: 0 | 1, v: number) => setNextDice(p.id, d === 0 ? [v, dice?.[1] ?? v] : [dice?.[0] ?? v, v]);
        return (
          <div key={p.id} className="dice-player">
            <strong style={{ color: PLAYER_COLORS[i] }}>{p.name}</strong>
            <span className="muted">{dice ? ` : ${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}` : " : aléatoire"}</span>
            {([0, 1] as const).map((d) => (
              <div key={d} className="row">
                Dé {d + 1}
                {FACES.map((v) => (
                  <button key={v} className={dice?.[d] === v ? "primary" : ""} onClick={() => pick(d, v)}>
                    {v}
                  </button>
                ))}
              </div>
            ))}
            {dice && <button onClick={() => setNextDice(p.id, null)}>Aléatoire</button>}
          </div>
        );
      })}
      <p className="muted">Chaque choix ne vaut que pour le prochain lancer du joueur.</p>
      <button onClick={() => setOpen(false)}>Fermer</button>
    </div>
  );
}
