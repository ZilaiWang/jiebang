import type {
  CodeLabPublicPayload,
  RenderBlock,
} from "../contracts/artifacts"
import type { PracticalGuidePublicPayload } from "../planning/practical-guide-plan"
import {
  executeTrustedReferenceWithRetry,
  type CodeRunner,
  type CodeExecutionResult,
} from "./code-runner"
import { invocationFileFixtures, validateFileFixtures } from "./file-fixtures"

export function publicLabInputCases(payload: CodeLabPublicPayload) {
  const entries = [
    ...payload.public_tests.map(test => ({ case_id: test.test_id, input: test.input })),
    ...(payload.programming_task?.public_examples ?? []).map(test => ({ case_id: test.case_id, input: test.input })),
  ]
  return entries.filter((entry, index) => entries.findIndex(other => other.case_id === entry.case_id) === index)
}

/**
 * Project trusted reference outputs back into every learner-visible public
 * expectation. This makes public examples a product of real execution instead
 * of a second, independently authored answer key.
 */
export function materializeTrustedPublicExpectations(
  payload: CodeLabPublicPayload,
  derivedOutputs: unknown[],
): CodeLabPublicPayload {
  const cases = publicLabInputCases(payload)
  if (cases.length === 0 || derivedOutputs.length !== cases.length) {
    throw new Error("PUBLIC_EXPECTATION_OUTPUT_COUNT_MISMATCH")
  }
  const result = structuredClone(payload)
  const replacements = new Map<string, string | undefined>()
  const rememberReplacement = (before: string, after: string) => {
    if (!replacements.has(before)) {
      replacements.set(before, after)
      return
    }
    const prior = replacements.get(before)
    replacements.set(before, prior === after ? after : undefined)
  }
  const expectedByCase = new Map(cases.map((entry, index) => [
    entry.case_id,
    trustedExpectedBehavior(result, derivedOutputs[index]),
  ] as const))

  result.public_tests.forEach((test) => {
    const expected = expectedByCase.get(test.test_id)
    if (!expected) throw new Error(`PUBLIC_EXPECTATION_CASE_MISSING:${test.test_id}`)
    rememberReplacement(test.expected_behavior, expected)
    test.expected_behavior = expected
  })
  result.programming_task?.public_examples.forEach((example) => {
    const expected = expectedByCase.get(example.case_id)
    if (!expected) throw new Error(`PUBLIC_EXPECTATION_CASE_MISSING:${example.case_id}`)
    rememberReplacement(example.expected_behavior, expected)
    example.expected_behavior = expected
  })
  result.practical_guide?.acceptance_criteria.forEach((criterion) => {
    const expected = expectedByCase.get(criterion.public_test_id)
    if (!expected) throw new Error(`PUBLIC_EXPECTATION_CASE_MISSING:${criterion.public_test_id}`)
    rememberReplacement(criterion.expected_behavior, expected)
    criterion.expected_behavior = expected
  })

  // Only refresh learner-facing expectation prose. A former generic recursive
  // replacement also rewrote Claim.text and code whenever they happened to be
  // equal to an authored expected_behavior. That broke the immutable
  // claim/citation relation after trusted execution and could even corrupt a
  // valid code sample. Claims, citations, code and contract identity are never
  // projection targets.
  result.instructions = replaceExpectedInRenderBlocks(result.instructions, replacements)
  result.hint_ladders = result.hint_ladders.map((ladder) => ({
    ...ladder,
    hints: ladder.hints.map((hint) => ({
      ...hint,
      text: replaceExpectedProse(hint.text, replacements),
    })),
  }))
  result.reflection_questions = result.reflection_questions.map((question) =>
    replaceExpectedProse(question, replacements))
  if (result.practical_guide) {
    result.practical_guide = replaceExpectedInPracticalGuide(
      result.practical_guide,
      replacements,
    )
  }
  if (result.programming_task) {
    result.programming_task.hint_ladders = result.programming_task.hint_ladders.map(
      (ladder) => ({
        ...ladder,
        text: replaceExpectedProse(ladder.text, replacements),
      }),
    )
  }
  return result
}

function trustedExpectedBehavior(payload: CodeLabPublicPayload, output: unknown): string {
  const serialized = JSON.stringify(output)
  if (serialized === undefined) throw new Error("PUBLIC_EXPECTATION_OUTPUT_NOT_SERIALIZABLE")
  return payload.execution_contract.execution_mode === "function"
    ? `函数返回值应为：${serialized}`
    : `标准输出应为：${serialized}`
}

function replaceExpectedProse(
  value: string,
  replacements: Map<string, string | undefined>,
): string {
  let text = value
  for (const [before, after] of replacements) {
    if (before && after && before !== after) text = text.split(before).join(after)
  }
  return text
}

