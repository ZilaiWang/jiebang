import type { GradeFeedback, GradeItemResult, GradeResultPayload } from "../contracts/artifacts"
import { contentHash } from "../contracts/common"
import type { ModelGateway } from "../contracts/model-gateway"
import {
  EVALUATOR_FEEDBACK_PROMPT_VERSION,
  EVALUATOR_FEEDBACK_SYSTEM_PROMPT,
} from "../prompts"
import { validatePublicArtifactNoSecrets } from "../validators/public-secure-leak-validator"
import { getRoleCModelOutputSchema, validateRoleCSchema } from "../validators/runtime-schema-validator"

export interface GradeFeedbackGeneratorInput {
  mode: GradeFeedback["mode"]
  frozen_score: Pick<GradeResultPayload,
    "submission_id" | "form_id" | "score_frozen" | "raw_score" | "max_score" | "evidence_score">
  recommendation: GradeResultPayload["recommendation"]
  item_results: Array<Pick<GradeItemResult,
    "item_id" | "objective_id" | "raw_score" | "max_score" | "feedback_code" | "misconception_tags">>
}

export interface GradeFeedbackGenerator {
  readonly feedback_version: string
  generate(input: GradeFeedbackGeneratorInput): Promise<GradeFeedback>
}

/** The model sees only already-public frozen results; secure answers never cross this boundary. */
export class ModelBackedGradeFeedbackGenerator implements GradeFeedbackGenerator {
  readonly feedback_version: string

  constructor(private readonly gateway: ModelGateway) {
    this.feedback_version = `${EVALUATOR_FEEDBACK_PROMPT_VERSION}:${gateway.model_config_hash}`
  }

  async generate(input: GradeFeedbackGeneratorInput): Promise<GradeFeedback> {
    if (input.frozen_score.score_frozen !== true) throw new Error("FEEDBACK_SCORE_NOT_FROZEN")
    const output = await this.gateway.generateStructured<unknown>({
      task: "role-c.tiered-evaluator.feedback",
      system_prompt: EVALUATOR_FEEDBACK_SYSTEM_PROMPT,
      input: structuredClone(input),
      output_schema_id: "role_c_grade_feedback_v1",
      output_schema: getRoleCModelOutputSchema("grade_feedback.schema.json"),
      temperature: 0.2,
      max_tokens: 2_500,
      idempotency_key: `IDEMP-${contentHash({
        input,
        prompt_version: EVALUATOR_FEEDBACK_PROMPT_VERSION,
        model_config_hash: this.gateway.model_config_hash,
      }).slice("sha256:".length)}`,
    })
    const schema = validateRoleCSchema("grade_feedback.schema.json", output)
    if (!schema.ok) throw new Error(`INVALID_GRADE_FEEDBACK:${schema.issues.map((issue) => issue.path).join(",")}`)
    const feedback = output as GradeFeedback
    const issues = validateFeedbackContract(input, feedback)
    if (issues.length > 0) throw new Error(`INVALID_GRADE_FEEDBACK_CONTRACT:${issues.join(";")}`)
    return feedback
  }
}

export function validateFeedbackContract(
  input: GradeFeedbackGeneratorInput,
  feedback: GradeFeedback,
): string[] {
  const issues: string[] = []
  if (feedback.generated_after_score_freeze !== true) issues.push("反馈未声明在成绩冻结后生成")
  if (feedback.mode !== input.mode) issues.push("反馈模式与请求不一致")
  const expected = new Map(input.item_results.map((item) => [item.item_id, item.feedback_code]))
  const seen = new Set<string>()
  for (const item of feedback.item_feedback) {
    if (seen.has(item.item_id)) issues.push(`反馈 item_id 重复：${item.item_id}`)
    seen.add(item.item_id)
    if (!expected.has(item.item_id)) issues.push(`反馈包含未知 item_id：${item.item_id}`)
    else if (expected.get(item.item_id) !== item.feedback_code) issues.push(`反馈改写了 feedback_code：${item.item_id}`)
  }
  for (const itemId of expected.keys()) {
    if (!seen.has(itemId)) issues.push(`反馈缺少 item_id：${itemId}`)
  }
  const leak = validatePublicArtifactNoSecrets(feedback)
  issues.push(...leak.issues.map((issue) => `${issue.path}: ${issue.message}`))
  return [...new Set(issues)]
}
