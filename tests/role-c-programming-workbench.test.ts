import { describe, expect, test } from "bun:test"
import { buildProgrammingProblemBlueprint } from "../src/role-c-content/programming/problem-blueprint"
import { failClosedStarterCode, materializeGapCode, validateGapLearnerContract, validateGapTemplate } from "../src/role-c-content/programming/gap-template"
import { resolveProgrammingSubmission } from "../src/role-c-content/programming/submission-contract"
import { validateInputCandidates } from "../src/role-c-content/programming/test-plan"
import { judgeVerdictFromExecution } from "../src/role-c-content/programming/judge-protocol"

const functionContract = {
  language: "python" as const,
  execution_mode: "function" as const,
  entry_point: "solve",
  allowed_imports: [],
  input_contract: { type: "list", constraints: [] },
  output_contract: { type: "number", constraints: [] },
  resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
}

describe("Role C programming workbench", () => {
  test("selects task form from goal/progress and always budgets every required partition", () => {
    const blueprint = buildProgrammingProblemBlueprint({
      objective_ids: ["O1"], source_ids: ["K1"], fact_refs: [{ source_id: "K1", fact_id: "F1" }],
      goal_profile: "job_interview", learner_level: "basic", progress_band: "developing",
      title_brief: "列表处理", scenario_brief: "面试练习", learner_owned_behavior: "修复边界错误",
      execution_contract: functionContract,
    })
    expect(blueprint.task_kind).toBe("debugging_repair")
    expect(blueprint.hidden_case_count).toBeGreaterThanOrEqual(
      blueprint.test_partitions.reduce((total, entry) => total + entry.minimum_cases, 0),
    )
    expect(blueprint.test_partitions.map((entry) => entry.partition_id)).toContain("error_path")
  })

  test("debugging blueprints allocate one real fault per frozen objective", () => {
    const blueprint = buildProgrammingProblemBlueprint({
      objective_ids: ["O1", "O2", "O3"],
      source_ids: ["K1", "K2", "K3"],
      fact_refs: [
        { source_id: "K1", fact_id: "F1" },
        { source_id: "K2", fact_id: "F2" },
        { source_id: "K3", fact_id: "F3" },
      ],
      goal_profile: "job_interview",
      learner_level: "basic",
      progress_band: "developing",
      title_brief: "综合调试",
      scenario_brief: "面试练习",
      learner_owned_behavior: "定位并修复三个相互依赖的故障",
      execution_contract: functionContract,
    })
    expect(blueprint.task_kind).toBe("debugging_repair")
    expect(blueprint.required_mutation_count).toBe(3)
  })

  test("materializes code completion only from frozen server-side gaps", () => {
    const template = {
      schema_version: "code-gap-template.v1" as const,
      template_code: "def solve(values):\n    {{gap:body}}\n",
      gaps: [{ gap_id: "body", label: "实现求和", kind: "block" as const, max_chars: 100, max_lines: 2 }],
    }
    expect(validateGapTemplate(template)).toEqual([])
    expect(materializeGapCode(template, { body: "total = sum(values)\nreturn total" }).code)
      .toBe("def solve(values):\n    total = sum(values)\n    return total\n")
    expect(resolveProgrammingSubmission({
      task_id: "TASK-1", submission_mode: "gap_answers", execution_contract: functionContract, gap_template: template,
    }, { mode: "gap_answers", gap_answers: { body: "return 0" } }).code).toContain("return 0")
    expect(() => resolveProgrammingSubmission({
      task_id: "TASK-1", submission_mode: "gap_answers", execution_contract: functionContract, gap_template: template,
    }, { mode: "full_code", code: "def solve(values): return 0" })).toThrow("提交方式不匹配")
  })

  test("guided text blanks require an explicit Python string literal", () => {
    const template = {
      schema_version: "code-gap-template.v1" as const,
      template_code: "fact_text = {{gap:fact_text}}\nprint(fact_text)\n",
      gaps: [{
        gap_id: "fact_text", label: "要输出的文字", kind: "expression" as const,
        answer_format: "python_string_literal" as const, max_chars: 200, max_lines: 1,
      }],
    }
    expect(() => materializeGapCode(template, { fact_text: "111" })).toThrow("必须填写带英文单引号或双引号")
    expect(materializeGapCode(template, { fact_text: '"Python 是一种通用编程语言。"' }).code)
      .toContain('fact_text = "Python 是一种通用编程语言。"')
    expect(failClosedStarterCode(template)).toBe('fact_text = "TODO"\nprint(fact_text)\n')
  })

  test("builds contract-valid fail-closed starters for every supported gap format", () => {
    const template = {
      schema_version: "code-gap-template.v1" as const,
      template_code: [
        "name = {{gap:name}}",
        "value = {{gap:value}}",
        "{{gap:statement}}",
        "if True:",
        "    {{gap:block}}",
        "",
      ].join("\n"),
      gaps: [
        { gap_id: "name", label: "变量名", kind: "identifier" as const, answer_format: "python_identifier" as const, max_chars: 40, max_lines: 1 },
        { gap_id: "value", label: "表达式", kind: "expression" as const, answer_format: "python_expression" as const, max_chars: 80, max_lines: 1 },
        { gap_id: "statement", label: "语句", kind: "statement" as const, answer_format: "python_statement" as const, max_chars: 100, max_lines: 1 },
        { gap_id: "block", label: "代码块", kind: "block" as const, max_chars: 100, max_lines: 2 },
      ],
    }
    const starter = failClosedStarterCode(template)
    expect(starter).toContain("name = __TODO__")
    expect(starter).toContain("value = __TODO__")
    expect(starter).toContain('raise NotImplementedError("TODO")')
    expect(starter).not.toContain("{{gap:")
  })

  test("rejects ambiguous learner-facing blanks instead of exposing internal markers", () => {
    const ambiguous = {
      statement: "运行 {{gap:answer}}",
      input_description: "填空",
      output_description: "输出结果",
      constraints: ["完成任务"],
      gap_template: {
        schema_version: "code-gap-template.v1" as const,
        template_code: "print({{gap:answer}})\n",
        gaps: [{ gap_id: "answer", label: "gap", kind: "expression" as const, max_chars: 80, max_lines: 1 }],
      },
    }
    expect(validateGapLearnerContract(ambiguous)).toEqual(expect.arrayContaining([
      "学习者可见题面不得暴露内部 gap marker",
      "程序填空题面必须明确说明填写或补全动作",
      "gaps[0] 必须声明 answer_format",
      "gaps[0] 必须使用可理解的学习者标签",
    ]))
  })

  test("rejects duplicate/public-overlapping input packs and maps mature verdicts", () => {
    const blueprint = buildProgrammingProblemBlueprint({
      objective_ids: ["O1"], source_ids: ["K1"], fact_refs: [{ source_id: "K1", fact_id: "F1" }],
      goal_profile: "coursework", learner_level: "basic", progress_band: "developing",
      title_brief: "列表处理", scenario_brief: "课程练习", learner_owned_behavior: "实现函数",
      execution_contract: functionContract,
    })
    const report = validateInputCandidates(blueprint, [{ input: { args: [[1]], kwargs: {} } }], [{
      case_id: "H1", partition_id: "nominal", input: { args: [[1]], kwargs: {} }, note: "重复",
    }])
    expect(report.ok).toBe(false)
    expect(report.public_hidden_overlap_count).toBe(1)
    expect(judgeVerdictFromExecution("failed", ["syntax_error:line=2"])).toBe("compile_error")
    expect(judgeVerdictFromExecution("failed", ["assertion_failed"])).toBe("wrong_answer")
  })

  test("pure-output exercises accept the single protocol-level empty input", () => {
    const blueprint = buildProgrammingProblemBlueprint({
      objective_ids: ["O1"], source_ids: ["K001"], fact_refs: [{ source_id: "K001", fact_id: "F001" }],
      goal_profile: "general_learning", learner_level: "beginner", progress_band: "needs_reteach",
      title_brief: "输出事实", scenario_brief: "入门练习", learner_owned_behavior: "补全并运行输出语句",
      execution_contract: {
        ...functionContract,
        execution_mode: "stdin_stdout",
        entry_point: undefined,
        input_contract: { type: "none", constraints: [] },
        output_contract: { type: "stdout_lines", constraints: [] },
      },
    })
    const report = validateInputCandidates(blueprint, [{ input: "" }], [{
      case_id: "H1", partition_id: "nominal", input: "", note: "服务端核对冻结输出",
    }])
    expect(report).toMatchObject({ ok: true, public_hidden_overlap_count: 0 })
  })
})
