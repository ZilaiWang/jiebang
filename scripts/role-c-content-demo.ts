import { loadKnowledgeBase } from "../src/knowledge/loader"
import { executeProfileRetrieval } from "../src/role-b-profile/rag-bridge"
import type { LearnerProfile } from "../src/role-b-profile/types"
import {
  adaptLearnerProfile,
  adaptRagResult,
  buildGenerationSpec,
  generateConceptLesson,
  ModelBackedRoleCContentProvider,
  modelBackedProviderOptionsFromEnv,
  ROLE_C_PROMPT_MANIFEST_VERSION,
} from "../src/role-c-content"
import { createRoleCModelGatewayFromEnv } from "../src/role-c-content/contracts/model-gateway"
import { buildInitialRoleCContext } from "../src/role-d-integration/initial-learning-path"

function resolveProvider(): ModelBackedRoleCContentProvider {
  try {
    const gateway = createRoleCModelGatewayFromEnv(process.env)
    return new ModelBackedRoleCContentProvider(gateway, modelBackedProviderOptionsFromEnv(process.env))
  } catch (error) {
    console.error("模型 Provider 不可用。请复制 .env.role-c.example 为 .env.role-c.local 并配置模型参数。")
    process.exit(1)
  }
}

const profile = (await Bun.file("examples/learner_loop_weak.json").json()) as LearnerProfile
const kb = await loadKnowledgeBase()
const { rag_request: ragRequest, rag_result: ragResult } = await executeProfileRetrieval(profile)
const initialContext = await buildInitialRoleCContext({
  profile,
  ragResult,
  knowledgeBase: kb,
})
if (!initialContext.ok) {
  throw new Error(`${initialContext.code}: ${initialContext.reason}`)
}

const profileSnapshot = adaptLearnerProfile(profile, {
  profile_version: "profile-demo-v1",
  provenance_ref: "examples/learner_loop_weak.json",
})
const pathNode = initialContext.pathNode
const evidencePack = adaptRagResult(initialContext.ragResult, {
  kb_version: kb.version,
  rag_version: "rule-rag-0.1",
})
const specResult = buildGenerationSpec({
  run_id: "RUN-C-CONTRACT-DEMO",
  profile_snapshot: profileSnapshot,
  path_node: pathNode,
  evidence_pack: evidencePack,
  versions: {
    prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
    model_config_hash: "deterministic-concept-reference-v1",
  },
  seed: 42,
})

const conceptArtifact = specResult.ok
  ? await generateConceptLesson(
      { generation_spec: specResult.spec, evidence_pack: evidencePack },
      resolveProvider(),
    )
  : undefined

console.log(JSON.stringify({
  workflow: "B_profile_and_path_to_A_evidence_to_C_verified_concept_lesson",
  status: conceptArtifact?.status === "ready" ? "concept_lesson_ready" : "blocked",
  b_to_a_rag_request: ragRequest,
  b_to_c_profile_snapshot: profileSnapshot,
  b_to_c_learning_path_node: pathNode,
  a_to_c_evidence_pack: evidencePack,
  c_intake_result: specResult,
  c_concept_artifact: conceptArtifact,
  publication_rule: "Only public artifacts go to D/browser; secure artifacts are persisted server-side and exposed by opaque ref only.",
}, null, 2))
