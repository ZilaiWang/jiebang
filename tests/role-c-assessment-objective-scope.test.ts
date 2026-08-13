import { describe, expect, test } from "bun:test"
import { validateAssessmentObjectiveScope } from "../src/role-c-content/validators/assessment-validator"

describe("Role C assessment objective scope", () => {
  const request: any = {
    generation_spec: {
      targets: [{ objective_id: "OBJ-K006", source_id: "K006", required_fact_ids: ["F001", "F002", "F003"], observable_behavior: "recognize" }],
    },
    evidence_pack: { results: [{ source_id: "K006", facts: [
      { fact_id: "F001", content: "if 根据条件真假决定是否执行代码块。" },
      { fact_id: "F002", content: "elif 用于追加多个互斥条件分支。" },
      { fact_id: "F003", content: "else 处理前面条件都不满足的情况。" },
    ] }] },
  }

  test("rejects making input parsing a required learner task for a condition objective", () => {
    const issues = validateAssessmentObjectiveScope(request, {
      objective_id: "OBJ-K006",
      modality: "code",
      prompt: "读取用户输入的温度并使用 if/elif/else 输出建议。",
      starter_code: "# 请自行读取输入并完成条件判断\n",
    } as any)
    expect(issues.map((issue) => issue.code)).toContain("off_objective_required_skill")
  })

  test("allows prerequisite input plumbing when it is supplied and only conditions are assessed", () => {
    expect(validateAssessmentObjectiveScope(request, {
      objective_id: "OBJ-K006",
      modality: "code",
      prompt: "补全 if/elif/else 条件分支，根据 temperature 输出建议。",
      starter_code: "temperature = int(input())\n# 只补全条件分支\n",
    } as any)).toEqual([])
  })
})
