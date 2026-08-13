import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { expect, test } from "bun:test"
import { exportSessionArtifactMap } from "../src/orchestration/artifact-map"
import type { InteractiveSessionRecord } from "../src/orchestration/interactive-session"

test("exports every available Agent output to a verified real artifact file", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-artifact-map-"))
  const sourceSessionPath = join(root, "runtime", "sessions", "SESSION-MAP.json")
  const outputDirectory = join(root, "evidence")
  const record = {
    schema_version: "1.0",
    revision: 1,
    session_id: "SESSION-MAP",
    run_id: "RUN-MAP",
    owner_id: "learner-map",
    mode: "deterministic",
    learner_request: { learner_id: "learner-map", goal: "学习 Python 循环" },
    status: "waiting_for_user",
    current_stage: "assessment",
    round_no: 1,
    waiting_for: { type: "assessment_answers", items: [] },
    worker_ledger: [
      { worker: "profile-builder", status: "completed", summary: "profile", updated_at: "2026-08-13T00:00:00.000Z" },
      { worker: "path-planner", status: "completed", summary: "path", updated_at: "2026-08-13T00:00:00.000Z" },
      { worker: "concept-tutor", status: "completed", summary: "lesson", updated_at: "2026-08-13T00:00:00.000Z" },
      { worker: "code-lab", status: "completed", summary: "lab", updated_at: "2026-08-13T00:00:00.000Z" },
      { worker: "tiered-evaluator", status: "completed", summary: "assessment", updated_at: "2026-08-13T00:00:00.000Z" },
    ],
    worker_ledger_history: [],
    profile: { profile_id: "PROFILE-MAP" },
    formal_path: { path_id: "PATH-MAP" },
    current_path_node: { node_id: "NODE-MAP" },
    rag_result: { retrieval_id: "RAG-MAP", results: [{ source_id: "K001" }] },
    learning_resources: {
      concept_lesson: { artifact_id: "LESSON-MAP", artifact_type: "concept_lesson", status: "ready" },
      code_lab: { artifact_id: "LAB-MAP", artifact_type: "code_lab", status: "ready" },
    },
    assessment: { artifact_id: "ASSESSMENT-MAP", artifact_type: "assessment", status: "ready" },
    adaptation: null,
    code_execution: null,
    feedback: { final_decision: { action: "reinforce" } },
    blocked_reason: null,
    terminal_outcome: null,
    events: [],
    processed_commands: {},
    private: {
      diagnosis_answer_key: { D1: "secret-correct-answer" },
      diagnosis_answers: { D1: "learner-answer" },
      diagnosis_items: [{ item_id: "D1", question: "question" }],
      upstream_artifacts: {},
      next_round_context: null,
      assessment_history: [],
      role_c_generation_attempt: 1,
      role_c_failed_generations: 0,
      role_c_generation_recovery: null,
      profile_epoch: 0,
      node_remediate_rounds: 0,
      node_reinforce_rounds: 0,
      role_c: null,
    },
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
  } as unknown as InteractiveSessionRecord

  const map = await exportSessionArtifactMap({
    record,
    source_session_path: sourceSessionPath,
    output_directory: outputDirectory,
    review: { result: true, reports: ["A fact audit", "B teaching audit"] },
  })

  expect(map.main_agent).toBe("learning-orchestrator")
  expect(map.agents.map((entry) => entry.agent_name)).toEqual([
    "objective-diagnostician",
    "profile-builder",
    "path-planner",
    "knowledge-retriever",
    "concept-tutor",
    "code-lab",
    "tiered-evaluator",
    "content-review",
    "learning-orchestrator",
  ])
  const refs = map.agents.flatMap((entry) => entry.artifact_refs)
  expect(refs.length).toBe(11)
  expect(refs.every((ref) => ref.verified_exists && ref.content_hash.length === 64)).toBe(true)
  for (const ref of refs) {
    expect(await readFile(join(outputDirectory, ref.locator), "utf8")).not.toBe("")
  }
  expect(await readFile(join(outputDirectory, "diagnosis.json"), "utf8")).not.toContain("secret-correct-answer")
  expect(JSON.parse(await readFile(join(outputDirectory, "artifact-map.json"), "utf8"))).toEqual(map)
})
