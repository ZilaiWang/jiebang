# Learning Orchestrator Runtime Design

> **实现状态标注（2026-08-08）**：本文是 Runtime 的**设计基线文档**（设计目标/验收标准），描述的是 runner + 13 态状态机的全量编排路径。当前代码的实际实现已在此设计上演进，阅读时请以代码为准：
>
> - **两条运行路径并存**：一次性 runner（`learning-orchestrator-runner.ts`，scaffold/deterministic 双模式，13 态状态机，用于演示与验收）+ **持久交互会话**（`interactive-session.ts`，HTTP 8787，**当前开发重心与 D 的实际接入路径**）。
> - **交互会话的阶段机简化**：不是 13 态线性转移，而是 `objective_diagnosis → assessment → (completed|blocked|failed)` 的循环；`ORCHESTRATION_WORKER_SEQUENCE` 中的 profile-builder / path-planner 在诊断后被直接调用（`slice(3,5)`），C 内容生成走 `generateFormalRoleCRound`（最多 6 次尝试，独立 `roleCRoundRunId`）。
> - **评分四路决策**：remediate / reinforce / advance / reprofile（阈值 0.4 / 0.8），下一轮内容**后台生成**（提交响应先返回 feedback，会话置 `running`，前端轮询），会话可跨服务重启恢复（`retry` + 持久化 `next_round_context`）。
> - **锚点路由已彻底移除**：`submit_anchor_answers` 命令、`anchor_routing`/`anchor_answers` 字段、`continueAfterAnchorAnswers`/`mergeAnchorAnswers` 等函数及 UI 客户端函数全部删除；正式测评直接按 B 初始画像生成。
> - **A 证据随节点推进**：`ensureCurrentNodeEvidence` 在每轮 C 生成前按当前节点 target/先修从知识库按 source_id 补全缺失证据，advance 到新节点不再因首轮 RAG 快照缺证据而阻塞。
> - **测评结构升级**：五题 code-pair（mcq + true_false + trace + code 2 分 + code 4 分），不再含 `short_answer`；新增 `run_assessment_code` 即时试运行命令与 `code_execution` 公开字段。
> - **旧会话自动迁移**：`GET /sessions/:id` 触发 `repairLegacyAssessment`，检测到 short_answer 或资源目标漂移时后台重新生成。
> - **补救/强化差异合同全段生效**：`projectNextRoundContext` 不再因某段无 focus 目标而丢弃差异指令，teaching_strategy + variation_requirements 作用于整轮所有段。
> - **reprofile 触发链路修复**：画像预期按 B 画像 known/weak_concepts 映射（`profileExpectationForTarget`）；`profile_version` 跨轮稳定（`<run_id>-profile-E<epoch>`，reprofile 后 epoch+1）；`profile_drift_minimum_conflicts=1` 适配每节点单 objective——reprofile 从"永不触发的死代码"变为可触发的画像校正。
> - 交互会话仅接受 `deterministic` 模式（scaffold 模式被 `orchestrator-api-schema.ts` 明确拒绝）。
>
> 交互会话的 HTTP API、公开字段与命令详见 [`orchestrator_session_api.md`](./orchestrator_session_api.md)。

## 1. 核心结论

KnowBalance 已经注册 `learning-orchestrator` 主 Agent 和 8 个角色子 Agent，但当前可复现业务链路主要由 TypeScript service、demo 和 test 直接串联。为了让系统从“有主 Agent 名义”升级为“主 Agent 真实可审计编排”，需要新增一层 **Learning Orchestrator Runtime**。

这层 Runtime 的目标不是重写 A/B/C/D 业务，而是让 `learning-orchestrator` 承担以下可验证职责：

1. 管理完整学习流程状态。
2. 决定下一步应该调用哪个子 Agent。
3. 将上游证据和产物传递给下游子 Agent。
4. 校验每个子 Agent 的输出契约。
5. 在失败时进入 blocked / failed，而不是跳步或代做。
6. 生成可审计 trace ledger 和 Markdown 汇报。
7. 支持 scaffold 与 deterministic 两种运行模式，分别证明“主 Agent 调度结构”和“主 Agent 接入真实业务链路”。