function replaceExpectedInRenderBlocks(
  blocks: RenderBlock[],
  replacements: Map<string, string | undefined>,
): RenderBlock[] {
  return blocks.map((block) => {
    switch (block.block_type) {
      case "heading":
        return { ...block, text: replaceExpectedProse(block.text, replacements) }
      case "paragraph":
        return { ...block, text: replaceExpectedProse(block.text, replacements) }
      case "code":
        return {
          ...block,
          ...(block.caption
            ? { caption: replaceExpectedProse(block.caption, replacements) }
            : {}),
        }
      case "callout":
        return {
          ...block,
          title: replaceExpectedProse(block.title, replacements),
          text: replaceExpectedProse(block.text, replacements),
        }
      case "comparison":
        return {
          ...block,
          title: replaceExpectedProse(block.title, replacements),
          columns: block.columns.map((column) => ({
            heading: replaceExpectedProse(column.heading, replacements),
            content: replaceExpectedProse(column.content, replacements),
          })),
        }
      case "quiz":
        return {
          ...block,
          prompt: replaceExpectedProse(block.prompt, replacements),
          options: block.options?.map((option) => ({
            ...option,
            text: replaceExpectedProse(option.text, replacements),
          })),
          ...(block.answer_explanation
            ? {
                answer_explanation: replaceExpectedProse(
                  block.answer_explanation,
                  replacements,
                ),
              }
            : {}),
        }
      case "hint":
        return { ...block, text: replaceExpectedProse(block.text, replacements) }
      case "citation":
        return block
    }
  })
}

function replaceExpectedInPracticalGuide(
  guide: PracticalGuidePublicPayload,
  replacements: Map<string, string | undefined>,
): PracticalGuidePublicPayload {
  return {
    ...guide,
    practice_goal: replaceExpectedProse(guide.practice_goal, replacements),
    deliverable: replaceExpectedProse(guide.deliverable, replacements),
    readiness_checks: guide.readiness_checks.map((entry) => ({
      ...entry,
      title: replaceExpectedProse(entry.title, replacements),
      check: replaceExpectedProse(entry.check, replacements),
      ready_when: replaceExpectedProse(entry.ready_when, replacements),
    })),
    steps: guide.steps.map((entry) => ({
      ...entry,
      title: replaceExpectedProse(entry.title, replacements),
      action: replaceExpectedProse(entry.action, replacements),
      input: replaceExpectedProse(entry.input, replacements),
      expected_result: replaceExpectedProse(entry.expected_result, replacements),
      verification: replaceExpectedProse(entry.verification, replacements),
    })),
    troubleshooting: guide.troubleshooting.map((entry) => ({
      ...entry,
      symptom: replaceExpectedProse(entry.symptom, replacements),
      likely_cause: replaceExpectedProse(entry.likely_cause, replacements),
      recovery_steps: entry.recovery_steps.map((step) =>
        replaceExpectedProse(step, replacements)),
      verification: replaceExpectedProse(entry.verification, replacements),
    })),
    extension_task: {
      ...guide.extension_task,
      task: replaceExpectedProse(guide.extension_task.task, replacements),
      changed_dimension: replaceExpectedProse(
        guide.extension_task.changed_dimension,
        replacements,
      ),
      verification: replaceExpectedProse(
        guide.extension_task.verification,
        replacements,
      ),
    },
  }
}

/** Probe the real reference on public inputs as well as hidden tests. No private output is published. */
export async function executePublicLabInputs(
  runner: CodeRunner,
  payload: CodeLabPublicPayload,
  reference: string,
  maxToolRetries = 0,
): Promise<CodeExecutionResult> {
  const inputs = publicLabInputCases(payload)
  const suite = {
    test_suite_id: `${payload.lab_id}-PUBLIC-INPUT-PROBE`, execution_contract: payload.execution_contract,
    tests: inputs.map(entry => ({ test_id: entry.case_id, input: entry.input, expected: null, objective_id: payload.objective_ids[0]!, weight: 1, comparison: { kind: "exact" as const } })),
  }
  return executeTrustedReferenceWithRetry(runner, { language: "python", code: reference, test_suite_id: suite.test_suite_id, test_suite: suite,
    ...payload.execution_contract.resource_limits, network_allowed: false, derive_expected: true }, maxToolRetries)
}

export function applyPublicFileFixtures(payload: CodeLabPublicPayload, entries: Array<{ case_id: string; files: Record<string, string> }>): CodeLabPublicPayload {
  const cases = publicLabInputCases(payload)
  if (entries.length !== cases.length || new Set(entries.map(e => e.case_id)).size !== cases.length) throw new Error("public_fixture_case_mismatch")
  const files = new Map(entries.map(entry => {
    const target = cases.find(c => c.case_id === entry.case_id)
    if (!target || !target.input || typeof target.input !== "object" || !Array.isArray((target.input as { args?: unknown }).args)) throw new Error("public_fixture_case_mismatch")
    validateFileFixtures(entry.files)
    const previous = invocationFileFixtures(target.input) ?? {}
    for (const [name, text] of Object.entries(previous)) if (entry.files[name] !== text) throw new Error("public_fixture_existing_content_changed")
    return [entry.case_id, entry.files] as const
  }))
  const result = structuredClone(payload)
  for (const test of result.public_tests) test.input = { ...(test.input as object), files: structuredClone(files.get(test.test_id)!) }
  for (const test of result.programming_task?.public_examples ?? []) test.input = { ...(test.input as object), files: structuredClone(files.get(test.case_id)!) }
  return result
}
