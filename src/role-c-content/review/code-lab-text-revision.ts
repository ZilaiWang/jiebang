import type { CodeLabPublicPayload } from "../contracts/artifacts"
import type { AlignmentObjection } from "../validators/alignment-validator"

export interface LabTextRevisionField { path: string; value: string }

/** Only locator-addressed prose is editable. IDs, citations, executable code and tests are frozen. */
export function planCodeLabTextRevision(payload: CodeLabPublicPayload, objections: AlignmentObjection[]): LabTextRevisionField[] | undefined {
  if (!objections.length) return undefined
  const groups = new Map<string, LabTextRevisionField[]>()
  const add = (field: string, id: string, path: string, object: object, keys: string[]) => {
    const values = object as Record<string, unknown>
    groups.set(`${field}:${id}`, keys.flatMap((key) => typeof values[key] === "string"
      ? [{ path: `${path}/${key}`, value: values[key] as string }] : []))
  }
  payload.instructions.forEach((block, i) => {
    if (block.block_type === "paragraph") add("render_content", block.block_id, `/instructions/${i}`, block, ["text"])
  })
  payload.public_tests.forEach((test, i) => add("public_test", test.test_id, `/public_tests/${i}`, test, ["description", "expected_behavior"]))
  payload.hint_ladders.forEach((ladder, i) => ladder.hints.forEach((hint, j) =>
    add("hint", `${ladder.objective_id}:hint-${hint.hint_level}`, `/hint_ladders/${i}/hints/${j}`, hint, ["text"])))
  payload.reflection_questions.forEach((text, i) => groups.set(`reflection:${payload.lab_id}:${i + 1}`, [{ path: `/reflection_questions/${i}`, value: text }]))
  const guide = payload.practical_guide
  if (guide) {
    add("practical_guide_goal", guide.guide_id, "/practical_guide", guide, ["practice_goal", "deliverable"])
    guide.readiness_checks.forEach((item, i) => add("practical_guide_readiness", item.slot_id, `/practical_guide/readiness_checks/${i}`, item, ["title", "check", "ready_when"]))
    guide.steps.forEach((item, i) => add("practical_guide_step", item.slot_id, `/practical_guide/steps/${i}`, item, ["title", "action", "input", "expected_result", "verification"]))
    guide.acceptance_criteria.forEach((item, i) => add("practical_guide_acceptance", item.criterion_id, `/practical_guide/acceptance_criteria/${i}`, item, ["description", "expected_behavior"]))
    guide.troubleshooting.forEach((item, i) => {
      add("practical_guide_troubleshooting", item.slot_id, `/practical_guide/troubleshooting/${i}`, item, ["symptom", "likely_cause", "verification"])
      groups.get(`practical_guide_troubleshooting:${item.slot_id}`)!.push(...item.recovery_steps.map((value, j) => ({ path: `/practical_guide/troubleshooting/${i}/recovery_steps/${j}`, value })))
    })
    add("practical_guide_extension", guide.extension_task.slot_id, "/practical_guide/extension_task", guide.extension_task, ["task", "changed_dimension", "verification"])
  }
  const fields = new Map<string, LabTextRevisionField>()
  for (const objection of objections) {
    if (objection.issue_type !== "unsupported_claim" || objection.fix_scope !== "artifact" || !objection.locator) return undefined
    const group = groups.get(`${objection.locator.field}:${objection.locator.ref_id}`)
    if (!group?.length) return undefined
    group.forEach((entry) => fields.set(entry.path, entry))
  }
  return [...fields.values()]
}

export function applyCodeLabTextRevision(payload: CodeLabPublicPayload, fields: LabTextRevisionField[], replacements: LabTextRevisionField[]): CodeLabPublicPayload {
  const allowed = new Map(fields.map((field) => [field.path, field]))
  if (replacements.length !== fields.length || new Set(replacements.map((entry) => entry.path)).size !== fields.length
    || replacements.some((entry) => !allowed.has(entry.path) || typeof entry.value !== "string" || !entry.value.trim())) {
    throw new Error("CODE_LAB_TEXT_REVISION_FIELDS_MISMATCH")
  }
  const result = structuredClone(payload)
  for (const replacement of replacements) {
    const parts = replacement.path.slice(1).split("/")
    let parent: any = result
    for (const part of parts.slice(0, -1)) {
      if (["__proto__", "prototype", "constructor"].includes(part)) throw new Error("INVALID_REVISION_PATH")
      parent = parent[part]
    }
    const key = parts.at(-1)!
    if (parent[key] !== allowed.get(replacement.path)!.value) throw new Error("CODE_LAB_TEXT_REVISION_BASE_CHANGED")
    parent[key] = replacement.value
    // The task card mirrors the public hint ladder; keep that existing mirror consistent.
    if (replacement.path.startsWith("/hint_ladders/")) {
      for (const hint of result.programming_task?.hint_ladders ?? []) {
        if (hint.text === allowed.get(replacement.path)!.value) hint.text = replacement.value
      }
    }
  }
  return result
}
