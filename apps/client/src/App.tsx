import { EndStats } from "./EndStats";
import { DiceAdmin } from "./DiceAdmin";
import { AuctionScreen } from "./AuctionScreen";
import { Board } from "./Board";
import { Chat } from "./Chat";
import { GamePanel, MarketButton } from "./GamePanel";
import { Home } from "./Home";
import { CashHud, TurnBanner } from "./Hud";
import { InspectPanel } from "./Inspect";
import { Lobby } from "./Lobby";
import { EventOverlay } from "./Overlay";
import { STARTER_LOOKS } from "./format";
import { useBots } from "./bots";
import { useStore } from "./store";

export function App() {
  const { game, room, online, you } = useStore();
  useBots(game);
  if (online && room && !game) return <Lobby room={room} />;
  if (!game) return <Home />;
  return (
    <div className="layout">
      <div className="board-wrap">
        <Board game={game} looks={game.players.map((p, i) => room?.players.find((m) => m.id === p.id)?.look ?? STARTER_LOOKS[i % STARTER_LOOKS.length]!)} />
        <EventOverlay game={game} />
        <CashHud game={game} />
        <MarketButton game={game} />
        <TurnBanner game={game} />
        <AuctionScreen game={game} />
        <InspectPanel game={game} />
        <DiceAdmin game={game} />
        <EndStats game={game} />
        {online && room && you && <Chat room={room} you={you} />}
      </div>
      <GamePanel game={game} />
    </div>
  );
}
