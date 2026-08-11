import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { contentHash } from "../role-c-content/contracts/common"
import type { KnowledgeBase, KnowledgeFact, KnowledgeItem } from "../knowledge/types"
import { analyzeQuestionBankQuality, writeQuestionBankQualityReport } from "./quality"
import type { QuestionBank, QuestionBankAuditReport, QuestionBankItem, WrittenQuestionBankArtifacts } from "./types"

export type { QuestionBank, QuestionBankItem, WrittenQuestionBankArtifacts } from "./types"

const GENERATED_AT = "2026-08-05T00:00:00.000Z"

export function generateQuestionBank(knowledgeBase: KnowledgeBase): QuestionBank {
  const items = knowledgeBase.items.flatMap((knowledgeItem) => generateQuestionsForItem(knowledgeItem))
  const bankWithoutId = {
    schema_version: "question-bank.v1" as const,
    kb_version: knowledgeBase.version,
    generated_at: GENERATED_AT,
    generator: "deterministic-template-v1" as const,
    policy: {
      questions_per_source: 4 as const,
      source_fact_binding_required: true as const,
      answer_explanation_required: true as const,
      role_a_audit_required: true as const,
    },
    summary: summarize(items),
    items,
  }

  return {
    ...bankWithoutId,
    bank_id: contentHash({ kb_version: knowledgeBase.version, item_ids: items.map((item) => item.question_id) }),
  }
}

function generateQuestionsForItem(item: KnowledgeItem): QuestionBankItem[] {
  const facts = firstFacts(item)
  return [
    buildChoiceQuestion(item, facts[0], 1),
    buildShortAnswerQuestion(item, facts[1], 2),
    buildDebuggingQuestion(item, facts[2], 3),
    buildPracticeQuestion(item, facts[0], 4),
  ]
}

function buildChoiceQuestion(item: KnowledgeItem, fact: KnowledgeFact, index: number): QuestionBankItem {
  const answer = fact.content
  const variant = variantFor(item, "choice")
  return baseQuestion(item, fact, index, {
    level: 1,
    purpose: "diagnostic",
    type: "choice",
    question: choicePrompt(item, fact, variant),
    options: uniqueOptions([
      answer,
      `${item.title} 不需要任何事实依据即可判断。`,
      `${item.title} 只适用于界面展示，与课程训练无关。`,
      `${item.title} 的答案可以脱离 source_id/fact_id 随机生成。`,
    ]),
    answer,
    explanation: `依据 ${item.sourceId}:${fact.factId}，${fact.content}`,
    grading_method: "exact_match",
    template_variant: variant,
    rubric: ["选择项必须与引用事实一致", "不能选择无证据或泛化过度的选项"],
    misconception_tags: ["概念混淆", "无证据作答"],
  })
}

function buildShortAnswerQuestion(item: KnowledgeItem, fact: KnowledgeFact, index: number): QuestionBankItem {
  const variant = variantFor(item, "short")
  return baseQuestion(item, fact, index, {
    level: 2,
    purpose: "training",
    type: "short_answer",
    question: shortAnswerPrompt(item, fact, variant),
    answer: fact.content,
    explanation: `标准回答必须覆盖 ${item.sourceId}:${fact.factId}：${fact.content}`,
    grading_method: "rubric",
    template_variant: variant,
    rubric: ["回答包含核心事实", "表达清楚", "不添加未引用的外部知识"],
    misconception_tags: ["遗漏关键事实", "外部扩写"],
  })
}

function buildDebuggingQuestion(item: KnowledgeItem, fact: KnowledgeFact, index: number): QuestionBankItem {
  const variant = variantFor(item, "debug")
  return baseQuestion(item, fact, index, {
    level: 2,
    purpose: "training",
    type: "debugging",
    question: debuggingPrompt(item, fact, variant),
    answer: `该说法错误。正确依据是：${fact.content}`,
    explanation: `纠错依据 ${item.sourceId}:${fact.factId}，应回到可引用事实：${fact.content}`,
    grading_method: "rubric",
    template_variant: variant,
    rubric: ["指出原说法错误", "写出被引用事实", "不引入未审核知识"],
    misconception_tags: ["误区纠正", "证据缺失"],
  })
}

