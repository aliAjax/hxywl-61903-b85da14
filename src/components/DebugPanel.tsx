import { useCallback, useRef, useState } from "react";
import { GAME_CONSTANTS, RouteType, RouteConfig, FloorConfig, getFloorConfig } from "../config/gameConfig";
import { verifyMap, printMapDebug, runSingleDiagIteration, compileDiagChunk, computeDiagOverview, DiagProgress, DiagReport, GenerationResult } from "../config/mapGenerator";
import { generateBoard, Room, GameStats, BattleState } from "../hooks/useNormalProgress";
import { EventStore } from "../model/eventStore";

interface DebugPanelProps {
  showDebugPanel: boolean;
  setShowDebugPanel: React.Dispatch<React.SetStateAction<boolean>>;
  revealAllRooms: boolean;
  setRevealAllRooms: React.Dispatch<React.SetStateAction<boolean>>;
  floor: number;
  currentRoute: RouteType;
  board: Room[];
  setBoard: React.Dispatch<React.SetStateAction<Room[]>>;
  hp: number;
  coins: number;
  keys: number;
  potions: number;
  status: "playing" | "won" | "lost";
  battleState: BattleState;
  battleRoomIdx: number;
  playerCharging: boolean;
  stats: GameStats;
  reconstructionError: string | null;
  eventStore: React.MutableRefObject<EventStore>;
  getReconstructedState: () => any;
  floorCfg: FloorConfig;
  currentRouteCfg: RouteConfig | null;
}

