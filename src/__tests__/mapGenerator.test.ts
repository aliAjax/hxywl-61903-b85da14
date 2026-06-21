import { describe, it, expect } from "vitest";
import { generateMap, verifyMap } from "../config/mapGenerator";
import { getFloorConfig, GAME_CONSTANTS, RoomType } from "../config/gameConfig";

const SIZE = GAME_CONSTANTS.boardSize;
const TOTAL = SIZE * SIZE;
const START_IDX = 0;

function assertCompletePassability(
  result: ReturnType<typeof generateMap>,
  floor: number,
  route: "safe" | "greedy" | "dangerous" | null = null
) {
  const { rooms, stats, verification } = result;
  const cfg = getFloorConfig(floor, route);
  const keyIdx = rooms.indexOf("key");
  const exitIdx = rooms.indexOf("exit");

  expect(rooms).toHaveLength(TOTAL);

  expect(rooms[START_IDX]).toBe("start");
  expect(rooms.filter((r) => r === "start").length).toBe(1);

  expect(keyIdx).not.toBe(-1);
  expect(rooms.filter((r) => r === "key").length).toBe(1);

  expect(exitIdx).not.toBe(-1);
  expect(rooms.filter((r) => r === "exit").length).toBe(1);

  expect(keyIdx).not.toBe(exitIdx);
  expect(keyIdx).not.toBe(START_IDX);
  expect(exitIdx).not.toBe(START_IDX);

  expect(verification.valid).toBe(true);
  expect(verification.keyReachable).toBe(true);
  expect(verification.exitReachable).toBe(true);
  expect(verification.keyToExitReachable).toBe(true);
  expect(verification.pathDamageAcceptable).toBe(true);
  expect(verification.noTrapDeadEnd).toBe(true);
  expect(verification.issues).toHaveLength(0);

  expect(verification.safePath).toBeDefined();
  expect(Array.isArray(verification.safePath)).toBe(true);
  expect(verification.safePath!.length).toBeGreaterThan(1);
  expect(verification.safePath![0]).toBe(START_IDX);
  expect(verification.safePath![verification.safePath!.length - 1]).toBe(exitIdx);

  expect(stats.totalPathDamage).toBeLessThanOrEqual(cfg.pathMaxDamage);
  expect(stats.keyPathDamage + stats.exitPathDamage).toBe(stats.totalPathDamage);
  expect(stats.pathLength).toBe(verification.safePath!.length);
  expect(stats.attempts).toBeGreaterThanOrEqual(1);
  expect(stats.roomCounts.start).toBe(1);
  expect(stats.roomCounts.key).toBe(1);
  expect(stats.roomCounts.exit).toBe(1);

  const allCounts = Object.values(stats.roomCounts).reduce((a, b) => a + b, 0);
  expect(allCounts).toBe(TOTAL);
}

describe("generateMap", () => {
  it("floor 1 map passes complete passability check", () => {
    const result = generateMap(1);
    assertCompletePassability(result, 1);
  });

  it("passes complete passability across multiple floors (1-10)", () => {
    for (let floor = 1; floor <= 10; floor++) {
      const result = generateMap(floor);
      assertCompletePassability(result, floor);
    }
  });

  it("passes complete passability for every route type", () => {
    const routes: Array<"safe" | "greedy" | "dangerous"> = ["safe", "greedy", "dangerous"];
    for (const route of routes) {
      const result = generateMap(1, route);
      assertCompletePassability(result, 1, route);
    }
  });

  it("passes complete passability for routes on higher floors", () => {
    const routes: Array<"safe" | "greedy" | "dangerous"> = ["safe", "greedy", "dangerous"];
    for (const route of routes) {
      const result = generateMap(5, route);
      assertCompletePassability(result, 5, route);
    }
  });

  it("consistently produces valid maps across 20 generations", () => {
    for (let i = 0; i < 20; i++) {
      const result = generateMap(1);
      assertCompletePassability(result, 1);
    }
  });

  it("safePath is a valid contiguous path (each step is adjacent)", () => {
    const result = generateMap(1);
    const path = result.verification.safePath!;
    expect(path.length).toBeGreaterThan(1);
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const curr = path[i];
      const pr = Math.floor(prev / SIZE);
      const pc = prev % SIZE;
      const cr = Math.floor(curr / SIZE);
      const cc = curr % SIZE;
      const manhattan = Math.abs(pr - cr) + Math.abs(pc - cc);
      expect(manhattan).toBe(1);
    }
  });

  it("stats.attempts should not exceed maxAttempts (50)", () => {
    const result = generateMap(1);
    expect(result.stats.attempts).toBeGreaterThanOrEqual(1);
    expect(result.stats.attempts).toBeLessThanOrEqual(50);
  });

  it("room counts match actual room array", () => {
    const result = generateMap(1);
    const actualCounts: Record<string, number> = {};
    for (const r of result.rooms) {
      actualCounts[r] = (actualCounts[r] || 0) + 1;
    }
    expect(result.stats.roomCounts).toEqual(expect.objectContaining(actualCounts));
  });

  it("branching factor is >= 1 (at least the path itself)", () => {
    const result = generateMap(1);
    expect(result.stats.branchingFactor).toBeGreaterThanOrEqual(1);
  });
});

