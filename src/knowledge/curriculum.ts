export interface CurriculumNode {
  node_id: string
  title: string
  module?: string
  source_ids: string[]
  children: CurriculumNode[]
}

export interface LearningGoalSpecInput {
  mode: "curriculum_node" | "custom_goal"
  selected_node_ids?: string[]
  custom_goal?: string
}

export interface LearningGoalSpec {
  mode: "curriculum_node" | "custom_goal"
  selected_node_ids: string[]
  custom_goal?: string
  mapped_source_ids: string[]
  goal_text: string
}

const TREE: CurriculumNode = {
  node_id: "PY",
  title: "Python基础",
  module: "Python基础",
  source_ids: [],
  children: [
    {
      node_id: "PY-CH01",
      title: "Python 入门基础",
      source_ids: ["K001", "K002", "K003", "K004", "K005"],
      children: [
        leaf("PY-CH01-S01", "Python 是什么", ["K001"]),
        leaf("PY-CH01-S02", "变量与赋值", ["K002"]),
        leaf("PY-CH01-S03", "基本数据类型", ["K003"]),
        leaf("PY-CH01-S04", "输入输出", ["K004"]),
        leaf("PY-CH01-S05", "运算符", ["K005"]),
      ],
    },
    {
      node_id: "PY-CH02",
      title: "控制结构",
      source_ids: ["K006", "K007", "K008"],
      children: [
        leaf("PY-CH02-S01", "条件判断", ["K006"]),
        leaf("PY-CH02-S02", "for 循环", ["K007"]),
        leaf("PY-CH02-S03", "while 循环", ["K008"]),
      ],
    },
    {
      node_id: "PY-CH03",
      title: "数据容器与综合项目",
      source_ids: ["K009", "K010", "K011", "K012"],
      children: [
        leaf("PY-CH03-S01", "列表", ["K009"]),
        leaf("PY-CH03-S02", "字典", ["K010"]),
        leaf("PY-CH03-S03", "元组与集合", ["K011"]),
        leaf("PY-CH03-S04", "字符串常用操作", ["K012"]),
      ],
    },
    {
      node_id: "PY-CH04",
      title: "函数、文件与项目实践",
      source_ids: ["K013", "K014", "K015", "K016", "K017", "K018"],
      children: [
        leaf("PY-CH04-S01", "函数定义与调用", ["K013"]),
        leaf("PY-CH04-S02", "参数与返回值", ["K014"]),
        leaf("PY-CH04-S03", "成绩统计器综合项目", ["K018"]),
        leaf("PY-CH04-S04", "文件读写", ["K015"]),
        leaf("PY-CH04-S05", "异常处理与模块", ["K016", "K017"]),
      ],
    },
    {
      node_id: "PY-PROG",
      title: "Python程序设计进阶",
      module: "Python程序设计",
      source_ids: ["PY019", "PY020", "PY021", "PY022", "PY023", "PY024", "PY025", "PY026", "PY027", "PY028", "PY029", "PY030", "PY031", "PY032", "PY033", "PY034", "PY035", "PY036", "PY037", "PY038", "PY039", "PY040", "PY041", "PY042", "PY043", "PY044", "PY045", "PY046", "PY047", "PY048", "PY049", "PY050", "PY051", "PY052", "PY053", "PY054", "PY055"],
      children: [
        leaf("PY-PROG-S01", "切片进阶", ["PY019"]),
        leaf("PY-PROG-S02", "列表推导式", ["PY020"]),
        leaf("PY-PROG-S03", "字典方法进阶", ["PY021"]),
        leaf("PY-PROG-S04", "集合运算", ["PY022"]),
        leaf("PY-PROG-S05", "字符串格式化", ["PY023"]),
        leaf("PY-PROG-S06", "文件逐行处理", ["PY024"]),
        leaf("PY-PROG-S07", "函数默认参数", ["PY025"]),
        leaf("PY-PROG-S08", "lambda 与排序键", ["PY026"]),
        leaf("PY-PROG-S09", "模块化程序设计", ["PY027"]),
        leaf("PY-PROG-S10", "类与实例", ["PY028"]),
        leaf("PY-PROG-S11", "方法与对象状态", ["PY029"]),
        leaf("PY-PROG-S12", "继承与方法重写", ["PY030"]),
        leaf("PY-PROG-S13", "random 常用操作", ["PY031"]),
        leaf("PY-PROG-S14", "math 常用操作", ["PY032"]),
        leaf("PY-PROG-S15", "time 与 datetime 基础", ["PY033"]),
        leaf("PY-PROG-S16", "GUI 基础概念", ["PY034"]),
        leaf("PY-PROG-S17", "CSV 文本数据处理", ["PY035"]),
        leaf("PY-PROG-S18", "jieba 中文分词概念", ["PY036"]),
        leaf("PY-PROG-S19", "wordcloud 词云概念", ["PY037"]),
        leaf("PY-PROG-S20", "requests 请求基础", ["PY038"]),
        leaf("PY-PROG-S21", "BeautifulSoup HTML 解析概念", ["PY039"]),
        leaf("PY-PROG-S22", "正则表达式基础", ["PY040"]),
        leaf("PY-PROG-S23", "数据清洗小项目", ["PY041"]),
        leaf("PY-PROG-S24", "成绩管理综合项目", ["PY042"]),
        leaf("PY-PROG-S25", "文本词频统计项目", ["PY043"]),
        leaf("PY-PROG-S26", "简单爬虫项目", ["PY044"]),
        leaf("PY-PROG-S27", "面向对象综合练习", ["PY045"]),
        leaf("PY-PROG-S28", "异常与文件综合练习", ["PY046"]),
        leaf("PY-PROG-S29", "模块化项目结构", ["PY047"]),
        leaf("PY-PROG-S30", "Python 二级考试常见题型", ["PY048"]),
        leaf("PY-PROG-S31", "编程题测试用例设计", ["PY049"]),
        leaf("PY-PROG-S32", "综合训练卷组织", ["PY050"]),
        leaf("PY-PROG-S33", "SQLite 数据库连接", ["PY051"]),
        leaf("PY-PROG-S34", "表结构与字段", ["PY052"]),
        leaf("PY-PROG-S35", "INSERT 与 SELECT 基础", ["PY053"]),
        leaf("PY-PROG-S36", "UPDATE 与 DELETE 基础", ["PY054"]),
        leaf("PY-PROG-S37", "参数化查询与安全", ["PY055"]),
      ],
    },
    {
      node_id: "AI-CH01",
      title: "现代人工智能基础",
      module: "现代人工智能基础",
      source_ids: ["AI001", "AI002", "AI003", "AI004", "AI005", "AI006"],
      children: [
        leaf("AI-CH01-S01", "AI、机器学习与深度学习", ["AI001"]),
        leaf("AI-CH01-S02", "数据集、特征与标签", ["AI002"]),
        leaf("AI-CH01-S03", "训练测试划分与过拟合", ["AI003"]),
        leaf("AI-CH01-S04", "分类、回归与聚类", ["AI004"]),
        leaf("AI-CH01-S05", "LLM、Prompt 与 RAG", ["AI005"]),
        leaf("AI-CH01-S06", "多智能体协作与事实审核", ["AI006"]),
      ],
    },
  ],
}

