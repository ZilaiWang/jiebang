import { expect, test } from "bun:test"
import { codeLabPublicAuthorSchema, normalizeCodeLabPublicAuthorPayload } from "../src/role-c-content/providers/model-backed-provider"
import { getRoleCModelOutputSchemaFragment } from "../src/role-c-content/validators/runtime-schema-validator"
import type { CodeLabPublicAuthorPayload } from "../src/role-c-content/providers/staged-generation"
import type { ProgrammingProblemBlueprint } from "../src/role-c-content/programming/contracts"

test("author schema reflects the frozen submission kind without mutating shared schema", () => {
  const completion = codeLabPublicAuthorSchema({ task_kind: "code_completion" }) as any
  expect(completion.required).toContain("programming_task")
  expect(completion.properties.programming_task.required).toContain("gap_template")
  const functionTask = codeLabPublicAuthorSchema({ task_kind: "function_implementation" }) as any
  expect(functionTask.properties.programming_task.properties.gap_template).toBeUndefined()
  const legacy = codeLabPublicAuthorSchema() as any
  expect(legacy.required).not.toContain("programming_task")
  expect(legacy.properties.programming_task.properties.gap_template).toBeDefined()
})

test("completion action comes from submission contract while AI problem content is retained", () => {
  const payload = { objectives: [], programming_task: { statement: "实现函数，对输入列表逐项处理并返回输出结果。" } } as unknown as CodeLabPublicAuthorPayload
  const problem = { task_kind: "code_completion", public_case_count: 1 } as ProgrammingProblemBlueprint
  const normalized = normalizeCodeLabPublicAuthorPayload(payload, undefined, undefined, problem)
  expect(normalized.programming_task!.statement).toBe(`请补全程序中标出的待填写部分。${payload.programming_task!.statement}`)
  expect(normalizeCodeLabPublicAuthorPayload(normalized, undefined, undefined, problem).programming_task!.statement).toBe(normalized.programming_task!.statement)
  expect(normalizeCodeLabPublicAuthorPayload(payload).programming_task!.statement).toBe(payload.programming_task!.statement)
})

test("new concept author schema requires explicit section evidence, including misconception sections", () => {
  const schema = getRoleCModelOutputSchemaFragment("concept_lesson_payload.schema.json", "/$defs/author_payload_v2") as any
  const section = schema.properties.objectives.items.properties.sections.items
  expect(section.required).toContain("used_fact_ids")
  expect(section.properties.used_fact_ids.minItems).toBe(1)
})
