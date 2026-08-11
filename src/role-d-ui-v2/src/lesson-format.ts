export function semanticLessonLines(text: string): string[] {
  const authored = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  return authored.flatMap((line) => {
    const marked = line
      .replace(/([。！？；])\s*(?=(?:第[一二三四五六七八九十\d]+步|步骤\s*[一二三四五六七八九十\d]+|\d+[.、]))/gu, "$1\n")
      .replace(/\s+(?=(?:第[一二三四五六七八九十\d]+步|步骤\s*[一二三四五六七八九十\d]+|\d+[.、]))/gu, "\n")
    return marked.split("\n").map((part) => part.trim()).filter(Boolean)
  })
}

/** 按书面表达格式排版：每段首行缩进两个全角空格。 */
export function indentParagraphText(text: string): string {
  const paragraphs = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  if (paragraphs.length === 0) return text
  return paragraphs.map((paragraph) => `\u3000\u3000${paragraph}`).join("\n")
}
