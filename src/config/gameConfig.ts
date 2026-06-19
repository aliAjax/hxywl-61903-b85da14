export type RoomType = "start" | "coin" | "trap" | "monster" | "key" | "exit" | "potion" | "empty";

export interface GameConstants {
  boardSize: number;
  maxHp: number;
  highScoreKey: string;
}

export interface EventConfig {
  symbol: string;
  damage: number;
  healAmount?: number;
  description?: string;
}

export interface FloorCountRule {
  base: number;
  growth: number;
  minFloor?: number;
  maxFloor?: number;
  cap: number;
  floor: number;
}

export interface FloorCoinRule {
  minBase: number;
  minGrowth: number;
  maxBase: number;
  maxGrowth: number;
  growthInterval: number;
}

export interface FloorPathRule {
  baseDamage: number;
  growth: number;
  growthInterval: number;
}

export interface FloorConfig {
  coinCt: number;
  trapCt: number;
  monsterCt: number;
  potionCt: number;
  keyCt: number;
  exitCt: number;
  coinMin: number;
  coinMax: number;
  pathMaxDamage: number;
}

export interface MonsterTemplate {
  name: string;
  icon: string;
  baseHp: number;
  baseAtk: number;
  coinBase: number;
  potionChance: number;
  unlockFloor: number;
}

export interface MonsterGrowth {
  hpBonusInterval: number;
  atkBonusInterval: number;
  coinBonusInterval: number;
  hpRandomRange: number;
  coinRandomRange: number;
}

export interface Monster {
  name: string;
  icon: string;
  maxHp: number;
  hp: number;
  attack: number;
  coinReward: number;
  potionDropChance: number;
}

export interface BattleConfig {
  playerDamageMin: number;
  playerDamageMax: number;
  potionHeal: number;
  fleeSuccessRate: number;
  fleeSuccessDamage: number;
}

export interface EventMessages {
  trapHit: (dmg: number) => string;
  death: string;
  coinFound: (gain: number, floor: number) => string;
  keyFound: string;
  potionFound: string;
  exitNoKey: string;
  exitWithKey: string;
  emptyRoom: string;
  monsterEncounter: (monster: Monster) => string;
  monsterEncounterShort: (monster: Monster) => string;
  monsterDefeated: (monster: Monster, gotPotion: boolean) => string;
  monsterDefeatedShort: (monster: Monster, gotPotion: boolean) => string;
  monsterKilledPlayer: (monster: Monster | null) => string;
  flee: (damage: number) => string;
  potionUse: (heal: number) => string;
  playerAttack: (damage: number) => string;
  monsterAttack: (monster: Monster, damage: number) => string;
  monsterDefeatedLog: (monster: Monster) => string;
  battleReward: (coins: number, gotPotion: boolean) => string;
  fleeAttemptLog: string;
  fleeSuccessLog: (damage: number) => string;
  fleeFailLog: (damage: number) => string;
  noPotionLog: string;
  hpFullLog: string;
  roomResetLog: string;
  playerDeathLog: string;
}

export const GAME_CONSTANTS: GameConstants = {
  boardSize: 5,
  maxHp: 5,
  highScoreKey: "dungeon-high-score",
};

export const EVENT_CONFIG: Record<RoomType, EventConfig> = {
  start: { symbol: "🏠", damage: 0 },
  coin: { symbol: "💰", damage: 0 },
  trap: { symbol: "⚡", damage: 1 },
  monster: { symbol: "👹", damage: 2 },
  key: { symbol: "🔑", damage: 0 },
  exit: { symbol: "🚪", damage: 0 },
  potion: { symbol: "🧪", damage: 0, healAmount: 2 },
  empty: { symbol: "·", damage: 0 },
};

export const FLOOR_COUNT_RULES: Record<"coin" | "trap" | "monster" | "potion" | "key" | "exit", FloorCountRule> = {
  coin: { base: 5, growth: 0.7, cap: 10, floor: 10 },
  trap: { base: 4, growth: 0.6, cap: 9, floor: 10 },
  monster: { base: 3, growth: 0.5, cap: 7, floor: 10 },
  potion: { base: 2, growth: -1 / 3, cap: 99, minFloor: 1, floor: 10 },
  key: { base: 1, growth: 0, cap: 1, floor: 10 },
  exit: { base: 1, growth: 0, cap: 1, floor: 10 },
};

