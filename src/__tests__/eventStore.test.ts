import { describe, it, expect, beforeEach } from "vitest";
import {
  applyEvent,
  rebuildState,
  EventStore,
  verifyReconstruction,
  getFloorBoundaries,
  getFloorEvents,
  rebuildFloorState,
  getFloorProgress,
  getCurrentFloorProgress,
  GameState,
  GameEvent,
  initialGameState,
  INITIAL_STATS,
} from "../model/eventStore";
import { generateMap } from "../config/mapGenerator";
import { RoomType, GAME_CONSTANTS } from "../config/gameConfig";

const TOTAL = GAME_CONSTANTS.boardSize * GAME_CONSTANTS.boardSize;

function makeTestBoard(): RoomType[] {
  const result = generateMap(1).rooms;
  return result;
}

function makeInitialState(): GameState {
  const board = makeTestBoard();
  return initialGameState(board);
}

function makeInitEvent(board: RoomType[], floor = 1): GameEvent {
  return {
    type: "GAME_INIT",
    floor,
    route: null,
    boardLayout: board,
  };
}

describe("applyEvent", () => {
  it("should handle GAME_INIT event correctly", () => {
    const board = makeTestBoard();
    const initEvent: GameEvent = {
      type: "GAME_INIT",
      floor: 1,
      route: "safe",
      boardLayout: board,
    };

    const initialState = makeInitialState();
    const result = applyEvent(initialState, initEvent);

    expect(result.floor).toBe(1);
    expect(result.currentRoute).toBe("safe");
    expect(result.hp).toBe(GAME_CONSTANTS.maxHp);
    expect(result.coins).toBe(0);
    expect(result.keys).toBe(0);
    expect(result.board.length).toBe(TOTAL);
    expect(result.board[0].revealed).toBe(true);
    expect(result.status).toBe("playing");
  });

  it("should handle ROOM_FLIP event for trap", () => {
    const state = makeInitialState();
    const trapIdx = state.board.findIndex((r) => r.type === "trap");
    expect(trapIdx).not.toBe(-1);

    const event: GameEvent = {
      type: "ROOM_FLIP",
      idx: trapIdx,
      roomType: "trap",
      hpDelta: -1,
      coinDelta: 0,
      keyDelta: 0,
      potionDelta: 0,
      trapHit: true,
      statusAfter: "playing",
    };

    const result = applyEvent(state, event);
    expect(result.hp).toBe(state.hp - 1);
    expect(result.board[trapIdx].revealed).toBe(true);
    expect(result.stats.trapHits).toBe(1);
    expect(result.stats.revealedRooms).toBe(INITIAL_STATS.revealedRooms + 1);
    expect(result.turn).toBe(state.turn + 1);
  });

  it("should handle ROOM_FLIP event for coin", () => {
    const state = makeInitialState();
    const event: GameEvent = {
      type: "ROOM_FLIP",
      idx: 1,
      roomType: "coin",
      hpDelta: 0,
      coinDelta: 5,
      keyDelta: 0,
      potionDelta: 0,
      trapHit: false,
      statusAfter: "playing",
    };

    const result = applyEvent(state, event);
    expect(result.coins).toBe(state.coins + 5);
    expect(result.turn).toBe(state.turn + 1);
  });

  it("should handle ROOM_FLIP event for key", () => {
    const state = makeInitialState();
    const keyIdx = state.board.findIndex((r) => r.type === "key");
    expect(keyIdx).not.toBe(-1);

    const event: GameEvent = {
      type: "ROOM_FLIP",
      idx: keyIdx,
      roomType: "key",
      hpDelta: 0,
      coinDelta: 0,
      keyDelta: 1,
      potionDelta: 0,
      trapHit: false,
      statusAfter: "playing",
    };

    const result = applyEvent(state, event);
    expect(result.keys).toBe(state.keys + 1);
  });

  it("should handle ROOM_FLIP event for potion", () => {
    const state = makeInitialState();
    const event: GameEvent = {
      type: "ROOM_FLIP",
      idx: 1,
      roomType: "potion",
      hpDelta: 0,
      coinDelta: 0,
      keyDelta: 0,
      potionDelta: 1,
      trapHit: false,
      statusAfter: "playing",
    };

    const result = applyEvent(state, event);
    expect(result.potions).toBe(state.potions + 1);
  });

  it("should handle ROOM_FLIP event that causes death", () => {
    const state = makeInitialState();
    state.hp = 1;

    const event: GameEvent = {
      type: "ROOM_FLIP",
      idx: 1,
      roomType: "trap",
      hpDelta: -1,
      coinDelta: 0,
      keyDelta: 0,
      potionDelta: 0,
      trapHit: true,
      statusAfter: "lost",
    };

    const result = applyEvent(state, event);
    expect(result.hp).toBe(0);
    expect(result.status).toBe("lost");
  });

  it("should handle ROOM_FLIP event for monster (enter battle)", () => {
    const state = makeInitialState();
    const monster: any = {
      name: "史莱姆",
      icon: "🟢",
      maxHp: 3,
      hp: 3,
      attack: 1,
      coinReward: 5,
      potionDropChance: 0.1,
    };

    const event: GameEvent = {
      type: "ROOM_FLIP",
      idx: 1,
      roomType: "monster",
      hpDelta: 0,
      coinDelta: 0,
      keyDelta: 0,
      potionDelta: 0,
      trapHit: false,
      monster,
      statusAfter: "playing",
    };

    const result = applyEvent(state, event);
    expect(result.battleState).toBe("fighting");
    expect(result.currentMonster).toEqual(monster);
    expect(result.battleRoomIdx).toBe(1);
    expect(result.playerCharging).toBe(false);
  });

  it("should handle EXIT_WITH_KEY event", () => {
    const state = makeInitialState();
    state.keys = 1;

    const event: GameEvent = { type: "EXIT_WITH_KEY" };

    const result = applyEvent(state, event);
    expect(result.status).toBe("won");
    expect(result.turn).toBe(state.turn + 1);
  });

  it("should handle BATTLE_ATTACK event", () => {
    const state = makeInitialState();
    state.battleState = "fighting";
    state.currentMonster = {
      name: "史莱姆",
      icon: "🟢",
      maxHp: 3,
      hp: 3,
      attack: 1,
      coinReward: 5,
      potionDropChance: 0.1,
    };

    const event: GameEvent = {
      type: "BATTLE_ATTACK",
      damage: 2,
      charged: false,
      monsterHpAfter: 1,
      monsterDamage: 1,
      playerHpAfter: 4,
      monsterDefeated: false,
    };

    const result = applyEvent(state, event);
    expect(result.currentMonster?.hp).toBe(1);
    expect(result.hp).toBe(4);
    expect(result.playerCharging).toBe(false);
  });

  it("should handle BATTLE_ATTACK event with charged attack", () => {
    const state = makeInitialState();
    state.battleState = "fighting";
    state.currentMonster = {
      name: "史莱姆",
      icon: "🟢",
      maxHp: 3,
      hp: 3,
      attack: 1,
      coinReward: 5,
      potionDropChance: 0.1,
    };
    state.playerCharging = true;

    const event: GameEvent = {
      type: "BATTLE_ATTACK",
      damage: 4,
      charged: true,
      monsterHpAfter: 0,
      monsterDamage: 0,
      playerHpAfter: 5,
      monsterDefeated: true,
    };

    const result = applyEvent(state, event);
    expect(result.currentMonster?.hp).toBe(0);
    expect(result.playerCharging).toBe(false);
  });

  it("should handle BATTLE_CHARGE event", () => {
    const state = makeInitialState();
    state.battleState = "fighting";

    const event: GameEvent = {
      type: "BATTLE_CHARGE",
      monsterDamage: 1,
      playerHpAfter: 4,
      playerDied: false,
    };

    const result = applyEvent(state, event);
    expect(result.hp).toBe(4);
    expect(result.playerCharging).toBe(true);
  });

  it("should handle BATTLE_HEAL event", () => {
    const state = makeInitialState();
    state.battleState = "fighting";
    state.hp = 3;
    state.potions = 2;

    const event: GameEvent = {
      type: "BATTLE_HEAL",
      healAmount: 2,
      playerHpAfter: 5,
      potionsAfter: 1,
    };

    const result = applyEvent(state, event);
    expect(result.hp).toBe(5);
    expect(result.potions).toBe(1);
    expect(result.stats.potionsUsed).toBe(1);
  });

  it("should handle BATTLE_WON event", () => {
    const state = makeInitialState();
    state.battleState = "fighting";
    state.battleRoomIdx = 5;
    state.coins = 10;
    state.potions = 0;

    const event: GameEvent = {
      type: "BATTLE_WON",
      coinReward: 5,
      gotPotion: true,
      roomIdx: 5,
    };

    const result = applyEvent(state, event);
    expect(result.battleState).toBe("won");
    expect(result.coins).toBe(15);
    expect(result.potions).toBe(1);
    expect(result.board[5].defeated).toBe(true);
    expect(result.stats.monstersDefeated).toBe(1);
    expect(result.playerCharging).toBe(false);
  });

  it("should handle BATTLE_LOST event", () => {
    const state = makeInitialState();
    state.battleState = "fighting";
    state.hp = 1;

    const event: GameEvent = {
      type: "BATTLE_LOST",
      roomIdx: 5,
    };

    const result = applyEvent(state, event);
    expect(result.hp).toBe(0);
    expect(result.status).toBe("lost");
    expect(result.battleState).toBe("lost");
  });

  it("should handle BATTLE_FLED event without dying", () => {
    const state = makeInitialState();
    state.battleState = "fighting";
    state.battleRoomIdx = 5;
    state.hp = 3;
    state.board[5] = { type: "monster", revealed: true };

    const event: GameEvent = {
      type: "BATTLE_FLED",
      fleeDamage: 1,
      playerHpAfter: 2,
      roomIdx: 5,
      playerDied: false,
    };

    const result = applyEvent(state, event);
    expect(result.hp).toBe(2);
    expect(result.battleState).toBe("fled");
    expect(result.board[5].revealed).toBe(false);
    expect(result.board[5].defeated).toBe(false);
    expect(result.stats.fleeCount).toBe(1);
  });

  it("should handle BATTLE_FLED event with death", () => {
    const state = makeInitialState();
    state.battleState = "fighting";
    state.battleRoomIdx = 5;
    state.hp = 1;
    state.board[5] = { type: "monster", revealed: true };

    const event: GameEvent = {
      type: "BATTLE_FLED",
      fleeDamage: 1,
      playerHpAfter: 0,
      roomIdx: 5,
      playerDied: true,
    };

    const result = applyEvent(state, event);
    expect(result.hp).toBe(0);
    expect(result.status).toBe("lost");
    expect(result.battleState).toBe("fled");
  });

  it("should handle BATTLE_CLOSE event", () => {
    const state = makeInitialState();
    state.battleState = "won";
    state.currentMonster = {
      name: "史莱姆",
      icon: "🟢",
      maxHp: 3,
      hp: 0,
      attack: 1,
      coinReward: 5,
      potionDropChance: 0.1,
    };
    state.battleRoomIdx = 5;
    state.playerCharging = true;

    const event: GameEvent = { type: "BATTLE_CLOSE" };

    const result = applyEvent(state, event);
    expect(result.battleState).toBe("idle");
    expect(result.currentMonster).toBeNull();
    expect(result.battleRoomIdx).toBe(-1);
    expect(result.playerCharging).toBe(false);
  });

  it("should handle HEAL event", () => {
    const state = makeInitialState();
    state.hp = 3;
    state.potions = 2;

    const event: GameEvent = {
      type: "HEAL",
      healAmount: 2,
      playerHpAfter: 5,
      potionsAfter: 1,
    };

    const result = applyEvent(state, event);
    expect(result.hp).toBe(5);
    expect(result.potions).toBe(1);
    expect(result.stats.potionsUsed).toBe(1);
  });

  it("should handle NEXT_FLOOR event", () => {
    const state = makeInitialState();
    state.floor = 1;
    state.keys = 1;
    state.coins = 50;
    state.potions = 2;
    state.hp = 4;

    const newBoard = makeTestBoard();
    const event: GameEvent = {
      type: "NEXT_FLOOR",
      newFloor: 2,
      route: "greedy",
      boardLayout: newBoard,
    };

    const result = applyEvent(state, event);
    expect(result.floor).toBe(2);
    expect(result.keys).toBe(0);
    expect(result.coins).toBe(50);
    expect(result.potions).toBe(2);
    expect(result.hp).toBe(4);
    expect(result.status).toBe("playing");
    expect(result.battleState).toBe("idle");
    expect(result.currentRoute).toBe("greedy");
    expect(result.board.length).toBe(TOTAL);
  });

  it("should handle GAME_RESET event", () => {
    const state = makeInitialState();
    state.floor = 5;
    state.coins = 100;
    state.hp = 3;

    const newBoard = makeTestBoard();
    const event: GameEvent = {
      type: "GAME_RESET",
      boardLayout: newBoard,
    };

    const result = applyEvent(state, event);
    expect(result.floor).toBe(1);
    expect(result.coins).toBe(0);
    expect(result.hp).toBe(GAME_CONSTANTS.maxHp);
    expect(result.status).toBe("playing");
  });

  it("should handle SETTLEMENT event", () => {
    const state = makeInitialState();
    state.status = "playing";

    const event: GameEvent = {
      type: "SETTLEMENT",
      resultType: "death",
      finalFloor: 3,
      finalCoins: 50,
      finalHp: 0,
      stats: { ...INITIAL_STATS, revealedRooms: 10 },
      brokeFloorRecord: false,
      brokeCoinRecord: true,
    };

    const result = applyEvent(state, event);
    expect(result.showSettlement).toBe(true);
    expect(result.settlementResult).toBe("death");
    expect(result.status).toBe("lost");
  });
});

