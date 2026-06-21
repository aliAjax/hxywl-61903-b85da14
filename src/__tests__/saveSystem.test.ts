import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateSaveData,
  sanitizeSave,
  saveGame,
  loadGame,
  clearSave,
  hasSave,
  saveGameToSlot,
  loadGameFromSlot,
  getSlotList,
  deleteSlot,
  loadLeaderboard,
  addLeaderboardEntry,
  clearLeaderboard,
  SaveData,
  CURRENT_SAVE_VERSION,
} from "../config/saveSystem";
import { GAME_CONSTANTS, RoomType } from "../config/gameConfig";

const TOTAL = GAME_CONSTANTS.boardSize * GAME_CONSTANTS.boardSize;

function makeValidBoard(): SaveData["board"] {
  return new Array(TOTAL).fill(null).map((_, i) => ({
    type: (i === 0 ? "start" : "empty") as RoomType,
    revealed: i === 0,
  }));
}

function makeValidSave(): SaveData {
  return {
    version: CURRENT_SAVE_VERSION,
    timestamp: Date.now(),
    board: makeValidBoard(),
    hp: 5,
    coins: 10,
    keys: 1,
    potions: 2,
    floor: 1,
    status: "playing",
    turn: 5,
    stats: {
      revealedRooms: 3,
      trapHits: 1,
      monstersDefeated: 0,
      potionsUsed: 0,
      fleeCount: 0,
    },
    battleState: "idle",
    currentMonster: null,
    battleLog: [],
    battleRoomIdx: -1,
    history: [],
    showRouteHint: false,
    showRiskHint: false,
    playerCharging: false,
    currentRoute: null,
    eventHistory: [],
  };
}

describe("validateSaveData", () => {
  it("should accept a valid save data object", () => {
    const save = makeValidSave();
    const result = validateSaveData(save);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("");
    expect(result.save).toEqual(save);
  });

  it("should reject non-object save data", () => {
    expect(validateSaveData(null).valid).toBe(false);
    expect(validateSaveData(null).reason).toBe("存档数据格式错误");
    expect(validateSaveData("string").valid).toBe(false);
    expect(validateSaveData(123).valid).toBe(false);
  });

  it("should reject invalid version numbers", () => {
    const save = makeValidSave();
    save.version = 0;
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("存档版本不可识别");

    save.version = CURRENT_SAVE_VERSION + 1;
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("存档版本过新，请更新游戏");
  });

  it("should reject invalid hp values", () => {
    const save = makeValidSave();
    save.hp = -1;
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("血量数据异常");

    save.hp = GAME_CONSTANTS.maxHp + 1;
    expect(validateSaveData(save).valid).toBe(false);
  });

  it("should reject invalid coins/keys/potions values", () => {
    const save = makeValidSave();

    save.coins = -1;
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("金币数据异常");

    save.coins = 10;
    save.keys = -1;
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("钥匙数据异常");

    save.keys = 1;
    save.potions = -1;
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("药水数据异常");
  });

  it("should reject invalid floor values", () => {
    const save = makeValidSave();
    save.floor = 0;
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("层数数据异常");
  });

  it("should reject invalid status values", () => {
    const save = makeValidSave();
    (save as any).status = "invalid";
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("游戏状态异常");
  });

  it("should reject invalid battleState values", () => {
    const save = makeValidSave();
    (save as any).battleState = "invalid";
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("战斗状态异常");
  });

  it("should reject board with wrong length", () => {
    const save = makeValidSave();
    save.board = save.board.slice(0, 5);
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("地图数据异常");
  });

  it("should reject board with invalid room type", () => {
    const save = makeValidSave();
    (save.board[1] as any).type = "invalid";
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("地图房间1数据异常");
  });

  it("should reject board with missing revealed field", () => {
    const save = makeValidSave();
    delete (save.board[1] as any).revealed;
    expect(validateSaveData(save).valid).toBe(false);
  });

  it("should reject invalid monster data when in battle", () => {
    const save = makeValidSave();
    save.battleState = "fighting";
    save.currentMonster = {
      name: "",
      icon: "",
      maxHp: -1,
      hp: 0,
      attack: 0,
      coinReward: 0,
      potionDropChance: 0,
    };
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("怪物数据异常");
  });

  it("should reject invalid battle room index when in battle", () => {
    const save = makeValidSave();
    save.battleState = "fighting";
    save.battleRoomIdx = -2;
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("战斗房间索引异常");
  });

  it("should accept valid monster data when in battle", () => {
    const save = makeValidSave();
    save.battleState = "fighting";
    save.battleRoomIdx = 5;
    save.board[5] = { type: "monster", revealed: true };
    save.currentMonster = {
      name: "史莱姆",
      icon: "🟢",
      maxHp: 3,
      hp: 2,
      attack: 1,
      coinReward: 5,
      potionDropChance: 0.1,
    };
    const result = validateSaveData(save);
    expect(result.valid).toBe(true);
  });

  it("should reject invalid battle log entries", () => {
    const save = makeValidSave();
    (save.battleLog as any).push({ id: "not-a-number", message: "test", type: "system" });
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("战斗日志0数据异常");
  });

  it("should reject invalid turn records", () => {
    const save = makeValidSave();
    (save.history as any).push({ id: "invalid", turn: 1, floor: 1, event: "test", hpDelta: 0, coinDelta: 0, items: [] });
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("回合记录0数据异常");
  });

  it("should reject invalid currentRoute values", () => {
    const save = makeValidSave();
    (save as any).currentRoute = "invalid";
    expect(validateSaveData(save).valid).toBe(false);
    expect(validateSaveData(save).reason).toBe("路线数据异常");
  });

  it("should accept null/undefined currentRoute", () => {
    const save = makeValidSave();
    save.currentRoute = null;
    expect(validateSaveData(save).valid).toBe(true);

    delete save.currentRoute;
    expect(validateSaveData(save).valid).toBe(true);
  });
});

