import {
  mkdir,
  writeFile,
  readFile,
  link,
  unlink,
  readdir,
  cp,
} from "node:fs/promises"
import { resolve, join } from "node:path"
import { resolveEvaluationJudgeEnvV2, evaluationJudgeModeV2 } from "../src/evaluation/v2/judge-configuration.v2"
import { contentHash } from "../src/role-c-content/contracts/common"
import { createRoleCModelGatewayFromEnv } from "../src/role-c-content/contracts/model-gateway"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts/common-policy"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { COMPETITION_CASES_V2 } from "../src/evaluation/v2/competition-cases.v2"
import { COMPETITION_PROFILE_FIXTURES_V2 } from "../src/evaluation/v2/competition-profiles.v2"
import {
  buildCompetitionManifestCandidateV2,
  assertFrozenManifestMatchesCurrentV2,
  assertManifestApprovedV2,
  competitionExpectationsV2,
  legacyCoreFactDriftV2,
  type FrozenCompetitionManifestV2,
  type ManifestApprovalV2,
  type ManifestReviewRowV2,
} from "../src/evaluation/v2/competition-manifest.v2"
import { preflightCompetitionV2 } from "../src/evaluation/v2/preflight.v2"
import { runCompetitionV2Case } from "../src/evaluation/v2/competition-runner.v2"
import {
  ARTIFACT_KINDS,
  computeCompetitionMetrics,
  type ClaimAuditRecord,
  type DifficultyAuditRecord,
} from "../src/evaluation/competition-metrics"
import {
  ModelCompetitionClaimAuditor,
  extractCompetitionClaimCandidates,
  evidenceFactsFromDelivery,
} from "../src/evaluation/competition-claim-auditor"
import { ModelResourceDifficultyJudge } from "../src/evaluation/resource-difficulty-judge"
import { competitionArtifactViews } from "../src/evaluation/competition-artifact-view"
import type { RoleCForRoleDResult } from "../src/role-d-integration/contracts"
import { runDynamicTrajectoryV2 } from "../src/evaluation/v2/dynamic-runner.v2"
import {
  COMPETITION_DYNAMIC_TRAJECTORIES_V2,
  computeDynamicTrajectoryMetricsV2,
  type DynamicTrajectoryResultV2,
} from "../src/evaluation/v2/competition-dynamic-trajectories.v2"
import {
  runQueryRobustnessV2,
  compareCounterfactualsV2,
  publicEvaluationPrivacyIssues,
} from "../src/evaluation/v2/supplemental.v2"
import { createAtomicRoleCLearningPersistence } from "../src/role-d-integration/role-c-service"
import {
  buildStabilityReportV2,
  buildDifficultyConfusionV2,
  buildManualAuditTemplateV2,
  summarizeModelUsageV2,
} from "../src/evaluation/v2/reporting.v2"
import { runControlledPairV2 } from "../src/evaluation/v2/counterfactual-runner.v2"
import { createDockerPythonCodeRunnerFromEnv } from "../src/role-c-content/security/code-runner"

const args = process.argv.slice(2)
const option = (name: string) =>
  args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
const action = args[0] ?? "preflight"
const root = resolve(option("--output-dir") ?? ".tmp/evaluation-v2")
const catalogDir = resolve(option("--manifest-dir") ?? "evaluation/v2")
const kb = await loadKnowledgeBase()
await mkdir(root, { recursive: true })
await mkdir(catalogDir, { recursive: true })
const write = async (path: string, value: unknown) => {
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
}
const read = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T
const candidate = buildCompetitionManifestCandidateV2(kb)

