import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ArtifactEnvelope } from "../contracts/common"
import {
  GENERATION_SPEC_CONTRACT_KEYS,
  GENERATION_SPEC_CONTRACT_VERSION,
} from "../contracts/generation-spec"
import {
  LEARNER_PROFILE_SNAPSHOT_CONTRACT_KEYS,
} from "../contracts/profile-adapter"
import {
  ROLE_C_EXPRESSION_CONTEXT_CONTRACT_KEYS,
} from "../../role-b-profile/expression-context-contract"
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
  "expression_context.schema.json",
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

assertGenerationSpecSchemaParity()
assertLearnerProfileSnapshotSchemaParity()
assertExpressionContextSchemaParity()

const schemaRegistryFingerprint = `sha256:${createHash("sha256")
  .update(JSON.stringify(ROLE_C_SCHEMA_FILES.map((file) => [file, schemas.get(file)])))
  .digest("hex")}`

export function roleCSchemaRegistryMetadata(): {
  fingerprint: string
  loaded_schema_count: number
  generation_spec_contract: typeof GENERATION_SPEC_CONTRACT_VERSION
} {
  return {
    fingerprint: schemaRegistryFingerprint,
    loaded_schema_count: ROLE_C_SCHEMA_FILES.length,
    generation_spec_contract: GENERATION_SPEC_CONTRACT_VERSION,
  }
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
  return errors.map((error) => {
    if (error.keyword === "additionalProperties") {
      const property = String((error.params as { additionalProperty?: unknown }).additionalProperty ?? "<unknown>")
      return {
        code: "schema_additionalProperties",
        path: appendSchemaPath(error.instancePath, property),
        message: `${file}: 不允许额外字段 "${property}"；请检查运行代码、Schema 与持久化数据是否来自同一版本`,
        severity: "critical" as const,
      }
    }
    if (error.keyword === "required") {
      const property = String((error.params as { missingProperty?: unknown }).missingProperty ?? "<unknown>")
      return {
        code: "schema_required",
        path: appendSchemaPath(error.instancePath, property),
        message: `${file}: 缺少必需字段 "${property}"`,
        severity: "critical" as const,
      }
    }
    if (error.keyword === "enum") {
      const allowed = (error.params as { allowedValues?: unknown }).allowedValues
      return {
        code: "schema_enum",
        path: schemaPath(error.instancePath),
        message: `${file}: 值不在允许集合中${Array.isArray(allowed) ? `：${allowed.join("、")}` : ""}`,
        severity: "critical" as const,
      }
    }
    return {
      code: `schema_${error.keyword}`,
      path: schemaPath(error.instancePath),
      message: `${file}: ${error.message ?? "不符合 Schema"}`,
      severity: "critical" as const,
    }
  })
}

function schemaPath(pointer: string): string {
  if (!pointer) return "$"
  return `$${pointer.split("/").filter(Boolean).map((token) => {
    const value = token.replace(/~1/g, "/").replace(/~0/g, "~")
    return /^\d+$/.test(value) ? `[${value}]` : `.${value}`
  }).join("")}`
}

function appendSchemaPath(pointer: string, property: string): string {
  return `${schemaPath(pointer)}.${property}`
}

function assertGenerationSpecSchemaParity(): void {
  const root = schemas.get("generation_spec.schema.json")
  if (!root) throw new Error("GENERATION_SPEC_SCHEMA_MISSING")
  const checks: Array<{ name: string; value: unknown; expected: readonly string[] }> = [
    { name: "root", value: root, expected: GENERATION_SPEC_CONTRACT_KEYS.root },
    { name: "versions", value: at(root, "properties", "versions"), expected: GENERATION_SPEC_CONTRACT_KEYS.versions },
    { name: "profile_ref", value: at(root, "properties", "profile_ref"), expected: GENERATION_SPEC_CONTRACT_KEYS.profile_ref },
    { name: "path_node", value: at(root, "properties", "path_node"), expected: GENERATION_SPEC_CONTRACT_KEYS.path_node },
    { name: "target", value: at(root, "properties", "targets", "items"), expected: GENERATION_SPEC_CONTRACT_KEYS.target },
    { name: "learner_adaptation", value: at(root, "properties", "learner_adaptation"), expected: GENERATION_SPEC_CONTRACT_KEYS.learner_adaptation },
    { name: "personalization_policy", value: at(root, "properties", "personalization_policy"), expected: GENERATION_SPEC_CONTRACT_KEYS.personalization_policy },
    { name: "personalization_strategy", value: at(root, "properties", "personalization_policy", "properties", "teaching_strategy"), expected: GENERATION_SPEC_CONTRACT_KEYS.personalization_strategy },
    { name: "difficulty", value: at(root, "properties", "difficulty"), expected: GENERATION_SPEC_CONTRACT_KEYS.difficulty },
    { name: "assessment_blueprint", value: at(root, "properties", "assessment_blueprint"), expected: GENERATION_SPEC_CONTRACT_KEYS.assessment_blueprint },
    { name: "policies", value: at(root, "properties", "policies"), expected: GENERATION_SPEC_CONTRACT_KEYS.policies },
  ]
  for (const check of checks) {
    const actual = Object.keys((check.value as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}).sort()
    const expected = [...check.expected].sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`GENERATION_SPEC_SCHEMA_CODE_DRIFT:${check.name}:schema=${actual.join(",")}:code=${expected.join(",")}`)
    }
  }
}

export function assertLearnerProfileSnapshotSchemaParity(): void {
  const root = schemas.get("learner_profile_snapshot.schema.json")
  if (!root) throw new Error("LEARNER_PROFILE_SNAPSHOT_SCHEMA_MISSING")
  assertPropertyParity(
    "LEARNER_PROFILE_SNAPSHOT_SCHEMA_CODE_DRIFT:root",
    root,
    LEARNER_PROFILE_SNAPSHOT_CONTRACT_KEYS.root,
  )
}

export function assertExpressionContextSchemaParity(): void {
  const root = schemas.get("expression_context.schema.json")
  if (!root) throw new Error("EXPRESSION_CONTEXT_SCHEMA_MISSING")
  assertPropertyParity("EXPRESSION_CONTEXT_SCHEMA_CODE_DRIFT:root", root, ROLE_C_EXPRESSION_CONTEXT_CONTRACT_KEYS.root)
  assertPropertyParity(
    "EXPRESSION_CONTEXT_SCHEMA_CODE_DRIFT:source_profile",
    at(root, "properties", "source_profile"),
    ROLE_C_EXPRESSION_CONTEXT_CONTRACT_KEYS.source_profile,
  )
  assertPropertyParity(
    "EXPRESSION_CONTEXT_SCHEMA_CODE_DRIFT:guardrails",
    at(root, "properties", "guardrails"),
    ROLE_C_EXPRESSION_CONTEXT_CONTRACT_KEYS.guardrails,
  )
}

function assertPropertyParity(label: string, value: unknown, expectedKeys: readonly string[]): void {
  const actual = Object.keys((value as { properties?: Record<string, unknown> } | undefined)?.properties ?? {}).sort()
  const expected = [...expectedKeys].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}:schema=${actual.join(",")}:code=${expected.join(",")}`)
  }
}

function at(root: unknown, ...keys: string[]): unknown {
  let current = root
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
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