describe("sanitizeSave", () => {
  it("should return same save for clean idle state", () => {
    const save = makeValidSave();
    const result = sanitizeSave(save);
    expect(result.battleRepaired).toBe(false);
    expect(result.battleWasLoaded).toBe(false);
    expect(result.battleStateWasInconsistent).toBe(false);
  });

  it("should reset battle state if idle but has monster data", () => {
    const save = makeValidSave();
    save.battleState = "idle";
    save.currentMonster = { name: "test", icon: "🟢", maxHp: 3, hp: 2, attack: 1, coinReward: 1, potionDropChance: 0.1 };
    const result = sanitizeSave(save);
    expect(result.battleRepaired).toBe(true);
    expect(result.save.currentMonster).toBeNull();
    expect(result.save.battleState).toBe("idle");
  });

  it("should reset battle state if status is lost", () => {
    const save = makeValidSave();
    save.status = "lost";
    save.battleState = "fighting";
    const result = sanitizeSave(save);
    expect(result.battleStateWasInconsistent).toBe(true);
    expect(result.save.battleState).toBe("idle");
  });

  it("should reset battle if hp <= 0", () => {
    const save = makeValidSave();
    save.hp = 0;
    save.battleState = "fighting";
    const result = sanitizeSave(save);
    expect(result.battleRepaired).toBe(true);
    expect(result.save.status).toBe("lost");
    expect(result.save.battleState).toBe("idle");
  });

  it("should repair inconsistent battle won state (missing defeated flag)", () => {
    const save = makeValidSave();
    save.battleState = "won";
    save.battleRoomIdx = 5;
    save.board[5] = { type: "monster", revealed: true, defeated: false };
    const result = sanitizeSave(save);
    expect(result.battleStateWasInconsistent).toBe(true);
    expect(result.battleRepaired).toBe(true);
    expect(result.save.board[5].defeated).toBe(true);
  });

  it("should repair inconsistent battle fled state (room still revealed)", () => {
    const save = makeValidSave();
    save.battleState = "fled";
    save.battleRoomIdx = 5;
    save.board[5] = { type: "monster", revealed: true, defeated: false };
    const result = sanitizeSave(save);
    expect(result.battleStateWasInconsistent).toBe(true);
    expect(result.battleRepaired).toBe(true);
    expect(result.save.board[5].revealed).toBe(false);
    expect(result.save.board[5].defeated).toBe(false);
  });

  it("should reset battle state for battle lost", () => {
    const save = makeValidSave();
    save.battleState = "lost";
    const result = sanitizeSave(save);
    expect(result.battleStateWasInconsistent).toBe(true);
    expect(result.save.battleState).toBe("idle");
  });

  it("should detect inconsistent fighting state and reset", () => {
    const save = makeValidSave();
    save.battleState = "fighting";
    save.currentMonster = null;
    const result = sanitizeSave(save);
    expect(result.battleStateWasInconsistent).toBe(true);
    expect(result.battleRepaired).toBe(true);
    expect(result.save.battleState).toBe("idle");
  });

  it("should detect inconsistent fighting state (monster hp <= 0)", () => {
    const save = makeValidSave();
    save.battleState = "fighting";
    save.battleRoomIdx = 5;
    save.board[5] = { type: "monster", revealed: true };
    save.currentMonster = { name: "test", icon: "🟢", maxHp: 3, hp: 0, attack: 1, coinReward: 1, potionDropChance: 0.1 };
    const result = sanitizeSave(save);
    expect(result.battleStateWasInconsistent).toBe(true);
    expect(result.battleRepaired).toBe(true);
    expect(result.save.battleState).toBe("idle");
  });

  it("should detect inconsistent fighting state (room type not monster)", () => {
    const save = makeValidSave();
    save.battleState = "fighting";
    save.battleRoomIdx = 5;
    save.board[5] = { type: "coin", revealed: true };
    save.currentMonster = { name: "test", icon: "🟢", maxHp: 3, hp: 2, attack: 1, coinReward: 1, potionDropChance: 0.1 };
    const result = sanitizeSave(save);
    expect(result.battleStateWasInconsistent).toBe(true);
    expect(result.battleRepaired).toBe(true);
    expect(result.save.battleState).toBe("idle");
  });

  it("should detect inconsistent fighting state (monster hp > maxHp) and reset", () => {
    const save = makeValidSave();
    save.battleState = "fighting";
    save.battleRoomIdx = 5;
    save.board[5] = { type: "monster", revealed: true };
    save.currentMonster = { name: "test", icon: "🟢", maxHp: 3, hp: 5, attack: 1, coinReward: 1, potionDropChance: 0.1 };
    const result = sanitizeSave(save);
    expect(result.battleStateWasInconsistent).toBe(true);
    expect(result.battleRepaired).toBe(true);
    expect(result.save.battleState).toBe("idle");
    expect(result.save.currentMonster).toBeNull();
  });
});