if (action === "candidate") {
  // Candidate is replaceable; frozen.json and completed reviews are never overwritten.
  await write(join(catalogDir, "manifest.candidate.json"), candidate)
  await write(join(catalogDir, "review-context.json"), {
    candidate_hash: candidate.semantic_contract_hash,
    profiles: COMPETITION_PROFILE_FIXTURES_V2,
    cases: COMPETITION_CASES_V2,
    knowledge_base: kb,
  })
  const rows = candidate.cases.flatMap((c) =>
    ARTIFACT_KINDS.map((artifact_kind) => ({
      case_id: c.case_id,
      artifact_kind,
      candidate_hash: candidate.semantic_contract_hash,
      expected_difficulty: c.expected_difficulty[artifact_kind],
      basis: c.expected_difficulty_basis[artifact_kind],
      reviewer_1: "",
      reviewer_1_decision: "",
      reviewer_2: "",
      reviewer_2_decision: "",
      adjudicator: "",
      adjudication: "",
      rationale: "",
    })),
  )
  await write(join(catalogDir, "review-template.json"), rows)
  if (await Bun.file("evaluation/manifest.v1.json").exists()) {
    await write(
      join(catalogDir, "legacy-core-fact-drift.json"),
      legacyCoreFactDriftV2(await read("evaluation/manifest.v1.json"), kb),
    )
  }
  console.log(
    JSON.stringify({
      candidate_hash: candidate.semantic_contract_hash,
      cases: 60,
      review_rows: 180,
    }),
  )
} else if (action === "freeze") {
  const manifest = await read<FrozenCompetitionManifestV2>(
    join(catalogDir, "manifest.candidate.json"),
  )
  const reviews = await read<ManifestReviewRowV2[]>(
    resolve(option("--reviews") ?? join(catalogDir, "reviews.json")),
  )
  const approval = await read<ManifestApprovalV2>(
    resolve(option("--approval") ?? join(catalogDir, "approval.json")),
  )
  assertFrozenManifestMatchesCurrentV2({ frozen: manifest, knowledgeBase: kb })
  assertManifestApprovedV2(manifest, reviews, approval)
  const temp = join(catalogDir, `.freeze-${crypto.randomUUID()}.json`)
  await write(temp, { manifest, reviews, approval })
  try {
    await link(temp, join(catalogDir, "frozen.json"))
  } finally {
    await unlink(temp)
  }
  console.log(
    "Frozen manifest approved and stored; existing frozen manifests cannot be overwritten.",
  )
} else if (action === "preflight") {
  const report = await preflightCompetitionV2(kb, candidate)
  await write(join(root, "preflight.json"), report)
  console.log(
    JSON.stringify(
      { ...report, rows: report.rows.filter((r) => !r.ok) },
      null,
      2,
    ),
  )
  if (!report.passed) process.exitCode = 1
} else if (action === "robustness") {
  const report = await runQueryRobustnessV2(kb)
  await write(join(root, "robustness.json"), report)
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
} else if (action === "dynamic") {
  await dynamic()
} else if (action === "counterfactual") {
  const groupId = option("--group-id")
  if (!groupId) throw new Error("COUNTERFACTUAL_REQUIRES_EXPLICIT_GROUP_ID")
  const env = {
    ...(await readEnv(resolve(".env.role-c.local"))),
    ...(await readEnv(
      resolve(option("--env-file") ?? ".env.evaluation-v2.local"),
    )),
    ...process.env,
  }
  const report = await runControlledPairV2({
    groupId,
    kb,
    manifest: candidate,
    directory: join(root, "private-runtime", groupId),
    runtime: { env },
  })
  await write(join(root, "controlled-counterfactual.json"), report)
  console.log(
    JSON.stringify({
      group_id: groupId,
      complete: report.complete,
      facts_and_tasks_preserved: report.facts_and_tasks_preserved,
    }),
  )
  if (!report.complete || !report.facts_and_tasks_preserved)
    process.exitCode = 1
} else if (action === "run") {
  await run()
} else {
  throw new Error(
    "Usage: competition-evaluation-v2.ts candidate|preflight|freeze|run [--dev --case-id=... --limit=6 --repeats=1 --resume]",
  )
}

