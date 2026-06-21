# hxywl-61903 地牢翻牌

我需要一个H5地牢翻牌小游戏，玩家在5x5格子里逐步翻开房间，可能遇到金币、陷阱、怪物、钥匙和出口。游戏需要有血量、背包、当前层数、回合记录和失败/通关结算。每一局地图随机生成，但要保证至少有一条可通关路线，整体操作适合手机单手点击。

## 技术栈

React + Vite + TypeScript + Vitest

## 本地运行

```bash
npm install
npm run dev
```

开发端口：61903

## 质量检查流程

项目提供了完整的本地质量检查链路，确保玩法正确性。日常开发中请在提交代码前运行检查。

### 可用命令

| 命令 | 说明 |
|------|------|
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | 运行所有单元测试（单次） |
| `npm run test:watch` | 运行所有单元测试（监听模式） |
| `npm run build` | 生产构建验证 |
| `npm run check` | **一键全量检查**：类型检查 → 单元测试 → 构建验证 |

### 日常开发流程

1. 启动开发服务器：`npm run dev`
2. 编写代码和测试
3. 运行测试验证：`npm run test`
4. **提交前必须运行**：`npm run check`

### 测试覆盖范围

测试文件位于 `src/__tests__/` 目录，覆盖以下核心模块：

| 测试文件 | 覆盖范围 | 核心验证点 |
|----------|----------|------------|
| [mapGenerator.test.ts](src/__tests__/mapGenerator.test.ts) | 地图生成 | 钥匙/出口可达性、路径伤害限制、死路检测、随机一致性 |
| [saveSystem.test.ts](src/__tests__/saveSystem.test.ts) | 存档校验 | 数据完整性校验、状态自修复、多槽位管理、排行榜 |
| [eventStore.test.ts](src/__tests__/eventStore.test.ts) | 事件重建 | 事件溯源、状态重建、楼层边界、进度统计 |
| [riskEstimator.test.ts](src/__tests__/riskEstimator.test.ts) | 风险估算 | 概率计算、信息泄露防护、置信度评估 |

### 添加新测试

在 `src/__tests__/` 目录下创建 `*.test.ts` 或 `*.test.tsx` 文件，使用 Vitest API 编写测试：

```typescript
import { describe, it, expect } from "vitest";

describe("模块名", () => {
  it("应该做什么", () => {
    expect(actual).toBe(expected);
  });
});
```

### CI/CD 建议

`npm run check` 命令设计为可复用的检查入口，建议在 CI 流程中直接使用：

```yaml
# GitHub Actions 示例
- run: npm ci
- run: npm run check
```