function makeEmptyRooms(): RoomType[] {
  return new Array(TOTAL).fill("empty") as RoomType[];
}

describe("verifyMap", () => {
  it("should reject a map without a key", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[TOTAL - 1] = "exit";
    const v = verifyMap(rooms, 99);
    expect(v.valid).toBe(false);
    expect(v.keyReachable).toBe(false);
    expect(v.issues).toContain("地图中缺少钥匙");
  });

  it("should reject a map without an exit", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    const v = verifyMap(rooms, 99);
    expect(v.valid).toBe(false);
    expect(v.exitReachable).toBe(false);
    expect(v.issues).toContain("地图中缺少出口");
  });

  it("should accept a simple valid map and all verification fields are correct", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    rooms[24] = "exit";
    const v = verifyMap(rooms, 99);
    expect(v.valid).toBe(true);
    expect(v.keyReachable).toBe(true);
    expect(v.exitReachable).toBe(true);
    expect(v.keyToExitReachable).toBe(true);
    expect(v.pathDamageAcceptable).toBe(true);
    expect(v.noTrapDeadEnd).toBe(true);
    expect(v.issues).toHaveLength(0);
    expect(v.safePath).toBeDefined();
    expect(v.safePath![0]).toBe(0);
    expect(v.safePath![v.safePath!.length - 1]).toBe(24);
  });

  it("key and exit are always reachable on a full 5x5 grid (all room types are passable)", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    rooms[24] = "exit";
    for (let i = 1; i < TOTAL; i++) {
      if (i !== 12 && i !== 24) rooms[i] = "trap";
    }
    const v = verifyMap(rooms, 999);
    expect(v.keyReachable).toBe(true);
    expect(v.exitReachable).toBe(true);
    expect(v.keyToExitReachable).toBe(true);
  });

  it("should detect trap/monster dead-end and set noTrapDeadEnd to false", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    rooms[24] = "exit";
    rooms[6] = "trap";
    rooms[1] = "trap";
    rooms[5] = "trap";
    rooms[7] = "trap";
    rooms[11] = "trap";
    const v = verifyMap(rooms, 99);
    expect(v.noTrapDeadEnd).toBe(false);
    expect(v.issues.some((i) => i.includes("周围全是危险房间"))).toBe(true);
  });

  it("should NOT flag dead-end if a danger room has at least one safe neighbor", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    rooms[24] = "exit";
    rooms[6] = "trap";
    rooms[1] = "trap";
    rooms[5] = "trap";
    rooms[7] = "trap";
    const v = verifyMap(rooms, 99);
    expect(v.noTrapDeadEnd).toBe(true);
  });

  it("should reject when path damage exceeds max", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    rooms[24] = "exit";
    for (let i = 1; i < TOTAL; i++) {
      if (i !== 12 && i !== 24) {
        rooms[i] = "trap";
      }
    }
    const v = verifyMap(rooms, 1);
    expect(v.pathDamageAcceptable).toBe(false);
    expect(v.valid).toBe(false);
    expect(v.issues.some((i) => i.includes("超过上限"))).toBe(true);
  });

  it("valid flag is the logical AND of all sub-conditions", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    rooms[24] = "exit";
    const v = verifyMap(rooms, 99);
    const expectedValid =
      rooms.indexOf("key") !== -1 &&
      rooms.indexOf("exit") !== -1 &&
      v.keyReachable &&
      v.exitReachable &&
      v.keyToExitReachable &&
      v.pathDamageAcceptable &&
      v.noTrapDeadEnd;
    expect(v.valid).toBe(expectedValid);
  });
});
