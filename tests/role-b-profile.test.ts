// B 角色画像链契约测试
// 金标准来源: src/role-b-profile/profile-demo.ts 的实跑输出（非推测值）
// 覆盖: 词表规范化方向规则 / 证据合成与冲突记录 / level 级联 / schema 对齐 /
//        query 格式契约 / docx §6 B 验收（K007/K009/K018 可检回）/ prompt 契约 / demo 可执行
import { describe, expect, test } from "bun:test"
import { canonicalizeConcept, canonicalizeMany } from "../src/role-b-profile/concept-canonicalizer"
import { synthesizeProfile } from "../src/role-b-profile/profile-synthesizer"
import { buildRagQuery, buildRagRequest, executeProfileRetrieval, DEFAULT_TOP_K } from "../src/role-b-profile/rag-bridge"
import { buildRoleBWorkerPrompt, ROLE_B_WORKER_NAMES } from "../src/role-b-profile/prompts"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { WORKER_DEFINITIONS } from "../src/agents/workers"
import type {
  BackgroundEvidence,
  ObjectiveDiagnosisEvidence,
  SelfAssessmentEvidence,
} from "../src/role-b-profile/types"

interface EvidenceBundle {
  learner_request: string
  background: BackgroundEvidence
  self_assessment: SelfAssessmentEvidence
  objective_diagnosis: ObjectiveDiagnosisEvidence
}

async function loadFixture(): Promise<EvidenceBundle> {
  return (await Bun.file("examples/learner_evidence_loop_weak.json").json()) as EvidenceBundle
}

describe("concept canonicalizer", () => {
  test("exact keyword match beats longer containing terms (循环 must not become while 循环)", async () => {
    const kb = await loadKnowledgeBase()

    const loop = canonicalizeConcept("循环", kb)
    expect(loop.canonical).toBe("循环")
    expect(loop.matched).toBe(true)
    expect(loop.sourceIds).toContain("K007")

    const variable = canonicalizeConcept("变量", kb)
    expect(variable.canonical).toBe("变量")
    expect(variable.sourceIds).toContain("K002")
  })

  test("free-text phrases map onto knowledge-base vocabulary, most specific term wins", async () => {
    const kb = await loadKnowledgeBase()

    // "for循环写不来" 明确指向 for 循环 → 规范到 K007 标题（比泛化"循环"保留更多信息）
    const forLoop = canonicalizeConcept("for循环写不来", kb)
    expect(forLoop.canonical).toBe("for 循环")
    expect(forLoop.sourceIds).toEqual(["K007"])

    expect(canonicalizeConcept("列表完全不会", kb).canonical).toBe("列表")
    expect(canonicalizeConcept("数据类型", kb).canonical).toBe("数据类型")
  })

  test("unmatched concepts pass through flagged instead of being dropped", async () => {
    const kb = await loadKnowledgeBase()
    const result = canonicalizeConcept("量子计算", kb)

    expect(result.matched).toBe(false)
    expect(result.canonical).toBe("量子计算")
    expect(result.sourceIds).toEqual([])
  })

  test("deduplicates phrases that map to the same canonical concept", async () => {
    const kb = await loadKnowledgeBase()
    const results = canonicalizeMany(["列表完全不会", "列表不太行"], kb)

    expect(results).toHaveLength(1)
    expect(results[0].canonical).toBe("列表")

    // 边界：同一知识点的不同 keyword 不合并（检索端无损，见 canonicalizeMany 注释）
    const boundary = canonicalizeMany(["列表完全不会", "一组数据怎么存"], kb)
    expect(boundary).toHaveLength(2)
    expect(boundary.every((entry) => entry.sourceIds.includes("K009"))).toBe(true)
  })
})

