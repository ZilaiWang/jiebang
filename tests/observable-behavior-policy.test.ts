import { describe, expect, test } from "bun:test"
import {
  decideObservableBehavior,
  explicitBehaviorFromGoal,
  LEVEL_BEHAVIOR_BASELINE,
} from "../src/role-c-content/planning/observable-behavior-policy"

describe("observable_behavior 推导（改进方案6 第三节）", () => {
  test("泛化目标按画像等级兜底，不再默认 recognize", () => {
    // "学习 Python 列表" 没有明确动作动词 → 老逻辑全落 recognize
    expect(explicitBehaviorFromGoal("学习 Python 列表")).toBeNull()
    expect(decideObservableBehavior({ goal: "学习 Python 列表", learner_level: "beginner" })).toBe("recognize")
    expect(decideObservableBehavior({ goal: "学习 Python 列表", learner_level: "basic" })).toBe("explain")
    expect(decideObservableBehavior({ goal: "学习 Python 列表", learner_level: "intermediate" })).toBe("apply")
    expect(decideObservableBehavior({ goal: "学习 Python 列表", learner_level: "integrated" })).toBe("trace")
  })

  test("明确动作动词优先，不受画像等级影响", () => {
    expect(decideObservableBehavior({ goal: "编写一个函数", learner_level: "beginner" })).toBe("create")
    expect(decideObservableBehavior({ goal: "调试这段代码", learner_level: "beginner" })).toBe("debug")
    expect(decideObservableBehavior({ goal: "解释 for 循环", learner_level: "integrated" })).toBe("explain")
    expect(decideObservableBehavior({ goal: "实现列表遍历", learner_level: "basic" })).toBe("create")
  })

  test("画像等级基线覆盖全部四档，且 demand 随等级递增", () => {
    expect(LEVEL_BEHAVIOR_BASELINE.beginner).toContain("recognize")
    expect(LEVEL_BEHAVIOR_BASELINE.basic).toContain("explain")
    expect(LEVEL_BEHAVIOR_BASELINE.intermediate).toContain("apply")
    expect(LEVEL_BEHAVIOR_BASELINE.integrated).toContain("create")
  })

  test("机器学习泛化目标不再落到 recognize（intermediate）", () => {
    expect(decideObservableBehavior({ goal: "掌握机器学习基础", learner_level: "intermediate" })).toBe("apply")
    expect(decideObservableBehavior({ goal: "学习 for 循环", learner_level: "integrated" })).toBe("trace")
  })
})