export const FLOOR_COIN_RULE: FloorCoinRule = {
  minBase: 1,
  minGrowth: 1,
  maxBase: 3,
  maxGrowth: 1,
  growthInterval: 2,
};

export const FLOOR_PATH_RULE: FloorPathRule = {
  baseDamage: 5,
  growth: 2,
  growthInterval: 2,
};

export const MONSTER_TEMPLATES: MonsterTemplate[] = [
  { name: "史莱姆", icon: "🟢", baseHp: 2, baseAtk: 1, coinBase: 1, potionChance: 0.1, unlockFloor: 1 },
  { name: "骷髅兵", icon: "💀", baseHp: 3, baseAtk: 1, coinBase: 2, potionChance: 0.15, unlockFloor: 1 },
  { name: "蝙蝠", icon: "🦇", baseHp: 2, baseAtk: 2, coinBase: 1, potionChance: 0.05, unlockFloor: 1 },
  { name: "哥布林", icon: "👺", baseHp: 3, baseAtk: 2, coinBase: 3, potionChance: 0.2, unlockFloor: 3 },
  { name: "狼人", icon: "🐺", baseHp: 4, baseAtk: 2, coinBase: 3, potionChance: 0.15, unlockFloor: 5 },
  { name: "石像鬼", icon: "🗿", baseHp: 5, baseAtk: 1, coinBase: 4, potionChance: 0.1, unlockFloor: 5 },
  { name: "火焰精灵", icon: "🔥", baseHp: 3, baseAtk: 3, coinBase: 4, potionChance: 0.25, unlockFloor: 7 },
  { name: "暗影刺客", icon: "🥷", baseHp: 4, baseAtk: 3, coinBase: 5, potionChance: 0.2, unlockFloor: 9 },
];

export const MONSTER_GROWTH: MonsterGrowth = {
  hpBonusInterval: 3,
  atkBonusInterval: 4,
  coinBonusInterval: 2,
  hpRandomRange: 2,
  coinRandomRange: 2,
};

export const BATTLE_CONFIG: BattleConfig = {
  playerDamageMin: 1,
  playerDamageMax: 2,
  potionHeal: 2,
  fleeSuccessRate: 0.7,
  fleeSuccessDamage: 1,
};

export const EVENT_MESSAGES: EventMessages = {
  trapHit: (dmg) => `⚡ 踩到陷阱，受到${dmg}点伤害！`,
  death: "💀 血量归零，探索失败...",
  coinFound: (gain, floor) => `💰 发现${gain}枚金币！（B${floor}F奖励加成）`,
  keyFound: "🔑 找到钥匙！",
  potionFound: "🧪 发现一瓶药水！已放入背包",
  exitNoKey: "🚪 发现出口，但没有钥匙，无法打开",
  exitWithKey: "🚪 用钥匙打开出口，通关！",
  emptyRoom: "· 空房间，什么也没有",
  monsterEncounter: (m) => `⚔️ 遭遇了 ${m.icon} ${m.name}！怪物HP: ${m.hp}/${m.maxHp}，攻击力: ${m.attack}`,
  monsterEncounterShort: (m) => `👹 遭遇 ${m.icon} ${m.name}！进入战斗状态`,
  monsterDefeated: (m, gotPotion) =>
    `⚔️ 击败了 ${m.icon} ${m.name}！获得 ${m.coinReward} 金币${gotPotion ? "，掉落 1 瓶药水" : ""}`,
  monsterDefeatedShort: (m, gotPotion) =>
    `🎉 胜利！获得 ${m.coinReward} 金币${gotPotion ? "，掉落 1 瓶药水🧪" : ""}`,
  monsterKilledPlayer: (m) => `💀 被 ${m?.icon ?? ""} ${m?.name ?? "怪物"} 击败了...`,
  flee: (damage) => `🏃 逃跑！受到 ${damage} 点伤害，房间恢复危险状态`,
  potionUse: (heal) => `🧪 使用药水，恢复${heal}点血量`,
  playerAttack: (damage) => `你挥剑攻击，造成 ${damage} 点伤害！`,
  monsterAttack: (m, damage) => `${m.icon} ${m.name} 反击，造成 ${damage} 点伤害！`,
  monsterDefeatedLog: (m) => `${m.icon} ${m.name} 被击败了！`,
  battleReward: (coins, gotPotion) =>
    `🎉 胜利！获得 ${coins} 金币${gotPotion ? "，掉落 1 瓶药水🧪" : ""}`,
  fleeAttemptLog: "🏃 你选择逃跑...",
  fleeSuccessLog: (damage) => `成功逃脱！但慌乱中受到 ${damage} 点伤害`,
  fleeFailLog: (damage) => `逃跑失败！被怪物追击，受到 ${damage} 点伤害！`,
  noPotionLog: "❌ 背包中没有药水了！",
  hpFullLog: "❌ 血量已满，无需使用药水",
  roomResetLog: "房间恢复为危险状态，仍需小心应对",
  playerDeathLog: "💀 失血过多，倒下了...",
};