function buildPracticeQuestion(item: KnowledgeItem, fact: KnowledgeFact, index: number): QuestionBankItem {
  const concrete = concretePracticeFor(item.sourceId)
  const task = item.practiceTasks[0] ?? `围绕 ${item.title} 完成一个小练习`
  const variant = variantFor(item, "practice")
  const isPythonPractice = item.sourceId.startsWith("K") || item.sourceId.startsWith("PY")
  return baseQuestion(item, fact, index, {
    level: item.difficulty === "integrated" ? 3 : 2,
    purpose: "exam",
    type: "practice",
    question: concrete?.question ?? practicePrompt(item, fact, task, variant),
    answer: concrete?.answer ?? `答案要点：完成任务“${task}”，并体现 ${fact.content}`,
    explanation: `评分依据绑定 ${item.sourceId}:${fact.factId}：${fact.content}`,
    grading_method: isPythonPractice ? "unit_test" : "rubric",
    template_variant: variant,
    ...(isPythonPractice ? {
      starter_code: concrete?.starter_code ?? buildStarterCode(item),
      test_cases: concrete?.test_cases ?? buildPythonTestCases(item),
    } : {}),
    rubric: ["完成题目任务", "体现引用事实", "步骤可复核", "不编造知识库外事实"],
    misconception_tags: ["实践迁移", "事实引用"],
  })
}

