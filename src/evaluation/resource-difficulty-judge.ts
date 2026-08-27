import type { ArtifactKind, Difficulty } from "./competition-metrics"
import { fastModelPolicy } from "../model-runtime"
import { contentHash } from "../role-c-content/contracts/common"
import type { ModelGateway } from "../role-c-content/contracts/model-gateway"

/**
 * 资源难度评估器（改进方案8 第四节4）。
 *
 * 这是正式"适配准确率"的判定器，与 B 教学审核器（checkDifficulty 路径安全审核）
 * 严格分离。它只能看到生成资源本身，不能看到该案例的 expected_difficulty，
 * 否则会退化成"看标准答案打分"。
 */
export interface ResourceDifficultyJudge {
  classify(input: {
    case_id: string
    artifact_kind: ArtifactKind
    title: string
    content: string
    rubric_version: "difficulty-rubric-v1"
  }): Promise<{
    predicted_difficulty: Difficulty
    reasons: string[]
    confidence: number
  }>
}

/**
 * 难度分级 rubric（difficulty-rubric-v1，改进方案8 第三节2）。
 * 正式评测提示词必须强调以下约束。
 */
export const DIFFICULTY_RUBRIC_PROMPT = `
你是资源难度分级器，只判断资源实际呈现的教学难度，输出四档之一并给出可核查依据。

1. 只判断资源实际呈现的教学难度；
2. 不根据知识点名称本身判断；
3. 不允许看到该案例的 expected_difficulty（标准答案）；
4. 根据解释密度、任务步骤、脚手架程度、认知要求、错误处理、开放程度和知识综合度进行判断；
5. 只返回四档之一和可核查依据。

分级标准：
- beginner：完整步骤、单一概念、充分脚手架、直接模仿
- basic：两到三步应用、部分脚手架、简单迁移
- intermediate：多步骤、调试、边界处理、较少提示
- integrated：多知识点综合、开放设计、独立完成项目

判定校准：
- “beginner”必须是单步识别/直接代入，或 starter 已给出几乎全部解法；不能只因为文字解释清晰就判为 beginner。
- 学习者需自行完成两个以上相互依赖的操作（例如构造数据后再索引、统计或转换），且存在 TODO/pass 学习者区域时，至少是 basic。
- 逐级提示是按需展开的可选脚手架，不等同于初始就提供完整答案；它可以降低难度，但不能单独把两到三步应用判成 beginner。
- 讲义同时要求联系多条事实、跟踪两到三步状态变化或完成简单迁移检查时，应判为 basic，不因其中也含有定义解释而降为 beginner。
- 先判断学习者实际需要完成的最高核心认知操作，再综合脚手架调整；不得以“存在基础定义”覆盖后续应用要求。
`.trim()

export const MODEL_DIFFICULTY_JUDGE_VERSION = "competition-difficulty-judge-v3"

const MODEL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["predicted_difficulty", "reasons", "confidence"],
  properties: {
    predicted_difficulty: { enum: ["beginner", "basic", "intermediate", "integrated"] },
    reasons: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
}

/** 正式评测使用的模型难度判定器；输入中刻意没有 expected_difficulty。 */
export class ModelResourceDifficultyJudge implements ResourceDifficultyJudge {
  constructor(private readonly gateway: ModelGateway) {}

  async classify(input: {
    case_id: string
    artifact_kind: ArtifactKind
    title: string
    content: string
    rubric_version: "difficulty-rubric-v1"
  }): Promise<{ predicted_difficulty: Difficulty; reasons: string[]; confidence: number }> {
    const payload = {
      case_id: input.case_id,
      artifact_kind: input.artifact_kind,
      title: input.title,
      content: input.content,
      rubric_version: input.rubric_version,
    }
    let lastIssue = "COMPETITION_DIFFICULTY_OUTPUT_INVALID"
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.gateway.generateStructured<{
        predicted_difficulty: unknown
        reasons: unknown
        confidence: unknown
      }>({
        task: "competition.resource-difficulty",
        system_prompt: [
          DIFFICULTY_RUBRIC_PROMPT,
          ...(attempt === 0 ? [] : [
            `上次输出未通过结构校验（${lastIssue}）。本次 predicted_difficulty 必须精确输出 beginner/basic/intermediate/integrated 之一，confidence 必须是 0..1 数字。`,
          ]),
        ].join("\n\n"),
        input: payload,
        output_schema_id: "competition_resource_difficulty_v1",
        output_schema: MODEL_OUTPUT_SCHEMA,
        temperature: 0,
        max_tokens: 900,
        policy: fastModelPolicy("COMPETITION_DIFFICULTY_AUDIT", 900, {
          timeout_ms: 120_000,
          max_transport_retries: 1,
          priority: "review",
          concurrency_group: "audit",
        }),
        idempotency_key: contentHash({
          version: MODEL_DIFFICULTY_JUDGE_VERSION,
          model_config_hash: this.gateway.model_config_hash,
          payload,
          attempt,
        }),
      })
      const predictedDifficulty = normalizeDifficultyLabel(result.predicted_difficulty)
      if (!predictedDifficulty) {
        lastIssue = "COMPETITION_DIFFICULTY_INVALID_LABEL"
        continue
      }
      if (!Array.isArray(result.reasons) || result.reasons.length === 0
        || result.reasons.some((reason) => typeof reason !== "string" || !reason.trim())) {
        lastIssue = "COMPETITION_DIFFICULTY_REASONS_MISSING"
        continue
      }
      // 置信度只用于解释判定，不参与三项正式指标。部分 OpenAI-compatible
      // 服务会把它写成任意自然语言；只要冻结的四档标签和可核查理由有效，
      // 不应因此把整份真实资源记成“未审核”。无法规范化时保守记为 0.5。
      const confidence = normalizeConfidence(result.confidence) ?? 0.5
      return {
        predicted_difficulty: predictedDifficulty,
        reasons: [
          ...result.reasons.map((reason) => String(reason)),
          ...(normalizeConfidence(result.confidence) === undefined
            ? ["评审模型未返回可规范化置信度；该辅助字段按 0.5 记录，不影响难度标签"]
            : []),
        ],
        confidence,
      }
    }
    throw new Error(lastIssue)
  }
}

