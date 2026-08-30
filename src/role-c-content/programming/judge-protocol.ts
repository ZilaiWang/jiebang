import type { JudgeVerdict } from "./contracts"

/** Stable learner-facing verdict mapping; raw runner diagnostics stay private. */
export function judgeVerdictFromExecution(
  status: "passed" | "failed" | "timeout" | "runner_error",
  failureCodes: string[],
): JudgeVerdict {
  if (status === "passed") return "accepted"
  if (status === "timeout") return "time_limit_exceeded"
  const text = failureCodes.join("\n").toLowerCase()
  if (text.includes("syntax_error")) return "compile_error"
  if (/forbidden_(?:import|syntax|call|attribute)|static_policy/u.test(text)) return "security_violation"
  if (text.includes("memory_limit")) return "memory_limit_exceeded"
  if (text.includes("output_limit")) return "output_limit_exceeded"
  if (/execution_timeout|time_limit/u.test(text)) return "time_limit_exceeded"
  if (/runtime_|runtime_error|exception/u.test(text)) return "runtime_error"
  if (/presentation_error|whitespace_only_mismatch/u.test(text)) return "presentation_error"
  if (/assertion_failed|wrong_answer|non_json_output/u.test(text)) return "wrong_answer"
  return status === "runner_error" ? "internal_error" : "wrong_answer"
}

export function judgeVerdictMessage(verdict: JudgeVerdict): string {
  switch (verdict) {
    case "accepted": return "所有正式测试均已通过。"
    case "compile_error": return "代码存在语法错误，请先修正标记位置。"
    case "wrong_answer": return "程序能够运行，但至少一组结果不正确。"
    case "presentation_error": return "输出内容接近正确，请检查空格与换行格式。"
    case "runtime_error": return "程序运行时发生异常，请先用公开样例复现。"
    case "time_limit_exceeded": return "程序运行超时，请检查死循环或算法复杂度。"
    case "memory_limit_exceeded": return "程序使用的内存超过限制。"
    case "output_limit_exceeded": return "程序输出超过限制，请检查重复输出。"
    case "security_violation": return "代码使用了当前实验不允许的导入、调用或语法。"
    default: return "评测服务未能完成本次提交，请稍后重试。"
  }
}
