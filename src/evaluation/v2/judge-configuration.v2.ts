/** Explicit evaluation choice; sharing a model never counts as cross-model validation. */
export function resolveEvaluationJudgeEnvV2(
  env: Record<string, string | undefined>,
  options: { development: boolean; sameModel: boolean },
): Record<string, string | undefined> | undefined {
  if (options.sameModel) return { ...env }
  const values = [env.COMPETITION_JUDGE_MODEL_ID, env.COMPETITION_JUDGE_ENDPOINT, env.COMPETITION_JUDGE_API_KEY]
  if (values.some(Boolean) && !values.every(value => value?.trim())) {
    throw new Error("EVALUATION_JUDGE_CONFIG_INCOMPLETE")
  }
  if (!values.every(Boolean)) {
    if (options.development) return undefined
    throw new Error("EVALUATION_JUDGE_REQUIRED: configure a judge or explicitly use --self-audit")
  }
  return {
    ...env,
    MODEL_RUNTIME_MODEL_ID: env.COMPETITION_JUDGE_MODEL_ID,
    MODEL_RUNTIME_ENDPOINT: env.COMPETITION_JUDGE_ENDPOINT,
    MODEL_RUNTIME_API_KEY: env.COMPETITION_JUDGE_API_KEY,
    ROLE_C_MODEL_ID: env.COMPETITION_JUDGE_MODEL_ID,
    ROLE_C_MODEL_ENDPOINT: env.COMPETITION_JUDGE_ENDPOINT,
    ROLE_C_MODEL_API_KEY: env.COMPETITION_JUDGE_API_KEY,
    ROLE_C_MODEL_THINKING: env.COMPETITION_JUDGE_THINKING ?? "disabled",
  }
}

export function evaluationJudgeModeV2(generationModel: string, judgeModel?: string): "not_configured" | "same_model_separate_calls" | "cross_model" {
  return !judgeModel ? "not_configured" : judgeModel === generationModel ? "same_model_separate_calls" : "cross_model"
}
