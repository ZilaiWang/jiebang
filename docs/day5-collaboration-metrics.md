# Day 5 Agent 协同指标

`day5:collaboration:export` 只读取至少三份完整主会话 `session.json`，生成角色2 Day 5 的 `agent-collaboration-metrics.json`。

```bash
bun run day5:collaboration:export -- \
  --session=.tmp/path/to/run-1/session.json \
  --session=.tmp/path/to/run-2/session.json \
  --session=.tmp/path/to/run-3/session.json
```

输入必须包含不重复的 `session_id`/`run_id`、事件和追加式 `worker_ledger_history`。至少三组必须真实走到反馈决策；blocked/failed 运行可以作为额外样例保留，但不能代替三组完整运行。

单组协同链只在以下条件全部满足时记为完整：

- 观测到8个预期执行单元；
- 每个执行单元至少有一条 `completed` 记录；
- 每个已完成单元至少有一个 `verified_exists=true` 的真实输出引用。
- session 未进入 blocked，已形成反馈决策，且 ledger 中没有 blocked/failed 记录。

协同完成率的分母是全部输入运行，分子是满足上述条件的运行。`unit_output_coverage_complete` 另行保留“曾完成全部单元与产物覆盖”的事实；后续轮次 blocked 的运行仍不计为整链完成。导出器不读取或输出 secure artifact 内容，也不把描述性路径当成已存在产物。
