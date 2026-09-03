# 评测结果目录

当前正式口径为 Evaluation Reliability V3：固定金丝雀 3 例、平衡开发集 12 例、冻结正式集 60×1。完整协议与恢复规则见 [`docs/evaluation-v3/RUNBOOK.md`](../../docs/evaluation-v3/RUNBOOK.md)。本目录只保存需要随仓库发布的说明；真实运行产物写入 `.tmp`，其中可能含模型生成内容，不提交仓库。

真实模型评测会把以下可审计文件写入命令指定的 `.tmp` 输出目录：

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
# 固定 3 例金丝雀
bun run eval:competition:dev -- --self-audit --output-dir=.tmp/eval-v3-canary

# 平衡 12 例
bun run eval:competition:balanced12 -- --self-audit --output-dir=.tmp/eval-v3-balanced12

# 正式评测（冻结 60×1；要求同一提交上的平衡集证据与评审校准证据）
bun run eval:competition:final -- --self-audit \
  --gate-evidence=.tmp/eval-v3-balanced12/latest.json \
  --calibration-evidence=evaluation/judge-calibration.v1.json \
  --output-dir=.tmp/eval-v3-formal60
```

脚本直接运行真实主 Agent 流水线、Docker 与逐声明/逐资源评审，再计算三项指标。任何 Gate 未通过均以非零码退出；报告始终保留完整分母、未运行数、失败归因和协议哈希，不能只引用百分比。
