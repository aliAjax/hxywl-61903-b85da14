import { useCallback, useMemo, useState } from "react";
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
} from "./config/gameConfig";
import {
  generateMap,
  verifyMap,
  printMapDebug,
  runGenerationDiagnostics,
  GenerationResult,
} from "./config/mapGenerator";

const SIZE = GAME_CONSTANTS.boardSize;
const TOTAL = getTotalCells();
const MAX_HP = GAME_CONSTANTS.maxHp;
const HIGH_SCORE_KEY = GAME_CONSTANTS.highScoreKey;

interface Room {
  type: RoomType;
  revealed: boolean;
  defeated?: boolean;
}

interface BattleLog {
  id: number;
  message: string;
  type: "player" | "monster" | "system" | "reward";
}

type BattleState = "idle" | "fighting" | "won" | "lost" | "fled";

interface TurnRecord {
  id: number;
  turn: number;
  floor: number;
  event: string;
  roomType?: RoomType;
  hpDelta: number;
  coinDelta: number;
  items: string[];
}

type GameResultType = "clear" | "death" | "restart";

interface GameStats {
  revealedRooms: number;
  trapHits: number;
  monstersDefeated: number;
}

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

function generateBoard(floor: number = 1): Room[] {
  const result = generateMap(floor);
  lastGenResult = result;
  return result.rooms.map((t) => ({ type: t, revealed: t === "start" }));
}

let lastGenResult: GenerationResult | null = null;

export function getLastGenResult(): GenerationResult | null {
  return lastGenResult;
}

let battleLogIdCounter = 0;

function createBattleLog(message: string, type: BattleLog["type"]): BattleLog {
  return { id: ++battleLogIdCounter, message, type };
}

let recordIdCounter = 0;

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

const INITIAL_STATS: GameStats = {
  revealedRooms: 1,
  trapHits: 0,
  monstersDefeated: 0,
};