describe("profile synthesizer", () => {
  test("golden run on the loop_weak evidence bundle", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()

    const synthesis = synthesizeProfile({
      background: bundle.background,
      selfAssessment: bundle.self_assessment,
      objectiveDiagnosis: bundle.objective_diagnosis,
      knowledgeBase: kb,
    })

    // 画像与 A 的 examples/learner_loop_weak.json 人设收敛
    expect(synthesis.profile.learner_id).toBe("demo_loop_weak_001")
    expect(synthesis.profile.level).toBe("beginner")
    expect(synthesis.profile.known_concepts).toEqual(["变量", "数据类型", "条件判断"])
    expect(synthesis.profile.weak_concepts).toEqual(["循环", "列表"])
    expect(synthesis.profile.goal).toBe("完成一个成绩统计小程序，能遍历一批成绩算平均分")
  })

  test("objective incorrect overrides self-claimed known and the conflict is recorded", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()

    const synthesis = synthesizeProfile({
      background: bundle.background,
      selfAssessment: bundle.self_assessment,
      objectiveDiagnosis: bundle.objective_diagnosis,
      knowledgeBase: kb,
    })

    // 自评"循环还行"被客观答错推翻 → weak，且冲突显式记录
    expect(synthesis.profile.weak_concepts).toContain("循环")
    expect(synthesis.provenance.conflicts).toHaveLength(1)
    expect(synthesis.provenance.conflicts[0]).toMatchObject({
      concept: "循环",
      selfClaim: "known",
      objectiveVerdict: "incorrect",
      resolution: "weak",
    })
  })

  test("objective source identity reconciles generic self wording with a specific knowledge title", async () => {
    const kb = await loadKnowledgeBase()
    const synthesis = synthesizeProfile({
      background: {
        evidence_type: "background",
        learner_id: "alias-learner",
        education_context: null,
        prior_languages: ["Python"],
        prior_topics: [],
        goal_raw: "掌握循环",
        time_budget: null,
        quotes: [],
      },
      selfAssessment: {
        evidence_type: "self_assessment",
        self_rating: "basic",
        claimed_known: [],
        claimed_weak: ["循环"],
        quotes: [],
      },
      objectiveDiagnosis: {
        evidence_type: "objective_diagnosis",
        items: [{
          source_id: "K007",
          fact_id: "F001",
          question: "for 循环最适合用于什么场景？",
          learner_answer: "遍历序列",
          verdict: "correct",
          concept: "for 循环",
          difficulty: "beginner",
        }],
        quotes: [],
      },
      knowledgeBase: kb,
    })

    expect(synthesis.profile.known_concepts).toContain("for 循环")
    expect(synthesis.profile.weak_concepts).not.toContain("循环")
    expect(synthesis.provenance.conflicts).toContainEqual(expect.objectContaining({
      concept: "for 循环",
      selfClaim: "weak",
      objectiveVerdict: "correct",
      resolution: "known",
    }))
  })

  test("diagnosis items carry their own source_id into provenance", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()

    const synthesis = synthesizeProfile({
      background: bundle.background,
      selfAssessment: bundle.self_assessment,
      objectiveDiagnosis: bundle.objective_diagnosis,
      knowledgeBase: kb,
    })

    const loopProvenance = synthesis.provenance.concepts.find((entry) => entry.concept === "循环")
    expect(loopProvenance?.source).toBe("objective")
    expect(loopProvenance?.matched_source_ids).toContain("K007") // 答错的就是 K007 的题
  })

  test("level cascade: objective cap wins, self rating fallback, default beginner", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()

    // 客观答错 beginner 题 → 封顶 beginner
    const withObjective = synthesizeProfile({
      background: bundle.background,
      selfAssessment: bundle.self_assessment,
      objectiveDiagnosis: bundle.objective_diagnosis,
      knowledgeBase: kb,
    })
    expect(withObjective.provenance.level.source).toBe("objective_cap")
    expect(withObjective.profile.level).toBe("beginner")

    // 无客观信号 → 用自评
    const noObjective = synthesizeProfile({
      background: bundle.background,
      selfAssessment: { ...bundle.self_assessment, self_rating: "basic" },
      objectiveDiagnosis: { evidence_type: "objective_diagnosis", items: [], quotes: [] },
      knowledgeBase: kb,
    })
    expect(noObjective.provenance.level.source).toBe("self_rating")
    expect(noObjective.profile.level).toBe("basic")

    // 全无信号 → 默认 beginner
    const noSignal = synthesizeProfile({
      background: bundle.background,
      selfAssessment: { ...bundle.self_assessment, self_rating: null },
      objectiveDiagnosis: { evidence_type: "objective_diagnosis", items: [], quotes: [] },
      knowledgeBase: kb,
    })
    expect(noSignal.provenance.level.source).toBe("default")
    expect(noSignal.profile.level).toBe("beginner")
  })

  test("three or more fully correct objective items can raise the conservative teaching start by one level", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()
    const synthesis = synthesizeProfile({
      background: bundle.background,
      selfAssessment: { ...bundle.self_assessment, self_rating: "beginner", claimed_known: [], claimed_weak: ["循环", "列表"] },
      objectiveDiagnosis: {
        evidence_type: "objective_diagnosis",
        quotes: [],
        items: [
          { source_id: "K007", fact_id: "F001", question: "for", learner_answer: "遍历序列", verdict: "correct", concept: "for 循环", difficulty: "beginner" },
          { source_id: "K009", fact_id: "F001", question: "list", learner_answer: "append", verdict: "correct", concept: "列表", difficulty: "basic" },
          { source_id: "K013", fact_id: "F001", question: "function", learner_answer: "def", verdict: "correct", concept: "函数定义与调用", difficulty: "basic" },
        ],
      },
      knowledgeBase: kb,
    })

    expect(synthesis.profile.level).toBe("basic")
    expect(synthesis.provenance.level.source).toBe("objective_promotion")
    expect(synthesis.provenance.level.rule).toContain("至少 3 道客观题全部答对")
  })

  test("missing goal fails loudly instead of being invented", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()

    expect(() =>
      synthesizeProfile({
        background: { ...bundle.background, goal_raw: null },
        selfAssessment: bundle.self_assessment,
        objectiveDiagnosis: bundle.objective_diagnosis,
        knowledgeBase: kb,
      }),
    ).toThrow(/question/)
  })
})