/**
 * json_object providers do not all honour enum schemas literally.  Accept only
 * unambiguous spellings of the four frozen rubric labels; unknown or compound
 * labels still fail closed instead of being guessed into a passing class.
 */
export function normalizeDifficultyLabel(value: unknown): Difficulty | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLocaleLowerCase()
    .replace(/^(?:difficulty|level|predicted[_\s-]*difficulty)\s*[:：]\s*/u, "")
    .replace(/[（(].*?[）)]/gu, "")
    .trim()
  const aliases: Record<string, Difficulty> = {
    beginner: "beginner",
    "入门": "beginner",
    "初学者": "beginner",
    "零基础": "beginner",
    basic: "basic",
    "基础": "basic",
    "初级": "basic",
    intermediate: "intermediate",
    "中级": "intermediate",
    integrated: "integrated",
    "综合": "integrated",
    "项目综合": "integrated",
  }
  return aliases[normalized]
}

export function normalizeConfidence(value: unknown): number | undefined {
  let numeric: number
  if (typeof value === "number") numeric = value
  else if (typeof value === "string") {
    const normalized = value.trim()
    const qualitative: Record<string, number> = {
      high: 0.85, "高": 0.85, "较高": 0.78,
      medium: 0.6, "中": 0.6, "中等": 0.6,
      low: 0.35, "低": 0.35, "较低": 0.42,
    }
    if (qualitative[normalized] !== undefined) return qualitative[normalized]
    // json_object providers occasionally decorate a valid numeric confidence
    // as "0.95（高）" or "95% (high)". Accept one leading numeric value while
    // rejecting strings with multiple competing numbers.
    const numericParts = normalized.match(/\d+(?:\.\d+)?|\.\d+/gu)
    if (!numericParts || numericParts.length !== 1) return undefined
    const numberMatch = /^(\d+(?:\.\d+)?|\.\d+)\s*(%)?/u.exec(normalized)
    if (!numberMatch) return undefined
    numeric = Number(numberMatch[1])
    if (numberMatch[2]) numeric /= 100
  } else return undefined
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return undefined
  return numeric <= 1 ? numeric : numeric / 100
}

/**
 * 确定性 rule-based 难度分类器（开发与测试用）。
 *
 * 真实正式评测应使用与生成模型不同的判定模型（本接口的模型实现），
 * 并对至少 20% 案例人工复核。此实现仅用于：
 *  - 单元测试验证评测链路闭环；
 *  - 开发阶段快速自检分类器接口契约。
 */
export class RuleBasedResourceDifficultyJudge implements ResourceDifficultyJudge {
  async classify(input: {
    case_id: string
    artifact_kind: ArtifactKind
    title: string
    content: string
    rubric_version: "difficulty-rubric-v1"
  }): Promise<{ predicted_difficulty: Difficulty; reasons: string[]; confidence: number }> {
    const text = `${input.title}\n${input.content}`.toLocaleLowerCase()
    const reasons: string[] = []

    const integrated = countMatches(text, /综合|项目|设计|独立完成|多模块|整合|从零|自主|完整实现|多知识/u)
    const intermediate = countMatches(text, /调试|debug|边界|异常|错误处理|edge\s?case|越界|优化|重构|排查|较少提示/u)
    const basic = countMatches(text, /应用|迁移|填空|补充|修改|调用|简单|部分/u)
    const beginner = countMatches(text, /模仿|照抄|直接|示例|跟着|复制|第一步|逐步|完全给出|单步/u)

    if (integrated >= 2 && integrated >= intermediate) {
      reasons.push(`综合/项目类特征 ${integrated} 处`)
      return { predicted_difficulty: "integrated", reasons, confidence: 0.6 }
    }
    if (intermediate >= 2) {
      reasons.push(`调试/边界/多步骤特征 ${intermediate} 处`)
      return { predicted_difficulty: "intermediate", reasons, confidence: 0.6 }
    }
    if (basic >= 2) {
      reasons.push(`应用/迁移类特征 ${basic} 处`)
      return { predicted_difficulty: "basic", reasons, confidence: 0.6 }
    }
    if (beginner >= 1) {
      reasons.push(`模仿/逐步脚手架特征 ${beginner} 处`)
      return { predicted_difficulty: "beginner", reasons, confidence: 0.5 }
    }
    reasons.push("未命中明显特征，按单一概念与直接呈现判定为 beginner")
    return { predicted_difficulty: "beginner", reasons, confidence: 0.4 }
  }
}

function countMatches(text: string, pattern: RegExp): number {
  // match 无 g 标志只返回第一个匹配，这里补 g 以统计全部命中次数。
  const global = new RegExp(pattern.source, "gu")
  return (text.match(global) ?? []).length
}
