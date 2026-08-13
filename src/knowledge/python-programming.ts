import type { KnowledgeBase } from "./types"

export const PYTHON_PROGRAMMING_KNOWLEDGE_BASE: KnowledgeBase = {
  module: "Python程序设计",
  version: "0.3.0",
  updatedAt: "2026-08-05",
  sources: ["Python 官方文档", "Python程序设计基础教程课程范围", "KnowBalance 自编教学切片"],
  items: [
    {
      sourceId: "PY019",
      title: "切片进阶",
      module: "Python程序设计",
      difficulty: "basic",
      file: "knowledge_base/python_programming/PY019_.md",
      snippet: "切片可从序列中取出指定范围的元素。",
      prerequisites: ["K009", "K012"],
      keywords: ["切片", "slice", "索引范围", "字符串切片", "列表切片", "步长"],
      facts: [
        { sourceId: "PY019", factId: "F001", source_id: "PY019", fact_id: "F001", content: "切片可从序列中取出指定范围的元素。" },
        { sourceId: "PY019", factId: "F002", source_id: "PY019", fact_id: "F002", content: "切片语法通常使用 start:stop 表示左闭右开的范围。" },
        { sourceId: "PY019", factId: "F003", source_id: "PY019", fact_id: "F003", content: "切片可以设置步长来间隔取值。" }
      ],
      examples: [{ title: "提取成绩片段和倒序文本", code: "scores = [72, 85, 91, 64, 88]\ntop_middle = scores[1:4]\ntext = \"Python\"\nreversed_text = text[::-1]\nprint(top_middle)\nprint(reversed_text)", explanation: "scores[1:4] 取出索引 1 到 3 的元素，text[::-1] 使用负步长得到反向字符串。" }],
      practiceTasks: ["给定列表 scores，取出第 2 到第 4 个成绩", "给定字符串 text，使用切片得到倒序字符串"],
      quizItems: [
        { level: 1, type: "choice", question: "表达式 [10,20,30,40][1:3] 的结果是什么？", options: ["[20,30]", "[10,20,30]", "[30,40]", "[20,30,40]"], answer: "[20,30]", sourceId: "PY019", factId: "F002" },
        { level: 2, type: "short_answer", question: "说明切片 start:stop 为什么通常不包含 stop 位置。", answer: "切片 start:stop 表示左闭右开的范围。", sourceId: "PY019", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：[1,2,3][0:2] 会得到 [1,2,3]。", answer: "错误。0:2 不包含索引 2，结果是 [1,2]。", sourceId: "PY019", factId: "F002" },
        { level: 3, type: "practice", question: "写代码返回字符串 s 的倒序结果。", answer: "能使用 s[::-1] 或等价切片。", sourceId: "PY019", factId: "F003" }
      ],
    },
    {
      sourceId: "PY020",
      title: "列表推导式",
      module: "Python程序设计",
      difficulty: "basic",
      file: "knowledge_base/python_programming/PY020_.md",
      snippet: "列表推导式可用简洁语法从可迭代对象生成列表。",
      prerequisites: ["K007", "K009"],
      keywords: ["列表推导式", "推导式", "筛选", "生成列表", "列表生成"],
      facts: [
        { sourceId: "PY020", factId: "F001", source_id: "PY020", fact_id: "F001", content: "列表推导式可用简洁语法从可迭代对象生成列表。" },
        { sourceId: "PY020", factId: "F002", source_id: "PY020", fact_id: "F002", content: "列表推导式可以在生成元素时加入条件筛选。" },
        { sourceId: "PY020", factId: "F003", source_id: "PY020", fact_id: "F003", content: "列表推导式适合表达简单的映射和筛选逻辑。" }
      ],
      examples: [{ title: "筛选及格成绩", code: "scores = [58, 76, 90, 45, 82]\npassed = [score for score in scores if score >= 60]\ndoubled = [score * 2 for score in passed]\nprint(passed)\nprint(doubled)", explanation: "第一个列表推导式筛选及格成绩，第二个列表推导式对筛选结果做映射计算。" }],
      practiceTasks: ["用列表推导式取出成绩列表中的及格分数", "用列表推导式把整数列表中的每个数平方"],
      quizItems: [
        { level: 1, type: "choice", question: "列表推导式最适合表达哪类逻辑？", options: ["简单映射和筛选", "数据库连接", "图形界面布局", "版本控制"], answer: "简单映射和筛选", sourceId: "PY020", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明 [x for x in nums if x > 0] 中 if 的作用。", answer: "if 用于条件筛选，只保留满足条件的元素。", sourceId: "PY020", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：列表推导式不能加入条件筛选。", answer: "错误。列表推导式可以加入条件筛选。", sourceId: "PY020", factId: "F002" },
        { level: 3, type: "practice", question: "给定 nums，返回其中所有偶数组成的新列表。", answer: "能写出 [x for x in nums if x % 2 == 0] 或等价代码。", sourceId: "PY020", factId: "F002" }
      ],
    },
    {
      sourceId: "PY021",
      title: "字典方法进阶",
      module: "Python程序设计",
      difficulty: "basic",
      file: "knowledge_base/python_programming/PY021_.md",
      snippet: "get 方法可在键不存在时返回默认值。",
      prerequisites: ["K010"],
      keywords: ["字典方法", "get", "items", "keys", "values", "安全访问"],
      facts: [
        { sourceId: "PY021", factId: "F001", source_id: "PY021", fact_id: "F001", content: "get 方法可在键不存在时返回默认值。" },
        { sourceId: "PY021", factId: "F002", source_id: "PY021", fact_id: "F002", content: "items 方法可同时遍历字典的键和值。" },
        { sourceId: "PY021", factId: "F003", source_id: "PY021", fact_id: "F003", content: "keys 和 values 可分别获取字典中的键集合和值集合视图。" }
      ],
      examples: [{ title: "安全统计学生成绩", code: "scores = {\"小明\": 92, \"小红\": 85}\nprint(scores.get(\"小刚\", \"未找到\"))\nfor name, score in scores.items():\n    print(name, score)", explanation: "get 避免键不存在时直接报错，items 适合同时处理姓名和成绩。" }],
      practiceTasks: ["用 get 查询不存在学生的成绩并返回默认提示", "用 items 遍历字典并输出所有键值对"],
      quizItems: [
        { level: 1, type: "choice", question: "安全查询字典中可能不存在的键，常用哪个方法？", options: ["get", "append", "split", "return"], answer: "get", sourceId: "PY021", factId: "F001" },
        { level: 2, type: "short_answer", question: "items 方法为什么适合遍历学生成绩字典？", answer: "items 方法可同时遍历字典的键和值。", sourceId: "PY021", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：items 只能得到键，不能得到值。", answer: "错误。items 可同时得到键和值。", sourceId: "PY021", factId: "F002" },
        { level: 3, type: "practice", question: "给定 scores 字典，输出每个学生姓名和成绩。", answer: "能使用 for name, score in scores.items() 遍历。", sourceId: "PY021", factId: "F002" }
      ],
    },
    {
      sourceId: "PY022",
      title: "集合运算",
      module: "Python程序设计",
      difficulty: "basic",
      file: "knowledge_base/python_programming/PY022_.md",
      snippet: "集合支持交集、并集和差集等运算。",
      prerequisites: ["K011"],
      keywords: ["集合运算", "交集", "并集", "差集", "去重", "成员判断"],
      facts: [
        { sourceId: "PY022", factId: "F001", source_id: "PY022", fact_id: "F001", content: "集合支持交集、并集和差集等运算。" },
        { sourceId: "PY022", factId: "F002", source_id: "PY022", fact_id: "F002", content: "交集表示两个集合共同拥有的元素。" },
        { sourceId: "PY022", factId: "F003", source_id: "PY022", fact_id: "F003", content: "差集表示只存在于一个集合而不存在于另一个集合的元素。" }
      ],
      examples: [{ title: "比较两个班报名名单", code: "class_a = {\"小明\", \"小红\", \"小刚\"}\nclass_b = {\"小红\", \"小丽\", \"小刚\"}\nprint(class_a & class_b)\nprint(class_a - class_b)", explanation: "& 得到共同报名的学生，- 得到只在 A 班名单中的学生。" }],
      practiceTasks: ["求两个兴趣小组名单的共同成员", "找出只在一个名单中出现的学生"],
      quizItems: [
        { level: 1, type: "choice", question: "两个集合共同元素组成的集合叫作什么？", options: ["交集", "差集", "字符串", "索引"], answer: "交集", sourceId: "PY022", factId: "F002" },
        { level: 2, type: "short_answer", question: "说明 A - B 表示什么。", answer: "差集表示只存在于 A 而不存在于 B 的元素。", sourceId: "PY022", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：集合差集表示两个集合所有元素合并。", answer: "错误。差集表示只在一个集合中的元素。", sourceId: "PY022", factId: "F003" },
        { level: 3, type: "practice", question: "给定两个名单集合，返回共同报名的人。", answer: "能使用 & 或 intersection 求交集。", sourceId: "PY022", factId: "F002" }
      ],
    },
    {
      sourceId: "PY023",
      title: "字符串格式化",
      module: "Python程序设计",
      difficulty: "basic",
      file: "knowledge_base/python_programming/PY023_.md",
      snippet: "f-string 可把变量值嵌入字符串。",
      prerequisites: ["K012"],
      keywords: ["字符串格式化", "f-string", "format", "格式化输出", "保留小数"],
      facts: [
        { sourceId: "PY023", factId: "F001", source_id: "PY023", fact_id: "F001", content: "f-string 可把变量值嵌入字符串。" },
        { sourceId: "PY023", factId: "F002", source_id: "PY023", fact_id: "F002", content: "格式化输出可控制数值的小数位数。" },
        { sourceId: "PY023", factId: "F003", source_id: "PY023", fact_id: "F003", content: "字符串格式化适合生成结构清晰的文本报告。" }
      ],
      examples: [{ title: "生成成绩报告", code: "name = \"小明\"\nscore = 92.5\nrank = 3\nline = f\"{name} 的成绩是 {score:.1f}，排名第 {rank}\"\nprint(line)", explanation: "f-string 在字符串中嵌入变量，{score:.1f} 控制成绩保留一位小数。" }],
      practiceTasks: ["用 f-string 输出姓名和成绩", "把平均分格式化为保留两位小数"],
      quizItems: [
        { level: 1, type: "choice", question: "f-string 的主要作用是什么？", options: ["把变量值嵌入字符串", "删除列表元素", "捕获异常", "导入模块"], answer: "把变量值嵌入字符串", sourceId: "PY023", factId: "F001" },
        { level: 2, type: "short_answer", question: "{avg:.2f} 通常用于控制什么？", answer: "用于控制数值保留两位小数。", sourceId: "PY023", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：字符串格式化只能输出固定文本，不能使用变量。", answer: "错误。f-string 可把变量值嵌入字符串。", sourceId: "PY023", factId: "F001" },
        { level: 3, type: "practice", question: "给定 name 和 score，返回格式为“姓名: 分数”的字符串。", answer: "能使用 f-string 或 format 完成格式化。", sourceId: "PY023", factId: "F003" }
      ],
    },
    {
      sourceId: "PY024",
      title: "文件逐行处理",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY024_.md",
      snippet: "可以用 for line in file 逐行读取文本文件。",
      prerequisites: ["K015", "K007"],
      keywords: ["逐行读取", "readline", "for line", "strip", "文本处理", "行统计"],
      facts: [
        { sourceId: "PY024", factId: "F001", source_id: "PY024", fact_id: "F001", content: "可以用 for line in file 逐行读取文本文件。" },
        { sourceId: "PY024", factId: "F002", source_id: "PY024", fact_id: "F002", content: "strip 可去除字符串首尾的空白字符。" },
        { sourceId: "PY024", factId: "F003", source_id: "PY024", fact_id: "F003", content: "逐行处理适合统计行数或解析每一行记录。" }
      ],
      examples: [{ title: "逐行统计有效记录", code: "count = 0\nwith open(\"scores.txt\", \"r\", encoding=\"utf-8\") as f:\n    for line in f:\n        line = line.strip()\n        if line:\n            count += 1\nprint(count)", explanation: "for line in f 逐行读取文件，strip 去掉换行符和空白，再统计非空行。" }],
      practiceTasks: ["逐行读取文本并统计非空行数量", "读取每行姓名:成绩记录并输出姓名"],
      quizItems: [
        { level: 1, type: "choice", question: "逐行读取文件常见写法是哪一个？", options: ["for line in file", "append(file)", "split(file)", "return file"], answer: "for line in file", sourceId: "PY024", factId: "F001" },
        { level: 2, type: "short_answer", question: "strip 在逐行处理时有什么作用？", answer: "strip 可去除字符串首尾空白字符。", sourceId: "PY024", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：逐行处理不适合统计文本行数。", answer: "错误。逐行处理适合统计行数。", sourceId: "PY024", factId: "F003" },
        { level: 3, type: "practice", question: "写代码统计文本列表中非空字符串的数量。", answer: "能逐行或逐项 strip 后统计非空内容。", sourceId: "PY024", factId: "F003" }
      ],
    },
    {
      sourceId: "PY025",
      title: "函数默认参数",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY025_.md",
      snippet: "函数参数可以设置默认值，使调用时可省略对应实参。",
      prerequisites: ["K013", "K014"],
      keywords: ["默认参数", "关键字参数", "函数参数", "参数默认值", "可选参数"],
      facts: [
        { sourceId: "PY025", factId: "F001", source_id: "PY025", fact_id: "F001", content: "函数参数可以设置默认值，使调用时可省略对应实参。" },
        { sourceId: "PY025", factId: "F002", source_id: "PY025", fact_id: "F002", content: "关键字参数可通过参数名指定传入的值。" },
        { sourceId: "PY025", factId: "F003", source_id: "PY025", fact_id: "F003", content: "默认参数适合表达常用配置或可选输入。" }
      ],
      examples: [{ title: "带默认等级的成绩格式化函数", code: "def format_score(name, score, level=\"普通\"):\n    return f\"{name}:{score}:{level}\"\n\nprint(format_score(\"小明\", 92))\nprint(format_score(\"小红\", 95, level=\"优秀\"))", explanation: "level 有默认值，调用时可省略；也可用关键字参数明确指定。" }],
      practiceTasks: ["定义带默认参数的问候函数", "用关键字参数调用成绩格式化函数"],
      quizItems: [
        { level: 1, type: "choice", question: "函数参数设置默认值后，调用时可以怎样做？", options: ["省略对应实参", "必须删除函数", "不能传参", "只能返回 None"], answer: "省略对应实参", sourceId: "PY025", factId: "F001" },
        { level: 2, type: "short_answer", question: "关键字参数的优点是什么？", answer: "关键字参数可通过参数名指定传入的值。", sourceId: "PY025", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：默认参数只能用于没有常用配置的函数。", answer: "错误。默认参数适合表达常用配置或可选输入。", sourceId: "PY025", factId: "F003" },
        { level: 3, type: "practice", question: "写一个 greet(name, prefix='你好') 函数并返回问候语。", answer: "能定义默认参数并在调用时省略或覆盖。", sourceId: "PY025", factId: "F001" }
      ],
    },
    {
      sourceId: "PY026",
      title: "lambda 与排序键",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY026_lambda.md",
      snippet: "lambda 可定义简短的匿名函数。",
      prerequisites: ["K013", "K009"],
      keywords: ["lambda", "排序键", "key", "sorted", "匿名函数", "成绩排序"],
      facts: [
        { sourceId: "PY026", factId: "F001", source_id: "PY026", fact_id: "F001", content: "lambda 可定义简短的匿名函数。" },
        { sourceId: "PY026", factId: "F002", source_id: "PY026", fact_id: "F002", content: "sorted 的 key 参数可指定排序时使用的比较依据。" },
        { sourceId: "PY026", factId: "F003", source_id: "PY026", fact_id: "F003", content: "lambda 常与 sorted 的 key 参数配合完成简单排序。" }
      ],
      examples: [{ title: "按成绩排序学生记录", code: "students = [(\"小明\", 92), (\"小红\", 85), (\"小刚\", 98)]\nordered = sorted(students, key=lambda item: item[1], reverse=True)\nprint(ordered)", explanation: "lambda item: item[1] 指定按元组中的成绩排序，reverse=True 表示降序。" }],
      practiceTasks: ["按学生成绩从高到低排序", "用 sorted 的 key 参数按字符串长度排序"],
      quizItems: [
        { level: 1, type: "choice", question: "sorted 的 key 参数主要用于什么？", options: ["指定排序依据", "读取文件", "创建类", "捕获错误"], answer: "指定排序依据", sourceId: "PY026", factId: "F002" },
        { level: 2, type: "short_answer", question: "为什么 lambda 常用于简单排序任务？", answer: "lambda 可定义简短匿名函数，常与 sorted 的 key 参数配合。", sourceId: "PY026", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：sorted 的 key 参数不能和 lambda 配合使用。", answer: "错误。lambda 常与 sorted 的 key 参数配合完成简单排序。", sourceId: "PY026", factId: "F003" },
        { level: 3, type: "practice", question: "给定学生元组列表，按第二个元素成绩降序排序。", answer: "能使用 sorted(data, key=lambda item: item[1], reverse=True)。", sourceId: "PY026", factId: "F002" }
      ],
    },
    {
      sourceId: "PY027",
      title: "模块化程序设计",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY027_.md",
      snippet: "模块化程序设计把相关函数和数据组织到模块中。",
      prerequisites: ["K017", "K013"],
      keywords: ["模块化", "模块设计", "复用", "import", "程序结构", "分文件"],
      facts: [
        { sourceId: "PY027", factId: "F001", source_id: "PY027", fact_id: "F001", content: "模块化程序设计把相关函数和数据组织到模块中。" },
        { sourceId: "PY027", factId: "F002", source_id: "PY027", fact_id: "F002", content: "import 可在一个文件中使用另一个模块提供的功能。" },
        { sourceId: "PY027", factId: "F003", source_id: "PY027", fact_id: "F003", content: "模块化有助于复用代码并降低单个文件复杂度。" }
      ],
      examples: [{ title: "把成绩计算封装到模块思路中", code: "# score_tools.py\ndef average(scores):\n    return sum(scores) / len(scores)\n\n# main.py\n# from score_tools import average\nprint(average([80, 90, 75]))", explanation: "把 average 放入工具模块，主程序通过 import 使用，有助于复用和组织代码。" }],
      practiceTasks: ["把成绩计算函数整理到单独模块", "在主程序中导入并调用自定义模块函数"],
      quizItems: [
        { level: 1, type: "choice", question: "模块化程序设计的主要价值是什么？", options: ["复用代码并降低复杂度", "删除所有函数", "只能写一个文件", "禁止导入模块"], answer: "复用代码并降低复杂度", sourceId: "PY027", factId: "F003" },
        { level: 2, type: "short_answer", question: "import 在模块化程序中起什么作用？", answer: "import 可在一个文件中使用另一个模块提供的功能。", sourceId: "PY027", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：模块化会强制所有逻辑写在一个文件里。", answer: "错误。模块化把相关函数和数据组织到模块中。", sourceId: "PY027", factId: "F001" },
        { level: 3, type: "practice", question: "说明如何把 average 函数放到 score_tools 模块并在 main 中调用。", answer: "能描述定义模块、import、调用函数三步。", sourceId: "PY027", factId: "F002" }
      ],
    },
    {
      sourceId: "PY028",
      title: "类与实例",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY028_.md",
      snippet: "class 用于定义类，实例是由类创建的对象。",
      prerequisites: ["K013", "K010"],
      keywords: ["类", "实例", "对象", "class", "属性", "面向对象"],
      facts: [
        { sourceId: "PY028", factId: "F001", source_id: "PY028", fact_id: "F001", content: "class 用于定义类，实例是由类创建的对象。" },
        { sourceId: "PY028", factId: "F002", source_id: "PY028", fact_id: "F002", content: "实例属性用于保存对象自身的数据。" },
        { sourceId: "PY028", factId: "F003", source_id: "PY028", fact_id: "F003", content: "面向对象程序设计适合把数据和相关操作组织在一起。" }
      ],
      examples: [{ title: "定义学生类", code: "class Student:\n    def __init__(self, name, score):\n        self.name = name\n        self.score = score\n\nstudent = Student(\"小明\", 92)\nprint(student.name, student.score)", explanation: "Student 是类，student 是实例，name 和 score 是实例属性。" }],
      practiceTasks: ["定义 Student 类并创建实例", "为实例保存姓名和成绩两个属性"],
      quizItems: [
        { level: 1, type: "choice", question: "Python 中定义类使用哪个关键字？", options: ["class", "def", "for", "try"], answer: "class", sourceId: "PY028", factId: "F001" },
        { level: 2, type: "short_answer", question: "实例属性的作用是什么？", answer: "实例属性用于保存对象自身的数据。", sourceId: "PY028", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：实例不是对象，不能保存自身数据。", answer: "错误。实例是由类创建的对象，可用实例属性保存自身数据。", sourceId: "PY028", factId: "F001" },
        { level: 3, type: "practice", question: "定义 Student 类，创建一个保存姓名和成绩的实例。", answer: "能使用 class、__init__ 和实例属性。", sourceId: "PY028", factId: "F002" }
      ],
    },
    {
      sourceId: "PY029",
      title: "方法与对象状态",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY029_.md",
      snippet: "实例方法可访问并修改对象的实例属性。",
      prerequisites: ["PY028"],
      keywords: ["方法", "对象状态", "self", "实例方法", "属性更新"],
      facts: [
        { sourceId: "PY029", factId: "F001", source_id: "PY029", fact_id: "F001", content: "实例方法可访问并修改对象的实例属性。" },
        { sourceId: "PY029", factId: "F002", source_id: "PY029", fact_id: "F002", content: "self 通常表示当前实例对象。" },
        { sourceId: "PY029", factId: "F003", source_id: "PY029", fact_id: "F003", content: "把行为写成方法有助于让对象自己完成相关操作。" }
      ],
      examples: [{ title: "用方法更新学生成绩", code: "class Student:\n    def __init__(self, name, score):\n        self.name = name\n        self.score = score\n\n    def update_score(self, new_score):\n        self.score = new_score\n\nstudent = Student(\"小明\", 80)\nstudent.update_score(92)\nprint(student.score)", explanation: "update_score 是实例方法，通过 self 修改当前学生对象的 score 属性。" }],
      practiceTasks: ["为 Student 类添加 update_score 方法", "写一个方法返回学生是否及格"],
      quizItems: [
        { level: 1, type: "choice", question: "实例方法通常通过哪个名字表示当前实例？", options: ["self", "file", "score", "list"], answer: "self", sourceId: "PY029", factId: "F002" },
        { level: 2, type: "short_answer", question: "实例方法为什么能修改对象状态？", answer: "实例方法可访问并修改对象的实例属性。", sourceId: "PY029", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：方法不能访问对象自己的属性。", answer: "错误。实例方法可通过 self 访问实例属性。", sourceId: "PY029", factId: "F001" },
        { level: 3, type: "practice", question: "给 Student 类添加 is_passed 方法，判断 score 是否不小于 60。", answer: "能定义实例方法并访问 self.score。", sourceId: "PY029", factId: "F003" }
      ],
    },
    {
      sourceId: "PY030",
      title: "继承与方法重写",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY030_.md",
      snippet: "继承可让子类复用父类已有属性和方法。",
      prerequisites: ["PY028", "PY029"],
      keywords: ["继承", "方法重写", "子类", "父类", "override", "扩展类"],
      facts: [
        { sourceId: "PY030", factId: "F001", source_id: "PY030", fact_id: "F001", content: "继承可让子类复用父类已有属性和方法。" },
        { sourceId: "PY030", factId: "F002", source_id: "PY030", fact_id: "F002", content: "子类可以定义自己的方法来扩展父类功能。" },
        { sourceId: "PY030", factId: "F003", source_id: "PY030", fact_id: "F003", content: "方法重写可让子类提供与父类不同的实现。" }
      ],
      examples: [{ title: "优秀学生类扩展基础学生类", code: "class Student:\n    def describe(self):\n        return \"普通学生\"\n\nclass HonorStudent(Student):\n    def describe(self):\n        return \"优秀学生\"\n\nstudent = HonorStudent()\nprint(student.describe())", explanation: "HonorStudent 继承 Student，并重写 describe 方法返回不同描述。" }],
      practiceTasks: ["定义子类继承父类并添加新方法", "重写父类方法返回不同文本"],
      quizItems: [
        { level: 1, type: "choice", question: "继承的主要作用是什么？", options: ["复用父类已有属性和方法", "删除所有对象", "禁止定义方法", "只能处理字符串"], answer: "复用父类已有属性和方法", sourceId: "PY030", factId: "F001" },
        { level: 2, type: "short_answer", question: "方法重写表示什么？", answer: "方法重写可让子类提供与父类不同的实现。", sourceId: "PY030", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：子类不能扩展父类功能。", answer: "错误。子类可以定义自己的方法来扩展父类功能。", sourceId: "PY030", factId: "F002" },
        { level: 3, type: "practice", question: "定义 Animal 父类和 Cat 子类，并让 Cat 重写 speak 方法。", answer: "能使用继承并完成方法重写。", sourceId: "PY030", factId: "F003" }
      ],
    },
    {
      sourceId: "PY031",
      title: "random 常用操作",
      module: "Python程序设计",
      difficulty: "basic",
      file: "knowledge_base/python_programming/PY031_random_常用操作.md",
      snippet: "random 模块可用于生成随机数。",
      prerequisites: ["K017", "K005"],
      keywords: ["random", "随机数", "randint", "choice", "随机选择"],
      facts: [
        { sourceId: "PY031", factId: "F001", source_id: "PY031", fact_id: "F001", content: "random 模块可用于生成随机数。" },
        { sourceId: "PY031", factId: "F002", source_id: "PY031", fact_id: "F002", content: "randint(a, b) 可生成包含端点 a 和 b 的随机整数。" },
        { sourceId: "PY031", factId: "F003", source_id: "PY031", fact_id: "F003", content: "choice 可从序列中随机选取一个元素。" }
      ],
      examples: [{ title: "random 常用操作示例", code: "import random\n\nscore = random.randint(60, 100)\nname = random.choice([\"小明\", \"小红\", \"小刚\"])\nprint(name, score)", explanation: "random.randint 生成随机成绩，random.choice 从姓名列表中随机选择一个学生。" }],
      practiceTasks: ["用 randint 生成 1 到 100 的随机整数", "用 choice 从学生列表中随机选出一名学生"],
      quizItems: [
        { level: 1, type: "choice", question: "random.randint(1, 6) 的可能结果包含哪个端点？", options: ["1 和 6 都可能包含", "只包含 1", "只包含 6", "都不包含"], answer: "1 和 6 都可能包含", sourceId: "PY031", factId: "F002" },
        { level: 2, type: "short_answer", question: "说明 choice 的作用。", answer: "choice 可从序列中随机选取一个元素。", sourceId: "PY031", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：random 模块只能生成固定数字。", answer: "错误。random 模块可用于生成随机数。", sourceId: "PY031", factId: "F001" },
        { level: 3, type: "practice", question: "写代码生成 1 到 10 的随机整数。", answer: "能导入 random 并调用 randint(1, 10)。", sourceId: "PY031", factId: "F002" }
      ],
    },
    {
      sourceId: "PY032",
      title: "math 常用操作",
      module: "Python程序设计",
      difficulty: "basic",
      file: "knowledge_base/python_programming/PY032_math_常用操作.md",
      snippet: "math 模块提供常用数学函数和常量。",
      prerequisites: ["K017", "K005"],
      keywords: ["math", "sqrt", "ceil", "floor", "pi", "数学函数"],
      facts: [
        { sourceId: "PY032", factId: "F001", source_id: "PY032", fact_id: "F001", content: "math 模块提供常用数学函数和常量。" },
        { sourceId: "PY032", factId: "F002", source_id: "PY032", fact_id: "F002", content: "sqrt 可计算平方根。" },
        { sourceId: "PY032", factId: "F003", source_id: "PY032", fact_id: "F003", content: "ceil 和 floor 可分别进行向上取整和向下取整。" }
      ],
      examples: [{ title: "math 常用操作示例", code: "import math\n\nradius = 3\narea = math.pi * radius ** 2\nprint(round(area, 2))\nprint(math.sqrt(81))", explanation: "math.pi 提供圆周率常量，math.sqrt 计算平方根。" }],
      practiceTasks: ["用 math.sqrt 计算平方根", "用 math.pi 计算圆面积"],
      quizItems: [
        { level: 1, type: "choice", question: "计算平方根常用 math 中哪个函数？", options: ["sqrt", "choice", "append", "split"], answer: "sqrt", sourceId: "PY032", factId: "F002" },
        { level: 2, type: "short_answer", question: "ceil 和 floor 的区别是什么？", answer: "ceil 向上取整，floor 向下取整。", sourceId: "PY032", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：math 模块不包含数学常量。", answer: "错误。math 模块提供常用数学函数和常量。", sourceId: "PY032", factId: "F001" },
        { level: 3, type: "practice", question: "写代码计算 49 的平方根。", answer: "能调用 math.sqrt(49)。", sourceId: "PY032", factId: "F002" }
      ],
    },
    {
      sourceId: "PY033",
      title: "time 与 datetime 基础",
      module: "Python程序设计",
      difficulty: "basic",
      file: "knowledge_base/python_programming/PY033_time_与_datetime_基础.md",
      snippet: "datetime 可表示日期和时间。",
      prerequisites: ["K017"],
      keywords: ["time", "datetime", "日期", "时间", "now", "格式化时间"],
      facts: [
        { sourceId: "PY033", factId: "F001", source_id: "PY033", fact_id: "F001", content: "datetime 可表示日期和时间。" },
        { sourceId: "PY033", factId: "F002", source_id: "PY033", fact_id: "F002", content: "datetime.now 可获取当前日期时间。" },
        { sourceId: "PY033", factId: "F003", source_id: "PY033", fact_id: "F003", content: "strftime 可把日期时间格式化为字符串。" }
      ],
      examples: [{ title: "time 与 datetime 基础示例", code: "from datetime import datetime\n\nnow = datetime.now()\nprint(now.strftime(\"%Y-%m-%d\"))", explanation: "datetime.now 获取当前时间，strftime 按指定格式输出日期字符串。" }],
      practiceTasks: ["获取当前日期并格式化输出", "说明 datetime 和字符串日期的区别"],
      quizItems: [
        { level: 1, type: "choice", question: "获取当前日期时间常用哪个调用？", options: ["datetime.now()", "list.append()", "random.choice()", "file.read()"], answer: "datetime.now()", sourceId: "PY033", factId: "F002" },
        { level: 2, type: "short_answer", question: "strftime 的作用是什么？", answer: "strftime 可把日期时间格式化为字符串。", sourceId: "PY033", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：datetime 不能表示日期。", answer: "错误。datetime 可表示日期和时间。", sourceId: "PY033", factId: "F001" },
        { level: 3, type: "practice", question: "写代码输出今天的年月日字符串。", answer: "能使用 datetime.now 和 strftime。", sourceId: "PY033", factId: "F003" }
      ],
    },
    {
      sourceId: "PY034",
      title: "GUI 基础概念",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY034_GUI_基础概念.md",
      snippet: "GUI 程序通过窗口、按钮等控件与用户交互。",
      prerequisites: ["K013"],
      keywords: ["GUI", "图形界面", "窗口", "按钮", "事件处理", "tkinter"],
      facts: [
        { sourceId: "PY034", factId: "F001", source_id: "PY034", fact_id: "F001", content: "GUI 程序通过窗口、按钮等控件与用户交互。" },
        { sourceId: "PY034", factId: "F002", source_id: "PY034", fact_id: "F002", content: "事件处理用于响应用户点击等操作。" },
        { sourceId: "PY034", factId: "F003", source_id: "PY034", fact_id: "F003", content: "tkinter 是 Python 常见的图形界面库之一。" }
      ],
      examples: [{ title: "GUI 基础概念示例", code: "import tkinter as tk\n\ndef greet():\n    label.config(text=\"你好\")\n\nwindow = tk.Tk()\nlabel = tk.Label(window, text=\"等待点击\")\nbutton = tk.Button(window, text=\"问候\", command=greet)", explanation: "窗口、标签和按钮是常见控件，command 绑定点击后的处理函数。" }],
      practiceTasks: ["说明按钮点击为什么需要事件处理", "识别窗口、标签、按钮三个控件"],
      quizItems: [
        { level: 1, type: "choice", question: "GUI 程序主要通过什么与用户交互？", options: ["窗口和控件", "只通过命令行", "只通过文件", "只通过字典"], answer: "窗口和控件", sourceId: "PY034", factId: "F001" },
        { level: 2, type: "short_answer", question: "事件处理的作用是什么？", answer: "事件处理用于响应用户点击等操作。", sourceId: "PY034", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：GUI 程序不需要响应用户操作。", answer: "错误。GUI 程序通常通过事件处理响应用户操作。", sourceId: "PY034", factId: "F002" },
        { level: 3, type: "practice", question: "描述一个按钮点击后改变文本的 GUI 流程。", answer: "能说明窗口、按钮、事件处理函数之间的关系。", sourceId: "PY034", factId: "F001" }
      ],
    },
    {
      sourceId: "PY035",
      title: "CSV 文本数据处理",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY035_CSV_文本数据处理.md",
      snippet: "CSV 常用逗号分隔一行中的多个字段。",
      prerequisites: ["K015", "PY024"],
      keywords: ["CSV", "csv", "逗号分隔", "表格数据", "逐行读取", "成绩表"],
      facts: [
        { sourceId: "PY035", factId: "F001", source_id: "PY035", fact_id: "F001", content: "CSV 常用逗号分隔一行中的多个字段。" },
        { sourceId: "PY035", factId: "F002", source_id: "PY035", fact_id: "F002", content: "csv 模块可帮助读取和写入 CSV 表格数据。" },
        { sourceId: "PY035", factId: "F003", source_id: "PY035", fact_id: "F003", content: "处理 CSV 成绩表时通常需要逐行读取记录。" }
      ],
      examples: [{ title: "CSV 文本数据处理示例", code: "import csv\n\nwith open(\"scores.csv\", \"r\", encoding=\"utf-8\") as f:\n    reader = csv.reader(f)\n    for row in reader:\n        print(row)", explanation: "csv.reader 按行读取 CSV 文件，每一行会被解析成字段列表。" }],
      practiceTasks: ["读取 CSV 成绩表并输出每行字段", "说明 CSV 与普通文本行的关系"],
      quizItems: [
        { level: 1, type: "choice", question: "CSV 一行中的多个字段通常用什么分隔？", options: ["逗号", "分号必选", "空文件", "类定义"], answer: "逗号", sourceId: "PY035", factId: "F001" },
        { level: 2, type: "short_answer", question: "csv 模块有什么作用？", answer: "csv 模块可帮助读取和写入 CSV 表格数据。", sourceId: "PY035", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：处理 CSV 成绩表不需要逐行读取记录。", answer: "错误。处理 CSV 成绩表时通常需要逐行读取记录。", sourceId: "PY035", factId: "F003" },
        { level: 3, type: "practice", question: "写代码读取 scores.csv 并逐行输出。", answer: "能使用 open、csv.reader 和 for 循环。", sourceId: "PY035", factId: "F002" }
      ],
    },
    {
      sourceId: "PY036",
      title: "jieba 中文分词概念",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY036_jieba_中文分词概念.md",
      snippet: "中文分词是把连续中文文本切分为词语的过程。",
      prerequisites: ["K012", "K017"],
      keywords: ["jieba", "中文分词", "分词", "词语切分", "文本处理"],
      facts: [
        { sourceId: "PY036", factId: "F001", source_id: "PY036", fact_id: "F001", content: "中文分词是把连续中文文本切分为词语的过程。" },
        { sourceId: "PY036", factId: "F002", source_id: "PY036", fact_id: "F002", content: "jieba 是 Python 中常见的中文分词工具之一。" },
        { sourceId: "PY036", factId: "F003", source_id: "PY036", fact_id: "F003", content: "分词结果常用于词频统计等文本分析任务。" }
      ],
      examples: [{ title: "jieba 中文分词概念示例", code: "import jieba\n\ntext = \"我喜欢学习Python程序设计\"\nwords = list(jieba.cut(text))\nprint(words)", explanation: "jieba.cut 把连续中文文本切分为词语列表，后续可统计词频。" }],
      practiceTasks: ["说明中文分词为什么有助于词频统计", "用 jieba.cut 对一句中文文本分词"],
      quizItems: [
        { level: 1, type: "choice", question: "中文分词的核心任务是什么？", options: ["把连续中文文本切分为词语", "生成随机整数", "创建按钮", "计算平方根"], answer: "把连续中文文本切分为词语", sourceId: "PY036", factId: "F001" },
        { level: 2, type: "short_answer", question: "分词结果常用于什么任务？", answer: "分词结果常用于词频统计等文本分析任务。", sourceId: "PY036", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：jieba 是常见的图形界面库。", answer: "错误。jieba 是常见的中文分词工具之一。", sourceId: "PY036", factId: "F002" },
        { level: 3, type: "practice", question: "描述用 jieba 做文本词频统计的第一步。", answer: "先对中文文本进行分词。", sourceId: "PY036", factId: "F001" }
      ],
    },
    {
      sourceId: "PY037",
      title: "wordcloud 词云概念",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY037_wordcloud_词云概念.md",
      snippet: "词云可用不同大小的文字展示词频高低。",
      prerequisites: ["PY036"],
      keywords: ["wordcloud", "词云", "词频", "文本可视化", "关键词展示"],
      facts: [
        { sourceId: "PY037", factId: "F001", source_id: "PY037", fact_id: "F001", content: "词云可用不同大小的文字展示词频高低。" },
        { sourceId: "PY037", factId: "F002", source_id: "PY037", fact_id: "F002", content: "wordcloud 是 Python 中常见的词云生成工具之一。" },
        { sourceId: "PY037", factId: "F003", source_id: "PY037", fact_id: "F003", content: "生成词云前通常需要准备词语及其频率。" }
      ],
      examples: [{ title: "wordcloud 词云概念示例", code: "from wordcloud import WordCloud\n\nfreq = {\"Python\": 5, \"数据\": 3, \"学习\": 2}\nwc = WordCloud(width=400, height=200).generate_from_frequencies(freq)", explanation: "generate_from_frequencies 根据词频字典生成词云对象。" }],
      practiceTasks: ["说明词云中文字大小和词频的关系", "准备一个词频字典用于生成词云"],
      quizItems: [
        { level: 1, type: "choice", question: "词云通常用什么表现词频高低？", options: ["文字大小", "文件模式", "异常类型", "类继承"], answer: "文字大小", sourceId: "PY037", factId: "F001" },
        { level: 2, type: "short_answer", question: "生成词云前通常需要准备什么？", answer: "通常需要准备词语及其频率。", sourceId: "PY037", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：词云不能用于文本可视化。", answer: "错误。词云是一种文本可视化方式。", sourceId: "PY037", factId: "F001" },
        { level: 3, type: "practice", question: "给出一个可用于生成词云的词频字典。", answer: "能构造词语到频率的映射。", sourceId: "PY037", factId: "F003" }
      ],
    },
    {
      sourceId: "PY038",
      title: "requests 请求基础",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY038_requests_请求基础.md",
      snippet: "requests 可用于发送 HTTP 请求。",
      prerequisites: ["K017"],
      keywords: ["requests", "HTTP", "网络请求", "网页请求", "get", "响应状态"],
      facts: [
        { sourceId: "PY038", factId: "F001", source_id: "PY038", fact_id: "F001", content: "requests 可用于发送 HTTP 请求。" },
        { sourceId: "PY038", factId: "F002", source_id: "PY038", fact_id: "F002", content: "GET 请求常用于获取网页或接口数据。" },
        { sourceId: "PY038", factId: "F003", source_id: "PY038", fact_id: "F003", content: "响应状态码可用于判断请求是否成功。" }
      ],
      examples: [{ title: "requests 请求基础示例", code: "import requests\n\nresponse = requests.get(\"https://example.com\")\nprint(response.status_code)\nprint(response.text[:50])", explanation: "requests.get 发送 GET 请求，status_code 可查看响应状态码。" }],
      practiceTasks: ["发送 GET 请求并查看状态码", "说明状态码为什么能帮助判断请求结果"],
      quizItems: [
        { level: 1, type: "choice", question: "GET 请求常用于什么？", options: ["获取网页或接口数据", "定义类", "计算平方根", "集合求交集"], answer: "获取网页或接口数据", sourceId: "PY038", factId: "F002" },
        { level: 2, type: "short_answer", question: "响应状态码有什么作用？", answer: "响应状态码可用于判断请求是否成功。", sourceId: "PY038", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：requests 不能发送 HTTP 请求。", answer: "错误。requests 可用于发送 HTTP 请求。", sourceId: "PY038", factId: "F001" },
        { level: 3, type: "practice", question: "写出发送网页 GET 请求并打印状态码的代码思路。", answer: "能使用 requests.get 和 status_code。", sourceId: "PY038", factId: "F001" }
      ],
    },
    {
      sourceId: "PY039",
      title: "BeautifulSoup HTML 解析概念",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY039_BeautifulSoup_HTML_解析概念.md",
      snippet: "HTML 解析用于从网页文本中提取结构化信息。",
      prerequisites: ["PY038", "K012"],
      keywords: ["BeautifulSoup", "HTML解析", "标签", "网页解析", "find", "select"],
      facts: [
        { sourceId: "PY039", factId: "F001", source_id: "PY039", fact_id: "F001", content: "HTML 解析用于从网页文本中提取结构化信息。" },
        { sourceId: "PY039", factId: "F002", source_id: "PY039", fact_id: "F002", content: "BeautifulSoup 是 Python 中常见的 HTML 解析工具之一。" },
        { sourceId: "PY039", factId: "F003", source_id: "PY039", fact_id: "F003", content: "解析网页时通常需要先获取 HTML 文本再查找目标标签。" }
      ],
      examples: [{ title: "BeautifulSoup HTML 解析概念示例", code: "from bs4 import BeautifulSoup\n\nhtml = \"<h1>标题</h1><p>正文</p>\"\nsoup = BeautifulSoup(html, \"html.parser\")\nprint(soup.find(\"h1\").text)", explanation: "BeautifulSoup 把 HTML 文本解析成可查询对象，find 可查找目标标签。" }],
      practiceTasks: ["从 HTML 中提取标题文本", "说明获取 HTML 和解析 HTML 的先后关系"],
      quizItems: [
        { level: 1, type: "choice", question: "HTML 解析的主要目标是什么？", options: ["提取结构化信息", "生成随机数", "捕获异常", "计算平均分"], answer: "提取结构化信息", sourceId: "PY039", factId: "F001" },
        { level: 2, type: "short_answer", question: "解析网页前通常需要先做什么？", answer: "通常需要先获取 HTML 文本再查找目标标签。", sourceId: "PY039", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：BeautifulSoup 是常见的 HTML 解析工具之一。", answer: "正确。BeautifulSoup 是 Python 中常见的 HTML 解析工具之一。", sourceId: "PY039", factId: "F002" },
        { level: 3, type: "practice", question: "描述从网页 HTML 中提取 h1 文本的步骤。", answer: "能说明获取 HTML、构造 BeautifulSoup、查找标签。", sourceId: "PY039", factId: "F003" }
      ],
    },
    {
      sourceId: "PY040",
      title: "正则表达式基础",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY040_正则表达式基础.md",
      snippet: "正则表达式用于描述文本匹配模式。",
      prerequisites: ["K012"],
      keywords: ["正则表达式", "regex", "re", "模式匹配", "findall", "文本匹配"],
      facts: [
        { sourceId: "PY040", factId: "F001", source_id: "PY040", fact_id: "F001", content: "正则表达式用于描述文本匹配模式。" },
        { sourceId: "PY040", factId: "F002", source_id: "PY040", fact_id: "F002", content: "re 模块提供 Python 中常用的正则表达式功能。" },
        { sourceId: "PY040", factId: "F003", source_id: "PY040", fact_id: "F003", content: "findall 可返回文本中所有匹配结果。" }
      ],
      examples: [{ title: "正则表达式基础示例", code: "import re\n\ntext = \"A12 B7 C305\"\nnumbers = re.findall(r\"\\d+\", text)\nprint(numbers)", explanation: "\\d+ 表示连续数字，findall 返回文本中的所有数字片段。" }],
      practiceTasks: ["用正则表达式提取文本中的数字", "说明模式匹配和普通字符串查找的区别"],
      quizItems: [
        { level: 1, type: "choice", question: "正则表达式用于描述什么？", options: ["文本匹配模式", "随机选择", "图形按钮", "继承关系"], answer: "文本匹配模式", sourceId: "PY040", factId: "F001" },
        { level: 2, type: "short_answer", question: "findall 的作用是什么？", answer: "findall 可返回文本中所有匹配结果。", sourceId: "PY040", factId: "F003" },
        { level: 2, type: "debugging", question: "判断正误：re 模块与正则表达式无关。", answer: "错误。re 模块提供 Python 中常用的正则表达式功能。", sourceId: "PY040", factId: "F002" },
        { level: 3, type: "practice", question: "写出提取字符串中所有数字的正则思路。", answer: "能使用 re.findall 和数字匹配模式。", sourceId: "PY040", factId: "F003" }
      ],
    },
    {
      sourceId: "PY041",
      title: "数据清洗小项目",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY041_数据清洗小项目.md",
      snippet: "数据清洗用于提高后续分析数据的可用性。",
      prerequisites: ["K007", "K009"],
      keywords: ["数据清洗", "缺失值", "异常值", "去重", "标准化"],
      facts: [
        { sourceId: "PY041", factId: "F001", source_id: "PY041", fact_id: "F001", content: "数据清洗用于提高后续分析数据的可用性。" },
        { sourceId: "PY041", factId: "F002", source_id: "PY041", fact_id: "F002", content: "常见清洗步骤包括去重、处理缺失值和统一格式。" },
        { sourceId: "PY041", factId: "F003", source_id: "PY041", fact_id: "F003", content: "清洗过程应保留可复查的处理规则。" }
      ],
      examples: [{ title: "数据清洗小项目示例", code: "records = [\"小明,92\", \"小红,\", \"小明,92\"]\ncleaned = []\nfor row in records:\n    if row and row not in cleaned and not row.endswith(\",\"):\n        cleaned.append(row)\nprint(cleaned)", explanation: "用规则过滤空值和重复记录，保留可复查的数据清洗步骤。" }],
      practiceTasks: ["完成一个与数据清洗小项目相关的可评分练习", "说明数据清洗小项目中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "数据清洗小项目最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY041", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明数据清洗小项目的核心作用。", answer: "数据清洗用于提高后续分析数据的可用性。", sourceId: "PY041", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：数据清洗小项目可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY041", factId: "F003" },
        { level: 3, type: "practice", question: "围绕数据清洗小项目完成一个小任务。", answer: "能体现：数据清洗用于提高后续分析数据的可用性。", sourceId: "PY041", factId: "F001" }
      ],
    },
    {
      sourceId: "PY042",
      title: "成绩管理综合项目",
      module: "Python程序设计",
      difficulty: "integrated",
      file: "knowledge_base/python_programming/PY042_成绩管理综合项目.md",
      snippet: "成绩管理项目可综合练习字典、列表、函数和文件处理。",
      prerequisites: ["K007", "K009"],
      keywords: ["成绩管理", "学生成绩", "增删改查", "学生信息管理", "成绩查询"],
      facts: [
        { sourceId: "PY042", factId: "F001", source_id: "PY042", fact_id: "F001", content: "成绩管理项目可综合练习字典、列表、函数和文件处理。" },
        { sourceId: "PY042", factId: "F002", source_id: "PY042", fact_id: "F002", content: "成绩管理通常包含录入、查询、修改和统计等操作。" },
        { sourceId: "PY042", factId: "F003", source_id: "PY042", fact_id: "F003", content: "把功能拆成函数有助于维护成绩管理项目。" }
      ],
      examples: [{ title: "成绩管理综合项目示例", code: "scores = {\"小明\": 92}\ndef add_score(name, score):\n    scores[name] = score\ndef get_score(name):\n    return scores.get(name, \"未找到\")\nadd_score(\"小红\", 85)\nprint(get_score(\"小红\"))", explanation: "字典保存成绩，函数封装录入和查询操作。" }],
      practiceTasks: ["完成一个与成绩管理综合项目相关的可评分练习", "说明成绩管理综合项目中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "成绩管理综合项目最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY042", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明成绩管理综合项目的核心作用。", answer: "成绩管理项目可综合练习字典、列表、函数和文件处理。", sourceId: "PY042", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：成绩管理综合项目可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY042", factId: "F003" },
        { level: 3, type: "practice", question: "围绕成绩管理综合项目完成一个小任务。", answer: "能体现：成绩管理项目可综合练习字典、列表、函数和文件处理。", sourceId: "PY042", factId: "F001" }
      ],
    },
    {
      sourceId: "PY043",
      title: "文本词频统计项目",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY043_文本词频统计项目.md",
      snippet: "词频统计用于计算词语在文本中出现的次数。",
      prerequisites: ["K007", "K009"],
      keywords: ["词频统计", "文本统计", "分词", "计数", "字典累计"],
      facts: [
        { sourceId: "PY043", factId: "F001", source_id: "PY043", fact_id: "F001", content: "词频统计用于计算词语在文本中出现的次数。" },
        { sourceId: "PY043", factId: "F002", source_id: "PY043", fact_id: "F002", content: "字典适合保存词语到次数的映射。" },
        { sourceId: "PY043", factId: "F003", source_id: "PY043", fact_id: "F003", content: "文本词频统计通常包含分词、计数和排序三个步骤。" }
      ],
      examples: [{ title: "文本词频统计项目示例", code: "words = [\"Python\", \"学习\", \"Python\"]\nfreq = {}\nfor word in words:\n    freq[word] = freq.get(word, 0) + 1\nprint(freq)", explanation: "用字典累计每个词语出现次数，是词频统计的核心。" }],
      practiceTasks: ["完成一个与文本词频统计项目相关的可评分练习", "说明文本词频统计项目中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "文本词频统计项目最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY043", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明文本词频统计项目的核心作用。", answer: "词频统计用于计算词语在文本中出现的次数。", sourceId: "PY043", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：文本词频统计项目可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY043", factId: "F003" },
        { level: 3, type: "practice", question: "围绕文本词频统计项目完成一个小任务。", answer: "能体现：词频统计用于计算词语在文本中出现的次数。", sourceId: "PY043", factId: "F001" }
      ],
    },
    {
      sourceId: "PY044",
      title: "简单爬虫项目",
      module: "Python程序设计",
      difficulty: "integrated",
      file: "knowledge_base/python_programming/PY044_简单爬虫项目.md",
      snippet: "简单爬虫通常包含请求网页、解析内容和保存结果三个步骤。",
      prerequisites: ["K007", "K009"],
      keywords: ["简单爬虫", "网页获取", "网页解析", "数据提取", "爬虫流程"],
      facts: [
        { sourceId: "PY044", factId: "F001", source_id: "PY044", fact_id: "F001", content: "简单爬虫通常包含请求网页、解析内容和保存结果三个步骤。" },
        { sourceId: "PY044", factId: "F002", source_id: "PY044", fact_id: "F002", content: "爬虫应遵守网站规则并控制请求频率。" },
        { sourceId: "PY044", factId: "F003", source_id: "PY044", fact_id: "F003", content: "网页解析用于从 HTML 中提取目标数据。" }
      ],
      examples: [{ title: "简单爬虫项目示例", code: "steps = [\"请求网页\", \"解析内容\", \"保存结果\"]\nfor step in steps:\n    print(step)", explanation: "简单爬虫项目可先用流程列表明确请求、解析和保存三个阶段。" }],
      practiceTasks: ["完成一个与简单爬虫项目相关的可评分练习", "说明简单爬虫项目中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "简单爬虫项目最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY044", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明简单爬虫项目的核心作用。", answer: "简单爬虫通常包含请求网页、解析内容和保存结果三个步骤。", sourceId: "PY044", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：简单爬虫项目可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY044", factId: "F003" },
        { level: 3, type: "practice", question: "围绕简单爬虫项目完成一个小任务。", answer: "能体现：简单爬虫通常包含请求网页、解析内容和保存结果三个步骤。", sourceId: "PY044", factId: "F001" }
      ],
    },
    {
      sourceId: "PY045",
      title: "面向对象综合练习",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY045_面向对象综合练习.md",
      snippet: "面向对象综合练习通常先识别对象、属性和方法。",
      prerequisites: ["K007", "K009"],
      keywords: ["面向对象综合", "类设计", "对象列表", "方法调用", "项目练习"],
      facts: [
        { sourceId: "PY045", factId: "F001", source_id: "PY045", fact_id: "F001", content: "面向对象综合练习通常先识别对象、属性和方法。" },
        { sourceId: "PY045", factId: "F002", source_id: "PY045", fact_id: "F002", content: "对象列表可保存多个同类实例。" },
        { sourceId: "PY045", factId: "F003", source_id: "PY045", fact_id: "F003", content: "方法调用可让每个对象执行自己的行为。" }
      ],
      examples: [{ title: "面向对象综合练习示例", code: "class Student:\n    def __init__(self, name, score):\n        self.name = name\n        self.score = score\n    def passed(self):\n        return self.score >= 60\nstudents = [Student(\"小明\", 92), Student(\"小红\", 55)]\nprint([s.name for s in students if s.passed()])", explanation: "Student 类封装姓名、成绩和是否及格的行为。" }],
      practiceTasks: ["完成一个与面向对象综合练习相关的可评分练习", "说明面向对象综合练习中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "面向对象综合练习最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY045", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明面向对象综合练习的核心作用。", answer: "面向对象综合练习通常先识别对象、属性和方法。", sourceId: "PY045", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：面向对象综合练习可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY045", factId: "F003" },
        { level: 3, type: "practice", question: "围绕面向对象综合练习完成一个小任务。", answer: "能体现：面向对象综合练习通常先识别对象、属性和方法。", sourceId: "PY045", factId: "F001" }
      ],
    },
    {
      sourceId: "PY046",
      title: "异常与文件综合练习",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY046_异常与文件综合练习.md",
      snippet: "文件操作可能遇到文件不存在等异常。",
      prerequisites: ["K007", "K009"],
      keywords: ["异常文件综合", "文件异常", "try except", "安全读取", "错误提示"],
      facts: [
        { sourceId: "PY046", factId: "F001", source_id: "PY046", fact_id: "F001", content: "文件操作可能遇到文件不存在等异常。" },
        { sourceId: "PY046", factId: "F002", source_id: "PY046", fact_id: "F002", content: "try/except 可用于给文件读取错误提供友好提示。" },
        { sourceId: "PY046", factId: "F003", source_id: "PY046", fact_id: "F003", content: "异常与文件综合练习应区分正常读取和错误处理路径。" }
      ],
      examples: [{ title: "异常与文件综合练习示例", code: "try:\n    with open(\"scores.txt\", \"r\", encoding=\"utf-8\") as f:\n        print(f.read())\nexcept FileNotFoundError:\n    print(\"文件不存在\")", explanation: "try/except 让文件不存在时输出友好提示而不是直接终止。" }],
      practiceTasks: ["完成一个与异常与文件综合练习相关的可评分练习", "说明异常与文件综合练习中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "异常与文件综合练习最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY046", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明异常与文件综合练习的核心作用。", answer: "文件操作可能遇到文件不存在等异常。", sourceId: "PY046", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：异常与文件综合练习可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY046", factId: "F003" },
        { level: 3, type: "practice", question: "围绕异常与文件综合练习完成一个小任务。", answer: "能体现：文件操作可能遇到文件不存在等异常。", sourceId: "PY046", factId: "F001" }
      ],
    },
    {
      sourceId: "PY047",
      title: "模块化项目结构",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY047_模块化项目结构.md",
      snippet: "模块化项目结构把入口程序和工具函数分开组织。",
      prerequisites: ["K007", "K009"],
      keywords: ["模块化项目", "项目结构", "main", "工具模块", "职责拆分"],
      facts: [
        { sourceId: "PY047", factId: "F001", source_id: "PY047", fact_id: "F001", content: "模块化项目结构把入口程序和工具函数分开组织。" },
        { sourceId: "PY047", factId: "F002", source_id: "PY047", fact_id: "F002", content: "main 文件通常负责组织流程。" },
        { sourceId: "PY047", factId: "F003", source_id: "PY047", fact_id: "F003", content: "工具模块通常保存可复用函数。" }
      ],
      examples: [{ title: "模块化项目结构示例", code: "# score_tools.py\ndef average(scores):\n    return sum(scores) / len(scores)\n\n# main.py\nscores = [80, 90, 70]\nprint(average(scores))", explanation: "入口流程和工具函数分离后，项目结构更清晰。" }],
      practiceTasks: ["完成一个与模块化项目结构相关的可评分练习", "说明模块化项目结构中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "模块化项目结构最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY047", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明模块化项目结构的核心作用。", answer: "模块化项目结构把入口程序和工具函数分开组织。", sourceId: "PY047", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：模块化项目结构可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY047", factId: "F003" },
        { level: 3, type: "practice", question: "围绕模块化项目结构完成一个小任务。", answer: "能体现：模块化项目结构把入口程序和工具函数分开组织。", sourceId: "PY047", factId: "F001" }
      ],
    },
    {
      sourceId: "PY048",
      title: "Python 二级考试常见题型",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY048_Python_二级考试常见题型.md",
      snippet: "Python 二级考试常见题型包括选择题、程序填空和编程题。",
      prerequisites: ["K007", "K009"],
      keywords: ["Python二级", "考试题型", "选择题", "程序填空", "编程题"],
      facts: [
        { sourceId: "PY048", factId: "F001", source_id: "PY048", fact_id: "F001", content: "Python 二级考试常见题型包括选择题、程序填空和编程题。" },
        { sourceId: "PY048", factId: "F002", source_id: "PY048", fact_id: "F002", content: "程序填空题要求在上下文中补全关键语句。" },
        { sourceId: "PY048", factId: "F003", source_id: "PY048", fact_id: "F003", content: "编程题要求完成可运行程序并满足题目输出要求。" }
      ],
      examples: [{ title: "Python 二级考试常见题型示例", code: "question_types = [\"选择题\", \"程序填空\", \"编程题\"]\nfor item in question_types:\n    print(item)", explanation: "列举常见题型有助于组织训练题库。" }],
      practiceTasks: ["完成一个与Python 二级考试常见题型相关的可评分练习", "说明Python 二级考试常见题型中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "Python 二级考试常见题型最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY048", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明Python 二级考试常见题型的核心作用。", answer: "Python 二级考试常见题型包括选择题、程序填空和编程题。", sourceId: "PY048", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：Python 二级考试常见题型可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY048", factId: "F003" },
        { level: 3, type: "practice", question: "围绕Python 二级考试常见题型完成一个小任务。", answer: "能体现：Python 二级考试常见题型包括选择题、程序填空和编程题。", sourceId: "PY048", factId: "F001" }
      ],
    },
    {
      sourceId: "PY049",
      title: "编程题测试用例设计",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY049_编程题测试用例设计.md",
      snippet: "编程题测试用例用于检查程序输出是否符合要求。",
      prerequisites: ["K007", "K009"],
      keywords: ["测试用例", "公开测试", "隐藏测试", "边界情况", "编程题评分"],
      facts: [
        { sourceId: "PY049", factId: "F001", source_id: "PY049", fact_id: "F001", content: "编程题测试用例用于检查程序输出是否符合要求。" },
        { sourceId: "PY049", factId: "F002", source_id: "PY049", fact_id: "F002", content: "公开测试用例帮助学习者理解输入输出格式。" },
        { sourceId: "PY049", factId: "F003", source_id: "PY049", fact_id: "F003", content: "隐藏测试用例用于检查边界情况和防止硬编码。" }
      ],
      examples: [{ title: "编程题测试用例设计示例", code: "test_cases = [\n    {\"input\": [1, 2, 3], \"expected\": 6, \"hidden\": False},\n    {\"input\": [], \"expected\": 0, \"hidden\": True},\n]\nprint(test_cases)", explanation: "公开用例展示格式，隐藏用例检查边界情况。" }],
      practiceTasks: ["完成一个与编程题测试用例设计相关的可评分练习", "说明编程题测试用例设计中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "编程题测试用例设计最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY049", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明编程题测试用例设计的核心作用。", answer: "编程题测试用例用于检查程序输出是否符合要求。", sourceId: "PY049", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：编程题测试用例设计可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY049", factId: "F003" },
        { level: 3, type: "practice", question: "围绕编程题测试用例设计完成一个小任务。", answer: "能体现：编程题测试用例用于检查程序输出是否符合要求。", sourceId: "PY049", factId: "F001" }
      ],
    },
    {
      sourceId: "PY050",
      title: "综合训练卷组织",
      module: "Python程序设计",
      difficulty: "integrated",
      file: "knowledge_base/python_programming/PY050_综合训练卷组织.md",
      snippet: "综合训练卷应覆盖多个知识点而不是只考单一概念。",
      prerequisites: ["K007", "K009"],
      keywords: ["综合训练卷", "诊断题", "训练题", "考试题", "题目组织"],
      facts: [
        { sourceId: "PY050", factId: "F001", source_id: "PY050", fact_id: "F001", content: "综合训练卷应覆盖多个知识点而不是只考单一概念。" },
        { sourceId: "PY050", factId: "F002", source_id: "PY050", fact_id: "F002", content: "训练卷可按诊断、训练和考试用途组织题目。" },
        { sourceId: "PY050", factId: "F003", source_id: "PY050", fact_id: "F003", content: "综合训练卷应保留每题的 source_id 和 fact_id 以便审核。" }
      ],
      examples: [{ title: "综合训练卷组织示例", code: "paper = {\n    \"diagnostic\": [\"Q1\"],\n    \"training\": [\"Q2\"],\n    \"exam\": [\"Q3\"],\n}\nprint(paper)", explanation: "用用途字段组织题目，有助于诊断、训练和考试分层。" }],
      practiceTasks: ["完成一个与综合训练卷组织相关的可评分练习", "说明综合训练卷组织中的关键步骤"],
      quizItems: [
        { level: 1, type: "choice", question: "综合训练卷组织最需要保留什么以便审核？", options: ["source_id 和 fact_id", "随机口号", "隐藏答案在题干里", "无关图片"], answer: "source_id 和 fact_id", sourceId: "PY050", factId: "F003" },
        { level: 2, type: "short_answer", question: "说明综合训练卷组织的核心作用。", answer: "综合训练卷应覆盖多个知识点而不是只考单一概念。", sourceId: "PY050", factId: "F001" },
        { level: 2, type: "debugging", question: "判断正误：综合训练卷组织可以脱离规则和证据随意生成。", answer: "错误。应依据明确规则和可追溯事实组织。", sourceId: "PY050", factId: "F003" },
        { level: 3, type: "practice", question: "围绕综合训练卷组织完成一个小任务。", answer: "能体现：综合训练卷应覆盖多个知识点而不是只考单一概念。", sourceId: "PY050", factId: "F001" }
      ],
    },
    {
      sourceId: "PY051",
      title: "SQLite 数据库连接",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY051_SQLite_数据库连接.md",
      snippet: "SQLite 数据库连接用于让 Python 程序访问本地数据库文件。",
      prerequisites: ["K017", "K016"],
      keywords: ["SQLite", "sqlite3", "数据库连接", "connect", "本地数据库"],
      facts: [
        { sourceId: "PY051", factId: "F001", source_id: "PY051", fact_id: "F001", content: "SQLite 是轻量级本地数据库，适合入门级持久化练习。" },
        { sourceId: "PY051", factId: "F002", source_id: "PY051", fact_id: "F002", content: "Python 的 sqlite3 模块可通过 connect 打开或创建数据库文件。" },
        { sourceId: "PY051", factId: "F003", source_id: "PY051", fact_id: "F003", content: "数据库连接使用后应提交事务并关闭连接。" }
      ],
      examples: [{ title: "SQLite 数据库连接示例", code: "import sqlite3\n\nconn = sqlite3.connect(\"students.db\")\nconn.close()", explanation: "sqlite3.connect 打开或创建 students.db，使用结束后关闭连接。" }],
      practiceTasks: ["用 sqlite3.connect 创建本地数据库连接", "说明数据库连接为什么需要关闭"],
      quizItems: [
        { level: 1, type: "choice", question: "sqlite3.connect 的主要作用是什么？", options: ["打开或创建 SQLite 数据库连接", "不需要数据库连接", "可以脱离 source_id/fact_id", "只适合图形界面"], answer: "打开或创建 SQLite 数据库连接", sourceId: "PY051", factId: "F001" },
        { level: 2, type: "short_answer", question: "为什么连接使用后需要关闭？", answer: "数据库连接使用后应提交事务并关闭连接。", sourceId: "PY051", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：SQLite 只能连接远程服务器。", answer: "错误。SQLite 是轻量级本地数据库，适合入门级持久化练习。", sourceId: "PY051", factId: "F003" },
        { level: 3, type: "practice", question: "写代码连接 students.db 并关闭连接。", answer: "能使用 sqlite3.connect 并调用 close。", sourceId: "PY051", factId: "F001" }
      ],
    },
    {
      sourceId: "PY052",
      title: "表结构与字段",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY052_表结构与字段.md",
      snippet: "数据库表结构定义了记录包含哪些字段。",
      prerequisites: ["PY051", "K010"],
      keywords: ["表结构", "字段", "CREATE TABLE", "主键", "数据表"],
      facts: [
        { sourceId: "PY052", factId: "F001", source_id: "PY052", fact_id: "F001", content: "数据库表结构定义了记录包含哪些字段。" },
        { sourceId: "PY052", factId: "F002", source_id: "PY052", fact_id: "F002", content: "CREATE TABLE 语句可创建数据表。" },
        { sourceId: "PY052", factId: "F003", source_id: "PY052", fact_id: "F003", content: "主键字段常用于唯一标识一条记录。" }
      ],
      examples: [{ title: "表结构与字段示例", code: "create_sql = \"\"\"\nCREATE TABLE students (\n    id INTEGER PRIMARY KEY,\n    name TEXT,\n    score REAL\n)\n\"\"\"\nprint(create_sql)", explanation: "students 表包含 id、name、score 三个字段，id 作为主键。" }],
      practiceTasks: ["设计学生成绩表的字段", "写出 CREATE TABLE 建表语句"],
      quizItems: [
        { level: 1, type: "choice", question: "唯一标识一条记录常用什么字段？", options: ["主键字段", "不需要数据库连接", "可以脱离 source_id/fact_id", "只适合图形界面"], answer: "主键字段", sourceId: "PY052", factId: "F001" },
        { level: 2, type: "short_answer", question: "CREATE TABLE 的作用是什么？", answer: "CREATE TABLE 语句可创建数据表。", sourceId: "PY052", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：表结构不需要定义字段。", answer: "错误。数据库表结构定义了记录包含哪些字段。", sourceId: "PY052", factId: "F003" },
        { level: 3, type: "practice", question: "写出包含 id/name/score 的 students 表结构。", answer: "能写出 CREATE TABLE 和字段定义。", sourceId: "PY052", factId: "F001" }
      ],
    },
    {
      sourceId: "PY053",
      title: "INSERT 与 SELECT 基础",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY053_INSERT_与_SELECT_基础.md",
      snippet: "INSERT 用于向表中插入记录。",
      prerequisites: ["PY052"],
      keywords: ["INSERT", "SELECT", "插入记录", "查询记录", "SQL基础"],
      facts: [
        { sourceId: "PY053", factId: "F001", source_id: "PY053", fact_id: "F001", content: "INSERT 用于向表中插入记录。" },
        { sourceId: "PY053", factId: "F002", source_id: "PY053", fact_id: "F002", content: "SELECT 用于从表中查询记录。" },
        { sourceId: "PY053", factId: "F003", source_id: "PY053", fact_id: "F003", content: "查询结果通常需要逐行读取或遍历处理。" }
      ],
      examples: [{ title: "INSERT 与 SELECT 基础示例", code: "insert_sql = \"INSERT INTO students(name, score) VALUES (?, ?)\"\nselect_sql = \"SELECT name, score FROM students\"\nprint(insert_sql)\nprint(select_sql)", explanation: "INSERT 写入学生成绩，SELECT 查询学生姓名和成绩。" }],
      practiceTasks: ["写 INSERT 语句插入学生成绩", "写 SELECT 语句查询学生成绩"],
      quizItems: [
        { level: 1, type: "choice", question: "从数据库表中查询记录常用哪个 SQL 关键字？", options: ["SELECT", "不需要数据库连接", "可以脱离 source_id/fact_id", "只适合图形界面"], answer: "SELECT", sourceId: "PY053", factId: "F001" },
        { level: 2, type: "short_answer", question: "INSERT 的作用是什么？", answer: "INSERT 用于向表中插入记录。", sourceId: "PY053", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：SELECT 用于删除记录。", answer: "错误。SELECT 用于从表中查询记录。", sourceId: "PY053", factId: "F003" },
        { level: 3, type: "practice", question: "写出插入并查询 students 表记录的 SQL 思路。", answer: "能区分 INSERT 插入和 SELECT 查询。", sourceId: "PY053", factId: "F001" }
      ],
    },
    {
      sourceId: "PY054",
      title: "UPDATE 与 DELETE 基础",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY054_UPDATE_与_DELETE_基础.md",
      snippet: "UPDATE 用于修改已有记录。",
      prerequisites: ["PY053"],
      keywords: ["UPDATE", "DELETE", "WHERE", "更新记录", "删除记录"],
      facts: [
        { sourceId: "PY054", factId: "F001", source_id: "PY054", fact_id: "F001", content: "UPDATE 用于修改已有记录。" },
        { sourceId: "PY054", factId: "F002", source_id: "PY054", fact_id: "F002", content: "DELETE 用于删除已有记录。" },
        { sourceId: "PY054", factId: "F003", source_id: "PY054", fact_id: "F003", content: "UPDATE 和 DELETE 通常应配合 WHERE 条件限定影响范围。" }
      ],
      examples: [{ title: "UPDATE 与 DELETE 基础示例", code: "update_sql = \"UPDATE students SET score = ? WHERE name = ?\"\ndelete_sql = \"DELETE FROM students WHERE name = ?\"\nprint(update_sql)\nprint(delete_sql)", explanation: "WHERE 条件限定被更新或删除的学生记录。" }],
      practiceTasks: ["写 UPDATE 语句修改指定学生成绩", "说明 DELETE 为什么通常要加 WHERE"],
      quizItems: [
        { level: 1, type: "choice", question: "修改已有记录常用哪个 SQL 关键字？", options: ["UPDATE", "不需要数据库连接", "可以脱离 source_id/fact_id", "只适合图形界面"], answer: "UPDATE", sourceId: "PY054", factId: "F001" },
        { level: 2, type: "short_answer", question: "WHERE 在 UPDATE/DELETE 中有什么作用？", answer: "UPDATE 和 DELETE 通常应配合 WHERE 条件限定影响范围。", sourceId: "PY054", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：DELETE 不需要限定条件也一定安全。", answer: "错误。DELETE 通常应配合 WHERE 条件限定影响范围。", sourceId: "PY054", factId: "F003" },
        { level: 3, type: "practice", question: "写出按姓名更新学生成绩的 SQL 思路。", answer: "能使用 UPDATE SET 和 WHERE 条件。", sourceId: "PY054", factId: "F001" }
      ],
    },
    {
      sourceId: "PY055",
      title: "参数化查询与安全",
      module: "Python程序设计",
      difficulty: "intermediate",
      file: "knowledge_base/python_programming/PY055_参数化查询与安全.md",
      snippet: "参数化查询把 SQL 模板和参数值分开传入。",
      prerequisites: ["PY053", "PY054"],
      keywords: ["参数化查询", "SQL注入", "占位符", "execute", "安全查询"],
      facts: [
        { sourceId: "PY055", factId: "F001", source_id: "PY055", fact_id: "F001", content: "参数化查询把 SQL 模板和参数值分开传入。" },
        { sourceId: "PY055", factId: "F002", source_id: "PY055", fact_id: "F002", content: "使用占位符传参可降低 SQL 注入风险。" },
        { sourceId: "PY055", factId: "F003", source_id: "PY055", fact_id: "F003", content: "不要把用户输入直接拼接进 SQL 字符串。" }
      ],
      examples: [{ title: "参数化查询与安全示例", code: "sql = \"SELECT score FROM students WHERE name = ?\"\nparams = (\"小明\",)\nprint(sql, params)", explanation: "? 是占位符，用户输入通过参数传入而不是拼接到 SQL 中。" }],
      practiceTasks: ["把用户输入作为参数传入查询语句", "说明为什么不要直接拼接 SQL 字符串"],
      quizItems: [
        { level: 1, type: "choice", question: "降低 SQL 注入风险的常见做法是什么？", options: ["使用占位符传参", "不需要数据库连接", "可以脱离 source_id/fact_id", "只适合图形界面"], answer: "使用占位符传参", sourceId: "PY055", factId: "F001" },
        { level: 2, type: "short_answer", question: "参数化查询是什么意思？", answer: "参数化查询把 SQL 模板和参数值分开传入。", sourceId: "PY055", factId: "F002" },
        { level: 2, type: "debugging", question: "判断正误：可以把用户输入直接拼接进 SQL 字符串。", answer: "错误。不要把用户输入直接拼接进 SQL 字符串。", sourceId: "PY055", factId: "F003" },
        { level: 3, type: "practice", question: "写出按姓名查询成绩的参数化 SQL 思路。", answer: "能使用占位符和参数元组。", sourceId: "PY055", factId: "F001" }
      ],
    }
  ],
}

