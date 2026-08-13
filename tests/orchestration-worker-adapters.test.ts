import { describe, expect, test } from "bun:test"
import { validateWorkerResult } from "../src/orchestration/worker-contract"
import {
  createScaffoldWorkerInvocation,
  runScaffoldWorkerAdapter,
  runWorkerAdapter,
} from "../src/orchestration/worker-adapters"
import { ORCHESTRATION_WORKER_SEQUENCE } from "../src/orchestration/state-machine"
import type { OrchestrationStepDefinition, WorkerInvocation } from "../src/orchestration/types"
import { readFile } from "node:fs/promises"

function invocationFor(step: OrchestrationStepDefinition, index: number): WorkerInvocation {
  return createScaffoldWorkerInvocation({
    session_id: "SESSION-ADAPTER-001",
    run_id: "RUN-ADAPTER-001",
    step_index: index,
    stage: step.from,
    worker: step.worker,
    learner_request: {
      goal: "学习 Python 循环并完成成绩统计",
      background: "初学者",
      self_rating: "beginner",
    },
    upstream_artifacts: {},
    input_refs: [],
    evidence_refs: [],
  })
}

async function runDeterministicRoleBPrefix(): Promise<{
  upstream_artifacts: Record<string, unknown>
  input_refs: string[]
}> {
  let upstream_artifacts: Record<string, unknown> = {}
  let input_refs: string[] = []

  for (const [index, step] of ORCHESTRATION_WORKER_SEQUENCE.slice(0, 4).entries()) {
    const invocation: WorkerInvocation = {
      ...invocationFor(step, index + 1),
      mode: "deterministic",
      upstream_artifacts,
      input_refs,
    }
    const result = await runWorkerAdapter(invocation)
    upstream_artifacts = {
      ...upstream_artifacts,
      [step.worker]: result.artifacts,
    }
    input_refs = result.output_refs
  }

  return { upstream_artifacts, input_refs }
}

