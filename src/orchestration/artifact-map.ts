import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import type { InteractiveSessionRecord, WorkerLedgerHistoryEntry } from "./interactive-session"

export type ArtifactProducer =
  | "objective-diagnostician"
  | "profile-builder"
  | "path-planner"
  | "knowledge-retriever"
  | "concept-tutor"
  | "code-lab"
  | "tiered-evaluator"
  | "content-review"
  | "learning-orchestrator"

export interface AgentArtifactFileRef {
  ref_id: string
  artifact_kind: "diagnosis" | "profile" | "learning_path" | "knowledge" | "lesson" | "code_lab" | "assessment" | "audit" | "decision" | "worker_ledger" | "session"
  locator: string
  content_hash: string
  visibility: "public" | "internal"
  verified_exists: true
}

export interface AgentArtifactMapEntry {
  agent_name: ArtifactProducer
  current_stage: string
  execution_status: "completed" | "waiting_for_user" | "running" | "blocked" | "failed" | "not_produced"
  input_evidence_refs: string[]
  artifact_refs: AgentArtifactFileRef[]
  next_step_suggestion: string | null
  errors: Array<{ code?: string; message: string; severity: string }>
  retry_needed: boolean
  blocked: boolean
}

export interface AgentArtifactMap {
  schema_version: "1.0"
  main_agent: "learning-orchestrator"
  session_id: string
  run_id: string
  generated_at: string
  source_session: string
  agents: AgentArtifactMapEntry[]
}

export interface ExportSessionArtifactMapInput {
  record: InteractiveSessionRecord
  source_session_path: string
  output_directory: string
  review?: unknown
}

interface ArtifactSnapshot {
  producer: ArtifactProducer
  artifact_kind: AgentArtifactFileRef["artifact_kind"]
  file_name: string
  value: unknown
  visibility: AgentArtifactFileRef["visibility"]
}

/**
 * Export the artifacts already present in a real persisted session. The map is
 * derived from session state; it does not fabricate missing worker outputs.
 */
export async function exportSessionArtifactMap(
  input: ExportSessionArtifactMapInput,
): Promise<AgentArtifactMap> {
  const outputDirectory = resolve(input.output_directory)
  await mkdir(outputDirectory, { recursive: true })

  const snapshots = artifactSnapshots(input.record, input.review)
  const refsByProducer = new Map<ArtifactProducer, AgentArtifactFileRef[]>()
  for (const snapshot of snapshots) {
    if (snapshot.value === null || snapshot.value === undefined) continue
    const path = resolve(outputDirectory, snapshot.file_name)
    const serialized = `${JSON.stringify(snapshot.value, null, 2)}\n`
    await writeFile(path, serialized, "utf8")
    const ref: AgentArtifactFileRef = {
      ref_id: `${snapshot.producer}:${snapshot.artifact_kind}`,
      artifact_kind: snapshot.artifact_kind,
      locator: relative(outputDirectory, path),
      content_hash: sha256(serialized),
      visibility: snapshot.visibility,
      verified_exists: true,
    }
    refsByProducer.set(snapshot.producer, [...(refsByProducer.get(snapshot.producer) ?? []), ref])
  }

  const agents = ARTIFACT_PRODUCERS.map((producer) => mapEntry(
    producer,
    input.record,
    refsByProducer.get(producer) ?? [],
  ))
  const artifactMap: AgentArtifactMap = {
    schema_version: "1.0",
    main_agent: "learning-orchestrator",
    session_id: input.record.session_id,
    run_id: input.record.run_id,
    generated_at: new Date().toISOString(),
    source_session: relative(outputDirectory, resolve(input.source_session_path)),
    agents,
  }
  await writeFile(
    resolve(outputDirectory, "artifact-map.json"),
    `${JSON.stringify(artifactMap, null, 2)}\n`,
    "utf8",
  )
  return artifactMap
}

const ARTIFACT_PRODUCERS: ArtifactProducer[] = [
  "objective-diagnostician",
  "profile-builder",
  "path-planner",
  "knowledge-retriever",
  "concept-tutor",
  "code-lab",
  "tiered-evaluator",
  "content-review",
  "learning-orchestrator",
]

function artifactSnapshots(record: InteractiveSessionRecord, review: unknown): ArtifactSnapshot[] {
  const diagnosisItems = record.private?.diagnosis_items ?? []
  const diagnosis = diagnosisItems.length > 0
    ? { items: diagnosisItems, learner_answers: record.private?.diagnosis_answers ?? null }
    : null
  const reviewedArtifacts = [
    record.learning_resources?.concept_lesson,
    record.learning_resources?.code_lab,
    record.assessment,
  ].filter((value) => value !== null && value !== undefined)
  const audit = review ?? (reviewedArtifacts.length === 3 ? buildPublicAuditSnapshot(record) : null)
  return [
    { producer: "objective-diagnostician", artifact_kind: "diagnosis", file_name: "diagnosis.json", value: diagnosis, visibility: "internal" },
    { producer: "profile-builder", artifact_kind: "profile", file_name: "profile.json", value: record.profile, visibility: "internal" },
    { producer: "path-planner", artifact_kind: "learning_path", file_name: "learning-path.json", value: record.formal_path ? { formal_path: record.formal_path, current_path_node: record.current_path_node } : null, visibility: "internal" },
    { producer: "knowledge-retriever", artifact_kind: "knowledge", file_name: "rag-result.json", value: record.rag_result, visibility: "internal" },
    { producer: "concept-tutor", artifact_kind: "lesson", file_name: "concept-lesson.json", value: record.learning_resources?.concept_lesson, visibility: "public" },
    { producer: "code-lab", artifact_kind: "code_lab", file_name: "code-lab.json", value: record.learning_resources?.code_lab, visibility: "public" },
    { producer: "tiered-evaluator", artifact_kind: "assessment", file_name: "assessment.json", value: record.assessment, visibility: "public" },
    { producer: "content-review", artifact_kind: "audit", file_name: "audit.json", value: audit, visibility: "internal" },
    { producer: "learning-orchestrator", artifact_kind: "decision", file_name: "decision.json", value: record.feedback, visibility: "internal" },
    { producer: "learning-orchestrator", artifact_kind: "worker_ledger", file_name: "worker-ledger.json", value: (record.worker_ledger_history?.length ?? 0) > 0 ? record.worker_ledger_history : record.worker_ledger, visibility: "internal" },
    { producer: "learning-orchestrator", artifact_kind: "session", file_name: "session-public.json", value: publicSessionSnapshot(record), visibility: "internal" },
  ]
}

