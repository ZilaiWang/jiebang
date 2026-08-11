# KnowBalance B 角色画像链说明

面向 A（知识库/RAG）、C（内容生成）、D（展示）：B 角色画像构建链的设计、契约与验证方法。

## 1. 一句话

B 把学习者的自然语言描述变成三份可溯源证据，合成标准画像，产出 A 能直接执行的 rag_request。

```
学习者原话
   ↓ background-collector      背景证据（引文接地）
   ↓ self-assessor             自评证据（引文接地）
   ↓ objective-diagnostician   客观诊断证据（题目来自知识库 quizItems，带 source_id）
   ↓ profile-builder           合成：证据优先级 + 冲突记录 + level 级联
   ↓
标准画像 {learner_id, level, known_concepts, weak_concepts, goal}
   + 溯源 provenance {level 依据, 概念来源, conflicts, unmapped}
   + rag_request {learner_profile, query, top_k}   ← B→A 交接物
```

## 2. 双轨架构（为什么这样设计）

| 轨 | 位置 | 作用 |
|---|---|---|
| LLM 轨 | `src/role-b-profile/prompts.ts`（经 `src/prompts/worker-stub.ts` 路由） | OpenCode 运行时 4 个 worker 的真实 prompt |
| 确定性轨 | `src/role-b-profile/*.ts` | 合成规则的唯一可验证实现，供脚本/测试/未来工具层调用 |

为什么必须双轨：worker 被注册为无工具无权限的 subagent（`tests/agent-registry.test.ts` 强制），orchestrator 只有 task+question——运行时没有任何环节能执行代码。画像合成、词表规范化、query 拼接这类无判断空间的逻辑交给 LLM 只会引入不确定性，所以确定性轨才是事实源；LLM 轨的 prompt 内嵌同一套规则文本（软约束）。联调阶段应把 `synthesizeProfile` + `retrieveKnowledge` 封装为 orchestrator 可调用的工具层，彻底消除两轨漂移——这与联调说明 §13 对 RAG 工具化的预告是同一件事。

## 3. 三份证据契约

类型定义见 `src/role-b-profile/types.ts`，样例见 `examples/learner_evidence_loop_weak.json`（诊断题为知识库真实 quizItems，非虚构）。

共同纪律（画像层防幻觉，与 A 的 source_id/fact_id 红线对称）：
- 每个非空字段必须有学习者原话 quote 支撑（`quotes[]`）
- 无证据的字段置 null / 空数组，禁止编造
- 诊断题必须引用真实 quizItems 的 source_id/fact_id；没答的题 verdict=unanswered，不虚构判分

## 4. 合成规则（每条带理由）

| 规则 | 内容 | 为什么 |
|---|---|---|
| 证据优先级 | objective(3) > self(2) > background(1)，强者覆盖 | 客观测试噪声最小；自评常过度自信或过度悲观 |
| 冲突显式记录 | 自评与客观矛盾 → 按优先级裁决 + 写入 `provenance.conflicts` | 不静默消化；D 可展示"系统为何这样判"，对齐 A 的 retrieval_trace 透明化 |
| 同强度 weak 优先 | 同来源既说会又说不会 → weak | 漏诊代价 > 多补课代价（不对称） |
| level 保守更新 | 答错难度 d → 封顶 d 前一档（floor beginner）；至少 3 道客观题全部答对时，可在自评基础上最多上调一档且不超过已覆盖难度；其余情况用自评；全无默认 beginner | 答错仍是强信号；多题全对也应能纠正过低自评，但单轮不能跨级过猛 |
| goal 红线 | goal 缺失直接报错/blocked，让 orchestrator 用 question 补问 | schema 要求 goal 非空；编造目标会污染检索与教学 |
| 词表规范化 | 概念全部过 canonicalizer 映射到知识库 keywords/title | A 的检索器按 keyword 子串打分，词表外概念检索得 0 分 |

### 词表规范化的匹配优先级

`src/role-b-profile/concept-canonicalizer.ts`，词表 100% 来自 `loadKnowledgeBase()`，零硬编码：

1. exact——短语就是词表词（"循环"）
2. 短语含词——取权重最大者（"for循环写不来"→"for 循环"，更长≈更具体）
3. 词含短语——取权重最小者（防过度特化："循环"若被"while 循环"抢走，学习者答错的却是 for 循环题——此规则被 demo 实跑暴露的 bug 逼出）

