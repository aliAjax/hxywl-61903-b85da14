import { RoomType, Monster, GAME_CONSTANTS, RouteType } from "./gameConfig";

export const SAVE_KEY = "dungeon-save-v1";
export const CURRENT_SAVE_VERSION = 1;
export const SLOT_KEY_PREFIX = "dungeon-slot-";
export const MAX_SLOTS = 5;

const VALID_ROOM_TYPES: Set<string> = new Set<RoomType>([
  "start", "coin", "trap", "monster", "key", "exit", "potion", "empty",
]);

interface SavedRoom {
  type: RoomType;
  revealed: boolean;
  defeated?: boolean;
}

interface SavedBattleLog {
  id: number;
  message: string;
  type: "player" | "monster" | "system" | "reward";
}

interface SavedTurnRecord {
  id: number;
  turn: number;
  floor: number;
  event: string;
  roomType?: RoomType;
  hpDelta: number;
  coinDelta: number;
  items: string[];
}

interface SavedMonster {
  name: string;
  icon: string;
  maxHp: number;
  hp: number;
  attack: number;
  coinReward: number;
  potionDropChance: number;
}

interface SavedGameStats {
  revealedRooms: number;
  trapHits: number;
  monstersDefeated: number;
  potionsUsed?: number;
  fleeCount?: number;
}

export interface SaveData {
  version: number;
  timestamp: number;
  board: SavedRoom[];
  hp: number;
  coins: number;
  keys: number;
  potions: number;
  floor: number;
  status: "playing" | "won" | "lost";
  turn: number;
  stats: SavedGameStats;
  battleState: "idle" | "fighting" | "won" | "lost" | "fled";
  currentMonster: SavedMonster | null;
  battleLog: SavedBattleLog[];
  battleRoomIdx: number;
  history: SavedTurnRecord[];
  showRouteHint?: boolean;
  playerCharging?: boolean;
  currentRoute?: RouteType;
}

