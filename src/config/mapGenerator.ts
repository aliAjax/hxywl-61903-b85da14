import {
  RoomType,
  FloorConfig,
  getFloorConfig,
  getDamage,
  shuffle,
  getNeighbors,
  getTotalCells,
  GAME_CONSTANTS,
  RouteType,
} from "./gameConfig";

export interface GenerationResult {
  rooms: RoomType[];
  stats: GenerationStats;
  verification: VerificationResult;
}

export interface GenerationStats {
  attempts: number;
  pathLength: number;
  keyPathDamage: number;
  exitPathDamage: number;
  totalPathDamage: number;
  roomCounts: Record<RoomType, number>;
  branchingFactor: number;
}

export interface VerificationResult {
  valid: boolean;
  keyReachable: boolean;
  exitReachable: boolean;
  keyToExitReachable: boolean;
  pathDamageAcceptable: boolean;
  noTrapDeadEnd: boolean;
  issues: string[];
  safePath?: number[];
}

export interface DebugMapOptions {
  showPath?: boolean;
  showDamage?: boolean;
  compact?: boolean;
}

const SIZE = GAME_CONSTANTS.boardSize;
const TOTAL = getTotalCells();
const START_IDX = 0;

function bfsReachable(rooms: RoomType[], start: number, passable?: (t: RoomType) => boolean): boolean[] {
  const visited = new Array<boolean>(TOTAL).fill(false);
  const queue: number[] = [start];
  visited[start] = true;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of getNeighbors(cur)) {
      if (!visited[n] && (!passable || passable(rooms[n]))) {
        visited[n] = true;
        queue.push(n);
      }
    }
  }
  return visited;
}

function bfsPath(rooms: RoomType[], start: number, end: number, passable?: (t: RoomType) => boolean): number[] | null {
  const prev = new Array<number>(TOTAL).fill(-1);
  const visited = new Array<boolean>(TOTAL).fill(false);
  const queue: number[] = [start];
  visited[start] = true;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === end) {
      const path: number[] = [];
      let node = end;
      while (node !== -1) {
        path.unshift(node);
        node = prev[node];
      }
      return path;
    }
    for (const n of getNeighbors(cur)) {
      if (!visited[n] && (!passable || passable(rooms[n]))) {
        visited[n] = true;
        prev[n] = cur;
        queue.push(n);
      }
    }
  }
  return null;
}

function dijkstraMinDamage(rooms: RoomType[], start: number, end: number): { damage: number; path: number[] } {
  const dist = new Array<number>(TOTAL).fill(Infinity);
  const prev = new Array<number>(TOTAL).fill(-1);
  const visited = new Set<number>();
  dist[start] = 0;
  for (let iter = 0; iter < TOTAL; iter++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < TOTAL; i++) {
      if (!visited.has(i) && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u === -1 || u === end) break;
    visited.add(u);
    for (const v of getNeighbors(u)) {
      if (!visited.has(v)) {
        const alt = dist[u] + getDamage(rooms[v]);
        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      }
    }
  }
  const path: number[] = [];
  if (dist[end] < Infinity) {
    let node = end;
    while (node !== -1) {
      path.unshift(node);
      node = prev[node];
    }
  }
  return { damage: dist[end], path };
}

function randomWalkPath(from: number, to: number): number[] {
  const path: number[] = [from];
  const visited = new Set<number>([from]);
  let cur = from;
  let safety = TOTAL * 4;
  while (cur !== to && safety-- > 0) {
    const neighbors = shuffle(getNeighbors(cur)).filter((n) => !visited.has(n));
    if (neighbors.length === 0) {
      for (let i = path.length - 2; i >= 0; i--) {
        const backup = path[i];
        const backupNeighbors = shuffle(getNeighbors(backup)).filter((n) => !visited.has(n));
        if (backupNeighbors.length > 0) {
          path.length = i + 1;
          cur = backup;
          break;
        }
      }
      if (path.length === 0) break;
      continue;
    }
    const tr = Math.floor(to / SIZE);
    const tc = to % SIZE;
    const cr = Math.floor(cur / SIZE);
    const cc = cur % SIZE;
    const towards = neighbors.filter((n) => {
      const nr = Math.floor(n / SIZE);
      const nc = n % SIZE;
      return Math.abs(nr - tr) + Math.abs(nc - tc) < Math.abs(cr - tr) + Math.abs(cc - tc);
    });
    const pool = towards.length > 0 && Math.random() < 0.7 ? towards : neighbors;
    const next = pool[Math.floor(Math.random() * pool.length)];
    visited.add(next);
    path.push(next);
    cur = next;
  }
  if (cur !== to) {
    const directPath = bfsPath(new Array<RoomType>(TOTAL).fill("empty"), from, to);
    if (directPath) return directPath;
  }
  return path;
}

