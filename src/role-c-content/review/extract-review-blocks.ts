import type {
  AssessmentPublicArtifact,
  CodeLabPublicArtifact,
  ConceptLessonArtifact,
  RenderBlock,
} from "../contracts/artifacts"
import type { CitationRef } from "../contracts/common"
import type {
  ReviewBlockLocator,
  ReviewContentBlock,
  ReviewablePublicArtifact,
} from "./types"

export function extractReviewBlocks(target: ReviewablePublicArtifact): ReviewContentBlock[] {
  const blocks = target.kind === "concept"
    ? extractConceptBlocks(target.artifact)
    : target.kind === "code_lab"
      ? extractCodeLabBlocks(target.artifact)
      : extractAssessmentBlocks(target.artifact)
  assertUniqueReviewBlockIds(blocks)
  return blocks
}

export function extractConceptBlocks(artifact: ConceptLessonArtifact): ReviewContentBlock[] {
  const payload = artifact.payload
  if (!payload) return []
  const objectiveByBlock = new Map(
    payload.objective_coverage.flatMap((coverage) =>
      coverage.block_ids.map((blockId) => [blockId, coverage.objective_id] as const)),
  )
  const factNarrativeBlocks = [
    ...payload.prerequisite_bridge,
    ...payload.explanation_blocks,
    ...payload.summary,
  ]
  return [
    ...factNarrativeBlocks.flatMap((block) => reviewRenderBlock("concept", block, objectiveByBlock.get(block.block_id))),
    ...payload.worked_examples.flatMap((block) => reviewRenderBlock(
      "concept",
      block,
      objectiveByBlock.get(block.block_id),
      "citation_only",
    )),
    ...payload.misconceptions.map((item) => makeBlock(
      "concept",
      { field: "misconception", ref_id: item.misconception_tag, objective_id: item.objective_id },
      item.explanation,
      item.citations,
      "evidence_anchored",
    )),
    ...payload.micro_checks.map((block) => makeBlock(
      "concept",
      { field: "quiz", ref_id: block.item_id, parent_block_id: block.block_id, objective_id: objectiveByBlock.get(block.block_id) },
      promptWithOptions(block.prompt, block.options),
      block.citations,
      "citation_only",
    )),
    ...payload.hint_ladders.flatMap((ladder) => ladder.hints.map((hint) => makeBlock(
      "concept",
      { field: "hint", ref_id: `${ladder.objective_id}:hint-${hint.hint_level}`, objective_id: ladder.objective_id },
      hint.text,
      hint.citations,
      "citation_only",
    ))),
  ]
}

export function extractCodeLabBlocks(artifact: CodeLabPublicArtifact): ReviewContentBlock[] {
  const payload = artifact.payload
  if (!payload) return []
  const objectiveByInstruction = new Map(
    payload.objective_coverage.flatMap((coverage) =>
      coverage.instruction_block_ids.map((blockId) => [blockId, coverage.objective_id] as const)),
  )
  return [
    ...payload.instructions.flatMap((block) =>
      reviewRenderBlock("code_lab", block, objectiveByInstruction.get(block.block_id))),
    ...payload.public_tests.map((test) => makeBlock(
      "code_lab",
      { field: "public_test", ref_id: test.test_id, objective_id: test.objective_id },
      `${test.description}\n预期行为：${test.expected_behavior}`,
      test.citations,
      "citation_only",
    )),
    ...payload.hint_ladders.flatMap((ladder) => ladder.hints.map((hint) => makeBlock(
      "code_lab",
      { field: "hint", ref_id: `${ladder.objective_id}:hint-${hint.hint_level}`, objective_id: ladder.objective_id },
      hint.text,
      hint.citations,
      "citation_only",
    ))),
    makeBlock(
      "code_lab",
      { field: "starter_code", ref_id: payload.lab_id },
      payload.starter_code,
      payload.used_evidence,
      "citation_only",
    ),
    ...payload.reflection_questions.map((question, index) => makeBlock(
      "code_lab",
      { field: "reflection", ref_id: `${payload.lab_id}:${index + 1}` },
      question,
      payload.used_evidence,
      "citation_only",
    )),
  ]
}

