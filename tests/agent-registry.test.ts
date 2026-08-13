import { describe, expect, test } from "bun:test"
import { createWorkflowAgents } from "../src/agents/registry"
import { WORKER_DEFINITIONS } from "../src/agents/workers"

describe("workflow agent registry", () => {
  test("registers one primary orchestrator and eight subagents", () => {
    const agents = createWorkflowAgents()

    expect(Object.keys(agents)).toHaveLength(9)
    expect(agents["learning-orchestrator"].mode).toBe("primary")

    for (const worker of WORKER_DEFINITIONS) {
      expect(agents[worker.name].mode).toBe("subagent")
      expect(agents[worker.name].prompt).toContain(`[executed:${worker.name}]`)
    }
  })

  test("restricts the orchestrator to workflow-control tools", () => {
    const orchestrator = createWorkflowAgents()["learning-orchestrator"]

    expect(orchestrator.tools).toEqual({
      "*": false,
      task: true,
      question: true,
    })
    expect(orchestrator.permission).toMatchObject({ "*": "deny", question: "allow" })
    expect(orchestrator.permission).toHaveProperty("task.*", "deny")
    for (const worker of WORKER_DEFINITIONS) {
      expect(orchestrator.permission).toHaveProperty(`task.${worker.name}`, "allow")
    }
  })

  test("prevents workers from using tools or delegating", () => {
    const agents = createWorkflowAgents()

    for (const worker of WORKER_DEFINITIONS) {
      expect(agents[worker.name].tools).toEqual({ "*": false })
      expect(agents[worker.name].permission).toEqual({ "*": "deny" })
    }
  })
})