export default function DebugPanel({
  showDebugPanel,
  setShowDebugPanel,
  revealAllRooms,
  setRevealAllRooms,
  floor,
  currentRoute,
  board,
  setBoard,
  hp,
  coins,
  keys,
  potions,
  status,
  battleState,
  battleRoomIdx,
  playerCharging,
  stats,
  reconstructionError,
  eventStore,
  getReconstructedState,
  floorCfg,
  currentRouteCfg,
}: DebugPanelProps) {
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const [diagFloorFrom, setDiagFloorFrom] = useState(1);
  const [diagFloorTo, setDiagFloorTo] = useState(10);
  const [diagIterations, setDiagIterations] = useState(50);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagProgress, setDiagProgress] = useState<DiagProgress | null>(null);
  const [diagReport, setDiagReport] = useState<DiagReport | null>(null);
  const [diagExpandedFloor, setDiagExpandedFloor] = useState<number | null>(null);
  const [diagViewMode, setDiagViewMode] = useState<"overview" | "detail">("overview");
  const diagRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const addDebugLog = useCallback((msg: string) => {
    setDebugLog((prev) => [msg, ...prev].slice(0, 50));
  }, []);

  const runReconstructionCheck = useCallback(() => {
    const store = eventStore.current;
    if (!store) return;

    const reconstructed = store.rebuild();
    const totalEvents = store.getEventCount();

    addDebugLog(`===== 🔍 完整状态重构验证 =====`);
    addDebugLog(`事件总数: ${totalEvents}, 总楼层数: ${store.getTotalFloors()}`);

    const mismatches: string[] = [];

    if (reconstructed.hp !== hp) mismatches.push(`hp: 重构=${reconstructed.hp}, 实际=${hp}`);
    if (reconstructed.coins !== coins) mismatches.push(`coins: 重构=${reconstructed.coins}, 实际=${coins}`);
    if (reconstructed.keys !== keys) mismatches.push(`keys: 重构=${reconstructed.keys}, 实际=${keys}`);
    if (reconstructed.potions !== potions) mismatches.push(`potions: 重构=${reconstructed.potions}, 实际=${potions}`);
    if (reconstructed.floor !== floor) mismatches.push(`floor: 重构=B${reconstructed.floor}F, 实际=B${floor}F`);
    if (reconstructed.status !== status) mismatches.push(`status: 重构=${reconstructed.status}, 实际=${status}`);
    if (reconstructed.battleState !== battleState) mismatches.push(`battleState: 重构=${reconstructed.battleState}, 实际=${battleState}`);
    if (reconstructed.battleRoomIdx !== battleRoomIdx) mismatches.push(`battleRoomIdx: 重构=${reconstructed.battleRoomIdx}, 实际=${battleRoomIdx}`);
    if (reconstructed.playerCharging !== playerCharging) mismatches.push(`playerCharging: 重构=${reconstructed.playerCharging}, 实际=${playerCharging}`);
    if (reconstructed.currentRoute !== currentRoute) mismatches.push(`currentRoute: 重构=${reconstructed.currentRoute}, 实际=${currentRoute}`);

    if (reconstructed.stats.revealedRooms !== stats.revealedRooms) mismatches.push(`stats.revealedRooms: 重构=${reconstructed.stats.revealedRooms}, 实际=${stats.revealedRooms}`);
    if (reconstructed.stats.trapHits !== stats.trapHits) mismatches.push(`stats.trapHits: 重构=${reconstructed.stats.trapHits}, 实际=${stats.trapHits}`);
    if (reconstructed.stats.monstersDefeated !== stats.monstersDefeated) mismatches.push(`stats.monstersDefeated: 重构=${reconstructed.stats.monstersDefeated}, 实际=${stats.monstersDefeated}`);
    if (reconstructed.stats.potionsUsed !== stats.potionsUsed) mismatches.push(`stats.potionsUsed: 重构=${reconstructed.stats.potionsUsed}, 实际=${stats.potionsUsed}`);
    if (reconstructed.stats.fleeCount !== stats.fleeCount) mismatches.push(`stats.fleeCount: 重构=${reconstructed.stats.fleeCount}, 实际=${stats.fleeCount}`);

    let boardMismatches = 0;
    if (reconstructed.board.length !== board.length) {
      mismatches.push(`board.length: 重构=${reconstructed.board.length}, 实际=${board.length}`);
    } else {
      for (let i = 0; i < board.length; i++) {
        const r = reconstructed.board[i];
        const a = board[i];
        if (r.type !== a.type) { boardMismatches++; mismatches.push(`board[${i}].type: 重构=${r.type}, 实际=${a.type}`); }
        if (r.revealed !== a.revealed) { boardMismatches++; mismatches.push(`board[${i}].revealed: 重构=${r.revealed}, 实际=${a.revealed}`); }
        if (r.defeated !== a.defeated) { boardMismatches++; mismatches.push(`board[${i}].defeated: 重构=${r.defeated}, 实际=${a.defeated}`); }
      }
    }

    if (mismatches.length === 0) {
      addDebugLog(`✅ 验证通过！所有 ${totalEvents} 个事件正确重建了全部状态`);
      addDebugLog(`   状态: B${reconstructed.floor}F | HP ${reconstructed.hp} | 金币 ${reconstructed.coins} | 房间揭示 ${reconstructed.stats.revealedRooms}`);
    } else {
      addDebugLog(`❌ 验证失败！发现 ${mismatches.length} 处不一致（含 ${boardMismatches} 处地图错误）`);
      mismatches.slice(0, 15).forEach((m) => addDebugLog(`  - ${m}`));
      if (mismatches.length > 15) {
        addDebugLog(`  ... 还有 ${mismatches.length - 15} 处不一致`);
      }
    }
  }, [eventStore, hp, coins, keys, potions, floor, status, battleState, battleRoomIdx, playerCharging, currentRoute, stats, board, addDebugLog]);

  const showEventHistory = useCallback(() => {
    const reconstructed = getReconstructedState();
    addDebugLog(`===== 事件历史 =====`);
    addDebugLog(`总事件数: ${reconstructed.turn}`);
    addDebugLog(`当前楼层: B${reconstructed.floor}F`);
    addDebugLog(`当前血量: ${reconstructed.hp}/${GAME_CONSTANTS.maxHp}`);
    addDebugLog(`当前金币: ${reconstructed.coins}`);
    addDebugLog(`当前状态: ${reconstructed.status}`);
  }, [getReconstructedState, addDebugLog]);

  const showFloorProgress = useCallback(() => {
    const store = eventStore.current;
    if (!store) return;
    const currentFloor = store.getCurrentFloor();
    const totalFloors = store.getTotalFloors();
    const progress = store.getCurrentFloorProgress();

    addDebugLog(`===== 楼层进度 =====`);
    addDebugLog(`总楼层数: ${totalFloors}`);
    addDebugLog(`当前楼层: B${currentFloor}F`);

    if (progress) {
      addDebugLog(`已揭示房间: ${progress.revealedRooms}/${progress.totalRooms}`);
      addDebugLog(`击败怪物: ${progress.defeatedMonsters}`);
      addDebugLog(`陷阱触发: ${progress.trapHits}`);
      addDebugLog(`血量变化: ${progress.hpStart} → ${progress.hpEnd}`);
      addDebugLog(`金币变化: ${progress.coinsStart} → ${progress.coinsEnd}`);
      addDebugLog(`药水获得: ${progress.potionsGained}, 药水使用: ${progress.potionsUsed}`);
      addDebugLog(`钥匙获得: ${progress.keysGained}`);
      addDebugLog(`楼层状态: ${progress.status}`);
    }

    for (let f = 1; f <= totalFloors; f++) {
      const floorEvents = store.getFloorEvents(f);
      addDebugLog(`  B${f}F: ${floorEvents.length} 个事件`);
    }
  }, [addDebugLog, eventStore]);

  const verifyCurrentMap = useCallback(() => {
    const cfg = getFloorConfig(floor, currentRoute);
    const roomTypes = board.map((r) => r.type);
    const result = verifyMap(roomTypes, cfg.pathMaxDamage);
    addDebugLog(`验证结果: ${result.valid ? "✅ 通过" : "❌ 失败"}`);
    if (result.issues.length > 0) {
      result.issues.forEach((issue) => addDebugLog(`  - ${issue}`));
    }
    addDebugLog(`路径伤害: 起点→钥匙=${result.safePath ? "有" : "无"}`);
  }, [board, floor, currentRoute, addDebugLog]);

  const printDebugMap = useCallback(() => {
    const roomTypes = board.map((r) => r.type);
    const mapStr = printMapDebug(roomTypes, { showPath: true, showDamage: true });
    addDebugLog("===== 地图布局 =====");
    mapStr.split("\n").forEach((line) => addDebugLog(line));
  }, [board, addDebugLog]);

  const regenMap = useCallback(() => {
    const newBoard = generateBoard(floor, currentRoute);
    setBoard(newBoard);
    addDebugLog(`重新生成地图 (B${floor}F)`);
  }, [floor, currentRoute, addDebugLog, setBoard]);

  const toggleRevealAll = useCallback(() => {
    setRevealAllRooms((prev) => !prev);
    addDebugLog(!revealAllRooms ? "已显示所有房间（调试）" : "已隐藏所有房间（调试）");
  }, [revealAllRooms, addDebugLog, setRevealAllRooms]);

  const startDiagRun = useCallback(() => {
    if (diagRunning) return;
    const from = Math.max(1, diagFloorFrom);
    const to = Math.max(from, diagFloorTo);
    const iters = Math.max(1, Math.min(500, diagIterations));
    const totalFloors = to - from + 1;
    const route = currentRoute;

    diagRef.current = { cancelled: false };
    setDiagRunning(true);
    setDiagReport(null);
    setDiagExpandedFloor(null);
    setDiagProgress({
      currentFloor: from,
      currentIteration: 0,
      totalFloors,
      iterationsPerFloor: iters,
      done: false,
    });

    const startTime = Date.now();
    const allResults: { floor: number; results: GenerationResult[] }[] = [];
    let currentFloorIdx = 0;

    const scheduleWork = (fn: () => void) => {
      if (typeof requestIdleCallback !== "undefined") {
        const handle = requestIdleCallback(
          () => {
            fn();
          },
          { timeout: 50 }
        );
        return () => cancelIdleCallback(handle);
      } else {
        const handle = setTimeout(fn, 0);
        return () => clearTimeout(handle);
      }
    };

    let cancelScheduled: (() => void) | null = null;

    const processFloor = () => {
      if (diagRef.current.cancelled) {
        setDiagRunning(false);
        setDiagProgress((p) => (p ? { ...p, done: true } : null));
        return;
      }

      const fl = from + currentFloorIdx;
      const chunkResults: GenerationResult[] = [];
      let iterDone = 0;

      const processBatch = () => {
        if (diagRef.current.cancelled) {
          setDiagRunning(false);
          return;
        }
        const batchSize = Math.min(3, iters - iterDone);
        let batchDone = 0;
        try {
          while (batchDone < batchSize && iterDone < iters) {
            chunkResults.push(runSingleDiagIteration(fl, route));
            iterDone++;
            batchDone++;
          }
        } catch (_e) {
          // ignore
        }

        setDiagProgress({
          currentFloor: fl,
          currentIteration: iterDone,
          totalFloors,
          iterationsPerFloor: iters,
          done: false,
        });

        if (iterDone < iters) {
          cancelScheduled = scheduleWork(processBatch);
        } else {
          allResults.push({ floor: fl, results: chunkResults });
          currentFloorIdx++;
          if (currentFloorIdx < totalFloors) {
            cancelScheduled = scheduleWork(processFloor);
          } else {
            const compiledFloors = allResults.map((r) =>
              compileDiagChunk(r.floor, route, r.results, iters)
            );
            const totalIters = totalFloors * iters;
            setDiagReport({
              floors: compiledFloors,
              totalIterations: totalIters,
              elapsed: Date.now() - startTime,
              overview: computeDiagOverview(compiledFloors, totalIters),
            });
            setDiagProgress((p) => (p ? { ...p, done: true } : null));
            setDiagRunning(false);
          }
        }
      };

      processBatch();
    };

    processFloor();
  }, [diagRunning, diagFloorFrom, diagFloorTo, diagIterations, currentRoute]);

  const cancelDiagRun = useCallback(() => {
    diagRef.current.cancelled = true;
  }, []);

  if (!showDebugPanel) return null;

  return (
    <section className="debug-panel">
      <div className="debug-header">
        <h3>🔧 开发调试面板</h3>
        <button onClick={() => setShowDebugPanel(false)}>✕</button>
      </div>
      <div className="debug-actions">
        <button onClick={verifyCurrentMap}>验证地图</button>
        <button onClick={printDebugMap}>打印地图</button>
        <button onClick={regenMap}>重新生成</button>
        <button onClick={toggleRevealAll}>
          {revealAllRooms ? "隐藏房间" : "显示所有房间"}
        </button>
        <button onClick={runReconstructionCheck}>🔍 验证事件重构</button>
        <button onClick={showEventHistory}>📋 显示事件状态</button>
        <button onClick={showFloorProgress}>🏗️ 楼层进度</button>
      </div>
      <div className="debug-stats">
        <div>当前楼层: B{floor}F</div>
        <div>当前路线: {currentRouteCfg ? `${currentRouteCfg.icon} ${currentRouteCfg.name}` : "无"}</div>
        <div>路径上限: {floorCfg.pathMaxDamage} 伤害</div>
        <div>事件系统: {reconstructionError ? "❌ 不一致" : "✅ 正常"}</div>
      </div>
      {reconstructionError && (
        <div className="debug-error" style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px', padding: '8px', background: '#fef2f2', borderRadius: '4px' }}>
          ⚠️ {reconstructionError}
        </div>
      )}

      <div className="diag-config">
        <div className="diag-config-title">📊 诊断报告</div>
        <div className="diag-config-row">
          <label>楼层范围</label>
          <div className="diag-range-inputs">
            <input
              type="number"
              min={1}
              max={20}
              value={diagFloorFrom}
              onChange={(e) => setDiagFloorFrom(Math.max(1, parseInt(e.target.value) || 1))}
              disabled={diagRunning}
            />
            <span>~</span>
            <input
              type="number"
              min={diagFloorFrom}
              max={20}
              value={diagFloorTo}
              onChange={(e) => setDiagFloorTo(Math.max(diagFloorFrom, parseInt(e.target.value) || diagFloorFrom))}
              disabled={diagRunning}
            />
          </div>
        </div>
        <div className="diag-config-row">
          <label>每层迭代</label>
          <input
            type="number"
            className="diag-iter-input"
            min={1}
            max={500}
            value={diagIterations}
            onChange={(e) => setDiagIterations(Math.max(1, Math.min(500, parseInt(e.target.value) || 50)))}
            disabled={diagRunning}
          />
        </div>
        <div className="diag-config-row">
          <label>路线</label>
          <span className="diag-route-label">
            {currentRouteCfg ? `${currentRouteCfg.icon} ${currentRouteCfg.name}` : "默认"}
          </span>
        </div>
        <div className="diag-run-row">
          {!diagRunning ? (
            <button className="diag-btn-run" onClick={startDiagRun}>
              ▶ 运行诊断
            </button>
          ) : (
            <button className="diag-btn-cancel" onClick={cancelDiagRun}>
              ⏹ 取消
            </button>
          )}
        </div>
      </div>

      {diagRunning && diagProgress && !diagProgress.done && (
        <div className="diag-progress">
          <div className="diag-progress-bar">
            <div
              className="diag-progress-fill"
              style={{
                width: `${(
                  ((diagProgress.currentFloor - diagFloorFrom) * diagProgress.iterationsPerFloor +
                    diagProgress.currentIteration) /
                  (diagProgress.totalFloors * diagProgress.iterationsPerFloor) *
                  100
                ).toFixed(1)}%`,
              }}
            />
          </div>
          <div className="diag-progress-text">
            B{diagProgress.currentFloor}F · {diagProgress.currentIteration}/{diagProgress.iterationsPerFloor}
          </div>
        </div>
      )}

      {diagReport && (
        <div className="diag-report diag-report-v2">
          <div className="diag-report-header-v2">
            <div className="diag-report-title-row">
              <span className="diag-report-title">📊 开发诊断报告</span>
              <span className="diag-report-meta-v2">
                {diagReport.totalIterations} 次迭代 · {(diagReport.elapsed / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="diag-view-tabs">
              <button
                className={`diag-view-tab ${diagViewMode === "overview" ? "active" : ""}`}
                onClick={() => setDiagViewMode("overview")}
              >
                📈 总览
              </button>
              <button
                className={`diag-view-tab ${diagViewMode === "detail" ? "active" : ""}`}
                onClick={() => setDiagViewMode("detail")}
              >
                📋 详情
              </button>
            </div>
          </div>

          {diagViewMode === "overview" && diagReport.overview && (
            <div className="diag-overview-section">
              <div className="diag-overview-cards">
                <div className="diag-overview-card card-success">
                  <div className="card-icon">✅</div>
                  <div className="card-content">
                    <div className="card-label">总体成功率</div>
                    <div className="card-value">
                      {(diagReport.overview.overallSuccessRate * 100).toFixed(1)}%
                    </div>
                    <div className="card-sub">
                      最佳 B{diagReport.overview.bestFloor}F · 最差 B{diagReport.overview.worstFloor}F
                    </div>
                  </div>
                </div>
                <div className="diag-overview-card card-damage">
                  <div className="card-icon">⚡</div>
                  <div className="card-content">
                    <div className="card-label">平均路径伤害</div>
                    <div className="card-value">
                      {diagReport.overview.avgPathDamage.toFixed(2)}
                    </div>
                    <div className="card-sub">跨 {diagReport.overview.totalFloors} 层平均</div>
                  </div>
                </div>
                <div className="diag-overview-card card-attempts">
                  <div className="card-icon">🔄</div>
                  <div className="card-content">
                    <div className="card-label">平均生成尝试</div>
                    <div className="card-value">
                      {diagReport.overview.avgAttempts.toFixed(2)}
                    </div>
                    <div className="card-sub">最难 B{diagReport.overview.hardestFloor}F</div>
                  </div>
                </div>
              </div>

              <div className="diag-trend-section">
                <div className="diag-chart-title-v2">📉 成功率趋势</div>
                <div className="diag-trend-chart">
                  <div className="trend-y-axis">
                    <span>100%</span>
                    <span>50%</span>
                    <span>0%</span>
                  </div>
                  <div className="trend-content">
                    <svg
                      className="trend-svg"
                      viewBox={`0 0 ${diagReport.floors.length * 60} 100`}
                      preserveAspectRatio="none"
                    >
                      <polyline
                        fill="none"
                        stroke="url(#successGradient)"
                        strokeWidth="2"
                        points={diagReport.floors
                          .map((f, i) => `${i * 60 + 30},${100 - f.successRate * 100}`)
                          .join(" ")}
                      />
                      <defs>
                        <linearGradient id="successGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#4ade80" />
                          <stop offset="100%" stopColor="#22c55e" />
                        </linearGradient>
                      </defs>
                      {diagReport.floors.map((f, i) => (
                        <circle
                          key={f.floor}
                          cx={i * 60 + 30}
                          cy={100 - f.successRate * 100}
                          r="3"
                          fill="#4ade80"
                        />
                      ))}
                    </svg>
                    <div className="trend-x-axis">
                      {diagReport.floors.map((f) => (
                        <span key={f.floor} className="trend-x-label">
                          B{f.floor}F
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="diag-compare-section">
                <div className="diag-chart-title-v2">📊 楼层指标对比</div>
                <div className="diag-compare-bars">
                  {diagReport.floors.map((fr) => {
                    const maxDmg = Math.max(...diagReport.floors.map((f) => f.avgPathDamage), 1);
                    const maxAtt = Math.max(...diagReport.floors.map((f) => f.avgAttempts), 1);
                    const isExpanded = diagExpandedFloor === fr.floor;
                    return (
                      <div
                        key={fr.floor}
                        className={`diag-compare-row ${isExpanded ? "expanded" : ""}`}
                        onClick={() => setDiagExpandedFloor(isExpanded ? null : fr.floor)}
                      >
                        <div className="compare-main">
                          <span className="compare-floor">B{fr.floor}F</span>
                          <div className="compare-bars">
                            <div className="compare-bar-group">
                              <div
                                className="compare-bar compare-bar-success"
                                style={{ width: `${fr.successRate * 100}%` }}
                                title={`成功率: ${(fr.successRate * 100).toFixed(1)}%`}
                              />
                              <span className="compare-bar-label">
                                {(fr.successRate * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="compare-bar-group">
                              <div
                                className="compare-bar compare-bar-damage"
                                style={{ width: `${(fr.avgPathDamage / maxDmg) * 100}%` }}
                                title={`平均伤害: ${fr.avgPathDamage.toFixed(2)}`}
                              />
                              <span className="compare-bar-label">
                                {fr.avgPathDamage.toFixed(1)}
                              </span>
                            </div>
                            <div className="compare-bar-group">
                              <div
                                className="compare-bar compare-bar-attempts"
                                style={{ width: `${(fr.avgAttempts / maxAtt) * 100}%` }}
                                title={`平均尝试: ${fr.avgAttempts.toFixed(2)}`}
                              />
                              <span className="compare-bar-label">
                                {fr.avgAttempts.toFixed(1)}
                              </span>
                            </div>
                          </div>
                          <span className="expand-icon">{isExpanded ? "▲" : "▼"}</span>
                        </div>
                        {isExpanded && (
                          <div className="compare-detail">
                            <div className="detail-grid">
                              <div className="detail-item">
                                <span className="detail-label">成功率</span>
                                <span className={`detail-value ${fr.successRate >= 0.9 ? "good" : fr.successRate >= 0.5 ? "warn" : "bad"}`}>
                                  {(fr.successRate * 100).toFixed(1)}%
                                </span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">平均伤害</span>
                                <span className="detail-value">{fr.avgPathDamage.toFixed(2)}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">中位伤害</span>
                                <span className="detail-value">{fr.medianPathDamage.toFixed(2)}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">伤害范围</span>
                                <span className="detail-value">{fr.minPathDamage} ~ {fr.maxPathDamage}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">标准差</span>
                                <span className="detail-value">±{fr.pathDamageStdDev.toFixed(2)}</span>
                              </div>
                              <div className="detail-item">
                                <span className="detail-label">平均尝试</span>
                                <span className="detail-value">{fr.avgAttempts.toFixed(2)}</span>
                              </div>
                            </div>
                            <div className="detail-distribution">
                              <div className="dist-title">伤害分布</div>
                              <div className="dist-bars">
                                {fr.damageDistribution.map((count, i) => {
                                  const maxCount = Math.max(...fr.damageDistribution, 1);
                                  return (
                                    <div key={i} className="dist-bar-wrapper">
                                      <div
                                        className="dist-bar"
                                        style={{ height: `${(count / maxCount) * 100}%` }}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                            {Object.keys(fr.commonIssues).length > 0 && (
                              <div className="detail-issues">
                                <div className="issues-title">常见问题</div>
                                <div className="issues-list">
                                  {Object.entries(fr.commonIssues)
                                    .sort((a, b) => b[1] - a[1])
                                    .slice(0, 5)
                                    .map(([issue, count]) => (
                                      <div key={issue} className="issue-item">
                                        <span className="issue-name">{issue}</span>
                                        <span className="issue-count">{count}次</span>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {diagViewMode === "detail" && (
            <div className="diag-detail-section">
              <div className="diag-detail-table-v2">
                <div className="detail-table-header">
                  <span>楼层</span>
                  <span>成功率</span>
                  <span>平均伤害</span>
                  <span>中位伤害</span>
                  <span>伤害范围</span>
                  <span>平均尝试</span>
                </div>
                {diagReport.floors.map((fr) => (
                  <div key={fr.floor} className="detail-table-row">
                    <span className="floor-cell">B{fr.floor}F</span>
                    <span className={fr.successRate >= 0.9 ? "val-good" : fr.successRate >= 0.5 ? "val-warn" : "val-bad"}>
                      {(fr.successRate * 100).toFixed(1)}%
                    </span>
                    <span>{fr.avgPathDamage.toFixed(2)}</span>
                    <span>{fr.medianPathDamage.toFixed(2)}</span>
                    <span>{fr.minPathDamage}~{fr.maxPathDamage}</span>
                    <span>{fr.avgAttempts.toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="diag-issues-summary">
                <div className="diag-chart-title-v2">⚠️ 全楼层失败原因汇总</div>
                <div className="issues-summary-list">
                  {(() => {
                    const allIssues: Record<string, number> = {};
                    for (const f of diagReport.floors) {
                      for (const [issue, count] of Object.entries(f.commonIssues)) {
                        allIssues[issue] = (allIssues[issue] || 0) + count;
                      }
                    }
                    const totalIssues = Object.values(allIssues).reduce((a, b) => a + b, 0);
                    return Object.entries(allIssues)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([issue, count]) => (
                        <div key={issue} className="issue-summary-item">
                          <div className="issue-summary-header">
                            <span className="issue-summary-name">{issue}</span>
                            <span className="issue-summary-count">{count}次</span>
                          </div>
                          <div className="issue-summary-bar">
                            <div
                              className="issue-summary-fill"
                              style={{ width: `${totalIssues > 0 ? (count / totalIssues) * 100 : 0}%` }}
                            />
                          </div>
                        </div>
                      ));
                  })()}
                </div>
              </div>
            </div>
          )}

          <div className="diag-report-actions">
            <button
              className="diag-action-btn"
              onClick={() => {
                const jsonStr = JSON.stringify(diagReport, null, 2);
                navigator.clipboard?.writeText(jsonStr).then(
                  () => addDebugLog("✅ 诊断报告已复制到剪贴板"),
                  () => addDebugLog("❌ 复制失败，请手动复制")
                );
              }}
            >
              📋 复制报告
            </button>
            <button
              className="diag-action-btn"
              onClick={startDiagRun}
              disabled={diagRunning}
            >
              🔄 重新运行
            </button>
          </div>
        </div>
      )}

      <div className="debug-log">
        <div className="debug-log-header">📋 调试日志</div>
        <div className="debug-log-content">
          {debugLog.length === 0 ? (
            <div className="debug-log-empty">暂无日志，点击上方按钮开始调试</div>
          ) : (
            debugLog.map((msg, i) => (
              <div key={i} className="debug-log-item">{msg}</div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