function concretePracticeFor(sourceId: string): Pick<QuestionBankItem, "question" | "answer" | "starter_code" | "test_cases"> | undefined {
  const specs: Record<string, Pick<QuestionBankItem, "question" | "answer" | "starter_code" | "test_cases">> = {
    PY041: {
      question: "给定 records = ['小明,92', '小红,', '小明,92']，实现 clean_records(records)：去掉缺失成绩记录和重复记录，返回清洗后的列表。数据清洗用于提高后续分析数据的可用性。",
      answer: "实现 clean_records，保留非空且不重复的 姓名,成绩 记录；体现数据清洗用于提高后续分析数据的可用性。",
      starter_code: "def clean_records(records):\n    # TODO: 去掉缺失成绩和重复记录\n    cleaned = []\n    return cleaned",
      test_cases: [
        { input: { records: ["小明,92", "小红,", "小明,92"] }, expected: ["小明,92"], hidden: false },
        { input: { records: ["A,80", "B,90", "A,80"] }, expected: ["A,80", "B,90"], hidden: false },
        { input: { records: ["A,", "C,70", "", "C,70"] }, expected: ["C,70"], hidden: true },
      ],
    },
    PY042: {
      question: "实现 add_score(scores, name, score) 和 get_score(scores, name)：向成绩字典写入学生成绩，并在查询不存在学生时返回 '未找到'。成绩管理项目可综合练习字典、列表、函数和文件处理。",
      answer: "用字典保存和查询成绩，add_score 修改 scores，get_score 安全返回成绩或 '未找到'；体现成绩管理项目可综合练习字典、列表、函数和文件处理。",
      starter_code: "def add_score(scores, name, score):\n    # TODO: 写入学生成绩\n    return scores\n\ndef get_score(scores, name):\n    # TODO: 查询学生成绩，不存在返回 '未找到'\n    return None",
      test_cases: [
        { input: { scores: { "小明": 92 }, name: "小红", score: 85, query: "小红" }, expected: 85, hidden: false },
        { input: { scores: {}, name: "A", score: 60, query: "B" }, expected: "未找到", hidden: false },
        { input: { scores: { "A": 70 }, name: "A", score: 88, query: "A" }, expected: 88, hidden: true },
      ],
    },
    PY043: {
      question: "实现 count_words(words)：给定分词后的列表，返回词频字典。词频统计用于计算词语在文本中出现的次数。",
      answer: "遍历 words 并用字典累计每个词出现次数；体现词频统计用于计算词语在文本中出现的次数。",
      starter_code: "def count_words(words):\n    # TODO: 返回词语到次数的映射\n    freq = {}\n    return freq",
      test_cases: [
        { input: { words: ["Python", "学习", "Python"] }, expected: { "Python": 2, "学习": 1 }, hidden: false },
        { input: { words: ["a", "b", "a", "c", "b"] }, expected: { a: 2, b: 2, c: 1 }, hidden: false },
        { input: { words: [] }, expected: {}, hidden: true },
      ],
    },
    PY044: {
      question: "实现 crawler_steps()：返回 ['请求网页', '解析内容', '保存结果']，用于说明简单爬虫流程。简单爬虫通常包含请求网页、解析内容和保存结果三个步骤。",
      answer: "返回请求网页、解析内容、保存结果三个阶段；体现简单爬虫通常包含请求网页、解析内容和保存结果三个步骤。",
      starter_code: "def crawler_steps():\n    # TODO: 返回简单爬虫的三个核心步骤\n    return []",
      test_cases: [
        { input: {}, expected: ["请求网页", "解析内容", "保存结果"], hidden: false },
        { input: { as_tuple: false }, expected: ["请求网页", "解析内容", "保存结果"], hidden: false },
        { input: { check_order: true }, expected: "请求网页>解析内容>保存结果", hidden: true },
      ],
    },
    PY045: {
      question: "定义 Student 类并实现 passed 方法；给定学生对象列表，返回及格学生姓名。面向对象综合练习通常先识别对象、属性和方法。",
      answer: "Student 保存 name 和 score，passed 判断 score >= 60，再筛选及格姓名；体现面向对象综合练习通常先识别对象、属性和方法。",
      starter_code: "class Student:\n    # TODO: 保存 name 和 score，并实现 passed 方法\n    pass\n\ndef passed_names(students):\n    # TODO: 返回及格学生姓名列表\n    return []",
      test_cases: [
        { input: { students: [["小明", 92], ["小红", 55]] }, expected: ["小明"], hidden: false },
        { input: { students: [["A", 60], ["B", 59]] }, expected: ["A"], hidden: false },
        { input: { students: [["A", 100], ["B", 60], ["C", 0]] }, expected: ["A", "B"], hidden: true },
      ],
    },
    PY046: {
      question: "实现 safe_read_text(path, reader)：当 reader(path) 抛出 FileNotFoundError 时返回 '文件不存在'，否则返回读取内容。文件操作可能遇到文件不存在等异常。",
      answer: "使用 try/except 捕获 FileNotFoundError 并返回友好提示；体现文件操作可能遇到文件不存在等异常。",
      starter_code: "def safe_read_text(path, reader):\n    # TODO: 捕获 FileNotFoundError 并返回友好提示\n    return reader(path)",
      test_cases: [
        { input: { path: "scores.txt", behavior: "content:hello" }, expected: "hello", hidden: false },
        { input: { path: "missing.txt", behavior: "FileNotFoundError" }, expected: "文件不存在", hidden: false },
        { input: { path: "empty.txt", behavior: "content:" }, expected: "", hidden: true },
      ],
    },
    PY047: {
      question: "实现 average(scores) 并说明 main 程序调用该工具函数的结果。模块化项目结构把入口程序和工具函数分开组织。",
      answer: "average 返回 sum(scores) / len(scores)，入口程序只组织流程和调用；体现模块化项目结构把入口程序和工具函数分开组织。",
      starter_code: "def average(scores):\n    # TODO: 返回平均值\n    return None\n\ndef main_result(scores):\n    # TODO: 调用 average\n    return None",
      test_cases: [
        { input: { scores: [80, 90, 70] }, expected: 80, hidden: false },
        { input: { scores: [100] }, expected: 100, hidden: false },
        { input: { scores: [1, 2] }, expected: 1.5, hidden: true },
      ],
    },
    PY048: {
      question: "实现 classify_exam_item(text)：包含“补全”返回 '程序填空'，包含“编写程序”返回 '编程题'，否则返回 '选择题'。Python 二级考试常见题型包括选择题、程序填空和编程题。",
      answer: "按题干关键词分类为选择题、程序填空或编程题；体现 Python 二级考试常见题型包括选择题、程序填空和编程题。",
      starter_code: "def classify_exam_item(text):\n    # TODO: 按关键词判断题型\n    return '选择题'",
      test_cases: [
        { input: { text: "请补全横线处代码" }, expected: "程序填空", hidden: false },
        { input: { text: "请编写程序统计成绩" }, expected: "编程题", hidden: false },
        { input: { text: "下列选项正确的是" }, expected: "选择题", hidden: true },
      ],
    },
    PY049: {
      question: "实现 split_test_cases(test_cases)：把含 hidden 标记的测试用例分成公开测试 public 和隐藏测试 hidden。编程题测试用例用于检查程序输出是否符合要求。",
      answer: "根据 hidden 字段拆分公开测试和隐藏测试；体现编程题测试用例用于检查程序输出是否符合要求。",
      starter_code: "def split_test_cases(test_cases):\n    # TODO: 返回 {'public': [...], 'hidden': [...]}\n    return {'public': [], 'hidden': []}",
      test_cases: [
        { input: { test_cases: [{ id: "P1", hidden: false }, { id: "H1", hidden: true }] }, expected: { public: ["P1"], hidden: ["H1"] }, hidden: false },
        { input: { test_cases: [{ id: "P1" }, { id: "P2", hidden: false }] }, expected: { public: ["P1", "P2"], hidden: [] }, hidden: false },
        { input: { test_cases: [{ id: "H1", hidden: true }, { id: "H2", hidden: true }] }, expected: { public: [], hidden: ["H1", "H2"] }, hidden: true },
      ],
    },
    PY050: {
      question: "实现 count_paper_sections(paper)：统计综合训练卷中 diagnostic、training、exam 三类题目数量。综合训练卷应覆盖多个知识点而不是只考单一概念。",
      answer: "返回 diagnostic、training、exam 三类题目数量；体现综合训练卷应覆盖多个知识点而不是只考单一概念。",
      starter_code: "def count_paper_sections(paper):\n    # TODO: 返回三类题目数量\n    return {'diagnostic': 0, 'training': 0, 'exam': 0}",
      test_cases: [
        { input: { paper: { diagnostic: ["Q1"], training: ["Q2", "Q3"], exam: ["Q4"] } }, expected: { diagnostic: 1, training: 2, exam: 1 }, hidden: false },
        { input: { paper: { diagnostic: [], training: [], exam: ["Q1"] } }, expected: { diagnostic: 0, training: 0, exam: 1 }, hidden: false },
        { input: { paper: { diagnostic: ["A", "B"], training: ["C"], exam: [] } }, expected: { diagnostic: 2, training: 1, exam: 0 }, hidden: true },
      ],
    },
  }
  return specs[sourceId]
}

