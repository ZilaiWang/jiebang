export function semanticLessonLines(text: string): string[] {
  const authored = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  return authored.flatMap((line) => {
    const marked = line
      .replace(/([。！？；：:])\s*(?=(?:第[一二三四五六七八九十\d]+步|步骤\s*[一二三四五六七八九十\d]+|\d+[.、]))/gu, "$1\n")
      .replace(/\s+(?=(?:第[一二三四五六七八九十\d]+步|步骤\s*[一二三四五六七八九十\d]+))/gu, "\n")
    return marked.split("\n").map((part) => part.trim()).filter(Boolean)
  })
}

/** 按书面表达格式排版：每段首行缩进两个全角空格。 */
export function indentParagraphText(text: string): string {
  const paragraphs = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  if (paragraphs.length === 0) return text
  return paragraphs.map((paragraph) => `\u3000\u3000${paragraph}`).join("\n")
}

/**
 * 讲义圆点列表的段落划分：
 * - 优先按空行（\n\n）切分段落；空行分隔的块是独立的段；
 * - 若全文没有空行，则每个非空行视为一段（与旧缩进排版一致）；
 * - 段落内部的换行保留为段内行（渲染时紧凑排列，不产生段间空行）；
 * - 遇到「错误理解 / 这与事实冲突 / 正确理解 / 自查方式」等结构词时，
 *   强制在词前切为新段落，让每条要点独立成段（段首由前端渲染圆点）。
 */
export function lessonPointParagraphs(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  // 结构词切分：误区辨析类文本常以“错误理解/正确的理解/自查方式”等标签组织，
  // 匹配常见变体（含“…的是”“…是”等口语化表达），在这些标签前断开为新段。
  const STRUCTURE_WORDS = /(?=错误理解|错误认知|错误观念|常见误解|常见错误|错误做法|错误说法|这与事实冲突|与事实不符|事实并非如此|正确理解|正确的理解|正确认知|正确做法|正确说法|自查方式|自查方法|如何自查|怎么自查)/gu
  const splitByStructure = trimmed.split(STRUCTURE_WORDS).map((part) => part.trim()).filter(Boolean)
  const segments = splitByStructure.length > 1
    ? splitByStructure
    : [trimmed]
  const blocks = segments.flatMap((segment) =>
    segment.split(/\n\s*\n/u).map((block) => block.trim()).filter(Boolean))
  if (blocks.length > 1) return blocks
  return trimmed.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
}

/** 讲义中的 Python 仅做显示规范化，不改写上游发布的原始代码。 */
export function normalizePythonDisplayIndentation(code: string): string {
  return code.split("\n").map((line) => {
    const leadingSpaces = line.match(/^ +/u)?.[0].length ?? 0
    if (leadingSpaces === 0 || leadingSpaces % 4 === 0) return line
    const normalizedWidth = Math.ceil(leadingSpaces / 4) * 4
    return `${" ".repeat(normalizedWidth)}${line.slice(leadingSpaces)}`
  }).join("\n")
}
