# 学习者画像 v2 接口说明

本模块把结构化画像采集、主动追问、画像更新和教学策略交接实现为一条可运行的生产链路。旧画像仍按原协议运行；新建的 v2 画像会经主 Agent 传给 B，并以确定性教学合同约束 C 的讲义、代码实验和测评生成。

统一导入入口：

```ts
import {
  assessProfileIntake,
  applyProfileClarificationAnswer,
  createLearnerProfileV2,
  updateLearnerProfileFromAnswers,
  updateLearnerProfileV2,
  buildRoleCPedagogyContract,
  buildRoleCProfileSnapshotOptions,
  buildPersonalizationProfileHandoff,
} from "../src/role-b-profile"
```

## 接口清单

| 接口 | 输入 | 输出 | 用途 |
| --- | --- | --- | --- |
| `assessProfileIntake` | `LearnerProfileIntakeV2` | `ProfileIntakeAssessment` | 检查必要信息，按优先级生成主动追问；默认每轮最多 3 问 |
| `applyProfileClarificationAnswer` | 当前 intake + 单条回答 | 新 intake | 将选择、文本、时间预算等回答安全合并，不修改原对象 |
| `createLearnerProfileV2` | 现有客观诊断画像 + 完整 intake | `LearnerProfileV2` | 建立富画像；必要信息缺失时拒绝创建 |
| `updateLearnerProfileFromAnswers` | 现有 v2 画像 + 后续回答补丁 | 新 v2 画像 + 变更字段 | 接收用户后续补充或纠正，不重置客观诊断结果 |
| `updateLearnerProfileV2` | 现有 v2 画像 + 学习进展观察 | 新 v2 画像 + B 侧变更 + C 侧适配参数 | 根据测评证据更新水平、已掌握项、薄弱项和进度 |
| `buildRoleCPedagogyContract` | v2 画像 | `RoleCPedagogyContract` | 将画像转为版本绑定、可审计的教学策略，不改变事实、目标、答案和评分 |
| `buildRoleCProfileSnapshotOptions` | v2 画像 | 现有 C 画像快照适配参数 | 复用当前 Role C 契约，传递场景、无障碍要求和版本来源 |
| `buildPersonalizationProfileHandoff` | v2 画像 | `PersonalizationProfileHandoff` | 给路径、讲义、代码实验和测评负责人使用的稳定只读视图 |

## 采集和主动追问

最低必要信息共 5 类：学习目标、学习/工作背景、自评阶段、目标用途、每周时间预算。推荐信息包括预期成果、讲解偏好、练习偏好、熟悉场景、工具或无障碍限制，以及画像保留选择。

```ts
let intake: LearnerProfileIntakeV2 = {
  learner_id: "learner-001",
  goal: "完成 Python 数据分析项目",
}

let assessment = assessProfileIntake(intake)
// assessment.status === "needs_clarification"
// assessment.questions: 当前最多三个优先问题

intake = applyProfileClarificationAnswer(intake, {
  question_id: "profile.self_rating",
  value: "basic",
})

assessment = assessProfileIntake(intake)
// 调用方收到每轮回答后再次评估，直到 status === "ready"
```

问题带有稳定 `id`、目标字段、回答类型、必填标记、优先级、追问原因和可选项；UI、命令协议或模型工具可按需渲染，不必解析自然语言。

## 画像内容

`LearnerProfileV2` 保留现有 `LearnerProfile` 的 `level`、`known_concepts`、`weak_concepts`、`ability_dimensions` 和目标，同时新增：

- 结构化教育/专业/角色背景、既往语言与知识；
- 自评水平，并与客观诊断水平分开；
- 课程、竞赛、求职、项目等目标用途，预期成果与期限；
- 讲解、练习、节奏和熟悉场景偏好；
- 周/单次时间预算、工具限制和无障碍要求；
- 按知识库 `source_id` 记录的掌握度、完成会话和最近测评；
- 是否启用个性化、会话内/跨会话保留、是否允许展示；
- 字段级来源、画像版本、修订号和更新时间。

