# Learning Orchestrator 持续会话 HTTP API

> 更新于 2026-08-08：与 `src/orchestration/interactive-session.ts` 当前实现对齐。
> 主要变化：新增 `run_assessment_code` 命令与 `code_execution` 公开字段；正式测评改为五题 code-pair 结构（不再含主观简答题）；提交测评后下一轮内容后台生成（`running` 状态 + 前端轮询）；`GET /sessions/:id` 触发旧会话自动迁移；**锚点路由已彻底移除**（`submit_anchor_answers` 命令、`anchor_routing`/`anchor_answers` 字段及相关函数全部删除，正式测评直接按 B 初始画像生成，无需锚点题）；**advance 到新节点时自动按当前节点从知识库补全缺失的 A 证据**（`ensureCurrentNodeEvidence`），不再因首轮 RAG 快照缺后续节点证据而阻塞。

## 启动

```bash
export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"   # Windows；按本机 Docker 安装调整
bun --env-file=.env.role-c.local scripts/learning-orchestrator-api.ts \
  --host=127.0.0.1 \
  --port=8787 \
  --data-root=.tmp/integrated-orchestrator
```

`data-root` 由服务端配置。浏览器请求中的 `root_dir` 会被忽略。

## 接口

### 健康检查

```http
GET /health
```

返回可用端点列表。

### Provider 配置（仅本机回环地址）

```http
GET  /orchestrator/provider-config
PUT  /orchestrator/provider-config
```

仅允许 `127.0.0.1` / `localhost` / `[::1]` 访问（`LOCAL_CONFIGURATION_ONLY`）。`PUT` 写入 `<data_root>/provider-config.json`（原子写，权限 0600）并注入环境变量：

```json
{
  "endpoint": "https://api.deepseek.com/v1/chat/completions",
  "model_id": "deepseek-chat",
  "api_key": "sk-..."
}
```

### 创建持续会话

```http
POST /orchestrator/sessions
Authorization: Bearer learner-001
Content-Type: application/json
```

```json
{
  "session_id": "SESSION-001",
  "mode": "deterministic",
  "learner_request": {
    "learner_id": "learner-001",
    "goal": "学习 Python 循环并完成成绩统计",
    "background": "零基础",
    "self_rating": "beginner"
  }
}
```

校验规则：

- 会话仅接受 `mode: "deterministic"`（scaffold 模式被明确拒绝，见 schema `orchestrator-api-schema.ts`）；
- `learner_request.learner_id` 必须与 Bearer 身份一致，否则 `LEARNER_IDENTITY_MISMATCH` (403)；
- 会话 ID / run ID 必须匹配 `[A-Za-z0-9_-]`，重复创建返回 `SESSION_ALREADY_EXISTS` (409)；
- 创建请求体上限 1MB，`Content-Type` 必须为 `application/json`。

创建后不会一次性跑完。主 Agent 先返回：

```json
{
  "status": "waiting_for_user",
  "current_stage": "objective_diagnosis",
  "waiting_for": {
    "type": "diagnosis_answers",
    "items": []
  }
}
```

诊断题的可信答案只保存在服务端会话文件中（`private.diagnosis_answer_key`），不会返回浏览器。

### 查询并恢复会话

```http
GET /orchestrator/sessions/:sessionId
Authorization: Bearer learner-001
```

返回当前会话完整公开视图。服务重启后使用同一 `data-root` 即可恢复。**该端点为纯只读**，不触发任何写操作。

### 显式旧会话迁移（写操作）

```http
POST /orchestrator/sessions/:sessionId/repair
Authorization: Bearer learner-001
```

旧会话迁移是**显式写操作**，由该端点触发（2026-08-08 起不再挂在 GET 上，避免前端轮询时静默替换学习者正在作答的测评）：若已有测评含 `short_answer` 主观题，或学习资源目标与当前 B 节点不一致，且会话处于 `waiting_for_user` 且有完整画像/路径/节点/RAG 证据，则置为 `running` 并在后台按当前节点重新生成整套内容（事件注明原因）。修复完成后回到 `waiting_for_user` 等待新的 `assessment_answers`。无迁移需要时原样返回当前公开视图。

