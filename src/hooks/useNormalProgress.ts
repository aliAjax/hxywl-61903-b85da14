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

function reconstructFloorEvents(
  floor: number,
  layout: RoomType[],
  savedBoard: Room[],
  route: RouteType,
  startHp: number,
  startCoins: number,
  startPotions: number,
  startStats: GameStats,
  savedState: {
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
): {
  events: GameEvent[];
  endHp: number;
  endCoins: number;
  endKeys: number;
  endPotions: number;
  endStats: GameStats;
} {
  const events: GameEvent[] = [];

  const revealedSet = new Set<number>();
  const defeatedSet = new Set<number>();
  for (let i = 0; i < savedBoard.length; i++) {
    if (savedBoard[i].revealed) revealedSet.add(i);
    if (savedBoard[i].defeated) defeatedSet.add(i);
  }

  const revealOrder = getRevealOrder(layout, revealedSet);

  let hp = startHp;
  let coins = startCoins;
  let keys = 0;
  let potions = startPotions;
  let stats: GameStats = { ...startStats };

  for (const idx of revealOrder) {
    const roomType = layout[idx];
    const isDefeated = defeatedSet.has(idx);
    const isCurrentBattle =
      savedState.battleState === "fighting" && savedState.battleRoomIdx === idx;

    if (roomType === "monster" && (isDefeated || isCurrentBattle)) {
      const monster =
        isCurrentBattle && savedState.currentMonster
          ? { ...savedState.currentMonster }
          : generateMonster(floor, route);

      events.push({
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
      });

      stats = { ...stats, revealedRooms: stats.revealedRooms + 1 };

      if (isDefeated) {
        const monsterHpAfter = 0;
        events.push({
          type: "BATTLE_ATTACK",
          damage: monster.maxHp,
          charged: false,
          monsterHpAfter,
          monsterDamage: 0,
          playerHpAfter: hp,
          monsterDefeated: true,
        });

        const coinReward = monster.coinReward;
        const gotPotion = false;

        events.push({
          type: "BATTLE_WON",
          coinReward,
          gotPotion,
          roomIdx: idx,
        });

        coins += coinReward;
        stats = { ...stats, monstersDefeated: stats.monstersDefeated + 1 };

        events.push({
          type: "BATTLE_CLOSE",
        });
      }
    } else {
      let hpDelta = 0;
      let coinDelta = 0;
      let keyDelta = 0;
      let potionDelta = 0;
      let trapHit = false;

      if (roomType === "trap") {
        hpDelta = -1;
        trapHit = true;
        stats = { ...stats, trapHits: stats.trapHits + 1 };
      } else if (roomType === "coin") {
        coinDelta = getCoinReward(floor, route);
      } else if (roomType === "key") {
        keyDelta = 1;
      } else if (roomType === "potion") {
        potionDelta = 1;
      }

      hp = Math.max(0, hp + hpDelta);
      coins += coinDelta;
      keys += keyDelta;
      potions += potionDelta;
      stats = { ...stats, revealedRooms: stats.revealedRooms + 1 };

      let statusAfter: "playing" | "won" | "lost" = "playing";
      if (roomType === "exit" && keys > 0) {
        statusAfter = "won";
      }
      if (hp <= 0) {
        statusAfter = "lost";
      }

      events.push({
        type: "ROOM_FLIP",
        idx,
        roomType,
        hpDelta,
        coinDelta,
        keyDelta,
        potionDelta,
        trapHit,
        statusAfter,
      });

      if (statusAfter === "lost") {
        break;
      }
    }
  }

  const potionsGained = potions - startPotions;
  const potionsUsed = Math.max(0, potionsGained + startPotions - savedState.potions - potionsGained > 0 ? 0 : 0);

  if (savedState.stats.potionsUsed > stats.potionsUsed) {
    const extraUsed = savedState.stats.potionsUsed - stats.potionsUsed;
    for (let i = 0; i < extraUsed; i++) {
      if (potions > 0 && hp < GAME_CONSTANTS.maxHp) {
        const healAmount = BATTLE_CONFIG.potionHeal;
        hp = Math.min(GAME_CONSTANTS.maxHp, hp + healAmount);
        potions--;
        stats = { ...stats, potionsUsed: stats.potionsUsed + 1 };
        events.push({
          type: "HEAL",
          healAmount,
          playerHpAfter: hp,
          potionsAfter: potions,
        });
      }
    }
  }

  const finalHp = savedState.hp;
  const finalCoins = savedState.coins;
  const finalKeys = savedState.keys;
  const finalPotions = savedState.potions;
  const finalStats: GameStats = {
    revealedRooms: savedState.stats.revealedRooms,
    trapHits: savedState.stats.trapHits,
    monstersDefeated: savedState.stats.monstersDefeated,
    potionsUsed: savedState.stats.potionsUsed,
    fleeCount: savedState.stats.fleeCount,
  };

  return {
    events,
    endHp: finalHp,
    endCoins: finalCoins,
    endKeys: finalKeys,
    endPotions: finalPotions,
    endStats: finalStats,
  };
}

function generateEventHistoryFromLegacySave(save: any): GameEvent[] {
  const events: GameEvent[] = [];
  const currentLayout = save.board.map((r: Room) => r.type);
  const route = save.currentRoute ?? null;

  const startLayout = save.floor === 1 ? currentLayout : generateMap(1, null).rooms;

  events.push({
    type: "GAME_INIT",
    floor: 1,
    route: null,
    boardLayout: startLayout,
  });

  let hp = GAME_CONSTANTS.maxHp;
  let coins = 0;
  let potions = 0;
  let stats: GameStats = { ...INITIAL_STATS };

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
      hp: isCurrentFloor ? save.hp : hp,
      coins: isCurrentFloor ? save.coins : coins,
      keys: isCurrentFloor ? save.keys : 1,
      potions: isCurrentFloor ? save.potions : potions,
      stats: isCurrentFloor ? savedStats : stats,
      status: isCurrentFloor ? save.status : "won",
      battleState: isCurrentFloor ? save.battleState : "idle",
      battleRoomIdx: isCurrentFloor ? save.battleRoomIdx : -1,
      currentMonster: isCurrentFloor ? save.currentMonster : null,
    };

    const result = reconstructFloorEvents(
      floorNum,
      floorLayout,
      floorBoard,
      floorRoute,
      hp,
      coins,
      potions,
      stats,
      floorSavedState
    );

    events.push(...result.events);

    hp = result.endHp;
    coins = result.endCoins;
    potions = result.endPotions;
    stats = { ...result.endStats };

    if (!isCurrentFloor) {
      const nextFloorNum = floorNum + 1;
      const nextLayout =
        nextFloorNum === save.floor
          ? currentLayout
          : generateMap(nextFloorNum, route).rooms;

      events.push({
        type: "NEXT_FLOOR",
        newFloor: nextFloorNum,
        route,
        boardLayout: nextLayout,
      });
    }
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
