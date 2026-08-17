export type PlanPage = "home" | "goal" | "diagnosis" | "path" | "lesson" | "assessment" | "feedback" | "history"

export function planNavSection(page: PlanPage): PlanPage {
  if (page === "diagnosis") return "goal"
  if (page === "feedback") return "assessment"
  return page
}
