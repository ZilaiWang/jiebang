import type {
  AssessmentPublicArtifact,
  AssessmentSecureArtifact,
  CodeLabPublicArtifact,
  CodeLabSecureArtifact,
  ConceptLessonArtifact,
  RenderBlock,
} from "../contracts/artifacts"
import { stableId } from "../contracts/common"
import type { GenerationSpec } from "../contracts/generation-spec"
import { modalityMeasuresBehavior } from "../contracts/assessment-measurement"

export interface AlignmentObjection {
  objection_id: string
  from_agent: "concept-tutor" | "code-lab" | "tiered-evaluator" | "cross-artifact-gate"
  target_artifact_id: string
  objective_id: string
  issue_type:
    | "unsupported_claim"
    | "unmeasurable_objective"
    | "missing_prerequisite"
    | "undeclared_prerequisite"
    | "difficulty_mismatch"
    | "unexecutable_task"
    | "answer_key_conflict"
    | "missing_instruction"
    | "missing_practice"
    | "missing_assessment"
    | "mapping_conflict"
  severity: "warning" | "critical"
  evidence: string[]
  proposed_action: string
}

export interface AlignmentReport {
  ok: boolean
  alignment_score: number
  objections: AlignmentObjection[]
}

export interface CrossArtifactAlignmentInput {
  spec: GenerationSpec
  concept: ConceptLessonArtifact
  lab: CodeLabPublicArtifact
  assessment: AssessmentPublicArtifact
  lab_secure?: CodeLabSecureArtifact
  assessment_secure?: AssessmentSecureArtifact
}

export interface CrossArtifactCritic {
  review(input: CrossArtifactAlignmentInput): Promise<AlignmentObjection[]>
}

/** Independent critic: it reports objections and never edits an artifact. */
export class DeterministicCrossArtifactCritic implements CrossArtifactCritic {
  async review(input: CrossArtifactAlignmentInput): Promise<AlignmentObjection[]> {
    return inspectAlignment(input)
  }
}

export function validateCrossArtifactAlignment(input: CrossArtifactAlignmentInput): AlignmentReport {
  return reportFromObjections(input.spec, inspectAlignment(input))
}

export function reportFromObjections(spec: GenerationSpec, objections: AlignmentObjection[]): AlignmentReport {
  const unique = [...new Map(objections.map((entry) => [entry.objection_id, entry])).values()]
  const denominator = Math.max(1, spec.targets.filter((target) => target.importance === "core").length * 7)
  const penalty = unique.reduce((sum, entry) => sum + (entry.severity === "critical" ? 1 : 0.35), 0)
  return {
    ok: unique.every((entry) => entry.severity !== "critical"),
    alignment_score: Math.round(Math.max(0, (denominator - penalty) / denominator) * 1_000_000) / 1_000_000,
    objections: unique,
  }
}

