import type { ExecutionContract } from "../contracts/artifacts"
import type { CodeGapTemplate, ProgrammingSubmissionMode } from "./contracts"
import { materializeGapCode } from "./gap-template"
import { invocationFileFixtures } from "../security/file-fixtures"

export interface ProgrammingTaskSubmissionContract {
  task_id: string
  submission_mode: ProgrammingSubmissionMode
  execution_contract: ExecutionContract
  starter_code?: string
  gap_template?: CodeGapTemplate
  max_source_bytes?: number
  max_custom_input_bytes?: number
}

export type ProgrammingSubmissionPayload =
  | { mode: "full_code"; code: string }
  | { mode: "gap_answers"; gap_answers: Record<string, string> }

export function resolveProgrammingSubmission(
  contract: ProgrammingTaskSubmissionContract,
  payload: ProgrammingSubmissionPayload,
): { task_id: string; code: string; source_bytes: number; submitted_mode: ProgrammingSubmissionMode; gap_ranges?: Record<string, { start_line: number; end_line: number }> } {
  if (payload.mode !== contract.submission_mode) {
    throw new Error(`提交方式不匹配：需要 ${contract.submission_mode}，收到 ${payload.mode}`)
  }
  const maxBytes = contract.max_source_bytes ?? 100_000
  const materialized = payload.mode === "full_code"
    ? { code: normalizeSource(payload.code), gap_ranges: undefined }
    : contract.gap_template
      ? materializeGapCode(contract.gap_template, payload.gap_answers)
      : (() => { throw new Error("gap_answers 提交缺少服务端冻结的 gap_template") })()
  const bytes = Buffer.byteLength(materialized.code, "utf8")
  if (bytes > maxBytes) throw new Error(`提交代码超过 ${maxBytes} 字节`)
  return {
    task_id: contract.task_id,
    code: materialized.code,
    source_bytes: bytes,
    submitted_mode: payload.mode,
    ...(materialized.gap_ranges ? { gap_ranges: materialized.gap_ranges } : {}),
  }
}

export function normalizeCustomDebugInput(contract: ProgrammingTaskSubmissionContract, raw: unknown): unknown {
  const maxBytes = contract.max_custom_input_bytes ?? 32_768
  if (contract.execution_contract.execution_mode === "stdin_stdout") {
    if (typeof raw !== "string") throw new Error("stdin_stdout 调试输入必须是原始文本")
    const value = raw.replace(/\r\n/gu, "\n")
    if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`自定义输入超过 ${maxBytes} 字节`)
    return value
  }
  const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('function 调试输入必须是 {"args": [], "kwargs": {}}')
  }
  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > maxBytes) throw new Error(`自定义输入超过 ${maxBytes} 字节`)
  const envelope = parsed as { args?: unknown; kwargs?: unknown; files?: unknown }
  if (!Array.isArray(envelope.args) || !envelope.kwargs || typeof envelope.kwargs !== "object" || Array.isArray(envelope.kwargs)) {
    throw new Error('function 调试输入必须是 {"args": [], "kwargs": {}}')
  }
  const files = invocationFileFixtures(envelope)
  return { args: envelope.args, kwargs: envelope.kwargs as Record<string, unknown>, ...(files ? { files } : {}) }
}

function normalizeSource(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("提交代码不能为空")
  if (value.includes("\u0000")) throw new Error("提交代码不得包含 NUL 字符")
  return value.replace(/\r\n/gu, "\n")
}
