import { describe, it, expect } from "vitest";
import { generateMap, verifyMap } from "../config/mapGenerator";
import { getFloorConfig, GAME_CONSTANTS } from "../config/gameConfig";

const SIZE = GAME_CONSTANTS.boardSize;
const TOTAL = SIZE * SIZE;

describe("generateMap", () => {
  it("should produce a 5x5 map (25 rooms)", () => {
    const result = generateMap(1);
    expect(result.rooms).toHaveLength(TOTAL);
  });

  it("must contain exactly one start at index 0", () => {
    const result = generateMap(1);
    expect(result.rooms[0]).toBe("start");
    const startCount = result.rooms.filter((r) => r === "start").length;
    expect(startCount).toBe(1);
  });

  it("must contain exactly one key", () => {
    const result = generateMap(1);
    const keyCount = result.rooms.filter((r) => r === "key").length;
    expect(keyCount).toBe(1);
  });

  it("must contain exactly one exit", () => {
    const result = generateMap(1);
    const exitCount = result.rooms.filter((r) => r === "exit").length;
    expect(exitCount).toBe(1);
  });

  it("key and exit must be different positions", () => {
    const result = generateMap(1);
    const keyIdx = result.rooms.indexOf("key");
    const exitIdx = result.rooms.indexOf("exit");
    expect(keyIdx).not.toBe(exitIdx);
  });

  it("verification result should report valid for floor 1", () => {
    const result = generateMap(1);
    expect(result.verification.keyReachable).toBe(true);
    expect(result.verification.exitReachable).toBe(true);
    expect(result.verification.keyToExitReachable).toBe(true);
  });

  it("verification result should report no critical issues", () => {
    const result = generateMap(1);
    const criticalIssues = result.verification.issues.filter(
      (i) => i.includes("缺少") || i.includes("不可达") || i.includes("不连通")
    );
    expect(criticalIssues).toHaveLength(0);
  });

  it("path damage should not exceed floor max", () => {
    const result = generateMap(1);
    const cfg = getFloorConfig(1);
    expect(result.verification.pathDamageAcceptable).toBe(true);
    expect(result.stats.totalPathDamage).toBeLessThanOrEqual(cfg.pathMaxDamage);
  });

  it("should produce valid maps across multiple floors (1-5)", () => {
    for (let floor = 1; floor <= 5; floor++) {
      const result = generateMap(floor);
      expect(result.rooms).toHaveLength(TOTAL);
      expect(result.rooms[0]).toBe("start");
      expect(result.rooms.includes("key")).toBe(true);
      expect(result.rooms.includes("exit")).toBe(true);
      expect(result.verification.keyReachable).toBe(true);
      expect(result.verification.exitReachable).toBe(true);
    }
  });

  it("should produce valid maps for each route type", () => {
    const routes: Array<"safe" | "greedy" | "dangerous"> = ["safe", "greedy", "dangerous"];
    for (const route of routes) {
      const result = generateMap(1, route);
      expect(result.rooms).toHaveLength(TOTAL);
      expect(result.rooms[0]).toBe("start");
      expect(result.rooms.includes("key")).toBe(true);
      expect(result.rooms.includes("exit")).toBe(true);
      expect(result.verification.keyReachable).toBe(true);
      expect(result.verification.exitReachable).toBe(true);
    }
  });

  it("repeated generation should consistently produce valid maps", () => {
    for (let i = 0; i < 10; i++) {
      const result = generateMap(1);
      expect(result.rooms).toHaveLength(TOTAL);
      expect(result.rooms.includes("key")).toBe(true);
      expect(result.rooms.includes("exit")).toBe(true);
      expect(result.verification.keyReachable).toBe(true);
      expect(result.verification.exitReachable).toBe(true);
    }
  });

  it("no trap/monster dead-end surrounded only by danger rooms", () => {
    const result = generateMap(1);
    expect(result.verification.noTrapDeadEnd).toBe(true);
  });
});

function makeEmptyRooms(): import("../config/gameConfig").RoomType[] {
  return new Array(TOTAL).fill("empty") as import("../config/gameConfig").RoomType[];
}

describe("verifyMap", () => {
  it("should reject a map without a key", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[TOTAL - 1] = "exit";
    const v = verifyMap(rooms, 99);
    expect(v.valid).toBe(false);
    expect(v.keyReachable).toBe(false);
  });

  it("should reject a map without an exit", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    const v = verifyMap(rooms, 99);
    expect(v.valid).toBe(false);
    expect(v.exitReachable).toBe(false);
  });

  it("should accept a simple valid map", () => {
    const rooms = makeEmptyRooms();
    rooms[0] = "start";
    rooms[12] = "key";
    rooms[24] = "exit";
    const v = verifyMap(rooms, 99);
    expect(v.keyReachable).toBe(true);
    expect(v.exitReachable).toBe(true);
    expect(v.keyToExitReachable).toBe(true);
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
  });
});