### 提交命令

```http
POST /orchestrator/sessions/:sessionId/commands
Authorization: Bearer learner-001
Content-Type: application/json
```

每个命令必须带唯一 `command_id`（`[A-Za-z0-9_-]{1,120}`）。相同 ID 和相同内容会幂等重放；相同 ID 但内容不同返回 `COMMAND_ID_REUSED` (409)。同一会话的命令串行执行，并受跨进程文件锁保护。

支持的命令类型：`submit_diagnosis_answers` | `submit_assessment_answers` | `run_assessment_code` | `retry`。

#### 提交诊断答案

```json
{
  "command_id": "CMD-DIAG-001",
  "type": "submit_diagnosis_answers",
  "payload": {
    "answers": {
      "DIAG-1-K007": "遍历序列"
    }
  }
}
```

`answers` 必须覆盖会话返回的全部诊断题 ID，多答或少答返回 `INVALID_DIAGNOSIS_ANSWERS` (400)。

完成诊断后，主 Agent 继续调用画像（profile-builder）和路径（path-planner）Worker，再经 C 生成概念课件、代码实验与正式测评，在测评处暂停：

```json
{
  "status": "waiting_for_user",
  "current_stage": "assessment",
  "waiting_for": {
    "type": "assessment_answers",
    "items": []
  }
}
```

正式测评结构为五题 code-pair：`mcq(1分) + true_false(1分) + trace(2分) + code(2分) + code(4分)`，不再包含 `short_answer` 主观题；所有题目的 citations 均绑定到 A 知识库真实 fact。

#### 提交测评答案

```json
{
  "command_id": "CMD-ASSESS-001",
  "type": "submit_assessment_answers",
  "payload": {
    "answers": [
      {
        "item_id": "ITEM-O1-T1-MCQ",
        "selected_option_id": "opt_iterate",
        "hint_level_used": 0
      }
    ]
  }
}
```

代码题通过 `code_response` 字段提交。主 Agent 使用服务端私有的 `assessment_secure` 评分，返回公开 `feedback.final_decision`，然后执行：

- `remediate`：保持当前节点，按聚焦目标生成针对性补救轮（准确率 < 0.4）；同一节点补救轮次达到上限（3）后强制推进下一节点；
- `reinforce`：保持当前节点，生成巩固强化轮（准确率 < 0.8）；同一节点强化轮次达到上限（2）后强制推进下一节点；
- `advance`：推进 B 正式路径，`round_no + 1`，把下一节点目标作为 focus 传给 C；**下一节点若不在首轮 RAG 快照中，主 Agent 自动按当前节点 target/先修从知识库按 source_id 补全 A 证据**（`ensureCurrentNodeEvidence`）后再生成，不再阻塞；
- `reprofile`：画像漂移（画像预期与真实表现连续冲突：预期 known 但 mastery < 0.45，或预期 weak 但 mastery > 0.85，单目标冲突即触发），回到诊断阶段重建学习者画像；
- 路径走完：返回 `completed`。

每次评分后主 Agent 会把本轮 mastery 写回 learner-memory（按 source_id），跨会话学习记忆真实生效；同节点轮次上限（`MAX_REMEDIATE_ROUNDS_PER_NODE=3` / `MAX_REINFORCE_ROUNDS_PER_NODE=2`）防止学习者无限循环在同一节点。

reprofile 触发链路(2026-08-08 修复):画像预期现在来自 B 画像真实 known/weak_concepts(`profileExpectationForTarget` 按 source_id 映射,不再硬编码 weak);`profile_version` 跨轮稳定(`<run_id>-profile-E<epoch>`),同一画像纪元内多轮 evidence 跨轮累积,reprofile 后 epoch+1 使新画像从零累积;触发门槛 `profile_drift_minimum_conflicts=1` 适配每节点单 objective。

