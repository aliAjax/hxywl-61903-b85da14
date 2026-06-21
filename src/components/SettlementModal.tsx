import { useMemo } from "react";
import { GameStats } from "../hooks/useNormalProgress";
import { GameResultType, HighScore, HighlightItem, evaluateGame, generateHighlights } from "./shared";

interface SettlementModalProps {
  showSettlement: boolean;
  settlementResult: GameResultType | null;
  floor: number;
  coins: number;
  stats: GameStats;
  hp: number;
  brokeFloorRecord: boolean;
  brokeCoinRecord: boolean;
  highScore: HighScore;
  onRestart: () => void;
}

export default function SettlementModal({
  showSettlement,
  settlementResult,
  floor,
  coins,
  stats,
  hp,
  brokeFloorRecord,
  brokeCoinRecord,
  highScore,
  onRestart,
}: SettlementModalProps) {
  const settlementData = useMemo(() => {
    if (!showSettlement || !settlementResult) return null;
    const evaluation = evaluateGame(settlementResult, floor, coins, stats, hp);
    const resultTitle =
      settlementResult === "clear"
        ? "🏆 完美通关"
        : settlementResult === "death"
          ? "💀 探索失败"
          : "🏃 主动结束";
    const highlights = generateHighlights(
      settlementResult,
      floor,
      coins,
      stats,
      brokeFloorRecord,
      brokeCoinRecord
    );
    return {
      evaluation,
      resultTitle,
      isFloorRecord: brokeFloorRecord,
      isCoinRecord: brokeCoinRecord,
      highlights,
    };
  }, [showSettlement, settlementResult, floor, coins, stats, hp, brokeFloorRecord, brokeCoinRecord]);

  if (!showSettlement || !settlementData || !settlementResult) return null;

  return (
    <div className="settlement-overlay">
      <div className={`settlement-modal settlement-${settlementResult}`}>
        <div className="settlement-header">
          <h2>{settlementData.resultTitle}</h2>
          <div className="settlement-stars">
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={`star ${i < settlementData.evaluation.stars ? "star-on" : "star-off"}`}>
                ★
              </span>
            ))}
          </div>
          <div className="settlement-rank">{settlementData.evaluation.rank}</div>
          <p className="settlement-comment">{settlementData.evaluation.comment}</p>
        </div>

        <div className="settlement-stats">
          <div className="stat-row">
            <span className="stat-label">🏰 到达层数</span>
            <span className="stat-value">
              B{floor}F
              {settlementData.isFloorRecord && <span className="record-tag">新纪录!</span>}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">💰 金币总数</span>
            <span className="stat-value">
              {coins} 枚
              {settlementData.isCoinRecord && <span className="record-tag">新纪录!</span>}
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">🚪 翻开房间</span>
            <span className="stat-value">{stats.revealedRooms} 间</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">⚡ 遭遇陷阱</span>
            <span className="stat-value">{stats.trapHits} 次</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">👹 击败怪物</span>
            <span className="stat-value">{stats.monstersDefeated} 只</span>
          </div>
        </div>

        {settlementData.highlights.length > 0 && (
          <div className="settlement-highlights">
            <div className="highlights-title">✨ 本局亮点</div>
            <div className="highlights-list">
              {settlementData.highlights.map((h, i) => (
                <div key={i} className="highlight-item" style={{ animationDelay: `${(i + 1) * 120}ms` }}>
                  <span className="highlight-icon">{h.icon}</span>
                  <span className="highlight-text">{h.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="settlement-highscore">
          <div className="hs-row">
            <span>🏆 历史最高层数</span>
            <strong>B{highScore.maxFloor}F</strong>
          </div>
          <div className="hs-row">
            <span>💰 历史最高金币</span>
            <strong>{highScore.maxCoins} 枚</strong>
          </div>
        </div>

        <div className="settlement-actions">
          <button className="btn-settle-restart" onClick={onRestart}>
            🔄 再来一局
          </button>
        </div>
      </div>
    </div>
  );
}