describe("rebuildState", () => {
  it("should rebuild correct state from event sequence", () => {
    const board = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board),
      {
        type: "ROOM_FLIP",
        idx: 1,
        roomType: "coin",
        hpDelta: 0,
        coinDelta: 5,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        statusAfter: "playing",
      },
      {
        type: "ROOM_FLIP",
        idx: 2,
        roomType: "trap",
        hpDelta: -1,
        coinDelta: 0,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: true,
        statusAfter: "playing",
      },
    ];

    const result = rebuildState(events);
    expect(result.coins).toBe(5);
    expect(result.hp).toBe(GAME_CONSTANTS.maxHp - 1);
    expect(result.turn).toBe(2);
    expect(result.stats.trapHits).toBe(1);
    expect(result.board[1].revealed).toBe(true);
    expect(result.board[2].revealed).toBe(true);
  });

  it("should return initial state for empty events array", () => {
    const result = rebuildState([]);
    expect(result.hp).toBe(GAME_CONSTANTS.maxHp);
    expect(result.floor).toBe(1);
  });

  it("should handle multiple floor transitions", () => {
    const board1 = makeTestBoard();
    const board2 = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board1, 1),
      {
        type: "ROOM_FLIP",
        idx: 1,
        roomType: "coin",
        hpDelta: 0,
        coinDelta: 10,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        statusAfter: "playing",
      },
      {
        type: "NEXT_FLOOR",
        newFloor: 2,
        route: "safe",
        boardLayout: board2,
      },
      {
        type: "ROOM_FLIP",
        idx: 1,
        roomType: "coin",
        hpDelta: 0,
        coinDelta: 15,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        statusAfter: "playing",
      },
    ];

    const result = rebuildState(events);
    expect(result.floor).toBe(2);
    expect(result.coins).toBe(25);
    expect(result.currentRoute).toBe("safe");
  });

  it("should handle battle sequence correctly", () => {
    const board = makeTestBoard();
    const monster = {
      name: "史莱姆",
      icon: "🟢",
      maxHp: 3,
      hp: 3,
      attack: 1,
      coinReward: 5,
      potionDropChance: 0.1,
    };

    const events: GameEvent[] = [
      makeInitEvent(board),
      {
        type: "ROOM_FLIP",
        idx: 5,
        roomType: "monster",
        hpDelta: 0,
        coinDelta: 0,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        monster,
        statusAfter: "playing",
      },
      {
        type: "BATTLE_ATTACK",
        damage: 2,
        charged: false,
        monsterHpAfter: 1,
        monsterDamage: 1,
        playerHpAfter: 4,
        monsterDefeated: false,
      },
      {
        type: "BATTLE_ATTACK",
        damage: 1,
        charged: false,
        monsterHpAfter: 0,
        monsterDamage: 0,
        playerHpAfter: 4,
        monsterDefeated: true,
      },
      {
        type: "BATTLE_WON",
        coinReward: 5,
        gotPotion: false,
        roomIdx: 5,
      },
      {
        type: "BATTLE_CLOSE",
      },
    ];

    const result = rebuildState(events);
    expect(result.battleState).toBe("idle");
    expect(result.currentMonster).toBeNull();
    expect(result.coins).toBe(5);
    expect(result.hp).toBe(4);
    expect(result.stats.monstersDefeated).toBe(1);
    expect(result.board[5].defeated).toBe(true);
  });
});