export function getTotalCells(): number {
  return GAME_CONSTANTS.boardSize * GAME_CONSTANTS.boardSize;
}

export function calcFloorCount(rule: FloorCountRule, floor: number): number {
  const lv = Math.min(floor, rule.floor);
  let result: number;
  if (rule.growth < 0) {
    result = rule.base + Math.floor((lv - 1) * rule.growth);
    result = Math.max(result, rule.minFloor ?? 1);
  } else {
    result = rule.base + Math.floor(lv * rule.growth);
  }
  return Math.min(result, rule.cap);
}

export function getFloorConfig(floor: number): FloorConfig {
  const coinCt = calcFloorCount(FLOOR_COUNT_RULES.coin, floor);
  const trapCt = calcFloorCount(FLOOR_COUNT_RULES.trap, floor);
  const monsterCt = calcFloorCount(FLOOR_COUNT_RULES.monster, floor);
  const potionCt = calcFloorCount(FLOOR_COUNT_RULES.potion, floor);
  const keyCt = calcFloorCount(FLOOR_COUNT_RULES.key, floor);
  const exitCt = calcFloorCount(FLOOR_COUNT_RULES.exit, floor);

  const lv = Math.min(floor, 10);
  const coinMin = FLOOR_COIN_RULE.minBase + Math.floor((lv - 1) / FLOOR_COIN_RULE.growthInterval) * FLOOR_COIN_RULE.minGrowth;
  const coinMax = FLOOR_COIN_RULE.maxBase + Math.floor(lv / FLOOR_COIN_RULE.growthInterval) * FLOOR_COIN_RULE.maxGrowth;
  const pathMaxDamage =
    FLOOR_PATH_RULE.baseDamage + Math.floor((lv - 1) / FLOOR_PATH_RULE.growthInterval) * FLOOR_PATH_RULE.growth;

  return { coinCt, trapCt, monsterCt, potionCt, keyCt, exitCt, coinMin, coinMax, pathMaxDamage };
}

export function generateMonster(floor: number): Monster {
  const lv = Math.min(floor, MONSTER_TEMPLATES[MONSTER_TEMPLATES.length - 1].unlockFloor);
  const available = MONSTER_TEMPLATES.filter((t) => t.unlockFloor <= lv);
  const template = available[Math.floor(Math.random() * available.length)];
  const hpBonus = Math.floor((lv - 1) / MONSTER_GROWTH.hpBonusInterval);
  const atkBonus = Math.floor((lv - 1) / MONSTER_GROWTH.atkBonusInterval);
  const coinBonus = Math.floor((lv - 1) / MONSTER_GROWTH.coinBonusInterval);
  const maxHp = template.baseHp + hpBonus + Math.floor(Math.random() * MONSTER_GROWTH.hpRandomRange);
  return {
    name: template.name,
    icon: template.icon,
    maxHp,
    hp: maxHp,
    attack: template.baseAtk + atkBonus,
    coinReward: template.coinBase + coinBonus + Math.floor(Math.random() * MONSTER_GROWTH.coinRandomRange),
    potionDropChance: template.potionChance,
  };
}

export function getCoinReward(floor: number): number {
  const cfg = getFloorConfig(floor);
  return cfg.coinMin + Math.floor(Math.random() * (cfg.coinMax - cfg.coinMin + 1));
}

export function getDamage(type: RoomType): number {
  return EVENT_CONFIG[type].damage;
}

export function getSymbol(type: RoomType): string {
  return EVENT_CONFIG[type].symbol;
}

export function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function getNeighbors(idx: number, size: number = GAME_CONSTANTS.boardSize): number[] {
  const r = Math.floor(idx / size);
  const c = idx % size;
  const out: number[] = [];
  if (r > 0) out.push(idx - size);
  if (r < size - 1) out.push(idx + size);
  if (c > 0) out.push(idx - 1);
  if (c < size - 1) out.push(idx + 1);
  return out;
}
