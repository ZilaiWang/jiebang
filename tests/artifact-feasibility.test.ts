import { describe, expect, test } from "bun:test"
import {
  assessObjectiveSupport,
  planArtifactFeasibility,
  supportedBehaviorsFor,
} from "../src/role-c-content/planning/artifact-feasibility"

describe("改进方案4 第七节：生成前 evidence capability 判定", () => {
  test("只有定义事实 → 只支撑 recognize/explain，不能支撑 trace", () => {
    const plan = assessObjectiveSupport({
      objective_id: "O1",
      observable_behavior: "trace",
      fact_refs: [{ source_id: "K001", fact_id: "F1" }],
      facts: [{ content: "列表元素可以通过索引访问" }],
    })
    expect(plan.supported_behaviors).toContain("recognize")
    expect(plan.supported_behaviors).not.toContain("trace")
    expect(plan.artifact_support.assessment).toBe("unsupported")
    expect(plan.missing_support.length).toBeGreaterThan(0)
  })

  test("含步骤/循环事实 → 支撑 trace", () => {
    const behaviors = supportedBehaviorsFor([
      { content: "用 for 循环按顺序遍历列表的每个元素，先取第一个，然后取下一个" },
    ])
    expect(behaviors).toContain("trace")
  })

  test("含输入输出关系事实 → 支撑 apply", () => {
    const behaviors = supportedBehaviorsFor([
      { content: "如果列表有 N 个元素，则索引 0 到 N-1 分别对应第一个到最后一个元素" },
    ])
    expect(behaviors).toContain("apply")
  })

  test("含函数定义事实 → 支撑 create", () => {
    const behaviors = supportedBehaviorsFor([
      { content: "def 定义一个函数，接收参数并返回结果" },
    ])
    expect(behaviors).toContain("create")
  })

  test("含边界/约束事实 → 支撑 debug", () => {
    const behaviors = supportedBehaviorsFor([
      { content: "索引越界会抛出 IndexError 异常，不能访问超出范围的元素" },
    ])
    expect(behaviors).toContain("debug")
  })

  test("没有显式 capability 元数据时，关键词启发式只做规划提示、不作为硬门禁", () => {
    const plan = planArtifactFeasibility({
      objectives: [{
        objective_id: "O1", observable_behavior: "trace", importance: "core",
        fact_refs: [{ source_id: "K001", fact_id: "F1" }],
        facts: [{ content: "列表元素可以通过索引访问" }],
      }],
      capacity: { requested_items: 2, feasible_items: 2, per_objective: [], limiting_factors: [], decision: "FULL" },
    })
    expect(plan.status).toBe("ready")
    expect(plan.objectives[0]?.missing_support.length).toBeGreaterThan(0)
  })

  test("core objective 完全没有事实时才确定性 need_evidence", () => {
    const plan = planArtifactFeasibility({
      objectives: [{
        objective_id: "O1",
        observable_behavior: "apply",
        importance: "core",
        fact_refs: [{ source_id: "K001", fact_id: "F404" }],
        facts: [],
      }],
      capacity: { requested_items: 2, feasible_items: 2, per_objective: [], limiting_factors: [], decision: "FULL" },
    })
    expect(plan.status).toBe("need_evidence")
  })

  test("证据充分（含 code 特征）→ 不误报，status ready", () => {
    const plan = planArtifactFeasibility({
      objectives: [{
        objective_id: "O1", observable_behavior: "create", importance: "core",
        fact_refs: [{ source_id: "K007", fact_id: "F1" }, { source_id: "K007", fact_id: "F2" }, { source_id: "K007", fact_id: "F3" }],
        facts: [
          { content: "def 定义函数，接收参数并返回结果" },
          { content: "for 循环按顺序遍历列表元素" },
          { content: "函数调用时把实参传入形参" },
        ],
      }],
      capacity: { requested_items: 2, feasible_items: 2, per_objective: [], limiting_factors: [], decision: "FULL" },
    })
    expect(plan.status).toBe("ready")
    expect(plan.objectives[0]!.artifact_support.code_lab).toBe("full")
  })

  test("容量不足 REPLAN → need_spec", () => {
    const plan = planArtifactFeasibility({
      objectives: [{
        objective_id: "O1", observable_behavior: "recognize", importance: "core",
        fact_refs: [{ source_id: "K001", fact_id: "F1" }],
        facts: [{ content: "int 表示整数" }],
      }],
      capacity: { requested_items: 5, feasible_items: 1, per_objective: [], limiting_factors: ["EVIDENCE_DIVERSITY_LOW"], decision: "REPLAN" },
    })
    expect(plan.status).toBe("need_spec")
  })
})
