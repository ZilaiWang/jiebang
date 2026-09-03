import {
  ARTIFACT_KINDS,
  type DifficultyAuditRecord,
} from "../competition-metrics"
import { COMPETITION_CASES_V2 } from "./competition-cases.v2"
import type { FrozenCompetitionManifestV2 } from "./competition-manifest.v2"

export interface RunObservationV2 {
  case_id: string
  repeat_index: number
  status: string
  duration_ms: number
  errors: string[]
  difficulty: DifficultyAuditRecord[]
}

/** All selected cases, including absent records, remain in stability denominators. */
export function buildStabilityReportV2(
  records: RunObservationV2[],
  selected: string[],
  repeats: number,
) {
  const rows = selected.map((case_id) => {
    const runs = Array.from({ length: repeats }, (_, index) =>
      records.find(
        (r) => r.case_id === case_id && r.repeat_index === index + 1,
      ),
    )
    const states = runs.map((r) => r?.status ?? "not_run")
    const complete = runs.every(Boolean)
    const comparable = repeats >= 2 && complete
    return {
      case_id,
      states,
      complete,
      comparable,
      stable_status: comparable ? new Set(states).size === 1 : null,
      stable_ready: comparable ? states.every((s) => s === "ready") : null,
    }
  })
  return {
    expected_cases: selected.length,
    repeats,
    complete_cases: rows.filter((r) => r.complete).length,
    status_stability:
      repeats >= 2
        ? rows.filter((r) => r.stable_status).length / selected.length
        : null,
    ready_stability:
      repeats >= 2
        ? rows.filter((r) => r.stable_ready).length / selected.length
        : null,
    rows,
  }
}

export function buildDifficultyConfusionV2(
  records: RunObservationV2[],
  manifest: FrozenCompetitionManifestV2,
  selected: string[],
  repeats: number,
) {
  const labels = ["beginner", "basic", "intermediate", "integrated"] as const
  return ARTIFACT_KINDS.map((artifact_kind) => {
    const matrix = Object.fromEntries(
      labels.map((label) => [
        label,
        Object.fromEntries(
          [...labels, "not_audited"].map((prediction) => [prediction, 0]),
        ),
      ]),
    )
    for (const c of manifest.cases.filter((c) => selected.includes(c.case_id)))
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const audit = records
          .find((r) => r.case_id === c.case_id && r.repeat_index === repeat)
          ?.difficulty.find((a) => a.artifact_kind === artifact_kind)
        const predicted =
          audit?.audited && audit.predicted_difficulty
            ? audit.predicted_difficulty
            : "not_audited"
        matrix[c.expected_difficulty[artifact_kind]]![predicted]!++
      }
    return { artifact_kind, matrix }
  })
}

/** Selection is fixed before observing results: two cases per profile, all three resources. */
export function buildManualAuditTemplateV2(
  records: RunObservationV2[],
  selected: string[],
  repeats: number,
) {
  const picked = new Set<string>()
  const byProfile = new Map<string, number>()
  for (const c of COMPETITION_CASES_V2.filter((c) =>
    selected.includes(c.case_id),
  )) {
    const count = byProfile.get(c.profile_fixture_id) ?? 0
    if (count < 2) {
      picked.add(c.case_id)
      byProfile.set(c.profile_fixture_id, count + 1)
    }
  }
  return Array.from({ length: repeats }, (_, index) =>
    [...picked].flatMap((case_id) =>
      ARTIFACT_KINDS.map((artifact_kind) => ({
        case_id,
        repeat_index: index + 1,
        artifact_kind,
        status:
          records.find(
            (r) => r.case_id === case_id && r.repeat_index === index + 1,
          )?.status ?? "not_run",
        evidence_file: `runs/repeat-${index + 1}/${case_id}.json`,
        reviewer: "",
        factual_accuracy: "",
        teaching_quality: "",
        difficulty_verdict: "",
        personalization_observable: "",
        notes: "",
      })),
    ),
  ).flat()
}

export function summarizeModelUsageV2(events: Array<Record<string, unknown>>) {
  const groups = new Map<
    string,
    {
      task: string
      calls: number
      elapsed_ms: number
      queue_ms: number
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
      failures: number
    }
  >()
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0
  for (const event of events) {
    const task = typeof event.task === "string" ? event.task : "unknown"
    const row = groups.get(task) ?? {
      task,
      calls: 0,
      elapsed_ms: 0,
      queue_ms: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      failures: 0,
    }
    row.calls++
    row.elapsed_ms += n(event.total_ms)
    row.queue_ms += n(event.queued_ms)
    row.prompt_tokens += n(event.prompt_tokens)
    row.completion_tokens += n(event.completion_tokens)
    row.total_tokens += n(event.total_tokens)
    if (
      event.error_code ||
      event.provider_error ||
      event.json_parse_ok === false
    )
      row.failures++
    groups.set(task, row)
  }
  return {
    calls: events.length,
    total_tokens: [...groups.values()].reduce((n, r) => n + r.total_tokens, 0),
    stages: [...groups.values()],
  }
}