export function extractAssessmentBlocks(artifact: AssessmentPublicArtifact): ReviewContentBlock[] {
  return artifact.payload?.items.flatMap((item) => [
    makeBlock(
      "assessment",
      { field: "assessment_item", ref_id: item.item_id, objective_id: item.objective_id },
      item.prompt,
      item.citations,
      "citation_only",
    ),
    ...(item.options ?? []).map((option) => makeBlock(
      "assessment",
      {
        field: "option",
        ref_id: option.option_id,
        parent_block_id: item.item_id,
        objective_id: item.objective_id,
      },
      `${option.label}：${option.text}`,
      item.citations,
      "citation_only",
    )),
    ...(item.starter_code ? [makeBlock(
      "assessment",
      {
        field: "starter_code",
        ref_id: `${item.item_id}:starter`,
        parent_block_id: item.item_id,
        objective_id: item.objective_id,
      },
      item.starter_code,
      item.citations,
      "citation_only",
    )] : []),
  ]) ?? []
}

function reviewRenderBlock(
  kind: "concept" | "code_lab",
  block: RenderBlock,
  objectiveId?: string,
  renderedFactMode?: ReviewContentBlock["fact_audit_mode"],
): ReviewContentBlock[] {
  const claims = "claims" in block ? block.claims : []
  const citations = deduplicateCitations(claims.flatMap((claim) => claim.citations))
  const rendered = renderedBlockText(block)
  const renderedReview = rendered
    ? [makeBlock(
        kind,
        {
          field: "render_content",
          ref_id: block.block_id,
          objective_id: objectiveId,
        },
        rendered,
        citations,
        renderedFactMode
          ?? (block.block_type === "code" ? "citation_only" : "evidence_anchored"),
      )]
    : []
  if ("claims" in block) {
    return [
      ...renderedReview,
      ...block.claims.map((claim) => makeBlock(
      kind,
      {
        field: "claim",
        ref_id: claim.claim_id,
        parent_block_id: block.block_id,
        objective_id: objectiveId,
      },
      claim.text,
      claim.citations,
      "claim",
      )),
    ]
  }
  if (block.block_type === "quiz") {
    return [makeBlock(
      kind,
      { field: "quiz", ref_id: block.item_id, parent_block_id: block.block_id, objective_id: objectiveId },
      promptWithOptions(block.prompt, block.options),
      block.citations,
      "citation_only",
    )]
  }
  if (block.block_type === "hint") {
    return [makeBlock(
      kind,
      { field: "hint", ref_id: block.block_id, objective_id: objectiveId },
      block.text,
      block.citations,
      "citation_only",
    )]
  }
  return []
}

function renderedBlockText(block: RenderBlock): string | undefined {
  if (block.block_type === "paragraph") return block.text
  if (block.block_type === "code") {
    return [block.caption, block.code].filter(Boolean).join("\n")
  }
  if (block.block_type === "callout") return `${block.title}\n${block.text}`
  if (block.block_type === "comparison") {
    return [
      block.title,
      ...block.columns.map((column) => `${column.heading}\n${column.content}`),
    ].join("\n")
  }
  return undefined
}

function deduplicateCitations(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((citation) => [
    `${citation.source_id}:${citation.fact_id}:${citation.relation}`,
    citation,
  ])).values()]
}

function promptWithOptions(
  prompt: string,
  options?: Array<{ label: string; text: string }>,
): string {
  if (!options?.length) return prompt
  return [
    prompt,
    ...options.map((option) => `${option.label}：${option.text}`),
  ].join("\n")
}

function makeBlock(
  kind: "concept" | "code_lab" | "assessment",
  locator: ReviewBlockLocator,
  text: string,
  citations: CitationRef[],
  factAuditMode: ReviewContentBlock["fact_audit_mode"],
): ReviewContentBlock {
  const parent = locator.parent_block_id ? `:${locator.parent_block_id}` : ""
  return {
    review_block_id: `${kind}:${locator.field}${parent}:${locator.ref_id}`,
    text,
    citations: citations.map((citation) => ({ ...citation })),
    fact_audit_mode: factAuditMode,
    locator: { ...locator },
  }
}

function assertUniqueReviewBlockIds(blocks: ReviewContentBlock[]): void {
  const seen = new Set<string>()
  for (const block of blocks) {
    if (seen.has(block.review_block_id)) {
      throw new Error(`ROLE_C_REVIEW_DUPLICATE_BLOCK:${block.review_block_id}`)
    }
    seen.add(block.review_block_id)
  }
}