describe("rag bridge (B → A handoff contract)", () => {
  test("profile satisfies the schema constraints A published in rag_request.schema.json", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()
    const schema = await Bun.file("schemas/rag_request.schema.json").json()

    const synthesis = synthesizeProfile({
      background: bundle.background,
      selfAssessment: bundle.self_assessment,
      objectiveDiagnosis: bundle.objective_diagnosis,
      knowledgeBase: kb,
    })
    const request = synthesis.rag_request

    // 从 schema 文件本身读取约束做断言：A 改契约时本测试自动失效并提醒 B 跟进
    for (const key of schema.required) {
      expect(request).toHaveProperty(key)
    }
    for (const key of schema.properties.learner_profile.required) {
      expect(request.learner_profile).toHaveProperty(key)
    }
    expect(schema.properties.learner_profile.properties.level.enum).toContain(request.learner_profile.level)
    expect(request.query.length).toBeGreaterThanOrEqual(schema.properties.query.minLength)
    expect(request.top_k).toBeGreaterThanOrEqual(schema.properties.top_k.minimum)
    expect(request.top_k).toBeLessThanOrEqual(schema.properties.top_k.maximum)
  })

  test("query follows the four-part team format", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()

    const synthesis = synthesizeProfile({
      background: bundle.background,
      selfAssessment: bundle.self_assessment,
      objectiveDiagnosis: bundle.objective_diagnosis,
      knowledgeBase: kb,
    })

    expect(synthesis.rag_request.query).toMatch(/^学习者水平：.+；已掌握：.+；薄弱点：.+；学习目标：.+$/)
    expect(synthesis.rag_request.top_k).toBe(DEFAULT_TOP_K)

    // 空数组退化为 "无"，四段结构不塌
    const emptyQuery = buildRagQuery({
      learner_id: "x",
      level: "beginner",
      known_concepts: [],
      weak_concepts: [],
      goal: "学点 Python",
    })
    expect(emptyQuery).toBe("学习者水平：beginner；已掌握：无；薄弱点：无；学习目标：学点 Python")
  })

  test("acceptance: synthesized profile retrieves K007/K009/K018 (docx §6 B 验收标准)", async () => {
    const bundle = await loadFixture()
    const kb = await loadKnowledgeBase()

    const synthesis = synthesizeProfile({
      background: bundle.background,
      selfAssessment: bundle.self_assessment,
      objectiveDiagnosis: bundle.objective_diagnosis,
      knowledgeBase: kb,
    })
    const { rag_result } = await executeProfileRetrieval(synthesis.profile)

    const ids = rag_result.results.map((item) => item.source_id)
    expect(ids).toContain("K007")
    expect(ids).toContain("K009")
    expect(ids).toContain("K018")
  })

  test("buildRagRequest embeds the same profile object it was given", async () => {
    const profile = {
      learner_id: "t1",
      level: "beginner" as const,
      known_concepts: ["变量"],
      weak_concepts: ["循环"],
      goal: "学会循环",
    }
    const request = buildRagRequest(profile)
    expect(request.learner_profile).toBe(profile)
  })
})