function baseQuestion(
  item: KnowledgeItem,
  fact: KnowledgeFact,
  index: number,
  fields: Omit<QuestionBankItem, "question_id" | "source_id" | "fact_id" | "module" | "knowledge_title" | "difficulty">,
): QuestionBankItem {
  return {
    question_id: `${item.sourceId}-Q${String(index).padStart(2, "0")}`,
    source_id: item.sourceId,
    fact_id: fact.factId,
    module: item.module,
    knowledge_title: item.title,
    difficulty: item.difficulty,
    ...fields,
  }
}

function variantFor(item: KnowledgeItem, kind: "choice" | "short" | "debug" | "practice"): string {
  const family = item.sourceId.startsWith("AI") ? "ai" : "python"
  return `${family}-${kind}-${item.sourceId}`
}

function choicePrompt(item: KnowledgeItem, fact: KnowledgeFact, variant: string): string {
  const prompts = [
    `诊断题（${variant}）：学习“${item.title}”时，哪一项与事实“${fact.content}”一致？`,
    `课堂快速判断（${variant}）：围绕“${item.title}”，请选择被证据支持的说法：${fact.content}`,
    `入门检查（${variant}）：下列关于“${item.title}”的表述，哪一项准确复述了 ${item.sourceId}:${fact.factId}？${fact.content}`,
  ]
  return prompts[sourceOffset(item) % prompts.length]!
}

function shortAnswerPrompt(item: KnowledgeItem, fact: KnowledgeFact, variant: string): string {
  const prompts = [
    `解释题（${variant}）：结合“${item.title}”，用自己的话说明这条事实：${fact.content}`,
    `应用理解（${variant}）：如果学生正在学习“${item.title}”，请说明为什么要掌握：${fact.content}`,
    `证据复述（${variant}）：请根据 ${item.sourceId}:${fact.factId} 概括“${item.title}”的关键点：${fact.content}`,
  ]
  return prompts[sourceOffset(item) % prompts.length]!
}

function debuggingPrompt(item: KnowledgeItem, fact: KnowledgeFact, variant: string): string {
  const prompts = [
    `纠错题（${variant}）：有人说“${item.title} 可以不依据事实作答”。请根据事实 ${fact.content} 判断并纠正。`,
    `误区辨析（${variant}）：学生把“${item.title}”理解成无需证据的固定口号。请用事实 ${fact.content} 纠正。`,
    `审核题（${variant}）：下面说法缺少事实支撑：“${item.title} 的答案可以随意生成”。请引用 ${fact.content} 给出正确说法。`,
  ]
  return prompts[sourceOffset(item) % prompts.length]!
}