export default function App() {
  const initialFloor = 1;
  const [board, setBoard] = useState<Room[]>(() => generateBoard(initialFloor));
  const [hp, setHp] = useState(MAX_HP);
  const [coins, setCoins] = useState(0);
  const [keys, setKeys] = useState(0);
  const [potions, setPotions] = useState(0);
  const [floor, setFloor] = useState(initialFloor);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const [turn, setTurn] = useState(0);
  const [stats, setStats] = useState<GameStats>(INITIAL_STATS);
  const [showSettlement, setShowSettlement] = useState(false);
  const [settlementResult, setSettlementResult] = useState<GameResultType | null>(null);
  const [highScore, setHighScore] = useState<HighScore>(() => loadHighScore());
  const [battleState, setBattleState] = useState<BattleState>("idle");
  const [currentMonster, setCurrentMonster] = useState<Monster | null>(null);
  const [battleLog, setBattleLog] = useState<BattleLog[]>([]);
  const [battleRoomIdx, setBattleRoomIdx] = useState<number>(-1);
  const [brokeFloorRecord, setBrokeFloorRecord] = useState(false);
  const [brokeCoinRecord, setBrokeCoinRecord] = useState(false);
  const [history, setHistory] = useState<TurnRecord[]>([
    {
      id: ++recordIdCounter,
      turn: 0,
      floor: initialFloor,
      event: `🏠 游戏开始！进入B${initialFloor}F，翻开相邻房间探索地牢`,
      hpDelta: 0,
      coinDelta: 0,
      items: [],
    },
  ]);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [revealAllRooms, setRevealAllRooms] = useState(false);

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
      setSettlementResult(resultType);
      setShowSettlement(true);
    },
    [highScore]
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
          setHistory((prev: TurnRecord[]) => [
            {
              id: ++recordIdCounter,
              turn: nextTurn,
              floor,
              event: EVENT_MESSAGES.exitWithKey,
              roomType: "exit",
              hpDelta: 0,
              coinDelta: 0,
              items: [],
            },
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
        const monster = generateMonster(floor);
        setBoard((prev: Room[]) =>
          prev.map((r: Room, i: number) => (i === idx ? { ...r, revealed: true } : r))
        );
        setTurn(nextTurn);
        setStats(newStats);
        setCurrentMonster(monster);
        setBattleRoomIdx(idx);
        setBattleState("fighting");
        setBattleLog([
          createBattleLog(`遭遇了 ${monster.icon} ${monster.name}！`, "system"),
          createBattleLog(`怪物HP: ${monster.hp}/${monster.maxHp}，攻击力: ${monster.attack}`, "system"),
        ]);
        setHistory((prev: TurnRecord[]) => [
          {
            id: ++recordIdCounter,
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.monsterEncounterShort(monster),
            roomType: "monster",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          },
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
        records.push({
          id: ++recordIdCounter,
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.trapHit(dmg),
          roomType: room.type,
          hpDelta: -dmg,
          coinDelta: 0,
          items: [],
        });
        if (newHp <= 0) {
          newStatus = "lost";
          records.push({
            id: ++recordIdCounter,
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.death,
            roomType: room.type,
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          });
          setTimeout(() => {
            triggerSettlement("death", floor, newCoins, newStats, newHp);
          }, 100);
        }
      } else if (room.type === "coin") {
        const gain = getCoinReward(floor);
        newCoins = coins + gain;
        records.push({
          id: ++recordIdCounter,
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.coinFound(gain, floor),
          roomType: "coin",
          hpDelta: 0,
          coinDelta: gain,
          items: [],
        });
      } else if (room.type === "key") {
        newKeys = keys + 1;
        records.push({
          id: ++recordIdCounter,
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.keyFound,
          roomType: "key",
          hpDelta: 0,
          coinDelta: 0,
          items: ["🔑 钥匙"],
        });
        if (exitRevealed) {
          newStatus = "won";
          records.push({
            id: ++recordIdCounter,
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.exitWithKey,
            roomType: "exit",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          });
        }
      } else if (room.type === "potion") {
        newPotions = potions + 1;
        records.push({
          id: ++recordIdCounter,
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.potionFound,
          roomType: "potion",
          hpDelta: 0,
          coinDelta: 0,
          items: ["🧪 药水"],
        });
      } else if (room.type === "exit") {
        if (keys > 0) {
          newStatus = "won";
          records.push({
            id: ++recordIdCounter,
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.exitWithKey,
            roomType: "exit",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          });
        } else {
          records.push({
            id: ++recordIdCounter,
            turn: nextTurn,
            floor,
            event: EVENT_MESSAGES.exitNoKey,
            roomType: "exit",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          });
        }
      } else if (room.type === "empty") {
        records.push({
          id: ++recordIdCounter,
          turn: nextTurn,
          floor,
          event: EVENT_MESSAGES.emptyRoom,
          roomType: "empty",
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        });
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
      setHistory((prev: TurnRecord[]) => [...records, ...prev]);
    },
    [board, hp, coins, keys, potions, status, flippable, exitRevealed, turn, floor, stats, triggerSettlement, canFlip]
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
    const newFloor = 1;
    setBoard(generateBoard(newFloor));
    setHp(MAX_HP);
    setCoins(0);
    setKeys(0);
    setPotions(0);
    setFloor(newFloor);
    setStatus("playing");
    setTurn(0);
    setStats(INITIAL_STATS);
    setShowSettlement(false);
    setSettlementResult(null);
    setBrokeFloorRecord(false);
    setBrokeCoinRecord(false);
    setBattleState("idle");
    setCurrentMonster(null);
    setBattleLog([]);
    setBattleRoomIdx(-1);
    setHistory([
      {
        id: ++recordIdCounter,
        turn: 0,
        floor: newFloor,
        event: "🏠 重新开始探索！一切已重置，进入B1F",
        hpDelta: 0,
        coinDelta: 0,
        items: [],
      },
    ]);
  }, []);

  const nextFloor = useCallback(() => {
    const newFloor = floor + 1;
    const nextCfg = getFloorConfig(newFloor);
    setBoard(generateBoard(newFloor));
    setFloor(newFloor);
    setKeys(0);
    setStatus("playing");
    setTurn(0);
    setBattleState("idle");
    setCurrentMonster(null);
    setBattleLog([]);
    setBattleRoomIdx(-1);
    setHistory((prev: TurnRecord[]) => [
      {
        id: ++recordIdCounter,
        turn: 0,
        floor: newFloor,
        event: `⬆️ 进入B${newFloor}F！陷阱+${nextCfg.trapCt}、怪物+${nextCfg.monsterCt}、金币奖励范围${nextCfg.coinMin}~${nextCfg.coinMax}，请谨慎探索`,
        hpDelta: 0,
        coinDelta: 0,
        items: [],
      },
      ...prev,
    ]);
  }, [floor]);

  const usePotion = useCallback(() => {
    if (status !== "playing") {
      setHistory((prev: TurnRecord[]) => [
        {
          id: ++recordIdCounter,
          turn,
          floor,
          event: "❌ 游戏未进行中，无法使用药水",
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        },
        ...prev,
      ]);
      return;
    }
    if (potions <= 0) {
      setHistory((prev: TurnRecord[]) => [
        {
          id: ++recordIdCounter,
          turn,
          floor,
          event: EVENT_MESSAGES.noPotionLog,
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        },
        ...prev,
      ]);
      return;
    }
    if (hp >= MAX_HP) {
      setHistory((prev: TurnRecord[]) => [
        {
          id: ++recordIdCounter,
          turn,
          floor,
          event: EVENT_MESSAGES.hpFullLog,
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        },
        ...prev,
      ]);
      return;
    }
    const healAmount = EVENT_CONFIG.potion.healAmount ?? BATTLE_CONFIG.potionHeal;
    setPotions((p: number) => p - 1);
    setHp((h: number) => Math.min(MAX_HP, h + healAmount));
    setHistory((prev: TurnRecord[]) => [
      {
        id: ++recordIdCounter,
        turn,
        floor,
        event: EVENT_MESSAGES.potionUse(healAmount),
        hpDelta: healAmount,
        coinDelta: 0,
        items: [],
      },
      ...prev,
    ]);
  }, [potions, hp, status, turn, floor]);

  const endBattle = useCallback(
    (result: "won" | "lost" | "fled", finalMonster: Monster | null, settleDelay: number = 1200, fleeDamage: number = BATTLE_CONFIG.fleeSuccessDamage) => {
      let finalCoins = coins;
      let finalStats = stats;
      let finalHp = hp;
      let finalFleeDamage = 0;

      setBattleState(result);

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
        setHistory((prev: TurnRecord[]) => [
          {
            id: ++recordIdCounter,
            turn,
            floor,
            event: EVENT_MESSAGES.monsterDefeated(finalMonster, gotPotion),
            roomType: "monster",
            hpDelta: 0,
            coinDelta: finalMonster.coinReward,
            items: gotPotion ? ["🧪 药水"] : [],
          },
          ...prev,
        ]);
      } else if (result === "fled") {
        finalFleeDamage = fleeDamage;
        finalHp = Math.max(0, hp - finalFleeDamage);
        setHp(finalHp);
        setBoard((prev: Room[]) =>
          prev.map((r: Room, i: number) =>
            i === battleRoomIdx ? { ...r, revealed: false, defeated: false } : r
          )
        );
        setBattleLog((prev) => [
          ...prev,
          createBattleLog(EVENT_MESSAGES.roomResetLog, "system"),
        ]);
        setHistory((prev: TurnRecord[]) => [
          {
            id: ++recordIdCounter,
            turn,
            floor,
            event: EVENT_MESSAGES.flee(finalFleeDamage),
            roomType: "monster",
            hpDelta: -finalFleeDamage,
            coinDelta: 0,
            items: [],
          },
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
        setHistory((prev: TurnRecord[]) => [
          {
            id: ++recordIdCounter,
            turn,
            floor,
            event: EVENT_MESSAGES.monsterKilledPlayer(finalMonster),
            roomType: "monster",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          },
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
    [battleRoomIdx, turn, floor, coins, stats, hp, triggerSettlement]
  );

  const battleAttack = useCallback(() => {
    if (battleState !== "fighting" || !currentMonster) return;

    const playerDamage = BATTLE_CONFIG.playerDamageMin + Math.floor(Math.random() * (BATTLE_CONFIG.playerDamageMax - BATTLE_CONFIG.playerDamageMin + 1));
    const newMonsterHp = Math.max(0, currentMonster.hp - playerDamage);
    const updatedMonster = { ...currentMonster, hp: newMonsterHp };

    const newLogs: BattleLog[] = [
      createBattleLog(EVENT_MESSAGES.playerAttack(playerDamage), "player"),
    ];

    if (newMonsterHp <= 0) {
      newLogs.push(createBattleLog(EVENT_MESSAGES.monsterDefeatedLog(currentMonster), "system"));
      setCurrentMonster(updatedMonster);
      setBattleLog((prev) => [...prev, ...newLogs]);
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
      if (newHp <= 0) {
        setTimeout(() => {
          endBattle("lost", updatedMonster, 1500);
        }, 500);
      }
      return newHp;
    });
  }, [battleState, currentMonster, endBattle]);

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
    setBattleLog((prev) => [
      ...prev,
      createBattleLog(EVENT_MESSAGES.potionUse(healAmount), "player"),
    ]);
  }, [battleState, potions, hp]);

  const battleFlee = useCallback(() => {
    if (battleState !== "fighting") return;
    const fleeSuccess = Math.random() < BATTLE_CONFIG.fleeSuccessRate;
    const fleeDamage = fleeSuccess ? BATTLE_CONFIG.fleeSuccessDamage : (currentMonster ? currentMonster.attack : BATTLE_CONFIG.fleeSuccessDamage);
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
  }, [battleState, currentMonster, endBattle, hp]);

  const closeBattle = useCallback(() => {
    if (battleState === "fighting") return;
    setBattleState("idle");
    setCurrentMonster(null);
    setBattleLog([]);
    setBattleRoomIdx(-1);
  }, [battleState]);

  const settlementData = useMemo(() => {
    if (!showSettlement || !settlementResult) return null;
    const evaluation = evaluateGame(settlementResult, floor, coins, stats, hp);
    const resultTitle =
      settlementResult === "clear"
        ? "🏆 完美通关"
        : settlementResult === "death"
          ? "💀 探索失败"
          : "🏃 主动结束";
    return {
      evaluation,
      resultTitle,
      isFloorRecord: brokeFloorRecord,
      isCoinRecord: brokeCoinRecord,
    };
  }, [showSettlement, settlementResult, floor, coins, stats, hp, brokeFloorRecord, brokeCoinRecord]);

  const addDebugLog = useCallback((msg: string) => {
    setDebugLog((prev) => [msg, ...prev].slice(0, 50));
  }, []);

  const verifyCurrentMap = useCallback(() => {
    const cfg = getFloorConfig(floor);
    const roomTypes = board.map((r) => r.type);
    const result = verifyMap(roomTypes, cfg.pathMaxDamage);
    addDebugLog(`验证结果: ${result.valid ? "✅ 通过" : "❌ 失败"}`);
    if (result.issues.length > 0) {
      result.issues.forEach((issue) => addDebugLog(`  - ${issue}`));
    }
    addDebugLog(`路径伤害: 起点→钥匙=${result.safePath ? "有" : "无"}`);
  }, [board, floor, addDebugLog]);

  const printDebugMap = useCallback(() => {
    const roomTypes = board.map((r) => r.type);
    const mapStr = printMapDebug(roomTypes, { showPath: true, showDamage: true });
    addDebugLog("===== 地图布局 =====");
    mapStr.split("\n").forEach((line) => addDebugLog(line));
  }, [board, addDebugLog]);

  const runDiagnostics = useCallback(() => {
    addDebugLog("开始运行生成诊断（100次迭代）...");
    const diag = runGenerationDiagnostics(floor, 100);
    addDebugLog(`成功率: ${(diag.successRate * 100).toFixed(1)}%`);
    addDebugLog(`平均尝试次数: ${diag.avgAttempts.toFixed(2)}`);
    addDebugLog(`平均路径伤害: ${diag.avgPathDamage.toFixed(2)}`);
    addDebugLog(`伤害范围: ${diag.minPathDamage} ~ ${diag.maxPathDamage}`);
    if (Object.keys(diag.commonIssues).length > 0) {
      addDebugLog("常见问题:");
      Object.entries(diag.commonIssues).forEach(([issue, count]) => {
        addDebugLog(`  - ${issue}: ${count}次`);
      });
    }
  }, [floor, addDebugLog]);

  const regenMap = useCallback(() => {
    const newBoard = generateBoard(floor);
    setBoard(newBoard);
    addDebugLog(`重新生成地图 (B${floor}F)`);
  }, [floor, addDebugLog]);

  const toggleRevealAll = useCallback(() => {
    setRevealAllRooms((prev) => !prev);
    setBoard((prev) => prev.map((r) => ({ ...r, revealed: !revealAllRooms ? true : r.type === "start" })));
    addDebugLog(revealAllRooms ? "已隐藏所有房间" : "已显示所有房间");
  }, [revealAllRooms, addDebugLog]);

  const displayBoard = useMemo(() => {
    if (revealAllRooms) {
      return board.map((r) => ({ ...r, revealed: true }));
    }
    return board;
  }, [board, revealAllRooms]);

  const floorCfg: FloorConfig = getFloorConfig(floor);

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
          {displayBoard.map((room: Room, idx: number) => {
            const isFlippable = flippable.has(idx) && !room.revealed;
            const canClickExit =
              room.revealed && room.type === "exit" && keys > 0 && canFlip;
            const isDefeated = room.type === "monster" && room.defeated;
            const isDisabled = !canFlip && !room.revealed;
            return (
              <button
                key={idx}
                className={[
                  "cell",
                  room.type,
                  room.revealed ? "revealed" : "",
                  isFlippable ? "flippable" : "",
                  canClickExit ? "can-exit" : "",
                  isDefeated ? "defeated" : "",
                  isDisabled ? "disabled" : "",
                  revealAllRooms ? "debug-revealed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => flip(idx)}
              >
                {room.revealed
                  ? isDefeated
                    ? "💀"
                    : SYMBOLS[room.type as keyof typeof SYMBOLS]
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
            <div className="floor-config">
              <span>陷阱 {floorCfg.trapCt}</span>
              <span>怪物 {floorCfg.monsterCt}</span>
              <span>金币房 {floorCfg.coinCt}</span>
              <span>药水 {floorCfg.potionCt}</span>
              <span>金币 {floorCfg.coinMin}~{floorCfg.coinMax}/堆</span>
            </div>
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
          <span className="history-count">共 {history.length} 条</span>
        </div>
        <div className="history-list history-full">
          {history.map((rec: TurnRecord, i: number) => (
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
          ))}
        </div>
      </section>

      <section className="result-panel">
        <div className="result-header">
          <h2>🎯 本局进度</h2>
          <div className="high-score-tags">
            <span className="hs-tag">🏆 历史最高 B{highScore.maxFloor}F</span>
            <span className="hs-tag">💰 历史最多 {highScore.maxCoins} 金币</span>
          </div>
        </div>
        <p>
          {status === "won"
            ? `🎉 恭喜通关B${floor}F！累计获得${coins}💰金币，当前血量${hp}/${MAX_HP}❤️，剩余${potions}瓶🧪药水。点击「进入下一层」继续向B${floor + 1}F深入，届时将有更多陷阱和怪物，但金币奖励也会更丰厚！`
            : status === "lost"
              ? `💀 探索失败，在B${floor}F血量归零。共获得${coins}💰金币，到达B${floor}F。点击「重新探索」从B1F再次挑战！`
              : `正在探索B${floor}F，血量${hp}/${MAX_HP}❤️，金币${coins}💰，药水${potions}🧪，${keys > 0 ? "已持有钥匙🔑，赶快找到出口🚪！" : "尚未找到钥匙🔑，继续翻开相邻房间小心前进！"}本层有${floorCfg.trapCt}个陷阱⚡和${floorCfg.monsterCt}只怪物👹，谨慎行动！`}
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
                  ⚔️ 攻击
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
            <button onClick={runDiagnostics}>运行诊断</button>
            <button onClick={regenMap}>重新生成</button>
            <button onClick={toggleRevealAll}>
              {revealAllRooms ? "隐藏房间" : "显示所有房间"}
            </button>
          </div>
          <div className="debug-stats">
            <div>当前楼层: B{floor}F</div>
            <div>路径上限: {floorCfg.pathMaxDamage} 伤害</div>
          </div>
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
