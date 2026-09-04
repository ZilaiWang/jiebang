import { describe, expect, test } from "bun:test"
import {
  resolveFindingDisposition,
  findingFingerprint,
  revisionStrictlyImproves,
} from "../src/role-c-content/review/disposition-resolver"

describe("改进方案4 第九节：失败责任归属 resolver", () => {
  test("普通语义越界 → C / artifact", () => {
    expect(resolveFindingDisposition({ code: "semantic_unsupported" }))
      .toEqual({ owner: "C", fix_scope: "artifact", action: "local_rewrite" })
  })

  test("冻结测评题正确作答需要缺失规则 → A / new_evidence", () => {
    expect(resolveFindingDisposition({
      code: "semantic_unsupported",
      support_gap: "essential_fact_missing",
      locator: { field: "assessment_item", ref_id: "ITEM-1" },
    }))
      .toEqual({ owner: "A", fix_scope: "new_evidence", action: "request_supporting_fact" })
  })

  test("已有可行引用的生成题选错命题角度 → C 局部重写，不反向要求 A 补事实", () => {
    expect(resolveFindingDisposition({
      code: "semantic_unsupported",
      support_gap: "essential_fact_missing",
      locator: { field: "assessment_item", ref_id: "ITEM-1" },
      replaceable_generated_surface: true,
    })).toEqual({ owner: "C", fix_scope: "artifact", action: "rewrite_with_current_facts" })
  })

  test("讲义即时题或实验反思选了证据外角度 → C 局部重写", () => {
    expect(resolveFindingDisposition({
      code: "semantic_unsupported",
      support_gap: "essential_fact_missing",
      locator: { field: "quiz", ref_id: "CHECK-1" },
    })).toEqual({ owner: "C", fix_scope: "artifact", action: "rewrite_with_current_facts" })
    expect(resolveFindingDisposition({
      code: "semantic_unsupported",
      support_gap: "essential_fact_missing",
      locator: { field: "reflection", ref_id: "REFLECT-1" },
    })).toEqual({ owner: "C", fix_scope: "artifact", action: "rewrite_with_current_facts" })
  })

  test("冻结 objective 要求的行为证据不足：可降级 → B/new_spec；create 不可降级 → A/new_evidence", () => {
    expect(resolveFindingDisposition({ code: "semantic_unsupported", support_gap: "objective_evidence_mismatch", objective_behavior: "trace" }))
      .toEqual({ owner: "B", fix_scope: "new_spec", action: "downgrade_objective_behavior" })
    expect(resolveFindingDisposition({ code: "semantic_unsupported", support_gap: "objective_evidence_mismatch", objective_behavior: "create" }))
      .toEqual({ owner: "A", fix_scope: "new_evidence", action: "request_behavior_supporting_evidence" })
  })

  test("多写无依据用途 → C / artifact", () => {
    expect(resolveFindingDisposition({ code: "semantic_unsupported", support_gap: "optional_overreach" }))
      .toEqual({ owner: "C", fix_scope: "artifact", action: "remove_or_rewrite_local_overreach" })
  })

  test("前置知识缺失 → B / new_spec", () => {
    expect(resolveFindingDisposition({ code: "missing_prerequisite_source" }).owner).toBe("B")
    expect(resolveFindingDisposition({ code: "missing_prerequisite_source" }).fix_scope).toBe("new_spec")
  })

  test("运行环境失败 → runtime / provider", () => {
    expect(resolveFindingDisposition({ code: "docker_unavailable" }))
      .toEqual({ owner: "runtime", fix_scope: "provider", action: "provider_runtime_retry" })
    expect(resolveFindingDisposition({ code: "PROVIDER_ERROR" }).owner).toBe("runtime")
  })

  test("固定题量超容量 → B / new_spec", () => {
    expect(resolveFindingDisposition({ code: "blueprint_tier_count" }).owner).toBe("B")
    expect(resolveFindingDisposition({ code: "blueprint_tier_count" }).fix_scope).toBe("new_spec")
  })

  test("模型建议 new_evidence 时被采纳（无 support_gap 的兜底）", () => {
    expect(resolveFindingDisposition({ code: "semantic_unsupported", suggested_scope: "new_evidence" }).owner).toBe("A")
  })
})

describe("finding 指纹与单调验收", () => {
  const base = {
    source: "fact_audit" as const,
    code: "semantic_unsupported",
    artifact_kind: "assessment" as const,
    artifact_id: "a1",
    message: "内容不支持",
    proposed_action: "重写",
    fix_scope: "artifact" as const,
    locator: { field: "assessment_item" as const, ref_id: "i1" },
    evidence_refs: ["e1"],
  }

  test("findingFingerprint 稳定，message 措辞变化不影响身份", () => {
    const a = findingFingerprint(base)
    const b = findingFingerprint({ ...base, message: "换一种说法的问题描述" })
    expect(a).toBe(b)
  })

  test("locator 变化 → 指纹变化", () => {
    const a = findingFingerprint(base)
    const b = findingFingerprint({ ...base, locator: { field: "assessment_item", ref_id: "i2" } })
    expect(a).not.toBe(b)
  })

  test("revisionStrictlyImproves：原 finding 消失且无新增 → true", () => {
    expect(revisionStrictlyImproves({
      beforeFingerprints: ["f1", "f2"],
      afterFingerprints: ["f2"],
    })).toBe(true)
  })

  test("revisionStrictlyImproves：原 finding 未消失 → false；新增 finding → false", () => {
    expect(revisionStrictlyImproves({
      beforeFingerprints: ["f1", "f2"],
      afterFingerprints: ["f1", "f2"],
    })).toBe(false)
    expect(revisionStrictlyImproves({
      beforeFingerprints: ["f1"],
      afterFingerprints: ["f3"],
    })).toBe(false)
  })
})
