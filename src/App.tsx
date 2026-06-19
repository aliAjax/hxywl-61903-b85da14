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

function generateBoard(): Room[] {
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
    const coinCt = 5;
    const trapCt = 4;
    const monsterCt = 3;
    const potionCt = 2;
    for (let i = 0; i < rest.length; i++) {
      if (i < coinCt) types[rest[i]] = "coin";
      else if (i < coinCt + trapCt) types[rest[i]] = "trap";
      else if (i < coinCt + trapCt + monsterCt) types[rest[i]] = "monster";
      else if (i < coinCt + trapCt + monsterCt + potionCt) types[rest[i]] = "potion";
    }
    const d1 = minDamagePath(types, 0, keyIdx);
    const d2 = minDamagePath(types, keyIdx, exitIdx);
    if (d1 + d2 < MAX_HP) {
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
  for (let i = 0; i < 3 && i < available.length; i++) fallback[available[i]] = "trap";
  for (let i = 3; i < 5 && i < available.length; i++) fallback[available[i]] = "monster";
  for (let i = 5; i < 10 && i < available.length; i++) fallback[available[i]] = "coin";
  for (let i = 10; i < 12 && i < available.length; i++) fallback[available[i]] = "potion";
  return fallback.map((t) => ({ type: t, revealed: t === "start" }));
}

export default function App() {
  const [board, setBoard] = useState<Room[]>(generateBoard);
  const [hp, setHp] = useState(MAX_HP);
  const [coins, setCoins] = useState(0);
  const [keys, setKeys] = useState(0);
  const [potions, setPotions] = useState(0);
  const [floor, setFloor] = useState(1);
  const [status, setStatus] = useState<"playing" | "won" | "lost">("playing");
  const [log, setLog] = useState<string[]>(["🏠 游戏开始！翻开相邻房间探索地牢"]);

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
          setLog((prev: string[]) => ["🚪 用钥匙打开出口，通关！", ...prev].slice(0, 20));
        }
        return;
      }
      if (!flippable.has(idx)) return;

      const messages: string[] = [];
      let newHp = hp;
      let newCoins = coins;
      let newKeys = keys;
      let newPotions = potions;
      let newStatus: "playing" | "won" | "lost" = "playing";

      const dmg = DAMAGE_MAP[room.type as keyof typeof DAMAGE_MAP];
      if (dmg > 0) {
        newHp = Math.max(0, hp - dmg);
        const label = room.type === "trap" ? "⚡ 踩到陷阱" : "👹 遭遇怪物";
        messages.push(`${label}，受到${dmg}点伤害！`);
        if (newHp <= 0) {
          newStatus = "lost";
          messages.push("💀 血量归零，探索失败...");
        }
      } else if (room.type === "coin") {
        const gain = 1 + Math.floor(Math.random() * 3);
        newCoins = coins + gain;
        messages.push(`💰 发现${gain}枚金币！`);
      } else if (room.type === "key") {
        newKeys = keys + 1;
        messages.push("🔑 找到钥匙！");
        if (exitRevealed) {
          newStatus = "won";
          messages.push("🚪 用钥匙打开出口，通关！");
        }
      } else if (room.type === "potion") {
        newPotions = potions + 1;
        messages.push("🧪 发现一瓶药水！已放入背包");
      } else if (room.type === "exit") {
        if (keys > 0) {
          newStatus = "won";
          messages.push("🚪 用钥匙打开出口，通关！");
        } else {
          messages.push("🚪 发现出口，但没有钥匙，无法打开");
        }
      } else if (room.type === "empty") {
        messages.push("· 空房间，什么也没有");
      }

      setBoard((prev: Room[]) =>
        prev.map((r: Room, i: number) => (i === idx ? { ...r, revealed: true } : r))
      );
      setHp(newHp);
      setCoins(newCoins);
      setKeys(newKeys);
      setPotions(newPotions);
      setStatus(newStatus);
      setLog((prev: string[]) => [...messages, ...prev].slice(0, 20));
    },
    [board, hp, coins, keys, potions, status, flippable, exitRevealed]
  );

  const resetGame = useCallback(() => {
    setBoard(generateBoard());
    setHp(MAX_HP);
    setCoins(0);
    setKeys(0);
    setPotions(0);
    setFloor(1);
    setStatus("playing");
    setLog(["🏠 重新开始探索！"]);
  }, []);

  const nextFloor = useCallback(() => {
    setBoard(generateBoard());
    setFloor((f: number) => f + 1);
    setKeys(0);
    setStatus("playing");
    setLog((prev: string[]) => ["⬆️ 进入下一层！", ...prev].slice(0, 20));
  }, []);

  const usePotion = useCallback(() => {
    if (status !== "playing") {
      setLog((prev: string[]) => ["❌ 游戏未进行中，无法使用药水", ...prev].slice(0, 20));
      return;
    }
    if (potions <= 0) {
      setLog((prev: string[]) => ["❌ 背包中没有药水，无法使用", ...prev].slice(0, 20));
      return;
    }
    if (hp >= MAX_HP) {
      setLog((prev: string[]) => ["❌ 血量已满，无需使用药水", ...prev].slice(0, 20));
      return;
    }
    setPotions((p: number) => p - 1);
    setHp((h: number) => Math.min(MAX_HP, h + 2));
    setLog((prev: string[]) => ["🧪 使用药水，恢复2点血量", ...prev].slice(0, 20));
  }, [potions, hp, status]);

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
            在5×5地牢中逐步翻开相邻房间，可能遇到金币💰、陷阱⚡、怪物👹、药水🧪、钥匙🔑和出口🚪。
            找到钥匙后前往出口即可通关，血量归零则失败。药水可以恢复血量。
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
          <div className="actions">
            <button className="btn-reset" onClick={resetGame}>
              重新探索
            </button>
            <button
              className="btn-potion"
              onClick={usePotion}
              disabled={potions <= 0 || hp >= MAX_HP || status !== "playing"}
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
          <div className="log">
            {log.map((msg: string, i: number) => (
              <p key={i} className={i === 0 ? "log-latest" : ""}>
                {msg}
              </p>
            ))}
          </div>
        </aside>
      </section>

      <section className="result-panel">
        <h2>结算预览</h2>
        <p>
          {status === "won"
            ? `🎉 恭喜通关第${floor}层！获得${coins}金币，剩余${potions}瓶药水。点击「进入下一层」继续冒险！`
            : status === "lost"
              ? "💀 探索失败，血量归零。点击「重新探索」再来一局！"
              : `正在探索第${floor}层，血量${hp}，金币${coins}，药水${potions}瓶，${keys > 0 ? "已持有钥匙🔑" : "尚未找到钥匙"}。继续翻开相邻房间前进！`}
        </p>
      </section>
    </main>
  );
}
