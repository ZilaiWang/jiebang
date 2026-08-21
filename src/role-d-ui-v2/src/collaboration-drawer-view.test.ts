import { describe, expect, test } from "bun:test"
import { collaborationDrawerView } from "./orchestrator-view"

describe("collaboration drawer view", () => {
  test("marks only a live current-round worker purple/current", () => {
    const view = collaborationDrawerView({
      status: "running",
      round_no: 2,
      worker_ledger_history: [
        { unit_name: "profile-builder", status: "completed", round_no: 1, attempt_no: 1, output_refs: [] },
        { unit_name: "profile-builder", status: "running", round_no: 2, attempt_no: 1, output_refs: [] },
      ],
    })
    expect(view.stations.find((item) => item.unit === "profile-builder")?.state).toBe("current")
    expect(view.stations.find((item) => item.unit === "path-planner")?.state).toBe("pending")
  })

  test("does not preserve stale running after the session waits for the user", () => {
    const view = collaborationDrawerView({
      status: "waiting_for_user",
      round_no: 1,
      worker_ledger_history: [
        { unit_name: "profile-builder", status: "running", round_no: 1, attempt_no: 1, output_refs: [] },
      ],
    })
    expect(view.stations.find((item) => item.unit === "profile-builder")?.state).toBe("pending")
  })

  test("maps completed green and counts public outputs only", () => {
    const view = collaborationDrawerView({
      status: "waiting_for_user",
      round_no: 1,
      worker_ledger_history: [{
        unit_name: "concept-tutor", status: "completed", round_no: 1, attempt_no: 1,
        execution_type: "reviewed_pipeline",
        output_refs: [
          { ref_id: "PUBLIC", visibility: "public" },
          { ref_id: "SECURE", visibility: "secure" },
        ],
      }],
    })
    const station = view.stations.find((item) => item.unit === "concept-tutor")
    expect(station?.state).toBe("completed")
    expect(station?.publicOutputCount).toBe(1)
  })
})
