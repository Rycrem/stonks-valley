import { board, statsOf, type GameState, type PlayerStats } from "@stonks/engine";
import { useState } from "react";
import { companyById, money, PLAYER_COLORS } from "./format";

const AWARDS: { key: keyof PlayerStats; icon: string; title: string; show: (n: number) => string }[] = [
  { key: "royaltiesReceived", icon: "💰", title: "Rentier", show: (n) => `${money(n)} de redevances reçues` },
  { key: "royaltiesPaid", icon: "💸", title: "Mécène malgré lui", show: (n) => `${money(n)} de redevances payées` },
  { key: "peakWorth", icon: "🚀", title: "Pic de fortune", show: (n) => `${money(n)} de patrimoine au sommet` },
  { key: "spentOnStocks", icon: "📈", title: "Investisseur", show: (n) => `${money(n)} dépensés en actions` },
  { key: "biggestReceived", icon: "🎯", title: "Le jackpot", show: (n) => `${money(n)} en une seule redevance` },
  { key: "doubles", icon: "🎲", title: "Chanceux", show: (n) => `${n} doubles` },
  { key: "distance", icon: "🌍", title: "Globe-trotter", show: (n) => `${n} cases parcourues` },
  { key: "auctionsWon", icon: "🔨", title: "Roi des enchères", show: (n) => `${n} enchères gagnées` },
  { key: "cardsGain", icon: "🍀", title: "Béni des cartes", show: (n) => `${money(n)} gagnés avec les cartes` },
  { key: "cardsLoss", icon: "🌧️", title: "Maudit des cartes", show: (n) => `${money(n)} perdus avec les cartes` },
  { key: "atouts", icon: "⭐", title: "Collectionneur", show: (n) => `${n} Atouts pris` },
];

const ROWS: { key: keyof PlayerStats; label: string; isMoney?: boolean }[] = [
  { key: "rolls", label: "Lancers de dés" },
  { key: "doubles", label: "Doubles" },
  { key: "distance", label: "Cases parcourues" },
  { key: "royaltiesReceived", label: "Redevances reçues", isMoney: true },
  { key: "royaltiesPaid", label: "Redevances payées", isMoney: true },
  { key: "biggestReceived", label: "Plus grosse redevance reçue", isMoney: true },
  { key: "biggestPaid", label: "Plus grosse redevance payée", isMoney: true },
  { key: "percentBought", label: "% d'actions achetés" },
  { key: "spentOnStocks", label: "Dépensé en actions", isMoney: true },
  { key: "salesIncome", label: "Ventes d'actions", isMoney: true },
  { key: "auctionsWon", label: "Enchères gagnées" },
  { key: "auctionSpent", label: "Dépensé aux enchères", isMoney: true },
  { key: "auctionIncome", label: "Touché aux enchères", isMoney: true },
  { key: "cardsGain", label: "Gagné avec les cartes", isMoney: true },
  { key: "cardsLoss", label: "Perdu avec les cartes", isMoney: true },
  { key: "atouts", label: "Atouts pris" },
  { key: "peakWorth", label: "Patrimoine maximum", isMoney: true },
];

function WorthChart({ game }: { game: GameState }) {
  const rows = game.stats.history;
  if (rows.length < 2) return null;
  const W = 520;
  const H = 200;
  const max = Math.max(1, ...rows.flatMap((r) => Object.values(r)));
  const x = (i: number) => 30 + (i / (rows.length - 1)) * (W - 40);
  const y = (v: number) => H - 20 - (v / max) * (H - 30);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="worth-chart">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="grid" x1={30} x2={W - 10} y1={y(max * f)} y2={y(max * f)} />
          <text x={26} y={y(max * f) + 3} textAnchor="end">
            {Math.round((max * f) / 1000)}k
          </text>
        </g>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle">
        Tours de table
      </text>
      {game.players.map((p, i) => (
        <polyline key={p.id} fill="none" stroke={PLAYER_COLORS[i]} strokeWidth={2.5} strokeLinejoin="round" points={rows.map((r, k) => `${x(k)},${y(r[p.id] ?? 0)}`).join(" ")} />
      ))}
    </svg>
  );
}

// Full screen recap at the end of the game: awards, net worth over time, every total
export function EndStats({ game }: { game: GameState }) {
  const [open, setOpen] = useState(true);
  if (game.phase !== "gameOver") return null;
  if (!open) {
    return (
      <button className="end-stats-open primary" onClick={() => setOpen(true)}>
        📊 Statistiques
      </button>
    );
  }
  const g = structuredClone(game);
  const stats = g.players.map((p) => statsOf(g, p.id));
  const color = (i: number) => PLAYER_COLORS[i % PLAYER_COLORS.length];
  const [cell, landings] = Object.entries(g.stats.landings).sort((a, b) => b[1] - a[1])[0] ?? [];
  const [company, earned] = Object.entries(g.stats.companyRoyalties).sort((a, b) => b[1] - a[1])[0] ?? [];
  const rolls = stats.reduce((a, s) => a + s.rolls, 0);
  return (
    <div className="end-stats">
      <div className="end-stats-box">
        <button className="end-stats-close" onClick={() => setOpen(false)} aria-label="Fermer">
          ×
        </button>
        <h2>Statistiques de la partie</h2>
        <p className="muted">
          {g.stats.history.length} tours de table · {rolls} lancers de dés · gagnant : <strong>{g.players.find((p) => p.id === g.winner)?.name}</strong>
        </p>
        <div className="awards">
          {AWARDS.map((a) => {
            const best = Math.max(...stats.map((s) => s[a.key]));
            if (best <= 0) return null;
            const i = stats.findIndex((s) => s[a.key] === best);
            return (
              <div className="award" key={a.key}>
                <span className="award-icon">{a.icon}</span>
                <b>{a.title}</b>
                <strong style={{ color: color(i) }}>{g.players[i]!.name}</strong>
                <small>{a.show(best)}</small>
              </div>
            );
          })}
          {cell !== undefined && (
            <div className="award">
              <span className="award-icon">📍</span>
              <b>Case la plus visitée</b>
              <strong>{board[Number(cell)]?.name}</strong>
              <small>{landings} passages</small>
            </div>
          )}
          {company !== undefined && (
            <div className="award">
              <span className="award-icon">🏆</span>
              <b>Entreprise la plus rentable</b>
              <strong>{companyById.get(company)?.name}</strong>
              <small>{money(earned!)} de redevances</small>
            </div>
          )}
        </div>
        <h3>Patrimoine au fil de la partie</h3>
        <WorthChart game={g} />
        <div className="worth-legend">
          {g.players.map((p, i) => (
            <span key={p.id}>
              <i style={{ background: color(i) }} />
              {p.name}
            </span>
          ))}
        </div>
        <h3>Tous les chiffres</h3>
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th />
                {g.players.map((p, i) => (
                  <th key={p.id} style={{ color: color(i) }}>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => {
                const best = Math.max(...stats.map((s) => s[r.key]));
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    {stats.map((s, i) => (
                      <td key={i} className={best > 0 && s[r.key] === best ? "best" : ""}>
                        {r.isMoney ? money(s[r.key]) : s[r.key]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
