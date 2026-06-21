import {
  RoomType,
  RouteType,
  Monster,
  GAME_CONSTANTS,
  BATTLE_CONFIG,
  EVENT_MESSAGES,
  getFloorConfig,
  generateMonster,
  getCoinReward,
  getDamage,
} from "../config/gameConfig";
import { generateMap } from "../config/mapGenerator";

export interface Room {
  type: RoomType;
  revealed: boolean;
  defeated?: boolean;
}

export type BattleState = "idle" | "fighting" | "won" | "lost" | "fled";

export interface GameStats {
  revealedRooms: number;
  trapHits: number;
  monstersDefeated: number;
  potionsUsed: number;
  fleeCount: number;
}

export const INITIAL_STATS: GameStats = {
  revealedRooms: 1,
  trapHits: 0,
  monstersDefeated: 0,
  potionsUsed: 0,
  fleeCount: 0,
};

export type GameResultType = "clear" | "death" | "restart";

export interface GameState {
  board: Room[];
  hp: number;
  coins: number;
  keys: number;
  potions: number;
  floor: number;
  status: "playing" | "won" | "lost";
  turn: number;
  stats: GameStats;
  battleState: BattleState;
  currentMonster: Monster | null;
  battleRoomIdx: number;
  playerCharging: boolean;
  currentRoute: RouteType;
  showRouteHint: boolean;
  showRiskHint: boolean;
  showSettlement: boolean;
  settlementResult: GameResultType | null;
}

export function initialGameState(boardLayout: RoomType[]): GameState {
  return {
    board: boardLayout.map((t) => ({ type: t, revealed: t === "start" })),
    hp: GAME_CONSTANTS.maxHp,
    coins: 0,
    keys: 0,
    potions: 0,
    floor: 1,
    status: "playing",
    turn: 0,
    stats: { ...INITIAL_STATS },
    battleState: "idle",
    currentMonster: null,
    battleRoomIdx: -1,
    playerCharging: false,
    currentRoute: null,
    showRouteHint: false,
    showRiskHint: false,
    showSettlement: false,
    settlementResult: null,
  };
}

export interface GameInitEvent {
  type: "GAME_INIT";
  floor: number;
  route: RouteType;
  boardLayout: RoomType[];
}

export interface RoomFlipEvent {
  type: "ROOM_FLIP";
  idx: number;
  roomType: RoomType;
  hpDelta: number;
  coinDelta: number;
  keyDelta: number;
  potionDelta: number;
  trapHit: boolean;
  monster?: Monster;
  statusAfter: "playing" | "won" | "lost";
}

export interface BattleAttackEvent {
  type: "BATTLE_ATTACK";
  damage: number;
  charged: boolean;
  monsterHpAfter: number;
  monsterDamage: number;
  playerHpAfter: number;
  monsterDefeated: boolean;
}

export interface BattleChargeEvent {
  type: "BATTLE_CHARGE";
  monsterDamage: number;
  playerHpAfter: number;
  playerDied: boolean;
}

export interface BattleHealEvent {
  type: "BATTLE_HEAL";
  healAmount: number;
  playerHpAfter: number;
  potionsAfter: number;
}

export interface BattleFleeEvent {
  type: "BATTLE_FLEE";
  success: boolean;
  fleeDamage: number;
  playerHpAfter: number;
  playerDied: boolean;
}

export interface BattleWonEvent {
  type: "BATTLE_WON";
  coinReward: number;
  gotPotion: boolean;
  roomIdx: number;
}

export interface BattleLostEvent {
  type: "BATTLE_LOST";
  roomIdx: number;
}

export interface BattleFledEvent {
  type: "BATTLE_FLED";
  fleeDamage: number;
  playerHpAfter: number;
  roomIdx: number;
  playerDied: boolean;
}

export interface BattleCloseEvent {
  type: "BATTLE_CLOSE";
}

export interface HealEvent {
  type: "HEAL";
  healAmount: number;
  playerHpAfter: number;
  potionsAfter: number;
}

export interface NextFloorEvent {
  type: "NEXT_FLOOR";
  newFloor: number;
  route: RouteType;
  boardLayout: RoomType[];
}

export interface GameResetEvent {
  type: "GAME_RESET";
  boardLayout: RoomType[];
}

export interface SaveRestoreEvent {
  type: "SAVE_RESTORE";
  source: string;
}

export interface ExitWithKeyEvent {
  type: "EXIT_WITH_KEY";
}