interface CaseRecord {
  protocol_id: string
  repeat_index: number
  case_id: string
  status: string
  duration_ms: number
  code_execution: "passed" | "not_reached"
  errors: string[]
  claims: ClaimAuditRecord[]
  difficulty: DifficultyAuditRecord[]
  public_release?: Extract<
    RoleCForRoleDResult,
    { status: "ready" }
  >["reviewedRelease"]
  evidence_pack?: Extract<
    RoleCForRoleDResult,
    { status: "ready" }
  >["finalContext"]["evidencePack"]
  learning_session?: Extract<
    RoleCForRoleDResult,
    { status: "ready" }
  >["learningSession"]
  run_id?: string
}
async function run() {
  const dev = args.includes("--dev")
  let manifest = candidate
  if (!dev) {
    const frozen = await read<{
      manifest: FrozenCompetitionManifestV2
      reviews: ManifestReviewRowV2[]
      approval: ManifestApprovalV2
    }>(join(catalogDir, "frozen.json"))
    assertManifestApprovedV2(frozen.manifest, frozen.reviews, frozen.approval)
    manifest = frozen.manifest
  }
  assertFrozenManifestMatchesCurrentV2({ frozen: manifest, knowledgeBase: kb })
  const preflight = await preflightCompetitionV2(kb, manifest)
  await write(join(root, "preflight.json"), preflight)
  if (!preflight.passed)
    throw new Error(
      "PREFLIGHT_FAILED: inspect preflight.json before spending model credits",
    )
  const repeats = integer("--repeats", dev ? 1 : 2, 1, 10),
    limit = integer("--limit", dev ? 6 : 60, 1, 60)
  const requested = args
    .filter((a) => a.startsWith("--case-id="))
    .map((a) => a.slice(10))
  for (const id of requested)
    if (!COMPETITION_CASES_V2.some((c) => c.case_id === id))
      throw new Error(`UNKNOWN_CASE:${id}`)
  // Round-robin across all six profiles, rather than the first N rows.
  const balanced = Array.from({ length: 10 }, (_, i) =>
    COMPETITION_CASES_V2.filter((c) => Number(c.case_id.slice(-2)) === i + 1),
  ).flat()
  const selected = requested.length
    ? balanced.filter((c) => requested.includes(c.case_id))
    : balanced.slice(0, limit)
  if (!dev && selected.length !== 60)
    throw new Error("FORMAL_REQUIRES_60_CASES")
  const env = {
    ...(await readEnv(resolve(".env.role-c.local"))),
    ...(await readEnv(
      resolve(option("--env-file") ?? ".env.evaluation-v2.local"),
    )),
    ...process.env,
  }
  const generation = createRoleCModelGatewayFromEnv(env)
  const judgeEnv = resolveEvaluationJudgeEnvV2(env, { development: dev, sameModel: args.includes("--self-audit") })
  const judge = judgeEnv ? createRoleCModelGatewayFromEnv(judgeEnv) : undefined
  const gitStatus = Bun.spawnSync(["git", "status", "--porcelain"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  if (!dev && (gitStatus.exitCode !== 0 || gitStatus.stdout.toString().trim()))
    throw new Error("FORMAL_REQUIRES_CLEAN_COMMIT")
  const docker = await createDockerPythonCodeRunnerFromEnv(env)
  const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  await write(join(root, "manifest.snapshot.json"), manifest)
  const protocolBody = {
    version: "competition-protocol.v2",
    mode: dev ? "development" : "formal",
    manifest_hash: manifest.semantic_contract_hash,
    source_tree_hash: await sourceHash(),
    git_commit:
      revision.exitCode === 0 ? revision.stdout.toString().trim() : null,
    dirty_workspace: gitStatus.stdout.toString().trim().length > 0,
    runner_image_digest: docker.runner_image_digest,
    generation_model: generation.model_id,
    generation_config: generation.model_config_hash,
    judge_model: judge?.model_id ?? null,
    judge_mode: evaluationJudgeModeV2(generation.model_id, judge?.model_id),
    judge_config: judge?.model_config_hash ?? null,
    judge_independent: !!judge && judge.model_id !== generation.model_id,
    prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
    rubric_hash: contentHash(
      await readFile("evaluation/difficulty-rubric.v1.md", "utf8"),
    ),
    selected_case_ids: selected.map((c) => c.case_id),
    repeats,
  }
  const protocol = { ...protocolBody, protocol_id: contentHash(protocolBody) }
  const protocolPath = join(root, "protocol.json")
  if (args.includes("--resume")) {
    const old = await read<typeof protocol>(protocolPath)
    if (contentHash(old) !== contentHash(protocol))
      throw new Error("RESUME_PROTOCOL_MISMATCH")
  } else {
    try {
      await writeFile(protocolPath, JSON.stringify(protocol, null, 2), {
        flag: "wx",
        mode: 0o600,
      })
    } catch (error) {
      throw new Error(
        "OUTPUT_ALREADY_USED: use --resume or a new --output-dir",
        { cause: error },
      )
    }
  }
  const records: CaseRecord[] = []
  evaluation: for (let repeat = 1; repeat <= repeats; repeat++)
    for (const c of selected) {
      const directory = join(root, "runs", `repeat-${repeat}`)
      await mkdir(directory, { recursive: true })
      const path = join(directory, `${c.case_id}.json`)
      if (args.includes("--resume") && (await Bun.file(path).exists())) {
        const cached = await read<CaseRecord>(path)
        if (
          cached.protocol_id !== protocol.protocol_id ||
          cached.case_id !== c.case_id ||
          cached.repeat_index !== repeat
        )
          throw new Error("RESUME_CASE_IDENTITY_MISMATCH")
        // Preserve failures too. Retrying them belongs to a separately named run, not cherry-picking.
        records.push(cached)
        continue
      }
      console.log(`[v2] start r${repeat} ${c.case_id}`)
      const record: CaseRecord = {
        protocol_id: protocol.protocol_id,
        repeat_index: repeat,
        case_id: c.case_id,
        status: "failed",
        duration_ms: 0,
        code_execution: "not_reached",
        errors: [],
        claims: [],
        difficulty: ARTIFACT_KINDS.map((artifact_kind) => ({
          case_id: c.case_id,
          repeat_index: repeat,
          artifact_kind,
          audited: false,
          reasons: ["resource not published"],
        })),
      }
      const start = performance.now()
      try {
        const { result } = await runCompetitionV2Case({
          evaluationCase: c,
          expectation: manifest.cases.find((e) => e.case_id === c.case_id)!,
          knowledgeBase: kb,
          runId: `RUN-V2-${protocol.protocol_id.slice(-12)}-${repeat}-${c.case_id}`,
          runtime: {
            env,
            dataDirectory: join(
              root,
              "private-runtime",
              `r${repeat}`,
              c.case_id,
            ),
          },
        })
        record.status = result.status
        if (result.status !== "ready") record.errors.push(result.reason)
        else {
          if (!result.reviewedRelease)
            throw new Error("READY_WITHOUT_REVIEWED_RELEASE")
          record.learning_session = result.learningSession
          record.run_id = result.runId
          record.errors.push(
            ...publicEvaluationPrivacyIssues(result.reviewedRelease),
          )
          record.public_release = result.reviewedRelease
          record.evidence_pack = result.finalContext.evidencePack
          const candidates = extractCompetitionClaimCandidates(
            result.reviewedRelease,
          )
          record.claims = candidates.map((claim) => ({
            repeat_index: repeat,
            case_id: c.case_id,
            artifact_kind: claim.artifact_kind,
            claim_id: claim.claim_id,
            factual: true,
            audited: false,
            verdict: "uncertain",
            supported_fact_ids: [],
          }))
          const lab = result.reviewedRelease.artifacts.find(
            (a) => a.artifact_type === "code_lab_public",
          )
          if (
            lab?.quality.execution_verified &&
            (lab.quality.verified_test_count ?? 0) > 0
          )
            record.code_execution = "passed"
          const stored = await createAtomicRoleCLearningPersistence(
            join(root, "private-runtime", `r${repeat}`, c.case_id),
          ).cycleStore.loadRun(result.runId)
          const actual = stored?.pipeline_input.generation_spec
          const targetIds = result.finalContext.pathNode.target_source_ids
          if (
            contentHash([...targetIds].sort()) !==
            contentHash([...c.target_source_ids].sort())
          )
            record.errors.push("TARGET_CONTRACT_CHANGED_BY_RECOVERY")
          if (!actual?.artifact_tasks)
            record.errors.push("ARTIFACT_TASKS_NOT_PRESERVED")
          if (judgeEnv) {
            const gateway = createRoleCModelGatewayFromEnv(judgeEnv)
            try {
              record.claims = await new ModelCompetitionClaimAuditor(
                gateway,
              ).audit({
                repeat_index: repeat,
                case_id: c.case_id,
                candidates,
                evidence: evidenceFactsFromDelivery(
                  result.finalContext.evidencePack,
                ),
              })
            } catch (error) {
              record.errors.push(`claim audit:${message(error)}`)
              record.claims = candidates.map((claim) => ({
                repeat_index: repeat,
                case_id: c.case_id,
                artifact_kind: claim.artifact_kind,
                claim_id: claim.claim_id,
                factual: true,
                audited: false,
                verdict: "uncertain",
                supported_fact_ids: [],
              }))
            }
            for (const view of competitionArtifactViews(
              result.reviewedRelease,
            )) {
              const audit = record.difficulty.find(
                (a) => a.artifact_kind === view.artifact_kind,
              )!
              try {
                const value = await new ModelResourceDifficultyJudge(
                  gateway,
                ).classify({
                  case_id: c.case_id,
                  artifact_kind: view.artifact_kind,
                  title: view.title,
                  content: view.content,
                  rubric_version: "difficulty-rubric-v1",
                })
                Object.assign(audit, {
                  audited: true,
                  predicted_difficulty: value.predicted_difficulty,
                  reasons: value.reasons,
                  judge_version: "model-difficulty-v1",
                })
              } catch (error) {
                record.errors.push(`difficulty:${message(error)}`)
              }
            }
          }
        }
      } catch (error) {
        record.errors.push(message(error))
      }
      record.duration_ms = performance.now() - start
      await write(path, record)
      records.push(record)
      console.log(
        `[v2] done r${repeat} ${c.case_id} ${record.status} ${(record.duration_ms / 1000).toFixed(1)}s ${record.errors.join(";")}`,
      )
      await report(
        records,
        manifest,
        selected.map((c) => c.case_id),
        repeats,
        protocol,
      )
      if (
        record.errors.some((error) =>
          /INSUFFICIENT_(?:BALANCE|QUOTA)|余额不足|额度不足|invalid.api.key|unauthorized|authentication.failed|MODEL_PROVIDER_CIRCUIT_(?:OPEN|HALF_OPEN)/iu.test(
            error,
          ),
        )
      ) {
        console.error(
          "[v2] Provider temporarily unavailable or credentials/balance invalid; remaining cases stay not_run. Resume the same protocol after recovery.",
        )
        break evaluation
      }
    }
  const final = await report(
    records,
    manifest,
    selected.map((c) => c.case_id),
    repeats,
    protocol,
  )
  if (
    records.some((r) => r.status !== "ready" || r.errors.length) ||
    (!dev && !final.passed)
  )
    process.exitCode = 1
}
async function report(
  records: CaseRecord[],
  manifest: FrozenCompetitionManifestV2,
  selected: string[],
  repeats: number,
  protocol: { mode: string; protocol_id: string; judge_mode: string; generation_model: string; judge_model: string | null },
) {
  const expectations = competitionExpectationsV2(manifest).filter((e) =>
    selected.includes(e.case_id),
  )
  const byRepeat = Array.from({ length: repeats }, (_, i) => ({
    repeat_index: i + 1,
    metrics: computeCompetitionMetrics({
      cases: expectations,
      claims: records
        .filter((r) => r.repeat_index === i + 1)
        .flatMap((r) => r.claims),
      difficultyAudits: records
        .filter((r) => r.repeat_index === i + 1)
        .flatMap((r) => r.difficulty),
    }),
  }))
  const ready = records.filter((r) => r.status === "ready"),
    expected = selected.length * repeats
  const operational = {
    expected_runs: expected,
    recorded: records.length,
    not_run: expected - records.length,
    ready: ready.length,
    blocked: records.filter((r) => r.status === "blocked").length,
    failed: records.filter((r) => r.status === "failed").length,
    artifacts: ready.reduce(
      (n, r) => n + (r.public_release?.artifacts.length ?? 0),
      0,
    ),
    docker_passed: records.filter((r) => r.code_execution === "passed").length,
    errors: records.filter((r) => r.errors.length).length,
    publication_rate: ready.length / expected,
  }
  const value = {
    version: "competition-report.v2",
    protocol,
    operational,
    repeat_reports: byRepeat,
    passed:
      protocol.mode === "formal" &&
      ready.length === expected &&
      operational.artifacts === expected * 3 &&
      operational.docker_passed === expected &&
      operational.errors === 0 &&
      byRepeat.every((r) => r.metrics.passed),
  }
  await write(
    join(root, "counterfactuals.json"),
    compareCounterfactualsV2(records),
  )
  await write(
    join(root, "stability.json"),
    buildStabilityReportV2(records, selected, repeats),
  )
  await write(
    join(root, "difficulty-confusion.json"),
    buildDifficultyConfusionV2(records, manifest, selected, repeats),
  )
  await write(
    join(root, "manual-audit-template.json"),
    buildManualAuditTemplateV2(records, selected, repeats),
  )
  const usage: Array<Record<string, unknown>> = []
  for (const r of records) {
    const path = join(
      root,
      "private-runtime",
      `r${r.repeat_index}`,
      r.case_id,
      "telemetry",
      "model-calls.jsonl",
    )
    if (await Bun.file(path).exists())
      for (const line of (await readFile(path, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean))
        usage.push(JSON.parse(line))
  }
  await write(join(root, "model-usage.json"), summarizeModelUsageV2(usage))
  await write(join(root, "latest.json"), value)
  await writeFile(
    join(root, "latest.md"),
    `# Evaluation v2\n\nMode: ${protocol.mode}\nJudge mode: ${protocol.judge_mode}\nGeneration model: ${protocol.generation_model}; judge model: ${protocol.judge_model ?? "none"}.\nSame-model separate calls are automated evaluation, not cross-model validation.\n\nPublished: ${ready.length}/${expected}; Docker verified: ${operational.docker_passed}/${expected}.\n\n${byRepeat.map((r) => `Repeat ${r.repeat_index}: ${JSON.stringify(r.metrics.metrics)}`).join("\n\n")}\n\nDevelopment runs are not formal competition results. Missing/blocked cases remain in the denominator.\n`,
  )
  return value
}
function integer(name: string, defaultValue: number, min: number, max: number) {
  const n = Number(option(name) ?? defaultValue)
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`INVALID_OPTION:${name}`)
  return n
}
async function dynamic() {
  const source = resolve(option("--main-run-dir") ?? "")
  if (!option("--main-run-dir") || source === root)
    throw new Error("DYNAMIC_REQUIRES_SEPARATE_MAIN_RUN_DIRECTORY")
  const env = {
    ...(await readEnv(resolve(".env.role-c.local"))),
    ...(await readEnv(
      resolve(option("--env-file") ?? ".env.evaluation-v2.local"),
    )),
    ...process.env,
  }
  const selected = COMPETITION_DYNAMIC_TRAJECTORIES_V2.filter(
    (t) => !option("--case-id") || t.case_id === option("--case-id"),
  )
  if (!selected.length) throw new Error("UNKNOWN_DYNAMIC_CASE")
  const rows = []
  for (const t of selected) {
    const path = join(source, "runs", "repeat-1", `${t.case_id}.json`)
    if (!(await Bun.file(path).exists())) {
      rows.push({
        case_id: t.case_id,
        passed: false,
        status: "not_run",
        reason: "main first-round evidence missing",
      })
      continue
    }
    const record = await read<CaseRecord>(path)
    if (record.status !== "ready" || !record.learning_session) {
      rows.push({
        case_id: t.case_id,
        passed: false,
        status: "blocked",
        reason: "first round unpublished",
      })
      continue
    }
    const directory = join(root, "private-runtime", t.case_id)
    await cp(join(source, "private-runtime", "r1", t.case_id), directory, {
      recursive: true,
      force: false,
      errorOnExist: true,
    })
    try {
      const value = await runDynamicTrajectoryV2({
        case_id: t.case_id,
        session_id: record.learning_session.sessionId,
        data_directory: directory,
        runtime: { env },
        persistDelivery: async (delivery) => {
          const id = (delivery as { delivery_id: string }).delivery_id.replace(
            /[^a-zA-Z0-9_-]/g,
            "_",
          )
          const folder = join(root, "deliveries", t.case_id)
          await mkdir(folder, { recursive: true })
          await write(join(folder, `${id}.json`), delivery)
        },
      })
      rows.push(value)
      await write(join(root, `${t.case_id}.json`), value)
    } catch (error) {
      rows.push({
        case_id: t.case_id,
        passed: false,
        status: "failed",
        reason: message(error),
      })
    }
  }
  const report = {
    suite: "dynamic.v2",
    total_expected: 12,
    selected: selected.length,
    metrics: computeDynamicTrajectoryMetricsV2(
      rows.map((value): DynamicTrajectoryResultV2 => {
        const trace = "rounds" in value ? value.rounds.at(-1) : undefined
        const expected = selected.find(
          (t) => t.case_id === value.case_id,
        )!.expected_action
        const actual =
          trace?.action as DynamicTrajectoryResultV2["actual_action"]
        const published = trace?.continuation_status === "published"
        return {
          case_id: value.case_id,
          expected_action: expected,
          actual_action: actual,
          same_node_when_required:
            published &&
            (actual === "advance" ||
              actual === "reprofile" ||
              trace?.same_node === true),
          next_node_when_required:
            published &&
            (actual !== "advance" ||
              (trace?.same_node === false &&
                trace?.next_targets_match === true)),
          profile_version_transition_valid:
            published &&
            (actual !== "reprofile" || trace?.profile_version_changed === true),
          target_fact_boundary_preserved:
            published &&
            (actual === "advance" ||
              actual === "reprofile" ||
              trace?.locked_targets_preserved === true),
          assessment_novelty_passed:
            Array.isArray(trace?.novelty_issues) &&
            trace.novelty_issues.length === 0,
          follow_up_published: published,
        }
      }),
    ),
    passed: rows.length === 12 && rows.every((r) => r.passed),
    rows,
  }
  await write(join(root, "dynamic.json"), report)
  console.log(
    JSON.stringify({
      total: report.total_expected,
      selected: report.selected,
      passed: rows.filter((r) => r.passed).length,
    }),
  )
  if (rows.some((r) => !r.passed)) process.exitCode = 1
}
function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
async function readEnv(path: string) {
  if (!(await Bun.file(path).exists())) return {}
  return Object.fromEntries(
    (await readFile(path, "utf8")).split(/\r?\n/).flatMap((line) => {
      const match = line.trim().match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
      return match ? [[match[1]!, match[2]!.replace(/^['"]|['"]$/g, "")]] : []
    }),
  )
}
async function sourceHash() {
  const entries: Array<[string, string]> = []
  const walk = async (p: string) => {
    for (const e of (await readdir(p, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (["node_modules", "dist", ".tmp", ".DS_Store"].includes(e.name))
        continue
      const f = join(p, e.name)
      if (e.isDirectory()) await walk(f)
      else entries.push([f, contentHash(await readFile(f, "utf8"))])
    }
  }
  for (const p of ["src", "schemas", "scripts", "docker"]) await walk(p)
  for (const p of [
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "tsconfig.evaluation.json",
  ])
    if (await Bun.file(p).exists())
      entries.push([p, contentHash(await readFile(p, "utf8"))])
  return contentHash(entries)
}
