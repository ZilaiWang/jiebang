# 评测可靠性 V3

V3 保留 60 例冻结合同和三项正式指标，补充失败归因、证据漏斗、阶段恢复与分级放量。基础设施错误、内容质量错误和审核未完成分别记录，未运行及未审核样例始终留在完整性分母中。

## 执行顺序

```bash
# 零费用：60 例接线、合同、Docker 及固定样例选择
bun run eval:v2:preflight -- --output-dir=.tmp/eval-v3-preflight
bun run eval:v2:select -- --output-dir=.tmp/eval-v3-preflight
bun run docker:role-c:doctor

# Gate 1：固定 beginner/explain、intermediate/debug、integrated/create
bun scripts/competition-evaluation-v2.ts run --dev --gate=canary --self-audit \
  --output-dir=.tmp/eval-v3-canary

# Gate 2：覆盖六类画像、五种行为、四档难度的固定 12 例
bun scripts/competition-evaluation-v2.ts run --dev --gate=balanced12 --self-audit \
  --output-dir=.tmp/eval-v3-balanced12

# Gate 3：同一干净提交上的 60×1；先完成 manifest 复核冻结和评审校准
bun run eval:v2:final -- --self-audit --gate-evidence=.tmp/eval-v3-balanced12/latest.json \
  --calibration-evidence=evaluation/judge-calibration.v1.json \
  --output-dir=.tmp/eval-v3-formal60
```

`--self-audit` 表示同一模型的独立调用，报告标为 `same_model_separate_calls`，不声称跨模型验证。配置独立评审模型后可去掉该参数。两种模式都记录身份与配置哈希，且不会把冻结的标准难度传给评审调用。

可用 `--env-file=/path/to/local.env` 指定本机配置。密钥和原始运行数据不提交仓库。三种 Gate 均执行一轮；固定选择不受 `--limit` 改变。

## 恢复规则

- `--resume` 复用已保存结果；进程中断留下的运行中记录使用 `--resume --retry-infrastructure` 继续。
- Provider、网络、证书、额度或持久化问题处理完成后，增加 `--retry-infrastructure`；内容质量失败不会被顺带重试。
- 已发布资源的事实或难度评审中断时，增加 `--retry-audits`；资源生成与 Docker 结果保持不变。
- 源码、Prompt、模型配置或冻结合同变化会改变协议 ID，必须使用新输出目录重新从 Gate 1 开始；知识事实或能力元数据变化后重新复核 manifest，旧证据保留原版本。

每次生成完成后即保存公开资源，每批最多 12 条事实审核与每一类难度审核分别落盘，JSON 使用原子替换避免中断留下半个文件。C 内部原有的资源级 checkpoint 继续负责讲义、实验和测评的局部恢复。

事实审核最多并行两个独立批次，三类资源的难度审核可并行执行；所有调用仍受统一模型调度器限制。每个事实批次完成后立即写入案例记录，任一批次失败不会丢弃同组已经付费完成的审核结果。

## 通过标准

金丝雀要求 3/3 全链路、9/9 资源、审核完整率和 Docker 到达率均为 100%；独立审核的负面结论保留计分，不要求零扣分。平衡 12 例及正式 60 例还要求幻觉率低于 5%、难度适配率至少 85%、核心知识覆盖率至少 90%。`latest.json` 同时给出 `gate` 和 `scorecard`，后者包含阶段到达率、最早失败位置、P50/P95 时延及失败类别。

平衡集保留审核完整的质量负面记录，按完整分母计算指标；出现证据不完整则停止放量。`operational.ready` 记录 C 生产审核已发布，`scorecard.publication_ready` 还要求独立复核通过，两者分别展示。模型调用、token 和重试统计保存在 `model-usage.json`，未配置实际单价时不估造费用。

## 校准与辅助集

校准使用独立于正式 60 例的 24 份已复核资源：四档难度 × 三类资源 × 每格两份。每行包含 `resource_id/resource_hash/artifact_kind/expected_difficulty/predicted_difficulty/reviewer/holdout`。输入文件为 `{rows, judge_model, judge_config, rubric_hash}`，后三项对应实际评审运行；用以下命令生成准确率和分类混淆矩阵：

```bash
bun scripts/competition-evaluation-v2.ts calibration --input=/path/to/calibration.json \
  --output-dir=.tmp/eval-v3-calibration
bun scripts/competition-evaluation-v2.ts robustness --output-dir=.tmp/eval-v3-robustness
```

已有冻结的校准资源正文时，使用 `calibration-run --input=/path/to/resources.json --self-audit --env-file=/path/to/local.env --output-dir=.tmp/eval-v3-calibration` 直接调用真实评审模型。输入是资源数组，在上述复核字段基础上提供 `title/content`，不提供预测值；标准难度不传给模型。每份结果单独保存，中断后加 `--resume`，保留已经完成的负面判断。

校准总体准确率要求至少 85%。只有带模型与 rubric 绑定信息的校准结果可用于正式运行；只传行数组可检查数据，但不能代替正式资格证据。使用一名明确记录的复核者即可。

仓库内的 `evaluation/judge-calibration.v1.json` 是已通过复核并绑定 `glm-5.2`、当前评审配置、难度判定器版本与当前 rubric 的正式校准证据。更换评审模型、评审配置、判定逻辑或 rubric 后必须重新运行校准并更新该文件，不能沿用旧资格证据。

Query 鲁棒性和现有 12 条动态轨迹独立输出，不并入首轮 180 份资源的指标分母。
