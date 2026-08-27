import type { KnowledgeBase } from "../knowledge/types"
import { buildWeek3EvaluationCases } from "./week3-evaluation"
import { GOLDEN_LEARNER_PROFILES } from "./week3-evaluation"
import type { ArtifactKind, CompetitionCaseExpectation, Difficulty } from "./competition-metrics"
import {
  planWeek3ObservableBehavior,
  week3TargetKnowledgeState,
} from "../role-c-content/evaluation/week3-runner"

/**
 * 从现有 60 个评测案例构建正式标准（改进方案8 第四节2）。
 *
 * expected_difficulty 由生成前已冻结的 observable behavior 和目标组合决定，
 * 不读取模型产物。这避免“画像是 basic，所有资源都必须 basic”的
 * 机械标注：纯定义解释可以是 beginner，多目标或项目讲义至少 basic。
 *
 * 正式冻结前由两名成员人工核查一次 expected_difficulty。
 */
export function buildCompetitionExpectations(
  knowledgeBase: KnowledgeBase,
): CompetitionCaseExpectation[] {
  const byId = new Map(
    knowledgeBase.items.map((item) => [item.sourceId, item]),
  )

  return buildWeek3EvaluationCases().map((evaluationCase) => {
    const requiredFactIds =
      evaluationCase.target_source_ids.flatMap((sourceId) => {
        const item = byId.get(sourceId)
        if (!item) {
          throw new Error(`UNKNOWN_TARGET_SOURCE:${sourceId}`)
        }
        if (!item.coreFactIds?.length) {
          throw new Error(`TARGET_WITHOUT_CORE_FACTS:${sourceId}`)
        }
        return item.coreFactIds.map((factId) => `${sourceId}:${factId}`)
      })

    const targetItems = evaluationCase.target_source_ids.map((sourceId) => byId.get(sourceId)!)

    return {
      case_id: evaluationCase.case_id,

      ...plannedDifficultyExpectation(evaluationCase, targetItems),

      required_fact_ids: requiredFactIds,
    }
  })
}

export function renderManifestReviewTemplate(cases: CompetitionCaseExpectation[]): string {
  const rows = [[
    "case_id", "artifact_kind", "expected_difficulty", "generation_time_basis",
    "reviewer_1", "reviewer_1_decision", "reviewer_2", "reviewer_2_decision",
    "adjudication", "notes",
  ]]
  for (const evaluationCase of cases) {
    for (const kind of ["lesson", "lab", "assessment"] as const) {
      rows.push([
        evaluationCase.case_id,
        kind,
        evaluationCase.expected_difficulty[kind],
        evaluationCase.expected_difficulty_basis?.[kind] ?? "",
        "", "", "", "", "", "",
      ])
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
}

function csvCell(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value
}

const BEHAVIOR_DIFFICULTY: Record<string, Difficulty> = {
  recognize: "beginner",
  explain: "beginner",
  apply: "basic",
  trace: "intermediate",
  debug: "intermediate",
  create: "integrated",
}

const DIFFICULTY_RANK: Difficulty[] = ["beginner", "basic", "intermediate", "integrated"]

function plannedDifficultyExpectation(
  evaluationCase: ReturnType<typeof buildWeek3EvaluationCases>[number],
  targetItems: KnowledgeBase["items"],
): Pick<CompetitionCaseExpectation, "expected_difficulty" | "expected_difficulty_basis"> {
  const behaviors = targetItems.map((item, index) => planWeek3ObservableBehavior(
    evaluationCase.learner_level,
    index,
    targetItems.length,
    item,
    GOLDEN_LEARNER_PROFILES[evaluationCase.learner_profile_id],
  ))
  const knowledgeStates = targetItems.map((item) => week3TargetKnowledgeState(
    GOLDEN_LEARNER_PROFILES[evaluationCase.learner_profile_id],
    item,
  ))
  const taskDifficulty = maxDifficulty(behaviors.map((behavior) => BEHAVIOR_DIFFICULTY[behavior]!))
  const compositeFloor: Difficulty = targetItems.length > 1 ? "basic" : "beginner"
  const expected: Record<ArtifactKind, Difficulty> = {
    lesson: maxDifficulty([taskDifficulty, compositeFloor]),
    lab: maxDifficulty([taskDifficulty, compositeFloor]),
    assessment: maxDifficulty([taskDifficulty, compositeFloor]),
  }
  const behaviorLabel = [...new Set(behaviors)].join("+")
  const stateLabel = [...new Set(knowledgeStates)].join("+")
  const common = `生成前任务：knowledge_state=${stateLabel}，behavior=${behaviorLabel}，target_count=${targetItems.length}`
  return {
    expected_difficulty: expected,
    expected_difficulty_basis: {
      lesson: `${common}；讲义多目标组合下限=${compositeFloor}`,
      lab: `${common}；实验按可观测操作和目标组合定档`,
      assessment: `${common}；测评按可观测操作和目标组合定档`,
    },
  }
}

function maxDifficulty(values: Difficulty[]): Difficulty {
  return DIFFICULTY_RANK[Math.max(...values.map((value) => DIFFICULTY_RANK.indexOf(value)))]!
}
