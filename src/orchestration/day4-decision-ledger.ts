import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"

type Day4Action = "remediate" | "reinforce" | "advance" | "reprofile"

interface PublicSessionSnapshot {
  session_id: string
  run_id?: string
  round_no: number
  status: string
  current_stage: string
  waiting_for?: { type?: string } | null
  feedback: {
    feedback_id: string
    round_score?: { raw_score?: number; max_score?: number; accuracy?: number; evidence_score?: number }
    final_decision: {
      action: Day4Action
      reason_codes?: string[]
      target_objective_ids?: string[]
      confidence?: number
      basis?: string
      policy_ref?: string
    }
  }
  next_round_action: {
    action: Day4Action
    round_no: number
    target_node_id: string | null
    feedback_id: string
    status: "generating_next_round" | "waiting_for_reprofile"
  }
  worker_ledger_history?: WorkerLedgerHistoryEntry[]
}

interface WorkerReference {
  ref_id: string
  kind?: string
  locator?: string | null
  verified_exists?: boolean
}

interface WorkerLedgerHistoryEntry {
  entry_id: string
  round_no?: number
  step_index?: number
  unit_name: string
  execution_type: string
  stage: string
  status: string
  summary?: string
  input_refs?: WorkerReference[]
  output_refs?: WorkerReference[]
  evidence_refs?: WorkerReference[]
  errors?: Array<{ code?: string }>
}

interface PublicEventsFile {
  session_id: string
  events: Array<{
    event_id: string
    event_type: string
    stage: string
    message: string
    timestamp?: string
    worker_name?: string
  }>
}

export interface Day4DecisionLedgerEntry {
  schema_version: "1.0"
  entry_id: string
  session_id: string
  run_id: string | null
  round_no: number
  assessment_result: {
    feedback_id: string
    raw_score: number | null
    max_score: number | null
    accuracy: number | null
    evidence_score: number | null
  }
  decision: {
    source: {
      decision_owner: "role-c"
      output_field: "feedback.final_decision"
      applied_by: "main-agent"
    }
    action: Day4Action
    reason_codes: string[]
    target_objective_ids: string[]
    confidence: number | null
    basis: string | null
    policy_ref: string | null
    target_node_id: string | null
  }
  state_transition: {
    from_stage: "assessment"
    to_stage: string
    next_round_status: "generating_next_round" | "waiting_for_reprofile"
  }
  next_round_execution: {
    observed: boolean
    event_refs: string[]
    units: Array<{
      entry_id: string
      unit_name: string
      execution_type: string
      stage: string
      status: string
      summary: string | null
      input_refs: string[]
      output_refs: string[]
      evidence_refs: string[]
      error_codes: string[]
    }>
    final_status: string
    final_stage: string
  }
  evidence_refs: string[]
  observability: {
    evidence_classification: "requires_acceptance_review"
    verified_conditions: Array<
      | "session_identity_matched"
      | "feedback_action_matched"
      | "next_round_execution_observed"
    >
    limitations: string[]
  }
}