function countRooms(rooms: RoomType[]): Record<RoomType, number> {
  const counts: Record<RoomType, number> = {
    start: 0, coin: 0, trap: 0, monster: 0, key: 0, exit: 0, potion: 0, empty: 0,
  };
  for (const r of rooms) counts[r]++;
  return counts;
}

function countReachableFromStart(rooms: RoomType[]): number {
  return bfsReachable(rooms, START_IDX).filter(Boolean).length;
}

export function verifyMap(rooms: RoomType[], maxPathDamage: number): VerificationResult {
  const issues: string[] = [];
  const keyIdx = rooms.indexOf("key");
  const exitIdx = rooms.indexOf("exit");
  if (keyIdx === -1) {
    issues.push("地图中缺少钥匙");
  }
  if (exitIdx === -1) {
    issues.push("地图中缺少出口");
  }
  const allPassable = () => true;
  const keyReachable = keyIdx !== -1 && bfsReachable(rooms, START_IDX, allPassable)[keyIdx];
  const exitReachable = exitIdx !== -1 && bfsReachable(rooms, START_IDX, allPassable)[exitIdx];
  const keyToExitReachable = keyIdx !== -1 && exitIdx !== -1 && bfsReachable(rooms, keyIdx, allPassable)[exitIdx];
  if (!keyReachable) issues.push("钥匙不可达");
  if (!exitReachable) issues.push("出口不可达");
  if (!keyToExitReachable) issues.push("钥匙到出口的路径不连通");
  const { damage: totalDamage, path } = dijkstraMinDamage(rooms, START_IDX, exitIdx);
  const { damage: keyDamage } = dijkstraMinDamage(rooms, START_IDX, keyIdx);
  const { damage: exitDamage } = dijkstraMinDamage(rooms, keyIdx, exitIdx);
  const pathDamageAcceptable = keyDamage + exitDamage <= maxPathDamage;
  if (!pathDamageAcceptable) {
    issues.push(`路径伤害(${keyDamage + exitDamage})超过上限(${maxPathDamage})`);
  }
  let noTrapDeadEnd = true;
  for (let i = 0; i < TOTAL; i++) {
    if (rooms[i] === "trap" || rooms[i] === "monster") {
      const neighbors = getNeighbors(i);
      const safeNeighbors = neighbors.filter(
        (n) => rooms[n] !== "trap" && rooms[n] !== "monster"
      );
      if (safeNeighbors.length === 0 && neighbors.length > 0) {
        noTrapDeadEnd = false;
        issues.push(`位置${i}(${rooms[i]})周围全是危险房间`);
      }
    }
  }
  const valid =
    keyIdx !== -1 &&
    exitIdx !== -1 &&
    keyReachable &&
    exitReachable &&
    keyToExitReachable &&
    pathDamageAcceptable &&
    noTrapDeadEnd;
  return {
    valid,
    keyReachable,
    exitReachable,
    keyToExitReachable,
    pathDamageAcceptable,
    noTrapDeadEnd,
    issues,
    safePath: path.length > 0 ? path : undefined,
  };
}

