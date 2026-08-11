import type {
  AnswerSpec,
  AssessmentItemPublic,
  AssessmentItemSecure,
  AssessmentPublicPayload,
  AssessmentSecurePayload,
  CodeLabPublicPayload,
  CodeLabSecurePayload,
  ConceptLessonPayload,
  ExecutionContract,
  RenderBlock,
  TestComparison,
} from "../contracts/artifacts"
export { classifyOutputContract } from "../contracts/output-contract"
import { classifyOutputContract } from "../contracts/output-contract"
import { stableId, type CitationRef } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import { ModelOutputValidationError } from "../contracts/model-gateway"
import {
  modalityMeasuresBehavior,
  preferredModalityForBehavior,
} from "../contracts/assessment-measurement"
import {
  claimTextMatchesFact,
  normalizeGroundedClaimText,
} from "../validators/claim-grounding"
import type { CodeLabRequest, ConceptTutorRequest } from "../agents/types"

export interface ConceptSegmentRequest extends ConceptTutorRequest {
  segment_index: number
  segment_count: number
}

/** Compact pedagogical prose authored by the model before trusted IDs/citations are attached. */
export interface ConceptSegmentAuthorPayload {
  title: string
  objectives: Array<{
    explanation: string
    worked_example: string
    misconception: string
    micro_check_prompt: string
    micro_check_options: string[]
    /** 正确选项的原文（必须与 micro_check_options 中某项完全一致）。 */
    micro_check_answer: string
    /** 点击后的解析文本。 */
    micro_check_explanation: string
    hints: string[]
    summary: string
  }>
}

export interface CodeLabObjectivePlan {
  objective_id: string
  source_id: string
  instruction_block_id: string
  public_test_id: string
  citations: CitationRef[]
}

/** Compact public lab semantics before trusted identities and citations are attached. */
export interface CodeLabPublicAuthorPayload {
  title: string
  execution_contract: ExecutionContract
  starter_code: string
  objectives: Array<{
    instruction_text: string
    public_test: {
      description: string
      input: unknown
      expected_behavior: string
    }
    hints: string[]
    reflection_question: string
  }>
}

export interface CodeLabSecurePlan {
  hidden_tests: Array<{
    test_id: string
    objective_id: string
    case_kind: "normal" | "boundary"
    weight: number
  }>
  mutation_variants: Array<{
    mutation_id: string
    objective_ids: string[]
    must_fail_test_ids: string[]
  }>
}

/** Minimal private patch authored after trusted execution; all identities stay frozen. */
export interface CodeLabExecutionRepairPatch {
  reference_solution: string | null
  hidden_test_repairs: Array<{
    test_id: string
    input: unknown
    expected: unknown
    comparison: TestComparison
  }>
  mutation_repairs: Array<{
    mutation_id: string
    code: string
  }>
}

/** Model-authored executable semantics before deterministic IDs and scoring are attached. */
export interface CodeLabSecureAuthorPayload {
  reference_solution: string
  hidden_tests: Array<{
    input: unknown
    expected: unknown
    comparison: TestComparison
    misconception_tag: string
  }>
  mutation_variants: Array<{
    code: string
    misconception_tag: string
  }>
}

export interface AssessmentItemPlan {
  item_id: string
  family_id: string
  variant_id: string
  display_no: number
  objective_id: string
  tier: 1 | 2 | 3
  modality: AssessmentItemPublic["modality"]
  max_score: number
  citations: CitationRef[]
}

/** Public question semantics before stable IDs, scoring, routing and citations are attached. */
export interface AssessmentPublicAuthorPayload {
  title: string
  items: Array<{
    prompt: string
    options: string[] | null
    starter_code: string | null
  }>
}

/** Model-authored answer semantics before deterministic item and suite identities are attached. */
export interface AssessmentSecureAuthorPayload {
  items: Array<{
    answer_spec: AnswerSpec | null
    correct_option_id: string | null
    misconception_by_option: Record<string, string>
  }>
  code_test_suites: Array<{
    execution_contract: ExecutionContract
    reference_solution: string
    hidden_tests: Array<{
      input: unknown
      expected: unknown
      comparison: TestComparison
    }>
  }>
}

export function splitConceptRequest(
  request: ConceptTutorRequest,
  groupSize: number,
): ConceptSegmentRequest[] {
  const groups = chunk(request.generation_spec.targets, groupSize)
  return groups.map((targets, index) => {
    const targetSources = unique(targets.map((target) => target.source_id))
    const prerequisiteSources = index === 0
      ? request.generation_spec.path_node.prerequisite_source_ids
      : []
    const includedSources = new Set([...targetSources, ...prerequisiteSources])
    const results = request.evidence_pack.results
      .filter((entry) => includedSources.has(entry.source_id))
      .map((entry) => structuredClone(entry))
    const retrievalId = stableId("RAGSEG", {
      retrieval_id: request.evidence_pack.retrieval_id,
      objective_ids: targets.map((target) => target.objective_id),
      index,
    })
    const spec: GenerationSpec = {
      ...structuredClone(request.generation_spec),
      spec_id: stableId("SPECSEG", {
        spec_id: request.generation_spec.spec_id,
        objective_ids: targets.map((target) => target.objective_id),
        index,
      }),
      evidence_ref: retrievalId,
      path_node: {
        ...structuredClone(request.generation_spec.path_node),
        target_source_ids: targetSources,
        prerequisite_source_ids: [...prerequisiteSources],
      },
      targets: structuredClone(targets),
    }
    const evidencePack: RagEvidencePack = {
      ...structuredClone(request.evidence_pack),
      retrieval_id: retrievalId,
      query: `${request.evidence_pack.query} [concept segment ${index + 1}/${groups.length}]`,
      top_k: results.length,
      results,
    }
    return {
      ...request,
      generation_spec: spec,
      evidence_pack: evidencePack,
      segment_index: index,
      segment_count: groups.length,
    }
  })
}

/**
 * Tolerates json_object-mode concept authoring sloppiness that the deterministic
 * plan checks would otherwise reject: duplicated quiz options and surplus hints.
 * Genuine deficits (fewer than two options, fewer than three hints) stay failing.
 */
