import { useMemo } from "react";
import { GAME_CONSTANTS } from "../config/gameConfig";
import { LeaderboardEntry, clearLeaderboard } from "../config/saveSystem";
import { LeaderboardSortKey } from "./shared";

interface LeaderboardPanelProps {
  showLeaderboard: boolean;
  setShowLeaderboard: (show: boolean) => void;
  leaderboard: LeaderboardEntry[];
  setLeaderboard: (entries: LeaderboardEntry[]) => void;
  leaderboardSort: LeaderboardSortKey;
  setLeaderboardSort: (sort: LeaderboardSortKey) => void;
}

export default function LeaderboardPanel({
  showLeaderboard,
  setShowLeaderboard,
  leaderboard,
  setLeaderboard,
  leaderboardSort,
  setLeaderboardSort,
}: LeaderboardPanelProps) {
  const sortedLeaderboard = useMemo(() => {
    const copy = [...leaderboard];
    switch (leaderboardSort) {
      case "floor":
        return copy.sort((a, b) => b.floor - a.floor || b.coins - a.coins || b.timestamp - a.timestamp);
      case "coins":
        return copy.sort((a, b) => b.coins - a.coins || b.floor - a.floor || b.timestamp - a.timestamp);
      case "time":
      default:
        return copy.sort((a, b) => b.timestamp - a.timestamp);
    }
  }, [leaderboard, leaderboardSort]);

  const handleClearLeaderboard = () => {
    if (window.confirm("确定要清空所有排行榜记录吗？此操作不可撤销。")) {
      clearLeaderboard();
      setLeaderboard([]);
    }
  };

  if (!showLeaderboard) return null;

  return (
    <div className="leaderboard-overlay">
      <div className="leaderboard-modal">
        <div className="leaderboard-header">
          <h2>📊 历史战绩排行榜</h2>
          <p>最近 {GAME_CONSTANTS.maxLeaderboardEntries} 局游戏记录</p>
          <button
            className="leaderboard-close"
            onClick={() => setShowLeaderboard(false)}
          >
            ✕
          </button>
        </div>

        <div className="leaderboard-toolbar">
          <div className="leaderboard-sort">
            <span className="sort-label">排序：</span>
            <button
              className={["sort-btn", leaderboardSort === "time" ? "sort-active" : ""].filter(Boolean).join(" ")}
              onClick={() => setLeaderboardSort("time")}
            >
              ⏱️ 最近
            </button>
            <button
              className={["sort-btn", leaderboardSort === "floor" ? "sort-active" : ""].filter(Boolean).join(" ")}
              onClick={() => setLeaderboardSort("floor")}
            >
              🏰 层数
            </button>
            <button
              className={["sort-btn", leaderboardSort === "coins" ? "sort-active" : ""].filter(Boolean).join(" ")}
              onClick={() => setLeaderboardSort("coins")}
            >
              💰 金币
            </button>
          </div>
          <button
            className="leaderboard-clear"
            onClick={handleClearLeaderboard}
            disabled={leaderboard.length === 0}
          >
            🗑️ 清空记录
          </button>
        </div>

        {sortedLeaderboard.length === 0 ? (
          <div className="leaderboard-empty">
            <div className="empty-icon">📭</div>
            <div className="empty-text">暂无战绩记录</div>
            <div className="empty-hint">完成一局游戏后将自动记录在此</div>
          </div>
        ) : (
          <div className="leaderboard-list">
            {sortedLeaderboard.map((entry, idx) => (
              <div
                key={entry.id}
                className={[
                  "leaderboard-item",
                  idx === 0 && leaderboardSort !== "time" ? "lb-top-1" : "",
                  idx === 1 && leaderboardSort !== "time" ? "lb-top-2" : "",
                  idx === 2 && leaderboardSort !== "time" ? "lb-top-3" : "",
                  `lb-result-${entry.resultType}`,
                ].filter(Boolean).join(" ")}
              >
                <div className="lb-rank">
                  {leaderboardSort !== "time" && idx < 3 ? (
                    <span className="lb-rank-medal">
                      {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                    </span>
                  ) : (
                    <span className="lb-rank-num">#{idx + 1}</span>
                  )}
                </div>
                <div className="lb-info">
                  <div className="lb-info-top">
                    <span className="lb-result-tag">
                      {entry.resultType === "clear" ? "🏆 通关" : entry.resultType === "death" ? "💀 阵亡" : "🏃 撤退"}
                    </span>
                    <span className="lb-stars">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span
                          key={i}
                          className={`star-mini ${i < entry.stars ? "star-mini-on" : "star-mini-off"}`}
                        >
                          ★
                        </span>
                      ))}
                    </span>
                    <span className="lb-rank-title">{entry.rank}</span>
                  </div>
                  <div className="lb-info-stats">
                    <span className="lb-stat">🏰 B{entry.floor}F</span>
                    <span className="lb-stat">💰 {entry.coins}</span>
                    <span className="lb-stat">🚪 {entry.revealedRooms}</span>
                    <span className="lb-stat">⚡ {entry.trapHits}</span>
                    <span className="lb-stat">👹 {entry.monstersDefeated}</span>
                  </div>
                  <div className="lb-info-time">
                    {new Date(entry.timestamp).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="leaderboard-footer">
          <div className="lb-summary">
            共 {leaderboard.length} 条记录
            {leaderboard.length > 0 && (
              <>
                <span className="lb-summary-sep">·</span>
                <span>最高 B{Math.max(...leaderboard.map(e => e.floor))}F</span>
                <span className="lb-summary-sep">·</span>
                <span>最多 {Math.max(...leaderboard.map(e => e.coins))} 金币</span>
              </>
            )}
          </div>
          <button
            className="btn-close-leaderboard"
            onClick={() => setShowLeaderboard(false)}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