describe("verifyReconstruction", () => {
  it("should return valid when reconstructed state matches expected", () => {
    const board = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board),
      {
        type: "ROOM_FLIP",
        idx: 1,
        roomType: "coin",
        hpDelta: 0,
        coinDelta: 5,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        statusAfter: "playing",
      },
    ];

    const expected: Partial<GameState> = {
      coins: 5,
      turn: 1,
      status: "playing",
    };

    const result = verifyReconstruction(events, expected);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it("should detect mismatches in simple fields", () => {
    const board = makeTestBoard();
    const events: GameEvent[] = [makeInitEvent(board)];

    const expected: Partial<GameState> = {
      coins: 100,
      hp: 1,
    };

    const result = verifyReconstruction(events, expected);
    expect(result.valid).toBe(false);
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches.some((m) => m.includes("coins"))).toBe(true);
    expect(result.mismatches.some((m) => m.includes("hp"))).toBe(true);
  });

  it("should detect mismatches in stats", () => {
    const board = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board),
      {
        type: "ROOM_FLIP",
        idx: 1,
        roomType: "trap",
        hpDelta: -1,
        coinDelta: 0,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: true,
        statusAfter: "playing",
      },
    ];

    const expected: Partial<GameState> = {
      stats: {
        ...INITIAL_STATS,
        revealedRooms: 2,
        trapHits: 2,
      },
    };

    const result = verifyReconstruction(events, expected);
    expect(result.valid).toBe(false);
    expect(result.mismatches.some((m) => m.includes("stats.trapHits"))).toBe(true);
  });

  it("should detect board mismatches", () => {
    const board = makeTestBoard();
    const events: GameEvent[] = [makeInitEvent(board)];

    const expectedState = initialGameState(board);
    expectedState.board[1].revealed = true;

    const result = verifyReconstruction(events, { board: expectedState.board });
    expect(result.valid).toBe(false);
    expect(result.mismatches.some((m) => m.includes("board[1].revealed"))).toBe(true);
  });

  it("should detect currentMonster mismatches", () => {
    const board = makeTestBoard();
    const monster = {
      name: "史莱姆",
      icon: "🟢",
      maxHp: 3,
      hp: 3,
      attack: 1,
      coinReward: 5,
      potionDropChance: 0.1,
    };

    const events: GameEvent[] = [
      makeInitEvent(board),
      {
        type: "ROOM_FLIP",
        idx: 5,
        roomType: "monster",
        hpDelta: 0,
        coinDelta: 0,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        monster,
        statusAfter: "playing",
      },
    ];

    const wrongMonster = { ...monster, name: "蝙蝠" };
    const result = verifyReconstruction(events, { currentMonster: wrongMonster });
    expect(result.valid).toBe(false);
    expect(result.mismatches.some((m) => m.includes("currentMonster.name"))).toBe(true);
  });
});

