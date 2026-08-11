import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ArtifactEnvelope } from "../contracts/common"
import type { ValidationIssue, ValidationReport } from "./citation-validator"

const ROLE_C_SCHEMA_FILES = [
  "agent_trace_event.schema.json",
  "alignment_critic_judgment.schema.json",
  "artifact_envelope.schema.json",
  "assessment_draft.schema.json",
  "assessment_public.schema.json",
  "assessment_secure.schema.json",
  "code_lab_draft.schema.json",
  "code_lab_public.schema.json",
  "code_lab_secure.schema.json",
  "concept_artifact.schema.json",
  "concept_lesson_payload.schema.json",
  "delivery_ack.schema.json",
  "dynamic_feedback_delivery.schema.json",
  "dynamic_feedback_result.schema.json",
  "evidence_gap_request.schema.json",
  "fact_audit_packet.schema.json",
  "generation_spec.schema.json",
  "grade_feedback.schema.json",
  "grade_result.schema.json",
  "learner_profile_snapshot.schema.json",
  "learning_evidence_event.schema.json",
  "learning_progress_delivery.schema.json",
  "learning_session_delivery.schema.json",
  "learning_path_node.schema.json",
  "profile_drift_suggestion.schema.json",
  "rag_evidence_pack.schema.json",
  "review_recovery_result.schema.json",
  "review_recovery_status.schema.json",
  "review_recovery_status_delivery.schema.json",
  "reviewed_release_delivery.schema.json",
  "role_b_path_draft.schema.json",
  "role_b_path_planning_request.schema.json",
  "role_b_path_planning_result.schema.json",
  "rubric_judgment.schema.json",
  "session_state.schema.json",
  "submission.schema.json",
] as const

export type RoleCSchemaFile = (typeof ROLE_C_SCHEMA_FILES)[number]

const schemaDirectory = fileURLToPath(
  new URL("../../../schemas/role-c-content/", import.meta.url),
)
const schemas = new Map<RoleCSchemaFile, Record<string, unknown>>()
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false })

for (const file of ROLE_C_SCHEMA_FILES) {
  const schema = JSON.parse(readFileSync(`${schemaDirectory}${file}`, "utf8")) as Record<string, unknown>
  schemas.set(file, schema)
  ajv.addSchema(schema)
}

const validators = new Map<RoleCSchemaFile, ValidateFunction>()
const fragmentValidators = new Map<string, ValidateFunction>()
for (const file of ROLE_C_SCHEMA_FILES) {
  const schema = schemas.get(file)!
  const schemaId = schema.$id
  if (typeof schemaId !== "string") throw new Error(`Role C Schema 缺少 $id：${file}`)
  const validator = ajv.getSchema(schemaId)
  if (!validator) throw new Error(`Role C Schema 无法编译：${file}`)
  validators.set(file, validator)
}

export function getRoleCSchema(file: RoleCSchemaFile): Record<string, unknown> {
  return structuredClone(schemas.get(file)!)
}

/** Returns a self-contained schema for remote model APIs that cannot resolve local-file $ref values. */
export function getRoleCModelOutputSchema(file: RoleCSchemaFile): Record<string, unknown> {
  return dereferenceSchema(schemas.get(file)!, file, []) as Record<string, unknown>
}

/** Returns one fully dereferenced internal fragment without publishing another external contract. */
export function getRoleCModelOutputSchemaFragment(
  file: RoleCSchemaFile,
  jsonPointer: string,
): Record<string, unknown> {
  const target = resolveJsonPointer(schemas.get(file)!, jsonPointer)
  const resolved = dereferenceSchema(target, file, [`${file}#${jsonPointer}`])
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    throw new Error(`Role C 模型 Schema fragment 不是对象：${file}#${jsonPointer}`)
  }
  return structuredClone(resolved as Record<string, unknown>)
}

export function validateRoleCSchemaFragment(
  file: RoleCSchemaFile,
  jsonPointer: string,
  value: unknown,
): ValidationReport {
  const key = `${file}#${jsonPointer}`
  let validator = fragmentValidators.get(key)
  if (!validator) {
    validator = ajv.compile(getRoleCModelOutputSchemaFragment(file, jsonPointer))
    fragmentValidators.set(key, validator)
  }
  const ok = Boolean(validator(value))
  return {
    ok,
    issues: ok ? [] : schemaErrors(file, validator.errors ?? []),
  }
}

