# KnowBalance Personalized Learning Workflow

KnowBalance is a personalized Python learning system built around one learning-orchestrator main Agent and eight role-specific workers. Role D is a learner-facing interface that calls only the main Agent persistent-session API.

## Workflow

```text
用户 → Role D v2 → learning-orchestrator 主 Agent → 八个 Worker / A-B-C → 主 Agent持久状态 → Role D v2展示
```

Role D does not call A, B, C, or any Worker directly. It does not generate questions, build profiles, retrieve knowledge, score submissions, decide paths, or store authoritative mastery.

## Setup

```bash
bun install
bun run check
```

## Main Agent and Role D v2

Prerequisites: [bun](https://bun.sh) and [Docker Desktop](https://www.docker.com/products/docker-desktop/) running.

```bash
bun install
cp .env.role-c.example .env.role-c.local   # then fill in your model endpoint + API key
bun run docker:role-c:build                # builds the Python runner image used by Role C grading
```

Terminal one — main Agent (port 8787):

```bash
export PATH="/c/Program Files/Docker/Docker/resources/bin:$PATH"   # Windows; adjust for your Docker install
bun --env-file=.env.role-c.local scripts/learning-orchestrator-api.ts --host=127.0.0.1 --port=8787 --data-root=.tmp/integrated-orchestrator
```

Terminal two — Role D v2 web UI (port 4175):

```bash
bun run role-d:v2:dev -- --host 127.0.0.1 --port 4175
```

Open `http://127.0.0.1:4175/` in your browser. The page needs the main Agent on 8787; if you see “主 Agent请求未完成”, make sure terminal one is still running (background processes are cleared on restart).

The Role D v2 client uses only:

- `POST /orchestrator/sessions`
- `GET /orchestrator/sessions/:id`
- `POST /orchestrator/sessions/:id/commands`
- `GET /orchestrator/sessions/:id/events`

Validate the active D implementation with:

```bash
bun run role-d:v2:verify
```

The current persistent-session integration accepts `deterministic` mode. That is a main Agent backend limitation, not a Role D local orchestration path.

## Role A, B, and C

Role A provides traceable Python knowledge and retrieval. Role B produces learner evidence, profile, and formal path. Role C produces reviewed public lesson, lab, and assessment artifacts and keeps secure grading data private. Their production/provider status is controlled by the main Agent and its service contracts.

The repository also contains Role C model and Docker smoke commands for the upstream service itself:

```bash
bun run smoke:role-c:model
bun run docker:role-c:build
bun run docker:role-c:doctor
```

Do not treat the D v2 deterministic session mode as proof of a production model/Docker/A-B review chain.

## Verification

```bash
bun run check
bun run role-d:v2:verify
```

The repository's main check excludes retired legacy Role D asset tests and runs the active D v2 client tests, typecheck, and build. Main Agent tests remain in `tests/` and are not modified by the D migration.

## Credentials

Copy `.env.role-c.example` to `.env.role-c.local` only when a local Role C model smoke test requires it. `.env.role-c.local` is Git-ignored and must never be shared or committed.