## 2. 现状判断

### 2.1 已有内容

当前仓库已经具备：

- `src/agents/orchestrator.ts`：主 Agent 注册。
- `src/prompts/orchestration.ts`：主 Agent 的顺序调度 prompt。
- `src/agents/workers.ts`：8 个 worker 定义。
- `tests/agent-registry.test.ts`：验证 1 primary + 8 subagents。
- `src/role-b-profile/`：B 画像链路真实实现。
- `src/role-c-content/`：C 概念、代码实验、测评、审核恢复等真实实现。
- `src/role-d-integration/` 与 `src/role-d-ui-v2/`：主 Agent边界适配与新版 D展示。
- `scripts/learning-orchestrator-api.ts`：主 Agent持续会话 HTTP 服务入口。
- `scripts/role-c-week3-evaluation.ts`：Week3 评测脚本。

### 2.2 主要缺口

当前缺口不是“没有主 Agent”，而是：

| 缺口 | 影响 |
|---|---|
| 主 Agent 运行态不可见 | 看不到它如何逐步管理 8 个子 Agent |
| 没有统一 orchestration session | 缺少跨步骤状态、run_id、current_stage 和错误状态 |
| 缺少子 Agent 统一输入输出契约 | 不容易证明每一步由主 Agent 调度并验收 |
| 缺少 trace ledger | 答辩时缺少逐步调用证据 |
| 缺少失败恢复记录 | 子 Agent blocked 时难以证明主 Agent 做了正确处理 |
| OpenCode 原生路径依赖模型稳定性 | 难以作为唯一可复现验收依据 |

## 3. 设计目标

### 3.1 必须达到

1. 一次运行有唯一 `run_id` 和 `session_id`。
2. 每个阶段只能按照状态机合法转移。
3. 每个子 Agent 调用前，主 Agent 写入决策记录。
4. 每个子 Agent 返回后，主 Agent 校验 worker、stage、status、marker、artifacts、next。
5. 每一步都写入 JSONL trace。
6. 完成后生成 `latest.json` 和 `latest.md`。
7. blocked / failed 也必须生成报告。
8. 测试覆盖正常路径、非法跳步、worker 输出错误、blocked、failed、retry 上限。

### 3.2 不做的事

1. 不让主 Agent 直接生成教学内容。
2. 不让主 Agent 伪造画像、路径、引用或测评结果。
3. 不把 TypeScript deterministic pipeline 删除或替换。
4. 不依赖真实 LLM provider 作为唯一验收方式。
5. 不把子 Agent 失败伪装成成功。

## 4. 目标架构

```text
Learner Request
      |
      v
Learning Orchestrator Runtime
      |
      |-- State Machine
      |-- Worker Contract Validator
      |-- Worker Adapters
      |-- Trace Ledger
      |-- Report Generator
      v
8 Role Workers / Existing Role Modules
      |
      |-- background-collector
      |-- self-assessor
      |-- objective-diagnostician
      |-- profile-builder
      |-- path-planner
      |-- concept-tutor
      |-- code-lab
      |-- tiered-evaluator
      v
Run Artifacts
      |
      |-- .tmp/orchestrator/runs/<run_id>/trace.jsonl
      |-- .tmp/orchestrator/runs/<run_id>/summary.json
      |-- .tmp/orchestrator/runs/<run_id>/summary.md
      |-- .tmp/orchestrator/latest.json
      |-- .tmp/orchestrator/latest.md
```

## 5. 主 Agent 职责边界

### 5.1 主 Agent 负责

| 职责 | 具体含义 |
|---|---|
| 状态管理 | 维护 current_stage、completed_steps、blocked_stage |
| 调度决策 | 根据状态机选择下一个 worker |
| 上下文传递 | 将上游 artifacts/evidence_refs/input_refs 传给下游 |
| 契约校验 | 检查 worker output 是否符合统一 contract |
| 失败处理 | retry 一次；仍失败则 blocked / failed |
| 追踪审计 | 每步写 trace，记录决策、输入摘要、输出摘要、耗时和错误 |
| 汇报生成 | 生成答辩可读 Markdown 和机器可读 JSON |

