/**
 * 验收：同一知识点 + remediate/reinforce → 讲义与测评必须真正不同（D 验收标准）。
 *
 * 走真实模型完整链路（审核 + reviewedRelease + adaptation 回传）：
 * 1. 首轮生成（基线）：无 next_round_context
 * 2. remediate 轮：同节点同 focus，action=remediate
 * 3. reinforce 轮：同节点同 focus，action=reinforce
 *
 * 断言：
 * - remediate/reinforce 轮的 reviewedRelease.adaptation 字段正确
 * - 两轮的讲义 hash 与测评 hash 均与首轮不同
 * - remediate 轮与 reinforce 轮互相不同
 *
 * 运行：bun scripts/role-c-adaptation-acceptance.ts
 */
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { executeProfileRetrieval } from "../src/role-b-profile/rag-bridge"
import type { LearnerProfile } from "../src/role-b-profile/types"
import {
  adaptLearnerProfile,
  adaptRagResult,
  buildGenerationSpec,
  createRoleCModelGatewayFromEnv,
  defineLearningPathNode,
  ROLE_C_PROMPT_MANIFEST_VERSION,
  type LearningPathNode,
} from "../src/role-c-content"
import { generateRoleCForRoleDWithRuntime } from "../src/role-d-integration/role-c-service"
import { contentHash } from "../src/role-c-content/contracts/common"
import type { RoleCReviewedReleaseDelivery } from "../src/role-c-content/contracts/external-api"

const profile: LearnerProfile = {
  learner_id: "acceptance-runner",
  level: "basic",
  known_concepts: ["变量", "条件判断"],
  weak_concepts: ["循环", "列表", "成绩统计"],
  goal: "完成循环、列表和成绩统计练习",
}
const gateway = createRoleCModelGatewayFromEnv(process.env)
const kb = await loadKnowledgeBase()
const { rag_result: ragResult } = await executeProfileRetrieval(profile)
const evidencePack = adaptRagResult(ragResult, { kb_version: kb.version, rag_version: "acceptance" })
const rawPath = await Bun.file("examples/role-c-content/learning_path_node_score_project.json").json()
const pathNode: LearningPathNode = defineLearningPathNode({
  node_id: rawPath.node_id,
  target_source_ids: rawPath.target_source_ids,
  prerequisite_source_ids: rawPath.prerequisite_source_ids,
  goal: rawPath.goal,
  objectives: structuredClone(rawPath.objectives),
  assessment_blueprint: structuredClone(rawPath.assessment_blueprint),
})
const built = buildGenerationSpec({
  run_id: `RUN-ACCEPTANCE-${Date.now()}`,
  profile_snapshot: adaptLearnerProfile(profile, { profile_version: "acceptance-v1" }),
  path_node: pathNode,
  evidence_pack: evidencePack,
  versions: {
    prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
    model_config_hash: gateway.model_config_hash,
  },
  seed: 29,
})
if (!built.ok) throw new Error(JSON.stringify(built))

const spec = built.spec
// 验收重点是 next_round_context 驱动的内容差异，非 A/B 审核——使用直接通过的审核端口，
// 避免修订循环把每轮生成放大 2-3 倍。
const runtime = {
  providerMode: "model" as const,
  dataDirectory: ".tmp/acceptance",
  reviewPort: {
    policy_version: "acceptance-review-v1",
    async review(request: {
      run_id: string
      pipeline_input_hash: string
      generation_spec_hash: string
      revision_round: number
      max_revision_rounds: number
      evidence_hash: string
      artifacts: Array<{ kind: string; artifact: { artifact_id: string }; artifact_hash: string }>
    }) {
      return {
        run_id: request.run_id,
        pipeline_input_hash: request.pipeline_input_hash,
        generation_spec_hash: request.generation_spec_hash,
        policy_version: "acceptance-review-v1",
        revision_round: request.revision_round,
        max_revision_rounds: request.max_revision_rounds,
        evidence_hash: request.evidence_hash,
        decision: "pass" as const,
        artifact_results: request.artifacts.map((target) => ({
          artifact_kind: target.kind,
          artifact_id: target.artifact.artifact_id,
          artifact_hash: target.artifact_hash,
          fact_status: "pass" as const,
          teaching_status: "pass" as const,
          decision: "pass" as const,
          can_revise: false,
          findings: [],
          revision_instructions: [],
        })),
        revision_instructions: [],
      }
    },
  },
}
const baseInput = {
  profile,
  ragResult,
  kbVersion: kb.version,
  pathNode,
}

function adaptationOf(delivery: RoleCReviewedReleaseDelivery | undefined) {
  return delivery?.adaptation
}

function hashes(delivery: RoleCReviewedReleaseDelivery) {
  const concept = delivery.artifacts[0]
  const assessment = delivery.artifacts[2]
  return {
    lesson: contentHash(concept.payload),
    assessment: contentHash(assessment.payload),
  }
}

