# OpenCode 证据可读性问题清单（Day2 · 4号 验收产物）

验收时间：2026-08-13
验收人：4号（评委视角）
验收对象：`opencode-run.json` + `worker-envelopes.jsonl` + `artifact-map.json`

## 一、评委能看懂的部分 ✅

| 问题 | 判定 | 依据 |
|---|---|---|
| 能看出主 Agent 是谁？ | ✅ | `main_agent: learning-orchestrator`，字段名直观 |
| 能看出调用顺序？ | ✅ | `call_sequence[].sequence_index` 从 1 递增，顺序清楚 |
| 能看出执行状态？ | ✅ | `status: completed/running/failed` 直白 |
| 能看出失败处理？ | ✅ | `error_codes` + `checks.blocked_or_failed_entries_preserved` |
| 能看出诚实边界？ | ✅ | `runtime_truth.statement` 明确说"未观测到 OpenCode task ID" |

## 二、评委看不懂的字段（需要中文说明）❌

| # | 字段 | 出现位置 | 评委困惑 | 中文说明 |
|---|---|---|---|---|
| 1 | `execution_type: session_logic` | call_sequence / envelope | "这是什么？是子Agent吗？" | 会话逻辑：主Agent自己的固定步骤（建档、收答案），**不是**子Agent |
| 2 | `execution_type: deterministic_adapter` | 同上 | "这又是啥？" | 固定程序适配：按规则运行的模块（画像合成、路径规划），**不是**子Agent |
| 3 | `execution_type: reviewed_pipeline` | 同上 | "审核流水线？" | 审核流水线：Role C 生成→审核的完整链路，**有独立审核环节** |
| 4 | `unit_name: background-collector` | call_sequence | "background 是什么？" | 背景采集：读取学习者档案的步骤 |
| 5 | `unit_name: profile-builder` | 同上 | "谁建的画像？" | 画像合成（Role B 职责） |
| 6 | `unit_name: path-planner` | 同上 | "谁规划的路径？" | 路径规划（Role B 职责） |
| 7 | `output_ref_ids` | call_sequence | "产物在哪？找不到文件" | 产物引用ID，对应 artifact-map.json 里的实际文件 |
| 8 | `attempt_no` | call_sequence | "啥意思？" | 第几次尝试（1=首次，2=重试） |
| 9 | `manual_intervention` | call_sequence | "人工介入？" | 是否需要学习者人工操作（如答题）；真实值见对照表（仅"等待答题"那步为是） |
| 10 | `envelope`（文件名） | worker-envelopes.jsonl | "envelope 是什么？" | 信封：每个执行单元的完整包装（输入/输出/状态/错误） |
| 11 | `schema_version: 1.0` | 各文件 | "版本？" | 字段格式版本号，评委可忽略 |
| 12 | `entry_id`（超长字符串） | call_sequence | "这一长串是啥？" | 唯一记录ID（会话+单元+时间），可忽略 |

## 三、缺失的中文说明（建议补充）

1. **worker-envelopes.jsonl 没有中文表头/说明文件**——评委打开全是英文 JSON。
2. **三个 execution_type 没有中文定义**——这是"是否真多Agent"的关键证据，评委看不懂会误判。
3. **产物文件散在多个目录**，没有一张"字段→中文"对照表。

## 四、改进建议（4号 处理）

1. ✅ 生成《字段中文说明对照表》（本清单已含，可作为对照表使用）
2. 建议 2号 在 opencode-run.json 顶部加 `note_cn` 字段写一句中文总述
3. 建议 3号 在 artifact-map.json 加 `agent_label_cn`（如 concept-tutor → 概念讲师）

## 五、验收结论

```text
可读性：主Agent ✅ / 顺序 ✅ / 状态 ✅ / 失败处理 ⚠️（有字段但术语英文）/ 产物 ⚠️（需对照表）
核心问题：execution_type 三个英文术语无中文解释，评委无法区分"真子Agent vs 固定程序"
处理：本清单即中文说明对照表，随 day2-report 一并交付；代码层中文说明建议 Day7 前由 2/3号 补
```