describe("EventStore", () => {
  let store: EventStore;
  let board: RoomType[];

  beforeEach(() => {
    store = new EventStore();
    board = makeTestBoard();
  });

  it("should start with empty events", () => {
    expect(store.getEventCount()).toBe(0);
    expect(store.getEvents()).toEqual([]);
  });

  it("should push events correctly", () => {
    const initEvent = makeInitEvent(board);
    store.push(initEvent);
    expect(store.getEventCount()).toBe(1);
    expect(store.getEvents()[0]).toEqual(initEvent);
  });

  it("should clear events correctly", () => {
    store.push(makeInitEvent(board));
    expect(store.getEventCount()).toBe(1);
    store.clear();
    expect(store.getEventCount()).toBe(0);
  });

  it("should rebuild state from events", () => {
    store.push(makeInitEvent(board));
    store.push({
      type: "ROOM_FLIP",
      idx: 1,
      roomType: "coin",
      hpDelta: 0,
      coinDelta: 10,
      keyDelta: 0,
      potionDelta: 0,
      trapHit: false,
      statusAfter: "playing",
    });

    const state = store.rebuild();
    expect(state.coins).toBe(10);
  });

  it("should rebuild state up to specific index", () => {
    store.push(makeInitEvent(board));
    store.push({
      type: "ROOM_FLIP",
      idx: 1,
      roomType: "coin",
      hpDelta: 0,
      coinDelta: 10,
      keyDelta: 0,
      potionDelta: 0,
      trapHit: false,
      statusAfter: "playing",
    });
    store.push({
      type: "ROOM_FLIP",
      idx: 2,
      roomType: "coin",
      hpDelta: 0,
      coinDelta: 5,
      keyDelta: 0,
      potionDelta: 0,
      trapHit: false,
      statusAfter: "playing",
    });

    const stateAt1 = store.rebuildUpTo(1);
    expect(stateAt1.coins).toBe(0);
    expect(stateAt1.turn).toBe(0);

    const stateAt2 = store.rebuildUpTo(2);
    expect(stateAt2.coins).toBe(10);
    expect(stateAt2.turn).toBe(1);

    const stateAt3 = store.rebuildUpTo(3);
    expect(stateAt3.coins).toBe(15);
    expect(stateAt3.turn).toBe(2);
  });

  it("should load events from save", () => {
    const events: GameEvent[] = [
      makeInitEvent(board),
      {
        type: "ROOM_FLIP",
        idx: 1,
        roomType: "coin",
        hpDelta: 0,
        coinDelta: 5,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        statusAfter: "playing",
      },
    ];

    store.loadFromSave(events);
    expect(store.getEventCount()).toBe(2);

    const state = store.rebuild();
    expect(state.coins).toBe(5);
  });

  it("should use snapshot for faster rebuild", () => {
    store.push(makeInitEvent(board));
    for (let i = 0; i < 5; i++) {
      store.push({
        type: "ROOM_FLIP",
        idx: i + 1,
        roomType: "coin",
        hpDelta: 0,
        coinDelta: 1,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        statusAfter: "playing",
      });
    }

    const fullState = store.rebuild();
    expect(fullState.coins).toBe(5);

    store.loadFromSave(store.getEvents().slice(0, 3), store.rebuildUpTo(3));
    const partialState = store.rebuild();
    expect(partialState.coins).toBe(2);

    store.push({
      type: "ROOM_FLIP",
      idx: 10,
      roomType: "coin",
      hpDelta: 0,
      coinDelta: 10,
      keyDelta: 0,
      potionDelta: 0,
      trapHit: false,
      statusAfter: "playing",
    });
    const stateAfterPush = store.rebuild();
    expect(stateAfterPush.coins).toBe(12);
  });

  it("getEventsUpTo should return correct slice", () => {
    store.push(makeInitEvent(board));
    store.push({ type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 1, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" });
    store.push({ type: "ROOM_FLIP", idx: 2, roomType: "coin", hpDelta: 0, coinDelta: 1, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" });

    expect(store.getEventsUpTo(0)).toEqual([]);
    expect(store.getEventsUpTo(1)).toHaveLength(1);
    expect(store.getEventsUpTo(2)).toHaveLength(2);
    expect(store.getEventsUpTo(100)).toHaveLength(3);
  });

  it("should get current floor correctly", () => {
    const board2 = makeTestBoard();
    store.push(makeInitEvent(board, 1));
    store.push({ type: "NEXT_FLOOR", newFloor: 2, route: null, boardLayout: board2 });
    expect(store.getCurrentFloor()).toBe(2);
    expect(store.getTotalFloors()).toBe(2);
  });
});

describe("floor boundary functions", () => {
  it("getFloorBoundaries should identify single floor", () => {
    const board = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board, 1),
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 5, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
    ];

    const boundaries = getFloorBoundaries(events);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].floor).toBe(1);
    expect(boundaries[0].startEventIndex).toBe(0);
    expect(boundaries[0].endEventIndex).toBe(1);
  });

  it("getFloorBoundaries should identify multiple floors", () => {
    const board1 = makeTestBoard();
    const board2 = makeTestBoard();
    const board3 = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board1, 1),
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 5, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
      { type: "NEXT_FLOOR", newFloor: 2, route: null, boardLayout: board2 },
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 10, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
      { type: "NEXT_FLOOR", newFloor: 3, route: null, boardLayout: board3 },
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 15, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
    ];

    const boundaries = getFloorBoundaries(events);
    expect(boundaries).toHaveLength(3);
    expect(boundaries[0].floor).toBe(1);
    expect(boundaries[1].floor).toBe(2);
    expect(boundaries[2].floor).toBe(3);
  });

  it("getFloorEvents should return events for specific floor", () => {
    const board1 = makeTestBoard();
    const board2 = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board1, 1),
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 5, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
      { type: "NEXT_FLOOR", newFloor: 2, route: null, boardLayout: board2 },
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 10, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
    ];

    const floor1Events = getFloorEvents(events, 1);
    expect(floor1Events).toHaveLength(2);
    expect(floor1Events[0].type).toBe("GAME_INIT");

    const floor2Events = getFloorEvents(events, 2);
    expect(floor2Events).toHaveLength(2);
    expect(floor2Events[0].type).toBe("NEXT_FLOOR");

    expect(getFloorEvents(events, 99)).toEqual([]);
  });

  it("rebuildFloorState should rebuild state for specific floor", () => {
    const board1 = makeTestBoard();
    const board2 = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board1, 1),
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 5, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
      { type: "NEXT_FLOOR", newFloor: 2, route: null, boardLayout: board2 },
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 10, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
    ];

    const floor1Result = rebuildFloorState(events, 1);
    expect(floor1Result).not.toBeNull();
    expect(floor1Result!.startState.floor).toBe(1);
    expect(floor1Result!.endState.coins).toBe(5);
    expect(floor1Result!.endState.floor).toBe(1);

    const floor2Result = rebuildFloorState(events, 2);
    expect(floor2Result).not.toBeNull();
    expect(floor2Result!.startState.floor).toBe(1);
    expect(floor2Result!.endState.floor).toBe(2);
    expect(floor2Result!.endState.coins).toBe(15);

    expect(rebuildFloorState(events, 99)).toBeNull();
  });

  it("getFloorProgress should calculate floor progress", () => {
    const board = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board, 1),
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 5, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
      { type: "ROOM_FLIP", idx: 2, roomType: "trap", hpDelta: -1, coinDelta: 0, keyDelta: 0, potionDelta: 0, trapHit: true, statusAfter: "playing" },
      { type: "ROOM_FLIP", idx: 3, roomType: "potion", hpDelta: 0, coinDelta: 0, keyDelta: 0, potionDelta: 1, trapHit: false, statusAfter: "playing" },
      { type: "HEAL", healAmount: 2, playerHpAfter: 6, potionsAfter: 0 },
    ];

    const progress = getFloorProgress(events, 1);
    expect(progress).not.toBeNull();
    expect(progress!.floor).toBe(1);
    expect(progress!.revealedRooms).toBe(3);
    expect(progress!.trapHits).toBe(1);
    expect(progress!.potionsGained).toBe(1);
    expect(progress!.potionsUsed).toBe(1);
    expect(progress!.coinsEnd).toBe(5);
  });

  it("getFloorProgress should track battle victories", () => {
    const board = makeTestBoard();
    const monster = {
      name: "史莱姆",
      icon: "🟢",
      maxHp: 3,
      hp: 3,
      attack: 1,
      coinReward: 5,
      potionDropChance: 0.1,
    };
    const events: GameEvent[] = [
      makeInitEvent(board, 1),
      {
        type: "ROOM_FLIP",
        idx: 5,
        roomType: "monster",
        hpDelta: 0,
        coinDelta: 0,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        monster,
        statusAfter: "playing",
      },
      {
        type: "BATTLE_WON",
        coinReward: 5,
        gotPotion: true,
        roomIdx: 5,
      },
    ];

    const progress = getFloorProgress(events, 1);
    expect(progress).not.toBeNull();
    expect(progress!.defeatedMonsters).toBe(1);
    expect(progress!.potionsGained).toBe(1);
    expect(progress!.coinsEnd).toBe(5);
  });

  it("getCurrentFloorProgress should return latest floor progress", () => {
    const board1 = makeTestBoard();
    const board2 = makeTestBoard();
    const events: GameEvent[] = [
      makeInitEvent(board1, 1),
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 5, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
      { type: "NEXT_FLOOR", newFloor: 2, route: null, boardLayout: board2 },
      { type: "ROOM_FLIP", idx: 1, roomType: "coin", hpDelta: 0, coinDelta: 10, keyDelta: 0, potionDelta: 0, trapHit: false, statusAfter: "playing" },
    ];

    const progress = getCurrentFloorProgress(events);
    expect(progress).not.toBeNull();
    expect(progress!.floor).toBe(2);
    expect(progress!.coinsEnd).toBe(15);
  });
});
