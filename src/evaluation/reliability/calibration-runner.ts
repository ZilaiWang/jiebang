import type { ResourceDifficultyJudge } from "../resource-difficulty-judge"
import { contentHash } from "../../role-c-content/contracts/common"
import { evaluateJudgeCalibration, type JudgeCalibrationRow } from "./judge-calibration"

export interface CalibrationResource extends Omit<JudgeCalibrationRow, "resource_hash" | "predicted_difficulty"> {
  title: string
  content: string
}

export interface CalibrationResult extends JudgeCalibrationRow {
  reasons: string[]
  confidence?: number
  error?: string
}

export function calibrationRows(resources: CalibrationResource[]): JudgeCalibrationRow[] {
  if (resources.some((r) => !r.title?.trim() || !r.content?.trim())) throw new Error("CALIBRATION_CONTENT_REQUIRED")
  const rows = resources.map(({ resource_id, artifact_kind, expected_difficulty, reviewer, holdout, title, content }) => ({
    resource_id, artifact_kind, expected_difficulty, reviewer, holdout,
    resource_hash: contentHash({ artifact_kind, title, content }),
  }))
  const errors = evaluateJudgeCalibration(rows).errors.filter((error) => !error.startsWith("AUDIT_MISSING:"))
  if (errors.length) throw new Error(errors.join("; "))
  return rows
}

/** Reviewed labels stay outside the model input. Completed judgments are never retried for a better score. */
export async function runJudgeCalibration(input: {
  resources: CalibrationResource[]
  judge: ResourceDifficultyJudge
  prior?: CalibrationResult[]
  checkpoint: (rows: CalibrationResult[]) => Promise<void>
}) {
  const planned = calibrationRows(input.resources)
  const result: CalibrationResult[] = []
  for (const [index, resource] of input.resources.entries()) {
    const row = planned[index]!
    const prior = input.prior?.find((item) => item.resource_id === row.resource_id)
    if (prior && (prior.resource_hash !== row.resource_hash || prior.expected_difficulty !== row.expected_difficulty)) {
      throw new Error(`CALIBRATION_RESUME_DRIFT:${row.resource_id}`)
    }
    if (prior?.predicted_difficulty) result.push(prior)
    else {
      try {
        const judged = await input.judge.classify({ case_id: resource.resource_id, artifact_kind: resource.artifact_kind,
          title: resource.title, content: resource.content, rubric_version: "difficulty-rubric-v1" })
        result.push({ ...row, ...judged })
      } catch (error) {
        result.push({ ...row, reasons: [], error: error instanceof Error ? error.message : String(error) })
      }
    }
    await input.checkpoint(result)
    if (result.at(-1)?.error) break
  }
  return { rows: result, ...evaluateJudgeCalibration(planned.map((row) => result.find((r) => r.resource_id === row.resource_id) ?? row)) }
}
