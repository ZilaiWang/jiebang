import { describe, expect, test } from "bun:test"
import type { RoleBPathDraft } from "../src/role-c-content/contracts/recovery"
import type { LearningPathNode } from "../src/role-c-content/contracts/profile-adapter"
import { inheritRetainedObjectiveFacts } from "../src/role-c-content/review/run-recoverable-pipeline"
import { bindObjectiveEvidence } from "../src/role-c-content/planning/objective-evidence-bundle"

const blueprint = {
  tier_1_count: 1,
  tier_2_count: 1,
  tier_3_count: 0,
  required_modalities: ["mcq" as const],
}

describe("B 重规划与 C 事实覆盖合同", () => {
  test("保留目标的空事实草案不得擦除已冻结事实边界", () => {
    const current: LearningPathNode = {
      schema_version: "1.0",
      node_id: "P1",
      target_source_ids: ["K001"],
      prerequisite_source_ids: [],
      goal: "了解 Python",
      objectives: [{
        objective_id: "O1",
        source_id: "K001",
        required_fact_ids: ["F001", "F002", "F003"],
        observable_behavior: "explain",
        importance: "core",
      }],
      assessment_blueprint: blueprint,
    }
    const draft: RoleBPathDraft = {
      ...structuredClone(current),
      node_id: "P2",
      objectives: [{
        ...structuredClone(current.objectives[0]!),
        objective_id: "B-NEW-O1",
        required_fact_ids: [],
      }],
    }
    const inherited = inheritRetainedObjectiveFacts(current, draft)
    expect(inherited.objectives[0]!.required_fact_ids).toEqual(["F001", "F002", "F003"])
    expect(draft.objectives[0]!.required_fact_ids).toEqual([])
  })

  test("新 source 仍保持未绑定，由 A 证据能力重新选择", () => {
    const current: LearningPathNode = {
      schema_version: "1.0",
      node_id: "P1",
      target_source_ids: ["K001"],
      prerequisite_source_ids: [],
      goal: "了解 Python",
      objectives: [{
        objective_id: "O1",
        source_id: "K001",
        required_fact_ids: ["F001"],
        observable_behavior: "explain",
        importance: "core",
      }],
      assessment_blueprint: blueprint,
    }
    const draft: RoleBPathDraft = {
      schema_version: "1.0",
      node_id: "P2",
      target_source_ids: ["K007"],
      prerequisite_source_ids: [],
      goal: "学习循环",
      objectives: [{
        objective_id: "O2",
        source_id: "K007",
        required_fact_ids: [],
        observable_behavior: "apply",
        importance: "core",
      }],
      assessment_blueprint: blueprint,
    }
    expect(inheritRetainedObjectiveFacts(current, draft).objectives[0]!.required_fact_ids).toEqual([])
  })

  test("绑定器只为空草案选最小束，不缩减显式事实合同", () => {
    const facts = ["F001", "F002", "F003"].map((factId) => ({
      source_id: "K001",
      fact_id: factId,
      content: factId === "F001" ? "Python 是一种通用编程语言。" : `附加核心事实 ${factId}`,
      capabilities: ["definition" as const],
    }))
    const bound = bindObjectiveEvidence({
      source_id: "K001",
      observable_behavior: "explain",
      required_fact_ids: ["F001", "F002", "F003"],
    }, [{ source_id: "K001", facts }])
    expect(bound.required_fact_ids).toEqual(["F001", "F002", "F003"])
  })
})
