import type { ConceptLessonPayload, RenderBlock } from "../contracts/artifacts"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { AlignmentObjection } from "../validators/alignment-validator"
import {
  normalizeGroundedClaimText,
  visibleTeachingTextExpressesFact,
} from "../validators/claim-grounding"
import type { LabTextRevisionField } from "./code-lab-text-revision"
import { applyCodeLabTextRevision } from "./code-lab-text-revision"

/** Resolve only learner-facing prose locations; code, citations, IDs and coverage remain frozen. */
export function planConceptTextRevision(payload: ConceptLessonPayload, objections: AlignmentObjection[]): LabTextRevisionField[] | undefined {
  if (!objections.length) return undefined
  const groups = new Map<string, LabTextRevisionField[]>()
  const add = (key: string, entries: LabTextRevisionField[]) => groups.set(key, entries)
  const arrays = ["prerequisite_bridge", "explanation_blocks", "worked_examples", "summary"] as const
  for (const name of arrays) payload[name].forEach((block, i) => {
    const path = `/${name}/${i}`, fields: LabTextRevisionField[] = []
    if (block.block_type === "heading" || block.block_type === "paragraph" || block.block_type === "hint") fields.push({ path: `${path}/text`, value: block.text })
    if (block.block_type === "callout") fields.push({ path: `${path}/title`, value: block.title }, { path: `${path}/text`, value: block.text })
    if (block.block_type === "comparison") {
      fields.push({ path: `${path}/title`, value: block.title })
      block.columns.forEach((col, j) => fields.push({ path: `${path}/columns/${j}/heading`, value: col.heading }, { path: `${path}/columns/${j}/content`, value: col.content }))
    }
    if (block.block_type !== "code" && block.block_type !== "citation" && fields.length > 0) {
      add(`render_content:${block.block_id}`, fields)
      // A claim locator identifies the evidence assertion that caused the
      // objection, but Claim text is an evidence-owned binding. Repair the
      // learner-facing block that contains it and keep Claim/citation data
      // byte-for-byte frozen. Editing the Claim alone used to change the
      // candidate hash without removing the offending public sentence.
      if ("claims" in block) block.claims.forEach((claim) =>
        add(`claim:${claim.claim_id}`, fields))
    }
  })
  payload.misconceptions.forEach((item, i) => add(`misconception:${item.misconception_tag}`, [{ path: `/misconceptions/${i}/explanation`, value: item.explanation }]))
  payload.micro_checks.forEach((item, i) => {
    const fields = [{ path: `/micro_checks/${i}/prompt`, value: item.prompt }]
    item.options?.forEach((option, j) => fields.push({ path: `/micro_checks/${i}/options/${j}/text`, value: option.text }))
    if (item.answer_explanation) fields.push({ path: `/micro_checks/${i}/answer_explanation`, value: item.answer_explanation })
    add(`quiz:${item.item_id}`, fields)
  })
  payload.hint_ladders.forEach((ladder, i) => ladder.hints.forEach((hint, j) =>
    add(`hint:${ladder.objective_id}:hint-${hint.hint_level}`, [{ path: `/hint_ladders/${i}/hints/${j}/text`, value: hint.text }])))
  const selected = new Map<string, LabTextRevisionField>()
  for (const objection of objections) {
    if (objection.issue_type !== "unsupported_claim" || objection.fix_scope !== "artifact" || !objection.locator) return undefined
    const fields = groups.get(`${objection.locator.field}:${objection.locator.ref_id}`)
    if (!fields?.length) return undefined
    fields.forEach((field) => selected.set(field.path, field))
  }
  return [...selected.values()]
}

export function applyConceptTextRevision(payload: ConceptLessonPayload, fields: LabTextRevisionField[], replacements: LabTextRevisionField[]) {
  return applyCodeLabTextRevision(payload as any, fields, replacements) as unknown as ConceptLessonPayload
}

/**
 * Local invariants for an externally requested prose revision.
 *
 * The ordinary Concept validator proves Claim/citation correctness, but a
 * localized rewrite can still delete the visible sentence that presents an
 * otherwise-valid Claim. Check that every edited learner-facing block keeps
 * its frozen facts visible and that an explicitly identified unsupported
 * fragment was actually removed before returning the candidate to A/B review.
 */
