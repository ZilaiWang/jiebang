import type {
  KnowledgeBase,
  KnowledgeItem,
  KnowledgeMisconception,
  KnowledgeWorkedExample,
  ObservableObjective,
  PracticeTemplate,
} from "./types"

interface TeachingEvidenceSpec {
  coreFactIds: string[]
  exampleFactIds: string[][]
  objective: Omit<ObservableObjective, "objectiveId">
  misconception: Omit<KnowledgeMisconception, "misconceptionId" | "factRefs"> & { factIds: string[] }
  workedExample: Omit<KnowledgeWorkedExample, "fadingLevel">
  practice: Omit<PracticeTemplate, "templateId">
  practiceTasks: string[]
  quizPatches?: Record<number, { question?: string; answer?: string }>
  exampleCodePatches?: Record<number, string>
}

/**
 * Reviewed teaching evidence for the K001-K018 competition curriculum.
 *
 * Every example and teaching unit declares its source-local fact closure. The
 * loader may normalize this data, but it must never infer these relationships
 * from array position or from generated prose.
 */
const AUTHORED_TEACHING_EVIDENCE: Record<string, TeachingEvidenceSpec> = {
  K001: {
    coreFactIds: ["F001", "F002", "F004"],
    exampleFactIds: [["F001", "F002"], ["F002", "F003"]],
    objective: { behavior: "explain", description: "区分 Python 的用途、执行方式和代码块表达方式。", factIds: ["F001", "F002", "F004"] },
    misconception: {
      incorrectBelief: "Python 程序必须先编译成独立可执行文件才能运行。",
      diagnosticSignals: ["把解释器执行说成必须预编译"],
      counterexample: "在交互式环境输入 print(\"Hello\") 后，解释器会立即执行并显示结果。",
      correctionStrategy: "对照解释器执行和 REPL 逐行试验两个特征说明运行过程。",
      distractorTemplates: ["Python 只能在编译后运行"],
      factIds: ["F002", "F011"],
    },
    workedExample: {
      title: "从代码到可见输出",
      problem: "运行一个三行 Python 程序，并说明解释器按什么顺序产生输出。",
      steps: [
        { action: "创建 hello.py，写入三条 print 语句。", rationale: "Python 代码文件通常使用 .py 扩展名。", factIds: ["F010"] },
        { action: "使用 Python 解释器运行 hello.py。", rationale: "程序由解释器执行，无需先生成独立可执行文件。", factIds: ["F002", "F008"] },
        { action: "核对终端依次显示三行文本。", rationale: "脚本适合表达顺序明确的小型自动化任务。", factIds: ["F003"] },
      ],
      boundaryCases: ["交互式环境适合逐行试验；保存为 .py 文件适合重复运行完整程序。"],
    },
    practice: { prompt: "编写并运行一个三行自我介绍程序；验收时终端应按代码顺序输出三行文本。", cognitiveDemand: "apply", factIds: ["F002", "F003", "F010"] },
    practiceTasks: [
      "编写并运行一个包含三条 print 语句的程序，提交按顺序出现的三行输出结果。",
      "在交互式环境运行 print(\"Hello, Python\")，记录解释器立即返回的输出结果。",
    ],
    quizPatches: {
      0: { answer: "Python 是一种可用于脚本、数据处理等任务的通用编程语言。" },
      1: { question: "编写两条 print 语句并说明运行后会看到什么输出。", answer: "解释器按语句顺序执行，屏幕依次显示两行文本。" },
    },
    exampleCodePatches: { 0: "print(\"Python 是一种通用编程语言\")" },
  },
  K002: {
    coreFactIds: ["F001", "F002", "F003"],
    exampleFactIds: [["F001", "F003"], ["F010", "F011"]],
    objective: { behavior: "apply", description: "创建、读取并更新变量，解释重新赋值后的绑定变化。", factIds: ["F001", "F002", "F003"] },
    misconception: {
      incorrectBelief: "执行 x = x + 1 会同时保留 x 的旧值和新值。",
      diagnosticSignals: ["更新后仍把 x 当成旧值"],
      counterexample: "x = 2; x = x + 1; print(x) 只输出 3。",
      correctionStrategy: "先计算右侧表达式，再把结果重新绑定给左侧变量。",
      distractorTemplates: ["重新赋值不会覆盖旧绑定"],
      factIds: ["F001", "F003"],
    },
    workedExample: {
      title: "跟踪变量更新",
      problem: "预测 age = 18; age = age + 1 的最终输出。",
      steps: [
        { action: "执行 age = 18。", rationale: "赋值把整数对象绑定到变量名 age。", factIds: ["F001", "F002"] },
        { action: "计算 age + 1 得到 19。", rationale: "右侧表达式读取变量当前引用的数据。", factIds: ["F002"] },
        { action: "把 19 重新赋给 age 并输出。", rationale: "新值覆盖变量的旧绑定。", factIds: ["F003"] },
      ],
      boundaryCases: ["使用尚未赋值的变量会触发 NameError。"],
    },
    practice: { prompt: "定义两个变量，交换它们的值并输出；验收输出必须与交换前顺序相反。", cognitiveDemand: "apply", factIds: ["F001", "F002", "F010"] },
    practiceTasks: [
      "编写程序定义 name 和 age 两个变量并输出，验收结果应同时包含姓名文本和年龄数字。",
      "编写程序用 a, b = b, a 交换两个变量，输出交换前后两组结果供核对。",
    ],
    quizPatches: { 1: { question: "编写代码把变量 count 从 4 更新为 5，并写出最终输出。", answer: "count = 4; count = count + 1; print(count)，输出 5。" } },
  },
  K003: {
    coreFactIds: ["F001", "F002", "F003", "F004"],
    exampleFactIds: [["F001", "F002", "F003", "F004"], ["F001", "F002", "F005"]],
    objective: { behavior: "apply", description: "识别常见数据类型，并在字符串与数值之间进行明确转换。", factIds: ["F005", "F001"] },
    misconception: {
      incorrectBelief: "字符串 \"3\" 可以不经转换直接与整数 2 相加。",
      diagnosticSignals: ["混淆文本和数值的运算规则"],
      counterexample: "int(\"3\") + 2 返回 5，而 \"3\" + 2 会发生类型错误。",
      correctionStrategy: "先用 type() 检查数据，再用 int()、float() 或 str() 做目标明确的转换。",
      distractorTemplates: ["引号中的数字天然就是整数"],
      factIds: ["F001", "F002", "F004", "F005"],
    },
    workedExample: {
      title: "读取并转换数字文本",
      problem: "把文本 \"95\" 转成可参与加法的数值，并验证类型。",
      steps: [
        { action: "令 raw = \"95\" 并输出 type(raw)。", rationale: "引号包围的数据是字符串。", factIds: ["F002", "F004"] },
        { action: "执行 score = int(raw)。", rationale: "int() 可把有效整数字符串转换为整数。", factIds: ["F005"] },
        { action: "输出 score + 5 和 type(score)。", rationale: "转换后的整数可以参加算术运算。", factIds: ["F001", "F004"] },
      ],
      boundaryCases: ["int(\"3.5\") 不是有效的整数转换；小数字符串应使用 float()。"],
    },
    practice: { prompt: "创建 int、float、str、bool 四个值，用 type() 输出每个类型；验收应出现四种对应类型。", cognitiveDemand: "apply", factIds: ["F001", "F002", "F003", "F004"] },
    practiceTasks: [
      "编写程序分别创建 3、3.0、\"3\"、True，并输出四个值的 type() 结果。",
      "编写程序把字符串 \"12\" 转成整数后加 8，输出数值结果 20。",
    ],
    quizPatches: { 1: { question: "把字符串 \"42\" 转为整数并加 1，写出代码与输出。", answer: "print(int(\"42\") + 1)，输出 43。" } },
  },
  K004: {
    coreFactIds: ["F001", "F002", "F003", "F008"],
    exampleFactIds: [["F001", "F002"], ["F001", "F002", "F003"]],
    objective: { behavior: "apply", description: "读取字符串输入、按需要转换类型，并输出格式明确的结果。", factIds: ["F002", "F003", "F008"] },
    misconception: {
      incorrectBelief: "input() 读取数字时会自动返回 int。",
      diagnosticSignals: ["直接把 input() 结果用于数值加法"],
      counterexample: "输入 2 时，type(input()) 仍是 str；int(input()) 才得到整数。",
      correctionStrategy: "把读取、类型转换、计算和输出拆成四步检查。",
      distractorTemplates: ["input() 会根据字符内容自动推断类型"],
      factIds: ["F002", "F003"] },
    workedExample: {
      title: "输入两个数字并求和",
      problem: "读取两个整数并输出它们的和。",
      steps: [
        { action: "分别调用 input() 读取两个值。", rationale: "input() 负责等待并读取用户输入。", factIds: ["F002", "F007"] },
        { action: "用 int() 转换两个输入。", rationale: "input() 返回字符串，数值运算前必须转换。", factIds: ["F002", "F003"] },
        { action: "相加后用 f-string 输出结果。", rationale: "print() 显示结果，f-string 可嵌入变量。", factIds: ["F001", "F008"] },
      ],
      boundaryCases: ["输入非整数字符串时 int() 会失败，应在学习异常处理后补充校验。"],
    },
    practice: { prompt: "读取姓名和年龄并输出一句完整介绍；验收输出必须同时包含原姓名与转换后的年龄。", cognitiveDemand: "apply", factIds: ["F001", "F002", "F003", "F008"] },
    practiceTasks: [
      "编写程序读取两个整数并输出它们的乘积，使用样例输入 3 和 4 时应输出 12。",
      "编写程序读取姓名和年龄，用 f-string 输出一行包含两项输入的自我介绍。",
    ],
  },
  K005: {
    coreFactIds: ["F001", "F002", "F003", "F005"],
    exampleFactIds: [["F001"], ["F002", "F003"]],
    objective: { behavior: "apply", description: "选择算术、比较和逻辑运算符构造可验证的表达式。", factIds: ["F001", "F002", "F003"] },
    misconception: {
      incorrectBelief: "= 和 == 都用于判断两个值是否相等。",
      diagnosticSignals: ["在条件表达式中写单个等号"],
      counterexample: "score = 60 完成赋值；score == 60 才返回布尔判断结果。",
      correctionStrategy: "先判断语句意图是建立绑定还是比较值，再选择 = 或 ==。",
      distractorTemplates: ["单等号可以放在 if 条件里比较相等"],
      factIds: ["F002", "F006", "F008"] },
    workedExample: {
      title: "组合及格条件",
      problem: "判断分数是否位于 60 到 100 之间。",
      steps: [
        { action: "写出 score >= 60。", rationale: "比较运算返回布尔值。", factIds: ["F002", "F006"] },
        { action: "写出 score <= 100。", rationale: "第二个比较限制合法上界。", factIds: ["F002", "F006"] },
        { action: "使用 and 连接两个条件并输出结果。", rationale: "and 要求两个条件同时成立。", factIds: ["F003"] },
      ],
      boundaryCases: ["边界值 60 和 100 因使用 >=、<= 而被包含。"],
    },
    practice: { prompt: "编写表达式判断整数是否为 3 的倍数且为正数；验收时输入 6 为 True、-3 为 False。", cognitiveDemand: "apply", factIds: ["F002", "F003", "F005"] },
    practiceTasks: [
      "编写程序计算 (85 + 92) / 2 并输出结果，验收输出应为 88.5。",
      "编写条件表达式判断年份能被 4 整除且不能被 100 整除，输出布尔结果。",
    ],
  },
  K006: {
    coreFactIds: ["F001", "F002", "F003", "F007"],
    exampleFactIds: [["F001", "F003", "F004"], ["F001", "F002", "F003", "F007"]],
    objective: { behavior: "trace", description: "按顺序追踪 if/elif/else 并确定唯一执行的分支。", factIds: ["F001", "F002", "F007"] },
    misconception: {
      incorrectBelief: "if/elif/else 中所有为真的条件都会执行。",
      diagnosticSignals: ["预测多个互斥分支同时输出"],
      counterexample: "分数 95 同时满足 >=60 和 >=90，但按顺序只执行第一个为真的分支。",
      correctionStrategy: "从上到下标记每个条件，并在第一个 True 处停止。",
      distractorTemplates: ["每个 True 分支都执行"],
      factIds: ["F002", "F003", "F007"] },
    workedExample: {
      title: "追踪成绩等级分支",
      problem: "给定 score = 85，判断多分支程序输出哪个等级。",
      steps: [
        { action: "检查 score >= 90，结果为 False。", rationale: "if 先判断第一个条件。", factIds: ["F001"] },
        { action: "检查 score >= 60，结果为 True。", rationale: "elif 在前一条件不满足时继续判断。", factIds: ["F002"] },
        { action: "输出及格并跳过 else。", rationale: "条件链只执行第一个为真的分支。", factIds: ["F003", "F007"] },
      ],
      boundaryCases: ["分数 90 会进入第一个分支，分数 59 会进入 else。"],
    },
    practice: { prompt: "编写三档成绩判断并输出等级；验收输入 95、75、50 时分别输出优秀、及格、不及格。", cognitiveDemand: "analyze", factIds: ["F001", "F002", "F003", "F007"] },
    practiceTasks: [
      "编写 if/else 程序根据分数输出及格或不及格，并用 60 与 59 验证两个输出结果。",
      "编写 if/elif/else 程序，根据 95、75、50 三个样例分别输出优秀、及格、不及格。",
    ],
    quizPatches: { 1: { question: "给定 score = 75，编写三档条件判断并写出执行的分支。", answer: "若依次判断 >=90、>=60、else，程序执行 >=60 对应的及格分支。" } },
  },
  K007: {
    coreFactIds: ["F001", "F002", "F003", "F005"],
    exampleFactIds: [["F001", "F002"], ["F001", "F003", "F005"]],
    objective: { behavior: "trace", description: "追踪 for 循环每次迭代的元素、状态变化和最终输出。", factIds: ["F001", "F003", "F005"] },
    misconception: {
      incorrectBelief: "range(3) 会依次产生 1、2、3。",
      diagnosticSignals: ["把 range 的结束值计入序列"],
      counterexample: "list(range(3)) 的结果是 [0, 1, 2]。",
      correctionStrategy: "明确 range 默认从 0 开始且不包含 stop。",
      distractorTemplates: ["range 会包含结束值"],
      factIds: ["F003", "F005"] },
    workedExample: {
      title: "逐步累计列表总和",
      problem: "使用 for 循环计算 [2, 4, 6] 的总和，并记录每轮 total。",
      steps: [
        { action: "初始化 total = 0。", rationale: "循环前准备累计状态。", factIds: ["F001"] },
        { action: "依次让 value 取得 2、4、6。", rationale: "for 会逐个遍历列表元素。", factIds: ["F001", "F002"] },
        { action: "每轮执行 total = total + value，得到 2、6、12。", rationale: "每次迭代都更新累计状态。", factIds: ["F002"] },
      ],
      boundaryCases: ["空列表不会进入循环，total 保持初始值 0。"],
    },
    practice: { prompt: "遍历 [3, 5, 7] 累计总和，并逐轮输出当前值；验收最终 total 为 15。", cognitiveDemand: "apply", factIds: ["F001", "F002"] },
    practiceTasks: [
      "编写 for 循环遍历 [3, 5, 7] 并输出每个元素，验收应依次出现 3、5、7。",
      "编写 for 循环计算 1 到 10 的和并输出结果，验收输出应为 55。",
    ],
    quizPatches: { 1: { question: "用 for 循环遍历 [2, 4, 6] 并累计求和，写出最终输出。", answer: "累计结果依次为 2、6、12，最终输出 12。" } },
  },
  K008: {
    coreFactIds: ["F001", "F002", "F003", "F004"],
    exampleFactIds: [["F001", "F002", "F004"], ["F001", "F003", "F005"]],
    objective: { behavior: "debug", description: "设计并检查 while 的状态更新与停止条件，避免死循环。", factIds: ["F002", "F009"] },
    misconception: {
      incorrectBelief: "while 条件为 True 时，变量会自动向退出条件变化。",
      diagnosticSignals: ["循环体中没有更新条件相关变量"],
      counterexample: "x = 3; while x > 0: print(x) 会一直输出 3。",
      correctionStrategy: "圈出条件中使用的变量，并确认每轮都可能让它接近 False。",
      distractorTemplates: ["while 会自动更新计数器"],
      factIds: ["F001", "F002", "F004"] },
    workedExample: {
      title: "修复不能结束的计数循环",
      problem: "让程序从 3 输出到 1 后正常停止。",
      steps: [
        { action: "设置 count = 3，并写 while count > 0。", rationale: "while 在每轮开始前检查条件。", factIds: ["F001", "F004"] },
        { action: "在循环体输出 count。", rationale: "当前状态应当可观察。", factIds: ["F001"] },
        { action: "加入 count -= 1。", rationale: "更新条件变量让循环最终退出。", factIds: ["F002"] },
      ],
      boundaryCases: ["初始 count 为 0 时循环体一次也不会执行。"],
    },
    practice: { prompt: "用 while 读取数字并累计，输入 0 时停止；验收输入 2、3、0 应输出总和 5。", cognitiveDemand: "apply", factIds: ["F001", "F002", "F003"] },
    practiceTasks: [
      "编写 while 循环累计 1 到 100 并输出结果，验收输出应为 5050。",
      "编写 while 循环持续读取数字并累加，输入 0 时停止并输出累计结果。",
    ],
  },
  K009: {
    coreFactIds: ["F001", "F002", "F003", "F005"],
    exampleFactIds: [["F001", "F003", "F008"], ["F002", "F005", "F006", "F007"]],
    objective: { behavior: "apply", description: "创建列表，通过索引、切片和 append 读取或更新元素。", factIds: ["F001", "F004", "F003"] },
    misconception: {
      incorrectBelief: "列表不可用于保存多个有序元素。",
      diagnosticSignals: ["把需要保持顺序的多个值拆成互不关联的变量"],
      counterexample: "列表可用于保存多个有序元素。",
      correctionStrategy: "创建含三个元素的列表，按索引依次读取并核对原顺序。",
      distractorTemplates: ["列表不能保持元素顺序"],
      factIds: ["F001"] },
    workedExample: {
      title: "追加并读取成绩",
      problem: "向 [80, 90] 末尾加入 95，并读取首尾元素。",
      steps: [
        { action: "创建 scores = [80, 90]。", rationale: "列表保存有序的多个元素。", factIds: ["F001", "F004"] },
        { action: "执行 scores.append(95)。", rationale: "append 向列表末尾添加元素。", factIds: ["F003"] },
        { action: "输出 scores[0] 与 scores[-1]。", rationale: "0 访问首元素，-1 访问末元素。", factIds: ["F002", "F005", "F006"] },
      ],
      boundaryCases: ["空列表没有首元素，访问 [0] 会越界。"],
    },
    practice: { prompt: "创建成绩列表、追加一个成绩并输出长度与末元素；验收长度应增加 1。", cognitiveDemand: "apply", factIds: ["F001", "F003", "F006", "F008"] },
    practiceTasks: [
      "编写程序创建 [80, 90]，追加 95 后输出完整列表和长度，验收长度应为 3。",
      "编写程序用切片取得 [10, 20, 30, 40] 的前三个元素并输出 [10, 20, 30]。",
    ],
    quizPatches: { 1: { question: "向列表 [10, 20] 追加 30，再输出索引 2 的元素。", answer: "执行 lst.append(30) 后，lst[2] 的输出是 30。" } },
  },
  K010: {
    coreFactIds: ["F001", "F002", "F003", "F008"],
    exampleFactIds: [["F001", "F003", "F007"], ["F001", "F009", "F010"]],
    objective: { behavior: "apply", description: "创建键值映射，并使用索引、get 与遍历安全读取数据。", factIds: ["F001", "F003", "F008"] },
    misconception: {
      incorrectBelief: "dict[key] 在键不存在时会自动返回 None。",
      diagnosticSignals: ["对不确定存在的键直接使用方括号访问"],
      counterexample: "空字典执行 d[\"name\"] 会触发 KeyError，而 d.get(\"name\") 返回 None。",
      correctionStrategy: "确定键存在时用方括号；不确定时使用 get 或先用 in 判断。",
      distractorTemplates: ["字典缺键时方括号访问返回 None"],
      factIds: ["F003", "F008"] },
    workedExample: {
      title: "安全读取学生成绩",
      problem: "查询可能不存在的学生姓名，并给出默认提示。",
      steps: [
        { action: "创建 scores = {\"小明\": 92}。", rationale: "字典用键值对保存数据。", factIds: ["F001", "F004"] },
        { action: "执行 scores.get(\"小红\", \"未找到\")。", rationale: "get 可在键不存在时返回默认值。", factIds: ["F008"] },
        { action: "输出查询结果。", rationale: "结果明确区分已有数据和缺失键。", factIds: ["F002", "F008"] },
      ],
      boundaryCases: ["字典键必须唯一；再次给同一键赋值会更新对应值。"],
    },
    practice: { prompt: "建立两名学生的成绩字典，安全查询第三名学生；验收缺失查询应输出未找到。", cognitiveDemand: "apply", factIds: ["F001", "F002", "F008"] },
    practiceTasks: [
      "编写程序建立姓名到成绩的字典并逐项输出键和值，验收应完整显示两名学生。",
      "编写程序用 get() 查询不存在的姓名，验收结果应输出“未找到”而不是抛出错误。",
    ],
  },
  K011: {
    coreFactIds: ["F001", "F002", "F003", "F005"],
    exampleFactIds: [["F001", "F004", "F005"], ["F002", "F003", "F009"]],
    objective: { behavior: "apply", description: "根据顺序、可变性和唯一性要求选择元组或集合。", factIds: ["F002", "F005"] },
    misconception: {
      incorrectBelief: "集合会保留重复元素和原始位置。",
      diagnosticSignals: ["依赖 set 的重复次数或索引"],
      counterexample: "set([1, 1, 2]) 只保留 1 和 2，集合也不支持按位置索引。",
      correctionStrategy: "需要固定顺序时使用序列；需要去重或成员判断时使用集合。",
      distractorTemplates: ["集合是可按索引访问的去重列表"],
      factIds: ["F002", "F003", "F009"] },
    workedExample: {
      title: "用集合去除重复姓名",
      problem: "从 [\"小明\", \"小红\", \"小明\"] 得到不重复姓名。",
      steps: [
        { action: "创建包含重复姓名的列表。", rationale: "原序列保留输入中的重复项。", factIds: ["F002"] },
        { action: "执行 unique_names = set(names)。", rationale: "集合只保存不重复元素。", factIds: ["F002", "F003"] },
        { action: "输出集合并检查成员。", rationale: "集合适合去重和成员判断。", factIds: ["F003"] },
      ],
      boundaryCases: ["若输出顺序必须稳定，应在去重后显式排序。"],
    },
    practice: { prompt: "用集合求两个整数集合的交集并输出；验收 {1,2,3} 与 {2,3,4} 的结果为 {2,3}。", cognitiveDemand: "apply", factIds: ["F002", "F003", "F011"] },
    practiceTasks: [
      "编写程序用 set 去除姓名列表中的重复项，并输出不重复元素的数量。",
      "编写程序比较元组与集合的修改操作，记录元组赋值失败和集合添加成功的结果。",
    ],
  },
  K012: {
    coreFactIds: ["F001", "F002", "F003", "F004"],
    exampleFactIds: [["F002", "F004", "F008"], ["F003", "F007"]],
    objective: { behavior: "apply", description: "使用 split、join、切片和清理操作完成字符串分解与重组。", factIds: ["F002", "F001", "F003"] },
    misconception: {
      incorrectBelief: "split() 会直接修改原字符串。",
      diagnosticSignals: ["调用 split 后仍从原变量期待列表结果"],
      counterexample: "s = \"a,b\"; parts = s.split(\",\") 后，s 仍是原字符串，parts 才是列表。",
      correctionStrategy: "把字符串操作的返回值赋给新变量，并分别检查两个变量。",
      distractorTemplates: ["字符串方法原地修改字符串"],
      factIds: ["F002", "F004"] },
    workedExample: {
      title: "拆分并重组 CSV 文本",
      problem: "把 \"85,92,78\" 转换成以竖线分隔的文本。",
      steps: [
        { action: "执行 parts = data.split(\",\")。", rationale: "split 按逗号拆分并返回列表。", factIds: ["F002"] },
        { action: "检查原 data 保持不变。", rationale: "字符串是不可变对象。", factIds: ["F004"] },
        { action: "执行 result = \"|\".join(parts) 并输出。", rationale: "join 用指定分隔符连接字符串序列。", factIds: ["F003"] },
      ],
      boundaryCases: ["连续两个分隔符会在拆分结果中产生空字符串段。"],
    },
    practice: { prompt: "把逗号分隔的三项文本拆分、去除空白后用短横线连接；验收输出不含多余空格。", cognitiveDemand: "apply", factIds: ["F002", "F003", "F008"] },
    practiceTasks: [
      "编写程序用 split 拆分 \"a,b,c\"，再用 join 重组并输出 \"a|b|c\"。",
      "编写程序把句子中的逗号替换为空格并输出新字符串，验收原变量保持不变。",
    ],
  },
  K013: {
    coreFactIds: ["F001", "F002", "F003", "F006"],
    exampleFactIds: [["F001", "F002", "F003"], ["F001", "F003", "F006", "F008"]],
    objective: { behavior: "create", description: "定义命名函数并通过多次调用复用同一段逻辑。", factIds: ["F006"] },
    misconception: {
      incorrectBelief: "执行 def 语句时函数体会立即运行一次。",
      diagnosticSignals: ["没有调用函数却预测出现函数体输出"],
      counterexample: "只定义 def greet(): print(\"hi\") 不会输出；执行 greet() 后才输出。",
      correctionStrategy: "区分定义阶段和调用阶段，沿调用点进入函数体追踪。",
      distractorTemplates: ["函数定义会自动执行函数体"],
      factIds: ["F001", "F003", "F006"] },
    workedExample: {
      title: "定义并复用问候函数",
      problem: "定义 greet(name)，并对两个姓名复用问候逻辑。",
      steps: [
        { action: "使用 def greet(name): 定义函数头。", rationale: "def 建立一个命名函数。", factIds: ["F001", "F004"] },
        { action: "在缩进函数体中输出问候。", rationale: "函数体必须缩进并封装可复用逻辑。", factIds: ["F002", "F005"] },
        { action: "分别调用 greet(\"小明\") 和 greet(\"小红\")。", rationale: "调用时才执行函数体，同一函数可多次调用。", factIds: ["F003", "F006", "F008"] },
      ],
      boundaryCases: ["只写函数名 greet 不会调用；调用需要圆括号。"],
    },
    practice: { prompt: "定义 greet(name) 并调用三次；验收输出必须包含三个不同姓名且函数定义只出现一次。", cognitiveDemand: "transfer", factIds: ["F001", "F002", "F003", "F008"] },
    practiceTasks: [
      "编写程序定义 add(a, b) 函数并调用，验收输入 2 和 3 时输出 5。",
      "编写程序定义 greet(name) 一次并调用三次，验收输出包含三个不同姓名。",
    ],
    quizPatches: { 1: { question: "定义 greet(name) 输出问候，并调用两次；说明定义与调用各发生什么。", answer: "def 只建立函数；每次 greet(...) 调用才执行缩进的函数体。" } },
  },
  K014: {
    coreFactIds: ["F001", "F002", "F003", "F004"],
    exampleFactIds: [["F001", "F002"], ["F003"]],
    objective: { behavior: "create", description: "为函数设计参数与返回值，并在调用处使用返回结果。", factIds: ["F001", "F002", "F004"] },
    misconception: {
      incorrectBelief: "函数里的 print 和 return 对调用者产生相同结果。",
      diagnosticSignals: ["把仅打印的函数结果用于后续计算"],
      counterexample: "函数只 print(3) 时调用结果仍为 None；return 3 才能赋值给变量。",
      correctionStrategy: "区分面向屏幕的输出与交还调用者的数据。",
      distractorTemplates: ["print 的值会自动成为函数返回值"],
      factIds: ["F002", "F003"] },
    workedExample: {
      title: "返回可复用的平均分",
      problem: "定义 average(scores)，返回平均分并在调用处格式化输出。",
      steps: [
        { action: "在函数头声明 scores 参数。", rationale: "参数把外部列表传入函数。", factIds: ["F001"] },
        { action: "计算结果并执行 return result。", rationale: "return 把结果交还调用者。", factIds: ["F002"] },
        { action: "用 avg = average(data) 保存返回值并输出。", rationale: "调用者可以继续使用返回的数据。", factIds: ["F002", "F004"] },
      ],
      boundaryCases: ["没有显式 return 的函数调用结果是 None。"],
    },
    practice: { prompt: "定义 add(a, b=10) 并分别传一个和两个参数；验收两次调用返回不同且正确的和值。", cognitiveDemand: "apply", factIds: ["F001", "F002", "F005"] },
    practiceTasks: [
      "编写函数 add(a, b) 返回两数之和，验收 add(2, 3) 的返回结果为 5。",
      "编写函数 calc(scores) 返回最高分和最低分，输出样例列表对应的两个结果。",
    ],
  },
  K015: {
    coreFactIds: ["F001", "F002", "F003", "F005"],
    exampleFactIds: [["F001", "F002", "F005", "F007"], ["F001", "F003", "F005"]],
    objective: { behavior: "apply", description: "使用 with 和正确模式读取或写入文件，并核对持久化结果。", factIds: ["F001", "F003", "F005"] },
    misconception: {
      incorrectBelief: "使用 w 模式打开已有文件会保留原内容并追加。",
      diagnosticSignals: ["需要保留历史数据却选择 w 模式"],
      counterexample: "w 模式会覆盖已有内容；a 模式才在文件末尾追加。",
      correctionStrategy: "写入前先确定目标是覆盖还是追加，再选择 w 或 a。",
      distractorTemplates: ["w 模式等同于追加模式"],
      factIds: ["F003", "F004", "F008"] },
    workedExample: {
      title: "安全写入成绩报告",
      problem: "把两行成绩写入 report.txt，并在写入后重新读取核对。",
      steps: [
        { action: "使用 with open(\"report.txt\", \"w\") as file。", rationale: "w 明确覆盖写入，with 会自动关闭文件。", factIds: ["F001", "F003", "F004", "F005"] },
        { action: "调用 file.write() 写入两行文本。", rationale: "写入内容会保存到文件。", factIds: ["F003"] },
        { action: "用 r 模式重新打开并 read() 核对。", rationale: "read 可读取文件内容。", factIds: ["F002", "F004"] },
      ],
      boundaryCases: ["需要保留原文件时应使用 a 模式或先读取再决定写入策略。"],
    },
    practice: { prompt: "用 with 写入两行成绩后重新读取；验收读取结果必须与两行输入完全一致。", cognitiveDemand: "apply", factIds: ["F001", "F002", "F003", "F005"] },
    practiceTasks: [
      "编写程序用 with 读取文本文件并统计行数，输出可核对的整数结果。",
      "编写程序把两名学生成绩逐行写入文件，再读取并输出完整文件内容。",
    ],
  },
  K016: {
    coreFactIds: ["F001", "F002", "F003", "F005"],
    exampleFactIds: [["F001", "F002", "F003", "F005"], ["F001", "F003", "F005"]],
    objective: { behavior: "debug", description: "识别可能的异常类型，并用有针对性的 except 保持程序可控。", factIds: ["F001", "F003", "F005"] },
    misconception: {
      incorrectBelief: "一个空的 except 可以安全处理所有错误。",
      diagnosticSignals: ["捕获所有异常且不记录原因"],
      counterexample: "针对 ValueError 与 ZeroDivisionError 分别处理，才能给出与失败原因一致的反馈。",
      correctionStrategy: "列出可预期失败，再为每类错误选择具体异常类型和处理动作。",
      distractorTemplates: ["except 不需要异常类型也不需要处理逻辑"],
      factIds: ["F001", "F002", "F003", "F005"] },
    workedExample: {
      title: "安全转换用户输入",
      problem: "把文本转换为整数，输入无效时输出明确提示而不终止程序。",
      steps: [
        { action: "在 try 中执行 value = int(raw)。", rationale: "可能失败的运行时操作放在 try 中。", factIds: ["F001"] },
        { action: "用 except ValueError 捕获无效数字文本。", rationale: "except 应针对具体错误。", factIds: ["F003", "F005"] },
        { action: "成功时输出数值，失败时输出输入格式提示。", rationale: "异常处理让可预期错误不直接终止程序。", factIds: ["F002"] },
      ],
      boundaryCases: ["未预期的异常不应被无条件吞掉，应保留错误信息供定位。"],
    },
    practice: { prompt: "实现 safe_divide(a, b)，除数为 0 时返回提示；验收 6/2 为 3，6/0 不终止程序。", cognitiveDemand: "analyze", factIds: ["F001", "F002", "F003", "F005"] },
    practiceTasks: [
      "编写程序分别捕获数字转换和除零错误，输出与错误类型对应的提示结果。",
      "编写 safe_divide(a, b) 并运行 b=2 与 b=0 两个测试，记录返回结果。",
    ],
  },
  K017: {
    coreFactIds: ["F001", "F002", "F003", "F004"],
    exampleFactIds: [["F001", "F002", "F004"], ["F003"]],
    objective: { behavior: "apply", description: "选择整模块或指定对象导入方式，并使用正确名称调用功能。", factIds: ["F001", "F003", "F004"] },
    misconception: {
      incorrectBelief: "import math 后可以直接写 sqrt(9)。",
      diagnosticSignals: ["整模块导入后省略模块名前缀"],
      counterexample: "import math 需要调用 math.sqrt(9)；from math import sqrt 才能直接调用 sqrt(9)。",
      correctionStrategy: "根据导入语句画出进入当前命名空间的名称，再选择调用形式。",
      distractorTemplates: ["整模块导入会把所有函数名直接放入当前作用域"],
      factIds: ["F003", "F004"] },
    workedExample: {
      title: "两种方式调用平方根",
      problem: "分别使用整模块导入和指定对象导入计算 144 的平方根。",
      steps: [
        { action: "执行 import math。", rationale: "import 导入整个模块。", factIds: ["F001", "F002"] },
        { action: "调用 math.sqrt(144)。", rationale: "整模块导入后通过模块名前缀访问对象。", factIds: ["F004"] },
        { action: "改用 from math import sqrt 后调用 sqrt(144)。", rationale: "指定对象导入后可直接使用对象名。", factIds: ["F003"] },
      ],
      boundaryCases: ["应避免 from module import *，防止名称来源不清或冲突。"],
    },
    practice: { prompt: "导入 random 并输出一个 1 到 10 的整数；验收输出必须位于闭区间 [1,10]。", cognitiveDemand: "apply", factIds: ["F001", "F002", "F007"] },
    practiceTasks: [
      "编写程序导入 math，计算半径 2 的圆面积并输出数值结果。",
      "编写程序导入 random，生成并输出一个 1 到 10 的整数供范围验收。",
    ],
  },
  K018: {
    coreFactIds: ["F001", "F003", "F005", "F006"],
    exampleFactIds: [["F001", "F003", "F004", "F005", "F006"], ["F002", "F007", "F008", "F011"]],
    objective: { behavior: "create", description: "设计可处理空输入的成绩统计程序并输出可验收的统计结果。", factIds: ["F006", "F007", "F001"] },
    misconception: {
      incorrectBelief: "平均分函数可以对空列表直接执行 sum(scores) / len(scores)。",
      diagnosticSignals: ["统计前没有处理 len(scores) 为 0"],
      counterexample: "空列表的 len 为 0，直接相除会触发 ZeroDivisionError。",
      correctionStrategy: "在统计入口先定义空列表合同，再计算平均、最高和最低值。",
      distractorTemplates: ["空成绩列表的平均分自然为 0，无需判断"],
      factIds: ["F005", "F006"] },
    workedExample: {
      title: "构建有空输入保护的统计函数",
      problem: "实现 summarize(scores)，返回平均分、最高分和最低分，并处理空列表。",
      steps: [
        { action: "先判断 if not scores 并返回明确的空结果。", rationale: "空列表直接计算平均会除零。", factIds: ["F005", "F006"] },
        { action: "用 sum/len、max、min 计算三项统计值。", rationale: "内置聚合函数直接支持统计计算。", factIds: ["F004", "F005"] },
        { action: "把统计逻辑封装为 summarize 函数。", rationale: "函数封装提升复用性并明确输入输出。", factIds: ["F003", "F009"] },
        { action: "对普通列表与空列表各运行一次。", rationale: "正常与边界样例共同验证实现。", factIds: ["F006"] },
      ],
      boundaryCases: ["空列表必须得到明确结果；非空列表的平均分可按要求格式化。"],
    },
    practice: { prompt: "实现成绩统计器，输出平均、最高、最低并处理空列表；验收普通列表和空列表两个测试都不得报错。", cognitiveDemand: "transfer", factIds: ["F003", "F004", "F005", "F006", "F009"] },
    practiceTasks: [
      "编写函数计算非空成绩列表的平均分、最高分和最低分，并输出三项可核对结果。",
      "扩展成绩统计程序以处理空列表，验收空输入时输出明确提示且不抛出异常。",
      "编写程序用 input 读取 3 个成绩并输出格式化统计报告，验收报告包含平均、最高和最低值。",
    ],
    quizPatches: { 1: { question: "实现平均分函数并处理空成绩列表，说明两个分支的返回结果。", answer: "非空列表返回 sum(scores) / len(scores)；空列表应提前返回明确结果，避免除零。" } },
  },
}

