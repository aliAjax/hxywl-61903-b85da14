import { useCallback, useMemo, useState } from "react";
import "./styles.css";

const SIZE = 5;
const TOTAL = SIZE * SIZE;
const MAX_HP = 5;

type RoomType = "start" | "coin" | "trap" | "monster" | "key" | "exit" | "potion" | "empty";

interface Room {
  type: RoomType;
  revealed: boolean;
}

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
    const set = new Set<number>();
    for (let i = 0; i < TOTAL; i++) {
      if (board[i].revealed) {
        for (const n of getNeighbors(i)) {
          if (!board[n].revealed) set.add(n);
        }
      }
    }
    return set;
  }, [board]);

  const exitRevealed = useMemo(
    () => board.some((r: Room) => r.type === "exit" && r.revealed),
    [board]
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

      const dmg = DAMAGE_MAP[room.type as keyof typeof DAMAGE_MAP];
      if (dmg > 0) {
        newHp = Math.max(0, hp - dmg);
        const label = room.type === "trap" ? "⚡ 踩到陷阱" : "👹 遭遇怪物";
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
      setHistory((prev: TurnRecord[]) => [...records, ...prev]);
    },
    [board, hp, coins, keys, potions, status, flippable, exitRevealed, turn, floor]
  );

  const resetGame = useCallback(() => {
    const newFloor = 1;
    setBoard(generateBoard(newFloor));
    setHp(MAX_HP);
    setCoins(0);
    setKeys(0);
    setPotions(0);
    setFloor(newFloor);
    setStatus("playing");
    setTurn(0);
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
            return (
              <button
                key={idx}
                className={[
                  "cell",
                  room.type,
                  room.revealed ? "revealed" : "",
                  isFlippable ? "flippable" : "",
                  canClickExit ? "can-exit" : "",
                  status !== "playing" && !room.revealed ? "disabled" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => flip(idx)}
              >
                {room.revealed ? SYMBOLS[room.type as keyof typeof SYMBOLS] : "?"}
              </button>
            );
          })}
        </div>
        <aside className="side-panel">
          <h2>核心玩法</h2>
          <p>
            在5×5地牢中逐步翻开相邻房间，寻找钥匙�后打开出口🚪即可进入下一层。
            层数越高，陷阱⚡和怪物👹越多，但金币�奖励也更丰厚。
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
            <button className="btn-reset" onClick={resetGame}>
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
        <h2>结算预览</h2>
        <p>
          {status === "won"
            ? `🎉 恭喜通关B${floor}F！累计获得${coins}💰金币，当前血量${hp}/${MAX_HP}❤️，剩余${potions}瓶🧪药水。点击「进入下一层」继续向B${floor + 1}F深入，届时将有更多陷阱和怪物，但金币奖励也会更丰厚！`
            : status === "lost"
              ? `💀 探索失败，在B${floor}F血量归零。共获得${coins}💰金币，到达B${floor}F。点击「重新探索」从B1F再次挑战！`
              : `正在探索B${floor}F，血量${hp}/${MAX_HP}❤️，金币${coins}💰，药水${potions}🧪，${keys > 0 ? "已持有钥匙🔑，赶快找到出口🚪！" : "尚未找到钥匙🔑，继续翻开相邻房间小心前进！"}本层有${getFloorConfig(floor).trapCt}个陷阱⚡和${getFloorConfig(floor).monsterCt}只怪物👹，谨慎行动！`}
        </p>
      </section>
    </main>
  );
}
