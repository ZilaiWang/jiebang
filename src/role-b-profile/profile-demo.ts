// 输入: examples/learner_evidence_loop_weak.json（三份证据样例）
// 输出: stdout JSON —— 两种格式：
//   1. 统一契约格式（通过 normalizeUnifiedHandoff 规范化）<默认>
//   2. 原始 B 格式（--raw 参数）
// 运行: bun src/role-b-profile/profile-demo.ts              # 统一契约格式
//       bun src/role-b-profile/profile-demo.ts --raw         # 原始 B 格式
// 作用: 不需要任何模型凭证即可验证 B 链路。统一契约格式验证 B 产出可以通过全链交接的规范化器。
import { loadKnowledgeBase } from "../knowledge/loader"
import { synthesizeProfile } from "./profile-synthesizer"
import { executeProfileRetrieval } from "./rag-bridge"
import { buildBHandoffPayload, buildUnifiedProfile, buildUnifiedProvenance } from "./unified-adapter"
import { normalizeUnifiedHandoff, unifiedBoundaryReport } from "../contracts/unified"
import type { BackgroundEvidence, ObjectiveDiagnosisEvidence, SelfAssessmentEvidence } from "./types"

const EVIDENCE_FILE = "examples/learner_evidence_loop_weak.json"

interface EvidenceBundle {
  description: string
  learner_request: string
  background: BackgroundEvidence
  self_assessment: SelfAssessmentEvidence
  objective_diagnosis: ObjectiveDiagnosisEvidence
}

const rawMode = process.argv.includes("--raw")
const bundle = (await Bun.file(EVIDENCE_FILE).json()) as EvidenceBundle
const knowledgeBase = await loadKnowledgeBase()

const synthesis = synthesizeProfile({
  background: bundle.background,
  selfAssessment: bundle.self_assessment,
  objectiveDiagnosis: bundle.objective_diagnosis,
  knowledgeBase,
})

const { rag_request, rag_result } = await executeProfileRetrieval(synthesis.profile)

if (rawMode) {
  // 原始 B 格式（向后兼容，用于调试/对比）
  console.log(
    JSON.stringify(
      {
        workflow: "B_evidence_to_profile_to_A_rag",
        evidence_source: EVIDENCE_FILE,
        learner_request: bundle.learner_request,
        b_profile: synthesis.profile,
        b_provenance: synthesis.provenance,
        a_rag_request: rag_request,
        a_rag_result_top: rag_result.results.map((item) => ({
          source_id: item.source_id,
          title: item.title,
          difficulty: item.difficulty,
          score: item.score,
          reason: item.reason,
        })),
      },
      null,
      2,
    ),
  )
} else {
  // 统一契约格式（默认）
  const bPayload = buildBHandoffPayload({
    synthesis,
    learnerRequest: bundle.learner_request,
  })

  // 穿过 A → B 全链规范化器（A 的 rag_result 也一起塞进去，验证整条链）
  const fullPayload = {
    ...bPayload,
    a_rag_result: rag_result,
    eventMode: "demo" as const,
    workflow_events: [
      {
        id: "evt-b-profile",
        agent: "B",
        stage: "profile_synthesis",
        status: "completed",
        summary: `画像构建完成：${synthesis.profile.known_concepts.length} 已掌握 / ${synthesis.profile.weak_concepts.length} 薄弱点`,
        timestamp: new Date().toISOString(),
      },
    ],
  }

  const handoff = normalizeUnifiedHandoff(fullPayload)
  const boundary = unifiedBoundaryReport(handoff)

  console.log(
    JSON.stringify(
      {
        boundary: boundary.boundary,
        schemaVersion: handoff.schemaVersion,
        handoff: handoff,
        evidenceGaps: boundary.evidenceGaps,
      },
      null,
      2,
    ),
  )
}