export interface LoadResult {
  save: SaveData;
  battleRepaired: boolean;
  battleWasLoaded: boolean;
  battleStateWasInconsistent: boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNumber(v: unknown): v is number {
  return typeof v === "number" && isFinite(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function validateRoom(room: unknown): room is SavedRoom {
  if (!isObject(room)) return false;
  if (!isString(room.type) || !VALID_ROOM_TYPES.has(room.type)) return false;
  if (typeof room.revealed !== "boolean") return false;
  if (room.defeated !== undefined && typeof room.defeated !== "boolean") return false;
  return true;
}

function validateMonster(m: unknown): m is SavedMonster {
  if (!isObject(m)) return false;
  return (
    isString(m.name) &&
    isString(m.icon) &&
    isNumber(m.maxHp) && m.maxHp > 0 &&
    isNumber(m.hp) && m.hp >= 0 &&
    isNumber(m.attack) && m.attack >= 0 &&
    isNumber(m.coinReward) && m.coinReward >= 0 &&
    isNumber(m.potionDropChance) && m.potionDropChance >= 0 && m.potionDropChance <= 1
  );
}

function validateBattleLog(log: unknown): log is SavedBattleLog {
  if (!isObject(log)) return false;
  if (!isNumber(log.id)) return false;
  if (!isString(log.message)) return false;
  if (!isString(log.type) || !["player", "monster", "system", "reward"].includes(log.type)) return false;
  return true;
}

function validateTurnRecord(rec: unknown): rec is SavedTurnRecord {
  if (!isObject(rec)) return false;
  if (!isNumber(rec.id)) return false;
  if (!isNumber(rec.turn) || rec.turn < 0) return false;
  if (!isNumber(rec.floor) || rec.floor < 1) return false;
  if (!isString(rec.event)) return false;
  if (rec.roomType !== undefined && (!isString(rec.roomType) || !VALID_ROOM_TYPES.has(rec.roomType))) return false;
  if (!isNumber(rec.hpDelta)) return false;
  if (!isNumber(rec.coinDelta)) return false;
  if (!Array.isArray(rec.items) || !(rec.items as unknown[]).every(isString)) return false;
  return true;
}

function validateGameStats(stats: unknown): stats is SavedGameStats {
  if (!isObject(stats)) return false;
  if (!isNumber(stats.revealedRooms) || (stats.revealedRooms as number) < 0) return false;
  if (!isNumber(stats.trapHits) || (stats.trapHits as number) < 0) return false;
  if (!isNumber(stats.monstersDefeated) || (stats.monstersDefeated as number) < 0) return false;
  if (stats.potionsUsed !== undefined && (!isNumber(stats.potionsUsed) || (stats.potionsUsed as number) < 0)) return false;
  if (stats.fleeCount !== undefined && (!isNumber(stats.fleeCount) || (stats.fleeCount as number) < 0)) return false;
  return true;
}

export function validateSaveData(data: unknown): { valid: boolean; save: SaveData | null; reason: string } {
  if (!isObject(data)) {
    return { valid: false, save: null, reason: "存档数据格式错误" };
  }

  if (!isNumber(data.version) || (data.version as number) < 1) {
    return { valid: false, save: null, reason: "存档版本不可识别" };
  }

  if ((data.version as number) > CURRENT_SAVE_VERSION) {
    return { valid: false, save: null, reason: "存档版本过新，请更新游戏" };
  }

  if (!isNumber(data.hp) || (data.hp as number) < 0 || (data.hp as number) > GAME_CONSTANTS.maxHp) {
    return { valid: false, save: null, reason: "血量数据异常" };
  }

  if (!isNumber(data.coins) || (data.coins as number) < 0) {
    return { valid: false, save: null, reason: "金币数据异常" };
  }

  if (!isNumber(data.keys) || (data.keys as number) < 0) {
    return { valid: false, save: null, reason: "钥匙数据异常" };
  }

  if (!isNumber(data.potions) || (data.potions as number) < 0) {
    return { valid: false, save: null, reason: "药水数据异常" };
  }

  if (!isNumber(data.floor) || (data.floor as number) < 1) {
    return { valid: false, save: null, reason: "层数数据异常" };
  }

  const validStatuses = ["playing", "won", "lost"];
  if (!isString(data.status) || !validStatuses.includes(data.status as string)) {
    return { valid: false, save: null, reason: "游戏状态异常" };
  }

  if (!isNumber(data.turn) || (data.turn as number) < 0) {
    return { valid: false, save: null, reason: "回合数据异常" };
  }

  if (!validateGameStats(data.stats)) {
    return { valid: false, save: null, reason: "统计数据异常" };
  }

  const validBattleStates = ["idle", "fighting", "won", "lost", "fled"];
  if (!isString(data.battleState) || !validBattleStates.includes(data.battleState as string)) {
    return { valid: false, save: null, reason: "战斗状态异常" };
  }

  if (data.playerCharging !== undefined && typeof data.playerCharging !== "boolean") {
    return { valid: false, save: null, reason: "蓄力状态数据异常" };
  }

  const validRoutes = ["safe", "greedy", "dangerous", null, undefined];
  if (data.currentRoute !== undefined && !validRoutes.includes(data.currentRoute as RouteType)) {
    return { valid: false, save: null, reason: "路线数据异常" };
  }

  const expectedCells = GAME_CONSTANTS.boardSize * GAME_CONSTANTS.boardSize;
  if (!Array.isArray(data.board) || (data.board as unknown[]).length !== expectedCells) {
    return { valid: false, save: null, reason: "地图数据异常" };
  }

  for (let i = 0; i < (data.board as unknown[]).length; i++) {
    if (!validateRoom((data.board as unknown[])[i])) {
      return { valid: false, save: null, reason: `地图房间${i}数据异常` };
    }
  }

  if ((data.battleState as string) !== "idle") {
    if (data.currentMonster !== null && data.currentMonster !== undefined) {
      if (!validateMonster(data.currentMonster)) {
        return { valid: false, save: null, reason: "怪物数据异常" };
      }
    }
    if (!isNumber(data.battleRoomIdx) || (data.battleRoomIdx as number) < -1 || (data.battleRoomIdx as number) >= expectedCells) {
      return { valid: false, save: null, reason: "战斗房间索引异常" };
    }
  }

  if (!Array.isArray(data.battleLog)) {
    return { valid: false, save: null, reason: "战斗日志数据异常" };
  }
  for (let i = 0; i < (data.battleLog as unknown[]).length; i++) {
    if (!validateBattleLog((data.battleLog as unknown[])[i])) {
      return { valid: false, save: null, reason: `战斗日志${i}数据异常` };
    }
  }

  if (!Array.isArray(data.history)) {
    return { valid: false, save: null, reason: "回合记录数据异常" };
  }
  for (let i = 0; i < (data.history as unknown[]).length; i++) {
    if (!validateTurnRecord((data.history as unknown[])[i])) {
      return { valid: false, save: null, reason: `回合记录${i}数据异常` };
    }
  }

  return { valid: true, save: data as unknown as SaveData, reason: "" };
}

function resetBattleState(save: SaveData): void {
  save.battleState = "idle";
  save.currentMonster = null;
  save.battleLog = [];
  save.battleRoomIdx = -1;
  save.playerCharging = false;
}

function resetBattleRoom(save: SaveData): void {
  const idx = save.battleRoomIdx;
  if (idx >= 0 && idx < save.board.length) {
    save.board[idx] = { ...save.board[idx], revealed: false, defeated: false };
  }
}

export function sanitizeSave(save: SaveData): { save: SaveData; battleRepaired: boolean; battleWasLoaded: boolean; battleStateWasInconsistent: boolean } {
  const repaired = { ...save, board: save.board.map((r) => ({ ...r })) };
  let battleRepaired = false;
  const battleWasLoaded = repaired.battleState !== "idle";
  let battleStateWasInconsistent = false;

  if (repaired.battleState === "idle") {
    if (repaired.currentMonster !== null || repaired.battleRoomIdx !== -1) {
      resetBattleState(repaired);
      battleRepaired = true;
    }
    return { save: repaired, battleRepaired, battleWasLoaded, battleStateWasInconsistent };
  }

  if (repaired.status === "lost") {
    battleStateWasInconsistent = true;
    resetBattleState(repaired);
    return { save: repaired, battleRepaired: false, battleWasLoaded, battleStateWasInconsistent };
  }

  if (repaired.hp <= 0) {
    battleStateWasInconsistent = true;
    repaired.status = "lost";
    resetBattleState(repaired);
    return { save: repaired, battleRepaired: true, battleWasLoaded, battleStateWasInconsistent };
  }

  if (repaired.status === "won" && repaired.battleState === "fighting") {
    battleStateWasInconsistent = true;
    resetBattleRoom(repaired);
    resetBattleState(repaired);
    battleRepaired = true;
    return { save: repaired, battleRepaired, battleWasLoaded, battleStateWasInconsistent };
  }

  if (repaired.battleState === "won" || repaired.battleState === "lost" || repaired.battleState === "fled") {
    if (repaired.battleState === "won") {
      if (repaired.battleRoomIdx >= 0 && repaired.battleRoomIdx < repaired.board.length) {
        if (!repaired.board[repaired.battleRoomIdx].defeated) {
          battleStateWasInconsistent = true;
          repaired.board[repaired.battleRoomIdx] = {
            ...repaired.board[repaired.battleRoomIdx],
            defeated: true,
            revealed: true,
          };
          battleRepaired = true;
        }
      }
    }
    if (repaired.battleState === "fled") {
      if (repaired.battleRoomIdx >= 0 && repaired.battleRoomIdx < repaired.board.length) {
        if (repaired.board[repaired.battleRoomIdx].revealed) {
          battleStateWasInconsistent = true;
          repaired.board[repaired.battleRoomIdx] = {
            ...repaired.board[repaired.battleRoomIdx],
            revealed: false,
            defeated: false,
          };
          battleRepaired = true;
        }
      }
    }
    if (repaired.battleState === "lost") {
      battleStateWasInconsistent = true;
      resetBattleState(repaired);
      return { save: repaired, battleRepaired: true, battleWasLoaded, battleStateWasInconsistent };
    }
    battleStateWasInconsistent = true;
    resetBattleState(repaired);
    return { save: repaired, battleRepaired, battleWasLoaded, battleStateWasInconsistent };
  }

  if (repaired.battleState === "fighting") {
    const needsRepair = !isFightingStateConsistent(repaired);
    if (needsRepair) {
      battleStateWasInconsistent = true;
      console.warn("战斗存档状态不一致，将重置战斗并恢复房间为未翻开状态");
      resetBattleRoom(repaired);
      resetBattleState(repaired);
      battleRepaired = true;
    } else {
      clampMonsterHp(repaired);
    }
  }

  return { save: repaired, battleRepaired, battleWasLoaded, battleStateWasInconsistent };
}

function isFightingStateConsistent(save: SaveData): boolean {
  if (save.currentMonster === null) return false;
  if (save.currentMonster.hp <= 0) return false;
  if (save.currentMonster.hp > save.currentMonster.maxHp) return false;
  if (save.battleRoomIdx < 0 || save.battleRoomIdx >= save.board.length) return false;
  const room = save.board[save.battleRoomIdx];
  if (room.type !== "monster") return false;
  if (!room.revealed) return false;
  if (room.defeated) return false;
  if (save.status !== "playing") return false;
  if (save.hp <= 0) return false;
  return true;
}

function clampMonsterHp(save: SaveData): void {
  if (save.currentMonster && save.currentMonster.hp > save.currentMonster.maxHp) {
    save.currentMonster = { ...save.currentMonster, hp: save.currentMonster.maxHp };
  }
}

export function saveGame(state: Omit<SaveData, "version" | "timestamp">): void {
  try {
    const data: SaveData = {
      ...state,
      version: CURRENT_SAVE_VERSION,
      timestamp: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* ignore write failures */
  }
}

export function loadGame(): LoadResult | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const { valid, save, reason } = validateSaveData(parsed);
    if (!valid) {
      console.warn(`存档验证失败: ${reason}，将清除旧存档并开始新局`);
      clearSave();
      return null;
    }
    const { save: sanitized, battleRepaired, battleWasLoaded, battleStateWasInconsistent } = sanitizeSave(save!);
    if (sanitized.status === "lost") {
      clearSave();
      return null;
    }
    if (battleRepaired) {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          ...sanitized,
          version: CURRENT_SAVE_VERSION,
          timestamp: Date.now(),
        }));
      } catch {
        /* ignore */
      }
    }
    return { save: sanitized, battleRepaired, battleWasLoaded, battleStateWasInconsistent };
  } catch {
    console.warn("存档读取失败，将清除旧存档并开始新局");
    clearSave();
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

export interface SlotMeta {
  index: number;
  empty: boolean;
  floor: number;
  coins: number;
  hp: number;
  maxHp: number;
  timestamp: number;
  battleState: "idle" | "fighting" | "won" | "lost" | "fled";
  currentRoute: RouteType;
  valid: boolean;
  reason: string;
}

export function saveGameToSlot(slot: number, state: Omit<SaveData, "version" | "timestamp">): void {
  try {
    const data: SaveData = {
      ...state,
      version: CURRENT_SAVE_VERSION,
      timestamp: Date.now(),
    };
    localStorage.setItem(`${SLOT_KEY_PREFIX}${slot}`, JSON.stringify(data));
  } catch {
    /* ignore write failures */
  }
}

export function loadGameFromSlot(slot: number): LoadResult | null {
  try {
    const raw = localStorage.getItem(`${SLOT_KEY_PREFIX}${slot}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const { valid, save, reason } = validateSaveData(parsed);
    if (!valid) {
      console.warn(`槽位${slot}存档验证失败: ${reason}`);
      return null;
    }
    const { save: sanitized, battleRepaired, battleWasLoaded, battleStateWasInconsistent } = sanitizeSave(save!);
    if (sanitized.status === "lost") {
      deleteSlot(slot);
      return null;
    }
    if (battleRepaired) {
      try {
        localStorage.setItem(`${SLOT_KEY_PREFIX}${slot}`, JSON.stringify({
          ...sanitized,
          version: CURRENT_SAVE_VERSION,
          timestamp: Date.now(),
        }));
      } catch {
        /* ignore */
      }
    }
    return { save: sanitized, battleRepaired, battleWasLoaded, battleStateWasInconsistent };
  } catch {
    console.warn(`槽位${slot}存档读取失败`);
    return null;
  }
}

export function getSlotList(): SlotMeta[] {
  const result: SlotMeta[] = [];
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const meta: SlotMeta = {
      index: i,
      empty: true,
      floor: 1,
      coins: 0,
      hp: 0,
      maxHp: GAME_CONSTANTS.maxHp,
      timestamp: 0,
      battleState: "idle",
      currentRoute: null,
      valid: true,
      reason: "",
    };
    try {
      const raw = localStorage.getItem(`${SLOT_KEY_PREFIX}${i}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        const { valid, save, reason } = validateSaveData(parsed);
        meta.empty = false;
        if (valid && save) {
          meta.floor = save.floor;
          meta.coins = save.coins;
          meta.hp = save.hp;
          meta.maxHp = GAME_CONSTANTS.maxHp;
          meta.timestamp = save.timestamp;
          meta.battleState = save.battleState;
          meta.currentRoute = save.currentRoute ?? null;
          meta.valid = true;
        } else {
          meta.valid = false;
          meta.reason = reason;
        }
      }
    } catch {
      meta.empty = false;
      meta.valid = false;
      meta.reason = "存档数据损坏";
    }
    result.push(meta);
  }
  return result;
}

