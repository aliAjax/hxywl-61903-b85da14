import { GAME_CONSTANTS } from "../config/gameConfig";
import { GameStats } from "../hooks/useNormalProgress";

export type GameResultType = "clear" | "death" | "restart";

export type LeaderboardSortKey = "time" | "floor" | "coins";

export interface HighScore {
  maxFloor: number;
  maxCoins: number;
}

export interface HighlightItem {
  icon: string;
  text: string;
  priority: number;
}

export function loadHighScore(): HighScore {
  try {
    const raw = localStorage.getItem(GAME_CONSTANTS.highScoreKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        maxFloor: typeof parsed.maxFloor === "number" ? parsed.maxFloor : 1,
        maxCoins: typeof parsed.maxCoins === "number" ? parsed.maxCoins : 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { maxFloor: 1, maxCoins: 0 };
}

export function saveHighScore(score: HighScore): void {
  try {
    localStorage.setItem(GAME_CONSTANTS.highScoreKey, JSON.stringify(score));
  } catch {
    /* ignore */
  }
}

export function evaluateGame(
  resultType: GameResultType,
  finalFloor: number,
  finalCoins: number,
  stats: GameStats,
  finalHp: number
): { rank: string; comment: string; stars: number } {
  const score =
    finalFloor * 100 +
    finalCoins * 2 +
    stats.revealedRooms * 1 +
    stats.monstersDefeated * 5 -
    stats.trapHits * 3 +
    finalHp * 10;

  let stars: number;
  let rank: string;
  let comment: string;

  if (resultType === "clear") {
    if (score >= 500) {
      stars = 5;
      rank = "传奇冒险家";
      comment = "完美的探索！你就是地牢之王！";
    } else if (score >= 350) {
      stars = 4;
      rank = "精英探险家";
      comment = "表现出色，地牢因你而颤抖！";
    } else if (score >= 200) {
      stars = 3;
      rank = "勇敢冒险者";
      comment = "干得不错，继续向更深层进发！";
    } else {
      stars = 2;
      rank = "新手探险家";
      comment = "顺利通关，下次尝试更高效的路线！";
    }
  } else if (resultType === "death") {
    if (score >= 400) {
      stars = 4;
      rank = "不屈战士";
      comment = "虽败犹荣！你的战绩令人敬佩！";
    } else if (score >= 250) {
      stars = 3;
      rank = "坚强斗士";
      comment = "战斗到了最后一刻，值得尊敬！";
    } else if (score >= 100) {
      stars = 2;
      rank = "冒险者";
      comment = "不要气馁，多积累经验再来挑战！";
    } else {
      stars = 1;
      rank = "探险学徒";
      comment = "下次小心陷阱和怪物，加油！";
    }
  } else {
    if (score >= 300) {
      stars = 3;
      rank = "策略家";
      comment = "主动撤退也是一种智慧，整装待发！";
    } else if (score >= 150) {
      stars = 2;
      rank = "谨慎探险者";
      comment = "见好就收，不失为明智之举！";
    } else {
      stars = 1;
      rank = "探索新手";
      comment = "下次尝试探索更多房间吧！";
    }
  }

  return { rank, comment, stars };
}

export function generateHighlights(
  resultType: GameResultType,
  finalFloor: number,
  finalCoins: number,
  currentStats: GameStats,
  isFloorRecord: boolean,
  isCoinRecord: boolean
): HighlightItem[] {
  const candidates: HighlightItem[] = [];

  if (isFloorRecord && finalFloor > 1) {
    candidates.push({ icon: "🏆", text: `刷新纪录！到达 B${finalFloor}F`, priority: 100 });
  }
  if (isCoinRecord && finalCoins > 0) {
    candidates.push({ icon: "💰", text: `刷新纪录！获得 ${finalCoins} 金币`, priority: 95 });
  }
  if (resultType === "clear" && currentStats.trapHits === 0) {
    candidates.push({ icon: "✨", text: "完美闪避！全程未踩陷阱", priority: 85 });
  }
  if (currentStats.monstersDefeated >= 3) {
    candidates.push({ icon: "⚔️", text: `勇猛善战！击败 ${currentStats.monstersDefeated} 只怪物`, priority: 80 });
  } else if (currentStats.monstersDefeated > 0) {
    candidates.push({ icon: "⚔️", text: `击败了 ${currentStats.monstersDefeated} 只怪物`, priority: 50 });
  }
  if (currentStats.trapHits >= 3) {
    candidates.push({ icon: "⚡", text: `步履维艰！踩中 ${currentStats.trapHits} 次陷阱`, priority: 70 });
  } else if (currentStats.trapHits > 0) {
    candidates.push({ icon: "⚡", text: `踩中 ${currentStats.trapHits} 次陷阱`, priority: 40 });
  }
  if (currentStats.potionsUsed >= 2) {
    candidates.push({ icon: "🧪", text: `药水依赖！使用了 ${currentStats.potionsUsed} 次药水`, priority: 60 });
  } else if (currentStats.potionsUsed > 0) {
    candidates.push({ icon: "🧪", text: `使用了 ${currentStats.potionsUsed} 次药水`, priority: 35 });
  }
  if (currentStats.fleeCount >= 2) {
    candidates.push({ icon: "🏃", text: `战术撤退！逃跑了 ${currentStats.fleeCount} 次`, priority: 55 });
  } else if (currentStats.fleeCount > 0) {
    candidates.push({ icon: "🏃", text: `逃跑了 ${currentStats.fleeCount} 次`, priority: 30 });
  }
  if (currentStats.revealedRooms >= 20) {
    candidates.push({ icon: "🗺️", text: `探索达人！翻开了 ${currentStats.revealedRooms} 间房`, priority: 45 });
  } else if (currentStats.revealedRooms >= 5) {
    candidates.push({ icon: "🗺️", text: `探索了 ${currentStats.revealedRooms} 间房`, priority: 25 });
  }

  if (candidates.length < 3 && finalFloor > 1) {
    candidates.push({ icon: "🏰", text: `到达了 B${finalFloor}F`, priority: 20 });
  }
  if (candidates.length < 3 && finalCoins > 0) {
    candidates.push({ icon: "💰", text: `收集了 ${finalCoins} 金币`, priority: 15 });
  }
  if (candidates.length < 3) {
    if (resultType === "clear") {
      candidates.push({ icon: "🎉", text: "成功通关本层！", priority: 18 });
    } else if (resultType === "death") {
      candidates.push({ icon: "💀", text: "在战斗中倒下了...", priority: 18 });
    } else {
      candidates.push({ icon: "🗺️", text: `翻开了 ${currentStats.revealedRooms} 间房`, priority: 10 });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, 3);
}
