import { activePlayers, allianceOf, atoutById, board, buyableStock, buyCost, config, RACHAT_BONUS, currentPlayer, markets, netWorth, ranking, royaltyFor, royaltyQuote, trendOf, type GameEvent, type GameState } from "@stonks/engine";
import { useEffect, useState } from "react";
import { allianceColor, companyById, money, PLAYER_COLORS } from "./format";
import { AnimatedMoney } from "./Overlay";
import { useStore } from "./store";

export function GamePanel({ game }: { game: GameState }) {
  const { dispatch, error, clearError, quit, you, room } = useStore();
  const me = currentPlayer(game);
  const canAct = (id: string) => you === null || you === id;
  const myTurn = canAct(me.id);
  const cell = board[me.position]!;
  const colorOf = (id: string) => PLAYER_COLORS[game.players.findIndex((p) => p.id === id)]!;
  const nameOf = (id: string) => game.players.find((p) => p.id === id)!.name;
  // phones: the panel is a bottom sheet, folded away, half open or pulled up
  const [sheet, setSheet] = useState<"min" | "mid" | "max">("mid");
  // the sheet follows the finger while dragged, then snaps to the closest size; a tap cycles the sizes
  const [drag, setDrag] = useState<{ y: number; h: number; now: number } | null>(null);
  const endDrag = (y: number) => {
    if (!drag) return;
    const dy = y - drag.y;
    setDrag(null);
    if (Math.abs(dy) < 8) return setSheet(sheet === "mid" ? "max" : sheet === "max" ? "min" : "mid");
    const vh = window.innerHeight;
    const sizes = [["min", 130], ["mid", vh * 0.38], ["max", vh * 0.78]] as const;
    const h = drag.h - dy;
    setSheet(sizes.reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))[0]);
  };

  if (game.phase === "gameOver") {
    return (
      <aside className="panel">
        <h2>Partie terminée</h2>
        <p className="big">{nameOf(game.winner!)} gagne !</p>
        {room?.rewards && (
          <div className="card rewards">
            <h3>Points gagnés</h3>
            {ranking(game).map((id, i) => (
              <div className="row" key={id}>
                <span>{i + 1}.</span>
                <strong>{nameOf(id)}</strong>
                <span className="spacer" />
                <span className="points">+{room.rewards![id]} pts</span>
              </div>
            ))}
          </div>
        )}
        <Players game={game} colorOf={colorOf} />
        <button className="primary" onClick={quit}>
          Nouvelle partie
        </button>
      </aside>
    );
  }

  return (
    <aside className={`panel sheet-${sheet} ${drag ? "dragging" : ""}`} style={drag ? { height: Math.max(90, drag.now) } : undefined}>
      <button
        className="sheet-handle"
        aria-label={sheet === "max" ? "Ranger le panneau" : "Agrandir le panneau"}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const h = e.currentTarget.parentElement!.getBoundingClientRect().height;
          setDrag({ y: e.clientY, h, now: h });
        }}
        onPointerMove={(e) => drag && setDrag({ ...drag, now: Math.min(window.innerHeight * 0.92, drag.h - (e.clientY - drag.y)) })}
        onPointerUp={(e) => endDrag(e.clientY)}
        onPointerCancel={() => setDrag(null)}
      >
        <i />
      </button>
      <div className="turn" style={{ borderColor: colorOf(me.id) }}>
        <span className="dot" style={{ background: colorOf(me.id) }} />
        Au tour de <strong>{me.name}</strong>
      </div>

      {error && (
        <div className="error" onClick={clearError}>
          {error}
        </div>
      )}

      {!myTurn && game.phase !== "auction" && !game.offer && <p className="muted">En attente de {me.name}...</p>}

      {game.phase !== "roll" && (
        <div className="card">
          <h3>{cell.name}</h3>
          {cell.type === "city" && <p>Redevance : {companyById.get(game.royalties[cell.id]!)!.name}</p>}
        </div>
      )}

      {game.phase === "auction" && <p className="muted">Enchères en cours sur le plateau...</p>}
      {me.cash < 0 && game.phase === "act" && <DebtPanel game={game} />}

      {game.phase === "act" && !game.offer && myTurn && (
        <>
          {game.buyScope && <BuyPanel game={game} />}
          <OfferForm game={game} />
          <SellForm game={game} />
          <button className="primary" onClick={() => dispatch({ type: "END_TURN", playerId: me.id })}>
            Fin du tour
          </button>
        </>
      )}

      {game.offer && <OfferPanel game={game} nameOf={nameOf} />}
      {game.debt?.offer && canAct(game.debt.creditorId) && <DebtDealAnswer game={game} nameOf={nameOf} />}

      {you && <AlliancePanel game={game} you={you} nameOf={nameOf} />}
      {you && <LoanPanel game={game} you={you} nameOf={nameOf} />}

      <Players game={game} colorOf={colorOf} />

      <Journal game={game} colorOf={colorOf} nameOf={nameOf} />

      {you && <QuitLink game={game} you={you} />}

      {game.mode === "chrono" && (!room || you === room.hostId) && (
        <button className="ghost" onClick={() => dispatch({ type: "END_GAME" })}>
          Arrêter la partie (le plus riche gagne)
        </button>
      )}
    </aside>
  );
}

