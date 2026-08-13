// B 角色画像链 + 教学审核：统一入口
// 导出所有公开类型、函数、适配器
export type {
  LearnerProfile,
  ProfileConflict,
  ProfileProvenance,
  ProfileSynthesis,
  RagRequest,
  BackgroundEvidence,
  SelfAssessmentEvidence,
  ObjectiveDiagnosisEvidence,
  DiagnosisItem,
  DiagnosisVerdict,
  EvidenceQuote,
  ConceptProvenance,
} from "./types"

export { synthesizeProfile } from "./profile-synthesizer"
export type { SynthesizeProfileInput } from "./profile-synthesizer"

export { canonicalizeConcept, canonicalizeMany } from "./concept-canonicalizer"

export {
  buildRagQuery,
  buildRagRequest,
  executeProfileRetrieval,
  DEFAULT_TOP_K,
} from "./rag-bridge"

export { buildRoleBWorkerPrompt, ROLE_B_WORKER_NAMES } from "./prompts"

// 教学审核
export {
  auditTeaching,
  arbitrate,
  planRecoveryPath,
  receiveLearningProgress,
  applyProgressObservation,
  RoleBLearningProgressAdapter,
  buildFormalPath,
  advanceToNextNode,
  startPath,
  getPathStatus,
} from "./teaching-audit"
export type {
  TeachingAuditInput,
  TeachingAuditResult,
  TeachingAuditStatus,
  TeachingAuditVerdict,
  TeachingAuditDimension,
  RequiredAction,
  FixScope,
  ArbitrationInput,
  ArbitrationResult,
  ArbitrationDecision,
  PlanRecoveryPathInput,
  PlanRecoveryPathResult,
  ReceiveProgressInput,
  ReceiveProgressResult,
  ProgressObservation,
  ApplyProgressObservationInput,
  RoleBLearnerProgressRegistration,
  RoleBLearnerProgressState,
  RoleBLearningProgressAdapterOptions,
  FormalPathNode,
  FormalPathNodeStatus,
  FormalLearningPath,
  BuildFormalPathInput,
  AdvancePathInput,
  AdvancePathResult,
  FormalPathStatus,
} from "./teaching-audit"

// 统一 IO 契约适配器
export {
  buildUnifiedProfile,
  buildUnifiedConflicts,
  buildUnifiedProvenance,
  buildUnifiedBSynthesis,
  buildUnifiedTeachingAudit,
  buildUnifiedArbitration,
  buildBHandoffPayload,
} from "./unified-adapter"
export type { BuildBHandoffInput } from "./unified-adapter"
