#!/usr/bin/env bash
set -euo pipefail

# KnowBalance competition final release gate.
# Run from the repository root after copying audit-teaching-evidence.ts to scripts/.
# Required: Bun, Docker, real-model credentials in .env.role-c.local.

RELEASE_BRANCH="${RELEASE_BRANCH:-competition-final}"
RESULT_DIR="${RESULT_DIR:-evaluation/results}"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v git >/dev/null || fail "git is required"
command -v bun >/dev/null || fail "bun is required"
command -v docker >/dev/null || fail "docker is required"

[[ -f package.json ]] || fail "run this script from the jiebang repository root"
[[ -f scripts/audit-teaching-evidence.ts ]] || fail "copy audit-teaching-evidence.ts to scripts/ first"
mkdir -p "$RESULT_DIR"

current_branch="$(git branch --show-current)"
current_commit="$(git rev-parse HEAD)"
[[ -n "$current_branch" ]] || fail "detached HEAD is not a release state"
[[ -z "$(git status --porcelain)" ]] || fail "working tree is not clean"

say "Release identity"
printf 'branch=%s\ncommit=%s\n' "$current_branch" "$current_commit"
if [[ "$current_branch" != "$RELEASE_BRANCH" ]]; then
  fail "expected release branch '$RELEASE_BRANCH', got '$current_branch' (override with RELEASE_BRANCH=...)"
fi

say "Dependency lock and static checks"
bun install --frozen-lockfile
bun run check
bun run role-d:v2:verify

say "Authored teaching-evidence gate"
bun scripts/audit-teaching-evidence.ts --strict | tee "$RESULT_DIR/teaching-evidence-audit.txt"

say "Trusted Python execution environment"
bun run docker:role-c:build
bun run docker:role-c:doctor
bun run test:role-c:docker

say "Real-model smoke"
bun run smoke:role-c:model

say "Formal metric protocol"
bun run eval:competition:dev
bun run eval:competition:robustness
bun run eval:competition:final

required_files=(
  "$RESULT_DIR/protocol.json"
  "$RESULT_DIR/claims.json"
  "$RESULT_DIR/difficulty-audits.json"
  "$RESULT_DIR/latest.json"
  "$RESULT_DIR/latest.md"
  "$RESULT_DIR/manual-audit-template.csv"
  "$RESULT_DIR/manual-audit.csv"
  "$RESULT_DIR/showcase-comparison.json"
  "$RESULT_DIR/showcase-comparison.md"
  "$RESULT_DIR/judge-usage.json"
  "$RESULT_DIR/robustness-latest.json"
)
for path in "${required_files[@]}"; do
  [[ -s "$path" ]] || fail "missing or empty final evidence: $path"
done

say "Machine-check final report"
bun -e '
const path = process.env.RESULT_DIR ?? "evaluation/results";
const report = await Bun.file(`${path}/latest.json`).json();
const requiredGates = [
  "enough_cases",
  "hallucination_passed",
  "adaptation_passed",
  "coverage_passed",
  "claim_audit_complete",
  "difficulty_audit_complete",
];
for (const gate of requiredGates) {
  if (report.aggregate?.gates?.[gate] !== true) {
    throw new Error(`FINAL_GATE_FAILED:${gate}`);
  }
}
if (report.passed !== true) throw new Error("FINAL_REPORT_NOT_PASSED");
if ((report.protocol?.repeats ?? 0) < 2) throw new Error("FORMAL_REPEATS_LT_2");
if ((report.aggregate?.total_cases ?? 0) < 50) throw new Error("FORMAL_CASES_LT_50");
const expectedRuns = (report.aggregate.total_cases ?? 0) * report.protocol.repeats;
if (report.operational?.completed_case_records !== expectedRuns) {
  throw new Error(`INCOMPLETE_CASE_RECORDS:${report.operational?.completed_case_records}/${expectedRuns}`);
}
if ((report.operational?.failed ?? 0) !== 0 || (report.operational?.blocked ?? 0) !== 0) {
  throw new Error(`NON_READY_CASES:failed=${report.operational?.failed},blocked=${report.operational?.blocked}`);
}
console.log(JSON.stringify({
  commit: report.protocol.repository_commit,
  cases: report.aggregate.total_cases,
  repeats: report.protocol.repeats,
  hallucination: report.aggregate.metrics.hallucination_rate,
  adaptation: report.aggregate.metrics.resource_adaptation_accuracy,
  coverage: report.aggregate.metrics.core_knowledge_coverage,
}, null, 2));
'

say "Manual review file sanity"
bun -e '
const path = process.env.RESULT_DIR ?? "evaluation/results";
const csv = await Bun.file(`${path}/manual-audit.csv`).text();
const rows = csv.trim().split(/\r?\n/);
if (rows.length < 13) throw new Error(`MANUAL_AUDIT_TOO_SMALL:${rows.length - 1}`);
const header = rows[0] ?? "";
for (const field of ["reviewer_1", "reviewer_2", "adjudication"]) {
  if (!header.includes(field)) throw new Error(`MANUAL_AUDIT_COLUMN_MISSING:${field}`);
}
const blankDecision = rows.slice(1).some((row) => /,{2,}/u.test(row));
if (blankDecision) console.warn("WARNING: manual-audit.csv may still contain blank cells; inspect before submission.");
console.log(`manual_rows=${rows.length - 1}`);
'

say "Final identity consistency"
bun -e '
const path = process.env.RESULT_DIR ?? "evaluation/results";
const report = await Bun.file(`${path}/latest.json`).json();
const head = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
if (report.protocol.repository_commit !== head) {
  throw new Error(`RESULT_COMMIT_MISMATCH:${report.protocol.repository_commit}!=${head}`);
}
console.log(`frozen_commit=${head}`);
'

say "Release gate passed"
printf 'Next mandatory repository action: set %s as the GitHub default branch or tag this exact commit and use that immutable link in the submission.\n' "$RELEASE_BRANCH"
