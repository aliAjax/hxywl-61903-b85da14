import { useCallback, useEffect, useRef, useState } from "react";
import {
  GAME_CONSTANTS,
  EVENT_MESSAGES,
  RoomType,
  Monster,
  getFloorConfig,
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

function generateEventHistoryFromLegacySave(save: any): GameEvent[] {
  const events: GameEvent[] = [];
  const layout = save.board.map((r: Room) => r.type);
  
  events.push({
    type: "GAME_INIT",
    floor: save.floor,
    route: save.currentRoute ?? null,
    boardLayout: layout,
  });

  let currentBoard = layout.map((t: RoomType) => ({ type: t, revealed: t === "start" }));
  let currentHp = GAME_CONSTANTS.maxHp;
  let currentCoins = 0;
  let currentKeys = 0;
  let currentPotions = 0;
  let currentTurn = 0;
  let currentStats: GameStats = { ...INITIAL_STATS };
  let currentBattleState: BattleState = "idle";
  let currentBattleRoomIdx = -1;

  for (let i = 0; i < save.board.length; i++) {
    const savedRoom = save.board[i];
    if (savedRoom.revealed && savedRoom.type !== "start") {
      const room = savedRoom;
      const dmg = room.type === "trap" ? 1 : 0;
      const hpDelta = dmg > 0 ? -dmg : 0;
      
      if (room.type === "monster" && savedRoom.defeated) {
        currentBoard[i] = { ...currentBoard[i], revealed: true };
        currentStats = { ...currentStats, revealedRooms: currentStats.revealedRooms + 1, monstersDefeated: currentStats.monstersDefeated + 1 };
        currentTurn++;
        events.push({
          type: "ROOM_FLIP",
          idx: i,
          roomType: room.type,
          hpDelta: 0,
          coinDelta: 0,
          keyDelta: 0,
          potionDelta: 0,
          trapHit: false,
          statusAfter: "playing",
        });
      } else if (room.type === "monster" && save.battleState === "fighting" && save.battleRoomIdx === i) {
        currentBoard[i] = { ...currentBoard[i], revealed: true };
        currentStats = { ...currentStats, revealedRooms: currentStats.revealedRooms + 1 };
        currentTurn++;
        currentBattleState = "fighting";
        currentBattleRoomIdx = i;
        events.push({
          type: "ROOM_FLIP",
          idx: i,
          roomType: room.type,
          hpDelta: 0,
          coinDelta: 0,
          keyDelta: 0,
          potionDelta: 0,
          trapHit: false,
          monster: save.currentMonster || undefined,
          statusAfter: "playing",
        });
      } else {
        currentBoard[i] = { ...currentBoard[i], revealed: true };
        currentStats = { ...currentStats, revealedRooms: currentStats.revealedRooms + 1 };
        
        if (room.type === "trap" && dmg > 0) {
          currentStats.trapHits++;
          currentHp = Math.max(0, currentHp - dmg);
        }
        if (room.type === "coin") {
          currentCoins = save.coins;
        }
        if (room.type === "key") {
          currentKeys = save.keys;
        }
        if (room.type === "potion") {
          currentPotions = save.potions;
        }
        if (room.type === "trap") {
          currentHp = save.hp;
        }
        
        currentTurn++;
        
        let statusAfter: "playing" | "won" | "lost" = "playing";
        if (save.status === "won" && (room.type === "exit" || room.type === "key")) {
          statusAfter = "won";
        }
        if (save.status === "lost" && currentHp <= 0) {
          statusAfter = "lost";
        }
        
        events.push({
          type: "ROOM_FLIP",
          idx: i,
          roomType: room.type,
          hpDelta: hpDelta,
          coinDelta: room.type === "coin" ? save.coins - currentCoins + (hpDelta > 0 ? 0 : 0) : 0,
          keyDelta: room.type === "key" ? 1 : 0,
          potionDelta: room.type === "potion" ? 1 : 0,
          trapHit: room.type === "trap" && dmg > 0,
          statusAfter,
        });
      }
    }
  }

  if (save.floor > 1) {
    for (let f = 2; f <= save.floor; f++) {
      const nextLayout = f === save.floor ? layout : generateMap(f, save.currentRoute ?? null).rooms;
      events.push({
        type: "NEXT_FLOOR",
        newFloor: f,
        route: save.currentRoute ?? null,
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
