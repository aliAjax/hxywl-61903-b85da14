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
  DiagReport,
  DiagProgress,
} from "./config/mapGenerator";
import {
  MAX_SLOTS,
  LeaderboardEntry,
  loadLeaderboard,
  addLeaderboardEntry,
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
import LeaderboardPanel from "./components/LeaderboardPanel";
import DebugPanel from "./components/DebugPanel";
import SettlementModal from "./components/SettlementModal";
import GameBoard from "./components/GameBoard";
import {
  GameResultType,
  LeaderboardSortKey,
  HighScore,
  HighlightItem,
  loadHighScore,
  saveHighScore,
  evaluateGame,
  generateHighlights,
} from "./components/shared";

const SIZE = GAME_CONSTANTS.boardSize;
const TOTAL = getTotalCells();
const MAX_HP = GAME_CONSTANTS.maxHp;

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
        <GameBoard
          board={board}
          revealAllRooms={revealAllRooms}
          flippable={flippable}
          safeRouteHintCells={safeRouteHintCells}
          frozenRouteHintRef={frozenRouteHintRef}
          battleState={battleState}
          showSettlement={showSettlement}
          showRouteHint={showRouteHint}
          showRiskHint={showRiskHint}
          keys={keys}
          canFlip={canFlip}
          riskEstimates={riskEstimates}
          onFlip={flip}
        />
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

      <SettlementModal
        showSettlement={showSettlement}
        settlementResult={settlementResult}
        floor={floor}
        coins={coins}
        stats={stats}
        hp={hp}
        brokeFloorRecord={brokeFloorRecord}
        brokeCoinRecord={brokeCoinRecord}
        highScore={highScore}
        onRestart={doResetGame}
      />

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

      <LeaderboardPanel
        showLeaderboard={showLeaderboard}
        setShowLeaderboard={setShowLeaderboard}
        leaderboard={leaderboard}
        setLeaderboard={setLeaderboard}
        leaderboardSort={leaderboardSort}
        setLeaderboardSort={setLeaderboardSort}
      />

      <button
        className="debug-toggle"
        onClick={() => setShowDebugPanel((prev) => !prev)}
      >
        🛠 {showDebugPanel ? "隐藏" : "开发"}
      </button>

      <DebugPanel
        showDebugPanel={showDebugPanel}
        setShowDebugPanel={setShowDebugPanel}
        revealAllRooms={revealAllRooms}
        setRevealAllRooms={setRevealAllRooms}
        diagRunning={diagRunning}
        setDiagRunning={setDiagRunning}
        diagFloorFrom={diagFloorFrom}
        setDiagFloorFrom={setDiagFloorFrom}
        diagFloorTo={diagFloorTo}
        setDiagFloorTo={setDiagFloorTo}
        diagIterations={diagIterations}
        setDiagIterations={setDiagIterations}
        diagReport={diagReport}
        setDiagReport={setDiagReport}
        diagProgress={diagProgress}
        setDiagProgress={setDiagProgress}
        diagExpandedFloor={diagExpandedFloor}
        setDiagExpandedFloor={setDiagExpandedFloor}
        diagViewMode={diagViewMode}
        setDiagViewMode={setDiagViewMode}
        diagRef={diagRef}
        debugLog={debugLog}
        setDebugLog={setDebugLog}
        floor={floor}
        board={board}
        stats={stats}
        hp={hp}
        coins={coins}
        keys={keys}
        potions={potions}
        status={status}
        battleState={battleState}
        battleRoomIdx={battleRoomIdx}
        playerCharging={playerCharging}
        currentRoute={currentRoute}
        currentRouteCfg={currentRouteCfg}
        floorCfg={floorCfg}
        reconstructionError={reconstructionError}
        eventStore={eventStore}
        getReconstructedState={getReconstructedState}
        generateBoard={generateBoard}
        setBoard={setBoard}
        verifyMap={verifyMap}
        printMapDebug={printMapDebug}
        runSingleDiagIteration={runSingleDiagIteration}
        compileDiagChunk={compileDiagChunk}
        computeDiagOverview={computeDiagOverview}
        getFloorConfig={getFloorConfig}
      />
    </main>
  );
}
