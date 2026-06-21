import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  GAME_CONSTANTS,
  EVENT_CONFIG,
  BATTLE_CONFIG,
  EVENT_MESSAGES,
  RoomType,
  Monster,
  FloorConfig,
  getFloorConfig,
  generateMonster,
  getCoinReward,
  getDamage,
  getSymbol,
  shuffle,
  getNeighbors,
  getTotalCells,
  RouteType,
  ROUTE_CONFIGS,
  RouteConfig,
} from "./config/gameConfig";
import {
  verifyMap,
  printMapDebug,
  runSingleDiagIteration,
  compileDiagChunk,
  computeDiagOverview,
  GenerationResult,
  FloorDiagResult,
  DiagReport,
  DiagProgress,
} from "./config/mapGenerator";
import {
  MAX_SLOTS,
  LeaderboardEntry,
  loadLeaderboard,
  addLeaderboardEntry,
  clearLeaderboard,
} from "./config/saveSystem";
import {
  BattleLog,
  BattleState,
  GameStats,
  INITIAL_STATS,
  Room,
  TurnRecord,
  createBattleLog,
  createTurnRecord,
  generateBoard,
  getLastGenResult,
  useNormalProgress,
} from "./hooks/useNormalProgress";
import {
  estimateRoomRisks,
  getRiskColor,
  getRiskIcon,
  RiskEstimate,
} from "./config/riskEstimator";

const SIZE = GAME_CONSTANTS.boardSize;
const TOTAL = getTotalCells();
const MAX_HP = GAME_CONSTANTS.maxHp;
const HIGH_SCORE_KEY = GAME_CONSTANTS.highScoreKey;

type GameResultType = "clear" | "death" | "restart";

type LeaderboardSortKey = "time" | "floor" | "coins";

type HistoryFilter = "all" | "battle" | "trap" | "coin" | "item" | "floor";

interface FilterOption {
  key: HistoryFilter;
  label: string;
  icon: string;
  match: (rec: TurnRecord) => boolean;
}

const HISTORY_FILTERS: FilterOption[] = [
  { key: "all", label: "全部", icon: "📋", match: () => true },
  { key: "battle", label: "战斗", icon: "⚔️", match: (r) => r.roomType === "monster" },
  { key: "trap", label: "陷阱", icon: "⚡", match: (r) => r.roomType === "trap" },
  { key: "coin", label: "金币", icon: "💰", match: (r) => r.roomType === "coin" },
  { key: "item", label: "道具", icon: "🔑", match: (r) => r.roomType === "key" || r.roomType === "potion" },
  {
    key: "floor",
    label: "楼层",
    icon: "🚪",
    match: (r) =>
      r.roomType === "exit" ||
      r.roomType === "start" ||
      (!r.roomType && /^(🏠|⬆️|💾)/.test(r.event)),
  },
];

interface HighScore {
  maxFloor: number;
  maxCoins: number;
}

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

function loadHighScore(): HighScore {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        maxFloor: typeof parsed.maxFloor === "number" ? parsed.maxFloor : 1,
        maxCoins: typeof parsed.maxCoins === "number" ? parsed.maxCoins : 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { maxFloor: 1, maxCoins: 0 };
}

function saveHighScore(score: HighScore): void {
  try {
    localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(score));
  } catch {
    /* ignore */
  }
}

function evaluateGame(
  resultType: GameResultType,
  finalFloor: number,
  finalCoins: number,
  stats: GameStats,
  finalHp: number
): { rank: string; comment: string; stars: number } {
  const score =
    finalFloor * 100 +
    finalCoins * 2 +
    stats.revealedRooms * 1 +
    stats.monstersDefeated * 5 -
    stats.trapHits * 3 +
    finalHp * 10;

  let stars: number;
  let rank: string;
  let comment: string;

  if (resultType === "clear") {
    if (score >= 500) {
      stars = 5;
      rank = "传奇冒险家";
      comment = "完美的探索！你就是地牢之王！";
    } else if (score >= 350) {
      stars = 4;
      rank = "精英探险家";
      comment = "表现出色，地牢因你而颤抖！";
    } else if (score >= 200) {
      stars = 3;
      rank = "勇敢冒险者";
      comment = "干得不错，继续向更深层进发！";
    } else {
      stars = 2;
      rank = "新手探险家";
      comment = "顺利通关，下次尝试更高效的路线！";
    }
  } else if (resultType === "death") {
    if (score >= 400) {
      stars = 4;
      rank = "不屈战士";
      comment = "虽败犹荣！你的战绩令人敬佩！";
    } else if (score >= 250) {
      stars = 3;
      rank = "坚强斗士";
      comment = "战斗到了最后一刻，值得尊敬！";
    } else if (score >= 100) {
      stars = 2;
      rank = "冒险者";
      comment = "不要气馁，多积累经验再来挑战！";
    } else {
      stars = 1;
      rank = "探险学徒";
      comment = "下次小心陷阱和怪物，加油！";
    }
  } else {
    if (score >= 300) {
      stars = 3;
      rank = "策略家";
      comment = "主动撤退也是一种智慧，整装待发！";
    } else if (score >= 150) {
      stars = 2;
      rank = "谨慎探险者";
      comment = "见好就收，不失为明智之举！";
    } else {
      stars = 1;
      rank = "探索新手";
      comment = "下次尝试探索更多房间吧！";
    }
  }

  return { rank, comment, stars };
}

interface HighlightItem {
  icon: string;
  text: string;
  priority: number;
}

