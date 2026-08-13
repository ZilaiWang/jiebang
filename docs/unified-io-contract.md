# Unified I/O Contract

## Purpose

This repository uses one canonical boundary layer to normalize A/B/C/D payloads at the edges without forcing every role to share the same internal DTO.

## Canonical shape

- `schemaVersion`: `1.0`
- `profile`: learner profile view
- `retrieval`: canonical RAG retrieval view
- `artifacts`: canonical learning artifact views
- `workflow`: role workflow events
- `path`: learning path nodes
- `evidenceGaps`: artifact IDs whose citations are missing or invalid

## Boundary rules

| Boundary | Input | Output | Rule |
|---|---|---|---|
| B → A | learner profile + query | RAG request | normalize only field names |
| A → C | lossless `RagResult` | C-internal `RagEvidencePack` | preserve facts, examples, practice tasks and private quiz seeds |
| C → D | reviewed artifacts/session | D session view | preserve gaps, never invent citations |
| Public session projection | mixed snake_case/camelCase payloads | unified handoff | accept both names, emit one answer-free display shape |

## Hard rules

1. Do not invent citations, facts, or IDs.
2. Missing evidence stays a gap.
3. Invalid citation stays visible as invalid, not silently repaired.
4. `snake_case` and `camelCase` are both accepted at the boundary.
5. Internal role logic stays untouched unless a specific adapter needs a boundary fix.
6. `UnifiedHandoff` is a public D/display projection. It must not be converted back into C's authoring input.
7. Boundary reports describe observed data segments; readiness is determined by C/D result status and review outcome.

## Files

- `src/contracts/unified/types.ts`
- `src/contracts/unified/normalizers.ts`
- `src/contracts/unified/index.ts`
- `src/unified-contract.ts` (compatibility re-export)

## Verification

- `bun run typecheck`
- `bun test --isolate ./tests/unified-contract.test.ts ./tests/role-d-role-c-integration.test.ts`
- `bun run check`