未明确回答的可选偏好采用保守默认值，并标为 `system_default`；跨会话保留默认关闭。背景信息不能直接推导能力或偏好，能力变化必须来自诊断或学习证据。

若学习者关闭个性化，Role C 适配参数会清空场景和无障碍偏好，资源交接接口会返回 `PROFILE_PERSONALIZATION_DISABLED`，防止下游继续消费画像上下文。

## 两条增量更新路径

用户后续明确补充或纠正资料时：

```ts
const answerUpdate = updateLearnerProfileFromAnswers({
  profile,
  intake_patch: {
    learner_id: profile.learner_id,
    explanation_preference: "step_by_step",
    weekly_time_budget_minutes: 240,
  },
  next_profile_version: "PROFILE-learner-001-v2-r2",
})
```

测评、练习或学习事件形成证据时：

```ts
const progressUpdate = updateLearnerProfileV2({
  profile: answerUpdate.profile,
  observation: {
    observationId: "feedback-001",
    action: "advance",
    overallAccuracy: 0.9,
    mastery: [{ objectiveId: "OBJ-K007", mastery: 0.9, evidenceBatches: 2 }],
    conceptEvidence: [{
      sourceId: "K007",
      concept: "循环",
      evidenceScore: 0.9,
      evidenceBatches: 2,
    }],
  },
  next_profile_version: "PROFILE-learner-001-v2-r3",
  completed_session_id: "session-001",
})
```

第一条路径只更新用户明确表达的内容；第二条路径复用现有 B 角色进展规则更新客观学习状态。二者均为纯计算接口，不自行写数据库或浏览器存储。

## 资源生成交接

`buildPersonalizationProfileHandoff(profile)` 已集中给出最新任务要求的个性化轴：

- 基础层级、已掌握知识、薄弱知识及客观进展；
- 课程/竞赛/求职/项目等学习目标；
- 熟悉背景与例子场景；
- 讲解、练习和节奏偏好；
- 时间、设备、软件和无障碍限制；
- 来源画像的版本和修订号。

资源负责人可以据此决定基础/进阶/综合内容、示例类型、实操指南、分层测试和支架强度。`buildRoleCPedagogyContract` 将这些选择固化为 C 可直接消费的教学合同，并保留来源画像的版本和修订号。

## 生产链路

1. D 创建会话时可提交 `learner_request.profile_intake`；缺少必要字段时，主 Agent 返回最多 3 个结构化问题。
2. D 通过 `submit_profile_answers` 提交当前问题的答案。信息完整后，主 Agent 继续生成客观诊断题。
3. B 根据 intake 与诊断结果创建 `LearnerProfileV2`，同时生成 `RoleCPedagogyContract`。
4. 主 Agent 将画像版本和教学合同写入 C 的画像快照及不可变 `GenerationSpec`。
5. C 在模型调用前构造 `TeachingUnitContract`，并据此规划讲义段落与示例、代码练习形态、提示层级和测评模态。
6. 每轮测评后，B 更新 v2 画像的客观进展并重新生成教学合同；不会降级为旧画像。

教学合同只影响教学呈现和练习组织，以下内容保持冻结：

- RAG 事实和引用范围；
- 学习路径目标及其必需事实；
- 测评标准答案和评分规则；
- 代码实验的执行接口与隐藏测试。

旧会话和未携带 `profile_intake` 的调用继续使用原画像协议，不要求调用方一次性迁移。

## 发布前教学证据审计

`bun scripts/audit-teaching-evidence.ts --strict` 检查知识库中的示例、误区、练习任务、验收标准及其事实绑定。它审计的是人工编写的教学证据，不会用模型生成内容反向填充知识库。严格模式存在错误时应补充相应知识条目后再发布。

`bun run smoke:profile-v2:lesson` 使用真实模型，在冻结同一学习目标和事实集合的前提下，对两种不同画像分别生成讲义，并校验教学合同差异、目标覆盖、引用闭包、讲义结构和占位文本。该命令用于确认画像只改变教学呈现，不改变知识事实边界。
