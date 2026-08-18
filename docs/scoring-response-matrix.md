# 评分响应说明（scoring-response-matrix）

> 本文档回答一个问题：**赛题的四个评分项，分别靠系统里哪些功能实现、对应哪些证据文件。**
> 评委对照这张表，就能从「评分项」直接跳到「能证明它的文件和运行结果」。

---

## 评分项一 · 作品完整性

**要求**：系统闭环跑通——学习者输入 → 诊断 → 画像 → 路径 → RAG → 资源 → 审核 → 测评 → 反馈 → 决策。

**系统怎么实现**：

| 环节 | 谁做 | 说明 |
|---|---|---|
| 学习者输入 | 主 Agent | 前端收集 learner_request（姓名/背景/目标/自评），发给主 Agent |
| 客观诊断 | 主 Agent + A | 按知识库事实出诊断题，答题后判对错 |
| 画像生成 | B | 三类证据（背景/自评/诊断）合成 LearnerProfile（known/weak/level） |
| 路径规划 | B | 按画像规划学习路径节点（含先修、目标、测评蓝图） |
| RAG 检索 | A | 按目标知识点检索知识库事实（source_id/fact_id） |
| 资源生成 | C | 生成讲义 / 代码实验 / 正式测评，绑定引用 |
| 审核 | C | 事实审核 + 教学审核 + 防重校验，不过不发布 |
| 测评 + 反馈 | 主 Agent | 判分 + 决策（补救/巩固/进阶/重画像） |

**证据文件**：

```text
.tmp/competition-sprint/day1-closed-loop/day1-report.md        （最小闭环跑通，L1 林晓 10/10 → advance）
.tmp/competition-sprint/day4-dynamic-decision/day4-report.md   （四类决策：补救/巩固/进阶/重画像）
.tmp/competition-sprint/day4-dynamic-decision/learner-comparison.md （至少两个学习者走出不同路径）
.tmp/competition-sprint/day5-metrics/day5-report.md            （五组学习者完整跑通）
docs/team_integration_guide.md                                 （闭环链路设计文档）
```

**运行证据**：3号 Day7 用真实模型 + 浏览器走完整流程，动态诊断→画像路径→讲义→Docker 代码运行→五道正式测评→评分，最终 10 分、路径正常完成。

---

## 评分项二 · 技术创新性

**要求**：OpenCode 风格多 Agent 调度、防幻觉、动态决策。

**系统怎么实现**：

| 创新点 | 说明 |
|---|---|
| 多 Agent 调度 | 主 Agent 是「调度者」不是「生成者」，A/B/C 各自负责检索/画像/生成 |
| trace ledger | 记录每个子 Agent 的调用顺序、产物引用、审核决策 |
| 防幻觉 | 生成内容绑定 source_id/fact_id 引用，审核 Agent 能发现「缺引用/引用造假/难度过高」 |
| 修复 + 降级 | 审核失败触发修复，两轮失败触发动态降级 |
| 动态决策 | 测评后四类决策，路径按画像动态变化 |

**证据文件**：

```text
.tmp/competition-sprint/day2-opencode-ledger/day2-report.md    （多 Agent 调度 + ledger 可读性）
.tmp/competition-sprint/day2-opencode-ledger/judge-checklist.md（评委视角检查清单）
.tmp/competition-sprint/day3-anti-hallucination/day3-report.md （防幻觉审核）
.tmp/competition-sprint/day3-anti-hallucination/fact-audit-report.json （事实审核报告）
.tmp/competition-sprint/day3-anti-hallucination/repair-and-downgrade-log.json （修复+降级日志）
docs/orchestrator_runtime_design.md                            （调度器运行设计）
docs/fact_audit_api.md                                         （事实审核 API）
```

**运行证据**：3号 Day7 复查——单条事实不随意扩写，测评题不追问无依据内容，自动审核未发现事实冲突，引用覆盖 100%。

---

## 评分项三 · 用户体验

**要求**：流程清晰、状态可视、资源好读。

**系统怎么实现**：

| 体验点 | 说明 |
|---|---|
| Agent 状态可视 | 前端展示当前/已完成/失败重试的 Agent 状态 |
| 画像可视化 | 展示已掌握/薄弱/目标/依据/冲突（含 RadarChart） |
| 路径可视化 | 展示当前节点/为什么先学它/前置后续/补救节点 |
| 资源好读 | 讲义重点小结、代码实验任务清晰、测评题型区分、引用可查看、错题解释原因 |
| 决策可解释 | 反馈页展示为什么进入补救/巩固/进阶/重画像 |

**证据文件**：

```text
.tmp/competition-sprint/day6-ux/day6-report.md                 （Day6 UX 可解释性报告）
docs/role_d_frontend_guide.md                                  （前端设计文档）
src/role-d-ui-v2/src/orchestrator-view.ts                      （Agent 时间线/路径/为什么学它 组件）
```

**运行证据**：前端 4175 各页面可操作——画像卡片、路径图、讲义/代码实验、测评、反馈决策、协同记录时间线，全流程不黑盒。

---

## 评分项四 · 实用价值

**要求**：多组样例、量化指标、可迁移。

**系统怎么实现**：三组（实际五组）不同画像的学习者样例，配三大量化指标，指标脚本可复跑。

**量化指标（Day5 实测，全部达标）**：

| 指标 | 目标 | 实测 |
|---|---:|---:|
| 幻觉率 | < 5% | **0%**（五组全部无无效引用） |
| 难度适配率 | ≥ 85% | **100%**（五组资源难度 base 正确对应画像 level） |
| 覆盖率 | ≥ 90% | **100%**（五组目标知识点全部覆盖） |

**证据文件**：

```text
.tmp/competition-sprint/day0-precheck/learners.json            （五组学习者样例定义）
.tmp/competition-sprint/day5-metrics/day5-report.md            （实用价值评测报告）
.tmp/competition-sprint/day5-metrics/hallucination-rate.json   （幻觉率指标）
.tmp/competition-sprint/day5-metrics/difficulty-fit.json       （难度适配指标）
.tmp/competition-sprint/day5-metrics/knowledge-coverage.json   （覆盖率指标）
.tmp/competition-sprint/day5-metrics/practical-value-report.md （实用价值报告）
```

---

## 一句话总结

```text
完整性靠「五组闭环跑通」证明，创新性靠「ledger + 防幻觉 + 动态决策」证明，
用户体验靠「前端可视化 + 可解释」证明，实用价值靠「三指标全达标」证明。
四张表 + 对应证据文件，评委可从任意评分项直达证据。
```
