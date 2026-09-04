/**
 * Reflection prompts are learner-visible assessment surfaces.  They may ask
 * the learner to inspect the published task or restate a cited fact, but they
 * must not invent a causal/relational claim between the two.  Such compound
 * questions were previously accepted by the public stage and could only be
 * rejected later by the semantic reviewer.
 */
export function validateCodeLabReflectionQuestions(questions: readonly string[]): string[] {
  const issues: string[] = []
  questions.forEach((question, index) => {
    const normalized = question.replace(/\s+/gu, " ").trim()
    const questionMarks = normalized.match(/[？?]/gu)?.length ?? 0
    if (questionMarks > 1) {
      issues.push(`reflection_questions[${index}] 必须只包含一个聚焦问题，不得串联多个不同问题`)
    }
    if (/(?:这|它|上述|前述|该(?:操作|代码|实现|输出)).{0,18}(?:与|和).{0,48}(?:事实|结论|知识).{0,18}(?:关系|联系)/u.test(normalized)
      || /(?:事实|结论|知识).{0,36}(?:与|和).{0,36}(?:该(?:操作|代码|实现|输出)|这|它).{0,18}(?:关系|联系)/u.test(normalized)) {
      issues.push(`reflection_questions[${index}] 不得要求推导实验操作与引用事实之间未被证据声明的关系`)
    }
  })
  return issues
}