export function getPythonCurriculumTree(): CurriculumNode {
  return structuredClone(TREE)
}

export function mapCurriculumNodeToSourceIds(nodeId: string): string[] {
  const node = findNode(TREE, nodeId)
  return node ? [...node.source_ids] : []
}

export function resolveLearningGoalSpec(input: LearningGoalSpecInput): LearningGoalSpec {
  if (input.mode === "curriculum_node") {
    const selected = input.selected_node_ids ?? []
    const nodes = selected.map((nodeId) => findNode(TREE, nodeId)).filter((node): node is CurriculumNode => Boolean(node))
    const mapped = unique(nodes.flatMap((node) => node.source_ids))
    return {
      mode: "curriculum_node",
      selected_node_ids: selected,
      mapped_source_ids: mapped,
      goal_text: nodes.length > 0 ? `学习${nodes.map((node) => node.title).join("、")}` : "学习 Python 基础",
    }
  }

  const customGoal = input.custom_goal?.trim() ?? ""
  return {
    mode: "custom_goal",
    selected_node_ids: [],
    custom_goal: customGoal,
    mapped_source_ids: mapCustomGoalToSourceIds(customGoal),
    goal_text: customGoal,
  }
}

function mapCustomGoalToSourceIds(goal: string): string[] {
  const rules: Array<[RegExp, string[]]> = [
    [/成绩|统计|平均|项目/, ["K007", "K009", "K018"]],
    [/循环|遍历|for/, ["K007"]],
    [/while|条件循环/, ["K008"]],
    [/列表|数组|一组数据/, ["K009"]],
    [/条件|判断|if/, ["K006"]],
    [/函数|def|return/, ["K013", "K014"]],
    [/输入|输出|print|input/, ["K004"]],
    [/切片|slice|倒序|索引范围/, ["PY019"]],
    [/列表推导式|推导式|筛选数据|生成列表/, ["PY020"]],
    [/字典方法|get|items|keys|values|安全访问/, ["PY021"]],
    [/集合运算|交集|并集|差集|共同元素/, ["PY022"]],
    [/字符串格式化|f-string|format|保留小数|格式化输出/, ["PY023"]],
    [/逐行读取|逐行处理|for line|strip|行统计/, ["PY024"]],
    [/默认参数|关键字参数|参数默认值|可选参数/, ["PY025"]],
    [/lambda|排序键|key|sorted|匿名函数|成绩排序/, ["PY026"]],
    [/模块化|分文件|自定义模块|程序结构/, ["PY027"]],
    [/类|class|实例|对象|属性|面向对象/, ["PY028"]],
    [/方法|self|对象状态|实例方法|属性更新/, ["PY029"]],
    [/继承|方法重写|子类|父类|override/, ["PY030"]],
    [/random|随机数|randint|随机整数|随机选择|choice/, ["PY031"]],
    [/math|sqrt|平方根|ceil|floor|圆周率|数学函数/, ["PY032"]],
    [/datetime|time|日期|时间|strftime|当前日期/, ["PY033"]],
    [/GUI|图形界面|窗口|按钮|事件处理|tkinter/i, ["PY034"]],
    [/CSV|csv|逗号分隔|表格数据|成绩表/i, ["PY035"]],
    [/jieba|中文分词|分词|词语切分/, ["PY036"]],
    [/wordcloud|词云|文本可视化|关键词展示/i, ["PY037"]],
    [/requests|HTTP|网络请求|网页请求|GET|响应状态/i, ["PY038"]],
    [/BeautifulSoup|HTML解析|网页解析|标签|find|select/i, ["PY039"]],
    [/正则表达式|regex|\bre\b|模式匹配|findall|文本匹配/i, ["PY040"]],
    [/数据清洗|缺失值|异常值|去重|标准化/, ["PY041"]],
    [/成绩管理|学生成绩|增删改查/, ["PY042"]],
    [/词频统计|文本统计|字典累计/, ["PY043"]],
    [/简单爬虫|爬虫流程|网页获取|数据提取/, ["PY044"]],
    [/面向对象综合|类设计|对象列表|项目练习/, ["PY045"]],
    [/异常文件|文件异常|try except|安全读取|错误提示/, ["PY046"]],
    [/模块化项目|项目结构|main|工具模块|职责拆分/, ["PY047"]],
    [/Python二级|二级考试|考试题型|程序填空|编程题/, ["PY048"]],
    [/测试用例|公开测试|隐藏测试|边界情况|编程题评分/, ["PY049"]],
    [/综合训练卷|诊断题|训练题|考试题|题目组织/, ["PY050"]],
    [/SQLite|sqlite3|数据库连接|本地数据库|connect/i, ["PY051"]],
    [/表结构|字段|CREATE TABLE|主键|数据表/i, ["PY052"]],
    [/INSERT|SELECT|插入记录|查询记录|SQL基础/i, ["PY053"]],
    [/UPDATE|DELETE|WHERE|更新记录|删除记录/i, ["PY054"]],
    [/参数化查询|SQL注入|占位符|execute|安全查询/i, ["PY055"]],
    [/人工智能|机器学习|深度学习|生成式AI|\bAI\b|\bML\b|\bDL\b/i, ["AI001"]],
    [/数据集|特征|标签|训练数据|测试数据/, ["AI002"]],
    [/训练集|测试集|过拟合|泛化/, ["AI003"]],
    [/分类|回归|聚类|预测|分群/, ["AI004"]],
    [/大语言模型|LLM|提示词|prompt|RAG|检索增强|幻觉/i, ["AI005"]],
    [/多智能体|多Agent|Agent协作|事实审核|协同决策/i, ["AI006"]],
  ]
  return unique(rules.flatMap(([pattern, sourceIds]) => pattern.test(goal) ? sourceIds : []))
}

function findNode(node: CurriculumNode, nodeId: string): CurriculumNode | null {
  if (node.node_id === nodeId) return node
  for (const child of node.children) {
    const found = findNode(child, nodeId)
    if (found) return found
  }
  return null
}

function leaf(node_id: string, title: string, source_ids: string[]): CurriculumNode {
  return { node_id, title, source_ids, children: [] }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
