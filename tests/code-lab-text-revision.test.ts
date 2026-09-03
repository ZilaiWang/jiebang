import { describe, expect, test } from "bun:test"
import { planCodeLabTextRevision, applyCodeLabTextRevision } from "../src/role-c-content/review/code-lab-text-revision"
import {
  planConceptTextRevision,
  applyConceptTextRevision,
  validateConceptTextRevision,
} from "../src/role-c-content/review/concept-text-revision"

const payload: any = {
  lab_id: "L", starter_code: "x = 1\n# TODO", execution_contract: { execution_mode: "stdin_stdout" },
  instructions: [], public_tests: [], hint_ladders: [], reflection_questions: [],
  practical_guide: { guide_id: "G", practice_goal: "理解逐行执行", deliverable: "按要求输出的程序",
    readiness_checks: [], steps: [], acceptance_criteria: [], troubleshooting: [],
    extension_task: { slot_id: "E", task: "扩展", changed_dimension: "数据", verification: "检查", citations: [] } },
}
const objection: any = { issue_type: "unsupported_claim", fix_scope: "artifact", locator: { field: "practical_guide_goal", ref_id: "G" } }

describe("lab external-review text revision", () => {
  test("a located goal edits only its prose, not executable or private contracts", () => {
    const fields = planCodeLabTextRevision(payload, [objection])!
    expect(fields.map((f) => f.path)).toEqual(["/practical_guide/practice_goal", "/practical_guide/deliverable"])
    const replacements = fields.map((f) => ({ ...f, value: f.path.endsWith("practice_goal") ? "补全输出操作并核对结果" : f.value }))
    const result = applyCodeLabTextRevision(payload, fields, replacements)
    const expected = structuredClone(payload)
    expected.practical_guide.practice_goal = "补全输出操作并核对结果"
    expect(result).toEqual(expected)
    expect(payload.practical_guide.practice_goal).toBe("理解逐行执行")
  })
  test("execution changes or unlocated objections do not masquerade as text repair", () => {
    expect(planCodeLabTextRevision(payload, [{ ...objection, locator: { field: "starter_code", ref_id: "L" } }])).toBeUndefined()
    expect(planCodeLabTextRevision(payload, [{ ...objection, fix_scope: "new_spec" }])).toBeUndefined()
    expect(planCodeLabTextRevision(payload, [{ ...objection, issue_type: "difficulty_mismatch" }])).toBeUndefined()
    expect(planCodeLabTextRevision(payload, [{ ...objection, locator: { field: "practical_guide_goal", ref_id: "UNKNOWN" } }])).toBeUndefined()
  })
  test("the model cannot change undeclared fields or lose an existing binding", () => {
    const fields = planCodeLabTextRevision(payload, [objection])!
    expect(() => applyCodeLabTextRevision(payload, fields, [{ path: "/starter_code", value: "print(1)" }])).toThrow()
    expect(() => applyCodeLabTextRevision(payload, fields, [fields[0]!, fields[0]!])).toThrow()
    const changed = structuredClone(payload); changed.practical_guide.practice_goal = "changed"
    expect(() => applyCodeLabTextRevision(changed, fields, fields)).toThrow()
  })
  test("concept prose can be repaired without changing citations, IDs or coverage", () => {
    const concept: any = { title: "t", objective_ids: ["O"], prerequisite_bridge: [], worked_examples: [], misconceptions: [], micro_checks: [], hint_ladders: [], summary: [],
      explanation_blocks: [{ block_id: "B", block_type: "paragraph", text: "解释器逐行编译", claims: [{ claim_id: "C", text: "事实", citations: [{ source_id: "K", fact_id: "F", relation: "supports" }] }] }],
      objective_coverage: [{ objective_id: "O", block_ids: ["B"] }], used_evidence: [{ source_id: "K", fact_id: "F", relation: "supports" }] }
    const fields = planConceptTextRevision(concept, [{ ...objection, locator: { field: "render_content", ref_id: "B" } }])!
    const repaired = applyConceptTextRevision(concept, fields, [{ path: fields[0]!.path, value: "程序由解释器执行" }])
    expect((repaired.explanation_blocks[0] as any).text).toBe("程序由解释器执行")
    expect((repaired.explanation_blocks[0] as any).claims).toEqual(concept.explanation_blocks[0].claims)
    expect(repaired.objective_coverage).toEqual(concept.objective_coverage)
  })
  test("a Claim objection repairs its owning public block and never edits the Claim", () => {
    const concept: any = { title: "t", objective_ids: ["O"], prerequisite_bridge: [], worked_examples: [], misconceptions: [], micro_checks: [], hint_ladders: [], summary: [],
      explanation_blocks: [{ block_id: "B", block_type: "paragraph", text: "if 根据真假决定是否执行代码块。理解它是排错第一步。", claims: [{ claim_id: "C", text: "if 根据条件真假决定是否执行代码块。", citations: [{ source_id: "K", fact_id: "F", relation: "supports" }] }] }],
      objective_coverage: [{ objective_id: "O", block_ids: ["B"] }], used_evidence: [{ source_id: "K", fact_id: "F", relation: "supports" }] }
    const fields = planConceptTextRevision(concept, [{ ...objection, locator: { field: "claim", ref_id: "C", parent_block_id: "B" } }])!
    expect(fields.map((field) => field.path)).toEqual(["/explanation_blocks/0/text"])
    expect(fields.some((field) => field.path.includes("/claims/"))).toBe(false)
    const revised = applyConceptTextRevision(concept, fields, [{
      path: fields[0]!.path,
      value: "if 根据条件真假决定是否执行代码块。请观察条件真假与实际执行分支是否一致。",
    }])
    expect(revised.explanation_blocks[0]).toHaveProperty("claims", concept.explanation_blocks[0].claims)
  })
  test("localized concept repair must preserve visible fact anchors and remove located unsupported text", () => {
    const concept: any = { title: "t", objective_ids: ["O"], prerequisite_bridge: [], worked_examples: [], misconceptions: [], micro_checks: [], hint_ladders: [], summary: [],
      explanation_blocks: [{ block_id: "B", block_type: "paragraph", text: "if 根据条件真假决定是否执行代码块。理解它是排错第一步。", claims: [{ claim_id: "C", text: "if 根据条件真假决定是否执行代码块。", citations: [{ source_id: "K", fact_id: "F", relation: "supports" }] }] }],
      objective_coverage: [{ objective_id: "O", block_ids: ["B"] }], used_evidence: [{ source_id: "K", fact_id: "F", relation: "supports" }] }
    const objections: any[] = [{ ...objection, locator: { field: "render_content", ref_id: "B" }, evidence: ["text:理解它是排错第一步"] }]
    const fields = planConceptTextRevision(concept, objections)!
    const missingAnchor = applyConceptTextRevision(concept, fields, [{ path: fields[0]!.path, value: "请观察分支。" }])
    expect(validateConceptTextRevision({ before: concept, after: missingAnchor, fields, objections, evidence: {
      retrieval_id: "R", query: "q", results: [{ source_id: "K", score: 1, facts: [{ source_id: "K", fact_id: "F", content: "if 根据条件真假决定是否执行代码块。" }], examples: [] }],
    } as any }).some((issue) => issue.includes("REVIEW_FACT_ANCHOR_REMOVED"))).toBe(true)
    const retainedUnsupported = applyConceptTextRevision(concept, fields, [{ path: fields[0]!.path, value: concept.explanation_blocks[0].text }])
    expect(validateConceptTextRevision({ before: concept, after: retainedUnsupported, fields, objections, evidence: {
      retrieval_id: "R", query: "q", results: [{ source_id: "K", score: 1, facts: [{ source_id: "K", fact_id: "F", content: "if 根据条件真假决定是否执行代码块。" }], examples: [] }],
    } as any }).some((issue) => issue.includes("REVIEW_UNSUPPORTED_TEXT_RETAINED"))).toBe(true)
  })
})