describe("localStorage save/load", () => {
  beforeEach(() => {
    clearSave();
    clearLeaderboard();
    for (let i = 1; i <= 5; i++) {
      deleteSlot(i);
    }
  });

  afterEach(() => {
    clearSave();
    clearLeaderboard();
    for (let i = 1; i <= 5; i++) {
      deleteSlot(i);
    }
  });

  it("saveGame and loadGame should round-trip correctly", () => {
    const save = makeValidSave();
    const { version, timestamp, ...rest } = save;

    saveGame(rest);
    expect(hasSave()).toBe(true);

    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded?.save.hp).toBe(save.hp);
    expect(loaded?.save.coins).toBe(save.coins);
    expect(loaded?.save.floor).toBe(save.floor);
    expect(loaded?.save.version).toBe(CURRENT_SAVE_VERSION);
  });

  it("loadGame should return null for lost status saves", () => {
    const save = makeValidSave();
    save.status = "lost";
    const { version, timestamp, ...rest } = save;

    saveGame(rest);
    const loaded = loadGame();
    expect(loaded).toBeNull();
    expect(hasSave()).toBe(false);
  });

  it("loadGame should clear invalid saves", () => {
    localStorage.setItem("dungeon-save-v1", JSON.stringify({ invalid: "data" }));
    const loaded = loadGame();
    expect(loaded).toBeNull();
    expect(hasSave()).toBe(false);
  });

  it("clearSave should remove save from localStorage", () => {
    const save = makeValidSave();
    const { version, timestamp, ...rest } = save;

    saveGame(rest);
    expect(hasSave()).toBe(true);

    clearSave();
    expect(hasSave()).toBe(false);
  });

  it("slot save/load should work correctly", () => {
    const save = makeValidSave();
    save.floor = 3;
    save.coins = 100;
    const { version, timestamp, ...rest } = save;

    saveGameToSlot(1, rest);
    const loaded = loadGameFromSlot(1);
    expect(loaded).not.toBeNull();
    expect(loaded?.save.floor).toBe(3);
    expect(loaded?.save.coins).toBe(100);
  });

  it("getSlotList should return all slots with correct metadata", () => {
    const save1 = makeValidSave();
    save1.floor = 2;
    save1.coins = 50;
    const { version: v1, timestamp: t1, ...rest1 } = save1;
    saveGameToSlot(1, rest1);

    const save3 = makeValidSave();
    save3.floor = 5;
    save3.coins = 200;
    save3.battleState = "fighting";
    save3.battleRoomIdx = 5;
    save3.board[5] = { type: "monster", revealed: true };
    save3.currentMonster = { name: "test", icon: "🟢", maxHp: 3, hp: 2, attack: 1, coinReward: 1, potionDropChance: 0.1 };
    const { version: v3, timestamp: t3, ...rest3 } = save3;
    saveGameToSlot(3, rest3);

    const slots = getSlotList();
    expect(slots).toHaveLength(5);
    expect(slots[0].empty).toBe(false);
    expect(slots[0].valid).toBe(true);
    expect(slots[0].floor).toBe(2);
    expect(slots[0].coins).toBe(50);

    expect(slots[1].empty).toBe(true);

    expect(slots[2].empty).toBe(false);
    expect(slots[2].valid).toBe(true);
    expect(slots[2].floor).toBe(5);
    expect(slots[2].battleState).toBe("fighting");

    expect(slots[3].empty).toBe(true);
    expect(slots[4].empty).toBe(true);
  });

  it("getSlotList should mark invalid slots", () => {
    localStorage.setItem("dungeon-slot-2", JSON.stringify({ invalid: true }));
    const slots = getSlotList();
    expect(slots[1].empty).toBe(false);
    expect(slots[1].valid).toBe(false);
    expect(slots[1].reason).not.toBe("");
  });

  it("deleteSlot should remove slot data", () => {
    const save = makeValidSave();
    const { version, timestamp, ...rest } = save;
    saveGameToSlot(1, rest);

    expect(getSlotList()[0].empty).toBe(false);
    deleteSlot(1);
    expect(getSlotList()[0].empty).toBe(true);
  });

  it("loadGameFromSlot should return null for lost status", () => {
    const save = makeValidSave();
    save.status = "lost";
    const { version, timestamp, ...rest } = save;
    saveGameToSlot(1, rest);

    const loaded = loadGameFromSlot(1);
    expect(loaded).toBeNull();
  });
});

