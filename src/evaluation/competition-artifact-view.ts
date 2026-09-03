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
          `\n理解检查：${item.prompt}\n${item.options?.map((option) => `${option.label}. ${option.text}`).join("\n") ?? ""}`).join("")
        + conceptPayload.hint_ladders.flatMap(ladder => ladder.hints.map(hint => `\n提示${hint.hint_level}：${hint.text}`)).join(""),
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
        ...publicLabTeachingSurfaces(labPayload).map(surface => surface.text),
      ].filter(Boolean).join("\n\n"),
    },
    {
      artifact_kind: "assessment",
      artifact_id: assessment.artifact_id,
      title: assessmentPayload.title,
      content: assessmentPayload.items.map((item) => [
        `第${item.display_no}题；题型 ${item.modality}`,
        item.prompt,
        item.options?.map((option) => `${option.label}. ${option.text}`).join("\n") ?? "",
        item.starter_code ? `starter_code:\n${item.starter_code}` : "",
      ].filter(Boolean).join("\n")).join("\n\n"),
    },
  ]
}

/** New task/guide surfaces shared by independent difficulty and factual review. */
export function publicLabTeachingSurfaces(lab: import("../role-c-content/contracts/artifacts").CodeLabPublicPayload) {
  const surfaces: Array<{ id: string; text: string; citations: import("../role-c-content/contracts/common").CitationRef[]; local_context?: string }> = []
  const append = (id: string, values: unknown[], citations = lab.used_evidence, local_context?: string) => {
    surfaces.push({ id, text: values.filter(v => v !== undefined && v !== null && v !== "").map(v => typeof v === "string" ? v : JSON.stringify(v)).join("\n"), citations, ...(local_context ? { local_context } : {}) })
  }
  const task = lab.programming_task
  if (task) {
    append("task-statement", [task.statement, task.input_description, task.output_description, ...task.constraints])
    append("task-code", [task.starter_code, task.gap_template?.template_code])
    task.public_examples.forEach((example, i) => append(`task-example-${i}`, [example.description, example.input, example.expected_behavior]))
    task.hint_ladders.forEach(hint => append(`task-hint-${hint.level}`, [hint.text]))
  }
  const guide = lab.practical_guide
  if (guide) {
    append("guide-goal", [guide.practice_goal, guide.deliverable], guide.used_evidence)
    guide.readiness_checks.forEach((s, i) => append(`guide-readiness-${i}`, [s.title, s.check, s.ready_when], s.citations))
    guide.steps.forEach((s, i) => append(`guide-step-${i}`, [s.title, s.action, s.input, s.expected_result, s.verification], s.citations, JSON.stringify({ kind: "practice_step", title: s.title, action: s.action, input: s.input, expected_result: s.expected_result, verification: s.verification })))
    guide.acceptance_criteria.forEach((s, i) => {
      const test = lab.public_tests.find(t => t.test_id === s.public_test_id)
      append(`guide-acceptance-${i}`, [s.description, s.expected_behavior], test?.citations ?? [], JSON.stringify({ kind: "public_acceptance", public_test: test }))
    })
    guide.troubleshooting.forEach((s, i) => append(`guide-troubleshooting-${i}`, [s.symptom, s.likely_cause, ...s.recovery_steps, s.verification], s.citations, JSON.stringify({ kind: "troubleshooting", symptom: s.symptom, likely_cause: s.likely_cause, recovery_steps: s.recovery_steps, verification: s.verification })))
    append("guide-extension", [guide.extension_task.task, guide.extension_task.changed_dimension, guide.extension_task.verification], guide.extension_task.citations)
  }
  return surfaces.filter(s => s.text.trim())
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
