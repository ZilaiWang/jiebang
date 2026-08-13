# 学习证据检索接口

学习证据层根据课程所处阶段选择语义发现或标识取证，并为每次结果保留独立身份、请求哈希和父级血缘。统一入口位于 `src/rag/learning-evidence.ts`。

## 检索模式

| 模式 | 使用时机 | 输入依据 | 结果要求 |
|---|---|---|---|
| `semantic_discovery` | 初始目标映射、重新画像、路径重规划 | 画像、学习目标、薄弱点、当前学习语义 | 发现相关 `source_id`，无关目标不得因难度相近进入结果 |
| `identity_hydration` | B 已冻结当前路径节点 | 节点 `source_id`、`fact_id`、目标和资源需求 | 精确取得当前节点目标、先修、事实、示例和练习资源 |
| `evidence_repair` | C 报告事实或资源缺口 | 原目标身份、缺失来源、缺失事实和资源类型 | 形成新的证据结果并保持原 `objective_id` |

主 Agent 负责组装 `LearningEvidenceRequest`；B 提供画像和路径，A 执行查询编译与检索，C 通过 `EvidenceGapRequest` 声明缺口。每轮检索创建新的结果，旧结果仅作为 `parent_retrieval_id`，不追加或改写旧检索轨迹。

## TypeScript 调用

```ts
import {
  buildLearningEvidenceRequest,
  retrieveLearningEvidence,
} from "./src/rag/learning-evidence"

const request = buildLearningEvidenceRequest({
  run_id: "RUN-001",
  retrieval_mode: "identity_hydration",
  learner_profile: {
    profile_version: "PROFILE-V1",
    level: "beginner",
    known_concepts: [],
    weak_concepts: ["循环"],
    goal: "完成成绩统计程序",
  },
  path_context: currentPathNode,
  learning_context: {
    action: "advance",
    focus_objective_ids: currentPathNode.objectives.map(item => item.objective_id),
    misconception_tags: [],
    reason_codes: ["path_node_activated"],
  },
  resource_needs: ["fact", "prerequisite", "example", "practice_task"],
  top_k: 3,
})

const result = await retrieveLearningEvidence(request)
```

## 结果语义

输出符合 `schemas/rag_result.schema.json`，主要字段如下：

- `retrieval_id`：本次检索结果的稳定身份；
- `retrieval_context`：请求 ID、请求哈希、模式、父级检索和本轮资源需求；
- `match_status`：整包状态，取值为 `strong`、`weak`、`no_match`；
- `objective_coverage`：每个目标的来源、必要事实、可用事实、缺失事实和原因；
- `results`：事实、示例、练习任务、内部题目素材与原始检索轨迹。

`strong` 要求全部目标的来源、必要事实和本轮所需资源齐全，且先修来源存在。缺少部分材料时为 `weak`，没有相关来源时为 `no_match`。难度只参与已相关候选的排序，不产生语义命中。

## C 的使用约束

`concept-tutor`、`code-lab`、`tiered-evaluator` 只消费当前证据包中的 `facts`、`snippet`、`examples` 和 `practiceTasks`。每条知识性陈述绑定当前包内的 `source_id` 与 `fact_id`。`quizItems` 只作为内部知识素材，诊断题和正式测评题由 AI 根据当前事实当次命制。