function inspectAlignment(input: CrossArtifactAlignmentInput): AlignmentObjection[] {
  const objections: AlignmentObjection[] = []
  const conceptPayload = input.concept.payload
  const labPayload = input.lab.payload
  const assessmentPayload = input.assessment.payload
  if (!conceptPayload || !labPayload || !assessmentPayload) return [makeObjection({
    artifactId: !conceptPayload ? input.concept.artifact_id : !labPayload ? input.lab.artifact_id : input.assessment.artifact_id,
    objectiveId: "pipeline",
    type: "mapping_conflict",
    evidence: ["ready artifact payload missing"],
    action: "重新生成缺少 payload 的产物",
  })]

  const conceptBlocks = collectBlocks(conceptPayload)
  const conceptCoverage = new Map(conceptPayload.objective_coverage.map((entry) => [entry.objective_id, entry]))
  const labInstructionIds = new Set(labPayload.instructions.map((block) => block.block_id))
  const labTestIds = new Set(labPayload.public_tests.map((test) => test.test_id))
  const labCoverage = new Map(labPayload.objective_coverage.map((entry) => [entry.objective_id, entry]))
  const assessmentItems = new Map(assessmentPayload.items.map((item) => [item.item_id, item]))
  const assessmentCoverage = new Map(assessmentPayload.objective_coverage.map((entry) => [entry.objective_id, entry]))
  const declaredSources = new Set([...input.spec.path_node.target_source_ids, ...input.spec.path_node.prerequisite_source_ids])

  for (const target of input.spec.targets.filter((entry) => entry.importance === "core")) {
    const conceptMap = conceptCoverage.get(target.objective_id)
    const validConceptBlocks = conceptMap?.block_ids.filter((id) => conceptBlocks.has(id)) ?? []
    if (validConceptBlocks.length === 0) objections.push(makeObjection({
      artifactId: input.concept.artifact_id, objectiveId: target.objective_id, type: "missing_instruction",
      evidence: conceptMap?.block_ids ?? [], action: "为该目标补充可定位的讲解/示例/检查块并更新 coverage",
    }))

    const labMap = labCoverage.get(target.objective_id)
    const validInstructions = labMap?.instruction_block_ids.filter((id) => labInstructionIds.has(id)) ?? []
    const validTests = labMap?.public_test_ids.filter((id) => labTestIds.has(id)) ?? []
    if (validInstructions.length === 0 || validTests.length === 0) objections.push(makeObjection({
      artifactId: input.lab.artifact_id, objectiveId: target.objective_id, type: "missing_practice",
      evidence: [...validInstructions, ...validTests], action: "为该目标补齐实验步骤和至少一个可观察测试",
    }))

    const assessmentMap = assessmentCoverage.get(target.objective_id)
    const validItems = assessmentMap?.item_ids.map((id) => assessmentItems.get(id)).filter((item) => item !== undefined) ?? []
    if (validItems.length === 0) objections.push(makeObjection({
      artifactId: input.assessment.artifact_id, objectiveId: target.objective_id, type: "missing_assessment",
      evidence: assessmentMap?.item_ids ?? [], action: "为该目标补充可评分题目并更新 coverage",
    }))
    else if (!validItems.some((item) =>
      modalityMeasuresBehavior(target.observable_behavior, item.modality))) {
      objections.push(makeObjection({
        artifactId: input.assessment.artifact_id, objectiveId: target.objective_id, type: "unmeasurable_objective",
        evidence: validItems.map((item) => `${item.item_id}:${item.modality}`),
        action: `使用能直接观察 ${target.observable_behavior} 行为的题型`,
      }))
    }
  }

  for (const block of labPayload.instructions) {
    for (const citation of citationsOfBlock(block)) {
      if (!declaredSources.has(citation.source_id)) objections.push(makeObjection({
        artifactId: input.lab.artifact_id, objectiveId: "pipeline", type: "undeclared_prerequisite",
        evidence: [`${block.block_id}:${citation.source_id}:${citation.fact_id}`],
        action: "从实验删除未声明知识，或由路径生产方显式补充先修后重建 Spec",
      }))
    }
  }

  const actualPrerequisites = new Set(conceptPayload.prerequisite_bridge.flatMap(citationsOfBlock).map((entry) => entry.source_id))
  for (const sourceId of input.spec.path_node.prerequisite_source_ids) {
    const sourceIsActuallyUsed = labPayload.used_evidence.some((entry) => entry.source_id === sourceId)
    if (sourceIsActuallyUsed && !actualPrerequisites.has(sourceId)) objections.push(makeObjection({
      artifactId: input.concept.artifact_id, objectiveId: "pipeline", type: "missing_prerequisite",
      evidence: [sourceId], action: "在讲义先修桥梁中明确讲授实验实际使用的先修知识",
    }))
  }

  if (input.lab.quality.execution_verified !== true || input.lab_secure?.quality.execution_verified === false) objections.push(makeObjection({
    artifactId: input.lab.artifact_id, objectiveId: "pipeline", type: "unexecutable_task",
    evidence: ["execution_verified is not true"], action: "由独立 runner 重新验证 reference、starter 与错误变体",
  }))
  if (input.assessment.quality.answer_key_verified !== true || input.assessment_secure?.quality.answer_key_verified === false) objections.push(makeObjection({
    artifactId: input.assessment.artifact_id, objectiveId: "pipeline", type: "answer_key_conflict",
    evidence: ["answer_key_verified is not true"], action: "由独立 verifier 重新核验所有答案规范",
  }))

  if (input.assessment_secure?.payload) {
    const secureById = new Map(input.assessment_secure.payload.items.map((item) => [item.item_id, item]))
    for (const publicItem of assessmentPayload.items) {
      const secureItem = secureById.get(publicItem.item_id)
      if (!secureItem || secureItem.objective_id !== publicItem.objective_id || secureItem.modality !== publicItem.modality || secureItem.max_score !== publicItem.max_score) {
        objections.push(makeObjection({
          artifactId: input.assessment.artifact_id, objectiveId: publicItem.objective_id, type: "answer_key_conflict",
          evidence: [publicItem.item_id], action: "同步 public/secure 题目合同后重新验证答案",
        }))
      } else if (secureItem.correct_option_id && !publicItem.options?.some((option) => option.option_id === secureItem.correct_option_id)) {
        objections.push(makeObjection({
          artifactId: input.assessment.artifact_id, objectiveId: publicItem.objective_id, type: "answer_key_conflict",
          evidence: [publicItem.item_id, secureItem.correct_option_id], action: "修复稳定选项 ID 与正确答案映射",
        }))
      }
    }
  }
  return objections
}

function collectBlocks(payload: NonNullable<ConceptLessonArtifact["payload"]>): Set<string> {
  return new Set([
    ...payload.prerequisite_bridge,
    ...payload.explanation_blocks,
    ...payload.worked_examples,
    ...payload.micro_checks,
    ...payload.summary,
  ].map((block) => block.block_id))
}

function citationsOfBlock(block: RenderBlock) {
  if ("citations" in block) return block.citations
  if ("claims" in block) return block.claims.flatMap((claim) => claim.citations)
  return []
}

function makeObjection(input: {
  artifactId: string
  objectiveId: string
  type: AlignmentObjection["issue_type"]
  evidence: string[]
  action: string
  severity?: AlignmentObjection["severity"]
}): AlignmentObjection {
  return {
    objection_id: stableId("OBJ", input),
    from_agent: "cross-artifact-gate",
    target_artifact_id: input.artifactId,
    objective_id: input.objectiveId,
    issue_type: input.type,
    severity: input.severity ?? "critical",
    evidence: input.evidence,
    proposed_action: input.action,
  }
}
