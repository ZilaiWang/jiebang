import type {
  Claim,
  ConceptLessonPayload,
  RenderBlock,
} from "../contracts/artifacts"
import type { CitationRef } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import { validateCitations, type ValidationIssue } from "./citation-validator"
import { claimTextMatchesFact } from "./claim-grounding"
import { validateRoleCSchema } from "./runtime-schema-validator"

export interface ConceptQualityReport {
  ok: boolean
  issues: ValidationIssue[]
  citations: CitationRef[]
  factual_claim_count: number
  cited_claim_count: number
  objective_coverage: number
}

export function validateConceptLesson(input: {
  payload: unknown
  spec: GenerationSpec
  evidence: RagEvidencePack
}): ConceptQualityReport {
  const schemaReport = validateRoleCSchema("concept_lesson_payload.schema.json", input.payload)
  if (!schemaReport.ok) return emptyReport(schemaReport.issues)

  const payload = input.payload as ConceptLessonPayload
  const issues: ValidationIssue[] = []
  const blocks = allBlocks(payload)
  const blockIds = new Set<string>()
  for (const [index, block] of blocks.entries()) {
    if (blockIds.has(block.block_id)) {
      issues.push(issue("duplicate_block_id", `blocks[${index}].block_id`, `block_id 重复：${block.block_id}`))
    }
    blockIds.add(block.block_id)
  }

  const claims = blocks.flatMap(claimsFromBlock)
  const claimIds = new Set<string>()
  claims.forEach((claim, index) => {
    if (claimIds.has(claim.claim_id)) {
      issues.push(issue("duplicate_claim_id", `claims[${index}].claim_id`, `claim_id 重复：${claim.claim_id}`))
    }
    claimIds.add(claim.claim_id)
  })

  const contentCitations = collectContentCitations(payload, claims)
  const citations = deduplicateCitations([...contentCitations, ...payload.used_evidence])
  issues.push(...validateCitations(citations, input.evidence).issues)
  issues.push(...validateClaimGrounding(claims, input.evidence))

  const targetIds = new Set(input.spec.targets.map((target) => target.objective_id))
  const unknownObjectiveIds = payload.objective_ids.filter((objectiveId) => !targetIds.has(objectiveId))
  unknownObjectiveIds.forEach((objectiveId) => {
    issues.push(issue("unknown_objective", "objective_ids", `讲义包含 Spec 中不存在的目标：${objectiveId}`))
  })

  const coverageEntries = new Map(payload.objective_coverage.map((entry) => [entry.objective_id, entry]))
  if (coverageEntries.size !== payload.objective_coverage.length) {
    issues.push(issue("duplicate_objective_coverage", "objective_coverage", "同一 objective 只能有一条覆盖记录"))
  }
  if (new Set(payload.hint_ladders.map((entry) => entry.objective_id)).size !== payload.hint_ladders.length) {
    issues.push(issue("duplicate_hint_ladder", "hint_ladders", "同一 objective 只能有一组三级提示"))
  }
  const explanationIds = new Set(payload.explanation_blocks.map((block) => block.block_id))
  const practiceIds = new Set([
    ...payload.worked_examples.map((block) => block.block_id),
    ...payload.micro_checks.map((block) => block.block_id),
  ])
  const misconceptionIds = new Set(payload.misconceptions.map((entry) => entry.objective_id))
  const hintIds = new Set(payload.hint_ladders.map((entry) => entry.objective_id))
  let coveredCoreObjectives = 0
  const coreTargets = input.spec.targets.filter((target) => target.importance === "core")

  for (const target of coreTargets) {
    const entry = coverageEntries.get(target.objective_id)
    const referencedIds = entry?.block_ids ?? []
    const missingReferences = referencedIds.filter((blockId) => !blockIds.has(blockId))
    if (missingReferences.length > 0) {
      issues.push(issue(
        "unknown_coverage_block",
        `objective_coverage.${target.objective_id}`,
        `目标覆盖引用了不存在的 block：${missingReferences.join("、")}`,
      ))
    }
    const hasInstruction = referencedIds.some((blockId) => explanationIds.has(blockId))
    const hasPractice = referencedIds.some((blockId) => practiceIds.has(blockId))
    const hasMisconception = misconceptionIds.has(target.objective_id)
    const hasHints = hintIds.has(target.objective_id)
    if (!payload.objective_ids.includes(target.objective_id)) {
      issues.push(issue("missing_objective", "objective_ids", `缺少核心目标：${target.objective_id}`))
    }
    for (const factId of target.required_fact_ids) {
      const requiredKey = `${target.source_id}:${factId}`
      const usedByClaim = claims.some((claim) =>
        claim.citations.some((entry) => `${entry.source_id}:${entry.fact_id}` === requiredKey),
      )
      if (!usedByClaim) {
        issues.push(issue(
          "missing_required_fact_usage",
          `targets.${target.objective_id}.required_fact_ids`,
          `核心目标未在任何 Claim 中使用必要事实：${requiredKey}`,
        ))
      }
    }
    if (!hasInstruction) {
      issues.push(issue("missing_instruction", `objective_coverage.${target.objective_id}`, "核心目标缺少解释块"))
    }
    if (!hasPractice) {
      issues.push(issue("missing_practice", `objective_coverage.${target.objective_id}`, "核心目标缺少示例或即时检查"))
    }
    if (!hasMisconception) {
      issues.push(issue("missing_misconception", `misconceptions.${target.objective_id}`, "核心目标缺少误区说明"))
    }
    if (!hasHints) {
      issues.push(issue("missing_hint_ladder", `hint_ladders.${target.objective_id}`, "核心目标缺少三级提示"))
    }
    const ladder = payload.hint_ladders.find((candidate) => candidate.objective_id === target.objective_id)
    const levels = new Set(ladder?.hints.map((hint) => hint.hint_level) ?? [])
    if ([1, 2, 3].some((level) => !levels.has(level as 1 | 2 | 3))) {
      issues.push(issue("invalid_hint_levels", `hint_ladders.${target.objective_id}`, "三级提示必须各包含 level 1、2、3"))
    }
    if (entry && hasInstruction && hasPractice && hasMisconception && hasHints && missingReferences.length === 0) {
      coveredCoreObjectives += 1
    }
  }

  const prerequisiteCitations = new Set(citations
    .filter((entry) => entry.relation === "prerequisite")
    .map((entry) => entry.source_id))
  const availableSources = new Set(input.evidence.results.map((entry) => entry.source_id))
  for (const sourceId of input.spec.path_node.prerequisite_source_ids.filter((entry) => availableSources.has(entry))) {
    if (!prerequisiteCitations.has(sourceId)) {
      issues.push(issue(
        "missing_prerequisite_bridge",
        "prerequisite_bridge",
        `缺少先修知识桥梁及 prerequisite 引用：${sourceId}`,
      ))
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    citations,
    factual_claim_count: claims.length,
    cited_claim_count: claims.filter((claim) => claim.citations.length > 0).length,
    objective_coverage: coreTargets.length === 0 ? 1 : coveredCoreObjectives / coreTargets.length,
  }
}

function validateClaimGrounding(claims: Claim[], evidence: RagEvidencePack): ValidationIssue[] {
  const facts = new Map(
    evidence.results.flatMap((item) =>
      item.facts.map((fact) => [`${fact.source_id}:${fact.fact_id}`, fact.content] as const),
    ),
  )
  return claims.flatMap((claim, index) => {
    const grounded = claim.citations.some((citation) => {
      const fact = facts.get(`${citation.source_id}:${citation.fact_id}`)
      if (!fact) return false
      return claimTextMatchesFact(claim.text, fact)
    })
    if (grounded) return []
    return [issue(
      "claim_not_grounded",
      `claims[${index}]`,
      `Claim ${claim.claim_id} 未保留任何所引事实的可核验表述`,
    )]
  })
}

function allBlocks(payload: ConceptLessonPayload): RenderBlock[] {
  return [
    ...payload.prerequisite_bridge,
    ...payload.explanation_blocks,
    ...payload.worked_examples,
    ...payload.micro_checks,
    ...payload.summary,
  ]
}

function claimsFromBlock(block: RenderBlock): Claim[] {
  return "claims" in block ? block.claims : []
}

function collectContentCitations(payload: ConceptLessonPayload, claims: Claim[]): CitationRef[] {
  const collected = [
    ...claims.flatMap((claim) => claim.citations),
    ...payload.misconceptions.flatMap((entry) => entry.citations),
    ...payload.micro_checks.flatMap((entry) => entry.citations),
    ...payload.hint_ladders.flatMap((entry) => entry.hints.flatMap((hint) => hint.citations)),
    ...allBlocks(payload).flatMap((block) => "citations" in block ? block.citations : []),
  ]
  return [...new Map(collected.map((citation) => [citationKey(citation), citation])).values()]
}

function deduplicateCitations(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((citation) => [citationKey(citation), citation])).values()]
}

function citationKey(citation: CitationRef): string {
  return `${citation.source_id}:${citation.fact_id}:${citation.relation}`
}

function emptyReport(issues: ValidationIssue[]): ConceptQualityReport {
  return {
    ok: false,
    issues,
    citations: [],
    factual_claim_count: 0,
    cited_claim_count: 0,
    objective_coverage: 0,
  }
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: "critical" }
}
