export interface CurriculumLeaf {
  node_id: string
  title: string
}

export interface CurriculumChapter {
  node_id: string
  title: string
  topics: CurriculumLeaf[]
  tone: "blue" | "amber" | "mint" | "lilac"
}

export const PYTHON_CURRICULUM: CurriculumChapter[] = [
  {
    node_id: "PY-CH01",
    title: "Python 入门基础",
    tone: "blue",
    topics: [
      { node_id: "PY-CH01-S01", title: "Python 是什么" },
      { node_id: "PY-CH01-S02", title: "变量与赋值" },
      { node_id: "PY-CH01-S03", title: "基本数据类型" },
      { node_id: "PY-CH01-S04", title: "输入输出" },
      { node_id: "PY-CH01-S05", title: "运算符" },
    ],
  },
  {
    node_id: "PY-CH02",
    title: "控制结构",
    tone: "amber",
    topics: [
      { node_id: "PY-CH02-S01", title: "条件判断" },
      { node_id: "PY-CH02-S02", title: "for 循环" },
      { node_id: "PY-CH02-S03", title: "while 循环" },
    ],
  },
  {
    node_id: "PY-CH03",
    title: "数据容器与综合项目",
    tone: "mint",
    topics: [
      { node_id: "PY-CH03-S01", title: "列表" },
      { node_id: "PY-CH03-S02", title: "字典" },
      { node_id: "PY-CH03-S03", title: "元组与集合" },
      { node_id: "PY-CH03-S04", title: "字符串常用操作" },
    ],
  },
  {
    node_id: "PY-CH04",
    title: "函数、文件与项目实践",
    tone: "lilac",
    topics: [
      { node_id: "PY-CH04-S01", title: "函数定义与调用" },
      { node_id: "PY-CH04-S02", title: "参数与返回值" },
      { node_id: "PY-CH04-S03", title: "成绩统计器综合项目" },
      { node_id: "PY-CH04-S04", title: "文件读写" },
      { node_id: "PY-CH04-S05", title: "异常处理与模块" },
    ],
  },
]
