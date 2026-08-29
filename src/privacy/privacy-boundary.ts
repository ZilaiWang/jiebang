import type { GoalProfile } from "../role-c-content/planning/personalization-policy"
import type { KnowledgeDifficulty } from "../knowledge/types"

export interface LearnerPrivacyInput {
  learner_id: string
  name?: string
  background?: string
  school?: string
  phone?: string
  email?: string
  level: KnowledgeDifficulty
  goal: string
  goal_profile?: GoalProfile
  known_concepts: string[]
  weak_concepts: string[]
}

export interface SanitizedLearnerModelProfile {
  learner_id: string
  level: KnowledgeDifficulty
  goal: string
  goal_profile?: GoalProfile
  known_concepts: string[]
  weak_concepts: string[]
}

export interface PrivacySafeLearnerRequest {
  learner_id?: string
  goal: string
  background?: string
  self_rating?: string
  diagnostic_seed?: string
  learning_goal_spec?: unknown
  goal_profile?: GoalProfile
  profile_intake?: unknown
}

export function sanitizeLearnerProfileForModel(input: LearnerPrivacyInput): SanitizedLearnerModelProfile {
  return {
    learner_id: input.learner_id,
    level: input.level,
    goal: redactDirectIdentifiers(input.goal),
    ...(input.goal_profile ? { goal_profile: input.goal_profile } : {}),
    known_concepts: [...input.known_concepts],
    weak_concepts: [...input.weak_concepts],
  }
}

export function anonymousLearnerId(): string {
  return `learner-${crypto.randomUUID()}`
}

export function redactDirectIdentifiers(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]")
    .replace(/(?<!\d)\d{15,18}[0-9Xx](?!\d)/g, "[REDACTED_ID]")
}

export function sanitizeFreeTextList(values: string[]): string[] {
  return values.map((value) => redactDirectIdentifiers(value).trim()).filter(Boolean)
}

export function sanitizeLearnerRequestForStorage<T extends PrivacySafeLearnerRequest>(input: T): T {
  const cloned = structuredClone(input) as T
  const candidate = cloned as T & { profile_intake?: unknown }
  if (candidate.profile_intake !== undefined) candidate.profile_intake = sanitizeProfileIntake(candidate.profile_intake)
  return {
    ...cloned,
    goal: redactDirectIdentifiers(input.goal),
    ...(input.background ? { background: redactDirectIdentifiers(input.background) } : {}),
    ...(input.diagnostic_seed ? { diagnostic_seed: redactDirectIdentifiers(input.diagnostic_seed) } : {}),
  }
}

function sanitizeProfileIntake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeProfileIntake)
  if (typeof value === "string") return redactDirectIdentifiers(value)
  if (!value || typeof value !== "object") return value
  const blockedKeys = new Set(["name", "full_name", "phone", "mobile", "email", "school", "student_id", "employee_id", "contact"])
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blockedKeys.has(key.toLowerCase()))
      .map(([key, nested]) => [key, sanitizeProfileIntake(nested)]),
  )
}

function redactNestedStrings(value: unknown): unknown {
  if (typeof value === "string") return redactDirectIdentifiers(value)
  if (Array.isArray(value)) return value.map(redactNestedStrings)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactNestedStrings(nested)]))
}