export function validateConceptTextRevision(input: {
  before: ConceptLessonPayload
  after: ConceptLessonPayload
  fields: LabTextRevisionField[]
  objections: AlignmentObjection[]
  evidence: RagEvidencePack
}): string[] {
  const issues: string[] = []
  const facts = new Map(input.evidence.results.flatMap((source) =>
    source.facts.map((fact) => [`${fact.source_id}:${fact.fact_id}`, fact.content] as const)))
  const editedPaths = new Set(input.fields.map((field) => field.path))
  const blocks = locatedBlocks(input.after)

  for (const located of blocks) {
    if (!located.fieldPaths.some((path) => editedPaths.has(path))) continue
    if (!("claims" in located.block) || located.block.claims.length === 0) continue
    const visible = renderedLearnerText(located.block)
    for (const claim of located.block.claims) {
      const presentsFact = claim.citations.some((citation) => {
        const fact = facts.get(`${citation.source_id}:${citation.fact_id}`)
        return fact ? visibleTeachingTextExpressesFact(visible, fact) : false
      })
      if (!presentsFact) {
        issues.push(`[REVIEW_FACT_ANCHOR_REMOVED] ${located.path} must visibly preserve frozen Claim ${claim.claim_id}: ${claim.text}`)
      }
    }
  }

  const editedText = input.fields.map((field) => {
    const replacement = readPointerString(input.after, field.path)
    return normalizeGroundedClaimText(replacement ?? "")
  })
  for (const objection of input.objections) {
    for (const ref of objection.evidence.filter((entry) => entry.startsWith("text:"))) {
      const unsupported = normalizeGroundedClaimText(ref.slice("text:".length))
      if (unsupported.length >= 6 && editedText.some((text) => text.includes(unsupported))) {
        issues.push(`[REVIEW_UNSUPPORTED_TEXT_RETAINED] remove or rewrite the unsupported fragment: ${ref.slice("text:".length)}`)
      }
    }
  }

  // applyConceptTextRevision already restricts writable JSON pointers. Keep an
  // explicit immutable check here so later refactors cannot silently make
  // Claim/citation data editable.
  if (JSON.stringify(claimBindings(input.before)) !== JSON.stringify(claimBindings(input.after))) {
    issues.push("[REVIEW_EVIDENCE_BINDING_CHANGED] localized prose revision must not change claims or citations")
  }
  return [...new Set(issues)]
}

function locatedBlocks(payload: ConceptLessonPayload): Array<{
  path: string
  block: RenderBlock
  fieldPaths: string[]
}> {
  const arrays = ["prerequisite_bridge", "explanation_blocks", "worked_examples", "summary"] as const
  return arrays.flatMap((name) => payload[name].map((block, index) => {
    const path = `/${name}/${index}`
    const fieldPaths: string[] = []
    if (block.block_type === "paragraph" || block.block_type === "hint" || block.block_type === "heading") {
      fieldPaths.push(`${path}/text`)
    } else if (block.block_type === "callout") {
      fieldPaths.push(`${path}/title`, `${path}/text`)
    } else if (block.block_type === "comparison") {
      fieldPaths.push(`${path}/title`)
      block.columns.forEach((_column, columnIndex) =>
        fieldPaths.push(`${path}/columns/${columnIndex}/heading`, `${path}/columns/${columnIndex}/content`))
    }
    return { path, block, fieldPaths }
  }))
}

function renderedLearnerText(block: RenderBlock): string {
  if (block.block_type === "paragraph" || block.block_type === "hint" || block.block_type === "heading") return block.text
  if (block.block_type === "callout") return `${block.title}\n${block.text}`
  if (block.block_type === "comparison") return [block.title, ...block.columns.flatMap((column) => [column.heading, column.content])].join("\n")
  if (block.block_type === "code") return [block.caption, block.code].filter(Boolean).join("\n")
  return ""
}

function claimBindings(payload: ConceptLessonPayload): unknown {
  return locatedBlocks(payload).flatMap(({ path, block }) =>
    "claims" in block ? block.claims.map((claim) => ({ path, claim })) : [])
}

function readPointerString(value: unknown, pointer: string): string | undefined {
  let current: unknown = value
  for (const part of pointer.slice(1).split("/")) {
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === "string" ? current : undefined
}
