import { modelCallPolicy } from "../../model-runtime"
import type { ModelGateway } from "../contracts/model-gateway"
import { contentHash, stableId } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import type { ResourceBlueprint } from "./resource-blueprint"

export interface RoundSemanticPlan {
  plan_id: string
  spec_id: string
  blueprint_id: string
  objective_strategy: Array<{
    objective_id: string
    teaching_focus: string
    misconception_focus: string[]
    example_progression: string[]
  }>
  narrative_arc: string[]
  code_lab_intent: {
    scenario: string
    decomposition: string[]
    boundary_focus: string[]
  }
  assessment_intents: Array<{
    objective_id: string
    cognitive_operation: string
    variation_axis: string
  }>
  cross_artifact_rules: {
    lesson_role: string
    lab_role: string
    assessment_role: string
    forbidden_duplications: string[]
  }
  policy_version: string
  policy_decision_hash: string
}

export interface RoundSemanticPlanner {
  plan(input: {
    spec: GenerationSpec
    evidence: RagEvidencePack
    blueprint: ResourceBlueprint
  }): Promise<RoundSemanticPlan | undefined>
}

const PLAN_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["objective_strategy", "narrative_arc", "code_lab_intent", "assessment_intents", "cross_artifact_rules"],
  properties: {
    objective_strategy: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objective_id", "teaching_focus", "misconception_focus", "example_progression"],
        properties: {
          objective_id: { type: "string", minLength: 1 },
          teaching_focus: { type: "string", minLength: 1, maxLength: 300 },
          misconception_focus: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 160 } },
          example_progression: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", minLength: 1, maxLength: 180 } },
        },
      },
    },
    narrative_arc: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 180 } },
    code_lab_intent: {
      type: "object",
      additionalProperties: false,
      required: ["scenario", "decomposition", "boundary_focus"],
      properties: {
        scenario: { type: "string", minLength: 1, maxLength: 240 },
        decomposition: { type: "array", minItems: 1, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 180 } },
        boundary_focus: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 180 } },
      },
    },
    assessment_intents: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["objective_id", "cognitive_operation", "variation_axis"],
        properties: {
          objective_id: { type: "string", minLength: 1 },
          cognitive_operation: { type: "string", minLength: 1, maxLength: 160 },
          variation_axis: { type: "string", minLength: 1, maxLength: 160 },
        },
      },
    },
    cross_artifact_rules: {
      type: "object",
      additionalProperties: false,
      required: ["lesson_role", "lab_role", "assessment_role", "forbidden_duplications"],
      properties: {
        lesson_role: { type: "string", minLength: 1, maxLength: 240 },
        lab_role: { type: "string", minLength: 1, maxLength: 240 },
        assessment_role: { type: "string", minLength: 1, maxLength: 240 },
        forbidden_duplications: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 180 } },
      },
    },
  },
}

const SYSTEM_PROMPT = `你是 KnowBalance 的跨产物语义规划器。你只输出紧凑的教学组织计划，不生成讲义、代码、题目、答案或测试。

权威边界：
1. GenerationSpec 和 ResourceBlueprint 是冻结合同，不得改变目标、source/fact、题型题量、分值、代码 ABI、公开/私有边界或评分规则。
2. evidence 是唯一专业事实来源；计划只能安排这些事实的教学顺序，不得增加新事实。不得把抽象事实具体化为未被命名的 API、语法、错误结果、执行步骤或边界行为。
3. cross_artifact_contract 是三类产物的分工合同，必须遵守。
4. 输出是内部质量计划，不得包含隐藏答案、隐藏测试、学习者身份或内部推理过程。
5. 仅输出指定 JSON。`

export class ModelRoundSemanticPlanner implements RoundSemanticPlanner {
  constructor(private readonly gateway: ModelGateway) {}

  async plan(input: {
    spec: GenerationSpec
    evidence: RagEvidencePack
    blueprint: ResourceBlueprint
  }): Promise<RoundSemanticPlan | undefined> {
    if (input.blueprint.quality_requirement.profile !== "quality") return undefined
    const requiredFactsBySource = new Map<string, Set<string>>()
    for (const target of input.spec.targets) {
      const ids = requiredFactsBySource.get(target.source_id) ?? new Set<string>()
      target.required_fact_ids.forEach((factId) => ids.add(factId))
      requiredFactsBySource.set(target.source_id, ids)
    }
    try {
      const draft = await this.gateway.generateStructured<Omit<RoundSemanticPlan,
        "plan_id" | "spec_id" | "blueprint_id" | "policy_version" | "policy_decision_hash">>({
        task: "role-c.round-semantic-plan",
        system_prompt: SYSTEM_PROMPT,
        input: {
          generation_spec: {
            spec_id: input.spec.spec_id,
            path_node: input.spec.path_node,
            targets: input.spec.targets,
            learner_adaptation: input.spec.learner_adaptation,
            difficulty: input.spec.difficulty,
            assessment_blueprint: input.spec.assessment_blueprint,
          },
          resource_blueprint: input.blueprint,
          evidence: input.evidence.results
            .filter((item) => requiredFactsBySource.has(item.source_id))
            .map((item) => ({
              source_id: item.source_id,
              title: item.title,
              facts: item.facts.filter((fact) =>
                requiredFactsBySource.get(item.source_id)!.has(fact.fact_id)),
            })),
        },
        output_schema_id: "role_c_round_semantic_plan_v1",
        output_schema: PLAN_SCHEMA,
        temperature: 0,
        max_tokens: 8_000,
        idempotency_key: contentHash({
          task: "role-c.round-semantic-plan",
          spec_id: input.spec.spec_id,
          blueprint_id: input.blueprint.blueprint_id,
          policy_decision_hash: input.blueprint.quality_requirement.decision_hash,
        }),
        policy: modelCallPolicy("quality", {
          reason_codes: [...input.blueprint.quality_requirement.reason_codes],
          max_tokens: 8_000,
          timeout_ms: 180_000,
          max_transport_retries: 1,
        }),
      })
      assertPlan(draft, input.spec)
      const identity = {
        spec_id: input.spec.spec_id,
        blueprint_id: input.blueprint.blueprint_id,
        ...draft,
        policy_version: input.blueprint.quality_requirement.policy_version,
        policy_decision_hash: input.blueprint.quality_requirement.decision_hash,
      }
      return {
        plan_id: stableId("ROUND-SEMANTIC-PLAN", identity),
        ...identity,
      }
    } catch {
      // The deterministic blueprint remains sufficient for a valid FAST round.
      return undefined
    }
  }
}

function assertPlan(
  draft: Omit<RoundSemanticPlan, "plan_id" | "spec_id" | "blueprint_id" | "policy_version" | "policy_decision_hash">,
  spec: GenerationSpec,
): void {
  if (!draft || !Array.isArray(draft.objective_strategy) || !Array.isArray(draft.assessment_intents)) {
    throw new Error("ROUND_SEMANTIC_PLAN_INVALID")
  }
  const expected = new Set(spec.targets.map((target) => target.objective_id))
  const strategies = draft.objective_strategy.map((entry) => entry.objective_id)
  if (strategies.length !== expected.size
    || new Set(strategies).size !== strategies.length
    || strategies.some((id) => !expected.has(id))) {
    throw new Error("ROUND_SEMANTIC_PLAN_OBJECTIVE_MISMATCH")
  }
  if (draft.assessment_intents.some((entry) => !expected.has(entry.objective_id))) {
    throw new Error("ROUND_SEMANTIC_PLAN_ASSESSMENT_OBJECTIVE_MISMATCH")
  }
}
