# Day 4 动态决策调度证据

本工具链从全新持续会话生成 Day 4 多轮输入，并把系统真实产生的测评反馈、四路动作和下一轮执行导出为 `decision-ledger.jsonl`。

## 运行前提

先按 `docs/orchestrator_session_api.md` 启动本地持续会话 API。真实模型配置和 Docker Runner 必须就绪；运行器不会读取、输出或复制 API key。

## 生成全新多轮实例

```bash
bun run day4:multiround:run -- \
  --base-url=http://127.0.0.1:8787 \
  --timeout-ms=300000
```

运行器每次默认创建新的 learner、run 和 session。它完成首轮诊断，使用公开题面构造合法的低分倾向测评提交，并等待系统自己产生 `remediate / reinforce / advance / reprofile`。随后继续一次真实下一轮调用，保存：

- `decision-session.json`：feedback 和 `next_round_action` 已持久化时的公开快照；
- `final-session.json`：下一轮生成结束后的公开快照；
- `events.json`：同一 session 的公开事件；
- `run-summary.json`：不含私有答案的运行摘要。

模型、网络或审核失败必须保留为真实失败，不得降低审核标准或手工改写 session。若需重试，应重新运行命令创建新 session。

## 导出 ledger

```bash
bun run day4:decision:export -- \
  --run-dir=.tmp/competition-sprint/day4-dynamic-decision/runs/<SESSION_ID>
```

默认输出到 `.tmp/competition-sprint/day4-dynamic-decision/decision-ledger.jsonl`。导出器会拒绝以下输入：

- 三份证据的 session ID 不一致；
- feedback 与 `next_round_action` 的 ID 或动作不一致；
- 决策之后没有观察到下一轮真实事件；
- 决策前后没有新增的 `worker_ledger_history` 调用记录；
- 仅有测试夹具或手工声明、没有公开 session/events 的输入。

下一轮被审核阻塞时，ledger 会保留 `blocked` 和限制说明，不能写成成功发布。运行证据位于被 Git 忽略的 `.tmp/`，不得把私有 session 或 secure artifact 加入 PR。

`next_round_execution.units`直接来自决策前后`worker_ledger_history`的增量，记录执行单元名称、真实执行类型、状态和产物引用。`reviewed_pipeline`、adapter与外部端口必须保持原类型，不得改写成OpenCode subagent。