describe("orchestration worker adapters", () => {
  test("production adapter does not instantiate the host subprocess runner", async () => {
    const source = await readFile("src/orchestration/worker-adapters.ts", "utf8")
    expect(source).not.toContain("new SubprocessCodeRunner()")
    expect(source).toContain("createDockerPythonCodeRunnerFromEnv")
  })

  test("scaffold mode provides a valid adapter result for every canonical worker", async () => {
    for (const [index, step] of ORCHESTRATION_WORKER_SEQUENCE.entries()) {
      const invocation = invocationFor(step, index + 1)
      const result = await runScaffoldWorkerAdapter(invocation)

      expect(result).toMatchObject({
        schema_version: "1.0",
        run_id: "RUN-ADAPTER-001",
        step_index: index + 1,
        worker: step.worker,
        stage: step.from,
        status: "completed",
        marker: `[executed:${step.worker}]`,
        next: step.to,
        errors: [],
      })
      expect(result.artifacts).toMatchObject({
        mode: "scaffold",
        worker: step.worker,
        stage: step.from,
      })
      expect(result.output_refs).toEqual([`${step.worker}:scaffold-result`])
      expect(validateWorkerResult(invocation, result).ok).toBe(true)
    }
  })

  test("generic runWorkerAdapter routes scaffold invocations through scaffold adapters", async () => {
    const step = ORCHESTRATION_WORKER_SEQUENCE[5]
    const invocation = invocationFor(step, 6)

    const result = await runWorkerAdapter(invocation)

    expect(result.worker).toBe("concept-tutor")
    expect(result.marker).toBe("[executed:concept-tutor]")
    expect(result.next).toBe("concept_ready")
  })

  test("deterministic mode fails closed when required upstream artifacts are missing", async () => {
    const step = ORCHESTRATION_WORKER_SEQUENCE[7]
    const invocation: WorkerInvocation = {
      ...invocationFor(step, 8),
      mode: "deterministic",
    }

    const result = await runWorkerAdapter(invocation)

    expect(result).toMatchObject({
      status: "failed",
      worker: "tiered-evaluator",
      stage: "lab_ready",
      next: "failed",
      errors: [
        {
          code: "MISSING_UPSTREAM_ARTIFACT",
          severity: "fatal",
        },
      ],
    })
    expect(validateWorkerResult(invocation, result).ok).toBe(true)
  })

  test("deterministic mode completes the first four Role B workers with real B artifacts", async () => {
    const { upstream_artifacts } = await runDeterministicRoleBPrefix()

    const profileArtifact = upstream_artifacts["profile-builder"] as {
      profile: { learner_id: string; goal: string; weak_concepts: string[] }
      rag_request: { query: string }
      provenance: { conflicts: unknown[] }
    }

    expect(profileArtifact.profile.learner_id).toBe("demo_loop_weak_001")
    expect(profileArtifact.profile.goal).toContain("成绩统计")
    expect(profileArtifact.profile.weak_concepts).toContain("循环")
    expect(profileArtifact.rag_request.query).toContain("学习目标")
    expect(profileArtifact.provenance.conflicts.length).toBeGreaterThan(0)
  })

  test("path-planner starts from the selected function goal instead of the score-project demo node", async () => {
    const pathStep = ORCHESTRATION_WORKER_SEQUENCE[4]
    const learnerRequest = {
      goal: "学习函数定义与调用",
      background: "已掌握变量、条件和循环",
      self_rating: "intermediate",
      learning_goal_spec: { mode: "curriculum_node" as const, selected_node_ids: ["PY-CH04-S01"] },
    }
    const profile = {
      learner_id: "learner-function-goal",
      level: "intermediate" as const,
      known_concepts: ["Python 是什么", "变量与赋值", "基本数据类型", "运算符", "条件判断", "for 循环"],
      weak_concepts: [],
      goal: learnerRequest.goal,
    }
    const result = await runWorkerAdapter({
      ...createScaffoldWorkerInvocation({
        session_id: "SESSION-FUNCTION-GOAL",
        run_id: "RUN-FUNCTION-GOAL",
        step_index: 5,
        stage: pathStep.from,
        worker: pathStep.worker,
        learner_request: learnerRequest,
        upstream_artifacts: {
          "profile-builder": {
            profile,
            provenance: { level: { value: "intermediate", source: "self_rating", rule: "test" }, concepts: [], conflicts: [], unmapped_concepts: [] },
            rag_request: { learner_profile: profile, query: "学习目标：学习函数定义与调用", top_k: 5 },
          },
        },
        input_refs: ["profile-builder:test-result"],
        evidence_refs: [],
      }),
      mode: "deterministic",
    })

    expect(result.status).toBe("completed")
    const artifacts = result.artifacts as {
      formal_path: { original_goal: string; nodes: Array<{ target_source_ids: string[] }> }
      next_path_node: { target_source_ids: string[] } | null
    }
    expect(artifacts.formal_path.original_goal).toBe("学习函数定义与调用")
    expect(artifacts.formal_path.nodes.flatMap((node) => node.target_source_ids)).toContain("K013")
    expect(artifacts.next_path_node?.target_source_ids).toEqual(["K013"])
    expect(artifacts.next_path_node?.target_source_ids).not.toEqual(["K007", "K009", "K018"])
  })

  test.skipIf(process.env.RUN_INTEGRATION_TESTS !== "1")(
    "deterministic mode completes path-planner and concept-tutor with real C concept artifact", async () => {
    const { upstream_artifacts, input_refs } = await runDeterministicRoleBPrefix()
    const pathStep = ORCHESTRATION_WORKER_SEQUENCE[4]
    const invocation: WorkerInvocation = {
      ...invocationFor(pathStep, 5),
      mode: "deterministic",
      upstream_artifacts,
      input_refs,
    }

    const result = await runWorkerAdapter(invocation)

    expect(result).toMatchObject({
      status: "completed",
      worker: "path-planner",
      stage: "profile_built",
      next: "path_planned",
      errors: [],
      artifacts: {
        mode: "deterministic",
        worker: "path-planner",
        stage: "profile_built",
      },
    })
    expect(validateWorkerResult(invocation, result).ok).toBe(true)

    const artifacts = result.artifacts as {
      formal_path: { nodes: Array<{ target_source_ids: string[] }> }
      next_path_node: { target_source_ids: string[] } | null
      a_rag_request: { query: string }
      a_rag_result: { results: Array<{ source_id: string }> }
    }
    expect(artifacts.formal_path.nodes.length).toBeGreaterThan(0)
    expect(artifacts.next_path_node?.target_source_ids.length).toBeGreaterThan(0)
    expect(artifacts.a_rag_request.query).toContain("学习目标")
    expect(artifacts.a_rag_result.results.length).toBeGreaterThan(0)

    const conceptStep = ORCHESTRATION_WORKER_SEQUENCE[5]
    const conceptInvocation: WorkerInvocation = {
      ...invocationFor(conceptStep, 6),
      mode: "deterministic",
      upstream_artifacts: {
        ...upstream_artifacts,
        [pathStep.worker]: result.artifacts,
      },
      input_refs: result.output_refs,
    }
    const conceptResult = await runWorkerAdapter(conceptInvocation)
    expect(conceptResult).toMatchObject({
      status: "completed",
      worker: "concept-tutor",
      stage: "path_planned",
      next: "concept_ready",
      errors: [],
      artifacts: {
        mode: "deterministic",
        worker: "concept-tutor",
        stage: "path_planned",
      },
    })
    expect(validateWorkerResult(conceptInvocation, conceptResult).ok).toBe(true)

    const conceptArtifacts = conceptResult.artifacts as {
      concept_lesson: { status: string; artifact_type: string; payload: { objective_ids: string[] } | null }
      generation_spec: { spec_id: string }
      evidence_pack: { results: unknown[] }
    }
    expect(conceptArtifacts.concept_lesson.status).toBe("ready")
    expect(conceptArtifacts.concept_lesson.artifact_type).toBe("concept_lesson")
    expect(conceptArtifacts.concept_lesson.payload?.objective_ids.length).toBeGreaterThan(0)
    expect(conceptArtifacts.generation_spec.spec_id).toContain("SPEC")
    expect(conceptArtifacts.evidence_pack.results.length).toBeGreaterThan(0)

    const codeLabStep = ORCHESTRATION_WORKER_SEQUENCE[6]
    const codeLabInvocation: WorkerInvocation = {
      ...invocationFor(codeLabStep, 7),
      mode: "deterministic",
      upstream_artifacts: {
        ...upstream_artifacts,
        [pathStep.worker]: result.artifacts,
        [conceptStep.worker]: conceptResult.artifacts,
      },
      input_refs: conceptResult.output_refs,
    }
    const codeLabResult = await runWorkerAdapter(codeLabInvocation)
    expect(codeLabResult).toMatchObject({
      status: "completed",
      worker: "code-lab",
      stage: "concept_ready",
      next: "lab_ready",
      errors: [],
      artifacts: {
        mode: "deterministic",
        worker: "code-lab",
        stage: "concept_ready",
      },
    })
    expect(validateWorkerResult(codeLabInvocation, codeLabResult).ok).toBe(true)

    const codeLabArtifacts = codeLabResult.artifacts as {
      code_lab_public: { status: string; artifact_type: string; quality: { execution_verified?: boolean }; payload: { objective_ids: string[] } | null }
      code_lab_secure: { status: string; artifact_type: string; payload: { hidden_tests: unknown[] } | null }
    }
    expect(codeLabArtifacts.code_lab_public.status).toBe("ready")
    expect(codeLabArtifacts.code_lab_public.artifact_type).toBe("code_lab_public")
    expect(codeLabArtifacts.code_lab_public.quality.execution_verified).toBe(true)
    expect(codeLabArtifacts.code_lab_public.payload?.objective_ids.length).toBeGreaterThan(0)
    expect(codeLabArtifacts.code_lab_secure.status).toBe("ready")
    expect(codeLabArtifacts.code_lab_secure.artifact_type).toBe("code_lab_secure")
    expect(codeLabArtifacts.code_lab_secure.payload?.hidden_tests.length).toBeGreaterThan(0)

    const evaluatorStep = ORCHESTRATION_WORKER_SEQUENCE[7]
    const evaluatorInvocation: WorkerInvocation = {
      ...invocationFor(evaluatorStep, 8),
      mode: "deterministic",
      upstream_artifacts: {
        ...upstream_artifacts,
        [pathStep.worker]: result.artifacts,
        [conceptStep.worker]: conceptResult.artifacts,
        [codeLabStep.worker]: codeLabResult.artifacts,
      },
      input_refs: codeLabResult.output_refs,
    }
    const evaluatorResult = await runWorkerAdapter(evaluatorInvocation)
    expect(evaluatorResult).toMatchObject({
      status: "completed",
      worker: "tiered-evaluator",
      stage: "lab_ready",
      next: "assessment_ready",
      errors: [],
      artifacts: {
        mode: "deterministic",
        worker: "tiered-evaluator",
        stage: "lab_ready",
      },
    })
    expect(validateWorkerResult(evaluatorInvocation, evaluatorResult).ok).toBe(true)

    const evaluatorArtifacts = evaluatorResult.artifacts as {
      assessment_public: { status: string; artifact_type: string; quality: { answer_key_verified?: boolean }; payload: { items: unknown[] } | null }
      assessment_secure: { status: string; artifact_type: string; payload: { code_test_suites: unknown[] } | null }
    }
    expect(evaluatorArtifacts.assessment_public.status).toBe("ready")
    expect(evaluatorArtifacts.assessment_public.artifact_type).toBe("assessment_public")
    expect(evaluatorArtifacts.assessment_public.quality.answer_key_verified).toBe(true)
    expect(evaluatorArtifacts.assessment_public.payload?.items.length).toBeGreaterThan(0)
    expect(evaluatorArtifacts.assessment_secure.status).toBe("ready")
    expect(evaluatorArtifacts.assessment_secure.artifact_type).toBe("assessment_secure")
    expect(evaluatorArtifacts.assessment_secure.payload?.code_test_suites.length).toBeGreaterThan(0)
  })

  test("adapter rejects invocations whose worker does not match the current stage", async () => {
    const invocation: WorkerInvocation = {
      ...invocationFor(ORCHESTRATION_WORKER_SEQUENCE[0], 1),
      worker: "profile-builder",
    }

    const result = await runScaffoldWorkerAdapter(invocation)

    expect(result).toMatchObject({
      status: "failed",
      worker: "profile-builder",
      stage: "intake_ready",
      next: "failed",
      errors: [
        {
          code: "ADAPTER_STAGE_WORKER_MISMATCH",
          message: "stage intake_ready expects background-collector, received profile-builder",
          severity: "fatal",
        },
      ],
    })
    expect(validateWorkerResult(invocation, result).ok).toBe(true)
  })
})
