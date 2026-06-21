import { RoomType, FloorConfig, getNeighbors, getTotalCells, GAME_CONSTANTS } from "./gameConfig";

export type RiskLevel = 1 | 2 | 3 | 4 | 5;

export interface RiskEstimate {
  level: RiskLevel;
  probability: number;
  confidence: number;
  label: string;
}

interface KnownRoom {
  type: RoomType;
  revealed: boolean;
}

const SIZE = GAME_CONSTANTS.boardSize;
const TOTAL = getTotalCells();
const START_IDX = 0;

const RISK_LABELS: Record<RiskLevel, string> = {
  1: "极安全",
  2: "较安全",
  3: "中等",
  4: "较危险",
  5: "极危险",
};

function isDangerous(type: RoomType): boolean {
  return type === "trap" || type === "monster";
}

function countRevealedByType(rooms: KnownRoom[]): Record<RoomType, number> {
  const counts: Record<RoomType, number> = {
    start: 0, coin: 0, trap: 0, monster: 0, key: 0, exit: 0, potion: 0, empty: 0,
  };
  for (const r of rooms) {
    if (r.revealed) counts[r.type]++;
  }
  return counts;
}

function bfsDistancesFromRevealed(rooms: KnownRoom[]): number[] {
  const dist = new Array<number>(TOTAL).fill(Infinity);
  const queue: number[] = [];
  for (let i = 0; i < TOTAL; i++) {
    if (rooms[i].revealed) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of getNeighbors(cur)) {
      if (dist[n] === Infinity) {
        dist[n] = dist[cur] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

function countRevealedDangerousNeighbors(rooms: KnownRoom[], idx: number): number {
  let count = 0;
  for (const n of getNeighbors(idx)) {
    if (rooms[n].revealed && isDangerous(rooms[n].type)) {
      count++;
    }
  }
  return count;
}

function countRevealedSafeNeighbors(rooms: KnownRoom[], idx: number): number {
  let count = 0;
  for (const n of getNeighbors(idx)) {
    if (rooms[n].revealed && !isDangerous(rooms[n].type)) {
      count++;
    }
  }
  return count;
}

function countAllNeighbors(idx: number): number {
  return getNeighbors(idx).length;
}

function reachableUnrevealedCount(rooms: KnownRoom[], blockIdx: number): number {
  const visited = new Array<boolean>(TOTAL).fill(false);
  const queue: number[] = [START_IDX];
  visited[START_IDX] = true;
  let count = 0;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of getNeighbors(cur)) {
      if (visited[n]) continue;
      if (n === blockIdx) continue;
      if (rooms[n].revealed && isDangerous(rooms[n].type)) continue;
      visited[n] = true;
      if (!rooms[n].revealed) count++;
      queue.push(n);
    }
  }
  return count;
}

function totalUnrevealedCount(rooms: KnownRoom[]): number {
  let count = 0;
  for (const r of rooms) {
    if (!r.revealed) count++;
  }
  return count;
}

function findKeyOrExitAmongRevealed(rooms: KnownRoom[]): number | null {
  for (let i = 0; i < TOTAL; i++) {
    if (rooms[i].revealed && (rooms[i].type === "key" || rooms[i].type === "exit")) {
      return i;
    }
  }
  return null;
}

function probabilityToLevel(prob: number): RiskLevel {
  if (prob < 0.2) return 1;
  if (prob < 0.4) return 2;
  if (prob < 0.6) return 3;
  if (prob < 0.8) return 4;
  return 5;
}

function manhattanDist(a: number, b: number): number {
  const ar = Math.floor(a / SIZE), ac = a % SIZE;
  const br = Math.floor(b / SIZE), bc = b % SIZE;
  return Math.abs(ar - br) + Math.abs(ac - bc);
}

export function estimateRoomRisks(
  rooms: KnownRoom[],
  floorCfg: FloorConfig
): RiskEstimate[] {
  const revealedCounts = countRevealedByType(rooms);
  const remainingTraps = Math.max(0, floorCfg.trapCt - revealedCounts.trap);
  const remainingMonsters = Math.max(0, floorCfg.monsterCt - revealedCounts.monster);
  const remainingDangerous = remainingTraps + remainingMonsters;

  const unrevealedCount = totalUnrevealedCount(rooms);
  const baseProb = unrevealedCount > 0 ? remainingDangerous / unrevealedCount : 0;
  const distances = bfsDistancesFromRevealed(rooms);

  const keyRevealed = revealedCounts.key > 0;
  const exitRevealed = revealedCounts.exit > 0;
  const keyOrExitIdx = findKeyOrExitAmongRevealed(rooms);

  const estimates: RiskEstimate[] = [];

  for (let i = 0; i < TOTAL; i++) {
    if (rooms[i].revealed) {
      estimates.push({
        level: isDangerous(rooms[i].type) ? 5 : 1,
        probability: isDangerous(rooms[i].type) ? 1 : 0,
        confidence: 1,
        label: isDangerous(rooms[i].type) ? "危险" : "安全",
      });
      continue;
    }

    let prob = baseProb;
    let confidence = 0.1;

    const distance = distances[i];
    const totalNeighbors = countAllNeighbors(i);
    const dangerNeighbors = countRevealedDangerousNeighbors(rooms, i);
    const safeNeighbors = countRevealedSafeNeighbors(rooms, i);
    const revealedNeighbors = dangerNeighbors + safeNeighbors;

    if (revealedNeighbors > 0) {
      confidence = Math.min(0.8, 0.2 + revealedNeighbors / totalNeighbors * 0.6);
    }

    if (dangerNeighbors >= 2) {
      prob += 0.28;
      confidence = Math.max(confidence, 0.55);
    } else if (dangerNeighbors >= 1) {
      prob += 0.16;
      confidence = Math.max(confidence, 0.4);
    }

    if (safeNeighbors >= 3) {
      prob -= 0.28;
      confidence = Math.max(confidence, 0.55);
    } else if (safeNeighbors >= 2) {
      prob -= 0.18;
      confidence = Math.max(confidence, 0.4);
    } else if (safeNeighbors >= 1) {
      prob -= 0.09;
      confidence = Math.max(confidence, 0.25);
    }

    if (distance === 1) {
      confidence += 0.1;
    }

    const distFromStart = manhattanDist(START_IDX, i);
    if (distFromStart <= 1) {
      prob -= 0.08;
    } else if (distFromStart <= 2) {
      prob -= 0.04;
    } else if (distFromStart <= 3) {
      prob -= 0.02;
    }

    const blockedReachable = reachableUnrevealedCount(rooms, i);
    const totalUnrev = unrevealedCount;
    const blockImpact = totalUnrev > 0 ? (totalUnrev - blockedReachable) / totalUnrev : 0;

    if (blockImpact > 0.2) {
      prob -= 0.25 * blockImpact;
      confidence = Math.max(confidence, 0.35 * blockImpact);
    }

    if (keyOrExitIdx !== null && !keyRevealed !== !exitRevealed) {
      const targetDist = manhattanDist(keyOrExitIdx, i);
      if (targetDist <= 2) {
        prob -= 0.06;
      }
    }

    if (distance >= 5) {
      prob = baseProb + (prob - baseProb) * 0.1;
      confidence *= 0.25;
    } else if (distance >= 4) {
      prob = baseProb + (prob - baseProb) * 0.3;
      confidence *= 0.45;
    } else if (distance >= 3) {
      prob = baseProb + (prob - baseProb) * 0.6;
      confidence *= 0.7;
    }

    prob = Math.max(0.05, Math.min(0.95, prob));
    confidence = Math.max(0.05, Math.min(0.9, confidence));

    const level = probabilityToLevel(prob);
    estimates.push({
      level,
      probability: prob,
      confidence,
      label: RISK_LABELS[level],
    });
  }

  return estimates;
}

export function getRiskColor(level: RiskLevel): string {
  switch (level) {
    case 1: return "#22c55e";
    case 2: return "#84cc16";
    case 3: return "#eab308";
    case 4: return "#f97316";
    case 5: return "#ef4444";
  }
}

export function getRiskIcon(level: RiskLevel): string {
  switch (level) {
    case 1: return "🟢";
    case 2: return "🔵";
    case 3: return "🟡";
    case 4: return "🟠";
    case 5: return "🔴";
  }
}

export function getRiskShortLabel(level: RiskLevel): string {
  switch (level) {
    case 1: return "安";
    case 2: return "稳";
    case 3: return "中";
    case 4: return "险";
    case 5: return "危";
  }
}