export interface SettlementEvent {
  type: "SETTLEMENT";
  resultType: GameResultType;
  finalFloor: number;
  finalCoins: number;
  finalHp: number;
  stats: GameStats;
  brokeFloorRecord: boolean;
  brokeCoinRecord: boolean;
}

export type GameEvent =
  | GameInitEvent
  | RoomFlipEvent
  | BattleAttackEvent
  | BattleChargeEvent
  | BattleHealEvent
  | BattleFleeEvent
  | BattleWonEvent
  | BattleLostEvent
  | BattleFledEvent
  | BattleCloseEvent
  | HealEvent
  | NextFloorEvent
  | GameResetEvent
  | SaveRestoreEvent
  | ExitWithKeyEvent
  | SettlementEvent;

export function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case "GAME_INIT": {
      return {
        ...initialGameState(event.boardLayout),
        floor: event.floor,
        currentRoute: event.route,
        board: event.boardLayout.map((t) => ({ type: t, revealed: t === "start" })),
      };
    }

    case "ROOM_FLIP": {
      const newBoard = state.board.map((r, i) =>
        i === event.idx ? { ...r, revealed: true } : r
      );
      const newStats = { ...state.stats, revealedRooms: state.stats.revealedRooms + 1 };
      if (event.trapHit) {
        newStats.trapHits = state.stats.trapHits + 1;
      }
      if (event.monster) {
        return {
          ...state,
          board: newBoard,
          turn: state.turn + 1,
          stats: newStats,
          battleState: "fighting",
          currentMonster: event.monster,
          battleRoomIdx: event.idx,
          playerCharging: false,
        };
      }
      return {
        ...state,
        board: newBoard,
        hp: state.hp + event.hpDelta,
        coins: state.coins + event.coinDelta,
        keys: state.keys + event.keyDelta,
        potions: state.potions + event.potionDelta,
        turn: state.turn + 1,
        stats: newStats,
        status: event.statusAfter,
      };
    }

    case "EXIT_WITH_KEY": {
      return {
        ...state,
        status: "won",
        turn: state.turn + 1,
      };
    }

    case "BATTLE_ATTACK": {
      if (!state.currentMonster) return state;
      const updatedMonster: Monster = { ...state.currentMonster, hp: event.monsterHpAfter };
      if (event.monsterDefeated) {
        return {
          ...state,
          currentMonster: updatedMonster,
          playerCharging: false,
        };
      }
      return {
        ...state,
        hp: event.playerHpAfter,
        currentMonster: updatedMonster,
        playerCharging: false,
      };
    }

    case "BATTLE_CHARGE": {
      return {
        ...state,
        hp: event.playerHpAfter,
        playerCharging: true,
      };
    }

    case "BATTLE_HEAL": {
      return {
        ...state,
        hp: event.playerHpAfter,
        potions: event.potionsAfter,
        stats: { ...state.stats, potionsUsed: state.stats.potionsUsed + 1 },
      };
    }

    case "BATTLE_FLEE": {
      return {
        ...state,
        hp: event.playerHpAfter,
      };
    }

    case "BATTLE_WON": {
      const newBoard = state.board.map((r, i) =>
        i === event.roomIdx ? { ...r, defeated: true } : r
      );
      return {
        ...state,
        board: newBoard,
        coins: state.coins + event.coinReward,
        potions: state.potions + (event.gotPotion ? 1 : 0),
        stats: { ...state.stats, monstersDefeated: state.stats.monstersDefeated + 1 },
        battleState: "won",
        playerCharging: false,
      };
    }

    case "BATTLE_LOST": {
      return {
        ...state,
        hp: 0,
        status: "lost",
        battleState: "lost",
        playerCharging: false,
      };
    }

    case "BATTLE_FLED": {
      const newBoard = state.board.map((r, i) =>
        i === event.roomIdx ? { ...r, revealed: false, defeated: false } : r
      );
      const newStats = { ...state.stats, fleeCount: state.stats.fleeCount + 1 };
      if (event.playerDied) {
        return {
          ...state,
          board: newBoard,
          hp: event.playerHpAfter,
          stats: newStats,
          status: "lost",
          battleState: "fled",
          playerCharging: false,
        };
      }
      return {
        ...state,
        board: newBoard,
        hp: event.playerHpAfter,
        stats: newStats,
        battleState: "fled",
        playerCharging: false,
      };
    }

    case "BATTLE_CLOSE": {
      return {
        ...state,
        battleState: "idle",
        currentMonster: null,
        battleRoomIdx: -1,
        playerCharging: false,
      };
    }

    case "HEAL": {
      return {
        ...state,
        hp: event.playerHpAfter,
        potions: event.potionsAfter,
        stats: { ...state.stats, potionsUsed: state.stats.potionsUsed + 1 },
      };
    }

    case "NEXT_FLOOR": {
      return {
        ...state,
        board: event.boardLayout.map((t) => ({ type: t, revealed: t === "start" })),
        floor: event.newFloor,
        keys: 0,
        status: "playing",
        turn: 0,
        battleState: "idle",
        currentMonster: null,
        battleRoomIdx: -1,
        playerCharging: false,
        currentRoute: event.route,
      };
    }

    case "GAME_RESET": {
      return initialGameState(event.boardLayout);
    }

    case "SAVE_RESTORE": {
      return state;
    }

    case "SETTLEMENT": {
      return {
        ...state,
        showSettlement: true,
        settlementResult: event.resultType,
        status: event.resultType === "death" ? "lost" : state.status,
      };
    }

    default:
      return state;
  }
}