export function normalizeConceptSegmentAuthorPayloadLenient(
  payload: ConceptSegmentAuthorPayload,
): ConceptSegmentAuthorPayload {
  const normalized = structuredClone(payload)
  for (const entry of normalized.objectives) {
    const seen = new Set<string>()
    const deduped = entry.micro_check_options.filter((option) => {
      const key = option.trim().toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (deduped.length >= 2) {
      entry.micro_check_options = deduped.length > 4 ? deduped.slice(0, 4) : deduped
    }
    if (entry.hints.length > 3) {
      entry.hints = entry.hints.slice(0, 3)
    }
  }
  return normalized
}

export function validateConceptSegmentAuthorAgainstRequest(
  request: ConceptTutorRequest,
  payload: ConceptSegmentAuthorPayload,
): string[] {
  const issues: string[] = []
  if (payload.objectives.length !== request.generation_spec.targets.length) {
    issues.push(
      `objectives 数量应为 ${request.generation_spec.targets.length}，实际 ${payload.objectives.length}`,
    )
  }
  payload.objectives.forEach((entry, index) => {
    if (entry.hints.length !== 3) {
      issues.push(`objectives[${index}].hints 必须恰好包含三级提示`)
    }
    if (entry.micro_check_options.length < 2
      || entry.micro_check_options.length > 4) {
      issues.push(`objectives[${index}].micro_check_options 必须包含 2..4 项`)
    }
    const normalizedOptions = entry.micro_check_options
      .map((option) => option.trim().toLocaleLowerCase())
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      issues.push(`objectives[${index}].micro_check_options 不得重复`)
    }
    if (!entry.micro_check_answer?.trim()) {
      issues.push(`objectives[${index}].micro_check_answer 必须指定正确选项的原文`)
    } else if (!normalizedOptions.includes(
      entry.micro_check_answer.trim().toLocaleLowerCase(),
    )) {
      issues.push(`objectives[${index}].micro_check_answer 必须与某个 micro_check_options 完全一致`)
    }
    if (!entry.micro_check_explanation?.trim()) {
      issues.push(`objectives[${index}].micro_check_explanation 不能为空`)
    }
  })
  return issues
}

/** 解析 author 提供的正确选项文本，返回物化后的即时反馈答案字段。 */
function withMicroCheckAnswer(
  authored: ConceptSegmentAuthorPayload["objectives"][number],
  identity: { spec_id: string; objective_id: string; source_id: string },
): { answer_option_id: string; answer_explanation: string } | Record<string, never> {
  const optionIndex = authored.micro_check_options.findIndex((option) =>
    option.trim().toLocaleLowerCase()
      === authored.micro_check_answer?.trim().toLocaleLowerCase())
  if (optionIndex < 0) return {}
  return {
    answer_option_id: stableId("CONCEPT-CHECK-OPTION", {
      ...identity,
      option_index: optionIndex,
    }),
    answer_explanation: authored.micro_check_explanation.trim(),
  }
}

/**
 * Deterministically expands compact authored prose into the canonical lesson.
 * Evidence claims, citations, identities and coverage never rely on model output.
 */
export function materializeConceptSegmentAuthorPayload(
  request: ConceptTutorRequest,
  payload: ConceptSegmentAuthorPayload,
): ConceptLessonPayload {
  const facts = new Map(request.evidence_pack.results.flatMap((entry) =>
    entry.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  const explanationBlocks: ConceptLessonPayload["explanation_blocks"] = []
  const workedExamples: ConceptLessonPayload["worked_examples"] = []
  const misconceptions: ConceptLessonPayload["misconceptions"] = []
  const microChecks: ConceptLessonPayload["micro_checks"] = []
  const hintLadders: ConceptLessonPayload["hint_ladders"] = []
  const summary: ConceptLessonPayload["summary"] = []
  const objectiveCoverage: ConceptLessonPayload["objective_coverage"] = []

  request.generation_spec.targets.forEach((target, index) => {
    const authored = payload.objectives[index]!
    const identity = {
      spec_id: request.generation_spec.spec_id,
      objective_id: target.objective_id,
      source_id: target.source_id,
    }
    const citations = target.required_fact_ids.map((factId) => ({
      source_id: target.source_id,
      fact_id: factId,
      relation: "supports" as const,
    }))
    const claims = (kind: string) => citations.map((citation, factIndex) => ({
      claim_id: stableId("CONCEPT-CLAIM", {
        ...identity,
        kind,
        fact_id: citation.fact_id,
        fact_index: factIndex,
      }),
      text: facts.get(`${citation.source_id}:${citation.fact_id}`) ?? "",
      citations: [structuredClone(citation)],
    }))
    const evidenceText = citations
      .map((citation) => facts.get(`${citation.source_id}:${citation.fact_id}`) ?? "")
      .filter(Boolean)
      .join("；")
    const explanationId = stableId("CONCEPT-EXPLANATION", identity)
    const workedExampleId = stableId("CONCEPT-EXAMPLE", identity)
    const checkId = stableId("CONCEPT-CHECK", identity)
    const summaryId = stableId("CONCEPT-SUMMARY", identity)
    explanationBlocks.push({
      block_id: explanationId,
      block_type: "paragraph",
      text: `${authored.explanation.trim()}\n证据事实：${evidenceText}`,
      claims: claims("explanation"),
    })
    workedExamples.push({
      block_id: workedExampleId,
      block_type: "paragraph",
      text: `${authored.worked_example.trim()}\n证据事实：${evidenceText}`,
      claims: claims("worked-example"),
    })
    misconceptions.push({
      misconception_tag: stableId("CONCEPT-MISCONCEPTION", identity),
      explanation: `${authored.misconception.trim()}\n证据事实：${evidenceText}`,
      objective_id: target.objective_id,
      citations: structuredClone(citations),
    })
    microChecks.push({
      block_id: checkId,
      block_type: "quiz",
      item_id: stableId("CONCEPT-CHECK-ITEM", identity),
      prompt: authored.micro_check_prompt.trim(),
      options: authored.micro_check_options.map((text, optionIndex) => ({
        option_id: stableId("CONCEPT-CHECK-OPTION", {
          ...identity,
          option_index: optionIndex,
        }),
        label: String.fromCharCode(65 + optionIndex),
        text: text.trim(),
      })),
      ...withMicroCheckAnswer(authored, identity),
      citations: citations.map((citation) => ({
        ...citation,
        relation: "derived_from" as const,
      })),
    })
    hintLadders.push({
      objective_id: target.objective_id,
      hints: authored.hints.map((text, hintIndex) => ({
        hint_level: (hintIndex + 1) as 1 | 2 | 3,
        text: text.trim(),
        citations: citations.map((citation) => ({
          ...citation,
          relation: "derived_from" as const,
        })),
      })),
    })
    summary.push({
      block_id: summaryId,
      block_type: "paragraph",
      text: `${authored.summary.trim()}\n证据事实：${evidenceText}`,
      claims: claims("summary"),
    })
    objectiveCoverage.push({
      objective_id: target.objective_id,
      block_ids: [explanationId, workedExampleId, checkId, summaryId],
    })
  })

  return normalizeConceptSegment(request, {
    title: payload.title.trim(),
    objective_ids: request.generation_spec.targets.map((target) =>
      target.objective_id),
    prerequisite_bridge: [],
    explanation_blocks: explanationBlocks,
    worked_examples: workedExamples,
    misconceptions,
    micro_checks: microChecks,
    hint_ladders: hintLadders,
    summary,
    objective_coverage: objectiveCoverage,
    used_evidence: [],
  })
}

export function mergeConceptSegments(
  request: ConceptTutorRequest,
  payloads: ConceptLessonPayload[],
): ConceptLessonPayload {
  if (payloads.length === 0) {
    throw new ModelOutputValidationError("concept.merge", ["没有可聚合的目标组输出"])
  }
  const segments = payloads.map((payload, index) => namespaceConceptPayload(payload, index))
  const merged: ConceptLessonPayload = {
    title: segments.length === 1 ? segments[0].title : `${segments[0].title}（组合讲义）`,
    objective_ids: request.generation_spec.targets.map((target) => target.objective_id),
    prerequisite_bridge: segments[0].prerequisite_bridge,
    explanation_blocks: segments.flatMap((segment) => segment.explanation_blocks),
    worked_examples: segments.flatMap((segment) => segment.worked_examples),
    misconceptions: segments.flatMap((segment) => segment.misconceptions),
    micro_checks: segments.flatMap((segment) => segment.micro_checks),
    hint_ladders: segments.flatMap((segment) => segment.hint_ladders),
    summary: segments.flatMap((segment) => segment.summary),
    objective_coverage: segments.flatMap((segment) => segment.objective_coverage),
    used_evidence: [],
  }
  merged.used_evidence = collectConceptCitations(merged)
  return merged
}

/** Freezes objective identity and rebuilds bookkeeping fields from authored content. */
export function normalizeConceptSegment(
  request: ConceptTutorRequest,
  payload: ConceptLessonPayload,
): ConceptLessonPayload {
  const normalized = structuredClone(payload)
  normalized.prerequisite_bridge = normalizePrerequisiteBridges(
    normalized.prerequisite_bridge,
    request,
  )
  freezeClaimTexts([
    ...normalized.prerequisite_bridge,
    ...normalized.explanation_blocks,
    ...normalized.worked_examples,
    ...normalized.summary,
  ], request.evidence_pack)
  anchorRenderedClaims([
    ...normalized.prerequisite_bridge,
    ...normalized.explanation_blocks,
    ...normalized.summary,
  ])
  anchorMisconceptionEvidence(normalized, request.evidence_pack)
  normalized.objective_ids = request.generation_spec.targets.map((target) => target.objective_id)
  const allBlocks = [
    ...normalized.prerequisite_bridge,
    ...normalized.explanation_blocks,
    ...normalized.worked_examples,
    ...normalized.micro_checks,
    ...normalized.summary,
  ]
  const validIds = new Set(allBlocks.map((block) => block.block_id))
  normalized.objective_coverage = request.generation_spec.targets.map((target) => {
    const existing = normalized.objective_coverage.find((entry) => entry.objective_id === target.objective_id)
    const groundedIds = allBlocks.filter((block) => citationsFromBlock(block).some((citation) =>
      citation.source_id === target.source_id && target.required_fact_ids.includes(citation.fact_id),
    )).map((block) => block.block_id)
    return {
      objective_id: target.objective_id,
      block_ids: unique([
        ...(existing?.block_ids ?? []).filter((id) => validIds.has(id)),
        ...groundedIds,
      ]),
    }
  })
  normalized.used_evidence = collectConceptCitations(normalized)
  return normalized
}

export function buildLabIdentity(spec: GenerationSpec) {
  const labId = stableId("LAB", {
    spec_id: spec.spec_id,
    seed: spec.policies.seed,
    version: "code-lab-staged-v1",
  })
  return {
    lab_id: labId,
    test_suite_id: stableId("TS", { lab_id: labId, version: "code-lab-staged-v1" }),
  }
}

export function buildCodeLabObjectivePlan(
  spec: GenerationSpec,
): CodeLabObjectivePlan[] {
  return spec.targets.map((target) => {
    const identity = {
      spec_id: spec.spec_id,
      objective_id: target.objective_id,
      source_id: target.source_id,
    }
    return {
      objective_id: target.objective_id,
      source_id: target.source_id,
      instruction_block_id: stableId("LAB-INSTRUCTION", identity),
      public_test_id: stableId("LAB-PUBLIC-TEST", identity),
      citations: target.required_fact_ids.map((factId) => ({
        source_id: target.source_id,
        fact_id: factId,
        relation: "derived_from" as const,
      })),
    }
  })
}

export function validateCodeLabPublicAuthorAgainstPlan(
  payload: CodeLabPublicAuthorPayload,
  plan: CodeLabObjectivePlan[],
): string[] {
  const issues: string[] = []
  if (payload.objectives.length !== plan.length) {
    issues.push(`objectives 数量应为 ${plan.length}，实际 ${payload.objectives.length}`)
  }
  payload.objectives.forEach((entry, index) => {
    if (entry.hints.length !== 3) {
      issues.push(`objectives[${index}].hints 必须恰好包含三级提示`)
    }
    if (payload.execution_contract.execution_mode === "function"
      && !isFunctionInvocationEnvelope(entry.public_test.input)) {
      issues.push(
        `objectives[${index}].public_test.input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`,
      )
    }
  })
  issues.push(...functionOutputContractIssues(
    payload.execution_contract,
    "execution_contract",
    payload.objectives.flatMap((entry) => [
      entry.instruction_text,
      entry.public_test.expected_behavior,
      ...entry.hints,
    ]),
  ))
  return issues
}

export function materializeCodeLabPublicAuthorPayload(
  request: CodeLabRequest,
  payload: CodeLabPublicAuthorPayload,
  labId: string,
  plan: CodeLabObjectivePlan[],
): CodeLabPublicPayload {
  const facts = new Map(request.evidence_pack.results.flatMap((entry) =>
    entry.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  const publicPayload: CodeLabPublicPayload = {
    lab_id: labId,
    title: payload.title.trim(),
    objective_ids: request.generation_spec.targets.map((target) =>
      target.objective_id),
    instructions: plan.map((entry, index) => ({
      block_id: entry.instruction_block_id,
      block_type: "paragraph",
      text: payload.objectives[index]!.instruction_text.trim(),
      claims: entry.citations.map((citation, citationIndex) => ({
        claim_id: stableId("LAB-CLAIM", {
          spec_id: request.generation_spec.spec_id,
          objective_id: entry.objective_id,
          fact_id: citation.fact_id,
          citation_index: citationIndex,
        }),
        text: facts.get(`${citation.source_id}:${citation.fact_id}`) ?? "",
        citations: [{ ...citation, relation: "supports" as const }],
      })),
    })),
    execution_contract: structuredClone(payload.execution_contract),
    starter_code: payload.starter_code,
    public_tests: plan.map((entry, index) => ({
      test_id: entry.public_test_id,
      objective_id: entry.objective_id,
      description: payload.objectives[index]!.public_test.description.trim(),
      input: structuredClone(payload.objectives[index]!.public_test.input),
      expected_behavior: payload.objectives[index]!.public_test.expected_behavior.trim(),
      citations: structuredClone(entry.citations),
    })),
    hint_ladders: plan.map((entry, index) => ({
      objective_id: entry.objective_id,
      hints: payload.objectives[index]!.hints.map((text, hintIndex) => ({
        hint_level: (hintIndex + 1) as 1 | 2 | 3,
        text: text.trim(),
        citations: structuredClone(entry.citations),
      })),
    })),
    reflection_questions: payload.objectives.map((entry) =>
      entry.reflection_question.trim()),
    objective_coverage: plan.map((entry) => ({
      objective_id: entry.objective_id,
      instruction_block_ids: [entry.instruction_block_id],
      public_test_ids: [entry.public_test_id],
    })),
    used_evidence: plan.flatMap((entry) => structuredClone(entry.citations)),
  }
  return normalizeCodeLabPublic(request, publicPayload, labId, plan)
}

export function validateCodeLabPublicAgainstPlan(
  payload: CodeLabPublicPayload,
  plan: CodeLabObjectivePlan[],
): string[] {
  const issues: string[] = []
  if (payload.instructions.length !== plan.length) {
    issues.push(`instructions 数量应为 ${plan.length}，实际 ${payload.instructions.length}`)
  }
  if (payload.public_tests.length !== plan.length) {
    issues.push(`public_tests 数量应为 ${plan.length}，实际 ${payload.public_tests.length}`)
  }
  if (payload.hint_ladders.length !== plan.length) {
    issues.push(`hint_ladders 数量应为 ${plan.length}，实际 ${payload.hint_ladders.length}`)
  }
  payload.instructions.forEach((block, index) => {
    if (!("claims" in block) || block.claims.length === 0) {
      issues.push(`instructions[${index}] 必须包含可绑定事实的 claims`)
    }
  })
  payload.hint_ladders.forEach((ladder, index) => {
    if (ladder.hints.length !== 3) {
      issues.push(`hint_ladders[${index}] 必须恰好包含三级提示`)
    }
  })
  if (payload.execution_contract.execution_mode === "function") {
    payload.public_tests.forEach((test, index) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`public_tests[${index}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  }
  return issues
}

export function normalizeCodeLabPublic(
  request: CodeLabRequest,
  payload: CodeLabPublicPayload,
  labId: string,
  plan: CodeLabObjectivePlan[] = buildCodeLabObjectivePlan(
    request.generation_spec,
  ),
): CodeLabPublicPayload {
  const normalized = structuredClone(payload)
  normalized.lab_id = labId
  normalized.objective_ids = request.generation_spec.targets.map((target) => target.objective_id)
  const facts = new Map(request.evidence_pack.results.flatMap((entry) =>
    entry.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  normalized.instructions = plan.map((entry, index) => {
    const block = structuredClone(payload.instructions[index]!)
    block.block_id = entry.instruction_block_id
    if ("claims" in block) {
      block.claims = entry.citations.map((citation, citationIndex) => ({
        claim_id: stableId("LAB-CLAIM", {
          spec_id: request.generation_spec.spec_id,
          objective_id: entry.objective_id,
          fact_id: citation.fact_id,
          citation_index: citationIndex,
        }),
        text: facts.get(`${citation.source_id}:${citation.fact_id}`) ?? "",
        citations: [{ ...citation, relation: "supports" as const }],
      }))
      anchorRenderedClaim(block)
    }
    return block
  })
  normalized.public_tests = plan.map((entry, index) => ({
    ...structuredClone(payload.public_tests[index]!),
    test_id: entry.public_test_id,
    objective_id: entry.objective_id,
    citations: structuredClone(entry.citations),
  }))
  normalized.hint_ladders = plan.map((entry, index) => ({
    ...structuredClone(payload.hint_ladders[index]!),
    objective_id: entry.objective_id,
    hints: payload.hint_ladders[index]!.hints.map((hint, hintIndex) => ({
      ...structuredClone(hint),
      hint_level: (hintIndex + 1) as 1 | 2 | 3,
      citations: structuredClone(entry.citations),
    })),
  }))
  normalized.objective_coverage = plan.map((entry) => ({
    objective_id: entry.objective_id,
    instruction_block_ids: [entry.instruction_block_id],
    public_test_ids: [entry.public_test_id],
  }))
  normalized.used_evidence = collectCodeLabCitations(normalized)
  return normalized
}

/**
 * Freezes secure identities and coverage without fabricating executable
 * semantics. The model authors tests, expected values and reference code; the
 * isolated runner proves them afterwards. Mutation diagnostics are optional.
 */
export function buildCodeLabSecurePlan(
  spec: GenerationSpec,
  suiteId: string,
): CodeLabSecurePlan {
  if (spec.targets.length === 0) {
    throw new ModelOutputValidationError("code-lab.secure.plan", ["GenerationSpec 没有可规划的目标"])
  }
  const objectiveWeight = 1 / spec.targets.length
  const hiddenTests = spec.targets.map((target) => {
    const caseKind = "normal" as const
    return {
      test_id: stableId("LAB-HIDDEN-TEST", {
        test_suite_id: suiteId,
        objective_id: target.objective_id,
        case_kind: caseKind,
      }),
      objective_id: target.objective_id,
      case_kind: caseKind,
      weight: objectiveWeight,
    }
  })
  return {
    hidden_tests: hiddenTests,
    mutation_variants: [],
  }
}

export function validateCodeLabSecureAgainstPlan(
  payload: CodeLabSecurePayload,
  plan: CodeLabSecurePlan,
): string[] {
  const issues: string[] = []
  if (payload.hidden_tests.length !== plan.hidden_tests.length) {
    issues.push(`hidden_tests 数量应为 ${plan.hidden_tests.length}，实际 ${payload.hidden_tests.length}`)
  }
  plan.hidden_tests.forEach((expected, index) => {
    const actual = payload.hidden_tests[index]
    if (!actual) return
    if (actual.test_id !== expected.test_id) issues.push(`hidden_tests[${index}].test_id 未按 objective_plan 返回`)
    if (actual.objective_id !== expected.objective_id) issues.push(`hidden_tests[${index}].objective_id 未按 objective_plan 返回`)
  })
  const mappings = new Map<string, number>()
  payload.misconception_map.forEach((entry) => {
    mappings.set(entry.failed_test_id, (mappings.get(entry.failed_test_id) ?? 0) + 1)
  })
  for (const test of plan.hidden_tests) {
    if (mappings.get(test.test_id) !== 1) {
      issues.push(`misconception_map 必须恰好映射一次计划测试 ${test.test_id}`)
    }
  }
  if (payload.execution_contract.execution_mode === "function") {
    payload.hidden_tests.forEach((test, index) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`hidden_tests[${index}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  }
  return issues
}

/**
 * Tolerates json_object-mode authoring sloppiness that would otherwise fail the
 * staged gate: sloppy comparison objects, string-typed numeric expected values,
 * bare (non-envelope) function inputs, and surplus hidden tests. The strict
 * materialized draft and the trusted runner still own semantic correctness.
 */
export function normalizeCodeLabSecureAuthorPayloadLenient(
  payload: CodeLabSecureAuthorPayload,
  plan: CodeLabSecurePlan,
  executionMode: CodeLabPublicPayload["execution_contract"]["execution_mode"],
  publicInputs: unknown[] = [],
  outputContract?: CodeLabPublicPayload["execution_contract"]["output_contract"],
): CodeLabSecureAuthorPayload {
  const normalized = structuredClone(payload)
  if (normalized.hidden_tests.length > plan.hidden_tests.length) {
    normalized.hidden_tests = normalized.hidden_tests.slice(0, plan.hidden_tests.length)
  }
  for (const test of normalized.hidden_tests) {
    const outputKind = outputContract ? classifyOutputContract(outputContract) : undefined
    test.comparison = outputKind === "number"
      ? { kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 }
      : outputKind && outputKind !== "unknown"
        ? { kind: "exact" }
        : canonicalizeTestComparison(test.comparison as unknown, test.expected)
    if (test.comparison.kind === "numeric" && typeof test.expected === "string") {
      const coerced = Number(test.expected.trim())
      if (Number.isFinite(coerced)) test.expected = coerced
    }
    if (executionMode === "function") {
      test.input = chooseDistinctFunctionInput(coerceFunctionInvocation(test.input), publicInputs)
    } else {
      // stdin_stdout 模式：模型常按函数习惯写 args 封装，必须转换为 stdin 文本，
      // 否则 harness 无输入、reference 无输出，可信执行必然失败。
      test.input = asStandardInput(test.input)
    }
  }
  return normalized
}

/** Maps model-authored comparison shapes onto the strict TestComparison contract. */
export function canonicalizeTestComparison(value: unknown, expected: unknown): TestComparison {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const kind = typeof record.kind === "string" ? record.kind : undefined
    if (kind === "exact") return { kind: "exact" }
    if (kind === "numeric") {
      const tolerance = finiteNumber(record.tolerance)
      const abs = finiteNumber(record.abs_tolerance)
        ?? finiteNumber(record.absTolerance)
        ?? tolerance
        ?? 1e-9
      const rel = finiteNumber(record.rel_tolerance)
        ?? finiteNumber(record.relTolerance)
        ?? tolerance
        ?? 1e-9
      return { kind: "numeric", abs_tolerance: abs, rel_tolerance: rel }
    }
  }
  return typeof expected === "number"
    || (typeof expected === "string" && Number.isFinite(Number(expected.trim())))
    ? { kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 }
    : { kind: "exact" }
}

/**
 * Wraps bare model-authored inputs into the {"args": [...], "kwargs": {}} call
 * envelope required by function-mode execution. Bare objects with a single key
 * (e.g. {"scores": [...]}) are treated as one named parameter whose value is
 * passed positionally; multi-key objects remain a single dict argument.
 */
function flattenInputScalars(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenInputScalars)
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(flattenInputScalars)
  return value === undefined ? [] : [value]
}

export function chooseDistinctFunctionInput(
  input: unknown,
  publicInputs: unknown[],
): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const record = structuredClone(input) as Record<string, unknown>
  if (!Array.isArray(record.args)) return input
  const candidate = { ...record, args: [...record.args] }
  const used = new Set(publicInputs.map((value) => JSON.stringify(value)))
  const publicScalars = new Set(publicInputs.flatMap(flattenInputScalars).map((value) => JSON.stringify(value)))
  const conflicts = () => used.has(JSON.stringify(candidate))
    || flattenInputScalars(candidate).some((value) => publicScalars.has(JSON.stringify(value)))
  for (let attempt = 0; attempt < 20 && conflicts(); attempt += 1) {
    candidate.args = candidate.args.map((value, index) => {
      if (index !== 0) return value
      if (typeof value === "number") return value + 1 + attempt
      if (typeof value === "string") return `${value}_hidden_${attempt + 1}`
      if (typeof value === "boolean") return !value
      if (Array.isArray(value)) return [...value, attempt + 1]
      if (value && typeof value === "object") return { ...(value as Record<string, unknown>), __case: attempt + 1 }
      return attempt + 1
    })
  }
  return candidate
}

export function coerceFunctionInvocation(input: unknown): unknown {
  if (input === null || input === undefined) return { args: [], kwargs: {} }
  if (Array.isArray(input)) return { args: [input], kwargs: {} }
  if (typeof input !== "object") return { args: [input], kwargs: {} }
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 0) return { args: [], kwargs: {} }
  if (isFunctionInvocationEnvelope(record)) return input
  const kwargs = typeof record.kwargs === "object"
    && record.kwargs !== null
    && !Array.isArray(record.kwargs)
    ? record.kwargs
    : {}
  if (keys.length === 1 && keys[0] !== "kwargs") {
    return { args: [record[keys[0]!]], kwargs }
  }
  return { args: [record], kwargs: {} }
}

export function validateCodeLabSecureAuthorAgainstPlan(
  payload: CodeLabSecureAuthorPayload,
  plan: CodeLabSecurePlan,
  executionMode: CodeLabPublicPayload["execution_contract"]["execution_mode"],
): string[] {
  const issues: string[] = []
  if (payload.hidden_tests.length !== plan.hidden_tests.length) {
    issues.push(`hidden_tests 数量应为 ${plan.hidden_tests.length}，实际 ${payload.hidden_tests.length}`)
  }
  if (executionMode === "function") {
    payload.hidden_tests.forEach((test, index) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`hidden_tests[${index}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  }
  return issues
}

export function materializeCodeLabSecureAuthorPayload(
  spec: GenerationSpec,
  payload: CodeLabSecureAuthorPayload,
  publicPayload: CodeLabPublicPayload,
  suiteId: string,
  plan: CodeLabSecurePlan = buildCodeLabSecurePlan(spec, suiteId),
): CodeLabSecurePayload {
  const draft: CodeLabSecurePayload = {
    lab_id: publicPayload.lab_id,
    test_suite_id: suiteId,
    execution_contract: structuredClone(publicPayload.execution_contract),
    reference_solution: payload.reference_solution,
    hidden_tests: plan.hidden_tests.map((entry, index) => ({
      test_id: entry.test_id,
      objective_id: entry.objective_id,
      weight: entry.weight,
      input: structuredClone(payload.hidden_tests[index]!.input),
      expected: structuredClone(payload.hidden_tests[index]!.expected),
      comparison: structuredClone(payload.hidden_tests[index]!.comparison),
    })),
    scoring_groups: [],
    misconception_map: plan.hidden_tests.map((entry, index) => ({
      failed_test_id: entry.test_id,
      misconception_tag: payload.hidden_tests[index]!.misconception_tag,
    })),
    mutation_variants: plan.mutation_variants.map((entry, index) => ({
      ...structuredClone(entry),
      code: payload.mutation_variants[index]!.code,
      misconception_tag: payload.mutation_variants[index]!.misconception_tag,
    })),
    objective_coverage: [],
  }
  return normalizeCodeLabSecure(spec, draft, publicPayload, suiteId, plan)
}

function normalizeCodeLabSecureHiddenInputs(
  payload: CodeLabSecurePayload,
  publicPayload: CodeLabPublicPayload,
): CodeLabSecurePayload {
  const normalized = structuredClone(payload)
  if (normalized.execution_contract.execution_mode === "function") {
    const publicInputs = publicPayload.public_tests.map((test) => test.input)
    normalized.hidden_tests = normalized.hidden_tests.map((test) => ({
      ...test,
      input: chooseDistinctFunctionInput(coerceFunctionInvocation(test.input), publicInputs),
    }))
  }
  return normalized
}

export function normalizeCodeLabSecure(
  spec: GenerationSpec,
  payload: CodeLabSecurePayload,
  publicPayload: CodeLabPublicPayload,
  suiteId: string,
  plan: CodeLabSecurePlan = buildCodeLabSecurePlan(spec, suiteId),
): CodeLabSecurePayload {
  const normalized = normalizeCodeLabSecureHiddenInputs(payload, publicPayload)
  normalized.lab_id = publicPayload.lab_id
  normalized.test_suite_id = suiteId
  normalized.execution_contract = structuredClone(publicPayload.execution_contract)
  normalized.hidden_tests = plan.hidden_tests.map((entry, index) => {
    const { case_kind: _caseKind, ...identity } = entry
    return {
      ...structuredClone(payload.hidden_tests[index]!),
      ...identity,
    }
  })
  if (normalized.execution_contract.execution_mode === "function") {
    const publicInputs = publicPayload.public_tests.map((test) => test.input)
    normalized.hidden_tests = normalized.hidden_tests.map((test) => ({
      ...test,
      input: chooseDistinctFunctionInput(test.input, publicInputs),
    }))
  }
  normalized.mutation_variants = plan.mutation_variants.length > 0
    ? plan.mutation_variants.map((entry, index) => ({
        ...structuredClone(payload.mutation_variants[index]!),
        ...structuredClone(entry),
      }))
    : structuredClone(payload.mutation_variants)
  normalized.scoring_groups = spec.targets.map((target) => {
    const tests = normalized.hidden_tests.filter((test) => test.objective_id === target.objective_id)
    return {
      group_id: stableId("GROUP", { test_suite_id: suiteId, objective_id: target.objective_id }),
      objective_id: target.objective_id,
      test_ids: tests.map((test) => test.test_id),
      weight: tests.reduce((sum, test) => sum + test.weight, 0),
    }
  })
  normalized.misconception_map = normalized.hidden_tests.map((test) => {
    const mutation = normalized.mutation_variants.find((entry) =>
      entry.objective_ids.includes(test.objective_id))
    const authored = payload.misconception_map.find((entry) =>
      entry.failed_test_id === test.test_id)
    return {
      failed_test_id: test.test_id,
      misconception_tag: authored?.misconception_tag
        ?? mutation?.misconception_tag
        ?? `objective_${test.objective_id}_misconception`,
    }
  })
  normalized.objective_coverage = spec.targets.map((target) => {
    const hiddenTestIds = unique(normalized.hidden_tests
      .filter((test) => test.objective_id === target.objective_id)
      .map((test) => test.test_id))
    const scoringGroupIds = unique(normalized.scoring_groups
      .filter((group) => group.objective_id === target.objective_id)
      .map((group) => group.group_id))
    const mutationIds = unique(normalized.mutation_variants
      .filter((mutation) => mutation.objective_ids.includes(target.objective_id))
      .map((mutation) => mutation.mutation_id))
    return {
      objective_id: target.objective_id,
      hidden_test_ids: hiddenTestIds,
      scoring_group_ids: scoringGroupIds,
      mutation_ids: mutationIds,
    }
  })
  return normalized
}

export function expectedOnlyReferenceFailureCodes(feedback: { reference_failure_codes?: string[]; issues?: string[] }): string[] {
  return feedback.reference_failure_codes
    ?? (feedback.issues ?? []).flatMap((entry) => {
      if (!entry.includes("reference_solution 未通过")) return []
      const separator = entry.indexOf("：")
      return separator >= 0 ? entry.slice(separator + 1).split(/、/).map((part) => part.trim()).filter(Boolean) : []
    })
}

export function isExpectedOnlyReferenceFailure(failureCodes: string[] | undefined): boolean {
  return Boolean(failureCodes?.length)
    && failureCodes!.every((code) => {
      const prefix = ":assertion_failed:expected="
      const actualMarker = ":actual="
      const prefixIndex = code.indexOf(prefix)
      const actualIndex = code.indexOf(actualMarker, prefixIndex + prefix.length)
      if (prefixIndex <= 0 || actualIndex < 0) return false
      try {
        JSON.parse(code.slice(actualIndex + actualMarker.length))
        return true
      } catch {
        return false
      }
    })
}

export function patchExpectedFromReferenceFailures<T extends { hidden_tests: Array<{ test_id: string; expected: unknown; comparison: TestComparison }> }>(
  securePayload: T,
  failureCodes: string[],
): T {
  const patched = structuredClone(securePayload)
  const byId = new Map(patched.hidden_tests.map((test) => [test.test_id, test]))
  for (const code of failureCodes) {
    const prefix = ":assertion_failed:expected="
    const prefixIndex = code.indexOf(prefix)
    const actualMarker = ":actual="
    const actualIndex = code.indexOf(actualMarker, prefixIndex + prefix.length)
    if (prefixIndex <= 0 || actualIndex < 0) continue
    const testId = code.slice(0, prefixIndex)
    const actualJson = code.slice(actualIndex + actualMarker.length)
    const target = byId.get(testId)
    if (!target) continue
    try {
      target.expected = JSON.parse(actualJson)
      target.comparison = canonicalizeTestComparison(target.comparison, target.expected)
    } catch {
      // Keep the original expected value when the runner did not emit JSON.
    }
  }
  return patched
}

/** Applies only executable semantics selected by stable IDs; structural fields remain prior-owned. */
export function applyCodeLabExecutionRepairPatch(
  prior: CodeLabSecurePayload,
  patch: CodeLabExecutionRepairPatch,
): CodeLabSecurePayload {
  const repaired = structuredClone(prior)
  if (patch.reference_solution !== null) {
    repaired.reference_solution = patch.reference_solution
  }
  const hiddenById = new Map(repaired.hidden_tests.map((entry) => [entry.test_id, entry]))
  for (const entry of patch.hidden_test_repairs) {
    const target = hiddenById.get(entry.test_id)
    if (!target) continue
    target.input = structuredClone(entry.input)
    target.expected = structuredClone(entry.expected)
    target.comparison = structuredClone(entry.comparison)
  }
  return repaired
}

export function assessmentStarterIsIncomplete(starter: string | null | undefined): boolean {
  if (!starter?.trim()) return false
  const normalized = starter.normalize("NFKC")
  if (/TODO|待完成|pass\b|NotImplementedError|补全|写出你的代码/u.test(normalized)) return true
  if (/^\s*(?:print|console\.log)\s*\(/mu.test(normalized) && !/def\s+\w+\s*\(/u.test(normalized)) return false
  return false
}

/** 确定性修复：从已有 starter_code 中提取函数签名，替换为未完成骨架。 */
export function deterministicAssessmentStarterRepair(starter: string | null | undefined): string {
  const source = starter?.trim() ?? ""
  if (!source) return "def solve(data):\n    # TODO: 补全你的代码实现\n    pass\n"
  const lines = source.split(/\r?\n/)
  // 提取函数签名行（def 行 + 可能的装饰器）
  const sigIndex = lines.findIndex((line) => /^\s*def\s+\w+\s*\(/.test(line))
  if (sigIndex === -1) return "def solve(data):\n    # TODO: 补全你的代码实现\n    pass\n"
  const sig = lines[sigIndex]!
  const indent = sig.match(/^(\s*)/)?.[1] ?? ""
  return `${sig}\n${indent}    # TODO: 补全你的代码实现\n${indent}    pass\n`
}

export function assessmentCompositionForBehavior(_behavior: GenerationSpec["targets"][number]["observable_behavior"]): AssessmentItemPublic["modality"][] {
  return ["mcq", "mcq", "trace", "code", "code"]
}

export function buildAssessmentItemPlan(spec: GenerationSpec): AssessmentItemPlan[] {
  const tiers: Array<1 | 2 | 3> = [
    ...Array.from({ length: spec.assessment_blueprint.tier_1_count }, () => 1 as const),
    ...Array.from({ length: spec.assessment_blueprint.tier_2_count }, () => 2 as const),
    ...Array.from({ length: spec.assessment_blueprint.tier_3_count }, () => 3 as const),
  ]
  const primaryBehavior = spec.targets.find((target) => target.importance === "core")?.observable_behavior
    ?? spec.targets[0]?.observable_behavior
    ?? "apply"
  const requiredComposition = assessmentCompositionForBehavior(primaryBehavior)
  if (tiers.length !== requiredComposition.length) {
    throw new ModelOutputValidationError("assessment.plan", ["正式测评必须固定为 5 题：2 道选择、1 道读代码、2 道代码题"])
  }
  const modalities = [...requiredComposition]

  const assignments = assignObjectives(spec, modalities)
  return tiers.map((tier, index) => {
    const objective = assignments[index]
    const modality = modalities[index]
    const identity = { spec_id: spec.spec_id, index, objective_id: objective.objective_id, tier, modality }
    return {
      item_id: stableId("ITEM", identity),
      family_id: stableId("FAMILY", { objective_id: objective.objective_id, modality }),
      variant_id: stableId("VARIANT", { ...identity, seed: spec.policies.seed }),
      display_no: index + 1,
      objective_id: objective.objective_id,
      tier,
      modality,
      max_score: tier === 1 ? 1 : tier === 2 ? 2 : 4,
      citations: objective.required_fact_ids.map((factId) => ({
        source_id: objective.source_id,
        fact_id: factId,
        relation: "derived_from" as const,
      })),
    }
  })
}

export function buildAssessmentFormId(spec: GenerationSpec): string {
  return stableId("FORM", {
    spec_id: spec.spec_id,
    seed: spec.policies.seed,
    version: "assessment-staged-v1",
  })
}

export function validateAssessmentPublicAuthorAgainstPlan(
  payload: AssessmentPublicAuthorPayload,
  plan: AssessmentItemPlan[],
): string[] {
  const issues: string[] = []
  if (payload.items.length !== plan.length) {
    issues.push(`items 数量应为 ${plan.length}，实际 ${payload.items.length}`)
    return issues
  }
  payload.items.forEach((item, index) => {
    const expected = plan[index]!
    const isChoice = expected.modality === "mcq"
      || expected.modality === "true_false"
    if (isChoice) {
      if (!item.options) {
        issues.push(`items[${index}] 选择题缺少 options`)
      } else {
        const expectedCount = expected.modality === "true_false" ? 2 : undefined
        if (expectedCount && item.options.length !== expectedCount) {
          issues.push(`items[${index}] true_false 必须恰好包含 2 个选项`)
        }
        const normalized = item.options.map((option) =>
          option.normalize("NFKC").trim().toLocaleLowerCase())
        if (new Set(normalized).size !== normalized.length) {
          issues.push(`items[${index}].options 不得重复`)
        }
      }
    } else if (item.options !== null) {
      issues.push(`items[${index}] 非选择题的 options 必须为 null`)
    }
    if (expected.modality === "code") {
      if (!assessmentStarterIsIncomplete(item.starter_code)) {
        issues.push(`items[${index}] 代码题必须提供明确未完成的函数 starter_code，不能直接给出完整答案`)
      }
    } else if (item.starter_code !== null) {
      issues.push(`items[${index}] 非代码题的 starter_code 必须为 null`)
    }
  })
  return issues
}

export function materializeAssessmentPublicAuthorPayload(
  spec: GenerationSpec,
  payload: AssessmentPublicAuthorPayload,
  plan: AssessmentItemPlan[],
  formId: string,
): AssessmentPublicPayload {
  const items = payload.items.map((authored, index): AssessmentItemPublic => {
    const expected = plan[index]!
    const options = authored.options?.map((text, optionIndex) => ({
      option_id: stableId("OPTION", {
        item_id: expected.item_id,
        option_index: optionIndex,
      }),
      label: "ABCD"[optionIndex]!,
      text,
    }))
    return {
      ...structuredClone(expected),
      prompt: authored.prompt,
      ...(options ? { options } : {}),
      ...(authored.starter_code ? { starter_code: authored.starter_code } : {}),
    }
  })
  return {
    form_id: formId,
    title: payload.title,
    objective_ids: spec.targets.map((target) => target.objective_id),
    items,
    submission_policy: { max_attempts: 3, formative: true },
    routing: deterministicRouting(items),
    objective_coverage: assessmentPublicCoverage(spec, items),
    used_evidence: deduplicate(items.flatMap((item) => item.citations)),
  }
}

export function validateAssessmentPublicAgainstPlan(
  payload: AssessmentPublicPayload,
  plan: AssessmentItemPlan[],
): string[] {
  const issues: string[] = []
  if (payload.items.length !== plan.length) {
    issues.push(`items 数量应为 ${plan.length}，实际 ${payload.items.length}`)
    return issues
  }
  payload.items.forEach((item, index) => {
    const expected = plan[index]
    if (item.modality !== expected.modality) {
      issues.push(`items[${index}].modality 应为 ${expected.modality}`)
    }
    if ((expected.modality === "mcq" || expected.modality === "true_false") && !item.options) {
      issues.push(`items[${index}] 选择题缺少 options`)
    }
    if (expected.modality === "code" && !item.starter_code) {
      issues.push(`items[${index}] 代码题缺少 starter_code`)
    }
  })
  return issues
}

export function normalizeAssessmentPublic(
  spec: GenerationSpec,
  payload: AssessmentPublicPayload,
  plan: AssessmentItemPlan[],
  formId: string,
): AssessmentPublicPayload {
  const items = payload.items.map((item, index): AssessmentItemPublic => {
    const expected = plan[index]
    const options = item.options?.map((option, optionIndex) => ({
      ...option,
      option_id: stableId("OPTION", { item_id: expected.item_id, option_index: optionIndex }),
      label: "ABCD"[optionIndex],
    }))
    return {
      ...structuredClone(item),
      ...structuredClone(expected),
      ...(options ? { options } : {}),
    }
  })
  return {
    form_id: formId,
    title: payload.title,
    objective_ids: spec.targets.map((target) => target.objective_id),
    items,
    submission_policy: { max_attempts: 3, formative: true },
    routing: deterministicRouting(items),
    objective_coverage: assessmentPublicCoverage(spec, items),
    used_evidence: deduplicate(items.flatMap((item) => item.citations)),
  }
}

export function validateAssessmentSecureAgainstPublic(
  payload: AssessmentSecurePayload,
  publicPayload: AssessmentPublicPayload,
): string[] {
  const issues: string[] = []
  if (payload.items.length !== publicPayload.items.length) {
    issues.push(`secure items 数量应为 ${publicPayload.items.length}，实际 ${payload.items.length}`)
  }
  const codeCount = publicPayload.items.filter((item) => item.modality === "code").length
  if (payload.code_test_suites.length !== codeCount) {
    issues.push(`code_test_suites 数量应为 ${codeCount}，实际 ${payload.code_test_suites.length}`)
  }
  payload.items.forEach((item, index) => {
    const publicItem = publicPayload.items[index]
    if (!publicItem) return
    if (item.item_id !== publicItem.item_id) {
      issues.push(`items[${index}].item_id 未与 public_payload 对齐`)
    }
    for (const key of ["objective_id", "tier", "modality", "max_score"] as const) {
      if (item[key] !== publicItem[key]) {
        issues.push(`items[${index}].${key} 未与 public_payload 对齐`)
      }
    }
    const isChoice = publicItem.modality === "mcq" || publicItem.modality === "true_false"
    const optionIds = new Set(publicItem.options?.map((option) => option.option_id) ?? [])
    if (isChoice) {
      if (!item.correct_option_id || !optionIds.has(item.correct_option_id)) {
        issues.push(`items[${index}].correct_option_id 不是当前公开题的选项`)
      }
      const invalidMapIds = Object.keys(item.misconception_by_option).filter((optionId) =>
        !optionIds.has(optionId) || optionId === item.correct_option_id)
      if (invalidMapIds.length > 0) {
        issues.push(`items[${index}].misconception_by_option 包含无效或正确选项`)
      }
    } else if (item.correct_option_id || Object.keys(item.misconception_by_option).length > 0) {
      issues.push(`items[${index}] 非选择题不得返回选项答案映射`)
    }
  })
  payload.code_test_suites.forEach((suite, suiteIndex) => {
    issues.push(...functionOutputContractIssues(
      suite.execution_contract,
      `code_test_suites[${suiteIndex}].execution_contract`,
    ))
    if (suite.execution_contract.execution_mode !== "function") return
    suite.hidden_tests.forEach((test, testIndex) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`code_test_suites[${suiteIndex}].hidden_tests[${testIndex}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  })
  return issues
}

function functionOutputContractIssues(
  contract: ExecutionContract,
  path: string,
  learnerVisibleText: string[] = [],
): string[] {
  if (contract.execution_mode !== "function") return []
  const outputContract = [
    contract.output_contract.type,
    ...(contract.output_contract.constraints ?? []),
  ].join(" ").normalize("NFKC").toLocaleLowerCase()
  const visible = learnerVisibleText.join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase()
  if (/^(?:none|null|void)(?:\s|$)/u.test(outputContract)
    || /(?:标准输出|打印|stdout|\bprint\b)/u.test(`${outputContract} ${visible}`)) {
    return [
      `${path} 的 function 模式只校验入口函数返回值；请改为可 JSON 序列化的返回值，或将纯打印任务改为 stdin_stdout 模式`,
    ]
  }
  return []
}

export function validateAssessmentSecureAuthorAgainstPublic(
  payload: AssessmentSecureAuthorPayload,
  publicPayload: AssessmentPublicPayload,
): string[] {
  const issues: string[] = []
  if (payload.items.length !== publicPayload.items.length) {
    issues.push(`secure items 数量应为 ${publicPayload.items.length}，实际 ${payload.items.length}`)
    return issues
  }
  const codeItems = publicPayload.items.filter((item) => item.modality === "code")
  if (payload.code_test_suites.length !== codeItems.length) {
    issues.push(`code_test_suites 数量应为 ${codeItems.length}，实际 ${payload.code_test_suites.length}`)
  }
  payload.items.forEach((item, index) => {
    const publicItem = publicPayload.items[index]!
    const isChoice = publicItem.modality === "mcq" || publicItem.modality === "true_false"
    if (isChoice) {
      const optionIds = new Set(publicItem.options?.map((option) => option.option_id) ?? [])
      if (!item.correct_option_id || !optionIds.has(item.correct_option_id)) {
        issues.push(`items[${index}].correct_option_id 不是当前公开题的选项`)
      }
      if (item.answer_spec !== null) {
        issues.push(`items[${index}] 选择题 answer_spec 必须交由编排器构造并返回 null`)
      }
      return
    }
    if (item.correct_option_id !== null || Object.keys(item.misconception_by_option).length > 0) {
      issues.push(`items[${index}] 非选择题不得返回选项答案映射`)
    }
    if (publicItem.modality === "code") {
      if (item.answer_spec !== null) {
        issues.push(`items[${index}] 代码题 answer_spec 必须交由编排器绑定 suite 并返回 null`)
      }
    } else if (!item.answer_spec || item.answer_spec.kind === "code") {
      issues.push(`items[${index}] ${publicItem.modality} 缺少可验证 answer_spec`)
    }
  })
  payload.code_test_suites.forEach((suite, suiteIndex) => {
    issues.push(...functionOutputContractIssues(
      suite.execution_contract,
      `code_test_suites[${suiteIndex}].execution_contract`,
    ))
    if (suite.execution_contract.execution_mode !== "function") return
    suite.hidden_tests.forEach((test, testIndex) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`code_test_suites[${suiteIndex}].hidden_tests[${testIndex}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  })
  return issues
}

export function materializeAssessmentSecureAuthorPayload(
  spec: GenerationSpec,
  publicPayload: AssessmentPublicPayload,
  payload: AssessmentSecureAuthorPayload,
): AssessmentSecurePayload {
  const codeItems = publicPayload.items.filter((item) => item.modality === "code")
  const suiteIds = codeItems.map((item) => stableId("TS", {
    form_id: publicPayload.form_id,
    item_id: item.item_id,
  }))
  let codeIndex = 0
  const items: AssessmentItemSecure[] = publicPayload.items.map((publicItem, index) => {
    const authored = payload.items[index]!
    const isChoice = publicItem.modality === "mcq" || publicItem.modality === "true_false"
    let answerSpec: AnswerSpec
    if (isChoice) {
      answerSpec = {
        kind: "exact_set",
        accepted: [authored.correct_option_id!],
        normalization: ["trim", "casefold", "unicode", "collapse_whitespace"],
      }
    } else if (publicItem.modality === "code") {
      answerSpec = { kind: "code", test_suite_id: suiteIds[codeIndex++]! }
    } else {
      answerSpec = structuredClone(authored.answer_spec!)
    }
    return {
      item_id: publicItem.item_id,
      objective_id: publicItem.objective_id,
      tier: publicItem.tier,
      modality: publicItem.modality,
      max_score: publicItem.max_score,
      answer_spec: answerSpec,
      ...(isChoice ? { correct_option_id: authored.correct_option_id! } : {}),
      misconception_by_option: structuredClone(authored.misconception_by_option),
      evidence_weight: 1,
    }
  })
  const codeTestSuites = payload.code_test_suites.map((suite, suiteIndex) => {
    const publicItem = codeItems[suiteIndex]!
    const testSuiteId = suiteIds[suiteIndex]!
    const weight = 1 / suite.hidden_tests.length
    return {
      test_suite_id: testSuiteId,
      execution_contract: structuredClone(suite.execution_contract),
      reference_solution: suite.reference_solution,
      hidden_tests: suite.hidden_tests.map((test, testIndex) => ({
        test_id: stableId("ASSESSMENT-HIDDEN-TEST", {
          test_suite_id: testSuiteId,
          item_id: publicItem.item_id,
          test_index: testIndex,
        }),
        input: structuredClone(test.input),
        expected: structuredClone(test.expected),
        objective_id: publicItem.objective_id,
        weight,
        comparison: structuredClone(test.comparison),
      })),
    }
  })
  return normalizeAssessmentPair(spec, publicPayload, {
    form_id: publicPayload.form_id,
    items,
    option_order_seed: spec.policies.seed,
    code_test_suites: codeTestSuites,
    objective_coverage: [],
  }).secure_payload
}

export function normalizeAssessmentPair(
  spec: GenerationSpec,
  publicPayload: AssessmentPublicPayload,
  securePayload: AssessmentSecurePayload,
): { public_payload: AssessmentPublicPayload; secure_payload: AssessmentSecurePayload } {
  const codeItems = publicPayload.items.filter((item) => item.modality === "code")
  const suites = securePayload.code_test_suites.map((suite, index) => ({
    ...structuredClone(suite),
    test_suite_id: stableId("TS", { form_id: publicPayload.form_id, item_id: codeItems[index].item_id }),
  }))
  const suiteByItemId = new Map(codeItems.map((item, index) => [item.item_id, suites[index].test_suite_id]))
  const secureItems = securePayload.items.map((item, index): AssessmentItemSecure => {
    const publicItem = publicPayload.items[index]
    const base = {
      ...structuredClone(item),
      item_id: publicItem.item_id,
      objective_id: publicItem.objective_id,
      tier: publicItem.tier,
      modality: publicItem.modality,
      max_score: publicItem.max_score,
    }
    if (publicItem.modality === "code") {
      return {
        ...base,
        answer_spec: { kind: "code", test_suite_id: suiteByItemId.get(publicItem.item_id)! },
        misconception_by_option: {},
      }
    }
    if (publicItem.modality === "mcq" || publicItem.modality === "true_false") {
      const wrongOptions = (publicItem.options ?? []).filter((option) =>
        option.option_id !== base.correct_option_id)
      return {
        ...base,
        answer_spec: {
          kind: "exact_set",
          accepted: base.correct_option_id ? [base.correct_option_id] : [],
          normalization: ["trim", "casefold", "unicode", "collapse_whitespace"],
        },
        misconception_by_option: Object.fromEntries(wrongOptions.map((option, optionIndex) => [
          option.option_id,
          base.misconception_by_option[option.option_id]?.trim()
            || `unclassified_${publicItem.objective_id}_incorrect_option_${optionIndex + 1}`,
        ])),
      }
    }
    const { correct_option_id: _correct, ...nonChoice } = base
    return { ...nonChoice, misconception_by_option: {} }
  })
  const normalizedPublic = reorderChoiceOptions(publicPayload, secureItems, spec.policies.seed)
  const normalizedSecure: AssessmentSecurePayload = {
    form_id: normalizedPublic.form_id,
    items: secureItems,
    option_order_seed: spec.policies.seed,
    code_test_suites: suites,
    objective_coverage: assessmentSecureCoverage(spec, secureItems),
  }
  return { public_payload: normalizedPublic, secure_payload: normalizedSecure }
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(Math.floor(concurrency), values.length || 1))
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      output[index] = await mapper(values[index], index)
    }
  }))
  return output
}

function namespaceConceptPayload(payload: ConceptLessonPayload, index: number): ConceptLessonPayload {
  const prefix = `SEG${index + 1}`
  const blockMap = new Map<string, string>()
  const mapBlock = (block: RenderBlock): RenderBlock => {
    const mappedId = `${prefix}-${block.block_id}`
    blockMap.set(block.block_id, mappedId)
    const clone = structuredClone(block)
    clone.block_id = mappedId
    if ("claims" in clone) {
      clone.claims = clone.claims.map((claim) => ({ ...claim, claim_id: `${prefix}-${claim.claim_id}` }))
    }
    if (clone.block_type === "quiz") {
      clone.item_id = `${prefix}-${clone.item_id}`
      clone.options = clone.options?.map((option) => ({ ...option, option_id: `${prefix}-${option.option_id}` }))
      if (clone.answer_option_id) {
        clone.answer_option_id = `${prefix}-${clone.answer_option_id}`
      }
    }
    return clone
  }
  const prerequisite = payload.prerequisite_bridge.map(mapBlock)
  const explanations = payload.explanation_blocks.map(mapBlock)
  const examples = payload.worked_examples.map(mapBlock)
  const checks = payload.micro_checks.map((block) => mapBlock(block) as typeof block)
  const summary = payload.summary.map(mapBlock)
  return {
    ...structuredClone(payload),
    prerequisite_bridge: prerequisite,
    explanation_blocks: explanations,
    worked_examples: examples,
    misconceptions: payload.misconceptions.map((entry) => ({
      ...structuredClone(entry),
      misconception_tag: `${prefix}-${entry.misconception_tag}`,
    })),
    micro_checks: checks,
    summary,
    objective_coverage: payload.objective_coverage.map((entry) => ({
      ...structuredClone(entry),
      block_ids: entry.block_ids.map((id) => blockMap.get(id) ?? `${prefix}-${id}`),
    })),
  }
}

function collectConceptCitations(payload: ConceptLessonPayload): CitationRef[] {
  const blocks = [
    ...payload.prerequisite_bridge,
    ...payload.explanation_blocks,
    ...payload.worked_examples,
    ...payload.micro_checks,
    ...payload.summary,
  ]
  return deduplicate([
    ...blocks.flatMap(citationsFromBlock),
    ...payload.misconceptions.flatMap((entry) => entry.citations),
    ...payload.hint_ladders.flatMap((entry) => entry.hints.flatMap((hint) => hint.citations)),
  ])
}

function collectCodeLabCitations(payload: CodeLabPublicPayload): CitationRef[] {
  return deduplicate([
    ...payload.instructions.flatMap(citationsFromBlock),
    ...payload.public_tests.flatMap((test) => test.citations),
    ...payload.hint_ladders.flatMap((entry) => entry.hints.flatMap((hint) => hint.citations)),
  ])
}

function citationsFromBlock(block: RenderBlock): CitationRef[] {
  if ("claims" in block) return block.claims.flatMap((claim) => claim.citations)
  if ("citations" in block) return block.citations
  return []
}

function normalizePrerequisiteBridges(
  blocks: RenderBlock[],
  request: ConceptTutorRequest,
): RenderBlock[] {
  const prerequisiteSources = new Set(request.generation_spec.path_node.prerequisite_source_ids)
  const factsBySource = new Map(request.evidence_pack.results
    .filter((entry) => prerequisiteSources.has(entry.source_id) && entry.facts.length > 0)
    .map((entry) => [entry.source_id, entry.facts[0]] as const))
  const normalized = blocks.map((block) => {
    const clone = structuredClone(block)
    if ("claims" in clone) {
      clone.claims = clone.claims.map((claim) => ({
        ...claim,
        citations: claim.citations.map((citation) => prerequisiteSources.has(citation.source_id)
          ? { ...citation, relation: "prerequisite" as const }
          : citation),
      }))
    }
    if ("citations" in clone) {
      clone.citations = clone.citations.map((citation) => prerequisiteSources.has(citation.source_id)
        ? { ...citation, relation: "prerequisite" as const }
        : citation)
    }
    return clone
  })
  const covered = new Set(normalized.flatMap(citationsFromBlock)
    .filter((citation) => citation.relation === "prerequisite")
    .map((citation) => citation.source_id))
  for (const [sourceId, fact] of factsBySource) {
    if (covered.has(sourceId)) continue
    const identity = {
      spec_id: request.generation_spec.spec_id,
      source_id: sourceId,
      fact_id: fact.fact_id,
    }
    normalized.push({
      block_id: stableId("PREREQ-BLOCK", identity),
      block_type: "paragraph",
      text: `先修知识连接：${fact.content}`,
      claims: [{
        claim_id: stableId("PREREQ-CLAIM", identity),
        text: fact.content,
        citations: [{ source_id: sourceId, fact_id: fact.fact_id, relation: "prerequisite" }],
      }],
    })
  }
  return normalized
}

function freezeClaimTexts(blocks: RenderBlock[], evidence: RagEvidencePack): void {
  const facts = new Map(evidence.results.flatMap((entry) =>
    entry.facts.map((fact) => [`${fact.source_id}:${fact.fact_id}`, fact.content] as const),
  ))
  for (const block of blocks) {
    if (!("claims" in block)) continue
    block.claims = block.claims.map((claim) => {
      const fact = claim.citations.map((citation) => facts.get(`${citation.source_id}:${citation.fact_id}`))
        .find((content): content is string => Boolean(content))
      if (!fact) return claim
      return claimTextMatchesFact(claim.text, fact)
        ? { ...claim, text: claim.text.trim() }
        : { ...claim, text: fact }
    })
  }
}

function anchorRenderedClaims(blocks: RenderBlock[]): void {
  for (const block of blocks) anchorRenderedClaim(block)
}

function anchorRenderedClaim(block: RenderBlock): void {
  if (!("claims" in block) || block.block_type === "code") return
  const rendered = renderedTextForAnchor(block)
  const missing = unique(block.claims.map((claim) => claim.text).filter((claimText) =>
    !normalizeGroundedClaimText(rendered).includes(
      normalizeGroundedClaimText(claimText),
    )))
  if (missing.length === 0) return
  const anchor = `证据事实：${missing.join("；")}`
  if (block.block_type === "paragraph" || block.block_type === "callout") {
    block.text = `${block.text.trim()}\n${anchor}`
    return
  }
  if (block.block_type === "comparison") {
    const column = block.columns[0]
    if (column) column.content = `${column.content.trim()}\n${anchor}`
  }
}

function renderedTextForAnchor(block: RenderBlock): string {
  if (block.block_type === "heading") return block.text
  if (block.block_type === "paragraph" || block.block_type === "callout") {
    return block.text
  }
  if (block.block_type === "comparison") {
    return [block.title, ...block.columns.flatMap((column) => [
      column.heading,
      column.content,
    ])].join("\n")
  }
  if (block.block_type === "code") return [block.caption, block.code].filter(Boolean).join("\n")
  if (block.block_type === "hint") return block.text
  if (block.block_type === "quiz") return block.prompt
  return ""
}

function anchorMisconceptionEvidence(
  payload: ConceptLessonPayload,
  evidence: RagEvidencePack,
): void {
  const facts = new Map(evidence.results.flatMap((entry) =>
    entry.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  for (const misconception of payload.misconceptions) {
    const rendered = normalizeGroundedClaimText(misconception.explanation)
    const missing = unique(misconception.citations.flatMap((citation) => {
      const fact = facts.get(`${citation.source_id}:${citation.fact_id}`)
      return fact && !rendered.includes(normalizeGroundedClaimText(fact))
        ? [fact]
        : []
    }))
    if (missing.length > 0) {
      misconception.explanation = `${misconception.explanation.trim()}\n证据事实：${missing.join("；")}`
    }
  }
}

function ensureRequiredModalities(
  modalities: AssessmentItemPublic["modality"][],
  tiers: Array<1 | 2 | 3>,
  required: AssessmentItemPublic["modality"][],
): void {
  const preferredTier: Record<AssessmentItemPublic["modality"], 1 | 2 | 3> = {
    mcq: 1,
    true_false: 1,
    trace: 2,
    short_answer: 2,
    code: 3,
  }
  for (const modality of required) {
    if (modalities.includes(modality)) continue
    const replaceable = modalities.findIndex((current, index) =>
      tiers[index] === preferredTier[modality]
      && (!required.includes(current) || modalities.filter((entry) => entry === current).length > 1),
    )
    const fallback = modalities.findIndex((current) =>
      !required.includes(current) || modalities.filter((entry) => entry === current).length > 1,
    )
    const index = replaceable >= 0 ? replaceable : fallback
    if (index < 0) throw new ModelOutputValidationError("assessment.plan", [`无法安置必需题型 ${modality}`])
    modalities[index] = modality
  }
}

function assignObjectives(
  spec: GenerationSpec,
  modalities: AssessmentItemPublic["modality"][],
): GenerationSpec["targets"] {
  const assignments: Array<GenerationSpec["targets"][number] | undefined> = Array(modalities.length)
  const protectedSlots = new Set<number>()
  for (const required of spec.assessment_blueprint.required_modalities) {
    const index = modalities.findIndex((modality, slot) =>
      modality === required && !protectedSlots.has(slot))
    if (index >= 0) protectedSlots.add(index)
  }
  const core = spec.targets.filter((target) => target.importance === "core")
    .sort((left, right) =>
      compatibleCount(left.observable_behavior, modalities)
      - compatibleCount(right.observable_behavior, modalities)
      || left.objective_id.localeCompare(right.objective_id))
  for (const target of core) {
    const compatibleSlots = modalities.flatMap((modality, slot) =>
      !assignments[slot]
        && modalityMeasuresBehavior(target.observable_behavior, modality)
        ? [slot]
        : [])
      .sort((left, right) =>
        Number(!protectedSlots.has(left)) - Number(!protectedSlots.has(right))
        || left - right)
    let index = compatibleSlots[0] ?? -1
    if (index < 0) {
      index = modalities.findIndex((_modality, slot) =>
        !assignments[slot] && !protectedSlots.has(slot))
      if (index >= 0) {
        modalities[index] = preferredModalityForBehavior(
          target.observable_behavior,
        )
      }
    }
    if (index < 0) {
      throw new ModelOutputValidationError("assessment.plan", [
        `蓝图的必选题型占满槽位，无法直接测量核心目标 ${target.objective_id}/${target.observable_behavior}`,
      ])
    }
    assignments[index] = target
  }
  let cursor = 0
  for (let index = 0; index < assignments.length; index += 1) {
    if (assignments[index]) continue
    const compatible = spec.targets.filter((target) =>
      modalityMeasuresBehavior(target.observable_behavior, modalities[index]))
    if (compatible.length === 0) {
      const fallbackTarget = spec.targets[cursor % spec.targets.length]!
      modalities[index] = preferredModalityForBehavior(fallbackTarget.observable_behavior)
      assignments[index] = fallbackTarget
      cursor += 1
      continue
    }
    assignments[index] = compatible[cursor % compatible.length]
    cursor += 1
  }
  return assignments as GenerationSpec["targets"]
}

function compatibleCount(
  behavior: GenerationSpec["targets"][number]["observable_behavior"],
  modalities: AssessmentItemPublic["modality"][],
): number {
  return modalities.filter((modality) =>
    modalityMeasuresBehavior(behavior, modality)).length
}

function deterministicRouting(items: AssessmentItemPublic[]): AssessmentPublicPayload["routing"] {
  const anchors = items.filter((item) => item.tier <= 2).slice(0, 3).map((item) => item.item_id)
  if (anchors.length === 0) anchors.push(items[0].item_id)
  return {
    anchor_item_ids: anchors,
    rules: [
      { route_id: "ROUTE-REMEDIATE", min_anchor_score_ratio: 0, max_anchor_score_ratio: 0.4, action: "remediate", reveal_tiers: [1] },
      { route_id: "ROUTE-REINFORCE", min_anchor_score_ratio: 0.4, max_anchor_score_ratio: 0.8, action: "reinforce", reveal_tiers: [1, 2] },
      { route_id: "ROUTE-ADVANCE", min_anchor_score_ratio: 0.8, max_anchor_score_ratio: 1, action: "advance", reveal_tiers: [2, 3] },
    ],
  }
}

function assessmentPublicCoverage(spec: GenerationSpec, items: AssessmentItemPublic[]) {
  return spec.targets.flatMap((target) => {
    const selected = items.filter((item) => item.objective_id === target.objective_id)
    if (selected.length === 0) return []
    return [{
      objective_id: target.objective_id,
      item_ids: selected.map((item) => item.item_id),
      modalities: unique(selected.map((item) => item.modality)),
    }]
  })
}

function assessmentSecureCoverage(spec: GenerationSpec, items: AssessmentItemSecure[]) {
  return spec.targets.flatMap((target) => {
    const selected = items.filter((item) => item.objective_id === target.objective_id)
    if (selected.length === 0) return []
    return [{
      objective_id: target.objective_id,
      item_ids: selected.map((item) => item.item_id),
      answer_kinds: unique(selected.map((item) => item.answer_spec.kind)),
    }]
  })
}

function reorderChoiceOptions(
  payload: AssessmentPublicPayload,
  secureItems: AssessmentItemSecure[],
  seed: number,
): AssessmentPublicPayload {
  let ordinal = 0
  const secureById = new Map(secureItems.map((item) => [item.item_id, item]))
  const items = payload.items.map((item) => {
    if (!item.options) return structuredClone(item)
    const correctId = secureById.get(item.item_id)?.correct_option_id
    const correct = item.options.find((option) => option.option_id === correctId)
    if (!correct) return structuredClone(item)
    const others = item.options.filter((option) => option.option_id !== correctId)
    const targetPosition = (positiveModulo(seed, item.options.length) + ordinal) % item.options.length
    ordinal += 1
    const options = [...others]
    options.splice(targetPosition, 0, correct)
    return { ...structuredClone(item), options: options.map((option, index) => ({ ...option, label: "ABCD"[index] })) }
  })
  return { ...structuredClone(payload), items }
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function deduplicate(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((entry) => [
    `${entry.source_id}:${entry.fact_id}:${entry.relation}`,
    structuredClone(entry),
  ])).values()]
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

/** Converts model-authored inputs into the stdin text contract used by stdin_stdout mode. */
export function asStandardInput(input: unknown): string {
  if (typeof input === "string") return input
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input === undefined || input === null ? "" : `${String(input)}\n`
  }
  const envelope = input as { args?: unknown[]; kwargs?: Record<string, unknown> }
  if (!Array.isArray(envelope.args)) return `${JSON.stringify(input)}\n`
  const lines = [
    ...envelope.args,
    ...Object.values(envelope.kwargs ?? {}),
  ].map((value) => typeof value === "string" ? value : JSON.stringify(value))
  return lines.length > 0 ? `${lines.join("\n")}\n` : ""
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isFunctionInvocationEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return keys.length > 0
    && keys.every((key) => key === "args" || key === "kwargs")
    && Array.isArray(record.args)
    && (record.kwargs === undefined
      || (record.kwargs !== null
        && typeof record.kwargs === "object"
        && !Array.isArray(record.kwargs)))
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const normalized = Math.max(1, Math.floor(size))
  const output: T[][] = []
  for (let index = 0; index < values.length; index += normalized) {
    output.push(values.slice(index, index + normalized))
  }
  return output
}