// Online only: each player manages their own alliance
function AlliancePanel({ game, you, nameOf }: { game: GameState; you: string; nameOf: (id: string) => string }) {
  const dispatch = useStore((s) => s.dispatch);
  const mine = allianceOf(game, you);
  const invites = game.allianceInvites.filter((i) => i.to === you);
  const sent = game.allianceInvites.filter((i) => i.from === you).map((i) => i.to);
  const alive = activePlayers(game);
  const room = (mine?.members.length ?? 1) + 1 < alive.length;
  const candidates = alive.filter((p) => p.id !== you && !allianceOf(game, p.id) && !sent.includes(p.id));
  const [target, setTarget] = useState("");
  if (game.players.find((p) => p.id === you)?.bankrupt) return null;
  return (
    <details className="card" open={invites.length > 0 || !!mine}>
      <summary>Alliance{mine ? ` : ${mine.members.map(nameOf).join(", ")}` : ""}</summary>
      <p className="muted">Les alliés additionnent leurs % pour être le plus gros détenteur, se partagent la redevance selon leurs % et ne se paient pas entre eux.</p>
      {invites.map((i) => (
        <div key={i.from} className="alliance-box">
          <span>
            <strong>{nameOf(i.from)}</strong> te propose une alliance
          </span>
          <div className="row">
            <button className="primary" onClick={() => dispatch({ type: "ALLIANCE_ANSWER", playerId: you, fromId: i.from, accept: true })}>
              Accepter
            </button>
            <button onClick={() => dispatch({ type: "ALLIANCE_ANSWER", playerId: you, fromId: i.from, accept: false })}>Refuser</button>
          </div>
        </div>
      ))}
      {sent.length > 0 && <small className="muted">En attente : {sent.map(nameOf).join(", ")}</small>}
      {room && candidates.length > 0 && (
        <div className="row">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choisir un joueur</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button disabled={!target} onClick={() => dispatch({ type: "ALLIANCE_INVITE", playerId: you, targetId: target }) && setTarget("")}>
            Proposer
          </button>
        </div>
      )}
      {mine && <button onClick={() => dispatch({ type: "ALLIANCE_LEAVE", playerId: you })}>Quitter l'alliance</button>}
    </details>
  );
}

function Players({ game, colorOf }: { game: GameState; colorOf: (id: string) => string }) {
  const { room, you, dispatch, setInspect, kick } = useStore();
  const alive = activePlayers(game);
  // gold ring when the player (alone or with allies) is the biggest holder; brighter at 100 %, where the royalty doubles
  const lead = (id: string, c: string) => {
    const q = royaltyQuote(game, c);
    if (!q.winners.flat().some((w) => w.id === id)) return "";
    return q.max === 100 ? "monopoly" : "leader";
  };
  const [lendTo, setLendTo] = useState<string | null>(null);
  const [amount, setAmount] = useState(1000);
  const myCash = game.players.find((p) => p.id === you && !p.bankrupt)?.cash ?? 0;
  const canLend = (id: string) =>
    you !== null && id !== you && myCash > 0 && alive.some((p) => p.id === id) && !game.loanOffers.some((o) => o.lenderId === you && o.borrowerId === id);
  const canKick = (id: string) => !!room && room.hostId === you && id !== you && game.phase !== "gameOver" && !game.players.find((p) => p.id === id)!.bankrupt;
  const offline = new Set(room?.players.filter((p) => !p.connected).map((p) => p.id));
  const mine = you ? allianceOf(game, you) : null;
  const sent = game.allianceInvites.filter((i) => i.from === you).map((i) => i.to);
  const canInvite = (id: string) =>
    you !== null &&
    id !== you &&
    !game.players.find((p) => p.id === you)?.bankrupt &&
    (mine?.members.length ?? 1) + 1 < alive.length &&
    alive.some((p) => p.id === id) &&
    !allianceOf(game, id) &&
    !sent.includes(id);
  return (
    <div className="players">
      {game.players.map((p) => (
        <div key={p.id} className={`player ${p.bankrupt ? "out" : ""}`}>
          <div className="row">
            <span className="dot" style={{ background: colorOf(p.id) }} />
            <strong>{p.name}</strong>
            {offline.has(p.id) && !p.bankrupt && <span className="offline">déconnecté</span>}
            {allianceOf(game, p.id) && <span className="chip alliance" style={{ background: allianceColor(allianceOf(game, p.id)!.id), color: "#1b2433", textShadow: "none" }}>Alliance {allianceOf(game, p.id)!.id.slice(1)}</span>}
            {sent.includes(p.id) && <small className="muted">invité</small>}
            <span className="spacer" />
            {p.bankrupt ? (game.eliminated.includes(p.id) && game.log.includes(`${p.name} est exclu de la partie`) ? "exclu" : "en faillite") : <AnimatedMoney value={p.cash} />}
          </div>
          {(canInvite(p.id) || canLend(p.id) || canKick(p.id)) && (
            <div className="row player-actions">
              {canInvite(p.id) && (
                <button className="ally-btn" title="Proposer une alliance" onClick={() => dispatch({ type: "ALLIANCE_INVITE", playerId: you!, targetId: p.id })}>
                  Alliance ?
                </button>
              )}
              {canLend(p.id) && (
                <button className="ally-btn" title="Prêter de l'argent" onClick={() => setLendTo(lendTo === p.id ? null : p.id)}>
                  Prêter
                </button>
              )}
              {canKick(p.id) && (
                <button className="ally-btn kick-btn" title="Exclure ce joueur" onClick={() => confirm(`Exclure ${p.name} de la partie ? Ses parts retournent à la banque.`) && kick(p.id)}>
                  Exclure
                </button>
              )}
            </div>
          )}
          <div className="chips">
            {Object.entries(p.holdings)
              .sort((a, b) => b[1] - a[1])
              .map(([c, pct]) => (
                <span
                  key={c}
                  className={`chip clickable ${lead(p.id, c)}`}
                  title={lead(p.id, c) === "monopoly" ? "Monopole : redevance doublée" : lead(p.id, c) ? "Plus gros détenteur : touche la redevance" : undefined}
                  style={{ background: companyById.get(c)!.color }}
                  onClick={() => setInspect({ company: c })}
                >
                  <img src={`/logos/${c}.svg`} alt="" />
                  {companyById.get(c)!.name} {pct} %
                </span>
              ))}
            {p.atouts.map((a, i) => (
              <span key={i} className="chip atout" title={atoutById.get(a)!.text}>
                ⭐ {atoutById.get(a)!.name}
              </span>
            ))}
          </div>
          {!p.bankrupt && <small>Patrimoine : {money(netWorth(p))}</small>}
          {lendTo === p.id && canLend(p.id) && (
            <div className="row loan-form">
              <input type="number" min={100} step={100} max={myCash} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              <button
                className="primary"
                onClick={() => dispatch({ type: "LOAN_OFFER", playerId: you!, borrowerId: p.id, amount }) && setLendTo(null)}
              >
                Proposer le prêt
              </button>
              <small className="muted">
                {p.name} te reversera {config.loanShare} % de ses revenus jusqu'à {money(Math.ceil((amount * config.loanCap) / 100))}.
              </small>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BuyPanel({ game }: { game: GameState }) {
  const dispatch = useStore((s) => s.dispatch);
  const inspect = useStore((s) => s.setInspect);
  const me = currentPlayer(game);
  const stock = buyableStock(game);
  const left = config.maxPurchasePercent - game.boughtThisTurn + (me.atouts.includes("rachat") ? RACHAT_BONUS : 0);
  const [wanted, setWanted] = useState<Record<string, number>>({});
  useEffect(() => setWanted({}), [game.current, game.phase, me.position]);

  const total = Object.values(wanted).reduce((a, b) => a + b, 0);
  const cost = Object.entries(wanted).reduce((a, [c, p]) => a + buyCost(c, me.holdings[c] ?? 0, p), 0);
  const entries = Object.entries(stock);

  if (entries.length === 0) return <p className="muted">Rien à acheter ici.</p>;
  return (
    <div className="card">
      <h3>Acheter des parts</h3>
      <p className="muted">Encore {left} % achetables ce tour{me.atouts.includes("rachat") && ` (dont ${RACHAT_BONUS} % de Rachat express, utilisé seulement au-delà de ${config.maxPurchasePercent} %)`}.</p>
      {entries.map(([c, available]) => {
        const company = companyById.get(c)!;
        const allowed = Math.min(available, left - total + (wanted[c] ?? 0));
        return (
          <div key={c} className="buy-row">
            <span className="chip clickable" style={{ background: company.color }} onClick={() => inspect({ company: c })}>
              <img src={`/logos/${c}.svg`} alt="" />
              {company.name}
            </span>
            <input
              type="range"
              min={0}
              max={available}
              value={wanted[c] ?? 0}
              onChange={(e) => setWanted({ ...wanted, [c]: Math.min(allowed, Number(e.target.value)) })}
            />
            <span>
              {wanted[c] ?? 0} / {available} %
            </span>
            <small>
              {money(company.pricePerPercent)} / %{(me.holdings[c] ?? 0) + (wanted[c] ?? 0) > config.dominanceFrom && <b className="minus"> (plus cher au-delà de {config.dominanceFrom} % : {money(buyCost(c, me.holdings[c] ?? 0, wanted[c] ?? 0))} pour {wanted[c] ?? 0} %)</b>} · rapporte {money(company.royaltyPerPercent)} / % à chaque passage · tu en as <strong>{me.holdings[c] ?? 0} %</strong>
              {wanted[c]
                ? ` · avec ${(me.holdings[c] ?? 0) + wanted[c]!} %, tu toucherais ${money(royaltyFor(c, (me.holdings[c] ?? 0) + wanted[c]!, trendOf(game, c)))} par passage en étant le plus gros détenteur`
                : ""}
            </small>
          </div>
        );
      })}
      <button
        className={`buy-btn ${cost <= me.cash ? "afford" : "broke"}`}
        disabled={total === 0 || cost > me.cash}
        onClick={() => dispatch({ type: "BUY", playerId: me.id, purchases: wanted }) && setWanted({})}
      >
        Acheter {total} % pour {money(cost)}
      </button>
    </div>
  );
}

function OfferForm({ game }: { game: GameState }) {
  const dispatch = useStore((s) => s.dispatch);
  const me = currentPlayer(game);
  const others = game.players.filter((p) => p.id !== me.id && !p.bankrupt && Object.keys(p.holdings).length > 0);
  const [ownerId, setOwnerId] = useState("");
  const [company, setCompany] = useState("");
  const [percent, setPercent] = useState(5);
  const [price, setPrice] = useState(500);
  if (others.length === 0) return null;
  const owner = others.find((p) => p.id === ownerId) ?? others[0]!;
  const holdings = Object.keys(owner.holdings);
  const co = holdings.includes(company) ? company : holdings[0]!;

  return (
    <details className="card">
      <summary>Racheter des parts à un joueur</summary>
      <select value={owner.id} onChange={(e) => setOwnerId(e.target.value)}>
        {others.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <select value={co} onChange={(e) => setCompany(e.target.value)}>
        {holdings.map((c) => (
          <option key={c} value={c}>
            {companyById.get(c)!.name} ({owner.holdings[c]} %)
          </option>
        ))}
      </select>
      <label>
        % <input type="number" min={1} max={owner.holdings[co]} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
      </label>
      <label>
        Prix <input type="number" min={0} step={100} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
      </label>
      <OfferValue company={co} percent={percent} price={price} />
      <button onClick={() => dispatch({ type: "OFFER", playerId: me.id, ownerId: owner.id, company: co, percent, price })}>Proposer</button>
    </details>
  );
}

// What the shares are worth: the market price, and what the bank would pay for them
function OfferValue({ company, percent, price }: { company: string; percent: number; price: number }) {
  const value = companyById.get(company)!.pricePerPercent * percent;
  const gap = value ? Math.round(((price - value) / value) * 100) : 0;
  return (
    <p className="offer-value">
      Valeur estimée : <strong>{money(value)}</strong> (banque : {money(Math.floor(value * config.bankBuybackRatio))})
      {gap !== 0 && <span className={gap > 0 ? "plus" : "minus"}> · offre {gap > 0 ? "+" : ""}{gap} %</span>}
    </p>
  );
}

function OfferPanel({ game, nameOf }: { game: GameState; nameOf: (id: string) => string }) {
  const { dispatch, you } = useStore();
  const o = game.offer!;
  const [counter, setCounter] = useState(o.price);
  useEffect(() => setCounter(o.price), [o.price]);
  return (
    <div className="card highlight">
      <h3>Offre de rachat</h3>
      <p>
        {nameOf(o.buyerId)} veut acheter {o.percent} % de {companyById.get(o.company)!.name} à {nameOf(o.ownerId)} pour {money(o.price)}.
      </p>
      <OfferValue company={o.company} percent={o.percent} price={o.price} />
      <p>
        Réponse attendue de <strong>{nameOf(o.awaiting)}</strong>
      </p>
      <Countdown />
      {(you === null || you === o.awaiting) && (
      <>
      <div className="row">
        <button className="primary" onClick={() => dispatch({ type: "RESPOND_OFFER", playerId: o.awaiting, accept: true })}>
          Accepter
        </button>
        <button className="danger" onClick={() => dispatch({ type: "RESPOND_OFFER", playerId: o.awaiting, accept: false })}>
          Refuser l'offre
        </button>
      </div>
      <div className="row">
        <input type="number" min={0} step={100} value={counter} onChange={(e) => setCounter(Number(e.target.value))} />
        <button onClick={() => dispatch({ type: "RESPOND_OFFER", playerId: o.awaiting, accept: false, counterPrice: counter })}>Contre-offre</button>
      </div>
      </>
      )}
    </div>
  );
}

// Short of cash after a payment: sell to the bank, give shares to the creditor, borrow, or give up
function DebtPanel({ game }: { game: GameState }) {
  const { dispatch, you } = useStore();
  const me = currentPlayer(game);
  const [sell, setSell] = useState<Record<string, number>>({});
  const [deal, setDeal] = useState<Record<string, number>>({});
  const [quit, setQuit] = useState(false);
  if (you !== null && you !== me.id) return <p className="muted">{me.name} doit rembourser sa dette avant de finir son tour.</p>;
  const d = game.debt;
  const creditor = d && game.players.find((p) => p.id === d.creditorId)!.name;
  const ratio = config.bankBuybackRatio;
  return (
    <div className="card highlight debt">
      <h3>Dette : {money(-me.cash)}</h3>
      <p className="muted">Choisis quelles actions revendre à la banque ({ratio * 100} % du prix) pour revenir à 0.</p>
      {Object.entries(me.holdings).map(([c, pct]) => {
        const co = companyById.get(c)!;
        const per = co.pricePerPercent * ratio;
        const needed = Math.min(pct, Math.ceil(-me.cash / per));
        const n = Math.min(pct, sell[c] ?? needed);
        return (
          <div key={c} className="debt-row">
            <div className="row">
              <span className="chip" style={{ background: co.color }}>
                <img src={`/logos/${c}.svg`} alt="" />
                {co.name} {pct} %
              </span>
              <span className="spacer" />
              <strong>{n} %</strong>
            </div>
            <div className="row">
              <input type="range" min={1} max={pct} value={n} onChange={(e) => setSell({ ...sell, [c]: Number(e.target.value) })} />
              <button onClick={() => dispatch({ type: "SELL_TO_BANK", playerId: me.id, company: c, percent: n })}>Vendre {money(Math.floor(per * n))}</button>
            </div>
          </div>
        );
      })}
      <button onClick={() => dispatch({ type: "SETTLE_DEBT", playerId: me.id })}>Vendre automatiquement (les moins chères d'abord)</button>
      {d && Object.keys(me.holdings).length > 0 && (
        <div className="debt-deal">
          <h4>Accord avec {creditor}</h4>
          {d.offer ? (
            <p className="muted">Actions proposées, en attente de la réponse de {creditor}...</p>
          ) : (
            <>
              <p className="muted">Donne-lui des actions à la place : s'il accepte, {money(Math.min(d.amount, -me.cash))} de dette sont effacés.</p>
              {Object.entries(me.holdings).map(([c, pct]) => (
                <label key={c} className="row">
                  <span>{companyById.get(c)!.name}</span>
                  <span className="spacer" />
                  <input type="number" min={0} max={pct} value={deal[c] ?? 0} onChange={(e) => setDeal({ ...deal, [c]: Math.max(0, Math.min(pct, Number(e.target.value))) })} />
                  <span>/ {pct} %</span>
                </label>
              ))}
              <button
                disabled={!Object.values(deal).some((n) => n > 0)}
                onClick={() => dispatch({ type: "DEBT_DEAL_OFFER", playerId: me.id, shares: Object.fromEntries(Object.entries(deal).filter(([, n]) => n > 0)) })}
              >
                Proposer ces actions à {creditor}
              </button>
            </>
          )}
        </div>
      )}
      <p className="muted">Un autre joueur peut aussi te prêter de l'argent (bouton Prêter sur ta ligne).</p>
      {quit ? (
        <div className="row">
          <button className="danger" onClick={() => dispatch({ type: "DECLARE_BANKRUPTCY", playerId: me.id })}>
            Confirmer la faillite
          </button>
          <button onClick={() => setQuit(false)}>Annuler</button>
        </div>
      ) : (
        <button className="ghost" onClick={() => setQuit(true)}>
          Déclarer faillite (tes actions sont réparties entre les autres joueurs)
        </button>
      )}
    </div>
  );
}

// Discreet, at the very bottom: give up at any time, the shares left go to the other players
function QuitLink({ game, you }: { game: GameState; you: string }) {
  const dispatch = useStore((s) => s.dispatch);
  const [sure, setSure] = useState(false);
  const [split, setSplit] = useState<Record<string, Record<string, number>>>({});
  const me = game.players.find((p) => p.id === you);
  if (!me || me.bankrupt) return null;
  if (!sure)
    return (
      <p className="quit-link">
        <a onClick={() => setSure(true)}>Déclarer faillite</a>
      </p>
    );
  const heirs = activePlayers(game).filter((p) => p.id !== you);
  const given = (c: string, except?: string) => heirs.reduce((a, h) => a + (h.id === except ? 0 : (split[h.id]?.[c] ?? 0)), 0);
  const set = (id: string, c: string, n: number) => {
    const max = (me.holdings[c] ?? 0) - given(c, id);
    setSplit({ ...split, [id]: { ...split[id], [c]: Math.max(0, Math.min(max, Math.floor(n) || 0)) } });
  };
  return (
    <div className="card quit-split">
      <h3>Déclarer faillite</h3>
      {Object.keys(me.holdings).length > 0 ? (
        <>
          <p className="muted">Choisis à qui donner tes actions. Ce que tu n'attribues pas est réparti automatiquement, 1 % à la fois, dans l'ordre du tour.</p>
          {Object.entries(me.holdings).map(([c, pct]) => (
            <div key={c} className="split-row">
              <div className="row">
                <span className="chip" style={{ background: companyById.get(c)!.color }}>
                  <img src={`/logos/${c}.svg`} alt="" />
                  {companyById.get(c)!.name} {pct} %
                </span>
                <span className="spacer" />
                <small className="muted">reste {pct - given(c)} %</small>
              </div>
              <div className="split-heirs">
                {heirs.map((h) => (
                  <label key={h.id}>
                    <span>{h.name}</span>
                    <input type="number" min={0} max={pct} value={split[h.id]?.[c] ?? 0} onChange={(e) => set(h.id, c, Number(e.target.value))} />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">Tu n'as plus d'actions à répartir.</p>
      )}
      <div className="row">
        <button className="danger" onClick={() => dispatch({ type: "DECLARE_BANKRUPTCY", playerId: you, split })}>
          Confirmer la faillite
        </button>
        <button onClick={() => (setSure(false), setSplit({}))}>Annuler</button>
      </div>
    </div>
  );
}

function DebtDealAnswer({ game, nameOf }: { game: GameState; nameOf: (id: string) => string }) {
  const dispatch = useStore((s) => s.dispatch);
  const d = game.debt!;
  const shares = Object.entries(d.offer!);
  const value = shares.reduce((a, [c, pct]) => a + companyById.get(c)!.pricePerPercent * pct, 0);
  const debtor = game.players.find((p) => p.id === d.debtorId)!;
  return (
    <div className="card highlight">
      <h3>Accord de dette</h3>
      <p>
        {nameOf(d.debtorId)} ne peut pas te payer et propose {shares.map(([c, pct]) => `${pct} % de ${companyById.get(c)!.name}`).join(", ")} pour effacer{" "}
        {money(Math.min(d.amount, -debtor.cash))} de dette.
      </p>
      <p className="offer-value">
        Valeur estimée des actions : <strong>{money(value)}</strong>
      </p>
      <div className="row">
        <button className="primary" onClick={() => dispatch({ type: "DEBT_DEAL_ANSWER", playerId: d.creditorId, accept: true })}>
          Accepter
        </button>
        <button onClick={() => dispatch({ type: "DEBT_DEAL_ANSWER", playerId: d.creditorId, accept: false })}>Refuser</button>
      </div>
    </div>
  );
}

// Lending: the borrower gives back a share of every income until the cap is reached
function LoanPanel({ game, you, nameOf }: { game: GameState; you: string; nameOf: (id: string) => string }) {
  const dispatch = useStore((s) => s.dispatch);
  const me = game.players.find((p) => p.id === you);
  const incoming = game.loanOffers.filter((o) => o.borrowerId === you);
  const sent = game.loanOffers.filter((o) => o.lenderId === you);
  const loans = game.loans.filter((l) => l.lenderId === you || l.borrowerId === you);
  if (!me || me.bankrupt || !(incoming.length || sent.length || loans.length)) return null;
  const cap = (n: number) => Math.ceil((n * config.loanCap) / 100);
  return (
    <details className="card" open={incoming.length > 0 || me.cash < 0}>
      <summary>Prêts{loans.length ? ` (${loans.length})` : ""}</summary>
      <p className="muted">
        L'emprunteur reverse {config.loanShare} % de tous ses revenus au prêteur jusqu'à lui avoir rendu {config.loanCap} % de la somme.
      </p>
      {incoming.map((o) => (
        <div key={o.lenderId} className="alliance-box">
          <span>
            <strong>{nameOf(o.lenderId)}</strong> te propose de te prêter {money(o.amount)}
          </span>
          <div className="row">
            <button className="primary" onClick={() => dispatch({ type: "LOAN_ANSWER", playerId: you, lenderId: o.lenderId, accept: true })}>
              Accepter
            </button>
            <button className="danger" onClick={() => dispatch({ type: "LOAN_ANSWER", playerId: you, lenderId: o.lenderId, accept: false })}>
              Refuser l'offre
            </button>
          </div>
        </div>
      ))}
      {loans.map((l, i) => (
        <div key={i} className="row loan">
          <span>{l.lenderId === you ? `Prêt à ${nameOf(l.borrowerId)}` : `Emprunt à ${nameOf(l.lenderId)}`}</span>
          <span className="spacer" />
          <small>
            {money(l.repaid)} / {money(cap(l.amount))}
          </small>
        </div>
      ))}
      {sent.length > 0 && <small className="muted">En attente : {sent.map((o) => `${nameOf(o.borrowerId)} (${money(o.amount)})`).join(", ")}</small>}
    </details>
  );
}

function SellForm({ game }: { game: GameState }) {
  const dispatch = useStore((s) => s.dispatch);
  const me = currentPlayer(game);
  const holdings = Object.keys(me.holdings);
  const [company, setCompany] = useState("");
  const [percent, setPercent] = useState(1);
  if (holdings.length === 0) return null;
  const co = holdings.includes(company) ? company : holdings[0]!;
  const value = Math.floor(companyById.get(co)!.pricePerPercent * percent * config.bankBuybackRatio);
  return (
    <details className="card">
      <summary>Revendre à la banque (75 % du prix)</summary>
      <select value={co} onChange={(e) => setCompany(e.target.value)}>
        {holdings.map((c) => (
          <option key={c} value={c}>
            {companyById.get(c)!.name} ({me.holdings[c]} %)
          </option>
        ))}
      </select>
      <input type="number" min={1} max={me.holdings[co]} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
      <button onClick={() => dispatch({ type: "SELL_TO_BANK", playerId: me.id, company: co, percent })}>Vendre pour {money(value)}</button>
    </details>
  );
}

function Countdown({ prefix = "Expire dans" }: { prefix?: string }) {
  const deadline = useStore((s) => s.room?.deadline ?? null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  if (!deadline) return null;
  return (
    <p className="timer">
      {prefix} {Math.max(0, Math.ceil((deadline - now) / 1000))} s
    </p>
  );
}

const ICONS: Partial<Record<GameEvent["kind"], string>> = { market: "📈", double: "🎲", jackpot: "🏦", roll: "🎲", actu: "📰", levee: "💰", ipo: "🔔", krach: "📉", lap: "🏁", atout: "⭐", royalty: "💸", buys: "🛒", auction: "⚖", bankrupt: "☠", win: "🏆", order: "🎲" };

function Signed({ amount }: { amount: number }) {
  return <span className={amount >= 0 ? "plus" : "minus"}>{amount >= 0 ? "+" : "-"}{money(Math.abs(amount))}</span>;
}

// Game journal: every event of the last turns, newest first, with who, where and how much
function Journal({ game, colorOf, nameOf }: { game: GameState; colorOf: (id: string) => string; nameOf: (id: string) => string }) {
  const name = (c: string) => companyById.get(c)!.name;
  const line = (e: GameEvent) => {
    switch (e.kind) {
      case "order":
        return <>Ordre de passage : {e.rolls.map((r) => `${nameOf(r.playerId)} (${r.dice[0] + r.dice[1]})`).join(", ")}</>;
      case "roll":
        return <>fait {e.dice[0]} + {e.dice[1]} = {e.dice[0] + e.dice[1]} et arrive à <b>{board[e.to]!.name}</b></>;
      case "royalty":
        return <>paie la redevance {name(e.company)} à {e.to.map(nameOf).join(" + ")} <Signed amount={-e.amount} /></>;
      case "buys": {
        const bought = e.items.map((it) => `${it.percent} % ${name(it.company)}`).join(", ");
        return (
          <>
            {bought ? <>achète {bought} ({money(e.items.reduce((t, it) => t + it.percent * companyById.get(it.company)!.pricePerPercent, 0))})</> : "n'achète rien"}
            {e.deals.map((d, i) => (
              <span key={i} className="journal-deal">
                {nameOf(d.sellerId)} vend {d.percent} % {name(d.company)} à {d.buyerId ? nameOf(d.buyerId) : "la banque"} pour {money(d.price)}
              </span>
            ))}
          </>
        );
      }
      case "auction":
        return e.cancelled ? (
          <>annule l'enchère sur {e.percent} % {name(e.company)} de {nameOf(e.sellerId)} avec un Atout</>
        ) : (
          <>
            lance une enchère sur {e.percent} % {name(e.company)} de {nameOf(e.sellerId)} :{" "}
            {e.winnerId ? <>adjugé à {nameOf(e.winnerId)} pour {money(e.price)}</> : "aucune offre"}
          </>
        );
      case "market":
        return <>passe le Départ en tête, la Bourse bouge : {markets.map((m) => `${m.name} ${e.market[m.id]! > 0 ? "+" : ""}${e.market[m.id]} %`).join(", ")}</>;
      case "bankrupt":
        return <>fait faillite</>;
      case "win":
        return <>remporte la partie</>;
      default:
        return (
          <>
            {e.text} <Signed amount={e.amount} /> <small>({money(e.after)})</small>
          </>
        );
    }
  };
  const events = [...game.events].reverse();
  return (
    <details className="card journal" open>
      <summary>Journal de la partie</summary>
      <div className="journal-list">
        {events.length === 0 && <p className="muted">Rien pour l'instant.</p>}
        {events.map((e) => (
          <div key={e.id} className="journal-row">
            <span className="journal-icon">{ICONS[e.kind]}</span>
            <div>
              {"playerId" in e && (
                <strong style={{ color: colorOf(e.playerId) }}>{nameOf(e.playerId)} </strong>
              )}
              {line(e)}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

// The stock exchange tower: this turn's royalty trend of each market, and the pot won with the jackpot card
// Next to the gear: a stonks arrow that opens the market trends
export function MarketButton({ game }: { game: GameState }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="market-float">
      <button className="options-btn market-btn" aria-label="Bourse" title="Bourse" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 18l6-6 4 4 8-8" />
          <path d="M15 8h6v6" />
        </svg>
      </button>
      {open && <Market game={game} />}
    </div>
  );
}

function Market({ game }: { game: GameState }) {
  const setInspect = useStore((s) => s.setInspect);
  return (
    <div className="card market">
      <div className="row">
        <h3>Bourse</h3>
        <span className="spacer" />
        <span className="pot" title="Amendes et taxes accumulées, gagnées avec la carte Délit d'initié">
          Cagnotte {money(game.pot)}
        </span>
      </div>
      <div className="market-list">
        {markets.map((m) => {
          const t = game.market[m.id] ?? 0;
          return (
            <button key={m.id} className={`trend ${t > 0 ? "up" : t < 0 ? "down" : ""}`} title={m.companies.map((c) => companyById.get(c)!.name).join(", ")} onClick={() => setInspect({ market: m.id })}>
              {m.name} {t > 0 ? "▲" : t < 0 ? "▼" : "="} {Math.abs(t)} %
            </button>
          );
        })}
      </div>
    </div>
  );
}
