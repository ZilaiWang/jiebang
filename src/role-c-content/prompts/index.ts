// 公共策略（版本号 + 权威边界 + 个性化边界 + next_round 语义）
export * from "./common-policy"

// 分阶段修复模板
export { stagedRepairPrompt } from "./staged-repair.prompt"

// ── Concept Tutor（概念讲解） ──
export {
  CONCEPT_TUTOR_PROMPT_VERSION,
  CONCEPT_TUTOR_SYSTEM_PROMPT,
} from "./concept-tutor/system.prompt"
export { conceptTutorRepairPrompt } from "./concept-tutor/repair.prompt"
export {
  STAGED_AUTHOR_PROMPT_VERSION,
  CONCEPT_SEGMENT_SYSTEM_PROMPT,
} from "./concept-tutor/staged.prompt"

// ── Code Lab（代码实验） ──
export {
  CODE_LAB_PROMPT_VERSION,
  CODE_LAB_SYSTEM_PROMPT,
} from "./code-lab/system.prompt"
export { codeLabRepairPrompt } from "./code-lab/repair.prompt"
export { CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT } from "./code-lab/public-stage.prompt"
export { CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT } from "./code-lab/secure-stage.prompt"
export { CODE_LAB_EXECUTION_REPAIR_SYSTEM_PROMPT } from "./code-lab/execution-repair.prompt"
export { CODE_LAB_STARTER_REPAIR_SYSTEM_PROMPT } from "./code-lab/starter-repair.prompt"
export { CODE_LAB_PUBLIC_SAFETY_REPAIR_SYSTEM_PROMPT } from "./code-lab/public-safety-repair.prompt"

// ── Evaluator（分层测评：命题 + 评分 + 反馈） ──
export {
  EVALUATOR_AUTHOR_PROMPT_VERSION,
  EVALUATOR_AUTHOR_SYSTEM_PROMPT,
} from "./evaluator/author-system.prompt"
export { evaluatorAuthorRepairPrompt } from "./evaluator/author-repair.prompt"
export {
  EVALUATOR_FEEDBACK_PROMPT_VERSION,
  EVALUATOR_FEEDBACK_SYSTEM_PROMPT,
} from "./evaluator/feedback.prompt"
export {
  EVALUATOR_GRADER_PROMPT_VERSION,
  EVALUATOR_GRADER_SYSTEM_PROMPT,
} from "./evaluator/grader.prompt"
export {
  ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT,
  ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT,
  ASSESSMENT_EXECUTION_REPAIR_SYSTEM_PROMPT,
} from "./evaluator/staged.prompt"

// ── Critic（跨产物审查） ──
export {
  CROSS_ARTIFACT_CRITIC_PROMPT_VERSION,
  CROSS_ARTIFACT_CRITIC_SYSTEM_PROMPT,
} from "./critic/system.prompt"