function generateSafeCorridor(floor: number, route: RouteType = null): RoomType[] {
  const cfg = getFloorConfig(floor, route);
  const rooms: RoomType[] = new Array<RoomType>(TOTAL).fill("empty");
  rooms[START_IDX] = "start";
  const farPositions = Array.from({ length: TOTAL }, (_, i) => i)
    .filter((i) => i !== START_IDX)
    .sort((a, b) => {
      const ar = Math.floor(a / SIZE), ac = a % SIZE;
      const br = Math.floor(b / SIZE), bc = b % SIZE;
      const sr = Math.floor(START_IDX / SIZE), sc = START_IDX % SIZE;
      return (Math.abs(br - sr) + Math.abs(bc - sc)) - (Math.abs(ar - sr) + Math.abs(ac - sc));
    });
  const keyPool = farPositions.slice(0, Math.floor(farPositions.length * 0.5));
  const exitPool = farPositions.slice(0, Math.floor(farPositions.length * 0.3));
  const keyIdx = keyPool[Math.floor(Math.random() * keyPool.length)];
  let exitIdx = exitPool[Math.floor(Math.random() * exitPool.length)];
  while (exitIdx === keyIdx) {
    exitIdx = exitPool[Math.floor(Math.random() * exitPool.length)];
  }
  rooms[keyIdx] = "key";
  rooms[exitIdx] = "exit";
  const path1 = randomWalkPath(START_IDX, keyIdx);
  const path2 = randomWalkPath(keyIdx, exitIdx);
  const pathSet = new Set<number>([...path1, ...path2]);
  const pathArr = Array.from(pathSet);
  const dangerBudget = Math.floor(cfg.pathMaxDamage * 0.4);
  let dangerUsed = 0;
  const shuffledPath = shuffle(pathArr.filter(
    (i) => i !== START_IDX && i !== keyIdx && i !== exitIdx
  ));
  for (const idx of shuffledPath) {
    if (dangerUsed >= dangerBudget) break;
    if (Math.random() < 0.3) {
      const useTrap = Math.random() < 0.6;
      const dmg = useTrap ? getDamage("trap") : getDamage("monster");
      if (dangerUsed + dmg <= dangerBudget) {
        rooms[idx] = useTrap ? "trap" : "monster";
        dangerUsed += dmg;
      }
    }
  }
  const offPath = shuffle(
    Array.from({ length: TOTAL }, (_, i) => i).filter((i) => !pathSet.has(i))
  );
  let offIdx = 0;
  const targetCoin = Math.max(1, cfg.coinCt - 1);
  const targetTrap = Math.max(1, cfg.trapCt - 1);
  const targetMonster = Math.max(1, cfg.monsterCt - 1);
  const targetPotion = cfg.potionCt;
  for (let i = 0; i < targetCoin && offIdx < offPath.length; i++, offIdx++) {
    rooms[offPath[offIdx]] = "coin";
  }
  for (let i = 0; i < targetTrap && offIdx < offPath.length; i++, offIdx++) {
    rooms[offPath[offIdx]] = "trap";
  }
  for (let i = 0; i < targetMonster && offIdx < offPath.length; i++, offIdx++) {
    rooms[offPath[offIdx]] = "monster";
  }
  for (let i = 0; i < targetPotion && offIdx < offPath.length; i++, offIdx++) {
    rooms[offPath[offIdx]] = "potion";
  }
  return rooms;
}

function mixupRooms(rooms: RoomType[], floor: number, route: RouteType = null): RoomType[] {
  const cfg = getFloorConfig(floor, route);
  const result = [...rooms];
  const keyIdx = result.indexOf("key");
  const exitIdx = result.indexOf("exit");
  const swappable = Array.from({ length: TOTAL }, (_, i) => i).filter(
    (i) => i !== START_IDX && i !== keyIdx && i !== exitIdx
  );
  const shuffleTimes = Math.floor(swappable.length * 0.4);
  for (let i = 0; i < shuffleTimes; i++) {
    const a = swappable[Math.floor(Math.random() * swappable.length)];
    const b = swappable[Math.floor(Math.random() * swappable.length)];
    if (a !== b) {
      [result[a], result[b]] = [result[b], result[a]];
    }
  }
  return result;
}

export function generateMap(floor: number = 1, route: RouteType = null): GenerationResult {
  const cfg = getFloorConfig(floor, route);
  let bestResult: GenerationResult | null = null;
  let bestDamage = Infinity;
  const maxAttempts = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let rooms = generateSafeCorridor(floor, route);
    if (attempt > 5) {
      rooms = mixupRooms(rooms, floor, route);
    }
    const verification = verifyMap(rooms, cfg.pathMaxDamage);
    const { damage: keyDmg } = dijkstraMinDamage(rooms, START_IDX, rooms.indexOf("key"));
    const { damage: exitDmg } = dijkstraMinDamage(rooms, rooms.indexOf("key"), rooms.indexOf("exit"));
    const totalDmg = keyDmg + exitDmg;
    const { path } = dijkstraMinDamage(rooms, START_IDX, rooms.indexOf("exit"));
    const stats: GenerationStats = {
      attempts: attempt + 1,
      pathLength: path.length,
      keyPathDamage: keyDmg,
      exitPathDamage: exitDmg,
      totalPathDamage: totalDmg,
      roomCounts: countRooms(rooms),
      branchingFactor: countReachableFromStart(rooms) / Math.max(1, path.length),
    };
    const result: GenerationResult = { rooms, stats, verification };
    if (verification.valid) {
      return result;
    }
    if (totalDmg < bestDamage) {
      bestDamage = totalDmg;
      bestResult = result;
    }
  }
  if (bestResult) {
    return bestResult;
  }
  const fallback = generateFallbackMap(floor, route);
  return fallback;
}