export function validateRoleCSchema(file: RoleCSchemaFile, value: unknown): ValidationReport {
  const validator = validators.get(file)!
  const ok = Boolean(validator(value))
  return {
    ok,
    issues: ok ? [] : schemaErrors(file, validator.errors ?? []),
  }
}

export function validateArtifactStatusSemantics(
  artifact: ArtifactEnvelope<unknown>,
): ValidationReport {
  const issues: ValidationIssue[] = []
  if (artifact.status === "ready") {
    if (artifact.payload === null) {
      issues.push(issue("ready_payload_missing", "$.payload", "ready 产物必须包含 payload"))
    }
    if (artifact.blocked_reason || artifact.failure_reason) {
      issues.push(issue("ready_has_error_reason", "$", "ready 产物不得包含 blocked_reason 或 failure_reason"))
    }
  }
  if (artifact.status === "blocked") {
    if (artifact.payload !== null) {
      issues.push(issue("blocked_payload_present", "$.payload", "blocked 产物的 payload 必须为 null"))
    }
    if (!artifact.blocked_reason) {
      issues.push(issue("blocked_reason_missing", "$.blocked_reason", "blocked 产物必须包含 blocked_reason"))
    }
    if (artifact.failure_reason) {
      issues.push(issue("blocked_has_failure_reason", "$.failure_reason", "blocked 产物不得包含 failure_reason"))
    }
  }
  if (artifact.status === "failed") {
    if (artifact.payload !== null) {
      issues.push(issue("failed_payload_present", "$.payload", "failed 产物的 payload 必须为 null"))
    }
    if (!artifact.failure_reason) {
      issues.push(issue("failure_reason_missing", "$.failure_reason", "failed 产物必须包含 failure_reason"))
    }
    if (artifact.blocked_reason) {
      issues.push(issue("failed_has_blocked_reason", "$.blocked_reason", "failed 产物不得包含 blocked_reason"))
    }
  }
  return { ok: issues.length === 0, issues }
}

function schemaErrors(file: RoleCSchemaFile, errors: ErrorObject[]): ValidationIssue[] {
  return errors.map((error) => ({
    code: `schema_${error.keyword}`,
    path: error.instancePath || "$",
    message: `${file}: ${error.message ?? "不符合 Schema"}`,
    severity: "critical" as const,
  }))
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: "critical" }
}

function dereferenceSchema(value: unknown, currentFile: RoleCSchemaFile, stack: string[]): unknown {
  if (Array.isArray(value)) return value.map((entry) => dereferenceSchema(entry, currentFile, stack))
  if (!value || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  if (typeof record.$ref === "string") {
    const [filePart, fragment = ""] = record.$ref.split("#", 2)
    const targetFile = (filePart || currentFile) as RoleCSchemaFile
    const targetRoot = schemas.get(targetFile)
    if (!targetRoot) throw new Error(`Role C 模型 Schema 引用了未知文件：${targetFile}`)
    const refKey = `${targetFile}#${fragment}`
    if (stack.includes(refKey)) throw new Error(`Role C 模型 Schema 存在循环引用：${refKey}`)
    const target = resolveJsonPointer(targetRoot, fragment)
    const siblings = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "$ref"))
    const resolved = dereferenceSchema(target, targetFile, [...stack, refKey])
    if (Object.keys(siblings).length === 0) return resolved
    if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
      throw new Error(`Role C 模型 Schema 引用不能与 sibling 合并：${refKey}`)
    }
    return {
      ...(resolved as Record<string, unknown>),
      ...(dereferenceSchema(siblings, currentFile, stack) as Record<string, unknown>),
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [
    key,
    dereferenceSchema(child, currentFile, stack),
  ]))
}

function resolveJsonPointer(root: Record<string, unknown>, fragment: string): unknown {
  if (!fragment) return root
  if (!fragment.startsWith("/")) throw new Error(`Role C 模型 Schema 仅支持 JSON Pointer fragment：#${fragment}`)
  let current: unknown = root
  for (const token of fragment.slice(1).split("/")) {
    const key = decodeURIComponent(token).replace(/~1/g, "/").replace(/~0/g, "~")
    if (!current || typeof current !== "object" || Array.isArray(current) || !(key in current)) {
      throw new Error(`Role C 模型 Schema JSON Pointer 不存在：#${fragment}`)
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