中文字符按 2 计权，防止"for"(3 字母)压过"循环"(2 字)。未命中概念原样保留并进 `provenance.unmapped_concepts`——不丢学习者信号，D 可提示扩库（按协作指南 §10 向 A 开 issue）。

已知边界：同一知识点的不同 keyword（K009 的"列表"/"一组数据"）不互相合并，检索端无损；建议 A 后续把检索器内部的 SYNONYMS 表导出共享，B 可直接复用。

## 5. B → A 交接契约

出口唯一：`src/role-b-profile/rag-bridge.ts`。

- query 四段格式（全组契约，联调说明 §7）：`学习者水平：…；已掌握：…；薄弱点：…；学习目标：…`，空数组写"无"
- top_k=5（B→A 检索请求的后端策略值，与已下线的旧 D 无关）
- 画像结构对 `schemas/rag_request.schema.json` 的对齐由测试直接读 schema 文件断言——A 改契约时 B 的测试自动报警

## 6. 运行与验证

```bash
bun run check                              # typecheck + 全部测试（含 B 的 17 个）
bun src/role-b-profile/profile-demo.ts     # B 链端到端 demo（无需模型凭证）
```

验收对照（联调说明 §6 "B 能拿到 K007/K009/K018 等相关知识点"）：
demo 实跑检索 top5 = K018(50) / K009(43) / K007(41) / K006(28) / K002(15)，
且 `tests/role-b-profile.test.ts` 的 acceptance 测试固化了该标准。

## 7. 与 C / D 的交接

- C：只消费 `rag_result`（facts/examples/practiceTasks/quizItems），画像里的 `goal` 与 `weak_concepts` 决定内容侧重
- D：除画像外请展示 `provenance.conflicts`（自评 vs 客观的矛盾及裁决理由）与 `provenance.level.rule`——这是"系统判断透明化"的展示素材，评委关注点
- 画像 JSON 的字段与 `examples/learner_*.json` 完全同构，D 现有消费逻辑无需改动

## 8. 当前限制与下一步

1. LLM 轨与确定性轨的一致性目前靠 prompt 软约束——下一步在工具层封装 `synthesizeProfile`+`retrieveKnowledge`，orchestrator 直接调用（与联调说明 §13 同方向）
2. 当前 level 上调只接受“至少 3 道全部答对、最多上调一档”的保守信号；Week 2 可按分层通过率和题目覆盖度进一步校准
3. 交互式诊断（question 工具中转追问）未实现——当前按 headless 场景设计，未答题诚实标 unanswered
4. 概念同义词依赖 A 检索器内部 SYNONYMS——建议 A 导出共享（已列入协作事项）

## 9. Week 2 教学审核与仲裁（新增）

B 角色 Week 2 主线：对 C 生成的教学内容进行教学规范性审核，并与 A 的事实审核结果合并仲裁。

### 审核维度

| 维度 | 检查内容 | 不通过后果 |
|---|---|---|
| 难度匹配 | 教学内容最高难度 ≤ 学习者水平 +1 档 | reject（根本性不匹配） |
| 前置知识 | 每个知识点的前置知识已被学习者掌握或在教学批次内 | reject（缺基础无法教） |
| 薄弱点覆盖 | 学习者的薄弱点至少有一个被教学覆盖 | revise（可调整内容选择） |
| 目标对齐 | 教学内容的关键词与学习目标有交集 | revise（可调整内容方向） |

### 仲裁规则

- 事实审核（A）与教学审核（B）任一 reject → 驳回
- 任一 revise → 需修订（最多 2 轮）
- 双 pass → 通过
- 超过 2 轮修订仍 revise → 转为 reject

### 代码位置

- `src/role-b-profile/teaching-audit/types.ts` — 类型定义
- `src/role-b-profile/teaching-audit/auditor.ts` — 教学审核器
- `src/role-b-profile/teaching-audit/arbitrator.ts` — 仲裁机制
- `tests/role-b-teaching-audit.test.ts` — 23 项契约测试
- `scripts/teaching-audit-demo.ts` — 四种场景演示

### 运行验证

```bash
bun test tests/role-b-teaching-audit.test.ts   # 23 tests
bun scripts/teaching-audit-demo.ts               # 双通过/驳回/修订/仲裁上限
```
