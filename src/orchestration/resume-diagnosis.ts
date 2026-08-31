import type { PathLevel } from "./path-registry"

export interface ResumeDiagnosisItem {
  item_id: string
  objective_id: string
  source_id?: string
  question: string
  options: string[]
  answer?: string
}

export interface ResumeDiagnosisPlan {
  path_id: string
  objective_ids: string[]
}

export interface ResumeDiagnosisEvaluation {
  passed: boolean
  level: PathLevel
  weak_objective_ids: string[]
  answered_count: number
  total_count: number
}

export function buildResumeDiagnosisPlan(input: {
  path_id: string
  current_node_id: string | null
  mastery: Record<string, number>
  objective_ids: string[]
}): ResumeDiagnosisPlan {
  const weak = input.objective_ids.filter((id) => (input.mastery[id] ?? 0) < 0.7)
  return {
    path_id: input.path_id,
    objective_ids: (weak.length ? weak : input.objective_ids).slice(0, 3),
  }
}

export function evaluateResumeDiagnosis(
  items: ResumeDiagnosisItem[],
  answers: Record<string, string>,
  privateAnswerKey: Record<string, string> = {},
): ResumeDiagnosisEvaluation {
  const weak = items
    .filter((item) => answers[item.item_id] !== (item.answer ?? privateAnswerKey[item.item_id]))
    .map((item) => item.objective_id)
  const answered = items.filter((item) => typeof answers[item.item_id] === "string" && answers[item.item_id]!.trim()).length
  const passed = items.length > 0 && weak.length === 0 && answered === items.length
  return {
    passed,
    level: passed ? "intermediate" : "basic",
    weak_objective_ids: [...new Set(weak.length ? weak : items.filter((item) => answers[item.item_id] !== item.answer).map((item) => item.objective_id))],
    answered_count: answered,
    total_count: items.length,
  }
}