export function applyAuthoredPythonBasicTeachingEvidence(base: KnowledgeBase): KnowledgeBase {
  return {
    ...base,
    version: "0.3.0",
    updatedAt: "2026-08-29",
    items: base.items.map((item) => applyEvidence(item)),
  }
}

function applyEvidence(item: KnowledgeItem): KnowledgeItem {
  const spec = AUTHORED_TEACHING_EVIDENCE[item.sourceId]
  if (!spec) return item
  const { factIds: misconceptionFactIds, ...misconception } = spec.misconception
  if (spec.exampleFactIds.length !== item.examples.length) {
    throw new Error(`AUTHORED_EXAMPLE_BINDING_COUNT_MISMATCH:${item.sourceId}`)
  }
  const examples = item.examples.map((example, index) => ({
    ...example,
    ...(spec.exampleCodePatches?.[index] ? { code: spec.exampleCodePatches[index]! } : {}),
    factIds: [...spec.exampleFactIds[index]!],
  }))
  const quizItems = item.quizItems.map((quiz, index) => ({
    ...quiz,
    ...(spec.quizPatches?.[index] ?? {}),
  }))
  return {
    ...item,
    coreFactIds: [...spec.coreFactIds],
    examples,
    practiceTasks: [...spec.practiceTasks],
    quizItems,
    observableObjectives: [{ ...spec.objective, objectiveId: `OBJ-${item.sourceId}-AUTHORED` }],
    misconceptions: [{
      ...misconception,
      misconceptionId: `MIS-${item.sourceId}-AUTHORED`,
      factRefs: misconceptionFactIds.map((factId) => ({ sourceId: item.sourceId, factId })),
    }],
    workedExamples: [{ ...spec.workedExample, fadingLevel: 1 }],
    practiceTemplates: [{ ...spec.practice, templateId: `PRACTICE-${item.sourceId}-AUTHORED` }],
    assessmentConstraints: [
      "题目必须直接测量本知识点的可观察目标，并使用已绑定事实解释答案。",
      "错误选项必须能定位到具体误解，不得使用明显荒谬或工程元信息选项",
      "实践题必须公开输入、动作、输出与验收条件，不得把参考实现写入题面。",
    ],
  }
}
