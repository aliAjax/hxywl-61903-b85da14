import { useCallback, useEffect, useRef, useState } from "react";
import {
  GAME_CONSTANTS,
  EVENT_MESSAGES,
  BATTLE_CONFIG,
  RoomType,
  Monster,
  getFloorConfig,
  getCoinReward,
  generateMonster,
  RouteType,
  ROUTE_CONFIGS,
} from "../config/gameConfig";
import { generateMap, GenerationResult } from "../config/mapGenerator";
import {
  saveGame,
  loadGame,
  clearSave,
  saveGameToSlot,
  loadGameFromSlot,
  getSlotList,
  deleteSlot,
  SlotMeta,
} from "../config/saveSystem";
import {
  EventStore,
  GameEvent,
  GameState,
  GameResultType,
  initialGameState,
  applyEvent,
  rebuildState,
  verifyReconstruction,
} from "../model/eventStore";

export interface Room {
  type: RoomType;
  revealed: boolean;
  defeated?: boolean;
}

export interface BattleLog {
  id: number;
  message: string;
  type: "player" | "monster" | "system" | "reward";
}

export type BattleState = "idle" | "fighting" | "won" | "lost" | "fled";

export interface TurnRecord {
  id: number;
  turn: number;
  floor: number;
  event: string;
  roomType?: RoomType;
  hpDelta: number;
  coinDelta: number;
  items: string[];
}

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

let lastGenResult: GenerationResult | null = null;

export function generateBoard(floor: number = 1, route: RouteType = null): Room[] {
  const result = generateMap(floor, route);
  lastGenResult = result;
  return result.rooms.map((t) => ({ type: t, revealed: t === "start" }));
}

export function getBoardLayout(rooms: Room[]): RoomType[] {
  return rooms.map((r) => r.type);
}

export function getLastGenResult(): GenerationResult | null {
  return lastGenResult;
}

let battleLogIdCounter = 0;
let recordIdCounter = 0;

export function createBattleLog(message: string, type: BattleLog["type"]): BattleLog {
  return { id: ++battleLogIdCounter, message, type };
}

export function createTurnRecord(record: Omit<TurnRecord, "id">): TurnRecord {
  return { id: ++recordIdCounter, ...record };
}

export function restoreCounters(history: TurnRecord[], battleLog: BattleLog[]): void {
  let maxRecord = 0;
  for (const r of history) {
    if (r.id > maxRecord) maxRecord = r.id;
  }
  let maxBattleLog = 0;
  for (const l of battleLog) {
    if (l.id > maxBattleLog) maxBattleLog = l.id;
  }
  recordIdCounter = maxRecord;
  battleLogIdCounter = maxBattleLog;
}

const loadResult = loadGame();
const loadedSave = loadResult?.save ?? null;
const wasBattleRepaired = loadResult?.battleRepaired ?? false;
const battleStateWasInconsistentOnLoad = loadResult?.battleStateWasInconsistent ?? false;

function normalizeStats(stats: Partial<GameStats> | undefined): GameStats {
  if (!stats) return INITIAL_STATS;
  return {
    revealedRooms: stats.revealedRooms ?? INITIAL_STATS.revealedRooms,
    trapHits: stats.trapHits ?? INITIAL_STATS.trapHits,
    monstersDefeated: stats.monstersDefeated ?? INITIAL_STATS.monstersDefeated,
    potionsUsed: stats.potionsUsed ?? INITIAL_STATS.potionsUsed,
    fleeCount: stats.fleeCount ?? INITIAL_STATS.fleeCount,
  };
}

export interface UseNormalProgressOptions {
  showSettlement: boolean;
}

function getStartIndex(layout: RoomType[]): number {
  return layout.findIndex((t) => t === "start");
}

