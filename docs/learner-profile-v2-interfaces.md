# 学习者画像 v2 接口说明

本模块把最新任务中的画像要求实现为独立、可组合的 TypeScript 接口，暂不接入 UI、主会话编排或资源生成策略。其他负责人可以先评审数据形状，再决定在哪个交互节点调用。

统一导入入口：

```ts
import {
  assessProfileIntake,
  applyProfileClarificationAnswer,
  createLearnerProfileV2,
  updateLearnerProfileFromAnswers,
  updateLearnerProfileV2,
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

资源负责人可以据此决定基础/进阶/综合内容、示例类型、实操指南、分层测试和支架强度。本模块只提供事实与偏好，不替资源生成方预设具体生成规则。

## 当前接入边界

本次没有修改：

- `role-d-ui-v2` 的表单和展示；
- 主交互会话的命令 schema 与持久化；
- Role C 的生成规则、提示词或资源模板；
- 已验收 Day 0–7 证据与结论。

因此这些 API 目前是可测试、可导入的能力层，尚不会自动影响现有演示流程。
