# KnowBalance B 角色画像链说明

面向 A（知识库/RAG）、C（内容生成）、D（展示）：B 角色画像构建链的设计、契约与验证方法。

## 1. 一句话

B 把学习者的自然语言描述变成三份可溯源证据，合成标准画像，产出 A 能直接执行的 rag_request。

```
学习者原话
   ↓ background-collector      背景证据（引文接地）
   ↓ self-assessor             自评证据（引文接地）
   ↓ objective-diagnostician   客观诊断证据（B 选目标，A 供事实，AI 当次命题）
   ↓ profile-builder           合成：证据优先级 + 冲突记录 + level 级联
   ↓
标准画像 {learner_id, level, known_concepts, weak_concepts, goal}
   + 溯源 provenance {level 依据, 概念来源, conflicts, unmapped}
   + semantic_discovery 请求   ← 主 Agent 组装、A 执行
```

## 2. 双轨架构（为什么这样设计）

| 轨 | 位置 | 作用 |
|---|---|---|
| LLM 轨 | `src/role-b-profile/prompts.ts`（经 `src/prompts/worker-stub.ts` 路由） | OpenCode 运行时 4 个 worker 的真实 prompt |
| 确定性轨 | `src/role-b-profile/*.ts` | 合成规则的唯一实现，由持续会话直接调用 |

画像合成、词表规范化和 query 拼接由确定性规则负责。LLM Worker 只负责证据抽取和语义建议，不改写画像优先级、来源身份或检索合同。持续会话直接调用 `synthesizeProfile` 和路径、检索适配器。

## 3. 三份证据契约

类型定义见 `src/role-b-profile/types.ts`，样例见 `examples/learner_evidence_loop_weak.json`。正式交互中，B 选择要诊断的目标/先修/历史薄弱来源，A 提供对应事实，AI 当次生成题面与服务端答案。

共同纪律（画像层防幻觉，与 A 的 source_id/fact_id 红线对称）：
- 每个非空字段必须有学习者原话 quote 支撑（`quotes[]`）
- 无证据的字段置 null / 空数组，禁止编造
- 诊断题必须引用真实 A source_id/fact_id；没答的题 verdict=unanswered，不虚构判分

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

## 5. B → 检索层交接契约

初始画像检索入口为 `src/role-b-profile/rag-bridge.ts`，通过统一的 `LearningEvidenceRequest` 执行 `semantic_discovery`。

- query 四段格式（全组契约，联调说明 §7）：`学习者水平：…；已掌握：…；薄弱点：…；学习目标：…`，空数组写"无"
- top_k=5（初始目标发现的检索策略值）
- 画像结构对 `schemas/rag_request.schema.json` 的对齐由测试直接读 schema 文件断言——A 改契约时 B 的测试自动报警

B 冻结正式路径节点后，主 Agent 组装 `identity_hydration` 请求，A 按节点 `source_id`、`fact_id` 和资源需求取证。路径重规划重新执行目标发现；C 的证据缺口使用 `evidence_repair`。

## 6. 运行与验证

```bash
bun run check                              # typecheck + 全部测试
bun src/role-b-profile/profile-demo.ts     # B 链端到端 demo（无需模型凭证）
```

`tests/role-b-profile.test.ts` 验证画像合同、query 语义和成绩统计目标的相关知识召回；`tests/learning-evidence-retrieval.test.ts` 验证检索模式、目标覆盖、弱匹配和结果血缘。

## 7. 与 C / D 的交接

- C：正式模型输入消费 `rag_result` 中的 facts/examples/practiceTasks，画像里的 `goal` 与 `weak_concepts` 决定内容侧重
- D：除画像外请展示 `provenance.conflicts`（自评 vs 客观的矛盾及裁决理由）与 `provenance.level.rule`——这是"系统判断透明化"的展示素材，评委关注点
- 画像 JSON 的字段与 `examples/learner_*.json` 完全同构，D 现有消费逻辑无需改动

## 8. 当前边界

1. level 上调只接受“至少 3 道全部答对、最多上调一档”的保守信号。
2. B 只选择诊断来源；AI 题面必须有 A 的事实覆盖。没有可用事实时会话阻塞，不补入无关来源。
3. 未答诊断题保持 `unanswered`，不推断学习者答案或正确性。
4. 概念规范化使用知识库词表；未映射概念保留在 `unmapped_concepts`，不静默删除。

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
