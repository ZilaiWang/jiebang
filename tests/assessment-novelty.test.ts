import { describe, expect, test } from "bun:test"
import {
  assessmentFactIdsForItem,
  validateAssessmentNovelty,
} from "../src/role-c-content/providers/staged-generation"

const history = [{
  form_id: "FORM-OLD",
  item_id: "ITEM-OLD",
  objective_id: "O1",
  modality: "mcq" as const,
  prompt: "for 循环会按什么顺序遍历列表？",
  options: ["按索引顺序", "随机顺序"],
}]

function assessmentItem(prompt: string, options: string[]) {
  return {
    item_id: "ITEM-NEW",
    display_no: 1,
    family_id: "FAMILY-NEW",
    variant_id: "VARIANT-NEW",
    objective_id: "O1",
    tier: 1 as const,
    modality: "mcq" as const,
    max_score: 1,
    prompt,
    options: options.map((text, index) => ({ option_id: `OPTION-${index}`, label: "AB"[index]!, text })),
    citations: [],
  }
}

describe("AI assessment novelty", () => {
  test("按题层级分配最小事实面，不让每题都复述全部事实", () => {
    const facts = ["F001", "F002", "F003"]
    expect(assessmentFactIdsForItem(facts, 1, 0)).toEqual(["F001"])
    expect(assessmentFactIdsForItem(facts, 1, 1)).toEqual(["F002"])
    expect(assessmentFactIdsForItem(facts, 2, 2)).toEqual(["F003", "F001"])
    expect(assessmentFactIdsForItem(facts, 3, 4)).toEqual(facts)
  })

  test("具体 API 命题会闭合到同目标中的参数规则事实", () => {
    const facts = ["F001", "F002", "F003"]
    const evidence = [
      { fact_id: "F001", content: "range 可生成整数序列配合 for 重复执行固定次数。", capabilities: ["procedure", "state_transition"] },
      { fact_id: "F002", content: "for 循环常用于遍历序列中的元素。", capabilities: ["rule"] },
      { fact_id: "F003", content: "range 不包含结束值，range(3) 生成 0、1、2。", capabilities: ["rule", "state_transition", "example"] },
    ]

    expect(assessmentFactIdsForItem(facts, 1, 2, evidence, "recognize_fact"))
      .toEqual(["F001", "F003"])
  })

  test("rejects an already published question even after cosmetic reformatting", () => {
    const issues = validateAssessmentNovelty({
      items: [assessmentItem("FOR 循环会按什么顺序遍历列表?", ["随机顺序", "按索引顺序"])],
    }, history)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain("FORM-OLD:ITEM-OLD")
  })

  test("allows a new but related question on the same objective", () => {
    const issues = validateAssessmentNovelty({
      items: [assessmentItem("给定 names = ['A', 'B']，下列哪段代码会依次取出两个元素？", ["for name in names", "for names in name"])],
    }, history)
    expect(issues).toEqual([])
  })

  test("同一权威事实可作为不同任务的选项，近重复只比较学习者要完成的题干", () => {
    const first = assessmentItem(
      "请选择完整描述变量赋值规则的一项。",
      ["Python 使用 = 进行变量赋值。", "Python 不使用 = 进行变量赋值。"],
    )
    const second = {
      ...assessmentItem(
        "阅读一段程序设计说明，判断其中关于赋值符号与变量关系的表述是否符合本节规则。",
        ["Python 使用 = 进行变量赋值。", "Python 不使用 = 进行变量赋值。"],
      ),
      item_id: "ITEM-SECOND",
      display_no: 2,
    }
    expect(validateAssessmentNovelty({ items: [first, second] }, [])).toEqual([])
  })

  test("does not allow an objective-id change to disguise the same question", () => {
    const item = assessmentItem(" for 循环会按什么顺序遍历列表?", ["按索引顺序", "随机顺序"])
    item.objective_id = "O-REPLANNED"
    expect(validateAssessmentNovelty({ items: [item] }, history)).toHaveLength(1)
  })

  test("does not treat changed distractors as a new question", () => {
    const issues = validateAssessmentNovelty({
      items: [assessmentItem("for 循环会按什么顺序遍历列表？", ["从末尾开始", "由解释器随机决定"])],
    }, history)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain("FORM-OLD:ITEM-OLD")
  })

  test("checks the complete history rather than only the latest 200 items", () => {
    const longHistory = [
      ...history,
      ...Array.from({ length: 205 }, (_, index) => ({
        form_id: `FORM-${index}`,
        item_id: `ITEM-${index}`,
        objective_id: "O1",
        modality: "mcq" as const,
        prompt: `第 ${index} 道不同的循环题`,
        options: ["选项一", "选项二"],
      })),
    ]
    const issues = validateAssessmentNovelty({
      items: [assessmentItem("for 循环会按什么顺序遍历列表？", ["新干扰项一", "新干扰项二"])],
    }, longHistory)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain("FORM-OLD:ITEM-OLD")
  })
})

