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

export function useNormalProgress({ showSettlement }: UseNormalProgressOptions) {
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
    });
  }, [board, hp, coins, keys, potions, floor, status, turn, stats, battleState, currentMonster, battleLog, battleRoomIdx, history, showSettlement, showRouteHint, showRiskHint, playerCharging, currentRoute]);

  const resetProgress = useCallback(() => {
    clearSave();
    const newFloor = 1;
    setBoard(generateBoard(newFloor, null));
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
  }, []);

  const nextFloor = useCallback(() => {
    setShowRouteSelect(true);
  }, []);

  const confirmRouteAndNextFloor = useCallback((route: RouteType) => {
    const newFloor = floor + 1;
    const nextCfg = getFloorConfig(newFloor, route);
    const routeCfg = route ? ROUTE_CONFIGS[route] : null;
    setBoard(generateBoard(newFloor, route));
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
  };
}
