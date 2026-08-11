# KnowBalance team integration

Current Role D implementation is `src/role-d-ui-v2`. It calls only the learning-orchestrator persistent-session API. The retired legacy `src/role-d-ui` implementation is not part of the active product or verification path.

## Team topology

```text
A knowledge → B profile/path → main Agent orchestration → C reviewed public artifacts → D v2 display
```

D v2 does not directly call A, B, C, or Workers.

## Setup

```bash
bun install --frozen-lockfile
bun scripts/learning-orchestrator-api.ts --host=127.0.0.1 --port=8787 --data-root=.tmp/role-d-ui-v2-orchestrator
```

In another terminal:

```bash
bun run role-d:v2:dev -- --host 127.0.0.1 --port 4175
```

Open `http://127.0.0.1:4175/`.

## D verification

```bash
bun run role-d:v2:verify
```

## Main Agent boundary

D calls only:

- `POST /orchestrator/sessions`
- `GET /orchestrator/sessions/:id`
- `POST /orchestrator/sessions/:id/commands`
- `GET /orchestrator/sessions/:id/events`

The active local session integration currently uses the main Agent's deterministic mode. Production model, Docker, and review-provider wiring belongs to the main Agent/C service owner.
