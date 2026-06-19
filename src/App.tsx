import { useCallback, useMemo, useState } from "react";
import "./styles.css";

const SIZE = 5;
const TOTAL = SIZE * SIZE;
const MAX_HP = 5;

type RoomType = "start" | "coin" | "trap" | "monster" | "key" | "exit" | "potion" | "empty";

interface Room {
  type: RoomType;
  revealed: boolean;
  defeated?: boolean;
}

interface Monster {
  name: string;
  icon: string;
  maxHp: number;
  hp: number;
  attack: number;
  coinReward: number;
  potionDropChance: number;
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

const HIGH_SCORE_KEY = "dungeon-high-score";

const SYMBOLS: Record<RoomType, string> = {
  start: "🏠",
  coin: "💰",
  trap: "⚡",
  monster: "👹",
  key: "🔑",
  exit: "🚪",
  potion: "🧪",
  empty: "·",
};

const DAMAGE_MAP: Record<RoomType, number> = {
  start: 0,
  coin: 0,
  trap: 1,
  monster: 2,
  key: 0,
  exit: 0,
  potion: 0,
  empty: 0,
};

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getNeighbors(idx: number): number[] {
  const r = Math.floor(idx / SIZE);
  const c = idx % SIZE;
  const out: number[] = [];
  if (r > 0) out.push(idx - SIZE);
  if (r < SIZE - 1) out.push(idx + SIZE);
  if (c > 0) out.push(idx - 1);
  if (c < SIZE - 1) out.push(idx + 1);
  return out;
}

interface FloorConfig {
  coinCt: number;
  trapCt: number;
  monsterCt: number;
  potionCt: number;
  coinMin: number;
  coinMax: number;
  pathMaxDamage: number;
}

function getFloorConfig(floor: number): FloorConfig {
  const lv = Math.min(floor, 10);
  const coinCt = Math.min(5 + Math.floor(lv * 0.7), 10);
  const trapCt = Math.min(4 + Math.floor(lv * 0.6), 9);
  const monsterCt = Math.min(3 + Math.floor(lv * 0.5), 7);
  const potionCt = Math.max(2 - Math.floor((lv - 1) / 3), 1);
  const coinMin = 1 + Math.floor((lv - 1) / 2);
  const coinMax = 3 + Math.floor(lv / 2);
  const pathMaxDamage = MAX_HP + Math.floor((lv - 1) / 2) * 2;
  return { coinCt, trapCt, monsterCt, potionCt, coinMin, coinMax, pathMaxDamage };
}

const MONSTER_TEMPLATES = [
  { name: "史莱姆", icon: "🟢", baseHp: 2, baseAtk: 1, coinBase: 1, potionChance: 0.1 },
  { name: "骷髅兵", icon: "💀", baseHp: 3, baseAtk: 1, coinBase: 2, potionChance: 0.15 },
  { name: "蝙蝠", icon: "🦇", baseHp: 2, baseAtk: 2, coinBase: 1, potionChance: 0.05 },
  { name: "哥布林", icon: "👺", baseHp: 3, baseAtk: 2, coinBase: 3, potionChance: 0.2 },
  { name: "狼人", icon: "🐺", baseHp: 4, baseAtk: 2, coinBase: 3, potionChance: 0.15 },
  { name: "石像鬼", icon: "🗿", baseHp: 5, baseAtk: 1, coinBase: 4, potionChance: 0.1 },
  { name: "火焰精灵", icon: "🔥", baseHp: 3, baseAtk: 3, coinBase: 4, potionChance: 0.25 },
  { name: "暗影刺客", icon: "🥷", baseHp: 4, baseAtk: 3, coinBase: 5, potionChance: 0.2 },
];

function generateMonster(floor: number): Monster {
  const lv = Math.min(floor, 10);
  const maxTemplateIdx = Math.min(Math.floor(lv / 2) + 2, MONSTER_TEMPLATES.length - 1);
  const template = MONSTER_TEMPLATES[Math.floor(Math.random() * (maxTemplateIdx + 1))];
  const hpBonus = Math.floor((lv - 1) / 3);
  const atkBonus = Math.floor((lv - 1) / 4);
  const coinBonus = Math.floor((lv - 1) / 2);
  const maxHp = template.baseHp + hpBonus + Math.floor(Math.random() * 2);
  return {
    name: template.name,
    icon: template.icon,
    maxHp,
    hp: maxHp,
    attack: template.baseAtk + atkBonus,
    coinReward: template.coinBase + coinBonus + Math.floor(Math.random() * 2),
    potionDropChance: template.potionChance,
  };
}

let battleLogIdCounter = 0;

function createBattleLog(message: string, type: BattleLog["type"]): BattleLog {
  return { id: ++battleLogIdCounter, message, type };
}

export function getCoinReward(floor: number): number {
  const cfg = getFloorConfig(floor);
  return cfg.coinMin + Math.floor(Math.random() * (cfg.coinMax - cfg.coinMin + 1));
}

function minDamagePath(types: RoomType[], from: number, to: number): number {
  const dist = new Array<number>(TOTAL).fill(Infinity);
  dist[from] = 0;
  const visited = new Set<number>();
  for (let iter = 0; iter < TOTAL; iter++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < TOTAL; i++) {
      if (!visited.has(i) && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === to) break;
    visited.add(u);
    for (const v of getNeighbors(u)) {
      if (!visited.has(v)) {
        const alt = dist[u] + DAMAGE_MAP[types[v]];
        if (alt < dist[v]) dist[v] = alt;
      }
    }
  }
  return dist[to];
}

function generateBoard(floor: number = 1): Room[] {
  const cfg = getFloorConfig(floor);
  const totalAllocated = 2 + cfg.coinCt + cfg.trapCt + cfg.monsterCt + cfg.potionCt;
  const maxAllocatable = TOTAL - 1;
  const overflow = Math.max(0, totalAllocated - maxAllocatable);
  const adjCoin = Math.max(1, cfg.coinCt - Math.ceil(overflow / 2));
  const adjTrap = Math.max(1, cfg.trapCt - Math.ceil(overflow / 3));
  const adjMonster = Math.max(1, cfg.monsterCt - Math.floor(overflow / 3));
  const adjPotion = cfg.potionCt;

  for (let attempt = 0; attempt < 200; attempt++) {
    const types: RoomType[] = new Array<RoomType>(TOTAL).fill("empty");
    types[0] = "start";
    const positions = shuffle(
      Array.from({ length: TOTAL }, (_, i) => i).filter((i) => i !== 0)
    );
    const keyIdx = positions[0];
    const exitIdx = positions[1];
    types[keyIdx] = "key";
    types[exitIdx] = "exit";
    const rest = positions.slice(2);
    for (let i = 0; i < rest.length; i++) {
      if (i < adjCoin) types[rest[i]] = "coin";
      else if (i < adjCoin + adjTrap) types[rest[i]] = "trap";
      else if (i < adjCoin + adjTrap + adjMonster) types[rest[i]] = "monster";
      else if (i < adjCoin + adjTrap + adjMonster + adjPotion) types[rest[i]] = "potion";
    }
    const d1 = minDamagePath(types, 0, keyIdx);
    const d2 = minDamagePath(types, keyIdx, exitIdx);
    if (d1 + d2 <= cfg.pathMaxDamage) {
      return types.map((t) => ({ type: t, revealed: t === "start" }));
    }
  }
  const fallback: RoomType[] = new Array<RoomType>(TOTAL).fill("empty");
  fallback[0] = "start";
  fallback[12] = "key";
  fallback[24] = "exit";
  const safeCorridor = new Set([0, 1, 2, 7, 12, 17, 22, 23, 24]);
  const allPositions = Array.from({ length: TOTAL }, (_, i) => i);
  const available = shuffle(allPositions.filter((i) => !safeCorridor.has(i)));
  const fbTrap = Math.min(adjTrap, 3);
  const fbMonster = Math.min(adjMonster, 3);
  const fbCoin = Math.min(adjCoin, 6);
  const fbPotion = adjPotion;
  let idx = 0;
  for (let i = 0; i < fbTrap && idx < available.length; i++, idx++) fallback[available[idx]] = "trap";
  for (let i = 0; i < fbMonster && idx < available.length; i++, idx++) fallback[available[idx]] = "monster";
  for (let i = 0; i < fbCoin && idx < available.length; i++, idx++) fallback[available[idx]] = "coin";
  for (let i = 0; i < fbPotion && idx < available.length; i++, idx++) fallback[available[idx]] = "potion";
  return fallback.map((t) => ({ type: t, revealed: t === "start" }));
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
      if (status !== "playing") return;
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
              event: "🚪 用钥匙打开出口，通关！",
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
            event: `👹 遭遇 ${monster.icon} ${monster.name}！进入战斗状态`,
            roomType: "monster",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          },
          ...prev,
        ]);
        return;
      }

      const dmg = DAMAGE_MAP[room.type as keyof typeof DAMAGE_MAP];
      if (dmg > 0) {
        newHp = Math.max(0, hp - dmg);
        if (room.type === "trap") {
          newStats.trapHits = stats.trapHits + 1;
        }
        const label = "⚡ 踩到陷阱";
        records.push({
          id: ++recordIdCounter,
          turn: nextTurn,
          floor,
          event: `${label}，受到${dmg}点伤害！`,
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
            event: "💀 血量归零，探索失败...",
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
          event: `💰 发现${gain}枚金币！（B${floor}F奖励加成）`,
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
          event: "🔑 找到钥匙！",
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
            event: "🚪 用钥匙打开出口，通关！",
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
          event: "🧪 发现一瓶药水！已放入背包",
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
            event: "🚪 用钥匙打开出口，通关！",
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
            event: "🚪 发现出口，但没有钥匙，无法打开",
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
          event: "· 空房间，什么也没有",
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
    [board, hp, coins, keys, potions, status, flippable, exitRevealed, turn, floor, stats, triggerSettlement]
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
          event: "❌ 背包中没有药水，无法使用",
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
          event: "❌ 血量已满，无需使用药水",
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        },
        ...prev,
      ]);
      return;
    }
    setPotions((p: number) => p - 1);
    setHp((h: number) => Math.min(MAX_HP, h + 2));
    setHistory((prev: TurnRecord[]) => [
      {
        id: ++recordIdCounter,
        turn,
        floor,
        event: "🧪 使用药水，恢复2点血量",
        hpDelta: 2,
        coinDelta: 0,
        items: [],
      },
      ...prev,
    ]);
  }, [potions, hp, status, turn, floor]);

  const endBattle = useCallback(
    (result: "won" | "lost" | "fled", finalMonster: Monster | null) => {
      setBattleState(result);
      if (result === "won" && finalMonster) {
        const gotPotion = Math.random() < finalMonster.potionDropChance;
        if (gotPotion) {
          setPotions((p) => p + 1);
        }
        setCoins((c) => c + finalMonster.coinReward);
        setStats((s) => ({ ...s, monstersDefeated: s.monstersDefeated + 1 }));
        setBoard((prev: Room[]) =>
          prev.map((r: Room, i: number) =>
            i === battleRoomIdx ? { ...r, defeated: true } : r
          )
        );
        setHistory((prev: TurnRecord[]) => [
          {
            id: ++recordIdCounter,
            turn,
            floor,
            event: `⚔️ 击败了 ${finalMonster.icon} ${finalMonster.name}！获得 ${finalMonster.coinReward} 金币${gotPotion ? "，掉落 1 瓶药水" : ""}`,
            roomType: "monster",
            hpDelta: 0,
            coinDelta: finalMonster.coinReward,
            items: gotPotion ? ["🧪 药水"] : [],
          },
          ...prev,
        ]);
      } else if (result === "fled") {
        const fleeDamage = 1;
        setHp((h) => {
          const newHp = Math.max(0, h - fleeDamage);
          if (newHp <= 0) {
            setStatus("lost");
            setTimeout(() => {
              triggerSettlement("death", floor, coins, stats, 0);
            }, 100);
          }
          return newHp;
        });
        setBoard((prev: Room[]) =>
          prev.map((r: Room, i: number) =>
            i === battleRoomIdx ? { ...r, revealed: false, defeated: false } : r
          )
        );
        setHistory((prev: TurnRecord[]) => [
          {
            id: ++recordIdCounter,
            turn,
            floor,
            event: `🏃 逃跑成功！但受到 ${fleeDamage} 点伤害，房间恢复危险状态`,
            roomType: "monster",
            hpDelta: -fleeDamage,
            coinDelta: 0,
            items: [],
          },
          ...prev,
        ]);
      } else if (result === "lost") {
        setStatus("lost");
        setHistory((prev: TurnRecord[]) => [
          {
            id: ++recordIdCounter,
            turn,
            floor,
            event: `💀 被 ${finalMonster?.icon} ${finalMonster?.name} 击败了...`,
            roomType: "monster",
            hpDelta: 0,
            coinDelta: 0,
            items: [],
          },
          ...prev,
        ]);
        setTimeout(() => {
          triggerSettlement("death", floor, coins, stats, 0);
        }, 100);
      }
    },
    [battleRoomIdx, turn, floor, coins, stats, triggerSettlement]
  );

  const battleAttack = useCallback(() => {
    if (battleState !== "fighting" || !currentMonster) return;

    const playerDamage = 1 + Math.floor(Math.random() * 2);
    const newMonsterHp = Math.max(0, currentMonster.hp - playerDamage);
    const updatedMonster = { ...currentMonster, hp: newMonsterHp };

    const newLogs: BattleLog[] = [
      createBattleLog(`你挥剑攻击，造成 ${playerDamage} 点伤害！`, "player"),
    ];

    if (newMonsterHp <= 0) {
      newLogs.push(createBattleLog(`${currentMonster.icon} ${currentMonster.name} 被击败了！`, "system"));
      const gotPotion = Math.random() < currentMonster.potionDropChance;
      newLogs.push(
        createBattleLog(
          `🎉 胜利！获得 ${currentMonster.coinReward} 金币${gotPotion ? "，掉落 1 瓶药水🧪" : ""}`,
          "reward"
        )
      );
      setCurrentMonster(updatedMonster);
      setBattleLog((prev) => [...prev, ...newLogs]);
      setTimeout(() => {
        endBattle("won", updatedMonster);
      }, 800);
      return;
    }

    const monsterDamage = currentMonster.attack;
    newLogs.push(
      createBattleLog(`${currentMonster.icon} ${currentMonster.name} 反击，造成 ${monsterDamage} 点伤害！`, "monster")
    );

    setCurrentMonster(updatedMonster);
    setBattleLog((prev) => [...prev, ...newLogs]);
    setHp((h) => {
      const newHp = Math.max(0, h - monsterDamage);
      if (newHp <= 0) {
        setTimeout(() => {
          endBattle("lost", updatedMonster);
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
        createBattleLog("❌ 背包中没有药水了！", "system"),
      ]);
      return;
    }
    if (hp >= MAX_HP) {
      setBattleLog((prev) => [
        ...prev,
        createBattleLog("❌ 血量已满，无需使用药水", "system"),
      ]);
      return;
    }
    setPotions((p) => p - 1);
    setHp((h) => Math.min(MAX_HP, h + 2));
    setBattleLog((prev) => [
      ...prev,
      createBattleLog("🧪 使用药水，恢复 2 点血量", "player"),
    ]);
  }, [battleState, potions, hp]);

  const battleFlee = useCallback(() => {
    if (battleState !== "fighting") return;
    const fleeSuccess = Math.random() < 0.7;
    if (fleeSuccess) {
      setBattleLog((prev) => [
        ...prev,
        createBattleLog("🏃 你选择逃跑...", "player"),
        createBattleLog("成功逃脱！但慌乱中受到 1 点伤害", "system"),
      ]);
      setTimeout(() => {
        endBattle("fled", currentMonster);
      }, 600);
    } else {
      const damage = currentMonster ? currentMonster.attack : 1;
      setBattleLog((prev) => [
        ...prev,
        createBattleLog("🏃 你选择逃跑...", "player"),
        createBattleLog(`逃跑失败！被怪物追击，受到 ${damage} 点伤害！`, "monster"),
      ]);
      setHp((h) => {
        const newHp = Math.max(0, h - damage);
        if (newHp <= 0) {
          setTimeout(() => {
            endBattle("lost", currentMonster);
          }, 500);
        }
        return newHp;
      });
    }
  }, [battleState, currentMonster, endBattle]);

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
          {board.map((room: Room, idx: number) => {
            const isFlippable = flippable.has(idx) && !room.revealed;
            const canClickExit =
              room.revealed && room.type === "exit" && keys > 0 && status === "playing";
            const isDefeated = room.type === "monster" && room.defeated;
            const isDisabled =
              (status !== "playing" && !room.revealed) ||
              (battleState !== "idle" && !room.revealed);
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
            在5×5地牢中逐步翻开相邻房间，寻找钥匙🔑后打开出口🚪即可进入下一层。
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
              <span>陷阱 {getFloorConfig(floor).trapCt}</span>
              <span>怪物 {getFloorConfig(floor).monsterCt}</span>
              <span>金币房 {getFloorConfig(floor).coinCt}</span>
              <span>药水 {getFloorConfig(floor).potionCt}</span>
              <span>金币 {getFloorConfig(floor).coinMin}~{getFloorConfig(floor).coinMax}/堆</span>
            </div>
          </div>
          <div className="actions">
            <button className="btn-reset" onClick={handleRestart}>
              重新探索
            </button>
            <button
              className={[
                "btn-potion",
                potions <= 0 || hp >= MAX_HP || status !== "playing" ? "btn-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={usePotion}
            >
              使用药水 (🧪 × 1 → 2❤️)
            </button>
            <button
              className="btn-next"
              onClick={nextFloor}
              disabled={status !== "won"}
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
              : `正在探索B${floor}F，血量${hp}/${MAX_HP}❤️，金币${coins}💰，药水${potions}🧪，${keys > 0 ? "已持有钥匙🔑，赶快找到出口🚪！" : "尚未找到钥匙🔑，继续翻开相邻房间小心前进！"}本层有${getFloorConfig(floor).trapCt}个陷阱⚡和${getFloorConfig(floor).monsterCt}只怪物👹，谨慎行动！`}
        </p>
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
    </main>
  );
}
