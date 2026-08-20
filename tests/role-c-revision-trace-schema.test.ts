import { expect, test } from "bun:test"
import { validateRoleCSchema } from "../src/role-c-content/validators/runtime-schema-validator"

test("外审修订生效事件可通过 C→D 追踪协议", () => {
  const hash = `sha256:${"a".repeat(64)}`
  const report = validateRoleCSchema("agent_trace_event.schema.json", {
    schema_version: "1.0",
    seq: 1,
    event_type: "c.review.revision.applied",
    run_id: "RUN-1",
    agent: "tiered-evaluator",
    status: "success",
    input_refs: ["SPEC-1"],
    summary: "assessment 修订已应用",
    revision_applied: {
      before_hash: hash,
      after_hash: `sha256:${"b".repeat(64)}`,
      instruction_hash: `sha256:${"c".repeat(64)}`,
    },
  })
  expect(report).toEqual({ ok: true, issues: [] })
})

test("容量缩减事件可通过 C→D 追踪协议", () => {
  const report = validateRoleCSchema("agent_trace_event.schema.json", {
    schema_version: "1.0",
    seq: 1,
    event_type: "c.capacity.reduced",
    run_id: "RUN-1",
    status: "success",
    input_refs: ["SPEC-1"],
    summary: "测评容量已调整",
  })
  expect(report).toEqual({ ok: true, issues: [] })
})