### 5.2 主 Agent 不负责

| 不负责事项 | 归属 |
|---|---|
| 学习者背景事实抽取 | background-collector |
| 自评内容抽取 | self-assessor |
| 客观诊断判分 | objective-diagnostician |
| 画像合成 | profile-builder / B |
| 学习路径规划 | path-planner / B |
| RAG 检索和证据冻结 | A / adapter |
| 概念讲解生成 | concept-tutor / C |
| 代码实验生成和验证 | code-lab / C |
| 分层测评生成和判分 | tiered-evaluator / C |
| 前端展示 | D |

## 6. 状态机设计

### 6.1 状态定义

```text
created
intake_ready
background_collected
self_assessed
objective_diagnosed
profile_built
path_planned
concept_ready
lab_ready
assessment_ready
completed
blocked
failed
```

### 6.2 正常转移

```text
created
  -> intake_ready
  -> background_collected
  -> self_assessed
  -> objective_diagnosed
  -> profile_built
  -> path_planned
  -> concept_ready
  -> lab_ready
  -> assessment_ready
  -> completed
```

### 6.3 Worker 对应关系

| 当前状态 | 调用 worker | 成功后状态 |
|---|---|---|
| intake_ready | background-collector | background_collected |
| background_collected | self-assessor | self_assessed |
| self_assessed | objective-diagnostician | objective_diagnosed |
| objective_diagnosed | profile-builder | profile_built |
| profile_built | path-planner | path_planned |
| path_planned | concept-tutor | concept_ready |
| concept_ready | code-lab | lab_ready |
| lab_ready | tiered-evaluator | assessment_ready |
| assessment_ready | none | completed |

### 6.4 失败转移

| 情况 | 目标状态 |
|---|---|
| Worker 输出 `status: blocked` | blocked |
| Worker 输出 `status: failed` | failed |
| Worker 输出缺少 marker，重试后仍缺失 | blocked |
| Worker 输出 schema 不合法，重试后仍不合法 | blocked |
| Runtime 抛出不可恢复异常 | failed |
| 非法跳步 | failed |

## 7. Worker Contract

### 7.1 WorkerInvocation

```ts
export interface WorkerInvocation {
  schema_version: "1.0"
  session_id: string
  run_id: string
  step_index: number
  stage: OrchestrationStage
  worker: WorkerName
  learner_request: LearnerRequest
  upstream_artifacts: Record<string, unknown>
  input_refs: string[]
  evidence_refs: EvidenceRef[]
  retry_count: number
  mode: "scaffold" | "deterministic"
}
```

### 7.2 WorkerResult

```ts
export interface WorkerResult {
  schema_version: "1.0"
  run_id: string
  step_index: number
  worker: WorkerName
  stage: OrchestrationStage
  status: "completed" | "blocked" | "failed"
  marker: string
  summary: string
  artifacts: Record<string, unknown>
  output_refs: string[]
  evidence_refs: EvidenceRef[]
  next: OrchestrationStage | "complete" | "blocked" | "failed"
  errors: WorkerError[]
}
```

### 7.3 EvidenceRef

```ts
export interface EvidenceRef {
  ref_id: string
  kind: "profile" | "rag" | "generation_spec" | "artifact" | "review" | "assessment" | "trace"
  source: "A" | "B" | "C" | "D" | "orchestrator"
  content_hash?: string
  path?: string
}
```

### 7.4 WorkerError

```ts
export interface WorkerError {
  code: string
  message: string
  severity: "warning" | "recoverable" | "fatal"
  details?: Record<string, unknown>
}
```

## 8. Worker Adapter 策略

Worker Adapter 是主 Agent 与现有 A/B/C/D 模块之间的薄层。Adapter 只做机械转换和契约包装，不伪造业务内容。

### 8.1 Scaffold 模式

用途：证明 1 主 + 8 子的完整调度结构。

特点：

- 每个 worker 返回合法 `WorkerResult`。
- 每个结果包含 `[executed:<worker-name>]` marker。
- artifacts 标注为 scaffold，不声称是真实画像或真实课程。
- 适合答辩展示主 Agent 的调度过程。

