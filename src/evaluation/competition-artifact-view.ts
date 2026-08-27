import type { RoleCReviewedReleaseDelivery } from "../role-c-content/contracts/external-api"
import type { RenderBlock } from "../role-c-content/contracts/artifacts"
import type { ArtifactKind } from "./competition-metrics"

export interface CompetitionArtifactView {
  artifact_kind: ArtifactKind
  artifact_id: string
  title: string
  content: string
}

/**
 * 将最终通过审核的三类公开 artifact 转成难度评审可读文本。
 * 不读取 expected_difficulty，也不暴露 secure 答案和隐藏测试。
 */
export function competitionArtifactViews(
  delivery: RoleCReviewedReleaseDelivery,
): CompetitionArtifactView[] {
  const [concept, lab, assessment] = delivery.artifacts
  const conceptPayload = concept.payload!
  const labPayload = lab.payload!
  const assessmentPayload = assessment.payload!
  return [
    {
      artifact_kind: "lesson",
      artifact_id: concept.artifact_id,
      title: conceptPayload.title,
      content: [
        ...conceptPayload.prerequisite_bridge,
        ...conceptPayload.explanation_blocks,
        ...conceptPayload.worked_examples,
        ...conceptPayload.summary,
      ].map(renderBlock).filter(Boolean).join("\n\n")
        + conceptPayload.misconceptions.map((item) => `\n误区辨析：${item.explanation}`).join("")
        + conceptPayload.micro_checks.map((item) =>
          `\n理解检查：${item.prompt}\n${item.options?.map((option) => `${option.label}. ${option.text}`).join("\n") ?? ""}`).join(""),
    },
    {
      artifact_kind: "lab",
      artifact_id: lab.artifact_id,
      title: labPayload.title,
      content: [
        `执行模式：${labPayload.execution_contract.execution_mode}`,
        ...labPayload.instructions.map(renderBlock),
        `starter_code:\n${labPayload.starter_code}`,
        ...labPayload.public_tests.map((test) =>
          `公开测试：${test.description}\n预期行为：${test.expected_behavior}`),
        ...labPayload.hint_ladders.flatMap((ladder) => ladder.hints.map((hint) =>
          `提示${hint.hint_level}：${hint.text}`)),
        ...labPayload.reflection_questions.map((question) => `反思：${question}`),
      ].filter(Boolean).join("\n\n"),
    },
    {
      artifact_kind: "assessment",
      artifact_id: assessment.artifact_id,
      title: assessmentPayload.title,
      content: assessmentPayload.items.map((item) => [
        `第${item.display_no}题；Tier ${item.tier}；题型 ${item.modality}；分值 ${item.max_score}`,
        item.prompt,
        item.options?.map((option) => `${option.label}. ${option.text}`).join("\n") ?? "",
        item.starter_code ? `starter_code:\n${item.starter_code}` : "",
      ].filter(Boolean).join("\n")).join("\n\n"),
    },
  ]
}

function renderBlock(block: RenderBlock): string {
  if (block.block_type === "heading") return `${"#".repeat(block.level)} ${block.text}`
  if (block.block_type === "paragraph") return block.text
  if (block.block_type === "code") return `${block.caption ?? "代码示例"}\n${block.code}`
  if (block.block_type === "callout") return `${block.title}\n${block.text}`
  if (block.block_type === "comparison") {
    return `${block.title}\n${block.columns.map((column) => `${column.heading}：${column.content}`).join("\n")}`
  }
  if (block.block_type === "quiz") {
    return [
      `理解检查：${block.prompt}`,
      block.options?.map((option) => `${option.label}. ${option.text}`).join("\n") ?? "",
      block.answer_explanation ?? "",
    ].filter(Boolean).join("\n")
  }
  if (block.block_type === "hint") return `提示${block.hint_level}：${block.text}`
  return ""
}
