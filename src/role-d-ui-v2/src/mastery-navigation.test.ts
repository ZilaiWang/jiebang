import { describe, expect, test } from "bun:test"
import { completedNodeFromPath, isFinalAdvanceSession, nextUnmasteredPathNode } from "./orchestrator-view"

describe("mastery navigation", () => {
  const nodes = [
    { node_id: "N1", target_source_ids: ["K001"], status: "completed" },
    { node_id: "N2", target_source_ids: ["K002"], status: "in_progress" },
    { node_id: "N3", target_source_ids: ["K003"], status: "pending" },
  ]

  test("returns the completed node and the next unmastered node in formal order", () => {
    const session = { formal_path: { nodes }, current_path_node: nodes[1] }
    expect(completedNodeFromPath(session)).toMatchObject({ node_id: "N1", target_source_ids: ["K001"] })
    expect(nextUnmasteredPathNode(session)).toMatchObject({ node_id: "N2", target_source_ids: ["K002"] })
  })

  test("recognizes final advance only when every formal node is completed", () => {
    expect(isFinalAdvanceSession({ status: "completed", current_path_node: null, feedback: { final_decision: { action: "advance" } }, formal_path: { nodes: [{ status: "completed" }] } })).toBe(true)
    expect(isFinalAdvanceSession({ status: "waiting_for_user", current_path_node: nodes[1], feedback: { final_decision: { action: "advance" } }, formal_path: { nodes } })).toBe(false)
  })

  test("does not call an intermediate completed session final", () => {
    expect(isFinalAdvanceSession({ status: "completed", current_path_node: null, feedback: { final_decision: { action: "advance" } }, formal_path: { nodes: [{ status: "completed" }, { status: "pending" }] } })).toBe(false)
  })
})