提交测评后**下一轮内容在后台生成**：命令响应先返回评分反馈，会话状态为 `running`、`waiting_for` 为 `null`，`feedback` 已可用；前端轮询 `GET /orchestrator/sessions/:id` 直到再次进入 `waiting_for_user`（新 `assessment_answers` 到达）。后台生成失败时进入 `blocked` 或 `failed`，可用 `retry` 恢复。

#### 运行测评代码题（即时试运行）

```json
{
  "command_id": "CMD-CODE-001",
  "type": "run_assessment_code",
  "payload": {
    "item_id": "ITEM-O1-T3-CODE",
    "code": "print('Python 适合教学示例')"
  }
}
```

仅在等待 `assessment_answers` 时允许。代码经 C 私有测试套件执行（Docker Runner），返回公开摘要（`passed_checks` / `total_checks` / `score_ratio` / `feedback_codes`），写入公开字段 `code_execution`。校验：`item_id` 必须匹配 `[A-Za-z0-9_-]{1,160}`，`code` 非空且 ≤ 100KB。不会泄露隐藏测试、参考答案或私有套件。

#### 重试阻塞 / 中断阶段

```json
{
  "command_id": "CMD-RETRY-001",
  "type": "retry"
}
```

适用场景（`blocked` / `failed`，或 `running` 但带可恢复检查点）：

- 后台生成随服务重启中断的 `running` 会话：从持久化的 `next_round_context` 检查点恢复生成（`role_c_generation_attempt` 递增避免 run_id 碰撞；持久化 focus 与当前节点不符时自动对齐到当前节点目标）；
- 含完整 `role_c` + `assessment` + 节点检查点的会话：恢复 `waiting_for_user` 等待测评；
- 有画像/路径/节点/RAG 证据但缺内容的会话：按当前节点重新生成整套内容；
- 仅有诊断答案的会话：以原答案重放诊断流程。

### 读取 Worker 事件

```http
GET /orchestrator/sessions/:sessionId/events
Authorization: Bearer learner-001
```

返回主 Agent 持久化的事件列表（`session_created` / `worker_completed` / `worker_invoked` / `waiting_for_user` / `command_received` / `session_updated` / `session_completed` / `session_blocked`）。

## D 可直接使用的公开字段

- `session_id`
- `status`（`waiting_for_user | running | completed | blocked | failed`）
- `current_stage`（`objective_diagnosis | assessment | completed | blocked | failed`）
- `round_no`
- `waiting_for`
- `worker_ledger`
- `profile`
- `formal_path`
- `current_path_node`
- `rag_result`
- `learning_resources.concept_lesson`
- `learning_resources.code_lab`
- `assessment`
- `adaptation`（remediate / reinforce 轮的本轮适配信息）
- `code_execution`（最近一次 `run_assessment_code` 的公开摘要，无则 `null`）
- `feedback`
- `blocked_reason`

公开响应不会包含：

- 诊断正确答案（`private.diagnosis_answer_key`）；
- `private` 全量（含 `diagnosis_answers`、`next_round_context`、Role C 身份）；
- `assessment_secure`（由 Role C 私有 opaque store 保存）；
- `correct_option_id`；
- 服务端命令账本（`processed_commands`）；
- `learner_request`、`owner_id`、`events`；
- 服务端文件根目录。

## 当前运行边界

- 会话仅接受 `deterministic` 模式，依赖真实模型 Provider（`.env.role-c.local` / provider-config）与 Docker Runner（镜像 `knowbalance-role-c-python-runner:1.0.0`）。
- 持续会话接口已要求 Bearer 学习者身份并校验会话所有权（`owner_id`）。
- 正式联网部署仍应把当前本地身份头替换为可信身份提供方签发的令牌，同时增加 Origin/Host 校验、限流和超时。
- 若后台生成、评分或代码执行依赖的 Provider / Docker 不可用，会话进入 `blocked` / `failed`，不伪造资源、不跳步。
