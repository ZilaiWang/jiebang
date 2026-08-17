/**
 * 循环/列表遍历交互可视化（Day6 方案 C，加分项）。
 *
 * 轻量实现：用正则识别 `for <var> in [<list 字面量>]:` 形式的遍历代码，
 * 逐步展示「循环变量值、当前元素、已遍历/未遍历元素、循环次数」。
 * 不做完整 AST 解析（保持零依赖、对任意代码安全），仅匹配可直接
 * 取值的列表字面量；匹配不上返回 null（组件不渲染）。
 */

export interface LoopParsed {
  variable: string
  elements: string[]
}

const LIST_ITEM_PATTERN = /^(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([-+]?\d+(?:\.\d+)?)|(True|False|None))$/u

function splitListItems(body: string): string[] | null {
  const items: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaped = false
  for (const character of body) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === "\\" && quote) {
      current += character
      escaped = true
      continue
    }
    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    if (character === ",") {
      items.push(current.trim())
      current = ""
      continue
    }
    current += character
  }
  if (quote || escaped) return null
  items.push(current.trim())
  return items
}

/** 从 `for x in [...]` 代码提取循环变量与列表元素；非遍历代码返回 null。 */
export function parseLoopVisualization(code: string): LoopParsed | null {
  const match = /for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+\[([^\]]*)\]\s*:/u.exec(code)
  if (!match) return null
  const variable = match[1]!
  const body = match[2] ?? ""
  const elements: string[] = []
  const rawItems = splitListItems(body)
  if (!rawItems) return null
  for (const raw of rawItems) {
    const item = raw.trim()
    if (!item) continue
    const parsed = LIST_ITEM_PATTERN.exec(item)
    if (!parsed) return null // 出现无法取值的内容（表达式/嵌套），放弃可视化
    elements.push(parsed[1] ?? parsed[2] ?? parsed[3] ?? parsed[4] ?? item)
  }
  if (elements.length === 0) return null
  return { variable, elements }
}

export interface LoopStepView {
  /** 已完成的循环次数（0 = 尚未开始）。 */
  round: number
  variable: string
  /** 当前正在处理的元素（round>0 时有效）。 */
  current: string | null
  visited: string[]
  remaining: string[]
}

export function loopSteps(parsed: LoopParsed): LoopStepView[] {
  const { variable, elements } = parsed
  const steps: LoopStepView[] = [{ round: 0, variable, current: null, visited: [], remaining: [...elements] }]
  for (let i = 0; i < elements.length; i += 1) {
    steps.push({
      round: i + 1,
      variable,
      current: elements[i]!,
      visited: elements.slice(0, i + 1),
      remaining: elements.slice(i + 1),
    })
  }
  return steps
}

/** 判断一段代码是否可做循环可视化（供展示层决定是否显示入口按钮）。 */
export function canVisualizeLoop(code: string): boolean {
  return parseLoopVisualization(code) !== null
}