describe("novelty 结构级去重：observation_key 分组 + 最近窗口", () => {
  const META = { operation: "traverse", reasoning_pattern: "single_step", representation: "code", context_family: "list", answer_form: "mcq" }

  function itemWithMeta(objectiveId: string, prompt: string, meta = META, observationKey = objectiveId) {
    return {
      item_id: `ITEM-${objectiveId}-${prompt.length}`, display_no: 1, family_id: "F", variant_id: "V",
      objective_id: objectiveId, observation_key: observationKey, tier: 1 as const, modality: "mcq" as const, max_score: 1,
      prompt, options: [{ option_id: "a", label: "A", text: "x" }, { option_id: "b", label: "B", text: "y" }],
      citations: [], structure_meta: meta,
    }
  }
  function histItem(formId: string, itemId: string, objectiveId: string, prompt: string, meta?: typeof META, observationKey = objectiveId) {
    return {
      form_id: formId, item_id: itemId, objective_id: objectiveId, observation_key: observationKey,
      modality: "mcq" as const, prompt, options: ["x", "y"], structure_meta: meta ?? META,
    }
  }

  test("跨 observation_key 的结构复用不再 hard（列表→循环共享题型结构）", () => {
    const history = [
      histItem("FORM-LIST", "I1", "O-LIST", "列表怎么遍历？"),
    ]
    // 新题 objective 不同（O-LOOP），但结构完全相同 → 允许（纵向复测）
    const issues = validateAssessmentNovelty({
      items: [itemWithMeta("O-LOOP", "for 循环如何遍历一个可迭代对象？")],
    }, history)
    expect(issues).toEqual([])
  })

  test("旧历史没有 structure_meta 时也按 observation_key 隔离结构约束", () => {
    const history = [{
      form_id: "FORM-LEGACY", item_id: "I1", objective_id: "O-LIST", observation_key: "OBS-LIST",
      modality: "mcq" as const, prompt: "遍历列表 1 输出元素", options: ["x", "y"],
    }]
    const issues = validateAssessmentNovelty({
      items: [{ ...itemWithMeta("O-LOOP", "遍历列表 2 输出元素", META, "OBS-LOOP"), structure_meta: undefined }],
    }, history)
    expect(issues).toEqual([])
  })

  test("同 observation_key 最近窗口内结构重复仍 hard", () => {
    const history = [
      histItem("FORM-1", "I1", "O1", "for 循环怎么遍历列表？"),
    ]
    const issues = validateAssessmentNovelty({
      items: [itemWithMeta("O1", "请写出 for 遍历 scores 列表的代码")],
    }, history)
    expect(issues.length).toBeGreaterThan(0)
  })

  test("路径重规划改变 objective_id 后，同一 observation_key 仍保持结构去重", () => {
    const history = [
      histItem("FORM-1", "I1", "O-OLD", "for 循环怎么遍历列表？", META, "OBS-K007-APPLY"),
    ]
    const issues = validateAssessmentNovelty({
      items: [itemWithMeta("O-NEW", "请写出 for 遍历 scores 列表的代码", META, "OBS-K007-APPLY")],
    }, history)
    expect(issues.length).toBeGreaterThan(0)
  })

  test("同 observation_key 超出最近窗口的历史结构不再 hard（纵向复测）", () => {
    // O1 的最近 5 条都是"不同结构"，第 6 条（最早）才是 META 结构
    const history = [
      histItem("FORM-OLD", "I-OLD", "O1", "最早的结构重复题"), // 第 1 条，超出窗口
      histItem("FORM-A", "I-A", "O1", "变式A", { ...META, operation: "filter" }),
      histItem("FORM-B", "I-B", "O1", "变式B", { ...META, operation: "aggregate" }),
      histItem("FORM-C", "I-C", "O1", "变式C", { ...META, operation: "map" }),
      histItem("FORM-D", "I-D", "O1", "变式D", { ...META, operation: "reduce" }),
      histItem("FORM-E", "I-E", "O1", "变式E", { ...META, operation: "sort" }),
    ]
    // 新题用 META 结构（traverse），但 traverse 只在窗口外的最早历史出现过 → 允许
    const issues = validateAssessmentNovelty({
      items: [itemWithMeta("O1", "for 循环遍历列表，输出每个元素")],
    }, history)
    expect(issues).toEqual([])
  })

  test("exact 题干重复仍永久 hard（不受窗口/observation 影响）", () => {
    const history = [
      { form_id: "FORM-1", item_id: "I1", objective_id: "O-OLD", observation_key: "O-OLD", modality: "mcq" as const, prompt: "for 循环会按什么顺序遍历列表？", options: ["a", "b"] },
    ]
    const issues = validateAssessmentNovelty({
      items: [itemWithMeta("O-NEW", "for 循环会按什么顺序遍历列表？")],
    }, history)
    expect(issues.length).toBeGreaterThan(0)
  })

  test("同一张卷内即使 observation 不同，也不允许相同结构元数据重复", () => {
    const issues = validateAssessmentNovelty({
      items: [
        itemWithMeta("O1", "题目甲", META, "OBS-1"),
        { ...itemWithMeta("O2", "题目乙", META, "OBS-2"), display_no: 2, item_id: "ITEM-2" },
      ],
    }, [])
    expect(issues.some((issue) => issue.includes("本卷") && issue.includes("任务结构重复"))).toBe(true)
  })

  test("不信任模型自报的不同 structure_meta，拦截同卷仅改写措辞的题", () => {
    const first = itemWithMeta(
      "O1",
      "阅读以下关于 Python 的描述：①Python 是一种通用编程语言；②Python 程序通常由解释器执行；③Python 适合编写脚本、数据处理和教学示例。以上描述中，有几条与已知事实相符？",
      {
        operation: "recognize_fact", reasoning_pattern: "multi_statement_validation",
        representation: "enumerated_claims", context_family: "neutral_context", answer_form: "count_selection",
      },
      "OBS-K001",
    )
    const second = {
      ...itemWithMeta(
        "O1",
        "阅读以下关于 Python 的三条描述：① Python 是一种通用编程语言。② Python 程序通常由解释器执行。③ Python 适合编写脚本、数据处理和教学示例。请问以上描述中有几条与事实相符？",
        {
          operation: "recognize_fact", reasoning_pattern: "multi_statement_validation",
          representation: "enumerated_statements", context_family: "neutral_language_description", answer_form: "single_choice_count",
        },
        "OBS-K001",
      ),
      item_id: "ITEM-SECOND",
      display_no: 2,
    }
    const issues = validateAssessmentNovelty({ items: [first, second] }, [])
    expect(issues.some((issue) => issue.includes("items[1]") && issue.includes("语义结构近乎重复"))).toBe(true)
  })
})
