export interface CurrentNodeContent {
  current_source_id: string
  current_title: string
  prerequisite_source_ids: string[]
  lesson_text: string
  assessment_prompts: string[]
}

export interface CurrentNodeContentScopeResult {
  ok: boolean
  issues: string[]
}

export function validateCurrentNodeContentScope(
  content: CurrentNodeContent,
  options: { forbidden_titles: string[] },
): CurrentNodeContentScopeResult {
  const combined = [content.lesson_text, ...content.assessment_prompts]
    .join("\n")
    .normalize("NFKC")
    .toLocaleLowerCase()
  const issues = options.forbidden_titles
    .filter((title) => title.trim().length > 0)
    .filter((title) => combined.includes(title.normalize("NFKC").toLocaleLowerCase()))
    .map((title) => `current node ${content.current_source_id}/${content.current_title} contains unrelated topic: ${title}`)
  return { ok: issues.length === 0, issues }
}