export function deleteSlot(slot: number): void {
  try {
    localStorage.removeItem(`${SLOT_KEY_PREFIX}${slot}`);
  } catch {
    /* ignore */
  }
}

export type LeaderboardResultType = "clear" | "death" | "restart";

export interface LeaderboardEntry {
  id: number;
  resultType: LeaderboardResultType;
  floor: number;
  coins: number;
  revealedRooms: number;
  trapHits: number;
  monstersDefeated: number;
  stars: number;
  rank: string;
  timestamp: number;
}

const LEADERBOARD_KEY = GAME_CONSTANTS.leaderboardKey;
const MAX_ENTRIES = GAME_CONSTANTS.maxLeaderboardEntries;

function validateLeaderboardEntry(entry: unknown): entry is LeaderboardEntry {
  if (!isObject(entry)) return false;
  if (!isNumber(entry.id) || entry.id < 0) return false;
  if (!isString(entry.resultType) || !["clear", "death", "restart"].includes(entry.resultType as string)) return false;
  if (!isNumber(entry.floor) || entry.floor < 1) return false;
  if (!isNumber(entry.coins) || entry.coins < 0) return false;
  if (!isNumber(entry.revealedRooms) || entry.revealedRooms < 0) return false;
  if (!isNumber(entry.trapHits) || entry.trapHits < 0) return false;
  if (!isNumber(entry.monstersDefeated) || entry.monstersDefeated < 0) return false;
  if (!isNumber(entry.stars) || entry.stars < 1 || entry.stars > 5) return false;
  if (!isString(entry.rank)) return false;
  if (!isNumber(entry.timestamp) || entry.timestamp <= 0) return false;
  return true;
}

export function loadLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: LeaderboardEntry[] = [];
    for (const item of parsed) {
      if (validateLeaderboardEntry(item)) {
        valid.push(item);
      }
    }
    return valid;
  } catch {
    return [];
  }
}

export function saveLeaderboard(entries: LeaderboardEntry[]): void {
  try {
    const trimmed = entries.slice(0, MAX_ENTRIES);
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

export function addLeaderboardEntry(entry: Omit<LeaderboardEntry, "id" | "timestamp">): LeaderboardEntry[] {
  const entries = loadLeaderboard();
  const maxId = entries.reduce((max, e) => Math.max(max, e.id), 0);
  const newEntry: LeaderboardEntry = {
    ...entry,
    id: maxId + 1,
    timestamp: Date.now(),
  };
  const updated = [newEntry, ...entries].slice(0, MAX_ENTRIES);
  saveLeaderboard(updated);
  return updated;
}

export function clearLeaderboard(): void {
  try {
    localStorage.removeItem(LEADERBOARD_KEY);
  } catch {
    /* ignore */
  }
}
