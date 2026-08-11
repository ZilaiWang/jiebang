import { auditGeneratedContent } from "../src/fact-audit/auditor"
import { retrieveKnowledge } from "../src/rag/retriever"

const ragResult = await retrieveKnowledge({
  query: "初学者，不会循环，需要完成成绩统计程序",
  learnerLevel: "beginner",
  topK: 3,
})

const scenarios = [
  {
    artifactId: "demo-pass",
    label: "正确引用通过",
    generatedContent: {
      blocks: [
        {
          blockId: "pass-1",
          text: "for 循环常用于遍历序列中的元素。",
          citations: [{ source_id: "K007", fact_id: "F001" }],
        },
      ],
    },
  },
  {
    artifactId: "demo-revise",
    label: "缺少引用要求修订",
    generatedContent: {
      blocks: [
        {
          blockId: "revise-1",
          text: "for 循环可以帮助学习者处理重复任务。",
          citations: [],
        },
      ],
    },
  },
  {
    artifactId: "demo-reject",
    label: "外部知识直接驳回",
    generatedContent: {
      blocks: [
        {
          blockId: "reject-1",
          text: "Transformer 通过自注意力机制学习上下文关系。",
          citations: [{ source_id: "K007", fact_id: "F001" }],
        },
      ],
    },
  },
]

const results = scenarios.map((scenario) => ({
  label: scenario.label,
  ...auditGeneratedContent({
    artifactId: scenario.artifactId,
    ragResult,
    generatedContent: scenario.generatedContent,
  }),
}))

console.log(JSON.stringify({
  workflow: "A_fact_audit_mvp_demo",
  rag_sources: ragResult.results.map((item) => ({ source_id: item.source_id, title: item.title })),
  results,
}, null, 2))
