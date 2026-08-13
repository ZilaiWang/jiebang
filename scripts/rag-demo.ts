import { retrieveKnowledge } from "../src/rag/retriever"

const query = "初学者，不会循环，需要完成成绩统计程序"
const result = await retrieveKnowledge({ query, learnerLevel: "beginner", topK: 3 })

console.log(`Query: ${result.query}`)
console.log("Top 3:")
for (const [index, item] of result.results.entries()) {
  console.log(`${index + 1}. ${item.source_id} ${item.title} — ${item.reason}`)
}