function getRevealOrder(layout: RoomType[], revealedSet: Set<number>): number[] {
  const startIdx = getStartIndex(layout);
  const size = Math.floor(Math.sqrt(layout.length));
  const visited = new Set<number>();
  const order: number[] = [];
  const queue: number[] = [startIdx];
  visited.add(startIdx);

  while (queue.length > 0) {
    const idx = queue.shift()!;
    if (revealedSet.has(idx) && idx !== startIdx) {
      order.push(idx);
    }
    const r = Math.floor(idx / size);
    const c = idx % size;
    const neighbors: number[] = [];
    if (r > 0) neighbors.push(idx - size);
    if (r < size - 1) neighbors.push(idx + size);
    if (c > 0) neighbors.push(idx - 1);
    if (c < size - 1) neighbors.push(idx + 1);
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }
  return order;
}

function reconstructFloorEventsV2(
  floor: number,
  layout: RoomType[],
  savedBoard: Room[],
  route: RouteType,
  startState: GameState,
  targetState: {
    hp: number;
    coins: number;
    keys: number;
    potions: number;
    stats: GameStats;
    status: "playing" | "won" | "lost";
    battleState: BattleState;
    battleRoomIdx: number;
    currentMonster: Monster | null;
  }
): { events: GameEvent[]; endState: GameState } {
  const events: GameEvent[] = [];
  let state: GameState = { ...startState };

  const revealedSet = new Set<number>();
  const defeatedSet = new Set<number>();
  for (let i = 0; i < savedBoard.length; i++) {
    if (savedBoard[i].revealed) revealedSet.add(i);
    if (savedBoard[i].defeated) defeatedSet.add(i);
  }

  const revealOrder = getRevealOrder(layout, revealedSet);
  const totalRevealsNeeded = targetState.stats.revealedRooms - state.stats.revealedRooms;
  const actualReveals = Math.min(revealOrder.length, Math.max(0, totalRevealsNeeded));

  let potionsRemaining = targetState.potions;
  let coinsRemaining = targetState.coins;
  let keysRemaining = targetState.keys;
  let hpRemaining = targetState.hp;

  let monstersDefeatedRemaining = targetState.stats.monstersDefeated - state.stats.monstersDefeated;
  let trapHitsRemaining = targetState.stats.trapHits - state.stats.trapHits;
  let potionsUsedRemaining = targetState.stats.potionsUsed - state.stats.potionsUsed;

  for (let i = 0; i < actualReveals; i++) {
    const idx = revealOrder[i];
    const roomType = layout[idx];
    const isDefeated = defeatedSet.has(idx);
    const isCurrentBattle =
      targetState.battleState === "fighting" && targetState.battleRoomIdx === idx;
    const isLastRoom = i === actualReveals - 1;

    if (roomType === "monster" && (isDefeated || isCurrentBattle)) {
      const monster =
        isCurrentBattle && targetState.currentMonster
          ? { ...targetState.currentMonster }
          : generateMonster(floor, route);

      const flipEvent: GameEvent = {
        type: "ROOM_FLIP",
        idx,
        roomType,
        hpDelta: 0,
        coinDelta: 0,
        keyDelta: 0,
        potionDelta: 0,
        trapHit: false,
        monster: { ...monster },
        statusAfter: "playing",
      };
      events.push(flipEvent);
      state = applyEvent(state, flipEvent);

      if (isDefeated && monstersDefeatedRemaining > 0) {
        monstersDefeatedRemaining--;

        const expectedCoinsAfter = isLastRoom
          ? coinsRemaining
          : state.coins + monster.coinReward;
        const coinReward = expectedCoinsAfter - state.coins;
        const gotPotion = false;

        const attackEvent: GameEvent = {
          type: "BATTLE_ATTACK",
          damage: monster.maxHp,
          charged: false,
          monsterHpAfter: 0,
          monsterDamage: 0,
          playerHpAfter: isLastRoom ? hpRemaining : state.hp,
          monsterDefeated: true,
        };
        events.push(attackEvent);
        state = applyEvent(state, attackEvent);

        const wonEvent: GameEvent = {
          type: "BATTLE_WON",
          coinReward: Math.max(0, coinReward),
          gotPotion,
          roomIdx: idx,
        };
        events.push(wonEvent);
        state = applyEvent(state, wonEvent);

        const closeEvent: GameEvent = {
          type: "BATTLE_CLOSE",
        };
        events.push(closeEvent);
        state = applyEvent(state, closeEvent);
      }
    } else {
      let hpDelta = 0;
      let coinDelta = 0;
      let keyDelta = 0;
      let potionDelta = 0;
      let trapHit = false;

      if (roomType === "trap" && trapHitsRemaining > 0) {
        trapHit = true;
        hpDelta = -1;
        trapHitsRemaining--;
      } else if (roomType === "coin") {
        if (isLastRoom) {
          coinDelta = coinsRemaining - state.coins;
        } else {
          coinDelta = getCoinReward(floor, route);
        }
      } else if (roomType === "key") {
        keyDelta = 1;
      } else if (roomType === "potion") {
        potionDelta = 1;
      }

      if (isLastRoom) {
        hpDelta = hpRemaining - state.hp;
      }

      let statusAfter: "playing" | "won" | "lost" = "playing";
      if (isLastRoom) {
        statusAfter = targetState.status;
      }
      if (roomType === "exit" && state.keys + keyDelta > 0) {
        statusAfter = "won";
      }
      if (state.hp + hpDelta <= 0) {
        statusAfter = "lost";
      }

      const flipEvent: GameEvent = {
        type: "ROOM_FLIP",
        idx,
        roomType,
        hpDelta,
        coinDelta,
        keyDelta,
        potionDelta,
        trapHit,
        statusAfter,
      };
      events.push(flipEvent);
      state = applyEvent(state, flipEvent);

      if (statusAfter === "lost") {
        break;
      }
    }
  }

  while (potionsUsedRemaining > 0 && state.stats.potionsUsed < targetState.stats.potionsUsed) {
    if (state.potions <= 0 || state.hp >= GAME_CONSTANTS.maxHp) break;
    const healAmount = BATTLE_CONFIG.potionHeal;
    const newHp = Math.min(GAME_CONSTANTS.maxHp, state.hp + healAmount);
    const newPotions = state.potions - 1;
    const healEvent: GameEvent = {
      type: "HEAL",
      healAmount,
      playerHpAfter: newHp,
      potionsAfter: newPotions,
    };
    events.push(healEvent);
    state = applyEvent(state, healEvent);
    potionsUsedRemaining--;
  }

  if (targetState.status === "won" && state.status !== "won") {
    const hasExitRevealed = savedBoard.some((r) => r.type === "exit" && r.revealed);
    if (hasExitRevealed && state.keys > 0) {
      const exitEvent: GameEvent = {
        type: "EXIT_WITH_KEY",
      };
      events.push(exitEvent);
      state = applyEvent(state, exitEvent);
    }
  }

  let remainingHpDelta = targetState.hp - state.hp;
  let remainingCoinDelta = targetState.coins - state.coins;
  let remainingKeyDelta = targetState.keys - state.keys;
  let remainingPotionDelta = targetState.potions - state.potions;

  if (remainingHpDelta !== 0 || remainingCoinDelta !== 0 || remainingKeyDelta !== 0 || remainingPotionDelta !== 0) {
    for (let j = events.length - 1; j >= 0; j--) {
      const ev = events[j];
      if (ev.type === "ROOM_FLIP" && ev.idx >= 0 && !ev.monster) {
        (events[j] as any).hpDelta = (ev as any).hpDelta + remainingHpDelta;
        (events[j] as any).coinDelta = (ev as any).coinDelta + remainingCoinDelta;
        (events[j] as any).keyDelta = (ev as any).keyDelta + remainingKeyDelta;
        (events[j] as any).potionDelta = (ev as any).potionDelta + remainingPotionDelta;
        remainingHpDelta = 0;
        remainingCoinDelta = 0;
        remainingKeyDelta = 0;
        remainingPotionDelta = 0;
        break;
      }
      if (ev.type === "BATTLE_WON") {
        if (remainingCoinDelta !== 0) {
          (events[j] as any).coinReward = Math.max(0, (ev as any).coinReward + remainingCoinDelta);
          remainingCoinDelta = 0;
        }
      }
      if (ev.type === "BATTLE_ATTACK") {
        if (remainingHpDelta !== 0) {
          (events[j] as any).playerHpAfter = (ev as any).playerHpAfter + remainingHpDelta;
          remainingHpDelta = 0;
        }
      }
      if (remainingHpDelta === 0 && remainingCoinDelta === 0 && remainingKeyDelta === 0 && remainingPotionDelta === 0) {
        break;
      }
    }
  }

  if (remainingPotionDelta < 0 && state.potions + remainingPotionDelta >= 0) {
    const extraHealCount = Math.abs(remainingPotionDelta);
    for (let i = 0; i < extraHealCount; i++) {
      if (state.potions > 0) {
        const healAmount = BATTLE_CONFIG.potionHeal;
        const newHp = Math.min(GAME_CONSTANTS.maxHp, state.hp + healAmount);
        const newPotions = state.potions - 1;
        const healEvent: GameEvent = {
          type: "HEAL",
          healAmount,
          playerHpAfter: newHp,
          potionsAfter: newPotions,
        };
        events.push(healEvent);
        state = applyEvent(state, healEvent);
        remainingPotionDelta++;
      }
    }
  }

  const finalState = rebuildState(events.length > 0 ? events : events);

  return { events, endState: finalState };
}

