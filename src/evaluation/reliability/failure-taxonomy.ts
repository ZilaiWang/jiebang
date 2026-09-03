import type {
  EvaluationFailureCategory,
  FailureClassification,
  RecoveryAction,
  ReliabilityStatus,
} from "./types"

interface Rule {
  category: EvaluationFailureCategory
  status: ReliabilityStatus
  action: RecoveryAction
  retryable: boolean
  patterns: RegExp[]
}

const RULES: Rule[] = [
  {
    category: "infrastructure", status: "infrastructure_unavailable", action: "operator_fix", retryable: false,
    patterns: [/余额不足|额度不足|insufficient[_ ](?:balance|quota)|invalid.api.key|unauthorized|authentication.failed|certificate verification|unable to verify|HTTP\s*(?:401|403)/iu],
  },
  {
    category: "infrastructure",
    status: "infrastructure_unavailable",
    action: "operator_fix",
    retryable: true,
    patterns: [
      /docker.*(?:daemon|unavailable|not running|connect)/iu,
      /runner[_ -]?unavailable/iu,
      /code[_ -]?runner[_ -]?unavailable/iu,
      /no such image|cannot connect to the docker daemon/iu,
    ],
  },
  {
    category: "model_transport",
    status: "retryable_error",
    action: "retry_transport",
    retryable: true,
    patterns: [
      /(?:\b429\b|rate limit|too many requests|quota|余额不足|额度不足)/iu,
      /(?:\b(?:HTTP|status|statusCode)[\s:=]*(?:5\d\d)\b|^5\d\d\b|gateway timeout|service unavailable|temporar(?:y|ily))/iu,
      /(?:timeout|timed out|network|econnreset|econnrefused|fetch failed)/iu,
      /REVIEW_TRANSPORT_ERROR|网络请求失败|socket.*closed/iu,
      /model_provider_circuit_(?:open|half_open)/iu,
      /model_execution_budget_exceeded:(?:deadline|transport_retries)/iu,
    ],
  },
  {
    category: "structured_output",
    status: "quality_fail",
    action: "repair_structured_output",
    retryable: true,
    patterns: [
      /invalid[_ -]?json|json.*(?:parse|非法|不是合法)|schema.*(?:error|invalid|additional properties)|structured[_ -]?output|output.*truncated/iu,
      /output_truncated/iu,
    ],
  },
  {
    category: "input_contract",
    status: "quality_fail",
    action: "no_retry",
    retryable: false,
    patterns: [
      /input[_ -]?drift|manifest[_ -]?drift|source[_ -]?drift|expectation[_ -]?mismatch/iu,
      /missing[_ -]?evidence|unknown[_ -]?source|unsupported[_ -]?behavior/iu,
      /preflight_failed/iu,
    ],
  },
  {
    category: "artifact_contract",
    status: "quality_fail",
    action: "repair_artifact",
    retryable: true,
    patterns: [
      /artifact[_ -]?task|contract|starter|tier|modality|objective.*coverage/iu,
      /public_quality_gate_failed/iu,
      /instructional_contract_mismatch/iu,
      /section.*(?:不允许|缺失|必须提供)|题量|必需题型/iu,
    ],
  },
  {
    category: "grounding",
    status: "quality_fail",
    action: "repair_artifact",
    retryable: true,
    patterns: [
      /ground|hallucin|unsupported[_ -]?(?:claim|citation|specialization)/iu,
      /external[_ -]?knowledge|semantic[_ -]?unsupported|missing[_ -]?evidence[_ -]?anchor/iu,
      /事实|引用不存在|无证据|幻觉/iu,
      /micro_check|REVIEW_REVISION_NOT_APPLIED/iu,
    ],
  },
  {
    category: "coverage",
    status: "quality_fail",
    action: "repair_artifact",
    retryable: true,
    patterns: [/coverage|核心知识|required[_ -]?fact/iu],
  },
  {
    category: "difficulty",
    status: "quality_fail",
    action: "rerun_difficulty_judge",
    retryable: true,
    patterns: [/difficulty|too[_ -]?hard|too[_ -]?easy|难度|适配/iu],
  },
  {
    category: "docker_execution",
    status: "quality_fail",
    action: "rerun_docker",
    retryable: true,
    patterns: [
      /assertion[_ -]?failed|runtime[_ -]?error|syntax[_ -]?error|execution[_ -]?failed/iu,
      /hidden[_ -]?test|public[_ -]?test|docker[_ -]?execution/iu,
      /参考实现未通过|可信执行器验证/iu,
    ],
  },
  {
    category: "audit_completeness",
    status: "incomplete",
    action: "rerun_audit",
    retryable: true,
    patterns: [/audit.*(?:missing|incomplete|uncertain|not[_ -]?run)|judge.*(?:missing|unavailable)/iu],
  },
  {
    category: "publication",
    status: "retryable_error",
    action: "rerun_publication",
    retryable: true,
    patterns: [/publish|reviewed[_ -]?release|ready_without|delivery/iu],
  },
  {
    category: "persistence",
    status: "retryable_error",
    action: "operator_fix",
    retryable: true,
    patterns: [/persist|checkpoint|write|read.*failed|enoent|eacces/iu],
  },
]

export function classifyEvaluationFailure(input: {
  message?: string
  code?: string
  issue_codes?: string[]
  stage?: string
}): FailureClassification {
  const text = [input.code, input.stage, ...(input.issue_codes ?? []), input.message]
    .filter(Boolean)
    .join(" | ")
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return {
        category: rule.category,
        status: rule.status,
        action: rule.action,
        retryable: rule.retryable,
        stage: input.stage,
        issue_codes: input.issue_codes ?? [],
        summary: input.message?.trim() || input.code?.trim() || rule.category,
      }
    }
  }
  return {
    category: "unknown",
    status: "incomplete",
    action: "operator_fix",
    retryable: false,
    stage: input.stage,
    issue_codes: input.issue_codes ?? [],
    summary: input.message?.trim() || input.code?.trim() || "unknown evaluation failure",
  }
}

export function classifyManyErrors(errors: string[]): FailureClassification[] {
  return errors.map((message) => classifyEvaluationFailure({ message }))
}
