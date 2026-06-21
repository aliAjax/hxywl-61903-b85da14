import { useMemo } from "react";
import { RoomType, getSymbol, GAME_CONSTANTS } from "../config/gameConfig";
import { Room, BattleState } from "../hooks/useNormalProgress";
import { RiskEstimate, getRiskIcon, getRiskColor } from "../config/riskEstimator";

const SYMBOLS: Record<RoomType, string> = {
  start: getSymbol("start"),
  coin: getSymbol("coin"),
  trap: getSymbol("trap"),
  monster: getSymbol("monster"),
  key: getSymbol("key"),
  exit: getSymbol("exit"),
  potion: getSymbol("potion"),
  empty: getSymbol("empty"),
};

interface GameBoardProps {
  board: Room[];
  revealAllRooms: boolean;
  flippable: Set<number>;
  safeRouteHintCells: Set<number>;
  frozenRouteHintRef: React.MutableRefObject<Set<number>>;
  battleState: BattleState;
  showSettlement: boolean;
  showRouteHint: boolean;
  showRiskHint: boolean;
  keys: number;
  canFlip: boolean;
  riskEstimates: RiskEstimate[];
  onFlip: (idx: number) => void;
}

export default function GameBoard({
  board,
  revealAllRooms,
  flippable,
  safeRouteHintCells,
  frozenRouteHintRef,
  battleState,
  showSettlement,
  showRouteHint,
  showRiskHint,
  keys,
  canFlip,
  riskEstimates,
  onFlip,
}: GameBoardProps) {
  const displayBoard = useMemo(() => {
    if (revealAllRooms) {
      return board.map((r) => ({ ...r, revealed: true }));
    }
    return board;
  }, [board, revealAllRooms]);

  return (
    <div className="board">
      {displayBoard.map((displayRoom: Room, idx: number) => {
        const room = board[idx];
        const isFlippable = flippable.has(idx) && !room.revealed;
        const hintCells = battleState !== "idle" || showSettlement
          ? frozenRouteHintRef.current
          : safeRouteHintCells;
        const isRouteHint = showRouteHint && hintCells.has(idx) && !room.revealed;
        const showFlippableHighlight = isFlippable && !showRouteHint;
        const canClickExit =
          room.revealed && room.type === "exit" && keys > 0 && canFlip;
        const isDefeated = displayRoom.type === "monster" && displayRoom.defeated;
        const isDisabled = !canFlip && !room.revealed;
        const risk = riskEstimates[idx];
        const showRisk = showRiskHint && !room.revealed && risk;
        const riskClass = showRisk ? `risk-level-${risk.level}` : "";
        return (
          <button
            key={idx}
            className={[
              "cell",
              displayRoom.type,
              displayRoom.revealed ? "revealed" : "",
              showFlippableHighlight ? "flippable" : "",
              isRouteHint ? "route-hint" : "",
              riskClass,
              canClickExit ? "can-exit" : "",
              isDefeated ? "defeated" : "",
              isDisabled ? "disabled" : "",
              revealAllRooms ? "debug-revealed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onFlip(idx)}
          >
            {displayRoom.revealed
              ? isDefeated
                ? "💀"
                : SYMBOLS[displayRoom.type as keyof typeof SYMBOLS]
              : showRisk
                ? <span className="risk-indicator">
                    <span className="risk-icon">{getRiskIcon(risk.level)}</span>
                    <span className="risk-dot" style={{ backgroundColor: getRiskColor(risk.level) }}></span>
                  </span>
                : "?"}
          </button>
        );
      })}
    </div>
  );
}
