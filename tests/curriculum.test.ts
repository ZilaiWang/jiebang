import { describe, expect, test } from "bun:test"
import {
  getPythonCurriculumTree,
  mapCurriculumNodeToSourceIds,
  resolveLearningGoalSpec,
} from "../src/knowledge/curriculum"

describe("Python curriculum tree", () => {
  test("exposes chapter and section nodes mapped to knowledge source ids", () => {
    const tree = getPythonCurriculumTree()

    expect(tree.module).toBe("Python基础")
    expect(tree.children.length).toBeGreaterThanOrEqual(3)
    expect(tree.children.map((chapter) => chapter.title)).toEqual(expect.arrayContaining([
      "Python 入门基础",
      "控制结构",
      "数据容器与综合项目",
    ]))
    expect(mapCurriculumNodeToSourceIds("PY-CH02-S02")).toEqual(["K007"])
    expect(mapCurriculumNodeToSourceIds("PY-CH03-S01")).toEqual(["K009"])
    expect(mapCurriculumNodeToSourceIds("PY-CH04-S03")).toEqual(["K018"])
  })

  test("normalizes selected curriculum nodes into a learning goal spec", () => {
    const spec = resolveLearningGoalSpec({
      mode: "curriculum_node",
      selected_node_ids: ["PY-CH02", "PY-CH03-S01"],
    })

    expect(spec).toMatchObject({
      mode: "curriculum_node",
      selected_node_ids: ["PY-CH02", "PY-CH03-S01"],
    })
    expect(spec.mapped_source_ids).toEqual(["K006", "K007", "K008", "K009"])
    expect(spec.goal_text).toContain("控制结构")
  })

  test("maps a custom goal to relevant source ids without requiring manual weak-point input", () => {
    const spec = resolveLearningGoalSpec({
      mode: "custom_goal",
      custom_goal: "我想学会遍历成绩列表并完成成绩统计程序",
    })

    expect(spec.mode).toBe("custom_goal")
    expect(spec.custom_goal).toContain("成绩统计")
    expect(spec.mapped_source_ids).toEqual(expect.arrayContaining(["K007", "K009", "K018"]))
    expect(spec.goal_text).toBe("我想学会遍历成绩列表并完成成绩统计程序")
  })

  test("maps file reading and line-count goals to the available file knowledge", () => {
    const spec = resolveLearningGoalSpec({
      mode: "custom_goal",
      custom_goal: "学习 Python 文件读写并完成文本行数统计程序",
    })

    expect(spec.mapped_source_ids).toEqual(expect.arrayContaining(["K015", "PY024"]))
  })

  test("does not confuse splitting code into files with basic file I/O", () => {
    const spec = resolveLearningGoalSpec({
      mode: "custom_goal",
      custom_goal: "把程序分文件并设计自定义模块",
    })

    expect(spec.mapped_source_ids).toContain("PY027")
    expect(spec.mapped_source_ids).not.toContain("K015")
  })
})
