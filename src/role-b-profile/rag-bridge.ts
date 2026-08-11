// 输入: 标准学习者画像 (LearnerProfile)
// 输出: 符合 schemas/rag_request.schema.json 的 rag_request，以及实际执行检索的结果
// 作用: B → A 交接的唯一出口。query 拼接格式是全组契约
// （docs/team_integration_guide.md 与联调说明 §7），只允许在这里生成，禁止各处手拼。
import { retrieveKnowledge } from "../rag/retriever"
import type { RagResult } from "../rag/retriever"
import type { LearnerProfile, RagRequest } from "./types"

// B→A 请求的 top_k 后端策略值，不依赖已下线的旧 D 联调脚本
export const DEFAULT_TOP_K = 5

// 全组约定的 query 格式：学习者水平：…；已掌握：…；薄弱点：…；学习目标：…
// 空数组写 "无"，保持四段结构稳定（检索器与 C/D 都按这个结构理解 query）
export function buildRagQuery(profile: LearnerProfile): string {
  const known = profile.known_concepts.length > 0 ? profile.known_concepts.join("、") : "无"
  const weak = profile.weak_concepts.length > 0 ? profile.weak_concepts.join("、") : "无"
  return [
    `学习者水平：${profile.level}`,
    `已掌握：${known}`,
    `薄弱点：${weak}`,
    `学习目标：${profile.goal}`,
  ].join("；")
}

export function buildRagRequest(profile: LearnerProfile, topK: number = DEFAULT_TOP_K): RagRequest {
  return {
    learner_profile: profile,
    query: buildRagQuery(profile),
    top_k: topK,
  }
}

// 画像 → 检索 一步到位：运行时 worker 无工具无法调用本函数，
// 由脚本 / 测试 / 未来的工具层（联调说明 §13 预告的封装）执行
export async function executeProfileRetrieval(
  profile: LearnerProfile,
  topK: number = DEFAULT_TOP_K,
): Promise<{ rag_request: RagRequest; rag_result: RagResult }> {
  const request = buildRagRequest(profile, topK)
  const result = await retrieveKnowledge({
    query: request.query,
    learnerLevel: profile.level,
    topK: request.top_k,
  })
  return { rag_request: request, rag_result: result }
}
