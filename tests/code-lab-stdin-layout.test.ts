import { describe, expect, test } from "bun:test"
import type { CodeLabPublicPayload } from "../src/role-c-content/contracts/artifacts"
import { validateCodeLabDraftStructure, validateCodeLabPublicStage } from "../src/role-c-content/validators/code-lab-validator"

const citation = { source_id: "K009", fact_id: "F001", relation: "supports" as const }

function request() {
  return {
    generation_spec: {
      targets: [{
        objective_id: "OBJ-K009",
        source_id: "K009",
        importance: "core",
        required_fact_ids: ["F001"],
      }],
    },
    evidence_pack: {
      results: [{
        source_id: "K009",
        facts: [{ source_id: "K009", fact_id: "F001", content: "列表可以保存一组有顺序的数据。" }],
      }],
    },
    concept_artifact: {
      status: "ready",
      artifact_id: "concept-k009",
      payload: { objective_ids: ["OBJ-K009"] },
    },
    resource_blueprint: {
      code_lab: {
        task_contract: { stdin_layout: "single_line_text" },
        objective_plan: [{ objective_id: "OBJ-K009", citations: [citation] }],
      },
    },
  } as never
}

function publicPayload(starterCode: string, input: string): CodeLabPublicPayload {
  return {
    lab_id: "lab-k009",
    title: "列表处理实验",
    objective_ids: ["OBJ-K009"],
    instructions: [{
      block_id: "instruction-1",
      block_type: "paragraph",
      text: "列表可以保存一组有顺序的数据。",
      claims: [{ claim_id: "claim-1", text: "列表可以保存一组有顺序的数据。", citations: [citation] }],
    }],
    execution_contract: {
      language: "python",
      execution_mode: "stdin_stdout",
      allowed_imports: [],
      input_contract: { type: "single line text", constraints: [] },
      output_contract: { kind: "string", type: "stdout text" },
      resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
    },
    starter_code: starterCode,
    public_tests: [{
      test_id: "P1",
      objective_id: "OBJ-K009",
      description: "读取同一行中的列表元素并处理",
      input,
      expected_behavior: "输出处理后的列表信息",
      citations: [citation],
    }],
    hint_ladders: [{
      objective_id: "OBJ-K009",
      hints: [1, 2, 3].map((level) => ({
        hint_level: level as 1 | 2 | 3,
        text: `提示 ${level}`,
        citations: [citation],
      })),
    }],
    reflection_questions: ["如果输入为空，程序应如何处理？"],
    objective_coverage: [{
      objective_id: "OBJ-K009",
      instruction_block_ids: ["instruction-1"],
      public_test_ids: ["P1"],
    }],
    used_evidence: [citation],
  }
}

describe("Code lab frozen stdin layout", () => {
  test("accepts one input() and one logical input line", () => {
    const report = validateCodeLabPublicStage(
      request(),
      publicPayload("values = input().split()\nprint(values)", "1 2 3\n"),
    )
    expect(report.issues.filter((entry) => entry.code === "stdin_layout_mismatch")).toEqual([])
  })

  test("rejects multiple input() calls and multi-line tests before secure generation", () => {
    const report = validateCodeLabPublicStage(
      request(),
      publicPayload("count = int(input())\nvalues = input().split()\nprint(values)", "3\n1 2 3\n"),
    )
    expect(report.issues.filter((entry) => entry.code === "stdin_layout_mismatch")).toHaveLength(2)
  })

  test("rejects hidden token types that differ from the public stdin contract", () => {
    const publicDraft = publicPayload("values = input().split()\nprint(values)", "1 2 3\n")
    const secureContract = structuredClone(publicDraft.execution_contract)
    const report = validateCodeLabDraftStructure(request(), {
      public_draft: { payload: publicDraft },
      secure_draft: {
        payload: {
          lab_id: publicDraft.lab_id,
          test_suite_id: "suite-k009",
          execution_contract: secureContract,
          reference_solution: "values = input().split()\nprint(values)",
          hidden_tests: [{
            test_id: "H1",
            input: "alpha beta gamma\n",
            expected: "['alpha', 'beta', 'gamma']\n",
            objective_id: "OBJ-K009",
            weight: 1,
            comparison: { kind: "exact" },
          }],
          scoring_groups: [{
            group_id: "G1",
            objective_id: "OBJ-K009",
            test_ids: ["H1"],
            weight: 1,
          }],
          misconception_map: [{ failed_test_id: "H1", misconception_tag: "wrong_parser" }],
          mutation_variants: [],
          objective_coverage: [{
            objective_id: "OBJ-K009",
            hidden_test_ids: ["H1"],
            scoring_group_ids: ["G1"],
            mutation_ids: [],
          }],
        },
      },
    })
    expect(report.issues.map((entry) => entry.code)).toContain("stdin_token_shape_mismatch")
  })
})