describe("role-B worker prompt contract", () => {
  test("all four B prompts are real implementations, not wiring stubs", () => {
    for (const definition of WORKER_DEFINITIONS.filter((worker) =>
      (ROLE_B_WORKER_NAMES as readonly string[]).includes(worker.name),
    )) {
      const prompt = buildRoleBWorkerPrompt(definition)

      expect(prompt).not.toContain("This is a wiring stub")
      expect(prompt).toContain(`[executed:${definition.name}]`) // orchestrator 协议标记必须保留
      expect(prompt).toContain("quotes") // 引文接地
      expect(prompt).toContain("null") // 无证据置空，禁止编造
      expect(prompt).toContain(definition.stage)
    }
  })

  test("profile-builder prompt embeds the merge rules and the team query format", () => {
    const definition = WORKER_DEFINITIONS.find((worker) => worker.name === "profile-builder")
    if (!definition) throw new Error("profile-builder definition missing")
    const prompt = buildRoleBWorkerPrompt(definition)

    expect(prompt).toContain("objective > self > background")
    expect(prompt).toContain("学习者水平：")
    expect(prompt).toContain("top_k")
    expect(prompt).toContain("conflicts")
    expect(prompt).toContain("question tool") // goal 缺失走补问，不编造
  })

  test("objective-diagnostician prompt forbids invented questions and grades", () => {
    const definition = WORKER_DEFINITIONS.find((worker) => worker.name === "objective-diagnostician")
    if (!definition) throw new Error("objective-diagnostician definition missing")
    const prompt = buildRoleBWorkerPrompt(definition)

    expect(prompt).toContain("source_id")
    expect(prompt).toContain("unanswered")
    expect(prompt).toContain("Never invent")
  })
})

describe("role-B profile demo", () => {
  test("demo script runs end-to-end and emits unified IO contract handoff JSON", async () => {
    const proc = Bun.spawn(["bun", "src/role-b-profile/profile-demo.ts"], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(stderr).toBe("")
    expect(exitCode).toBe(0)

    const output = JSON.parse(stdout)

    // 统一契约格式验证
    expect(output.boundary).toBe("A_RAG_RESULT_TO_C_CONTENT")
    expect(output.schemaVersion).toBe("1.0")
    expect(output.handoff.profile.learnerId).toBe("demo_loop_weak_001")
    expect(output.handoff.conflicts.length).toBeGreaterThan(0)
    expect(output.handoff.retrieval.items.length).toBeGreaterThanOrEqual(3)

    // 验证冲突字段已对齐 camelCase（统一契约规范）
    const conflict = output.handoff.conflicts[0]
    expect(conflict).toHaveProperty("selfClaim")
    expect(conflict).toHaveProperty("objectiveVerdict")
  })

  test("demo script --raw emits legacy B→A handoff JSON for backward compatibility", async () => {
    const proc = Bun.spawn(["bun", "src/role-b-profile/profile-demo.ts", "--raw"], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(stderr).toBe("")
    expect(exitCode).toBe(0)

    const output = JSON.parse(stdout)
    expect(output.workflow).toBe("B_evidence_to_profile_to_A_rag")
    expect(output.b_profile.learner_id).toBe("demo_loop_weak_001")
    expect(output.b_provenance.conflicts.length).toBeGreaterThan(0)
    expect(output.a_rag_result_top.length).toBeGreaterThanOrEqual(3)
  })
})
