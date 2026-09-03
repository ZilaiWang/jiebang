import { ARTIFACT_KINDS, type ArtifactKind, type Difficulty } from "../competition-metrics"

export interface JudgeCalibrationRow {
  resource_id: string
  resource_hash: string
  artifact_kind: ArtifactKind
  expected_difficulty: Difficulty
  predicted_difficulty?: Difficulty
  reviewer: string
  holdout: boolean
}

/** Calibration resources are frozen outside the formal 60-case evaluation set. */
export function evaluateJudgeCalibration(rows: JudgeCalibrationRow[]) {
  const labels: Difficulty[] = ["beginner", "basic", "intermediate", "integrated"]
  const errors: string[] = []
  if (rows.length < 24) errors.push("CALIBRATION_REQUIRES_24_RESOURCES")
  const ids = new Set<string>(), hashes = new Set<string>()
  const matrix = Object.fromEntries(labels.map((expected) => [expected,
    Object.fromEntries([...labels, "not_audited"].map((observed) => [observed, 0])),
  ]))
  for (const row of rows) {
    if (!row.resource_id || !row.resource_hash || ids.has(row.resource_id) || hashes.has(row.resource_hash)) errors.push(`DUPLICATE_OR_EMPTY_RESOURCE:${row.resource_id}`)
    ids.add(row.resource_id); hashes.add(row.resource_hash)
    if (!row.holdout || !row.reviewer?.trim()) errors.push(`UNREVIEWED_OR_NON_HOLDOUT:${row.resource_id}`)
    if (!labels.includes(row.expected_difficulty) || !ARTIFACT_KINDS.includes(row.artifact_kind)) {
      errors.push(`INVALID_LABEL:${row.resource_id}`)
      continue
    }
    const predicted = labels.includes(row.predicted_difficulty as Difficulty) ? row.predicted_difficulty! : "not_audited"
    matrix[row.expected_difficulty]![predicted]! += 1
    if (predicted === "not_audited") errors.push(`AUDIT_MISSING:${row.resource_id}`)
  }
  for (const level of labels) for (const kind of ARTIFACT_KINDS) {
    if (rows.filter((row) => row.expected_difficulty === level && row.artifact_kind === kind).length < 2) errors.push(`CELL_UNDERSAMPLED:${level}:${kind}`)
  }
  const correct = rows.filter((row) => row.expected_difficulty === row.predicted_difficulty).length
  const accuracy = rows.length > 0 ? correct / rows.length : null
  return {
    version: "difficulty-judge-calibration.v3", resources: rows.length, correct, accuracy,
    confusion_matrix: matrix, errors,
    by_artifact: Object.fromEntries(ARTIFACT_KINDS.map((kind) => {
      const subset = rows.filter((row) => row.artifact_kind === kind)
      const correct = subset.filter((row) => row.expected_difficulty === row.predicted_difficulty).length
      return [kind, { resources: subset.length, correct, accuracy: subset.length ? correct / subset.length : null,
        confusion_matrix: Object.fromEntries(labels.map((expected) => [expected, Object.fromEntries([...labels, "not_audited"].map((predicted) => [predicted,
          subset.filter((row) => row.expected_difficulty === expected && (row.predicted_difficulty ?? "not_audited") === predicted).length,
        ]))])),
      }]
    })),
    passed: errors.length === 0 && accuracy !== null && accuracy >= 0.85,
  }
}
