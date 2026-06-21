import { describe, it, expect } from "vitest";
import { estimateRoomRisks, RiskEstimate } from "../config/riskEstimator";
import { RoomType, getFloorConfig, GAME_CONSTANTS } from "../config/gameConfig";

const SIZE = GAME_CONSTANTS.boardSize;
const TOTAL = SIZE * SIZE;

interface KnownRoom {
  type: RoomType;
  revealed: boolean;
}

function makeRooms(overrides: Partial<Record<number, { type: RoomType; revealed: boolean }>> = {}): KnownRoom[] {
  const rooms: KnownRoom[] = new Array(TOTAL).fill(null).map(() => ({
    type: "empty" as RoomType,
    revealed: false,
  }));
  rooms[0] = { type: "start", revealed: true };
  for (const [idx, val] of Object.entries(overrides)) {
    if (val) {
      rooms[Number(idx)] = val;
    }
  }
  return rooms;
}

describe("estimateRoomRisks", () => {
  it("should return estimates for all 25 rooms", () => {
    const rooms = makeRooms();
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);
    expect(estimates).toHaveLength(TOTAL);
  });

  it("should assign risk level 1 (safe) to revealed safe rooms", () => {
    const rooms = makeRooms({
      1: { type: "coin", revealed: true },
      5: { type: "empty", revealed: true },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);
    expect(estimates[1].level).toBe(1);
    expect(estimates[1].probability).toBe(0);
    expect(estimates[5].level).toBe(1);
    expect(estimates[5].probability).toBe(0);
  });

  it("should assign risk level 5 (dangerous) to revealed trap/monster rooms", () => {
    const rooms = makeRooms({
      1: { type: "trap", revealed: true },
      5: { type: "monster", revealed: true },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);
    expect(estimates[1].level).toBe(5);
    expect(estimates[1].probability).toBe(1);
    expect(estimates[5].level).toBe(5);
    expect(estimates[5].probability).toBe(1);
  });

  it("should NOT reveal true type for unrevealed rooms", () => {
    const rooms = makeRooms({
      1: { type: "trap", revealed: false },
      6: { type: "monster", revealed: false },
      7: { type: "coin", revealed: false },
      24: { type: "exit", revealed: false },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);

    for (const idx of [1, 6, 7, 24]) {
      const est = estimates[idx];
      expect(est.probability).toBeGreaterThan(0);
      expect(est.probability).toBeLessThan(1);
      expect(est.confidence).toBeLessThan(1);
      expect(est.level).toBeGreaterThanOrEqual(1);
      expect(est.level).toBeLessThanOrEqual(4);
    }
  });

  it("should give higher risk to rooms adjacent to revealed dangers", () => {
    const rooms = makeRooms({
      1: { type: "trap", revealed: true },
      6: { type: "empty", revealed: true },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);

    const neighborOfTrap = estimates[2];
    const neighborOfSafe = estimates[7];
    expect(neighborOfTrap.probability).toBeGreaterThan(neighborOfSafe.probability);
  });

  it("should give lower risk to rooms adjacent to revealed safe rooms", () => {
    const rooms = makeRooms({
      1: { type: "coin", revealed: true },
      6: { type: "empty", revealed: true },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);

    const surroundedBySafe = estimates[2];
    expect(surroundedBySafe.probability).toBeLessThan(0.5);
  });

  it("unrevealed trap probability should never be 1.0 (no certainty leak)", () => {
    const rooms = makeRooms({
      1: { type: "trap", revealed: false },
      6: { type: "monster", revealed: false },
      7: { type: "trap", revealed: true },
      11: { type: "monster", revealed: true },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);

    expect(estimates[1].probability).toBeLessThan(1);
    expect(estimates[6].probability).toBeLessThan(1);
  });

  it("unrevealed safe room probability should never be 0.0 (no certainty leak)", () => {
    const rooms = makeRooms({
      1: { type: "coin", revealed: false },
      6: { type: "potion", revealed: false },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);

    expect(estimates[1].probability).toBeGreaterThan(0);
    expect(estimates[6].probability).toBeGreaterThan(0);
  });

  it("confidence for unrevealed rooms should always be < 1", () => {
    const rooms = makeRooms({
      1: { type: "trap", revealed: true },
      2: { type: "monster", revealed: true },
      5: { type: "coin", revealed: true },
      6: { type: "potion", revealed: true },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);

    for (let i = 0; i < TOTAL; i++) {
      if (!rooms[i].revealed) {
        expect(estimates[i].confidence).toBeLessThan(1);
      }
    }
  });

  it("should never directly expose unrevealed room type in risk level", () => {
    const rooms = makeRooms({
      1: { type: "trap", revealed: false },
      6: { type: "coin", revealed: false },
      24: { type: "exit", revealed: false },
    });
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);

    expect(estimates[1].level).not.toBe(5);
    expect(estimates[6].level).not.toBe(1);
    expect(estimates[24].level).not.toBe(1);
  });

  it("risk estimates should be consistent for identical revealed state regardless of hidden types", () => {
    const roomsA = makeRooms({
      1: { type: "trap", revealed: false },
    });
    const roomsB = makeRooms({
      1: { type: "coin", revealed: false },
    });
    const cfg = getFloorConfig(1);
    const estA = estimateRoomRisks(roomsA, cfg);
    const estB = estimateRoomRisks(roomsB, cfg);

    expect(estA[1].level).toBe(estB[1].level);
    expect(estA[1].probability).toBeCloseTo(estB[1].probability, 5);
    expect(estA[1].confidence).toBeCloseTo(estB[1].confidence, 5);
  });

  it("should handle all rooms revealed without error", () => {
    const rooms: KnownRoom[] = new Array(TOTAL).fill(null).map((_, i) => ({
      type: (i === 0 ? "start" : i === 12 ? "key" : i === 24 ? "exit" : "empty") as RoomType,
      revealed: true,
    }));
    const cfg = getFloorConfig(1);
    const estimates = estimateRoomRisks(rooms, cfg);
    expect(estimates).toHaveLength(TOTAL);
    for (const est of estimates) {
      expect(est.confidence).toBe(1);
    }
  });
});