function generateHighlights(
  resultType: GameResultType,
  finalFloor: number,
  finalCoins: number,
  currentStats: GameStats,
  isFloorRecord: boolean,
  isCoinRecord: boolean
): HighlightItem[] {
  const candidates: HighlightItem[] = [];

  if (isFloorRecord && finalFloor > 1) {
    candidates.push({ icon: "🏆", text: `刷新纪录！到达 B${finalFloor}F`, priority: 100 });
  }
  if (isCoinRecord && finalCoins > 0) {
    candidates.push({ icon: "💰", text: `刷新纪录！获得 ${finalCoins} 金币`, priority: 95 });
  }
  if (resultType === "clear" && currentStats.trapHits === 0) {
    candidates.push({ icon: "✨", text: "完美闪避！全程未踩陷阱", priority: 85 });
  }
  if (currentStats.monstersDefeated >= 3) {
    candidates.push({ icon: "⚔️", text: `勇猛善战！击败 ${currentStats.monstersDefeated} 只怪物`, priority: 80 });
  } else if (currentStats.monstersDefeated > 0) {
    candidates.push({ icon: "⚔️", text: `击败了 ${currentStats.monstersDefeated} 只怪物`, priority: 50 });
  }
  if (currentStats.trapHits >= 3) {
    candidates.push({ icon: "⚡", text: `步履维艰！踩中 ${currentStats.trapHits} 次陷阱`, priority: 70 });
  } else if (currentStats.trapHits > 0) {
    candidates.push({ icon: "⚡", text: `踩中 ${currentStats.trapHits} 次陷阱`, priority: 40 });
  }
  if (currentStats.potionsUsed >= 2) {
    candidates.push({ icon: "🧪", text: `药水依赖！使用了 ${currentStats.potionsUsed} 次药水`, priority: 60 });
  } else if (currentStats.potionsUsed > 0) {
    candidates.push({ icon: "🧪", text: `使用了 ${currentStats.potionsUsed} 次药水`, priority: 35 });
  }
  if (currentStats.fleeCount >= 2) {
    candidates.push({ icon: "🏃", text: `战术撤退！逃跑了 ${currentStats.fleeCount} 次`, priority: 55 });
  } else if (currentStats.fleeCount > 0) {
    candidates.push({ icon: "🏃", text: `逃跑了 ${currentStats.fleeCount} 次`, priority: 30 });
  }
  if (currentStats.revealedRooms >= 20) {
    candidates.push({ icon: "🗺️", text: `探索达人！翻开了 ${currentStats.revealedRooms} 间房`, priority: 45 });
  } else if (currentStats.revealedRooms >= 5) {
    candidates.push({ icon: "🗺️", text: `探索了 ${currentStats.revealedRooms} 间房`, priority: 25 });
  }

  if (candidates.length < 3 && finalFloor > 1) {
    candidates.push({ icon: "🏰", text: `到达了 B${finalFloor}F`, priority: 20 });
  }
  if (candidates.length < 3 && finalCoins > 0) {
    candidates.push({ icon: "💰", text: `收集了 ${finalCoins} 金币`, priority: 15 });
  }
  if (candidates.length < 3) {
    if (resultType === "clear") {
      candidates.push({ icon: "🎉", text: "成功通关本层！", priority: 18 });
    } else if (resultType === "death") {
      candidates.push({ icon: "💀", text: "在战斗中倒下了...", priority: 18 });
    } else {
      candidates.push({ icon: "🗺️", text: `翻开了 ${currentStats.revealedRooms} 间房`, priority: 10 });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, 3);
}

export default function App() {
  const [showSettlement, setShowSettlement] = useState(false);
  const [settlementResult, setSettlementResult] = useState<GameResultType | null>(null);
  const [highScore, setHighScore] = useState<HighScore>(() => loadHighScore());
  const {
    board,
    setBoard,
    hp,
    setHp,
    coins,
    setCoins,
    keys,
    setKeys,
    potions,
    setPotions,
    floor,
    status,
    setStatus,
    turn,
    setTurn,
    stats,
    setStats,
    battleState,
    setBattleState,
    currentMonster,
    setCurrentMonster,
    battleLog,
    setBattleLog,
    battleRoomIdx,
    setBattleRoomIdx,
    history,
    setHistory,
    showRouteHint,
    setShowRouteHint,
    showRiskHint,
    setShowRiskHint,
    playerCharging,
    setPlayerCharging,
    currentRoute,
    showRouteSelect,
    setShowRouteSelect,
    showSlotPanel,
    setShowSlotPanel,
    slotList,
    resetProgress,
    nextFloor,
    confirmRouteAndNextFloor,
    saveToSlot,
    loadFromSlot,
    deleteSaveSlot,
    openSlotPanel,
    dispatchEvent,
    eventStore,
    verifyStateConsistency,
    getReconstructedState,
    reconstructionError,
  } = useNormalProgress({ showSettlement });
  const [brokeFloorRecord, setBrokeFloorRecord] = useState(false);
  const [brokeCoinRecord, setBrokeCoinRecord] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [revealAllRooms, setRevealAllRooms] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [diagFloorFrom, setDiagFloorFrom] = useState(1);
  const [diagFloorTo, setDiagFloorTo] = useState(10);
  const [diagIterations, setDiagIterations] = useState(50);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagProgress, setDiagProgress] = useState<DiagProgress | null>(null);
  const [diagReport, setDiagReport] = useState<DiagReport | null>(null);
  const [diagExpandedFloor, setDiagExpandedFloor] = useState<number | null>(null);
  const [diagViewMode, setDiagViewMode] = useState<"overview" | "detail">("overview");
  const diagRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => loadLeaderboard());
  const [leaderboardSort, setLeaderboardSort] = useState<LeaderboardSortKey>("time");

  const frozenRouteHintRef = useRef<Set<number>>(new Set());

  const flippable = useMemo(() => {
    if (battleState !== "idle") return new Set<number>();
    const set = new Set<number>();
    for (let i = 0; i < TOTAL; i++) {
      if (board[i].revealed) {
        for (const n of getNeighbors(i)) {
          if (!board[n].revealed) set.add(n);
        }
      }
    }
    return set;
  }, [board, battleState]);

  const safeRouteHintCells = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < TOTAL; i++) {
      if (board[i].revealed) {
        for (const n of getNeighbors(i)) {
          if (!board[n].revealed) {
            const t = board[n].type;
            if (t !== "trap" && t !== "monster") {
              set.add(n);
            }
          }
        }
      }
    }
    return set;
  }, [board]);

  useEffect(() => {
    if (battleState === "idle" && !showSettlement) {
      frozenRouteHintRef.current = new Set(safeRouteHintCells);
    }
  }, [safeRouteHintCells, battleState, showSettlement]);

  const exitRevealed = useMemo(
    () => board.some((r: Room) => r.type === "exit" && r.revealed),
    [board]
  );

  const canUsePotion = status === "playing" && !showSettlement && potions > 0 && hp < MAX_HP;
  const canGoNextFloor = status === "won" && !showSettlement && exitRevealed && keys > 0;
  const canRestart = !showSettlement;
  const canFlip = status === "playing" && !showSettlement && battleState === "idle";

  const triggerSettlement = useCallback(
    (resultType: GameResultType, currentFloor: number, currentCoins: number, currentStats: GameStats, currentHp: number) => {
      const isFloorRecord = currentFloor > highScore.maxFloor;
      const isCoinRecord = currentCoins > highScore.maxCoins;
      setBrokeFloorRecord(isFloorRecord);
      setBrokeCoinRecord(isCoinRecord);
      const newHighScore: HighScore = { ...highScore };
      let updated = false;
      if (isFloorRecord) {
        newHighScore.maxFloor = currentFloor;
        updated = true;
      }
      if (isCoinRecord) {
        newHighScore.maxCoins = currentCoins;
        updated = true;
      }
      if (updated) {
        setHighScore(newHighScore);
        saveHighScore(newHighScore);
      }
      const evaluation = evaluateGame(resultType, currentFloor, currentCoins, currentStats, currentHp);
      const updatedLeaderboard = addLeaderboardEntry({
        resultType,
        floor: currentFloor,
        coins: currentCoins,
        revealedRooms: currentStats.revealedRooms,
        trapHits: currentStats.trapHits,
        monstersDefeated: currentStats.monstersDefeated,
        stars: evaluation.stars,
        rank: evaluation.rank,
      });
      setLeaderboard(updatedLeaderboard);
      setSettlementResult(resultType);
      setShowSettlement(true);

      dispatchEvent({
        type: "SETTLEMENT",
        resultType,
        finalFloor: currentFloor,
        finalCoins: currentCoins,
        finalHp: currentHp,
        stats: { ...currentStats },
        brokeFloorRecord: isFloorRecord,
        brokeCoinRecord: isCoinRecord,
      });
    },
    [highScore, dispatchEvent]
  );

  const flip = useCallback(
    (idx: number) => {
      if (!canFlip) return;
      const room = board[idx];
      if (room.revealed) {
        if (room.type === "exit" && keys > 0) {
          setStatus("won");
          const nextTurn = turn + 1;
          setTurn(nextTurn);
          dispatchEvent({ type: "EXIT_WITH_KEY" });
          setHistory((prev: TurnRecord[]) => [
            createTurnRecord({
              turn: nextTurn,
              floor,
              event: EVENT_MESSAGES.exitWithKey,
              roomType: "exit",
              hpDelta: 0,
              coinDelta: 0,
              items: [],
            }),
            ...prev,
          ]);
        }
        return;
      }
      if (!flippable.has(idx)) return;

      const records: TurnRecord[] = [];
      const nextTurn = turn + 1;
      let newHp = hp;
      let newCoins = coins;
      let newKeys = keys;
      let newPotions = potions;
      let newStatus: "playing" | "won" | "lost" = "playing";
      const newStats: GameStats = { ...stats, revealedRooms: stats.revealedRooms + 1 };

      if (room.type === "monster") {
        const monster = generateMonster(floor, currentRoute);
        setBoard((prev: Room[]) =>
          prev.map((r: Room, i: number) => (i === idx ? { ...r, revealed: true } : r))
        );
        setTurn(nextTurn);
        setStats(newStats);
        setCurrentMonster(monster);
        setBattleRoomIdx(idx);
        setBattleState("fighting");
        setPlayerCharging(false);
        setBattleLog([
          createBattleLog(`遭遇了 ${monster.icon} ${monster.name}！`, "system"),
          createBattleLog(`怪物HP: ${monster.hp}/${monster.maxHp}，攻击力: ${monster.attack}`, "system"),
        ]);
        dispatchEvent({
          type: "ROOM_FLIP",
          idx,
          roomType: room.type,
          hpDelta: 0,
          coinDelta: 0,
          keyDelta: 0,
          potionDelta: 0,
          trapHit: false,
          monster,
          statusAfter: "playing",
        });
        setHistory((prev: TurnRecord[]) => [
          createTurnRecord({
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.monsterEncounterShort(monster),
            roomType: "monster",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          }),
          ...prev,
        ]);
        return;
      }

      const dmg = getDamage(room.type);
      if (dmg > 0) {
        newHp = Math.max(0, hp - dmg);
        if (room.type === "trap") {
          newStats.trapHits = stats.trapHits + 1;
        }
        records.push(createTurnRecord({
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.trapHit(dmg),
          roomType: room.type,
          hpDelta: -dmg,
          coinDelta: 0,
          items: [],
        }));
        if (newHp <= 0) {
          newStatus = "lost";
          records.push(createTurnRecord({
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.death,
            roomType: room.type,
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          }));
          setTimeout(() => {
            triggerSettlement("death", floor, newCoins, newStats, newHp);
          }, 100);
        }
      } else if (room.type === "coin") {
        const gain = getCoinReward(floor, currentRoute);
        newCoins = coins + gain;
        records.push(createTurnRecord({
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.coinFound(gain, floor),
          roomType: "coin",
          hpDelta: 0,
          coinDelta: gain,
          items: [],
        }));
      } else if (room.type === "key") {
        newKeys = keys + 1;
        records.push(createTurnRecord({
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.keyFound,
          roomType: "key",
          hpDelta: 0,
          coinDelta: 0,
          items: ["🔑 钥匙"],
        }));
        if (exitRevealed) {
          newStatus = "won";
          records.push(createTurnRecord({
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.exitWithKey,
            roomType: "exit",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          }));
        }
      } else if (room.type === "potion") {
        newPotions = potions + 1;
        records.push(createTurnRecord({
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.potionFound,
          roomType: "potion",
          hpDelta: 0,
          coinDelta: 0,
          items: ["🧪 药水"],
        }));
      } else if (room.type === "exit") {
        if (keys > 0) {
          newStatus = "won";
          records.push(createTurnRecord({
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.exitWithKey,
            roomType: "exit",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          }));
        } else {
          records.push(createTurnRecord({
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.exitNoKey,
            roomType: "exit",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          }));
        }
      } else if (room.type === "empty") {
        records.push(createTurnRecord({
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.emptyRoom,
          roomType: "empty",
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        }));
      }

      setBoard((prev: Room[]) =>
        prev.map((r: Room, i: number) => (i === idx ? { ...r, revealed: true } : r))
      );
      setHp(newHp);
      setCoins(newCoins);
      setKeys(newKeys);
      setPotions(newPotions);
      setStatus(newStatus);
      setTurn(nextTurn);
      setStats(newStats);
      dispatchEvent({
        type: "ROOM_FLIP",
        idx,
        roomType: room.type,
        hpDelta: newHp - hp,
        coinDelta: newCoins - coins,
        keyDelta: newKeys - keys,
        potionDelta: newPotions - potions,
        trapHit: room.type === "trap" && getDamage(room.type) > 0,
        statusAfter: newStatus,
      });
      setHistory((prev: TurnRecord[]) => [...records, ...prev]);
    },
    [board, hp, coins, keys, potions, status, flippable, exitRevealed, turn, floor, stats, triggerSettlement, canFlip, dispatchEvent]
  );

  const handleRestart = useCallback(() => {
    let resultType: GameResultType;
    if (status === "won") {
      resultType = "clear";
    } else {
      resultType = "restart";
    }
    triggerSettlement(resultType, floor, coins, stats, hp);
  }, [status, floor, coins, stats, hp, triggerSettlement]);

  const doResetGame = useCallback(() => {
    resetProgress();
    setShowSettlement(false);
    setSettlementResult(null);
    setBrokeFloorRecord(false);
    setBrokeCoinRecord(false);
  }, [resetProgress]);

  const usePotion = useCallback(() => {
    if (status !== "playing") {
      setHistory((prev: TurnRecord[]) => [
        createTurnRecord({
          turn,
          floor,
          event: "❌ 游戏未进行中，无法使用药水",
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        }),
        ...prev,
      ]);
      return;
    }
    if (potions <= 0) {
      setHistory((prev: TurnRecord[]) => [
        createTurnRecord({
          turn,
          floor,
          event: EVENT_MESSAGES.noPotionLog,
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        }),
        ...prev,
      ]);
      return;
    }
    if (hp >= MAX_HP) {
      setHistory((prev: TurnRecord[]) => [
        createTurnRecord({
          turn,
          floor,
          event: EVENT_MESSAGES.hpFullLog,
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        }),
        ...prev,
      ]);
      return;
    }
    const healAmount = EVENT_CONFIG.potion.healAmount ?? BATTLE_CONFIG.potionHeal;
    setPotions((p: number) => p - 1);
    setHp((h: number) => Math.min(MAX_HP, h + healAmount));
    setStats((s: GameStats) => ({ ...s, potionsUsed: s.potionsUsed + 1 }));
    dispatchEvent({
      type: "HEAL",
      healAmount,
      playerHpAfter: Math.min(MAX_HP, hp + healAmount),
      potionsAfter: potions - 1,
    });
    setHistory((prev: TurnRecord[]) => [
      createTurnRecord({
        turn,
        floor,
        event: EVENT_MESSAGES.potionUse(healAmount),
        hpDelta: healAmount,
        coinDelta: 0,
        items: [],
      }),
      ...prev,
    ]);
  }, [potions, hp, status, turn, floor, dispatchEvent]);

  const endBattle = useCallback(
    (result: "won" | "lost" | "fled", finalMonster: Monster | null, settleDelay: number = 1200, fleeDamage: number = BATTLE_CONFIG.fleeSuccessDamage) => {
      let finalCoins = coins;
      let finalStats = stats;
      let finalHp = hp;
      let finalFleeDamage = 0;

      setBattleState(result);
      setPlayerCharging(false);

      if (result === "won" && finalMonster) {
        const gotPotion = Math.random() < finalMonster.potionDropChance;
        if (gotPotion) {
          setPotions((p) => p + 1);
        }
        finalCoins = coins + finalMonster.coinReward;
        finalStats = { ...stats, monstersDefeated: stats.monstersDefeated + 1 };
        setCoins(finalCoins);
        setStats(finalStats);
        setBoard((prev: Room[]) =>
          prev.map((r: Room, i: number) =>
            i === battleRoomIdx ? { ...r, defeated: true } : r
          )
        );
        setBattleLog((prev) => [
          ...prev,
          createBattleLog(
            EVENT_MESSAGES.battleReward(finalMonster.coinReward, gotPotion),
            "reward"
          ),
        ]);
        dispatchEvent({
          type: "BATTLE_WON",
          coinReward: finalMonster.coinReward,
          gotPotion,
          roomIdx: battleRoomIdx,
        });
        setHistory((prev: TurnRecord[]) => [
          createTurnRecord({
            turn,
            floor,
            event: EVENT_MESSAGES.monsterDefeated(finalMonster, gotPotion),
            roomType: "monster",
            hpDelta: 0,
            coinDelta: finalMonster.coinReward,
            items: gotPotion ? ["🧪 药水"] : [],
          }),
          ...prev,
        ]);
      } else if (result === "fled") {
        finalFleeDamage = fleeDamage;
        finalHp = Math.max(0, hp - finalFleeDamage);
        finalStats = { ...stats, fleeCount: stats.fleeCount + 1 };
        setHp(finalHp);
        setStats(finalStats);
        setBoard((prev: Room[]) =>
          prev.map((r: Room, i: number) =>
            i === battleRoomIdx ? { ...r, revealed: false, defeated: false } : r
          )
        );
        setBattleLog((prev) => [
          ...prev,
          createBattleLog(EVENT_MESSAGES.roomResetLog, "system"),
        ]);
        dispatchEvent({
          type: "BATTLE_FLED",
          fleeDamage: finalFleeDamage,
          playerHpAfter: finalHp,
          roomIdx: battleRoomIdx,
          playerDied: finalHp <= 0,
        });
        setHistory((prev: TurnRecord[]) => [
          createTurnRecord({
            turn,
            floor,
            event: EVENT_MESSAGES.flee(finalFleeDamage),
            roomType: "monster",
            hpDelta: -finalFleeDamage,
            coinDelta: 0,
            items: [],
          }),
          ...prev,
        ]);
        if (finalHp <= 0) {
          setStatus("lost");
          setBattleLog((prev) => [
            ...prev,
            createBattleLog(EVENT_MESSAGES.playerDeathLog, "system"),
          ]);
          setTimeout(() => {
            setBattleState("idle");
            setCurrentMonster(null);
            setBattleLog([]);
            setBattleRoomIdx(-1);
            triggerSettlement("death", floor, finalCoins, finalStats, 0);
          }, settleDelay);
          return;
        }
      } else if (result === "lost") {
        finalHp = 0;
        setHp(0);
        setStatus("lost");
        dispatchEvent({
          type: "BATTLE_LOST",
          roomIdx: battleRoomIdx,
        });
        setHistory((prev: TurnRecord[]) => [
          createTurnRecord({
            turn,
            floor,
            event: EVENT_MESSAGES.monsterKilledPlayer(finalMonster),
            roomType: "monster",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          }),
          ...prev,
        ]);
        setTimeout(() => {
          setBattleState("idle");
          setCurrentMonster(null);
          setBattleLog([]);
          setBattleRoomIdx(-1);
          triggerSettlement("death", floor, finalCoins, finalStats, finalHp);
        }, settleDelay);
      }
    },
    [battleRoomIdx, turn, floor, coins, stats, hp, triggerSettlement, dispatchEvent]
  );

  const battleAttack = useCallback(() => {
    if (battleState !== "fighting" || !currentMonster) return;

    let baseDamage = BATTLE_CONFIG.playerDamageMin + Math.floor(Math.random() * (BATTLE_CONFIG.playerDamageMax - BATTLE_CONFIG.playerDamageMin + 1));
    let playerDamage = baseDamage;
    const newLogs: BattleLog[] = [];

    if (playerCharging) {
      playerDamage = baseDamage * BATTLE_CONFIG.chargeDamageMultiplier;
      newLogs.push(createBattleLog(EVENT_MESSAGES.playerChargeReleaseLog(BATTLE_CONFIG.chargeDamageMultiplier), "player"));
      newLogs.push(createBattleLog(EVENT_MESSAGES.playerChargedAttack(playerDamage), "player"));
      setPlayerCharging(false);
    } else {
      newLogs.push(createBattleLog(EVENT_MESSAGES.playerAttack(playerDamage), "player"));
    }

    const newMonsterHp = Math.max(0, currentMonster.hp - playerDamage);
    const updatedMonster = { ...currentMonster, hp: newMonsterHp };

    if (newMonsterHp <= 0) {
      newLogs.push(createBattleLog(EVENT_MESSAGES.monsterDefeatedLog(currentMonster), "system"));
      setCurrentMonster(updatedMonster);
      setBattleLog((prev) => [...prev, ...newLogs]);
      dispatchEvent({
        type: "BATTLE_ATTACK",
        damage: playerDamage,
        charged: playerCharging,
        monsterHpAfter: newMonsterHp,
        monsterDamage: 0,
        playerHpAfter: hp,
        monsterDefeated: true,
      });
      setTimeout(() => {
        endBattle("won", updatedMonster);
      }, 600);
      return;
    }

    const monsterDamage = currentMonster.attack;
    newLogs.push(
      createBattleLog(EVENT_MESSAGES.monsterAttack(currentMonster, monsterDamage), "monster")
    );

    setCurrentMonster(updatedMonster);
    setBattleLog((prev) => [...prev, ...newLogs]);
    setHp((h) => {
      const newHp = Math.max(0, h - monsterDamage);
      dispatchEvent({
        type: "BATTLE_ATTACK",
        damage: playerDamage,
        charged: playerCharging,
        monsterHpAfter: newMonsterHp,
        monsterDamage,
        playerHpAfter: newHp,
        monsterDefeated: false,
      });
      if (newHp <= 0) {
        setTimeout(() => {
          endBattle("lost", updatedMonster, 1500);
        }, 500);
      }
      return newHp;
    });
  }, [battleState, currentMonster, endBattle, playerCharging, hp, dispatchEvent]);

  const battleCharge = useCallback(() => {
    if (battleState !== "fighting" || !currentMonster) return;

    if (playerCharging) {
      setBattleLog((prev) => [
        ...prev,
        createBattleLog("❌ 你已经在蓄力中了！", "system"),
      ]);
      return;
    }

    setPlayerCharging(true);

    const newLogs: BattleLog[] = [
      createBattleLog(EVENT_MESSAGES.playerChargeLog, "player"),
    ];

    const monsterDamage = currentMonster.attack;
    newLogs.push(
      createBattleLog(EVENT_MESSAGES.monsterAttack(currentMonster, monsterDamage), "monster")
    );

    setBattleLog((prev) => [...prev, ...newLogs]);
    setHp((h) => {
      const newHp = Math.max(0, h - monsterDamage);
      dispatchEvent({
        type: "BATTLE_CHARGE",
        monsterDamage,
        playerHpAfter: newHp,
        playerDied: newHp <= 0,
      });
      if (newHp <= 0) {
        setTimeout(() => {
          endBattle("lost", currentMonster, 1500);
        }, 500);
      }
      return newHp;
    });
  }, [battleState, currentMonster, endBattle, playerCharging, dispatchEvent]);

  const battleUsePotion = useCallback(() => {
    if (battleState !== "fighting") return;
    if (potions <= 0) {
      setBattleLog((prev) => [
        ...prev,
        createBattleLog(EVENT_MESSAGES.noPotionLog, "system"),
      ]);
      return;
    }
    if (hp >= MAX_HP) {
      setBattleLog((prev) => [
        ...prev,
        createBattleLog(EVENT_MESSAGES.hpFullLog, "system"),
      ]);
      return;
    }
    const healAmount = EVENT_CONFIG.potion.healAmount ?? BATTLE_CONFIG.potionHeal;
    setPotions((p) => p - 1);
    setHp((h) => Math.min(MAX_HP, h + healAmount));
    setStats((s: GameStats) => ({ ...s, potionsUsed: s.potionsUsed + 1 }));
    dispatchEvent({
      type: "BATTLE_HEAL",
      healAmount,
      playerHpAfter: Math.min(MAX_HP, hp + healAmount),
      potionsAfter: potions - 1,
    });
    setBattleLog((prev) => [
      ...prev,
      createBattleLog(EVENT_MESSAGES.potionUse(healAmount), "player"),
    ]);
  }, [battleState, potions, hp, dispatchEvent]);

  const battleFlee = useCallback(() => {
    if (battleState !== "fighting") return;
    const fleeSuccess = Math.random() < BATTLE_CONFIG.fleeSuccessRate;
    const fleeDamage = fleeSuccess ? BATTLE_CONFIG.fleeSuccessDamage : (currentMonster ? currentMonster.attack : BATTLE_CONFIG.fleeSuccessDamage);
    dispatchEvent({
      type: "BATTLE_FLEE",
      success: fleeSuccess,
      fleeDamage,
      playerHpAfter: Math.max(0, hp - fleeDamage),
      playerDied: hp - fleeDamage <= 0,
    });
    if (fleeSuccess) {
      setBattleLog((prev) => [
        ...prev,
        createBattleLog(EVENT_MESSAGES.fleeAttemptLog, "player"),
        createBattleLog(EVENT_MESSAGES.fleeSuccessLog(fleeDamage), "system"),
      ]);
      setTimeout(() => {
        endBattle("fled", currentMonster, 1200, fleeDamage);
      }, 600);
    } else {
      setBattleLog((prev) => [
        ...prev,
        createBattleLog(EVENT_MESSAGES.fleeAttemptLog, "player"),
        createBattleLog(EVENT_MESSAGES.fleeFailLog(fleeDamage), "monster"),
      ]);
      const nextHp = hp - fleeDamage;
      if (nextHp <= 0) {
        setTimeout(() => {
          endBattle("lost", currentMonster, 1500);
        }, 500);
      } else {
        setTimeout(() => {
          endBattle("fled", currentMonster, 1200, fleeDamage);
        }, 600);
      }
    }
  }, [battleState, currentMonster, endBattle, hp, dispatchEvent]);

  const closeBattle = useCallback(() => {
    if (battleState === "fighting") return;
    dispatchEvent({ type: "BATTLE_CLOSE" });
    setBattleState("idle");
    setCurrentMonster(null);
    setBattleLog([]);
    setBattleRoomIdx(-1);
    setPlayerCharging(false);
  }, [battleState, dispatchEvent]);

  const settlementData = useMemo(() => {
    if (!showSettlement || !settlementResult) return null;
    const evaluation = evaluateGame(settlementResult, floor, coins, stats, hp);
    const resultTitle =
      settlementResult === "clear"
        ? "🏆 完美通关"
        : settlementResult === "death"
          ? "💀 探索失败"
          : "🏃 主动结束";
    const highlights = generateHighlights(
      settlementResult,
      floor,
      coins,
      stats,
      brokeFloorRecord,
      brokeCoinRecord
    );
    return {
      evaluation,
      resultTitle,
      isFloorRecord: brokeFloorRecord,
      isCoinRecord: brokeCoinRecord,
      highlights,
    };
  }, [showSettlement, settlementResult, floor, coins, stats, hp, brokeFloorRecord, brokeCoinRecord]);

  const sortedLeaderboard = useMemo(() => {
    const copy = [...leaderboard];
    switch (leaderboardSort) {
      case "floor":
        return copy.sort((a, b) => b.floor - a.floor || b.coins - a.coins || b.timestamp - a.timestamp);
      case "coins":
        return copy.sort((a, b) => b.coins - a.coins || b.floor - a.floor || b.timestamp - a.timestamp);
      case "time":
      default:
        return copy.sort((a, b) => b.timestamp - a.timestamp);
    }
  }, [leaderboard, leaderboardSort]);

  const handleClearLeaderboard = useCallback(() => {
    if (window.confirm("确定要清空所有排行榜记录吗？此操作不可撤销。")) {
      clearLeaderboard();
      setLeaderboard([]);
    }
  }, []);

  const addDebugLog = useCallback((msg: string) => {
    setDebugLog((prev) => [msg, ...prev].slice(0, 50));
  }, []);

  const runReconstructionCheck = useCallback(() => {
    const verification = verifyStateConsistency();
    if (verification.valid) {
      addDebugLog(`✅ 状态重构验证通过！事件数量: ${getReconstructedState ? getReconstructedState().turn : "N/A"}`);
    } else {
      addDebugLog(`❌ 状态重构验证失败: ${verification.mismatches.length} 处不一致`);
      verification.mismatches.forEach((m: string) => addDebugLog(`  - ${m}`));
    }
  }, [verifyStateConsistency, getReconstructedState, addDebugLog]);

  const showEventHistory = useCallback(() => {
    const reconstructed = getReconstructedState();
    addDebugLog(`===== 事件历史 =====`);
    addDebugLog(`总事件数: ${reconstructed.turn}`);
    addDebugLog(`当前楼层: B${reconstructed.floor}F`);
    addDebugLog(`当前血量: ${reconstructed.hp}/${GAME_CONSTANTS.maxHp}`);
    addDebugLog(`当前金币: ${reconstructed.coins}`);
    addDebugLog(`当前状态: ${reconstructed.status}`);
  }, [getReconstructedState, addDebugLog]);

  const showFloorProgress = useCallback(() => {
    const store = eventStore.current;
    if (!store) return;
    const currentFloor = store.getCurrentFloor();
    const totalFloors = store.getTotalFloors();
    const progress = store.getCurrentFloorProgress();

    addDebugLog(`===== 楼层进度 =====`);
    addDebugLog(`总楼层数: ${totalFloors}`);
    addDebugLog(`当前楼层: B${currentFloor}F`);

    if (progress) {
      addDebugLog(`已揭示房间: ${progress.revealedRooms}/${progress.totalRooms}`);
      addDebugLog(`击败怪物: ${progress.defeatedMonsters}`);
      addDebugLog(`陷阱触发: ${progress.trapHits}`);
      addDebugLog(`血量变化: ${progress.hpStart} → ${progress.hpEnd}`);
      addDebugLog(`金币变化: ${progress.coinsStart} → ${progress.coinsEnd}`);
      addDebugLog(`药水获得: ${progress.potionsGained}, 药水使用: ${progress.potionsUsed}`);
      addDebugLog(`钥匙获得: ${progress.keysGained}`);
      addDebugLog(`楼层状态: ${progress.status}`);
    }

    for (let f = 1; f <= totalFloors; f++) {
      const floorEvents = store.getFloorEvents(f);
      addDebugLog(`  B${f}F: ${floorEvents.length} 个事件`);
    }
  }, [addDebugLog]);

  const verifyCurrentMap = useCallback(() => {
    const cfg = getFloorConfig(floor, currentRoute);
    const roomTypes = board.map((r) => r.type);
    const result = verifyMap(roomTypes, cfg.pathMaxDamage);
    addDebugLog(`验证结果: ${result.valid ? "✅ 通过" : "❌ 失败"}`);
    if (result.issues.length > 0) {
      result.issues.forEach((issue) => addDebugLog(`  - ${issue}`));
    }
    addDebugLog(`路径伤害: 起点→钥匙=${result.safePath ? "有" : "无"}`);
  }, [board, floor, currentRoute, addDebugLog]);

  const printDebugMap = useCallback(() => {
    const roomTypes = board.map((r) => r.type);
    const mapStr = printMapDebug(roomTypes, { showPath: true, showDamage: true });
    addDebugLog("===== 地图布局 =====");
    mapStr.split("\n").forEach((line) => addDebugLog(line));
  }, [board, addDebugLog]);

  const regenMap = useCallback(() => {
    const newBoard = generateBoard(floor, currentRoute);
    setBoard(newBoard);
    addDebugLog(`重新生成地图 (B${floor}F)`);
  }, [floor, currentRoute, addDebugLog]);

  const toggleRevealAll = useCallback(() => {
    setRevealAllRooms((prev) => !prev);
    addDebugLog(!revealAllRooms ? "已显示所有房间（调试）" : "已隐藏所有房间（调试）");
  }, [revealAllRooms, addDebugLog]);

  const startDiagRun = useCallback(() => {
    if (diagRunning) return;
    const from = Math.max(1, diagFloorFrom);
    const to = Math.max(from, diagFloorTo);
    const iters = Math.max(1, Math.min(500, diagIterations));
    const totalFloors = to - from + 1;
    const route = currentRoute;

    diagRef.current = { cancelled: false };
    setDiagRunning(true);
    setDiagReport(null);
    setDiagExpandedFloor(null);
    setDiagProgress({
      currentFloor: from,
      currentIteration: 0,
      totalFloors,
      iterationsPerFloor: iters,
      done: false,
    });

    const startTime = Date.now();
    const allResults: FloorDiagResult[] = [];
    let currentFloorIdx = 0;

    const scheduleWork = (fn: () => void) => {
      if (typeof requestIdleCallback !== "undefined") {
        const handle = requestIdleCallback(
          () => {
            fn();
          },
          { timeout: 50 }
        );
        return () => cancelIdleCallback(handle);
      } else {
        const handle = setTimeout(fn, 0);
        return () => clearTimeout(handle);
      }
    };

    let cancelScheduled: (() => void) | null = null;

    const processFloor = () => {
      if (diagRef.current.cancelled) {
        setDiagRunning(false);
        setDiagProgress((p) => (p ? { ...p, done: true } : null));
        return;
      }

      const floor = from + currentFloorIdx;
      const chunkResults: GenerationResult[] = [];
      let iterDone = 0;

      const processBatch = () => {
        if (diagRef.current.cancelled) {
          setDiagRunning(false);
          return;
        }
        const batchSize = Math.min(3, iters - iterDone);
        let batchDone = 0;
        try {
          while (batchDone < batchSize && iterDone < iters) {
            chunkResults.push(runSingleDiagIteration(floor, route));
            iterDone++;
            batchDone++;
          }
        } catch (e) {
          // ignore
        }

        setDiagProgress({
          currentFloor: floor,
          currentIteration: iterDone,
          totalFloors,
          iterationsPerFloor: iters,
          done: false,
        });

        if (iterDone < iters) {
          cancelScheduled = scheduleWork(processBatch);
        } else {
          allResults.push(compileDiagChunk(floor, route, chunkResults, iters));
          currentFloorIdx++;
          if (currentFloorIdx < totalFloors) {
            cancelScheduled = scheduleWork(processFloor);
          } else {
            const totalIters = totalFloors * iters;
            setDiagReport({
              floors: allResults,
              totalIterations: totalIters,
              elapsed: Date.now() - startTime,
              overview: computeDiagOverview(allResults, totalIters),
            });
            setDiagProgress((p) => (p ? { ...p, done: true } : null));
            setDiagRunning(false);
          }
        }
      };

      processBatch();
    };

    processFloor();
  }, [diagRunning, diagFloorFrom, diagFloorTo, diagIterations, currentRoute]);

  const cancelDiagRun = useCallback(() => {
    diagRef.current.cancelled = true;
  }, []);

  const displayBoard = useMemo(() => {
    if (revealAllRooms) {
      return board.map((r) => ({ ...r, revealed: true }));
    }
    return board;
  }, [board, revealAllRooms]);

  const activeFilter = useMemo(
    () => HISTORY_FILTERS.find((f) => f.key === historyFilter) ?? HISTORY_FILTERS[0],
    [historyFilter]
  );

  const filteredHistory = useMemo(
    () => (historyFilter === "all" ? history : history.filter((r) => activeFilter.match(r))),
    [history, historyFilter, activeFilter]
  );

  const floorCfg: FloorConfig = getFloorConfig(floor, currentRoute);
  const currentRouteCfg: RouteConfig | null = currentRoute ? ROUTE_CONFIGS[currentRoute] : null;

  const riskEstimates: RiskEstimate[] = useMemo(() => {
    return estimateRoomRisks(board, floorCfg);
  }, [board, floorCfg]);

  return (
    <main className="game-shell">
      <section className="hero">
        <p>hxywl-61903 · H5Game · Port 61903</p>
        <h1>地牢翻牌</h1>
        <span>在随机房间里寻找钥匙与出口，避开陷阱</span>
      </section>

      <section className="hud">
        <article>
          <small>血量</small>
          <strong className="stat-hp">
            {"❤️".repeat(hp)}{"🖤".repeat(MAX_HP - hp)}
          </strong>
        </article>
        <article>
          <small>金币</small>
          <strong className="stat-coin">{coins}</strong>
        </article>
        <article>
          <small>钥匙</small>
          <strong className="stat-key">{keys > 0 ? "🔑" : "✕"}</strong>
        </article>
        <article>
          <small>药水</small>
          <strong className="stat-potion">🧪 × {potions}</strong>
        </article>
        <article>
          <small>层数</small>
          <strong className="stat-floor">B{floor}F</strong>
        </article>
      </section>

      <section className="playground dungeon">
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
                onClick={() => flip(idx)}
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
        <aside className="side-panel">
          <h2>核心玩法</h2>
          <p>
            在{SIZE}×{SIZE}地牢中逐步翻开相邻房间，寻找钥匙🔑后打开出口🚪即可进入下一层。
            层数越高，陷阱⚡和怪物👹越多，但金币💰奖励也更丰厚。
            进入下一层会保留血量、金币和药水，失败或「重新探索」则完全重置。
          </p>
          <div className="legend">
            <span className="leg-start">🏠 起点</span>
            <span className="leg-coin">💰 金币</span>
            <span className="leg-trap">⚡ 陷阱</span>
            <span className="leg-monster">👹 怪物</span>
            <span className="leg-potion">🧪 药水</span>
            <span className="leg-key">🔑 钥匙</span>
            <span className="leg-exit">🚪 出口</span>
            <span className="leg-empty">· 空房</span>
          </div>
          <div className="floor-info">
            <small>B{floor}F 难度配置</small>
            {currentRouteCfg && (
              <div className="current-route">
                <span className="route-badge">
                  {currentRouteCfg.icon} {currentRouteCfg.name}路线
                </span>
              </div>
            )}
            <div className="floor-config">
              <span>陷阱 {floorCfg.trapCt}</span>
              <span>怪物 {floorCfg.monsterCt}</span>
              <span>金币房 {floorCfg.coinCt}</span>
              <span>药水 {floorCfg.potionCt}</span>
              <span>金币 {floorCfg.coinMin}~{floorCfg.coinMax}/堆</span>
            </div>
          </div>
          <div className="route-hint-toggle">
            <label className="toggle-label">
              <span className="toggle-icon">🧭</span>
              <span className="toggle-text">路线提示</span>
              <span className="toggle-desc">仅高亮安全方向</span>
              <button
                type="button"
                className={`toggle-switch ${showRouteHint ? "toggle-on" : "toggle-off"}`}
                onClick={() => setShowRouteHint((prev) => !prev)}
              >
                <span className="toggle-knob" />
              </button>
            </label>
          </div>
          <div className="risk-hint-toggle">
            <label className="toggle-label">
              <span className="toggle-icon">🔮</span>
              <span className="toggle-text">雾中推理</span>
              <span className="toggle-desc">根据已知信息推测风险</span>
              <button
                type="button"
                className={`toggle-switch ${showRiskHint ? "toggle-on" : "toggle-off"}`}
                onClick={() => setShowRiskHint((prev) => !prev)}
              >
                <span className="toggle-knob" />
              </button>
            </label>
            {showRiskHint && (
              <div className="risk-legend">
                <div className="legend-title">风险等级</div>
                <div className="legend-items">
                  <div className="legend-item">
                    <span className="legend-dot" style={{ backgroundColor: getRiskColor(1) }}></span>
                    <span>极安全</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot" style={{ backgroundColor: getRiskColor(2) }}></span>
                    <span>较安全</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot" style={{ backgroundColor: getRiskColor(3) }}></span>
                    <span>未知</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot" style={{ backgroundColor: getRiskColor(4) }}></span>
                    <span>较危险</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot" style={{ backgroundColor: getRiskColor(5) }}></span>
                    <span>极危险</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="actions">
            <button
              className="btn-reset"
              onClick={handleRestart}
              disabled={!canRestart}
            >
              重新探索
            </button>
            <button
              className="btn-save"
              onClick={() => openSlotPanel("save")}
              disabled={status !== "playing" || showSettlement}
            >
              💾 存档
            </button>
            <button
              className="btn-load"
              onClick={() => openSlotPanel("load")}
            >
              📂 读档
            </button>
            <button
              className={["btn-potion", !canUsePotion ? "btn-disabled" : ""].filter(Boolean).join(" ")}
              onClick={usePotion}
              disabled={!canUsePotion}
            >
              使用药水 (🧪 × 1 → {EVENT_CONFIG.potion.healAmount ?? BATTLE_CONFIG.potionHeal}❤️)
            </button>
            <button
              className="btn-next"
              onClick={nextFloor}
              disabled={!canGoNextFloor}
            >
              进入下一层
            </button>
          </div>
          <div className="history-list history-compact">
            {history.slice(0, 6).map((rec: TurnRecord, i: number) => (
              <div key={rec.id} className={`history-item ${i === 0 ? "history-latest" : ""}`}>
                <div className="history-main">
                  <span className="history-turn">B{rec.floor}F·#{rec.turn}</span>
                  <span className="history-event">{rec.event}</span>
                </div>
                <div className="history-deltas">
                  {rec.hpDelta !== 0 && (
                    <span className={rec.hpDelta > 0 ? "delta-hp-gain" : "delta-hp-loss"}>
                      {rec.hpDelta > 0 ? `+${rec.hpDelta}❤️` : `${rec.hpDelta}❤️`}
                    </span>
                  )}
                  {rec.coinDelta !== 0 && (
                    <span className="delta-coin">+{rec.coinDelta}💰</span>
                  )}
                  {rec.items.map((item, idx) => (
                    <span key={idx} className="delta-item">{item}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="history-panel">
        <div className="history-header">
          <h2>📜 回合记录</h2>
          <span className="history-count">
            {historyFilter === "all"
              ? `共 ${history.length} 条`
              : `${filteredHistory.length}/${history.length} 条`}
          </span>
        </div>
        <div className="history-filters">
          {HISTORY_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`history-filter-btn ${historyFilter === f.key ? "filter-active" : ""}`}
              onClick={() => setHistoryFilter(f.key)}
            >
              {f.icon} {f.label}
            </button>
          ))}
        </div>
        <div className="history-list history-full">
          {filteredHistory.length === 0 ? (
            <div className="history-empty">暂无{activeFilter.label}类记录</div>
          ) : (
            filteredHistory.map((rec: TurnRecord, i: number) => (
              <div key={rec.id} className={`history-item ${i === 0 ? "history-latest" : ""}`}>
                <div className="history-main">
                  <span className="history-turn">B{rec.floor}F · 回合 {rec.turn}</span>
                  <span className="history-event">{rec.event}</span>
                </div>
                <div className="history-deltas">
                  {rec.hpDelta !== 0 && (
                    <span className={rec.hpDelta > 0 ? "delta-hp-gain" : "delta-hp-loss"}>
                      {rec.hpDelta > 0 ? `+${rec.hpDelta}❤️` : `${rec.hpDelta}❤️`}
                    </span>
                  )}
                  {rec.coinDelta !== 0 && (
                    <span className="delta-coin">+{rec.coinDelta}💰</span>
                  )}
                  {rec.items.map((item, idx) => (
                    <span key={idx} className="delta-item">{item}</span>
                  ))}
                  {rec.hpDelta === 0 && rec.coinDelta === 0 && rec.items.length === 0 && (
                    <span className="delta-none">—</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="result-panel">
        <div className="result-header">
          <h2>🎯 本局进度</h2>
          <div className="high-score-tags">
            {currentRouteCfg && (
              <span className="hs-tag route-tag">
                {currentRouteCfg.icon} {currentRouteCfg.name}路线
              </span>
            )}
            <span className="hs-tag">🏆 历史最高 B{highScore.maxFloor}F</span>
            <span className="hs-tag">💰 历史最多 {highScore.maxCoins} 金币</span>
            <button
              className="hs-tag hs-tag-btn"
              onClick={() => setShowLeaderboard(true)}
              title="查看历史战绩排行榜"
            >
              📊 排行榜
            </button>
          </div>
        </div>
        <p>
          {status === "won"
            ? `🎉 恭喜通关B${floor}F！累计获得${coins}💰金币，当前血量${hp}/${MAX_HP}❤️，剩余${potions}瓶🧪药水。点击「进入下一层」选择探险路线，继续向B${floor + 1}F深入！`
            : status === "lost"
              ? `💀 探索失败，在B${floor}F血量归零。共获得${coins}💰金币，到达B${floor}F。点击「重新探索」从B1F再次挑战！`
              : `正在探索B${floor}F${currentRouteCfg ? `（${currentRouteCfg.icon}${currentRouteCfg.name}路线）` : ""}，血量${hp}/${MAX_HP}❤️，金币${coins}💰，药水${potions}🧪，${keys > 0 ? "已持有钥匙🔑，赶快找到出口🚪！" : "尚未找到钥匙🔑，继续翻开相邻房间小心前进！"}本层有${floorCfg.trapCt}个陷阱⚡和${floorCfg.monsterCt}只怪物👹，谨慎行动！`}
        </p>
      </section>

      <section className="bottom-action-bar">
        <button
          className={["bottom-btn", "bottom-btn-restart", !canRestart ? "btn-disabled" : ""].filter(Boolean).join(" ")}
          onClick={handleRestart}
          disabled={!canRestart}
        >
          <span className="bottom-btn-icon">🔄</span>
          <span className="bottom-btn-text">重新探索</span>
        </button>
        <button
          className={["bottom-btn", "bottom-btn-potion", !canUsePotion ? "btn-disabled" : ""].filter(Boolean).join(" ")}
          onClick={usePotion}
          disabled={!canUsePotion}
        >
          <span className="bottom-btn-icon">🧪</span>
          <span className="bottom-btn-text">使用药水</span>
          <span className="bottom-btn-count">{potions}</span>
        </button>
        <button
          className={["bottom-btn", "bottom-btn-next", !canGoNextFloor ? "btn-disabled" : ""].filter(Boolean).join(" ")}
          onClick={nextFloor}
          disabled={!canGoNextFloor}
        >
          <span className="bottom-btn-icon">⬆️</span>
          <span className="bottom-btn-text">下一层</span>
          {exitRevealed && keys > 0 && <span className="bottom-btn-badge">✓</span>}
        </button>
      </section>

      {battleState !== "idle" && currentMonster && (
        <div className="battle-overlay">
          <div className="battle-modal">
            <div className="battle-header">
              <h2>⚔️ 战斗！</h2>
              <p>B{floor}F · 回合 {turn}</p>
              <button
                className="btn-battle-save"
                onClick={() => openSlotPanel("save")}
                disabled={status !== "playing" || showSettlement}
                title="保存当前战斗状态到槽位"
              >
                💾 中途存档
              </button>
            </div>

            <div className="battle-combatants">
              <div className="combatant player-side">
                <div className="combatant-icon">🧙</div>
                <div className="combatant-name">冒险者</div>
                <div className="hp-bar">
                  <div
                    className="hp-fill player-hp"
                    style={{ width: `${(hp / MAX_HP) * 100}%` }}
                  />
                  <span className="hp-text">{hp} / {MAX_HP}</span>
                </div>
                <div className="combatant-info">
                  <span>🧪 × {potions}</span>
                  {playerCharging && <span className="charging-indicator" title="下次攻击伤害翻倍">⚡ 蓄力中</span>}
                </div>
              </div>

              <div className="vs-divider">VS</div>

              <div className="combatant monster-side">
                <div className="combatant-icon">{currentMonster.icon}</div>
                <div className="combatant-name">{currentMonster.name}</div>
                <div className="hp-bar">
                  <div
                    className="hp-fill monster-hp"
                    style={{ width: `${(currentMonster.hp / currentMonster.maxHp) * 100}%` }}
                  />
                  <span className="hp-text">{currentMonster.hp} / {currentMonster.maxHp}</span>
                </div>
                <div className="combatant-info">
                  <span>⚔️ {currentMonster.attack}</span>
                  <span>💰 {currentMonster.coinReward}</span>
                </div>
              </div>
            </div>

            <div className="battle-log">
              <div className="battle-log-header">📜 战斗记录</div>
              <div className="battle-log-content">
                {battleLog.map((log) => (
                  <div key={log.id} className={`battle-log-item log-${log.type}`}>
                    {log.message}
                  </div>
                ))}
              </div>
            </div>

            {battleState === "fighting" ? (
              <div className="battle-actions">
                <button className="btn-attack" onClick={battleAttack}>
                  {playerCharging ? "💥 释放蓄力攻击" : "⚔️ 攻击"}
                </button>
                <button
                  className={["btn-charge", playerCharging ? "btn-disabled" : ""].filter(Boolean).join(" ")}
                  onClick={battleCharge}
                  disabled={playerCharging}
                  title="本回合不造成伤害，下次攻击伤害翻倍"
                >
                  ⚡ 蓄力攻击
                </button>
                <button
                  className={["btn-potion-battle", potions <= 0 || hp >= MAX_HP ? "btn-disabled" : ""].filter(Boolean).join(" ")}
                  onClick={battleUsePotion}
                  disabled={potions <= 0 || hp >= MAX_HP}
                >
                  🧪 使用药水 ({potions})
                </button>
                <button className="btn-flee" onClick={battleFlee}>
                  🏃 逃跑
                </button>
              </div>
            ) : (
              <div className="battle-result">
                {battleState === "won" && <div className="battle-result-text victory">🎉 战斗胜利！</div>}
                {battleState === "lost" && <div className="battle-result-text defeat">💀 战斗失败...</div>}
                {battleState === "fled" && <div className="battle-result-text fled">🏃 成功逃脱</div>}
                <button className="btn-close-battle" onClick={closeBattle}>
                  继续探索
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showSettlement && settlementData && (
        <div className="settlement-overlay">
          <div className={`settlement-modal settlement-${settlementResult}`}>
            <div className="settlement-header">
              <h2>{settlementData.resultTitle}</h2>
              <div className="settlement-stars">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className={`star ${i < settlementData.evaluation.stars ? "star-on" : "star-off"}`}>
                    ★
                  </span>
                ))}
              </div>
              <div className="settlement-rank">{settlementData.evaluation.rank}</div>
              <p className="settlement-comment">{settlementData.evaluation.comment}</p>
            </div>

            <div className="settlement-stats">
              <div className="stat-row">
                <span className="stat-label">🏰 到达层数</span>
                <span className="stat-value">
                  B{floor}F
                  {settlementData.isFloorRecord && <span className="record-tag">新纪录!</span>}
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">💰 金币总数</span>
                <span className="stat-value">
                  {coins} 枚
                  {settlementData.isCoinRecord && <span className="record-tag">新纪录!</span>}
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">🚪 翻开房间</span>
                <span className="stat-value">{stats.revealedRooms} 间</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">⚡ 遭遇陷阱</span>
                <span className="stat-value">{stats.trapHits} 次</span>
              </div>
              <div className="stat-row">
                <span className="stat-label">👹 击败怪物</span>
                <span className="stat-value">{stats.monstersDefeated} 只</span>
              </div>
            </div>

            {settlementData.highlights.length > 0 && (
              <div className="settlement-highlights">
                <div className="highlights-title">✨ 本局亮点</div>
                <div className="highlights-list">
                  {settlementData.highlights.map((h, i) => (
                    <div key={i} className="highlight-item" style={{ animationDelay: `${(i + 1) * 120}ms` }}>
                      <span className="highlight-icon">{h.icon}</span>
                      <span className="highlight-text">{h.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="settlement-highscore">
              <div className="hs-row">
                <span>🏆 历史最高层数</span>
                <strong>B{highScore.maxFloor}F</strong>
              </div>
              <div className="hs-row">
                <span>💰 历史最高金币</span>
                <strong>{highScore.maxCoins} 枚</strong>
              </div>
            </div>

            <div className="settlement-actions">
              <button className="btn-settle-restart" onClick={doResetGame}>
                🔄 再来一局
              </button>
            </div>
          </div>
        </div>
      )}

      {showRouteSelect && (
        <div className="route-select-overlay">
          <div className="route-select-modal">
            <div className="route-select-header">
              <h2>🗺️ 选择探险路线</h2>
              <p>即将进入 B{floor + 1}F，请选择你的探险策略</p>
            </div>
            <div className="route-options">
              {Object.values(ROUTE_CONFIGS).map((route) => {
                const nextCfg = getFloorConfig(floor + 1, route.key);
                return (
                  <button
                    key={route.key}
                    className={`route-option route-${route.key}`}
                    onClick={() => confirmRouteAndNextFloor(route.key)}
                  >
                    <div className="route-icon">{route.icon}</div>
                    <div className="route-name">{route.name}</div>
                    <div className="route-description">{route.description}</div>
                    <div className="route-preview">
                      <small>下一层预览：</small>
                      <div className="route-preview-stats">
                        <span>🧪 {nextCfg.potionCt}</span>
                        <span>💰 {nextCfg.coinMin}~{nextCfg.coinMax}</span>
                        <span>👹 ×{route.monsterStrengthMultiplier}</span>
                        <span>⚡ 上限{nextCfg.pathMaxDamage}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="route-select-footer">
              <button
                className="btn-cancel-route"
                onClick={() => setShowRouteSelect(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showSlotPanel && (
        <div className="slot-overlay">
          <div className="slot-modal">
            <div className="slot-header">
              <h2>{showSlotPanel === "save" ? "💾 保存游戏" : "📂 读取存档"}</h2>
              <p>{showSlotPanel === "save" ? "选择一个槽位保存当前进度" : "选择一个槽位继续游戏"}</p>
            </div>
            <div className="slot-list">
              {slotList.map((slot) => {
                const isSaveMode = showSlotPanel === "save";
                const isEmpty = slot.empty;
                const isInvalid = !slot.empty && !slot.valid;
                const routeCfg = slot.currentRoute ? ROUTE_CONFIGS[slot.currentRoute] : null;
                return (
                  <div
                    key={slot.index}
                    className={[
                      "slot-card",
                      isEmpty ? "slot-empty" : "",
                      isInvalid ? "slot-invalid" : "",
                      slot.battleState === "fighting" ? "slot-battle" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    <div className="slot-index">槽位 {slot.index}</div>
                    {isEmpty ? (
                      <div className="slot-info">
                        <span className="slot-empty-text">空槽位</span>
                      </div>
                    ) : isInvalid ? (
                      <div className="slot-info">
                        <span className="slot-invalid-text">⚠️ 存档损坏</span>
                        <span className="slot-reason">{slot.reason}</span>
                      </div>
                    ) : (
                      <div className="slot-info">
                        <span className="slot-detail">🏰 B{slot.floor}F</span>
                        <span className="slot-detail">💰 {slot.coins}</span>
                        <span className="slot-detail">❤️ {slot.hp}/{slot.maxHp}</span>
                        {slot.battleState === "fighting" && (
                          <span className="slot-battle-tag">⚔️ 战斗中</span>
                        )}
                        {routeCfg && (
                          <span className="slot-route-tag">{routeCfg.icon} {routeCfg.name}</span>
                        )}
                      </div>
                    )}
                    {!isEmpty && slot.timestamp > 0 && (
                      <div className="slot-time">
                        {new Date(slot.timestamp).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </div>
                    )}
                    <div className="slot-actions">
                      {isSaveMode ? (
                        <button
                          className="btn-slot-save"
                          onClick={() => saveToSlot(slot.index)}
                        >
                          {isEmpty ? "保存到此处" : "覆盖保存"}
                        </button>
                      ) : (
                        <>
                          {!isEmpty && (
                            <>
                              <button
                                className="btn-slot-load"
                                disabled={isInvalid}
                                onClick={() => loadFromSlot(slot.index)}
                              >
                                读取
                              </button>
                              <button
                                className="btn-slot-delete"
                                onClick={() => deleteSaveSlot(slot.index)}
                              >
                                删除
                              </button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="slot-footer">
              <button
                className="btn-cancel-slot"
                onClick={() => setShowSlotPanel(null)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaderboard && (
        <div className="leaderboard-overlay">
          <div className="leaderboard-modal">
            <div className="leaderboard-header">
              <h2>📊 历史战绩排行榜</h2>
              <p>最近 {GAME_CONSTANTS.maxLeaderboardEntries} 局游戏记录</p>
              <button
                className="leaderboard-close"
                onClick={() => setShowLeaderboard(false)}
              >
                ✕
              </button>
            </div>

            <div className="leaderboard-toolbar">
              <div className="leaderboard-sort">
                <span className="sort-label">排序：</span>
                <button
                  className={["sort-btn", leaderboardSort === "time" ? "sort-active" : ""].filter(Boolean).join(" ")}
                  onClick={() => setLeaderboardSort("time")}
                >
                  ⏱️ 最近
                </button>
                <button
                  className={["sort-btn", leaderboardSort === "floor" ? "sort-active" : ""].filter(Boolean).join(" ")}
                  onClick={() => setLeaderboardSort("floor")}
                >
                  🏰 层数
                </button>
                <button
                  className={["sort-btn", leaderboardSort === "coins" ? "sort-active" : ""].filter(Boolean).join(" ")}
                  onClick={() => setLeaderboardSort("coins")}
                >
                  💰 金币
                </button>
              </div>
              <button
                className="leaderboard-clear"
                onClick={handleClearLeaderboard}
                disabled={leaderboard.length === 0}
              >
                🗑️ 清空记录
              </button>
            </div>

            {sortedLeaderboard.length === 0 ? (
              <div className="leaderboard-empty">
                <div className="empty-icon">📭</div>
                <div className="empty-text">暂无战绩记录</div>
                <div className="empty-hint">完成一局游戏后将自动记录在此</div>
              </div>
            ) : (
              <div className="leaderboard-list">
                {sortedLeaderboard.map((entry, idx) => (
                  <div
                    key={entry.id}
                    className={[
                      "leaderboard-item",
                      idx === 0 && leaderboardSort !== "time" ? "lb-top-1" : "",
                      idx === 1 && leaderboardSort !== "time" ? "lb-top-2" : "",
                      idx === 2 && leaderboardSort !== "time" ? "lb-top-3" : "",
                      `lb-result-${entry.resultType}`,
                    ].filter(Boolean).join(" ")}
                  >
                    <div className="lb-rank">
                      {leaderboardSort !== "time" && idx < 3 ? (
                        <span className="lb-rank-medal">
                          {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                        </span>
                      ) : (
                        <span className="lb-rank-num">#{idx + 1}</span>
                      )}
                    </div>
                    <div className="lb-info">
                      <div className="lb-info-top">
                        <span className="lb-result-tag">
                          {entry.resultType === "clear" ? "🏆 通关" : entry.resultType === "death" ? "💀 阵亡" : "🏃 撤退"}
                        </span>
                        <span className="lb-stars">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span
                              key={i}
                              className={`star-mini ${i < entry.stars ? "star-mini-on" : "star-mini-off"}`}
                            >
                              ★
                            </span>
                          ))}
                        </span>
                        <span className="lb-rank-title">{entry.rank}</span>
                      </div>
                      <div className="lb-info-stats">
                        <span className="lb-stat">🏰 B{entry.floor}F</span>
                        <span className="lb-stat">💰 {entry.coins}</span>
                        <span className="lb-stat">🚪 {entry.revealedRooms}</span>
                        <span className="lb-stat">⚡ {entry.trapHits}</span>
                        <span className="lb-stat">👹 {entry.monstersDefeated}</span>
                      </div>
                      <div className="lb-info-time">
                        {new Date(entry.timestamp).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="leaderboard-footer">
              <div className="lb-summary">
                共 {leaderboard.length} 条记录
                {leaderboard.length > 0 && (
                  <>
                    <span className="lb-summary-sep">·</span>
                    <span>最高 B{Math.max(...leaderboard.map(e => e.floor))}F</span>
                    <span className="lb-summary-sep">·</span>
                    <span>最多 {Math.max(...leaderboard.map(e => e.coins))} 金币</span>
                  </>
                )}
              </div>
              <button
                className="btn-close-leaderboard"
                onClick={() => setShowLeaderboard(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        className="debug-toggle"
        onClick={() => setShowDebugPanel((prev) => !prev)}
      >
        🛠 {showDebugPanel ? "隐藏" : "开发"}
      </button>

      {showDebugPanel && (
        <section className="debug-panel">
          <div className="debug-header">
            <h3>🔧 开发调试面板</h3>
            <button onClick={() => setShowDebugPanel(false)}>✕</button>
          </div>
          <div className="debug-actions">
            <button onClick={verifyCurrentMap}>验证地图</button>
            <button onClick={printDebugMap}>打印地图</button>
            <button onClick={regenMap}>重新生成</button>
            <button onClick={toggleRevealAll}>
              {revealAllRooms ? "隐藏房间" : "显示所有房间"}
            </button>
            <button onClick={runReconstructionCheck}>🔍 验证事件重构</button>
            <button onClick={showEventHistory}>📋 显示事件状态</button>
            <button onClick={showFloorProgress}>🏗️ 楼层进度</button>
          </div>
          <div className="debug-stats">
            <div>当前楼层: B{floor}F</div>
            <div>当前路线: {currentRouteCfg ? `${currentRouteCfg.icon} ${currentRouteCfg.name}` : "无"}</div>
            <div>路径上限: {floorCfg.pathMaxDamage} 伤害</div>
            <div>事件系统: {reconstructionError ? "❌ 不一致" : "✅ 正常"}</div>
          </div>
          {reconstructionError && (
            <div className="debug-error" style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px', padding: '8px', background: '#fef2f2', borderRadius: '4px' }}>
              ⚠️ {reconstructionError}
            </div>
          )}

          <div className="diag-config">
            <div className="diag-config-title">📊 诊断报告</div>
            <div className="diag-config-row">
              <label>楼层范围</label>
              <div className="diag-range-inputs">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={diagFloorFrom}
                  onChange={(e) => setDiagFloorFrom(Math.max(1, parseInt(e.target.value) || 1))}
                  disabled={diagRunning}
                />
                <span>~</span>
                <input
                  type="number"
                  min={diagFloorFrom}
                  max={20}
                  value={diagFloorTo}
                  onChange={(e) => setDiagFloorTo(Math.max(diagFloorFrom, parseInt(e.target.value) || diagFloorFrom))}
                  disabled={diagRunning}
                />
              </div>
            </div>
            <div className="diag-config-row">
              <label>每层迭代</label>
              <input
                type="number"
                className="diag-iter-input"
                min={1}
                max={500}
                value={diagIterations}
                onChange={(e) => setDiagIterations(Math.max(1, Math.min(500, parseInt(e.target.value) || 50)))}
                disabled={diagRunning}
              />
            </div>
            <div className="diag-config-row">
              <label>路线</label>
              <span className="diag-route-label">
                {currentRouteCfg ? `${currentRouteCfg.icon} ${currentRouteCfg.name}` : "默认"}
              </span>
            </div>
            <div className="diag-run-row">
              {!diagRunning ? (
                <button className="diag-btn-run" onClick={startDiagRun}>
                  ▶ 运行诊断
                </button>
              ) : (
                <button className="diag-btn-cancel" onClick={cancelDiagRun}>
                  ⏹ 取消
                </button>
              )}
            </div>
          </div>

          {diagRunning && diagProgress && !diagProgress.done && (
            <div className="diag-progress">
              <div className="diag-progress-bar">
                <div
                  className="diag-progress-fill"
                  style={{
                    width: `${(
                      ((diagProgress.currentFloor - diagFloorFrom) * diagProgress.iterationsPerFloor +
                        diagProgress.currentIteration) /
                      (diagProgress.totalFloors * diagProgress.iterationsPerFloor) *
                      100
                    ).toFixed(1)}%`,
                  }}
                />
              </div>
              <div className="diag-progress-text">
                B{diagProgress.currentFloor}F · {diagProgress.currentIteration}/{diagProgress.iterationsPerFloor}
              </div>
            </div>
          )}

          {diagReport && (
            <div className="diag-report diag-report-v2">
              <div className="diag-report-header-v2">
                <div className="diag-report-title-row">
                  <span className="diag-report-title">📊 开发诊断报告</span>
                  <span className="diag-report-meta-v2">
                    {diagReport.totalIterations} 次迭代 · {(diagReport.elapsed / 1000).toFixed(1)}s
                  </span>
                </div>
                <div className="diag-view-tabs">
                  <button
                    className={`diag-view-tab ${diagViewMode === "overview" ? "active" : ""}`}
                    onClick={() => setDiagViewMode("overview")}
                  >
                    📈 总览
                  </button>
                  <button
                    className={`diag-view-tab ${diagViewMode === "detail" ? "active" : ""}`}
                    onClick={() => setDiagViewMode("detail")}
                  >
                    📋 详情
                  </button>
                </div>
              </div>

              {diagViewMode === "overview" && diagReport.overview && (
                <div className="diag-overview-section">
                  <div className="diag-overview-cards">
                    <div className="diag-overview-card card-success">
                      <div className="card-icon">✅</div>
                      <div className="card-content">
                        <div className="card-label">总体成功率</div>
                        <div className="card-value">
                          {(diagReport.overview.overallSuccessRate * 100).toFixed(1)}%
                        </div>
                        <div className="card-sub">
                          最佳 B{diagReport.overview.bestFloor}F · 最差 B{diagReport.overview.worstFloor}F
                        </div>
                      </div>
                    </div>
                    <div className="diag-overview-card card-damage">
                      <div className="card-icon">⚡</div>
                      <div className="card-content">
                        <div className="card-label">平均路径伤害</div>
                        <div className="card-value">
                          {diagReport.overview.avgPathDamage.toFixed(2)}
                        </div>
                        <div className="card-sub">跨 {diagReport.overview.totalFloors} 层平均</div>
                      </div>
                    </div>
                    <div className="diag-overview-card card-attempts">
                      <div className="card-icon">🔄</div>
                      <div className="card-content">
                        <div className="card-label">平均生成尝试</div>
                        <div className="card-value">
                          {diagReport.overview.avgAttempts.toFixed(2)}
                        </div>
                        <div className="card-sub">最难 B{diagReport.overview.hardestFloor}F</div>
                      </div>
                    </div>
                  </div>

                  <div className="diag-trend-section">
                    <div className="diag-chart-title-v2">📉 成功率趋势</div>
                    <div className="diag-trend-chart">
                      <div className="trend-y-axis">
                        <span>100%</span>
                        <span>50%</span>
                        <span>0%</span>
                      </div>
                      <div className="trend-content">
                        <svg
                          className="trend-svg"
                          viewBox={`0 0 ${diagReport.floors.length * 60} 100`}
                          preserveAspectRatio="none"
                        >
                          <polyline
                            fill="none"
                            stroke="url(#successGradient)"
                            strokeWidth="2"
                            points={diagReport.floors
                              .map((f, i) => `${i * 60 + 30},${100 - f.successRate * 100}`)
                              .join(" ")}
                          />
                          <defs>
                            <linearGradient id="successGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#4ade80" />
                              <stop offset="100%" stopColor="#22c55e" />
                            </linearGradient>
                          </defs>
                          {diagReport.floors.map((f, i) => (
                            <circle
                              key={f.floor}
                              cx={i * 60 + 30}
                              cy={100 - f.successRate * 100}
                              r="3"
                              fill="#4ade80"
                            />
                          ))}
                        </svg>
                        <div className="trend-x-axis">
                          {diagReport.floors.map((f) => (
                            <span key={f.floor} className="trend-x-label">
                              B{f.floor}F
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="diag-compare-section">
                    <div className="diag-chart-title-v2">📊 楼层指标对比</div>
                    <div className="diag-compare-bars">
                      {diagReport.floors.map((fr) => {
                        const maxDmg = Math.max(...diagReport.floors.map((f) => f.avgPathDamage), 1);
                        const maxAtt = Math.max(...diagReport.floors.map((f) => f.avgAttempts), 1);
                        const isExpanded = diagExpandedFloor === fr.floor;
                        return (
                          <div
                            key={fr.floor}
                            className={`diag-compare-row ${isExpanded ? "expanded" : ""}`}
                            onClick={() => setDiagExpandedFloor(isExpanded ? null : fr.floor)}
                          >
                            <div className="compare-main">
                              <span className="compare-floor">B{fr.floor}F</span>
                              <div className="compare-bars">
                                <div className="compare-bar-group">
                                  <div
                                    className="compare-bar compare-bar-success"
                                    style={{ width: `${fr.successRate * 100}%` }}
                                    title={`成功率: ${(fr.successRate * 100).toFixed(1)}%`}
                                  />
                                  <span className="compare-bar-label">
                                    {(fr.successRate * 100).toFixed(0)}%
                                  </span>
                                </div>
                                <div className="compare-bar-group">
                                  <div
                                    className="compare-bar compare-bar-damage"
                                    style={{ width: `${(fr.avgPathDamage / maxDmg) * 100}%` }}
                                    title={`平均伤害: ${fr.avgPathDamage.toFixed(2)}`}
                                  />
                                  <span className="compare-bar-label">
                                    {fr.avgPathDamage.toFixed(1)}
                                  </span>
                                </div>
                                <div className="compare-bar-group">
                                  <div
                                    className="compare-bar compare-bar-attempts"
                                    style={{ width: `${(fr.avgAttempts / maxAtt) * 100}%` }}
                                    title={`平均尝试: ${fr.avgAttempts.toFixed(2)}`}
                                  />
                                  <span className="compare-bar-label">
                                    {fr.avgAttempts.toFixed(1)}
                                  </span>
                                </div>
                              </div>
                              <span className="expand-icon">{isExpanded ? "▲" : "▼"}</span>
                            </div>
                            {isExpanded && (
                              <div className="compare-detail">
                                <div className="detail-grid">
                                  <div className="detail-item">
                                    <span className="detail-label">成功率</span>
                                    <span className={`detail-value ${fr.successRate >= 0.9 ? "good" : fr.successRate >= 0.5 ? "warn" : "bad"}`}>
                                      {(fr.successRate * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">平均伤害</span>
                                    <span className="detail-value">{fr.avgPathDamage.toFixed(2)}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">中位伤害</span>
                                    <span className="detail-value">{fr.medianPathDamage.toFixed(2)}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">伤害范围</span>
                                    <span className="detail-value">{fr.minPathDamage} ~ {fr.maxPathDamage}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">标准差</span>
                                    <span className="detail-value">±{fr.pathDamageStdDev.toFixed(2)}</span>
                                  </div>
                                  <div className="detail-item">
                                    <span className="detail-label">平均尝试</span>
                                    <span className="detail-value">{fr.avgAttempts.toFixed(2)}</span>
                                  </div>
                                </div>
                                <div className="detail-distribution">
                                  <div className="dist-title">伤害分布</div>
                                  <div className="dist-bars">
                                    {fr.damageDistribution.map((count, i) => {
                                      const maxCount = Math.max(...fr.damageDistribution, 1);
                                      return (
                                        <div key={i} className="dist-bar-wrapper">
                                          <div
                                            className="dist-bar"
                                            style={{ height: `${(count / maxCount) * 100}%` }}
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                {Object.keys(fr.commonIssues).length > 0 && (
                                  <div className="detail-issues">
                                    <div className="issues-title">常见问题</div>
                                    <div className="issues-list">
                                      {Object.entries(fr.commonIssues)
                                        .sort((a, b) => b[1] - a[1])
                                        .slice(0, 5)
                                        .map(([issue, count]) => (
                                          <div key={issue} className="issue-item">
                                            <span className="issue-name">{issue}</span>
                                            <span className="issue-count">{count}次</span>
                                          </div>
                                        ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {diagViewMode === "detail" && (
                <div className="diag-detail-section">
                  <div className="diag-detail-table-v2">
                    <div className="detail-table-header">
                      <span>楼层</span>
                      <span>成功率</span>
                      <span>平均伤害</span>
                      <span>中位伤害</span>
                      <span>伤害范围</span>
                      <span>平均尝试</span>
                    </div>
                    {diagReport.floors.map((fr) => (
                      <div key={fr.floor} className="detail-table-row">
                        <span className="floor-cell">B{fr.floor}F</span>
                        <span className={fr.successRate >= 0.9 ? "val-good" : fr.successRate >= 0.5 ? "val-warn" : "val-bad"}>
                          {(fr.successRate * 100).toFixed(1)}%
                        </span>
                        <span>{fr.avgPathDamage.toFixed(2)}</span>
                        <span>{fr.medianPathDamage.toFixed(2)}</span>
                        <span>{fr.minPathDamage}~{fr.maxPathDamage}</span>
                        <span>{fr.avgAttempts.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="diag-issues-summary">
                    <div className="diag-chart-title-v2">⚠️ 全楼层失败原因汇总</div>
                    <div className="issues-summary-list">
                      {(() => {
                        const allIssues: Record<string, number> = {};
                        for (const f of diagReport.floors) {
                          for (const [issue, count] of Object.entries(f.commonIssues)) {
                            allIssues[issue] = (allIssues[issue] || 0) + count;
                          }
                        }
                        const totalIssues = Object.values(allIssues).reduce((a, b) => a + b, 0);
                        return Object.entries(allIssues)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 8)
                          .map(([issue, count]) => (
                            <div key={issue} className="issue-summary-item">
                              <div className="issue-summary-header">
                                <span className="issue-summary-name">{issue}</span>
                                <span className="issue-summary-count">{count}次</span>
                              </div>
                              <div className="issue-summary-bar">
                                <div
                                  className="issue-summary-fill"
                                  style={{ width: `${totalIssues > 0 ? (count / totalIssues) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                          ));
                      })()}
                    </div>
                  </div>
                </div>
              )}

              <div className="diag-report-actions">
                <button
                  className="diag-action-btn"
                  onClick={() => {
                    const jsonStr = JSON.stringify(diagReport, null, 2);
                    navigator.clipboard?.writeText(jsonStr).then(
                      () => addDebugLog("✅ 诊断报告已复制到剪贴板"),
                      () => addDebugLog("❌ 复制失败，请手动复制")
                    );
                  }}
                >
                  📋 复制报告
                </button>
                <button
                  className="diag-action-btn"
                  onClick={startDiagRun}
                  disabled={diagRunning}
                >
                  🔄 重新运行
                </button>
              </div>
            </div>
          )}

          <div className="debug-log">
            <div className="debug-log-header">📋 调试日志</div>
            <div className="debug-log-content">
              {debugLog.length === 0 ? (
                <div className="debug-log-empty">暂无日志，点击上方按钮开始调试</div>
              ) : (
                debugLog.map((msg, i) => (
                  <div key={i} className="debug-log-item">{msg}</div>
                ))
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
