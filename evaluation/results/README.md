# 评测结果目录

真实模型评测会把以下可审计文件写入本目录：

- `claims.json`：逐声明事实审核结果（claim_id / verdict / supported_fact_ids / reason）
- `difficulty-audits.json`：每份生成资源的难度分类结果（predicted_difficulty / reasons）
- `latest.json`：`computeCompetitionMetrics` 的机器可读正式报告（含分子/分母与门禁）
- `latest.md`：人类可读的指标报告
- `protocol.json`：代码、模型、提示词、知识库、manifest 与 rubric 的冻结身份
- `runs/repeat-N/*.json`：每次运行的案例级公开产物、证据和审核结果
- `manual-audit-template.csv`：12 例分层人工复核模板
- `manual-audit.csv`：两名复核者填写并裁决后的正式人工复核结果（脚本不会覆盖）
- `showcase-comparison.*`：同目标三画像对比材料
- `judge-usage.json`：独立评审模型调用记录（不含密钥）

运行方式：

```bash
# 开发自检（12 例）
bun run eval:competition:dev

# 正式评测（60 例 × 2 次，门禁断言）
bun run eval:competition:final
```

脚本会直接运行真实主 Agent 流水线、Docker 与独立评审器，再计算三项指标。
`--assert-gates` 未通过时以非零码退出。正式成绩必须同时保留分子、分母、
协议哈希和两名成员完成的人工复核，不能只引用百分比。