function generateEventHistoryFromLegacySave(save: any): GameEvent[] {
  const events: GameEvent[] = [];
  const currentLayout = save.board.map((r: Room) => r.type);
  const route = save.currentRoute ?? null;

  const startLayout = save.floor === 1 ? currentLayout : generateMap(1, null).rooms;

  const initEvent: GameEvent = {
    type: "GAME_INIT",
    floor: 1,
    route: null,
    boardLayout: startLayout,
  };
  events.push(initEvent);

  let state = applyEvent(initialGameState(startLayout), initEvent);

  const savedStats: GameStats = {
    revealedRooms: save.stats?.revealedRooms ?? INITIAL_STATS.revealedRooms,
    trapHits: save.stats?.trapHits ?? INITIAL_STATS.trapHits,
    monstersDefeated: save.stats?.monstersDefeated ?? INITIAL_STATS.monstersDefeated,
    potionsUsed: save.stats?.potionsUsed ?? INITIAL_STATS.potionsUsed,
    fleeCount: save.stats?.fleeCount ?? INITIAL_STATS.fleeCount,
  };

  for (let floorNum = 1; floorNum <= save.floor; floorNum++) {
    const isCurrentFloor = floorNum === save.floor;
    const floorRoute = floorNum === save.floor ? route : null;
    let floorLayout: RoomType[];
    let floorBoard: Room[];

    if (isCurrentFloor) {
      floorLayout = currentLayout;
      floorBoard = save.board;
    } else {
      floorLayout = generateMap(floorNum, floorRoute).rooms;
      floorBoard = floorLayout.map((t) => ({
        type: t,
        revealed: true,
        defeated: t === "monster",
      }));
    }

    const floorSavedState = {
      hp: isCurrentFloor ? save.hp : state.hp,
      coins: isCurrentFloor ? save.coins : state.coins,
      keys: isCurrentFloor ? save.keys : 1,
      potions: isCurrentFloor ? save.potions : state.potions,
      stats: isCurrentFloor ? savedStats : state.stats,
      status: isCurrentFloor ? save.status : "won",
      battleState: isCurrentFloor ? save.battleState : "idle",
      battleRoomIdx: isCurrentFloor ? save.battleRoomIdx : -1,
      currentMonster: isCurrentFloor ? save.currentMonster : null,
    };

    const result = reconstructFloorEventsV2(
      floorNum,
      floorLayout,
      floorBoard,
      floorRoute,
      state,
      floorSavedState
    );

    events.push(...result.events);
    state = result.endState;

    if (!isCurrentFloor) {
      const nextFloorNum = floorNum + 1;
      const nextLayout =
        nextFloorNum === save.floor
          ? currentLayout
          : generateMap(nextFloorNum, route).rooms;

      const nextFloorEvent: GameEvent = {
        type: "NEXT_FLOOR",
        newFloor: nextFloorNum,
        route,
        boardLayout: nextLayout,
      };
      events.push(nextFloorEvent);
      state = applyEvent(state, nextFloorEvent);
    }
  }

  const verification = verifyReconstruction(events, {
    hp: save.hp,
    coins: save.coins,
    keys: save.keys,
    potions: save.potions,
    floor: save.floor,
    status: save.status,
    stats: savedStats,
    board: save.board,
    battleState: save.battleState,
    battleRoomIdx: save.battleRoomIdx,
    currentRoute: save.currentRoute ?? null,
    currentMonster: save.currentMonster ?? undefined,
  });

  if (!verification.valid) {
    console.warn(
      `[LegacySave] Reconstruction warning: ${verification.mismatches.length} mismatches`,
      verification.mismatches
    );
  }

  return events;
}