function generateFallbackMap(floor: number, route: RouteType = null): GenerationResult {
  const cfg = getFloorConfig(floor, route);
  const rooms: RoomType[] = new Array<RoomType>(TOTAL).fill("empty");
  rooms[0] = "start";
  rooms[12] = "key";
  rooms[24] = "exit";
  const safeCorridor = new Set([0, 1, 2, 7, 12, 17, 22, 23, 24]);
  const allPositions = Array.from({ length: TOTAL }, (_, i) => i);
  const available = shuffle(allPositions.filter((i) => !safeCorridor.has(i)));
  const fbTrap = Math.min(cfg.trapCt, 3);
  const fbMonster = Math.min(cfg.monsterCt, 3);
  const fbCoin = Math.min(cfg.coinCt, 6);
  const fbPotion = cfg.potionCt;
  let idx = 0;
  for (let i = 0; i < fbTrap && idx < available.length; i++, idx++) rooms[available[idx]] = "trap";
  for (let i = 0; i < fbMonster && idx < available.length; i++, idx++) rooms[available[idx]] = "monster";
  for (let i = 0; i < fbCoin && idx < available.length; i++, idx++) rooms[available[idx]] = "coin";
  for (let i = 0; i < fbPotion && idx < available.length; i++, idx++) rooms[available[idx]] = "potion";
  const verification = verifyMap(rooms, cfg.pathMaxDamage);
  const { damage: keyDmg } = dijkstraMinDamage(rooms, START_IDX, 12);
  const { damage: exitDmg } = dijkstraMinDamage(rooms, 12, 24);
  const { path } = dijkstraMinDamage(rooms, START_IDX, 24);
  return {
    rooms,
    stats: {
      attempts: 0,
      pathLength: path.length,
      keyPathDamage: keyDmg,
      exitPathDamage: exitDmg,
      totalPathDamage: keyDmg + exitDmg,
      roomCounts: countRooms(rooms),
      branchingFactor: countReachableFromStart(rooms) / Math.max(1, path.length),
    },
    verification,
  };
}

export function printMapDebug(
  rooms: RoomType[],
  options: DebugMapOptions = {}
): string {
  const { showPath = false, showDamage = false, compact = false } = options;
  const symbols: Record<RoomType, string> = {
    start: "🏠", coin: "💰", trap: "⚡", monster: "👹",
    key: "🔑", exit: "🚪", potion: "🧪", empty: "·",
  };
  let pathSet: Set<number> = new Set();
  if (showPath) {
    const keyIdx = rooms.indexOf("key");
    const exitIdx = rooms.indexOf("exit");
    const p1 = bfsPath(rooms, START_IDX, keyIdx) || [];
    const p2 = bfsPath(rooms, keyIdx, exitIdx) || [];
    pathSet = new Set([...p1, ...p2]);
  }
  let lines: string[] = [];
  for (let r = 0; r < SIZE; r++) {
    let row = "";
    for (let c = 0; c < SIZE; c++) {
      const idx = r * SIZE + c;
      const sym = symbols[rooms[idx]];
      if (showPath && pathSet.has(idx)) {
        row += `[${sym}]`;
      } else {
        row += ` ${sym} `;
      }
      if (!compact && c < SIZE - 1) row += " ";
    }
    lines.push(row);
  }
  if (showDamage) {
    const keyIdx = rooms.indexOf("key");
    const exitIdx = rooms.indexOf("exit");
    const { damage: d1 } = dijkstraMinDamage(rooms, START_IDX, keyIdx);
    const { damage: d2 } = dijkstraMinDamage(rooms, keyIdx, exitIdx);
    lines.push(`路径伤害: 起点→钥匙=${d1}, 钥匙→出口=${d2}, 总计=${d1 + d2}`);
  }
  return lines.join("\n");
}

export function runGenerationDiagnostics(
  floor: number,
  iterations: number = 100,
  route: RouteType = null
): {
  successRate: number;
  avgAttempts: number;
  avgPathDamage: number;
  minPathDamage: number;
  maxPathDamage: number;
  commonIssues: Record<string, number>;
} {
  let successCount = 0;
  let totalAttempts = 0;
  let totalDamage = 0;
  let minDmg = Infinity;
  let maxDmg = -Infinity;
  const issues: Record<string, number> = {};
  for (let i = 0; i < iterations; i++) {
    const result = generateMap(floor, route);
    totalAttempts += result.stats.attempts;
    totalDamage += result.stats.totalPathDamage;
    minDmg = Math.min(minDmg, result.stats.totalPathDamage);
    maxDmg = Math.max(maxDmg, result.stats.totalPathDamage);
    if (result.verification.valid) {
      successCount++;
    }
    for (const issue of result.verification.issues) {
      issues[issue] = (issues[issue] || 0) + 1;
    }
  }
  return {
    successRate: successCount / iterations,
    avgAttempts: totalAttempts / iterations,
    avgPathDamage: totalDamage / iterations,
    minPathDamage: minDmg,
    maxPathDamage: maxDmg,
    commonIssues: issues,
  };
}