export function rebuildState(events: GameEvent[]): GameState {
  let state: GameState | null = null;
  for (const event of events) {
    if (event.type === "GAME_INIT") {
      state = applyEvent(initialGameState(event.boardLayout), event);
    } else if (state) {
      state = applyEvent(state, event);
    }
  }
  if (!state) {
    const layout = generateMap(1, null).rooms;
    return initialGameState(layout);
  }
  return state;
}

export class EventStore {
  private events: GameEvent[] = [];
  private snapshot: GameState | null = null;
  private snapshotIndex: number = -1;

  getEvents(): GameEvent[] {
    return [...this.events];
  }

  getEventCount(): number {
    return this.events.length;
  }

  getEventsUpTo(index: number): GameEvent[] {
    return this.events.slice(0, index);
  }

  push(event: GameEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events = [];
    this.snapshot = null;
    this.snapshotIndex = -1;
  }

  loadFromSave(events: GameEvent[], snapshot?: GameState): void {
    this.events = events;
    this.snapshot = snapshot ?? null;
    this.snapshotIndex = snapshot ? events.length : -1;
  }

  rebuild(): GameState {
    if (this.events.length === 0) {
      const layout = generateMap(1, null).rooms;
      return initialGameState(layout);
    }
    if (this.snapshot && this.snapshotIndex >= 0) {
      const eventsAfterSnapshot = this.events.slice(this.snapshotIndex);
      let state = this.snapshot;
      for (const event of eventsAfterSnapshot) {
        state = applyEvent(state, event);
      }
      return state;
    }
    return rebuildState(this.events);
  }

  rebuildUpTo(index: number): GameState {
    const eventsUpTo = this.events.slice(0, index);
    return rebuildState(eventsUpTo);
  }
}

export function verifyReconstruction(
  events: GameEvent[],
  expectedState: Partial<GameState>
): { valid: boolean; mismatches: string[] } {
  const reconstructed = rebuildState(events);
  const mismatches: string[] = [];

  const fieldsToCheck: (keyof GameState)[] = [
    "hp",
    "coins",
    "keys",
    "potions",
    "floor",
    "status",
    "turn",
    "battleState",
    "battleRoomIdx",
    "playerCharging",
    "currentRoute",
    "showRouteHint",
    "showRiskHint",
    "showSettlement",
    "settlementResult",
  ];

  for (const field of fieldsToCheck) {
    const expected = expectedState[field];
    const actual = reconstructed[field];
    if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(actual)) {
      mismatches.push(`${field}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  if (expectedState.stats) {
    for (const statKey of Object.keys(expectedState.stats) as (keyof GameStats)[]) {
      if (expectedState.stats[statKey] !== reconstructed.stats[statKey]) {
        mismatches.push(`stats.${statKey}: expected ${expectedState.stats[statKey]}, got ${reconstructed.stats[statKey]}`);
      }
    }
  }

  if (expectedState.board) {
    for (let i = 0; i < expectedState.board.length; i++) {
      const expectedRoom = expectedState.board[i];
      const actualRoom = reconstructed.board[i];
      if (expectedRoom.revealed !== actualRoom.revealed) {
        mismatches.push(`board[${i}].revealed: expected ${expectedRoom.revealed}, got ${actualRoom.revealed}`);
      }
      if (expectedRoom.defeated !== actualRoom.defeated) {
        mismatches.push(`board[${i}].defeated: expected ${expectedRoom.defeated}, got ${actualRoom.defeated}`);
      }
    }
  }

  return {
    valid: mismatches.length === 0,
    mismatches,
  };
}

export type { GameEvent as GameEventType };