export function useNormalProgress({ showSettlement }: UseNormalProgressOptions) {
  const eventStoreRef = useRef<EventStore>(new EventStore());
  const [reconstructionError, setReconstructionError] = useState<string | null>(null);

  const initialFloor = loadedSave?.floor ?? 1;
  const [board, setBoard] = useState<Room[]>(() =>
    loadedSave ? loadedSave.board : generateBoard(initialFloor)
  );
  const [hp, setHp] = useState(loadedSave?.hp ?? GAME_CONSTANTS.maxHp);
  const [coins, setCoins] = useState(loadedSave?.coins ?? 0);
  const [keys, setKeys] = useState(loadedSave?.keys ?? 0);
  const [potions, setPotions] = useState(loadedSave?.potions ?? 0);
  const [floor, setFloor] = useState(initialFloor);
  const [status, setStatus] = useState<"playing" | "won" | "lost">(loadedSave?.status ?? "playing");
  const [turn, setTurn] = useState(loadedSave?.turn ?? 0);
  const [stats, setStats] = useState<GameStats>(() => normalizeStats(loadedSave?.stats));
  const [battleState, setBattleState] = useState<BattleState>(loadedSave?.battleState ?? "idle");
  const [currentMonster, setCurrentMonster] = useState<Monster | null>(loadedSave?.currentMonster ?? null);
  const [battleLog, setBattleLog] = useState<BattleLog[]>(loadedSave?.battleLog ?? []);
  const [battleRoomIdx, setBattleRoomIdx] = useState(loadedSave?.battleRoomIdx ?? -1);
  const [history, setHistory] = useState<TurnRecord[]>(() => {
    if (loadedSave?.history) {
      restoreCounters(loadedSave.history, loadedSave.battleLog);
      return loadedSave.history;
    }
    return [
      createTurnRecord({
        turn: 0,
        floor: initialFloor,
        event: `🏠 游戏开始！进入B${initialFloor}F，翻开相邻房间探索地牢`,
        hpDelta: 0,
        coinDelta: 0,
        items: [],
      }),
    ];
  });
  const [showRouteHint, setShowRouteHint] = useState(loadedSave?.showRouteHint ?? false);
  const [showRiskHint, setShowRiskHint] = useState(loadedSave?.showRiskHint ?? false);
  const [playerCharging, setPlayerCharging] = useState(loadedSave?.playerCharging ?? false);
  const [currentRoute, setCurrentRoute] = useState<RouteType>(loadedSave?.currentRoute ?? null);
  const [showRouteSelect, setShowRouteSelect] = useState(false);
  const [showSlotPanel, setShowSlotPanel] = useState<"save" | "load" | null>(null);
  const [slotList, setSlotList] = useState<SlotMeta[]>(() => getSlotList());

  const saveRestoredRef = useRef(!!loadedSave);

  const syncStateFromEventStore = useCallback(() => {
    const reconstructed = eventStoreRef.current.rebuild();
    setBoard(reconstructed.board);
    setHp(reconstructed.hp);
    setCoins(reconstructed.coins);
    setKeys(reconstructed.keys);
    setPotions(reconstructed.potions);
    setFloor(reconstructed.floor);
    setStatus(reconstructed.status);
    setTurn(reconstructed.turn);
    setStats(reconstructed.stats);
    setBattleState(reconstructed.battleState);
    setCurrentMonster(reconstructed.currentMonster);
    setBattleRoomIdx(reconstructed.battleRoomIdx);
    setPlayerCharging(reconstructed.playerCharging);
    setCurrentRoute(reconstructed.currentRoute);
    setShowRouteHint(reconstructed.showRouteHint);
    setShowRiskHint(reconstructed.showRiskHint);
  }, []);

  const verifyStateConsistency = useCallback(() => {
    const currentState: Partial<GameState> = {
      board,
      hp,
      coins,
      keys,
      potions,
      floor,
      status,
      turn,
      stats,
      battleState,
      battleRoomIdx,
      playerCharging,
      currentRoute,
      showRouteHint,
      showRiskHint,
    };
    const verification = verifyReconstruction(eventStoreRef.current.getEvents(), currentState);
    if (!verification.valid) {
      console.warn("State reconstruction mismatch:", verification.mismatches);
      setReconstructionError(verification.mismatches.join("; "));
    } else {
      setReconstructionError(null);
    }
    return verification;
  }, [board, hp, coins, keys, potions, floor, status, turn, stats, battleState, battleRoomIdx, playerCharging, currentRoute, showRouteHint, showRiskHint]);

  const getReconstructedState = useCallback((): GameState => {
    return eventStoreRef.current.rebuild();
  }, []);

  useEffect(() => {
    const store = eventStoreRef.current;
    if (loadedSave?.eventHistory && loadedSave.eventHistory.length > 0) {
      store.loadFromSave(loadedSave.eventHistory);
    } else if (loadedSave) {
      const syntheticEvents = generateEventHistoryFromLegacySave(loadedSave);
      store.loadFromSave(syntheticEvents);
    } else {
      const layout = generateMap(initialFloor, null).rooms;
      store.push({
        type: "GAME_INIT",
        floor: initialFloor,
        route: null,
        boardLayout: layout,
      });
    }
  }, []);

  useEffect(() => {
    if (saveRestoredRef.current) {
      const restoredFloor = loadedSave!.floor;
      const inBattle = loadedSave!.battleState === "fighting";
      let restoreEvent: string;
      if (battleStateWasInconsistentOnLoad) {
        restoreEvent = "💾 已恢复存档（战斗存档不一致，已重置为非战斗状态，该房间需重新挑战），继续探索！";
      } else if (inBattle) {
        restoreEvent = "💾 已恢复战斗存档，当前仍处于战斗中，加油击败怪物！";
      } else if (wasBattleRepaired) {
        restoreEvent = "💾 已恢复存档（战斗状态异常已重置，可重新挑战该房间），继续探索！";
      } else {
        restoreEvent = "💾 已恢复上次存档，继续探索！";
      }
      setHistory((prev) => [
        createTurnRecord({
          turn: 0,
          floor: restoredFloor,
          event: restoreEvent,
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        }),
        ...prev,
      ]);
      eventStoreRef.current.push({ type: "SAVE_RESTORE", source: "auto" });
      saveRestoredRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (showSettlement) return;
    saveGame({
      board,
      hp,
      coins,
      keys,
      potions,
      floor,
      status,
      turn,
      stats,
      battleState,
      currentMonster,
      battleLog,
      battleRoomIdx,
      history,
      showRouteHint,
      showRiskHint,
      playerCharging,
      currentRoute,
      eventHistory: eventStoreRef.current.getEvents(),
    });
  }, [board, hp, coins, keys, potions, floor, status, turn, stats, battleState, currentMonster, battleLog, battleRoomIdx, history, showSettlement, showRouteHint, showRiskHint, playerCharging, currentRoute]);

  const dispatchEvent = useCallback((event: GameEvent) => {
    eventStoreRef.current.push(event);
  }, []);

  const resetProgress = useCallback(() => {
    clearSave();
    const newFloor = 1;
    const newBoard = generateBoard(newFloor, null);
    const layout = getBoardLayout(newBoard);
    setBoard(newBoard);
    setHp(GAME_CONSTANTS.maxHp);
    setCoins(0);
    setKeys(0);
    setPotions(0);
    setFloor(newFloor);
    setStatus("playing");
    setTurn(0);
    setStats(INITIAL_STATS);
    setBattleState("idle");
    setCurrentMonster(null);
    setBattleLog([]);
    setBattleRoomIdx(-1);
    setPlayerCharging(false);
    setCurrentRoute(null);
    setShowRouteHint(false);
    setShowRiskHint(false);
    setShowRouteSelect(false);
    setHistory([
      createTurnRecord({
        turn: 0,
        floor: newFloor,
        event: "🏠 重新开始探索！一切已重置，进入B1F",
        hpDelta: 0,
        coinDelta: 0,
        items: [],
      }),
    ]);
    eventStoreRef.current.push({ type: "GAME_RESET", boardLayout: layout });
  }, []);

  const nextFloor = useCallback(() => {
    setShowRouteSelect(true);
  }, []);

  const confirmRouteAndNextFloor = useCallback((route: RouteType) => {
    const newFloor = floor + 1;
    const nextCfg = getFloorConfig(newFloor, route);
    const routeCfg = route ? ROUTE_CONFIGS[route] : null;
    const newBoard = generateBoard(newFloor, route);
    const layout = getBoardLayout(newBoard);
    setBoard(newBoard);
    setFloor(newFloor);
    setKeys(0);
    setStatus("playing");
    setTurn(0);
    setBattleState("idle");
    setCurrentMonster(null);
    setBattleLog([]);
    setBattleRoomIdx(-1);
    setPlayerCharging(false);
    setCurrentRoute(route);
    setShowRouteSelect(false);

    let routeMessage = "";
    if (routeCfg) {
      const effects: string[] = [];
      if (routeCfg.potionModifier !== 0) {
        effects.push(`药水${routeCfg.potionModifier > 0 ? "+" : ""}${routeCfg.potionModifier}`);
      }
      if (routeCfg.coinMultiplier !== 1) {
        effects.push(`金币×${routeCfg.coinMultiplier}`);
      }
      if (routeCfg.monsterStrengthMultiplier !== 1) {
        effects.push(`怪物强度×${routeCfg.monsterStrengthMultiplier}`);
      }
      if (routeCfg.pathDamageModifier !== 0) {
        effects.push(`路径上限${routeCfg.pathDamageModifier > 0 ? "+" : ""}${routeCfg.pathDamageModifier}`);
      }
      routeMessage = `选择了「${routeCfg.icon} ${routeCfg.name}」路线（${effects.join("，")}）。`;
    }

    setHistory((prev) => [
      createTurnRecord({
        turn: 0,
        floor: newFloor,
        event: `⬆️ ${routeMessage}进入B${newFloor}F！陷阱+${nextCfg.trapCt}、怪物+${nextCfg.monsterCt}、金币奖励范围${nextCfg.coinMin}~${nextCfg.coinMax}，请谨慎探索`,
        hpDelta: 0,
        coinDelta: 0,
        items: routeCfg ? [`${routeCfg.icon} ${routeCfg.name}路线`] : [],
      }),
      ...prev,
    ]);
    eventStoreRef.current.push({ type: "NEXT_FLOOR", newFloor, route, boardLayout: layout });
  }, [floor]);

  const saveToSlot = useCallback((slot: number) => {
    saveGameToSlot(slot, {
      board,
      hp,
      coins,
      keys,
      potions,
      floor,
      status,
      turn,
      stats,
      battleState,
      currentMonster,
      battleLog,
      battleRoomIdx,
      history,
      showRouteHint,
      showRiskHint,
      playerCharging,
      currentRoute,
      eventHistory: eventStoreRef.current.getEvents(),
    });
    setSlotList(getSlotList());
    setShowSlotPanel(null);
    setHistory((prev) => [
      createTurnRecord({
        turn,
        floor,
        event: `💾 已保存到槽位 ${slot}`,
        hpDelta: 0,
        coinDelta: 0,
        items: [],
      }),
      ...prev,
    ]);
  }, [board, hp, coins, keys, potions, floor, status, turn, stats, battleState, currentMonster, battleLog, battleRoomIdx, history, showRouteHint, showRiskHint, playerCharging, currentRoute]);

  const loadFromSlot = useCallback((slot: number) => {
    const result = loadGameFromSlot(slot);
    if (!result) {
      setHistory((prev) => [
        createTurnRecord({
          turn,
          floor,
          event: `❌ 槽位 ${slot} 存档无效或已损坏，无法读取`,
          hpDelta: 0,
          coinDelta: 0,
          items: [],
        }),
        ...prev,
      ]);
      setSlotList(getSlotList());
      return;
    }
    const s = result.save;
    restoreCounters(s.history, s.battleLog);
    setBoard(s.board);
    setHp(s.hp);
    setCoins(s.coins);
    setKeys(s.keys);
    setPotions(s.potions);
    setFloor(s.floor);
    setStatus(s.status);
    setTurn(s.turn);
    setStats(normalizeStats(s.stats));
    setBattleState(s.battleState);
    setCurrentMonster(s.currentMonster);
    setBattleLog(s.battleLog);
    setBattleRoomIdx(s.battleRoomIdx);
    setPlayerCharging(s.playerCharging ?? false);
    setCurrentRoute(s.currentRoute ?? null);
    setShowRouteHint(s.showRouteHint ?? false);
    setShowRiskHint(s.showRiskHint ?? false);
    setHistory([
      createTurnRecord({
        turn: 0,
        floor: s.floor,
        event: result.battleStateWasInconsistent
          ? `💾 已从槽位 ${slot} 恢复（战斗存档不一致，已重置为非战斗状态，该房间需重新挑战），继续探索！`
          : result.battleWasLoaded && s.battleState === "fighting"
            ? `💾 已从槽位 ${slot} 恢复战斗存档，当前仍处于战斗中，加油击败怪物！`
            : result.battleRepaired
              ? `💾 已从槽位 ${slot} 恢复（战斗状态异常已重置），继续探索！`
              : `💾 已从槽位 ${slot} 恢复存档，继续探索！`,
        hpDelta: 0,
        coinDelta: 0,
        items: [],
      }),
      ...s.history,
    ]);
    if ((s as any).eventHistory && Array.isArray((s as any).eventHistory) && (s as any).eventHistory.length > 0) {
      eventStoreRef.current.loadFromSave((s as any).eventHistory);
    } else {
      const syntheticEvents = generateEventHistoryFromLegacySave(s);
      eventStoreRef.current.loadFromSave(syntheticEvents);
    }
    eventStoreRef.current.push({ type: "SAVE_RESTORE", source: `slot-${slot}` });
    setShowSlotPanel(null);
    setSlotList(getSlotList());
  }, [turn, floor]);

  const deleteSaveSlot = useCallback((slot: number) => {
    deleteSlot(slot);
    setSlotList(getSlotList());
  }, []);

  const openSlotPanel = useCallback((mode: "save" | "load") => {
    setSlotList(getSlotList());
    setShowSlotPanel(mode);
  }, []);

  return {
    board,
    setBoard,
    hp,
    setHp,
    coins,
    setCoins,
    keys,
    setKeys,
    potions,
    setPotions,
    floor,
    setFloor,
    status,
    setStatus,
    turn,
    setTurn,
    stats,
    setStats,
    battleState,
    setBattleState,
    currentMonster,
    setCurrentMonster,
    battleLog,
    setBattleLog,
    battleRoomIdx,
    setBattleRoomIdx,
    history,
    setHistory,
    showRouteHint,
    setShowRouteHint,
    showRiskHint,
    setShowRiskHint,
    playerCharging,
    setPlayerCharging,
    currentRoute,
    setCurrentRoute,
    showRouteSelect,
    setShowRouteSelect,
    showSlotPanel,
    setShowSlotPanel,
    slotList,
    setSlotList,
    resetProgress,
    nextFloor,
    confirmRouteAndNextFloor,
    saveToSlot,
    loadFromSlot,
    deleteSaveSlot,
    openSlotPanel,
    eventStore: eventStoreRef,
    dispatchEvent,
    syncStateFromEventStore,
    verifyStateConsistency,
    getReconstructedState,
    reconstructionError,
  };
}
