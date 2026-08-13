export type CPipelineState =
  | "PLANNED"
  | "GENERATING"
  | "VALIDATING"
  | "REVISING"
  | "READY"
  | "BLOCKED"
  | "FAILED"

const ALLOWED_TRANSITIONS: Record<CPipelineState, readonly CPipelineState[]> = {
  PLANNED: ["GENERATING", "BLOCKED", "FAILED"],
  GENERATING: ["VALIDATING", "BLOCKED", "FAILED"],
  VALIDATING: ["READY", "REVISING", "BLOCKED", "FAILED"],
  REVISING: ["VALIDATING", "BLOCKED", "FAILED"],
  READY: [],
  BLOCKED: [],
  FAILED: [],
}

export function transitionCState(current: CPipelineState, next: CPipelineState): CPipelineState {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new Error(`非法 C 流水线状态转换：${current} -> ${next}`)
  }
  return next
}

export function canTransitionCState(current: CPipelineState, next: CPipelineState): boolean {
  return ALLOWED_TRANSITIONS[current].includes(next)
}
