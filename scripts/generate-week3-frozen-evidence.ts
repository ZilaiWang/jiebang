import { retrieveKnowledge } from "../src/rag/retriever"
import { adaptRagResult } from "../src/role-c-content/contracts/evidence-pack"
import { contentHash } from "../src/role-c-content/contracts/common"

const ragResult = await retrieveKnowledge({
  query: "初学者，不会循环，需要完成成绩统计程序",
  learnerLevel: "beginner",
  topK: 3,
})
const pack = adaptRagResult(ragResult, {
  kb_version: "python-basic@0.2.0",
  rag_version: "rule-rag@0.1",
  retrieval_id: "RAG-WEEK3-FROZEN-DEMO",
})
await Bun.write("examples/frozen_evidence_pack_week3_demo.json", JSON.stringify(pack, null, 2))
console.log(JSON.stringify({ path: "examples/frozen_evidence_pack_week3_demo.json", hash: contentHash(pack), sources: pack.results.map((item) => item.source_id) }))
