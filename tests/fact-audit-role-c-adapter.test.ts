import { describe, expect, test } from "bun:test"
import { auditGeneratedContent } from "../src/fact-audit/auditor"
import { adaptRoleCArtifactToFactAuditInput, adaptRoleCBlocksToFactAuditInput } from "../src/fact-audit/adapters/role-c-block-adapter"
import { retrieveKnowledge } from "../src/rag/retriever"
import type { ArtifactEnvelope } from "../src/role-c-content/contracts/common"
import type { AssessmentPublicPayload, CodeLabPublicPayload, ConceptLessonPayload } from "../src/role-c-content/contracts/artifacts"

const versions = {
  profile_version: "test-profile",
  kb_version: "python-basic@0.1.0",
  rag_version: "rule-rag@0.1.0",
  prompt_version: "test-prompt",
  model_config_hash: "test-model",
  schema_version: "1.0" as const,
}

describe("Role C fact-audit adapter", () => {
  test("adapts a simple Role C block contract into FactAuditInput", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const input = adaptRoleCBlocksToFactAuditInput({
      artifactId: "role-c-simple",
      ragResult,
      blocks: [{
        blockId: "block-1",
        text: "for 循环常用于遍历序列中的元素。",
        citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
      }],
    })

    expect(input).toEqual({
      artifactId: "role-c-simple",
      ragResult,
      generatedContent: {
        blocks: [{
          blockId: "block-1",
          text: "for 循环常用于遍历序列中的元素。",
          citations: [{ source_id: "K007", fact_id: "F001" }],
        }],
      },
    })
    expect(auditGeneratedContent(input).status).toBe("pass")
  })

  test("keeps missing citations visible so the audit can require revision", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const input = adaptRoleCBlocksToFactAuditInput({
      artifactId: "role-c-missing-citation",
      ragResult,
      blocks: [{
        blockId: "block-1",
        text: "for 循环可以帮助学习者处理重复任务。",
        citations: [],
      }],
    })

    expect(auditGeneratedContent(input).status).toBe("revise")
  })

  test("keeps fake citations visible so the audit can reject them", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const input = adaptRoleCBlocksToFactAuditInput({
      artifactId: "role-c-fake-citation",
      ragResult,
      blocks: [{
        blockId: "block-1",
        text: "for 循环常用于遍历序列中的元素。",
        citations: [{ source_id: "K999", fact_id: "F001", relation: "supports" }],
      }],
    })

    expect(auditGeneratedContent(input).status).toBe("reject")
  })

  test("extracts claims from a Role C concept lesson artifact envelope", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const artifact: ArtifactEnvelope<ConceptLessonPayload> = {
      schema_version: "1.0",
      run_id: "run-1",
      artifact_id: "concept-lesson-1",
      artifact_type: "concept_lesson",
      agent: "concept-tutor",
      status: "ready",
      versions,
      seed: 1,
      input_refs: ["rag-1"],
      citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
      quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1 },
      trace_ref: "trace-1",
      payload: {
        title: "for 循环入门",
        objective_ids: ["OBJ-K007"],
        prerequisite_bridge: [],
        explanation_blocks: [{
          block_id: "explain-1",
          block_type: "paragraph",
          text: "for 循环常用于遍历序列中的元素。",
          claims: [{
            claim_id: "claim-1",
            text: "for 循环常用于遍历序列中的元素。",
            citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
          }],
        }],
        worked_examples: [],
        misconceptions: [],
        micro_checks: [],
        hint_ladders: [],
        summary: [],
        objective_coverage: [{ objective_id: "OBJ-K007", block_ids: ["explain-1"] }],
        used_evidence: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
      },
    }

    const input = adaptRoleCArtifactToFactAuditInput({ artifact, ragResult })

    expect(input.artifactId).toBe("concept-lesson-1")
    expect(input.generatedContent.blocks).toEqual([{ blockId: "claim-1", text: "for 循环常用于遍历序列中的元素。", citations: [{ source_id: "K007", fact_id: "F001" }] }])
    expect(auditGeneratedContent(input).status).toBe("pass")
  })

  test("extracts reviewable claims from a Role C code-lab public artifact envelope", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const artifact: ArtifactEnvelope<CodeLabPublicPayload, "code_lab_public", "code-lab"> = {
      schema_version: "1.0",
      run_id: "run-1",
      artifact_id: "code-lab-1",
      artifact_type: "code_lab_public",
      agent: "code-lab",
      status: "ready",
      versions,
      seed: 1,
      input_refs: ["rag-1"],
      citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
      quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1 },
      trace_ref: "trace-1",
      payload: {
        lab_id: "lab-1",
        title: "for 循环实验",
        objective_ids: ["OBJ-K007"],
        instructions: [{
          block_id: "instruction-1",
          block_type: "paragraph",
          text: "for 循环常用于遍历序列中的元素。",
          claims: [{ claim_id: "claim-1", text: "for 循环常用于遍历序列中的元素。", citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" }] }],
        }],
        execution_contract: {
          language: "python",
          execution_mode: "function",
          entry_point: "main",
          allowed_imports: [],
          input_contract: { type: "list", constraints: [] },
          output_contract: { type: "list" },
          resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 1024 },
        },
        starter_code: "for item in items:\n    print(item)",
        public_tests: [{
          test_id: "test-1",
          objective_id: "OBJ-K007",
          description: "遍历一个序列",
          input: [1, 2, 3],
          expected_behavior: "for 循环常用于遍历序列中的元素。",
          citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
        }],
        hint_ladders: [],
        reflection_questions: [],
        objective_coverage: [{ objective_id: "OBJ-K007", instruction_block_ids: ["instruction-1"], public_test_ids: ["test-1"] }],
        used_evidence: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
      },
    }

    const input = adaptRoleCArtifactToFactAuditInput({ artifact, ragResult })

    expect(input.artifactId).toBe("code-lab-1")
    expect(input.generatedContent.blocks.map((block) => block.blockId)).toEqual(expect.arrayContaining([
      "code_lab:claim:instruction-1:claim-1",
      "code_lab:public_test:test-1",
    ]))
    expect(auditGeneratedContent(input).status).toBe("pass")
  })

  test("extracts reviewable claims from a Role C assessment public artifact envelope", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const artifact: ArtifactEnvelope<AssessmentPublicPayload, "assessment_public", "tiered-evaluator"> = {
      schema_version: "1.0",
      run_id: "run-1",
      artifact_id: "assessment-1",
      artifact_type: "assessment_public",
      agent: "tiered-evaluator",
      status: "ready",
      versions,
      seed: 1,
      input_refs: ["rag-1"],
      citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
      quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1 },
      trace_ref: "trace-1",
      payload: {
        form_id: "form-1",
        title: "for 循环测评",
        objective_ids: ["OBJ-K007"],
        items: [{
          item_id: "item-1",
          family_id: "family-1",
          variant_id: "variant-1",
          display_no: 1,
          objective_id: "OBJ-K007",
          tier: 1,
          modality: "mcq",
          prompt: "for 循环常用于遍历序列。",
          options: [{ option_id: "opt-1", label: "A", text: "遍历序列" }],
          max_score: 1,
          citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
        }],
        submission_policy: { max_attempts: 1, formative: true },
        routing: { anchor_item_ids: ["item-1"], rules: [] },
        objective_coverage: [{ objective_id: "OBJ-K007", item_ids: ["item-1"], modalities: ["mcq"] }],
        used_evidence: [{ source_id: "K007", fact_id: "F001", relation: "supports" }],
      },
    }

    const input = adaptRoleCArtifactToFactAuditInput({ artifact, ragResult })

    expect(input.artifactId).toBe("assessment-1")
    expect(input.generatedContent.blocks).toEqual([{ blockId: "assessment:assessment_item:item-1", text: "for 循环常用于遍历序列。", citations: [{ source_id: "K007", fact_id: "F001" }] }])
    expect(auditGeneratedContent(input).status).toBe("pass")
  })

  test("keeps missing citations visible in code-lab public artifacts", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const artifact: ArtifactEnvelope<CodeLabPublicPayload, "code_lab_public", "code-lab"> = {
      schema_version: "1.0",
      run_id: "run-1",
      artifact_id: "code-lab-missing-citation",
      artifact_type: "code_lab_public",
      agent: "code-lab",
      status: "ready",
      versions,
      seed: 1,
      input_refs: ["rag-1"],
      citations: [],
      quality: { schema_ok: true, citation_coverage: 0, objective_coverage: 1, alignment_score: 1 },
      trace_ref: "trace-1",
      payload: {
        lab_id: "lab-1",
        title: "for 循环实验",
        objective_ids: ["OBJ-K007"],
        instructions: [{
          block_id: "instruction-1",
          block_type: "paragraph",
          text: "for 循环常用于遍历序列中的元素。",
          claims: [{ claim_id: "claim-1", text: "for 循环常用于遍历序列中的元素。", citations: [] }],
        }],
        execution_contract: {
          language: "python",
          execution_mode: "function",
          entry_point: "main",
          allowed_imports: [],
          input_contract: { type: "list", constraints: [] },
          output_contract: { type: "list" },
          resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 1024 },
        },
        starter_code: "for item in items:\n    print(item)",
        public_tests: [],
        hint_ladders: [],
        reflection_questions: [],
        objective_coverage: [{ objective_id: "OBJ-K007", instruction_block_ids: ["instruction-1"], public_test_ids: [] }],
        used_evidence: [],
      },
    }

    const input = adaptRoleCArtifactToFactAuditInput({ artifact, ragResult })

    expect(input.generatedContent.blocks).toEqual([{ blockId: "code_lab:claim:instruction-1:claim-1", text: "for 循环常用于遍历序列中的元素。", citations: [] }])
    expect(auditGeneratedContent(input).status).toBe("revise")
  })

  test("keeps fake citations visible in assessment public artifacts", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const artifact: ArtifactEnvelope<AssessmentPublicPayload, "assessment_public", "tiered-evaluator"> = {
      schema_version: "1.0",
      run_id: "run-1",
      artifact_id: "assessment-fake-citation",
      artifact_type: "assessment_public",
      agent: "tiered-evaluator",
      status: "ready",
      versions,
      seed: 1,
      input_refs: ["rag-1"],
      citations: [{ source_id: "K999", fact_id: "F001", relation: "supports" }],
      quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1 },
      trace_ref: "trace-1",
      payload: {
        form_id: "form-1",
        title: "for 循环测评",
        objective_ids: ["OBJ-K007"],
        items: [{
          item_id: "item-1",
          family_id: "family-1",
          variant_id: "variant-1",
          display_no: 1,
          objective_id: "OBJ-K007",
          tier: 1,
          modality: "mcq",
          prompt: "for 循环常用于遍历序列。",
          max_score: 1,
          citations: [{ source_id: "K999", fact_id: "F001", relation: "supports" }],
        }],
        submission_policy: { max_attempts: 1, formative: true },
        routing: { anchor_item_ids: ["item-1"], rules: [] },
        objective_coverage: [{ objective_id: "OBJ-K007", item_ids: ["item-1"], modalities: ["mcq"] }],
        used_evidence: [{ source_id: "K999", fact_id: "F001", relation: "supports" }],
      },
    }

    const input = adaptRoleCArtifactToFactAuditInput({ artifact, ragResult })

    expect(input.generatedContent.blocks).toEqual([{ blockId: "assessment:assessment_item:item-1", text: "for 循环常用于遍历序列。", citations: [{ source_id: "K999", fact_id: "F001" }] }])
    expect(auditGeneratedContent(input).status).toBe("reject")
  })
})
