import { auditGeneratedContent } from "../src/fact-audit/auditor"
import { adaptRoleCBlocksToFactAuditInput } from "../src/fact-audit/adapters/role-c-block-adapter"
import { retrieveKnowledge } from "../src/rag/retriever"

const ragResult = await retrieveKnowledge({
  query: "初学者，不会循环，需要完成成绩统计程序",
  learnerLevel: "beginner",
  topK: 3,
})

const roleCScenarios = [
  {
    label: "C 合规输出：可发布",
    artifactId: "role-c-pass",
    blocks: [{
      blockId: "claim-1",
      text: "for 循环常用于遍历序列中的元素。",
      citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" as const }],
    }],
  },
  {
    label: "C 缺少引用：要求修订",
    artifactId: "role-c-revise",
    blocks: [{
      blockId: "claim-1",
      text: "for 循环可以帮助学习者处理重复任务。",
      citations: [],
    }],
  },
  {
    label: "C 假引用：直接驳回",
    artifactId: "role-c-reject",
    blocks: [{
      blockId: "claim-1",
      text: "for 循环常用于遍历序列中的元素。",
      citations: [{ source_id: "K999", fact_id: "F001", relation: "supports" as const }],
    }],
  },
]

const audits = roleCScenarios.map((scenario) => {
  const input = adaptRoleCBlocksToFactAuditInput({
    artifactId: scenario.artifactId,
    ragResult,
    blocks: scenario.blocks,
  })

  return {
    label: scenario.label,
    audit: auditGeneratedContent(input),
  }
})

console.log(JSON.stringify({
  workflow: "Week2_RoleA_fact_audit_for_RoleC",
  a_rag_result: ragResult.results.map((item) => ({
    source_id: item.source_id,
    title: item.title,
    facts: item.facts.map((fact) => ({ source_id: fact.source_id, fact_id: fact.fact_id })),
  })),
  role_c_contract: {
    required_block_fields: ["blockId", "text", "citations"],
    citation_source: "rag_result.results[*].facts",
    statuses: ["pass", "revise", "reject"],
  },
  audits,
}, null, 2))
