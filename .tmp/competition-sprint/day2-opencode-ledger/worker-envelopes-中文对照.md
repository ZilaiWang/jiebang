# 调度调用顺序 · 中文对照版（Day2 4号 制作）

> 原始数据：worker-envelopes.jsonl（英文 JSON）
> 本表为评委可读版本：把看不懂的字段翻译成中文，供演示/报告直接引用。

## 调用顺序（14 步）

| # | 执行单元 | 执行类型 | 状态 | 阶段 | 尝试 | 产物引用 | 人工介入 |
|---|---|---|---|---|---|---|---|
| 1 | 背景采集（读取学习者档案） | 会话逻辑（主Agent固定步骤，非子Agent） | completed | objective_diagnosis | 1 | 无 | 是 |
| 2 | 自我评估（学习者自评） | 会话逻辑（主Agent固定步骤，非子Agent） | completed | objective_diagnosis | 1 | 无 | 是 |
| 3 | 客观诊断（出题与判定） | 会话逻辑（主Agent固定步骤，非子Agent） | waiting_for_user | objective_diagnosis | 1 | 无 | 是 |
| 4 | 客观诊断（出题与判定） | 会话逻辑（主Agent固定步骤，非子Agent） | completed | objective_diagnosis | 1 | 无 | 是 |
| 5 | 画像合成（Role B） | 固定程序适配（按规则运行的模块，非子Agent） | running | objective_diagnosis | 1 | 无 | 是 |
| 6 | 画像合成（Role B） | 固定程序适配（按规则运行的模块，非子Agent） | completed | objective_diagnosis | 1 | 无 | 是 |
| 7 | 路径规划（Role B） | 固定程序适配（按规则运行的模块，非子Agent） | running | objective_diagnosis | 1 | 无 | 是 |
| 8 | 路径规划（Role B） | 固定程序适配（按规则运行的模块，非子Agent） | completed | objective_diagnosis | 1 | 无 | 是 |
| 9 | 概念讲师（Role C 生成讲义） | 审核流水线（Role C 生成→审核链路） | running | objective_diagnosis | 1 | 无 | 是 |
| 10 | 代码实验（Role C 生成） | 审核流水线（Role C 生成→审核链路） | skipped | objective_diagnosis | 1 | 无 | 是 |
| 11 | 分阶测评（Role C 生成与评分） | 审核流水线（Role C 生成→审核链路） | skipped | assessment | 1 | 无 | 是 |
| 12 | 概念讲师（Role C 生成讲义） | 审核流水线（Role C 生成→审核链路） | completed | objective_diagnosis | 1 | 无 | 是 |
| 13 | 代码实验（Role C 生成） | 审核流水线（Role C 生成→审核链路） | completed | objective_diagnosis | 1 | 无 | 是 |
| 14 | 分阶测评（Role C 生成与评分） | 审核流水线（Role C 生成→审核链路） | completed | assessment | 1 | 无 | 是 |

## 术语速查

| 英文 | 中文 | 是否子Agent |
|---|---|---|
| session_logic | 会话逻辑：主Agent自己的固定步骤（建档/收答案） | 否 |
| deterministic_adapter | 固定程序适配：按规则运行的模块（画像合成/路径规划） | 否 |
| reviewed_pipeline | 审核流水线：Role C 生成→独立审核 的完整链路 | 是（含审核环节） |
| envelope | 信封：每个执行单元的完整包装（输入/输出/状态/错误） | — |
| output_ref_ids | 产物引用ID，对应 artifact-map.json 里的实际文件 | — |

> 来源：真实运行 session SESSION-f98d9809（14 条 ledger 历史）
