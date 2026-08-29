import type { GoalChangeInput } from "./path-registry-store"

export interface PathResumeInput {
  path_id: string
}

export type PathApiSchemaResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] }

export function validatePathChangeBody(value: unknown): PathApiSchemaResult<GoalChangeInput> {
  if (!isRecord(value)) return { ok: false, errors: ["request body must be an object"] }
  const errors: string[] = []
  if (!safeId(value.path_id)) errors.push("path_id is required and must be safe")
  if (typeof value.goal !== "string" || value.goal.trim().length === 0 || value.goal.length > 2_000) {
    errors.push("goal is required and must be at most 2000 characters")
  }
  if (!isGoalProfile(value.goal_profile)) errors.push("goal_profile is invalid")
  return errors.length ? { ok: false, errors } : {
    ok: true,
    value: {
      path_id: value.path_id as string,
      goal: (value.goal as string).trim(),
      goal_profile: value.goal_profile as GoalChangeInput["goal_profile"],
    },
  }
}

export interface ResumeDiagnosisAnswersInput {
  path_id: string
  answers: Record<string, string>
}

export function validateResumeDiagnosisAnswers(value: unknown): PathApiSchemaResult<ResumeDiagnosisAnswersInput> {
  if (!isRecord(value) || !safeId(value.path_id) || !isRecord(value.answers)) {
    return { ok: false, errors: ["path_id and answers are required"] }
  }
  const entries = Object.entries(value.answers)
  if (entries.length === 0 || entries.length > 20) return { ok: false, errors: ["answers must contain 1..20 items"] }
  if (entries.some(([key, answer]) => !safeId(key) || typeof answer !== "string" || answer.length > 1_000)) {
    return { ok: false, errors: ["answers contain an unsafe or oversized item"] }
  }
  return { ok: true, value: { path_id: value.path_id as string, answers: Object.fromEntries(entries) as Record<string, string> } }
}

export function validatePathResumeBody(value: unknown): PathApiSchemaResult<PathResumeInput> {
  if (!isRecord(value) || !safeId(value.path_id)) {
    return { ok: false, errors: ["path_id is required and must be safe"] }
  }
  return { ok: true, value: { path_id: value.path_id as string } }
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value)
}

function isGoalProfile(value: unknown): value is GoalChangeInput["goal_profile"] {
  return value === "coursework"
    || value === "algorithm_competition"
    || value === "job_interview"
    || value === "general_learning"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