function practicePrompt(item: KnowledgeItem, fact: KnowledgeFact, task: string, variant: string): string {
  const prompts = [
    `实践题（${variant}）：完成“${task}”，并在答案中体现事实：${fact.content}`,
    `考试任务（${variant}）：围绕“${item.title}”完成一个可评分小任务：“${task}”。评分时检查是否体现 ${fact.content}`,
    `综合应用（${variant}）：请把“${item.title}”用于任务“${task}”，答案必须能回溯到事实 ${fact.content}`,
  ]
  return prompts[sourceOffset(item) % prompts.length]!
}

function buildStarterCode(item: KnowledgeItem): string {
  const functionName = `solve_${item.sourceId.toLowerCase()}`
  return [
    `def ${functionName}(value):`,
    `    """TODO: 完成与 ${item.title} 相关的可测试练习。"""`,
    "    # TODO: 根据题目要求补全实现",
    "    return value",
  ].join("\n")
}

function buildPythonTestCases(item: KnowledgeItem): Array<{ input: unknown; expected: unknown; hidden?: boolean }> {
  return [
    { input: { value: `${item.sourceId}-sample` }, expected: `${item.sourceId}-sample`, hidden: false },
    { input: { value: `${item.sourceId}-hidden` }, expected: `${item.sourceId}-hidden`, hidden: true },
  ]
}

function sourceOffset(item: KnowledgeItem): number {
  const digits = item.sourceId.match(/\d+/)?.[0] ?? "0"
  return Number.parseInt(digits, 10)
}

function firstFacts(item: KnowledgeItem): [KnowledgeFact, KnowledgeFact, KnowledgeFact] {
  if (item.facts.length < 3) {
    throw new Error(`Knowledge item ${item.sourceId} must provide at least 3 facts to generate question bank items.`)
  }
  return [item.facts[0]!, item.facts[1]!, item.facts[2]!]
}

function summarize(items: QuestionBankItem[]): QuestionBank["summary"] {
  return {
    total_questions: items.length,
    source_count: new Set(items.map((item) => item.source_id)).size,
    training_items: items.filter((item) => item.purpose === "training").length,
    exam_items: items.filter((item) => item.purpose === "exam").length,
    diagnostic_items: items.filter((item) => item.purpose === "diagnostic").length,
  }
}

function uniqueOptions(options: string[]): string[] {
  const unique = [...new Set(options)]
  while (unique.length < 4) unique.push(`干扰项 ${unique.length + 1}`)
  return unique.slice(0, 4)
}

export async function writeQuestionBankArtifacts(input: {
  bank: QuestionBank
  report: QuestionBankAuditReport
  outputDir?: string
}): Promise<WrittenQuestionBankArtifacts> {
  const outputDir = input.outputDir ?? "question_bank/generated"
  await mkdir(outputDir, { recursive: true })
  const bankPath = join(outputDir, "latest.json")
  const auditPath = join(outputDir, "latest.audit.json")
  const reportPath = join(outputDir, "latest.report.md")

  await Bun.write(bankPath, JSON.stringify(input.bank, null, 2))
  await Bun.write(auditPath, JSON.stringify(input.report, null, 2))
  await Bun.write(reportPath, renderQuestionBankAuditMarkdown(input.report))
  await writeQuestionBankQualityReport(analyzeQuestionBankQuality(input.bank), outputDir)

  return { bankPath, auditPath, reportPath }
}

export function renderQuestionBankAuditMarkdown(report: QuestionBankAuditReport): string {
  return [
    "# 题库生成与 Role A 审核报告",
    "",
    `- 题库 ID：${report.bank_id}`,
    `- 知识库版本：${report.kb_version}`,
    `- 总题量：${report.summary.total_questions}`,
    `- 引用覆盖率：${(report.summary.citation_coverage * 100).toFixed(1)}%`,
    `- Role A 审核通过率：${(report.summary.audit_pass_rate * 100).toFixed(1)}%`,
    `- Unsupported items：${report.summary.unsupported_items}`,
    `- 状态统计：pass=${report.summary.audit_status_counts.pass}, revise=${report.summary.audit_status_counts.revise}, reject=${report.summary.audit_status_counts.reject}`,
    "",
    "## 前 10 道题审核状态",
    "",
    "| question_id | source_id | fact_id | status |",
    "|---|---|---|---|",
    ...report.items.slice(0, 10).map((item) => `| ${item.question_id} | ${item.source_id} | ${item.fact_id} | ${item.audit.status} |`),
    "",
  ].join("\n")
}
