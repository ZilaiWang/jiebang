import { CONCEPT_TUTOR_SYSTEM_PROMPT } from "./system.prompt"

/** 概念讲解修复提示词：只修复校验失败的结构化问题，不扩大内容范围。 */
export function conceptTutorRepairPrompt(issues: string[]): string {
  return `${CONCEPT_TUTOR_SYSTEM_PROMPT}

上一次输出未通过确定性校验。只修复下列结构化失败项，不扩大内容范围：
${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}`
}