export async function exportDay4DecisionLedger(input: {
  run_directory: string
  output_file: string
}): Promise<{ entry: Day4DecisionLedgerEntry }> {
  const runDirectory = resolve(input.run_directory)
  const outputFile = resolve(input.output_file)
  const decisionPath = resolve(runDirectory, "decision-session.json")
  const finalPath = resolve(runDirectory, "final-session.json")
  const eventsPath = resolve(runDirectory, "events.json")
  const [decision, final, events] = await Promise.all([
    readJson<PublicSessionSnapshot>(decisionPath),
    readJson<PublicSessionSnapshot>(finalPath),
    readJson<PublicEventsFile>(eventsPath),
  ])
  validateEvidence(decision, final, events)
  const action = decision.feedback.final_decision.action
  const decisionEventIndex = events.events.findIndex((event) =>
    event.message.includes(decision.feedback.feedback_id)
    || (event.stage === "assessment" && event.event_type === "command_received"))
  const laterEvents = decisionEventIndex >= 0 ? events.events.slice(decisionEventIndex + 1) : []
  const nextRoundEvents = laterEvents.filter((event) =>
    event.event_type === "worker_invoked"
    || event.event_type === "worker_completed"
    || event.event_type === "session_updated"
    || event.event_type === "waiting_for_user"
    || event.event_type === "session_blocked")
  const decisionEntryIds = new Set((decision.worker_ledger_history ?? []).map((entry) => entry.entry_id))
  const nextRoundUnits = (final.worker_ledger_history ?? [])
    .filter((entry) => !decisionEntryIds.has(entry.entry_id))
    .filter((entry) => entry.round_no === undefined || entry.round_no >= decision.round_no)
    .sort((left, right) => (left.step_index ?? 0) - (right.step_index ?? 0))
  const nextRoundObserved = nextRoundEvents.length > 0 && nextRoundUnits.length > 0
    && (final.current_stage !== "assessment"
      || final.round_no > decision.round_no
      || final.status === "blocked"
      || (final.status === "waiting_for_user" && final.waiting_for?.type === "assessment_answers"))
  if (!nextRoundObserved) throw new Error("no next-round execution observed after the feedback decision")
  const outputDirectory = dirname(outputFile)
  const refs = [decisionPath, finalPath, eventsPath]
    .map((path) => relative(outputDirectory, path).replaceAll("\\", "/"))
  const score = decision.feedback.round_score ?? {}
  const entry: Day4DecisionLedgerEntry = {
    schema_version: "1.0",
    entry_id: `${decision.session_id}:round-${decision.round_no}:decision`,
    session_id: decision.session_id,
    run_id: decision.run_id ?? null,
    round_no: decision.round_no,
    assessment_result: {
      feedback_id: decision.feedback.feedback_id,
      raw_score: finiteOrNull(score.raw_score),
      max_score: finiteOrNull(score.max_score),
      accuracy: finiteOrNull(score.accuracy),
      evidence_score: finiteOrNull(score.evidence_score),
    },
    decision: {
      source: {
        decision_owner: "role-c",
        output_field: "feedback.final_decision",
        applied_by: "main-agent",
      },
      action,
      reason_codes: decision.feedback.final_decision.reason_codes ?? [],
      target_objective_ids: decision.feedback.final_decision.target_objective_ids ?? [],
      confidence: finiteOrNull(decision.feedback.final_decision.confidence),
      basis: decision.feedback.final_decision.basis ?? null,
      policy_ref: decision.feedback.final_decision.policy_ref ?? null,
      target_node_id: decision.next_round_action.target_node_id,
    },
    state_transition: {
      from_stage: "assessment",
      to_stage: final.current_stage,
      next_round_status: decision.next_round_action.status,
    },
    next_round_execution: {
      observed: true,
      event_refs: nextRoundEvents.map((event) => event.event_id),
      units: nextRoundUnits.map((unit) => ({
        entry_id: unit.entry_id,
        unit_name: unit.unit_name,
        execution_type: unit.execution_type,
        stage: unit.stage,
        status: unit.status,
        summary: unit.summary ?? null,
        input_refs: refIds(unit.input_refs),
        output_refs: refIds(unit.output_refs),
        evidence_refs: refIds(unit.evidence_refs),
        error_codes: (unit.errors ?? []).map((error) => error.code).filter((code): code is string => Boolean(code)),
      })),
      final_status: final.status,
      final_stage: final.current_stage,
    },
    evidence_refs: refs,
    observability: {
      evidence_classification: "requires_acceptance_review",
      verified_conditions: [
        "session_identity_matched",
        "feedback_action_matched",
        "next_round_execution_observed",
      ],
      limitations: final.status === "blocked"
        ? ["下一轮真实调用已经发生，但本次运行最终被发布门禁阻塞。"]
        : [],
    },
  }
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(outputFile, `${JSON.stringify(entry)}\n`, "utf8")
  return { entry }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T
}

function validateEvidence(decision: PublicSessionSnapshot, final: PublicSessionSnapshot, events: PublicEventsFile): void {
  if (!decision.session_id || decision.session_id !== final.session_id || decision.session_id !== events.session_id) {
    throw new Error("session ids do not match across Day4 evidence files")
  }
  if (decision.run_id && final.run_id && decision.run_id !== final.run_id) {
    throw new Error("run ids do not match across Day4 evidence files")
  }
  if (!decision.feedback?.final_decision || !decision.next_round_action) {
    throw new Error("decision snapshot lacks feedback or next_round_action")
  }
  if (decision.feedback.feedback_id !== decision.next_round_action.feedback_id) {
    throw new Error("feedback and next_round_action references do not match")
  }
  if (decision.feedback.final_decision.action !== decision.next_round_action.action) {
    throw new Error("feedback and next_round_action actions do not match")
  }
  if (decision.round_no !== decision.next_round_action.round_no) {
    throw new Error("decision and next_round_action round numbers do not match")
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function refIds(refs: WorkerReference[] | undefined): string[] {
  return (refs ?? []).map((ref) => ref.ref_id).filter(Boolean)
}