### 8.2 Deterministic 模式

用途：将现有 TypeScript 业务能力接入主 Agent。

特点：

- B 相关 worker 尽量接 `src/role-b-profile/` 的真实实现。
- A RAG 证据通过 path-planner 或中间 adapter 获取，并保存为 evidence ref。
- C 相关 worker 接 `src/role-c-content/` 的 deterministic provider / pipeline。
- D 展示不作为 8 个子 Agent 之一，但可在 final report 中引用 `src/role-d-integration` 的 display handoff。
- 如果某个真实业务目标不被当前 deterministic C 支持，返回 blocked，不能伪装 completed。

## 9. Trace Ledger 设计

### 9.1 文件结构

```text
.tmp/orchestrator/
  latest.json
  latest.md
  runs/
    <run_id>/
      trace.jsonl
      summary.json
      summary.md
      artifacts/
```

### 9.2 TraceEvent

```ts
export interface TraceEvent {
  schema_version: "1.0"
  run_id: string
  session_id: string
  step_index: number
  event_type:
    | "session_started"
    | "orchestrator_decision"
    | "worker_invoked"
    | "worker_completed"
    | "worker_blocked"
    | "worker_failed"
    | "state_transition"
    | "session_completed"
    | "session_blocked"
    | "session_failed"
  stage: OrchestrationStage
  worker?: WorkerName
  message: string
  input_refs: string[]
  output_refs: string[]
  evidence_refs: EvidenceRef[]
  duration_ms?: number
  error?: WorkerError
  timestamp: string
}
```

### 9.3 Markdown 报告内容

`summary.md` 必须包含：

1. 运行结论。
2. run_id / session_id / mode。
3. 8 步调度表。
4. 每步主 Agent 决策。
5. 每步 worker 输出 marker。
6. 输入证据和输出产物引用。
7. blocked / failed 原因。
8. 下一步建议。

## 10. Runner 流程

```text
1. create session
2. validate learner request
3. transition created -> intake_ready
4. while not terminal:
   4.1 select next worker by current_state
   4.2 build WorkerInvocation
   4.3 write orchestrator_decision event
   4.4 invoke worker adapter
   4.5 validate WorkerResult
   4.6 if invalid and retry_count == 0: retry once
   4.7 if completed: write trace and transition state
   4.8 if blocked: write trace and enter blocked
   4.9 if failed: write trace and enter failed
5. write summary.json and summary.md
6. update latest.json and latest.md
```

## 11. 验证计划

### 11.1 单元测试

| 测试文件 | 覆盖内容 |
|---|---|
| `tests/orchestration-state-machine.test.ts` | 合法转移、非法跳步、terminal 状态 |
| `tests/orchestration-worker-contract.test.ts` | marker、worker/stage 匹配、schema 字段、错误输出 |
| `tests/orchestration-trace-ledger.test.ts` | JSONL 写入、summary 生成、latest 更新 |
| `tests/orchestration-runner.test.ts` | 8 步成功、worker blocked、worker failed、retry 上限 |
| `tests/learning-orchestrator-demo.test.ts` | demo 脚本输出 JSON/Markdown 且顺序正确 |

### 11.2 集成验证命令

```bash
bun scripts/learning-orchestrator-demo.ts --mode scaffold
bun scripts/learning-orchestrator-demo.ts --mode deterministic
bun test --isolate ./tests/orchestration-state-machine.test.ts ./tests/orchestration-worker-contract.test.ts ./tests/orchestration-trace-ledger.test.ts ./tests/orchestration-runner.test.ts ./tests/learning-orchestrator-demo.test.ts
bun run typecheck
bun run check
```

### 11.3 验收标准

