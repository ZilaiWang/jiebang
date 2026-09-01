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

// 画像构建 v2：结构化采集、有限主动追问、动态更新和资源侧交接接口。
export {
  assessProfileIntake,
  applyProfileClarificationAnswer,
  createLearnerProfileV2,
  updateLearnerProfileV2,
  updateLearnerProfileFromAnswers,
  buildRoleCProfileSnapshotOptions,
  buildPersonalizationProfileHandoff,
  isLearnerProfileV2,
} from "./learner-profile-v2"
export type {
  LearnerProfileIntakeV2,
  LearnerProfileV2,
  LearningGoalUseCase,
  ExplanationPreference,
  PracticePreference,
  LearningPacePreference,
  ProfileRetention,
  ProfilePrivacyPreferences,
  ProfileFieldSource,
  ProfileFieldProvenance,
  ProfileClarificationQuestionId,
  ProfileClarificationOption,
  ProfileClarificationQuestion,
  ProfileClarificationAnswer,
  ProfileIntakeAssessment,
  CreateLearnerProfileV2Input,
  PersonalizationProfileHandoff,
  UpdateLearnerProfileV2Input,
  UpdateLearnerProfileV2Result,
  UpdateLearnerProfileFromAnswersInput,
  UpdateLearnerProfileFromAnswersResult,
} from "./learner-profile-v2"

export { buildRoleCPedagogyContract } from "./pedagogy-contract"
export type { RoleCPedagogyContract, LearningTimeHorizon } from "./pedagogy-contract"
export { buildRoleCExpressionContext, classifyDisciplineFamily, classifyAudienceRegister } from "./expression-context-contract"
export type {
  RoleCExpressionContext,
  DisciplineFamily,
  AudienceRegister,
  ExplanationFrame,
  TerminologyBridge,
  ComparisonStyle,
} from "./expression-context-contract"
export { PROFILE_V2_FIELD_CONSUMPTION, PROFILE_V2_CONSUMABLE_FIELDS, PROFILE_V2_AUDITED_FIELDS, unownedProfileV2Fields } from "./profile-field-consumption"
export type { ProfileFieldDisposition } from "./profile-field-consumption"
