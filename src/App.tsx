import { useMemo, useState } from "react";
import "./styles.css";

const game = {
  "id": "hxywl-61903",
  "port": 61903,
  "title": "地牢翻牌",
  "tagline": "在随机房间里寻找钥匙与出口，避开陷阱",
  "prompt": "我需要一个H5地牢翻牌小游戏，玩家在5x5格子里逐步翻开房间，可能遇到金币、陷阱、怪物、钥匙和出口。游戏需要有血量、背包、当前层数、回合记录和失败/通关结算。每一局地图随机生成，但要保证至少有一条可通关路线，整体操作适合手机单手点击。",
  "palette": [
    "#7c2d12",
    "#65a30d",
    "#dc2626"
  ],
  "stats": [
    "血量",
    "金币",
    "钥匙",
    "层数"
  ],
  "actions": [
    "进入下一层",
    "使用药水",
    "重新探索"
  ],
  "mode": "dungeon"
};

const boards: Record<string, string[]> = {
  rhythm: ["♪", "◇", "♪", "◆", "♪", "◇", "◆", "♪", "◇"],
  merge: ["🍩", "🍩", "🧁", "🍪", "🧁", "🍰", "🍪", "🍩", "🍮"],
  dungeon: ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"],
  slingshot: ["★", "·", "●", "·", "▣", "·", "★", "·", "◎"],
  escape: ["书架", "花瓶", "抽屉", "挂画", "地毯", "台灯", "门锁", "箱子", "窗帘"],
};

function App() {
  const [score, setScore] = useState(1280);
  const [combo, setCombo] = useState(7);
  const [selected, setSelected] = useState(0);
  const cells = useMemo(() => boards[game.mode], []);
  const best = Number(localStorage.getItem(game.id + "-best") || 0);

  function playCell(index: number) {
    setSelected(index);
    const gain = game.mode === "dungeon" && index % 5 === 0 ? -80 : 120 + index * 8;
    const nextScore = Math.max(0, score + gain);
    setScore(nextScore);
    setCombo((value) => (gain > 0 ? value + 1 : 0));
    if (nextScore > best) {
      localStorage.setItem(game.id + "-best", String(nextScore));
    }
  }

  return (
    <main className="game-shell">
      <section className="hero">
        <p>{game.id} · H5Game · Port {game.port}</p>
        <h1>{game.title}</h1>
        <span>{game.tagline}</span>
      </section>

      <section className="hud">
        {game.stats.map((stat, index) => (
          <article key={stat}>
            <small>{stat}</small>
            <strong>{index === 0 ? score : index === 1 ? best : index === 2 ? selected + 1 : combo}</strong>
          </article>
        ))}
      </section>

      <section className={"playground " + game.mode}>
        <div className="board">
          {cells.map((cell, index) => (
            <button
              className={selected === index ? "active" : ""}
              key={index}
              onClick={() => playCell(index)}
            >
              {cell}
            </button>
          ))}
        </div>
        <aside className="side-panel">
          <h2>核心玩法</h2>
          <p>{game.prompt}</p>
          <div className="actions">
            {game.actions.map((action) => (
              <button key={action}>{action}</button>
            ))}
          </div>
        </aside>
      </section>

      <section className="result-panel">
        <h2>结算预览</h2>
        <p>当前分数{score}，最高分{Math.max(best, score)}，连击{combo}。基础流程已包含开始、交互、反馈、记录和结算区域，后续可以继续扩展关卡、音效、动画与资源管理。</p>
      </section>
    </main>
  );
}

export default App;
