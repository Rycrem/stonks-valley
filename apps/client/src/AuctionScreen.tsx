import { config, type Auction, type GameState } from "@stonks/engine";
import { useEffect, useRef, useState } from "react";
import { money, PLAYER_COLORS } from "./format";
import { StockCard } from "./Overlay";
import { useStore } from "./store";

const LEAVE_MS = 380;
const STEPS = [100, 500, 1000];

// Seconds left: the server's deadline online, a local 30 s clock on a shared screen
function useRemaining(a: Auction | null, online: boolean, onExpire: () => void) {
  const deadline = useStore((s) => s.room?.deadline ?? null);
  const localEnd = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const lot = a?.company ? `${a.sellerId}:${a.company}` : null;
  useEffect(() => {
    localEnd.current = lot ? Date.now() + config.auctionTimeoutSeconds * 1000 : null;
  }, [lot]);
  const bids = a?.bids.length ?? 0;
  useEffect(() => {
    if (localEnd.current && bids > 0) localEnd.current += config.auctionBidExtraSeconds * 1000;
  }, [bids]);
  useEffect(() => {
    if (!lot) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [lot]);
  const end = online ? deadline : localEnd.current;
  const left = end ? Math.max(0, (end - now) / 1000) : config.auctionTimeoutSeconds;
  useEffect(() => {
    if (!online && lot && end && left <= 0) onExpire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, lot, left <= 0]);
  return left;
}

export function AuctionScreen({ game }: { game: GameState }) {
  const { dispatch, you, online } = useStore();
  const [shown, setShown] = useState<{ a: Auction; leaving: boolean } | null>(null);
  const [pick, setPick] = useState<{ ownerId: string; company: string; max: number } | null>(null);
  const [pct, setPct] = useState(1);
  useEffect(() => {
    if (!game.auction?.company) setPick(null);
    if (game.auction) setShown({ a: game.auction, leaving: false });
    else if (shown && !shown.leaving) {
      setShown({ ...shown, leaving: true });
      const t = setTimeout(() => setShown(null), LEAVE_MS);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.auction]);
  const left = useRemaining(game.auction, online, () => dispatch({ type: "AUCTION_CLOSE" }));
  if (!shown) return null;
  const a = shown.a;
  const nameOf = (id: string) => game.players.find((p) => p.id === id)?.name ?? "?";
  const colorOf = (id: string) => PLAYER_COLORS[game.players.findIndex((p) => p.id === id)] ?? "#fff";
  const can = (id: string) => you === null || you === id;
  const Who = ({ id }: { id: string }) => (
    <span className="who-inline">
      <span className="dot" style={{ background: colorOf(id) }} />
      {nameOf(id)}
    </span>
  );

  return (
    <div className={`auction-screen ${shown.leaving ? "leaving" : "entering"}`}>
      <div className="auction-top">
        <span>⚖ ENCHÈRES</span>
        {a.company && <span className="timer-pill">⏱ {Math.ceil(left)} s</span>}
      </div>
      {!a.company ? (
        <div className="auction-choose">
          <p>
            <Who id={a.chooserId} /> met aux enchères jusqu'à <strong>{a.percentToSell} %</strong> d'une action d'un adversaire.
          </p>
          {can(a.chooserId) ? (
            <div className="owners">
              {game.players
                .filter((p) => p.id !== a.chooserId && !p.bankrupt && Object.keys(p.holdings).length > 0)
                .map((p, i) => (
                  <div key={p.id} className="owner" style={{ animationDelay: `${i * 90}ms` }}>
                    <Who id={p.id} />
                    {p.atouts.includes("bouclier") && <small className="muted"> (a un Bouclier anti-OPA)</small>}
                    <div className="owner-cards">
                      {Object.entries(p.holdings).map(([c, held]) => {
                        const max = Math.min(held, a.percentToSell);
                        const selected = pick?.ownerId === p.id && pick.company === c;
                        return (
                          <button key={c} className={`card-button ${selected ? "selected" : ""}`} onClick={() => (setPick({ ownerId: p.id, company: c, max }), setPct(max))}>
                            <StockCard company={c} percent={held} small />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          ) : null}
          {can(a.chooserId) && pick && (
            <div className="auction-pct" key={`${pick.ownerId}:${pick.company}`}>
              <label>
                Pourcentage mis aux enchères : <strong>{pct} %</strong> (max {pick.max} %)
                <input type="range" min={1} max={pick.max} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
              </label>
              <button className="primary" onClick={() => dispatch({ type: "AUCTION_CHOOSE", playerId: a.chooserId, ownerId: pick.ownerId, company: pick.company, percent: pct })}>
                Mettre {pct} % aux enchères
              </button>
            </div>
          )}
          {!can(a.chooserId) && (
            <p className="muted">Choix en cours...</p>
          )}
        </div>
      ) : (
        <div className="auction-bid">
          <div className="lot">
            <StockCard company={a.company} percent={a.percent} />
            <small>
              de <Who id={a.sellerId!} />
              <br />
              mise à prix {money(a.startPrice)}
            </small>
          </div>
          <div className="bids">
            <div className="bar">
              <b style={{ width: `${Math.min(100, (left / config.auctionTimeoutSeconds) * 100)}%` }} />
            </div>
            {a.bids.length === 0 && <p className="muted">Aucune offre pour l'instant. Sans offre, la banque rachète à la mise à prix.</p>}
            {[...a.bids]
              .reverse()
              .slice(0, 4)
              .map((b, i) => (
                <div key={a.bids.length - i} className={`bid ${i === 0 ? "best" : ""}`}>
                  <span>
                    {i === 0 && "🥇 "}
                    <Who id={b.playerId} />
                  </span>
                  <span>{money(b.amount)}</span>
                </div>
              ))}
            {game.players
              .filter((p) => !p.bankrupt && p.id !== a.sellerId && can(p.id))
              .map((p) => {
                const next = a.highestBidderId ? a.highestBid + config.minBidIncrement : a.startPrice;
                return (
                  <div key={p.id} className="bid-row">
                    {you === null && <Who id={p.id} />}
                    {STEPS.map((s) => {
                      const amount = next + s - config.minBidIncrement;
                      return (
                        <button key={s} className="primary" disabled={amount > p.cash || a.highestBidderId === p.id} onClick={() => dispatch({ type: "BID", playerId: p.id, amount })}>
                          {money(amount)}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            {can(a.sellerId!) && game.players.find((p) => p.id === a.sellerId)?.atouts.includes("bouclier") && (
              <button onClick={() => dispatch({ type: "USE_ATOUT", playerId: a.sellerId! })}>Utiliser le Bouclier anti-OPA pour annuler</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