function buildPublicAuditSnapshot(record: InteractiveSessionRecord): unknown {
  const artifacts = [
    record.learning_resources?.concept_lesson,
    record.learning_resources?.code_lab,
    record.assessment,
  ].filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
  return {
    result: artifacts.length === 3 && artifacts.every((artifact) => artifact.status === "ready"),
    artifacts: artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id ?? null,
      artifact_type: artifact.artifact_type ?? null,
      status: artifact.status ?? null,
      quality: artifact.quality ?? null,
      trace_ref: artifact.trace_ref ?? null,
    })),
    note: "正式审核细节由 Role C 运行记录保存；此文件只汇总会话中已发布的审核结果。",
  }
}

function publicSessionSnapshot(record: InteractiveSessionRecord): unknown {
  const {
    private: _private,
    processed_commands: _processedCommands,
    owner_id: _ownerId,
    learner_request: _learnerRequest,
    ...publicFields
  } = record
  return publicFields
}

function mapEntry(
  producer: ArtifactProducer,
  record: InteractiveSessionRecord,
  artifactRefs: AgentArtifactFileRef[],
): AgentArtifactMapEntry {
  const ledger = latestLedgerEntry(producer, record.worker_ledger_history ?? [])
  const publicLedger = record.worker_ledger.find((entry) => entry.worker === producer)
  const rawStatus = producer === "learning-orchestrator"
    ? record.status
    : ledger?.status ?? publicLedger?.status
  const executionStatus = normalizeStatus(rawStatus, artifactRefs.length)
  const errors = ledger?.errors ?? []
  return {
    agent_name: producer,
    current_stage: ledger?.stage ?? stageForProducer(producer),
    execution_status: executionStatus,
    input_evidence_refs: ledger?.input_refs.map((ref) => ref.ref_id) ?? defaultInputRefs(producer),
    artifact_refs: artifactRefs,
    next_step_suggestion: ledger?.next_action ?? nextStepForProducer(producer, executionStatus),
    errors: errors.map((error) => ({ code: error.code, message: error.message, severity: error.severity })),
    retry_needed: ledger?.retry?.scheduled === true || executionStatus === "failed",
    blocked: executionStatus === "blocked",
  }
}

function latestLedgerEntry(
  producer: ArtifactProducer,
  ledger: WorkerLedgerHistoryEntry[],
): WorkerLedgerHistoryEntry | undefined {
  if (producer === "knowledge-retriever") {
    return [...ledger].reverse().find((entry) => entry.unit_name === "path-planner")
  }
  if (producer === "content-review") {
    return [...ledger].reverse().find((entry) => ["concept-tutor", "code-lab", "tiered-evaluator"].includes(entry.unit_name))
  }
  if (producer === "learning-orchestrator") return undefined
  return [...ledger].reverse().find((entry) => entry.unit_name === producer)
}

function normalizeStatus(
  status: string | undefined,
  artifactCount: number,
): AgentArtifactMapEntry["execution_status"] {
  if (status === "waiting_for_user" || status === "running" || status === "blocked" || status === "failed") return status
  if (status === "completed" || artifactCount > 0) return "completed"
  return "not_produced"
}

function stageForProducer(producer: ArtifactProducer): string {
  if (["objective-diagnostician", "profile-builder", "path-planner", "knowledge-retriever"].includes(producer)) return "objective_diagnosis"
  if (["concept-tutor", "code-lab", "tiered-evaluator", "content-review"].includes(producer)) return "assessment"
  return "orchestration"
}

function defaultInputRefs(producer: ArtifactProducer): string[] {
  if (producer === "profile-builder") return ["objective-diagnostician:diagnosis"]
  if (producer === "path-planner") return ["profile-builder:profile"]
  if (producer === "knowledge-retriever") return ["profile-builder:profile", "path-planner:learning_path"]
  if (producer === "concept-tutor") return ["profile-builder:profile", "path-planner:learning_path", "knowledge-retriever:knowledge"]
  if (producer === "code-lab") return ["concept-tutor:lesson"]
  if (producer === "tiered-evaluator") return ["concept-tutor:lesson", "code-lab:code_lab"]
  if (producer === "content-review") return ["concept-tutor:lesson", "code-lab:code_lab", "tiered-evaluator:assessment"]
  if (producer === "learning-orchestrator") return ["content-review:audit"]
  return []
}

function nextStepForProducer(
  producer: ArtifactProducer,
  status: AgentArtifactMapEntry["execution_status"],
): string | null {
  if (status === "blocked" || status === "failed") return `retry-or-replan:${producer}`
  if (producer === "learning-orchestrator") return null
  const index = ARTIFACT_PRODUCERS.indexOf(producer)
  return ARTIFACT_PRODUCERS[index + 1] ?? null
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
