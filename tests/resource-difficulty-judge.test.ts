import { describe, expect, test } from "bun:test"
import type { ModelGateway, StructuredModelRequest } from "../src/role-c-content/contracts/model-gateway"
import {
  ModelResourceDifficultyJudge,
  normalizeConfidence,
  normalizeDifficultyLabel,
  RuleBasedResourceDifficultyJudge,
} from "../src/evaluation/resource-difficulty-judge"

const judge = new RuleBasedResourceDifficultyJudge()

function classify(content: string) {
  return judge.classify({
    case_id: "c1",
    artifact_kind: "assessment",
    title: "测试",
    content,
    rubric_version: "difficulty-rubric-v1",
  })
}

describe("ResourceDifficultyJudge rule-based 实现（改进方案8 第四节4）", () => {
  test("综合/项目/独立完成 → integrated", async () => {
    const result = await classify("请独立完成一个综合项目：设计并实现完整的多模块成绩统计系统。")
    expect(result.predicted_difficulty).toBe("integrated")
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  test("调试/边界/异常 → intermediate", async () => {
    const result = await classify("调试以下程序，处理边界情况和异常错误。")
    expect(result.predicted_difficulty).toBe("intermediate")
  })

  test("应用/迁移/填空 → basic", async () => {
    const result = await classify("应用所学知识，完成一个简单的函数调用填空。")
    expect(result.predicted_difficulty).toBe("basic")
  })

  test("模仿/直接/示例 → beginner", async () => {
    const result = await classify("直接模仿示例，照抄完整代码。")
    expect(result.predicted_difficulty).toBe("beginner")
  })

  test("只返回四档之一，且 rubric 版本固定为 v1", async () => {
    const result = await classify("一段普通的教学内容。")
    expect(["beginner", "basic", "intermediate", "integrated"]).toContain(result.predicted_difficulty)
    expect(result.confidence).toBeGreaterThan(0)
  })
})

describe("ResourceDifficultyJudge model 实现", () => {
  test("真实判定请求不包含 expected_difficulty", async () => {
    let requestInput: unknown
    const gateway: ModelGateway = {
      model_id: "judge-model",
      model_config_hash: "MODEL-judge",
      async generateStructured<T>(request: StructuredModelRequest): Promise<T> {
        requestInput = request.input
        return {
          predicted_difficulty: "basic",
          reasons: ["需要两步应用并保留部分脚手架"],
          confidence: 90,
        } as T
      },
    }
    const modelJudge = new ModelResourceDifficultyJudge(gateway)
    const result = await modelJudge.classify({
      case_id: "c1",
      artifact_kind: "lab",
      title: "列表练习",
      content: "补全两处代码并运行公开测试。",
      rubric_version: "difficulty-rubric-v1",
    })
    expect(result.predicted_difficulty).toBe("basic")
    expect(result.confidence).toBe(0.9)
    expect(JSON.stringify(requestInput)).not.toContain("expected_difficulty")
  })

  test("只规范化无歧义的四档标签与百分比置信度", () => {
    expect(normalizeDifficultyLabel("基础")).toBe("basic")
    expect(normalizeDifficultyLabel("predicted_difficulty: integrated")).toBe("integrated")
    expect(normalizeDifficultyLabel("基础或中级")).toBeUndefined()
    expect(normalizeConfidence("85%")).toBe(0.85)
    expect(normalizeConfidence("0.92")).toBe(0.92)
    expect(normalizeConfidence("0.95（高）")).toBe(0.95)
    expect(normalizeConfidence("high")).toBe(0.85)
    expect(normalizeConfidence("0.9 / 0.8")).toBeUndefined()
  })

  test("结构不合规时做一次有指向的模型修复，不把异常档位猜成标准答案", async () => {
    let calls = 0
    const gateway: ModelGateway = {
      model_id: "judge-model",
      model_config_hash: "MODEL-judge-repair",
      async generateStructured<T>(): Promise<T> {
        calls += 1
        return (calls === 1
          ? { predicted_difficulty: "基础或中级", reasons: ["不确定"], confidence: "high" }
          : { predicted_difficulty: "basic", reasons: ["需要两步应用"], confidence: 0.86 }) as T
      },
    }
    const result = await new ModelResourceDifficultyJudge(gateway).classify({
      case_id: "c-repair",
      artifact_kind: "lab",
      title: "练习",
      content: "完成两步应用。",
      rubric_version: "difficulty-rubric-v1",
    })
    expect(calls).toBe(2)
    expect(result.predicted_difficulty).toBe("basic")
  })

  test("有效难度标签不会因辅助置信度格式漂移而变成漏审", async () => {
    const gateway: ModelGateway = {
      model_id: "judge-model",
      model_config_hash: "MODEL-judge-confidence-metadata",
      async generateStructured<T>(): Promise<T> {
        return {
          predicted_difficulty: "beginner",
          reasons: ["单步识别且提供完整脚手架"],
          confidence: { level: "high" },
        } as T
      },
    }
    const result = await new ModelResourceDifficultyJudge(gateway).classify({
      case_id: "c-confidence",
      artifact_kind: "lesson",
      title: "概念识别",
      content: "根据完整示例识别关键字。",
      rubric_version: "difficulty-rubric-v1",
    })
    expect(result.predicted_difficulty).toBe("beginner")
    expect(result.confidence).toBe(0.5)
    expect(result.reasons.join(" ")).toContain("辅助字段")
  })
})