| 验收项 | 标准 |
|---|---|
| Agent 数量 | 1 primary + 8 subagents 保持不变 |
| 调度顺序 | 8 个 worker 按固定顺序执行 |
| 状态机 | 非法跳步被拒绝 |
| Trace | 每步至少包含 decision、invocation、completion/block/fail、transition |
| 报告 | JSON 和 Markdown 同时生成 |
| 失败处理 | blocked / failed 有明确 stage、worker、reason |
| 证据链 | 下游 input_refs 包含上游 output_refs |
| 真实性边界 | scaffold 输出必须标注 scaffold；deterministic 不支持目标必须 blocked |
| 测试 | orchestration 相关测试全部通过 |
| 标准命令 | `bun run typecheck` 与 `bun run check` 作为最终门禁 |

## 12. 实施顺序

### Phase 1：类型和状态机

新增：

```text
src/orchestration/types.ts
src/orchestration/state-machine.ts
```

测试：

```text
tests/orchestration-state-machine.test.ts
```

### Phase 2：Worker Contract 校验

新增：

```text
src/orchestration/worker-contract.ts
```

测试：

```text
tests/orchestration-worker-contract.test.ts
```

### Phase 3：Trace Ledger 与报告

新增：

```text
src/orchestration/trace-ledger.ts
src/orchestration/report.ts
```

测试：

```text
tests/orchestration-trace-ledger.test.ts
```

### Phase 4：Worker Adapters

新增：

```text
src/orchestration/worker-adapters.ts
```

职责：

- 先实现 scaffold adapter，快速建立完整调度证据。
- 再逐步把 B/C 的 deterministic 能力接入 adapter。
- 对暂未真实接入的能力返回明确 scaffold 或 blocked，不能伪装真实业务完成。

### Phase 5：Runner 与 Demo

新增：

```text
src/orchestration/learning-orchestrator-runner.ts
scripts/learning-orchestrator-demo.ts
```

测试：

```text
tests/orchestration-runner.test.ts
tests/learning-orchestrator-demo.test.ts
```

### Phase 6：文档与答辩素材

新增或更新：

```text
docs/orchestrator_runtime_guide.md
README.md
```

内容：

- 如何运行主 Agent 编排 demo。
- 如何阅读 trace ledger。
- scaffold 与 deterministic 的区别。
- 失败恢复示例。
- 答辩用 8 步主控表。

## 13. 风险与控制

| 风险 | 控制方式 |
|---|---|
| 把主 Agent 做成新的业务实现，重复 A/B/C/D | 主 Agent 只做 orchestration，业务通过 adapter 调已有模块 |
| scaffold 被误报为真实业务完成 | 报告必须显示 mode；scaffold artifacts 必须标注 scaffold |
| deterministic 模式遇到 C 目标覆盖不足 | 返回 blocked 并记录 unsupported target，不伪造 ready |
| OpenCode provider 不稳定 | OpenCode 路径作为可选演示；确定性 Runner 作为可复现验收路径 |
| Trace 过大 | summary.md 保留摘要，trace.jsonl 保存完整事件 |
| 测试被当前 typecheck blocker 卡住 | 先修现有 `ContinueRoleCForRoleDResult` 类型收窄问题，再跑最终 `bun run check` |

## 14. 答辩表述

可以这样描述强化后的主 Agent：

> KnowBalance 使用 1 个主编排 Agent 和 8 个角色子 Agent。主 Agent 不直接生成教学内容，而是通过显式状态机管理完整学习流程，负责调度决策、上下文传递、输出校验、失败恢复和全链路 trace。每个子 Agent 只处理自己的专业职责。系统每次运行都会生成 JSONL trace 和 Markdown 报告，记录主 Agent 调用哪个子 Agent、传入哪些证据、收到哪些产物、如何进入下一阶段，从而保证多智能体协作过程可复现、可解释、可验收。

## 15. 最小可交付切片

如果时间有限但仍坚持质量，优先交付以下切片：

1. `types.ts` + `state-machine.ts`。
2. `worker-contract.ts`。
3. `trace-ledger.ts` + `report.ts`。
4. scaffold 模式 runner。
5. `learning-orchestrator-demo.ts --mode scaffold`。
6. 对应测试。
7. `summary.md` 答辩报告样例。

该切片可以严谨证明：主 Agent 已经具备持续状态、顺序调度、契约校验和 trace 审计能力。随后再把 deterministic B/C/D 真实链路逐步接入。