// 1. 首轮基线（无 next_round_context）
console.error(`[acceptance] ${new Date().toISOString()} 基线生成开始…`)
const baselineT0 = Date.now()
const baseline = await generateRoleCForRoleDWithRuntime({
  ...baseInput,
  runId: `${spec.run_id}-BASELINE`,
}, runtime)
console.error(`[acceptance] ${new Date().toISOString()} 基线完成（${((Date.now() - baselineT0) / 1000).toFixed(0)}s）`)
if (baseline.status !== "ready" || !baseline.reviewedRelease) {
  throw new Error(`基线生成失败：${(baseline as { reason?: string }).reason}`)
}
const baseHashes = hashes(baseline.reviewedRelease)
console.log("基线: lesson", baseHashes.lesson.slice(0, 16), "| assessment", baseHashes.assessment.slice(0, 16))

// 2. remediate 轮（同节点同 focus）
const remediateContext = {
  request_id: "ACCEPT-REMEDIATE",
  parent_spec_id: spec.spec_id,
  prior_feedback_ref: "FB-ACCEPT-R",
  trigger_grade_artifact_id: "GRADE-ACCEPT-R",
  action: "remediate" as const,
  focus_objective_ids: ["O1"],
  reason_codes: ["round_accuracy_below_remediation_threshold"],
  misconception_tags: ["integer_division"],
}
console.error(`[acceptance] ${new Date().toISOString()} remediate 轮开始…`)
const remediateT0 = Date.now()
const remediate = await generateRoleCForRoleDWithRuntime({
  ...baseInput,
  runId: `${spec.run_id}-REMEDIATE`,
  next_round_context: remediateContext,
}, runtime)
console.error(`[acceptance] ${new Date().toISOString()} remediate 轮完成（${((Date.now() - remediateT0) / 1000).toFixed(0)}s）`)
if (remediate.status !== "ready" || !remediate.reviewedRelease) {
  throw new Error(`remediate 轮失败：${(remediate as { reason?: string }).reason}`)
}
const remediateHashes = hashes(remediate.reviewedRelease)

// 3. reinforce 轮（同节点同 focus）
const reinforceContext = {
  ...remediateContext,
  request_id: "ACCEPT-REINFORCE",
  prior_feedback_ref: "FB-ACCEPT-N",
  trigger_grade_artifact_id: "GRADE-ACCEPT-N",
  action: "reinforce" as const,
  reason_codes: ["round_accuracy_below_reinforce_threshold"],
}
console.error(`[acceptance] ${new Date().toISOString()} reinforce 轮开始…`)
const reinforceT0 = Date.now()
const reinforce = await generateRoleCForRoleDWithRuntime({
  ...baseInput,
  runId: `${spec.run_id}-REINFORCE`,
  next_round_context: reinforceContext,
}, runtime)
console.error(`[acceptance] ${new Date().toISOString()} reinforce 轮完成（${((Date.now() - reinforceT0) / 1000).toFixed(0)}s）`)
if (reinforce.status !== "ready" || !reinforce.reviewedRelease) {
  throw new Error(`reinforce 轮失败：${(reinforce as { reason?: string }).reason}`)
}
const reinforceHashes = hashes(reinforce.reviewedRelease)

// 断言（D 验收标准）
const checks = [
  {
    name: "remediate adaptation_action",
    ok: adaptationOf(remediate.reviewedRelease)?.adaptation_action === "remediate",
    detail: JSON.stringify(adaptationOf(remediate.reviewedRelease)),
  },
  {
    name: "reinforce adaptation_action",
    ok: adaptationOf(reinforce.reviewedRelease)?.adaptation_action === "reinforce",
    detail: JSON.stringify(adaptationOf(reinforce.reviewedRelease)),
  },
  {
    name: "remediate misconception_tags 透传",
    ok: JSON.stringify(adaptationOf(remediate.reviewedRelease)?.addressed_misconception_tags ?? [])
      .includes("integer_division"),
  },
  {
    name: "remediate 讲义 ≠ 首轮",
    ok: remediateHashes.lesson !== baseHashes.lesson,
    detail: `${remediateHashes.lesson.slice(0, 16)} vs ${baseHashes.lesson.slice(0, 16)}`,
  },
  {
    name: "remediate 测评 ≠ 首轮",
    ok: remediateHashes.assessment !== baseHashes.assessment,
  },
  {
    name: "reinforce 讲义 ≠ 首轮",
    ok: reinforceHashes.lesson !== baseHashes.lesson,
  },
  {
    name: "reinforce 测评 ≠ 首轮",
    ok: reinforceHashes.assessment !== baseHashes.assessment,
  },
  {
    name: "remediate 讲义 ≠ reinforce 讲义",
    ok: remediateHashes.lesson !== reinforceHashes.lesson,
  },
  {
    name: "remediate 测评 ≠ reinforce 测评",
    ok: remediateHashes.assessment !== reinforceHashes.assessment,
  },
]

const failed = checks.filter((check) => !check.ok)
console.log(JSON.stringify({
  workflow: "RoleC_Adaptation_Acceptance",
  checks: checks.map((check) => ({
    name: check.name,
    ok: check.ok,
    ...(check.detail ? { detail: check.detail } : {}),
  })),
  summary: { passed: checks.length - failed.length, failed: failed.length },
}, null, 2))
if (failed.length > 0) process.exit(1)