describe("leaderboard", () => {
  beforeEach(() => {
    clearLeaderboard();
  });

  afterEach(() => {
    clearLeaderboard();
  });

  it("should start with empty leaderboard", () => {
    expect(loadLeaderboard()).toEqual([]);
  });

  it("addLeaderboardEntry should add entry and return updated list", () => {
    const entry = {
      resultType: "clear" as const,
      floor: 3,
      coins: 150,
      revealedRooms: 12,
      trapHits: 2,
      monstersDefeated: 3,
      stars: 4,
      rank: "A",
    };

    const updated = addLeaderboardEntry(entry);
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe(1);
    expect(updated[0].resultType).toBe("clear");
    expect(updated[0].floor).toBe(3);
    expect(updated[0].coins).toBe(150);
    expect(updated[0].timestamp).toBeGreaterThan(0);

    const loaded = loadLeaderboard();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(updated[0]);
  });

  it("should increment id for new entries", () => {
    addLeaderboardEntry({
      resultType: "death", floor: 2, coins: 50, revealedRooms: 5,
      trapHits: 1, monstersDefeated: 0, stars: 2, rank: "C",
    });
    const updated = addLeaderboardEntry({
      resultType: "clear", floor: 5, coins: 200, revealedRooms: 20,
      trapHits: 0, monstersDefeated: 5, stars: 5, rank: "S",
    });
    expect(updated[0].id).toBe(2);
    expect(updated[1].id).toBe(1);
  });

  it("should trim entries to max limit", () => {
    for (let i = 0; i < 25; i++) {
      addLeaderboardEntry({
        resultType: "clear", floor: i + 1, coins: i * 10, revealedRooms: i,
        trapHits: 0, monstersDefeated: 0, stars: 3, rank: "B",
      });
    }
    const entries = loadLeaderboard();
    expect(entries.length).toBe(GAME_CONSTANTS.maxLeaderboardEntries);
  });

  it("clearLeaderboard should remove all entries", () => {
    addLeaderboardEntry({
      resultType: "clear", floor: 1, coins: 10, revealedRooms: 1,
      trapHits: 0, monstersDefeated: 0, stars: 3, rank: "B",
    });
    expect(loadLeaderboard()).toHaveLength(1);
    clearLeaderboard();
    expect(loadLeaderboard()).toEqual([]);
  });

  it("should filter out invalid entries on load", () => {
    const invalidEntries = [
      { id: 1, resultType: "invalid", floor: 1, coins: 10, revealedRooms: 1, trapHits: 0, monstersDefeated: 0, stars: 3, rank: "B", timestamp: Date.now() },
      { id: 2, resultType: "clear", floor: -1, coins: 10, revealedRooms: 1, trapHits: 0, monstersDefeated: 0, stars: 3, rank: "B", timestamp: Date.now() },
      { id: 3, resultType: "clear", floor: 1, coins: -1, revealedRooms: 1, trapHits: 0, monstersDefeated: 0, stars: 3, rank: "B", timestamp: Date.now() },
      { id: 4, resultType: "clear", floor: 1, coins: 10, revealedRooms: -1, trapHits: 0, monstersDefeated: 0, stars: 3, rank: "B", timestamp: Date.now() },
      { id: 5, resultType: "clear", floor: 1, coins: 10, revealedRooms: 1, trapHits: -1, monstersDefeated: 0, stars: 3, rank: "B", timestamp: Date.now() },
      { id: 6, resultType: "clear", floor: 1, coins: 10, revealedRooms: 1, trapHits: 0, monstersDefeated: -1, stars: 3, rank: "B", timestamp: Date.now() },
      { id: 7, resultType: "clear", floor: 1, coins: 10, revealedRooms: 1, trapHits: 0, monstersDefeated: 0, stars: 0, rank: "B", timestamp: Date.now() },
      { id: 8, resultType: "clear", floor: 1, coins: 10, revealedRooms: 1, trapHits: 0, monstersDefeated: 0, stars: 6, rank: "B", timestamp: Date.now() },
      { id: 9, resultType: "clear", floor: 1, coins: 10, revealedRooms: 1, trapHits: 0, monstersDefeated: 0, stars: 3, rank: "B", timestamp: 0 },
    ];
    localStorage.setItem(GAME_CONSTANTS.leaderboardKey, JSON.stringify(invalidEntries));
    expect(loadLeaderboard()).toEqual([]);
  });
});
