# Local Users and Learning Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development task-by-task.

**Goal:** Replace the single-session demo shell with local user profiles and a per-user learning-plan list that can resume, create, switch, and delete plans.

**Architecture:** Store user identity separately from learning-plan sessions in one versioned local workspace. The UI has three states: first-use profile setup, plan list, and active learning plan. Existing single-session local progress migrates into one default local user and one plan. Role B continues to own profile synthesis; Role D collects the declared user fields and passes them into B when creating a plan.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, Playwright, localStorage.

## Global Constraints

- Local profiles are not cloud accounts and must be labelled as such.
- A plan belongs to exactly one local user.
- Switching users never exposes or modifies another user's plans.
- Deleting a plan deletes only that plan and requires confirmation.
- Existing legacy single-session progress must migrate without loss.
- Plan sessions retain all current strict validation, citations, answers, and checkpoint recovery.
- UI must not ask repeated profile fields when creating another plan for the same user.

---

### Task 1: Versioned local workspace store

**Files:**
- Create: `src/role-d-ui/src/domain/workspace-store.ts`
- Test: `src/role-d-ui/src/domain/workspace-store.test.ts`

**Interfaces:**
- Produces: `LocalLearner`, `LearningPlanRecord`, `LearningWorkspaceState`, `loadWorkspace`, `saveWorkspace`, `createLocalLearner`, `addPlan`, `selectPlan`, `deletePlan`, `switchUser`.
- Consumes: `RoleDSession`, legacy `loadSession`, and `isValidRoleDSession`.

- [ ] Write failing tests for first-use empty state, two users with isolated plans, plan selection/resume, deletion isolation, strict corrupt-state rejection, and legacy session migration.
- [ ] Run targeted Vitest and verify RED.
- [ ] Implement the minimal versioned store and immutable update helpers.
- [ ] Run targeted Vitest and verify GREEN.

### Task 2: First-use local user profile

**Files:**
- Create: `src/role-d-ui/src/components/UserSetupScreen.tsx`
- Test through: `src/role-d-ui/src/App.test.tsx`

**Interfaces:**
- Collects: display name, major/identity context, Python familiarity, weekly study time, prior languages.
- Produces: `LocalLearner` fields that map to B background/self-assessment inputs.

- [ ] Write failing App test for first launch profile setup.
- [ ] Verify RED.
- [ ] Implement form validation and local-profile creation.
- [ ] Verify GREEN.

### Task 3: Per-user learning plan list

**Files:**
- Create: `src/role-d-ui/src/components/PlanListScreen.tsx`
- Modify: `src/role-d-ui/src/components/NewPlanDialog.tsx`
- Test through: `src/role-d-ui/src/App.test.tsx`

**Interfaces:**
- Consumes active `LocalLearner` and that user's `LearningPlanRecord[]`.
- New-plan form collects only plan title, goal, known concepts, and weak concepts; profile fields come from the active user.

- [ ] Write failing tests for empty plan list, creating two plans, and resuming each plan's independent stage.
- [ ] Verify RED.
- [ ] Implement plan cards and simplified new-plan dialog.
- [ ] Verify GREEN.

### Task 4: User switch and plan deletion

**Files:**
- Create: `src/role-d-ui/src/components/UserMenu.tsx`
- Modify: `src/role-d-ui/src/App.tsx`
- Modify: `src/role-d-ui/src/components/AppSidebar.tsx`
- Test through: `src/role-d-ui/src/App.test.tsx`

**Interfaces:**
- User menu switches active local profile and opens profile creation.
- Delete action replaces restart and removes only the active plan after confirmation.

- [ ] Write failing tests for switching users and deleting one plan without affecting siblings.
- [ ] Verify RED.
- [ ] Implement controls and confirmation copy.
- [ ] Verify GREEN.

### Task 5: Progress import/export and browser flows

**Files:**
- Modify: `src/role-d-ui/src/components/ProgressFileControls.tsx`
- Modify: `.hermes/e2e/guided-flow.spec.ts`
- Modify: `.hermes/e2e/capture-guided.spec.ts`
- Modify: `docs/role_d_frontend_guide.md`

**Interfaces:**
- Export/import continues to operate on one selected plan session.
- Imported progress becomes a plan belonging to the active local user.

- [ ] Add browser tests for first-use setup, two plans, switching/resume, deletion isolation, refresh recovery, and mobile plan list.
- [ ] Run targeted browser tests.
- [ ] Run full repository tests, Role D tests, typecheck, build, audit, and browser suite.
- [ ] Commit only after fresh verification and user visual approval.
