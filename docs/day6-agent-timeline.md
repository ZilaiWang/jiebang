# Day 6 Agent 状态展示实现记录

## 作用范围

本改动在角色4现有的“学习记录”页内增加 Agent 时间线，不改动主会话状态机、审核策略、动态决策或整体页面导航。

## 数据来源

- 主 Agent 状态：session 的 `status`、`current_stage`、`round_no` 和 `waiting_for`。
- 执行单元时间线：session 的追加式 `worker_ledger_history`。
- 产物：每条 ledger 的 `output_refs`，同时保留 `verified_exists` 结果。
- 失败和重试：`errors`、`attempt_no` 和 `retry`。
- 审核状态：`content_review.overall_status`。
- 下一步决策：`next_round_action.action` 或 `feedback.final_decision.action`。

页面不根据前端动画推测 Agent 是否运行，也不将普通适配器或审核流程统一标成 OpenCode 子 Agent。执行类型按 ledger 中的真实 `execution_type` 显示。

## 显示内容

时间线每条记录包含：

- 执行单元名称和真实执行类型；
- 轮次、尝试次数、调用状态和执行摘要；
- 失败原因与 ledger 明确记录的重试安排；
- 非敏感产物 ID、定位和存在性核对结果；
- 开始时间和执行时长。

只有 `visibility=public` 的引用会进入前端时间线；`internal` 和 `secure` 引用都不展示。没有公开产物的调用会明确显示“未公开产物引用”，不使用占位 ID。

## 验证

```bash
bun test src/role-d-ui-v2/src/orchestrator-view.test.ts src/role-d-ui-v2/src/orchestrator-polling.test.ts
bun x tsc -p src/role-d-ui-v2/tsconfig.json --noEmit
bun run role-d:v2:build
```

真实会话对照记录位于 `.tmp/competition-sprint/day6-ux/agent-timeline-explanation.md`。运行产物保留在本机 `.tmp`，不随代码 PR 提交。
