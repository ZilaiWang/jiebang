import { contentHash } from "../contracts/common"
import type { ModelGateway } from "../contracts/model-gateway"
import { EVALUATOR_GRADER_PROMPT_VERSION, EVALUATOR_GRADER_SYSTEM_PROMPT } from "../prompts"
import { getRoleCModelOutputSchema, validateRoleCSchema } from "../validators/runtime-schema-validator"
import type { BlindRubricJudge, BlindRubricJudgeRequest, BlindRubricJudgeResult } from "./grade-submission"

export class ModelBackedBlindRubricJudge implements BlindRubricJudge {
  readonly grader_version: string

  constructor(private readonly gateway: ModelGateway) {
    this.grader_version = `${EVALUATOR_GRADER_PROMPT_VERSION}:${gateway.model_config_hash}`
  }

  async judge(request: BlindRubricJudgeRequest): Promise<BlindRubricJudgeResult> {
    const output = await this.gateway.generateStructured<unknown>({
      task: "role-c.tiered-evaluator.rubric-judge",
      system_prompt: EVALUATOR_GRADER_SYSTEM_PROMPT,
      input: structuredClone(request),
      output_schema_id: "role_c_blind_rubric_judgment_v1",
      output_schema: getRoleCModelOutputSchema("rubric_judgment.schema.json"),
      temperature: 0,
      max_tokens: 1_500,
      idempotency_key: `IDEMP-${contentHash({
        request,
        prompt_version: EVALUATOR_GRADER_PROMPT_VERSION,
        model_config_hash: this.gateway.model_config_hash,
      }).slice("sha256:".length)}`,
    })
    const report = validateRoleCSchema("rubric_judgment.schema.json", output)
    if (!report.ok) throw new Error(`INVALID_RUBRIC_JUDGMENT: ${report.issues.map((issue) => issue.message).join("; ")}`)
    return output as BlindRubricJudgeResult
  }
}
