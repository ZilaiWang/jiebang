import { describe, expect, test } from "bun:test"
import { buildLearningEvidenceRequest, retrieveLearningEvidence } from "../src/rag/learning-evidence"
import { adaptRagResult } from "../src/role-c-content/contracts/evidence-pack"

describe("current B node evidence confidence", () => {
  test("treats a complete identity hydration as strong without forging semantic trace fields", async () => {
    const result = await retrieveLearningEvidence(buildLearningEvidenceRequest({
      run_id: "RUN-1",
      retrieval_mode: "identity_hydration",
      learner_profile: { profile_version: "P1", level: "beginner", known_concepts: [], weak_concepts: [], goal: "认识 Python" },
      path_context: {
        node_id: "N1", target_source_ids: ["K001"], prerequisite_source_ids: [], goal: "Python 是什么",
        objectives: [{ objective_id: "O1", source_id: "K001", required_fact_ids: ["F001"], observable_behavior: "recognize", importance: "core" }],
      },
      resource_needs: ["fact"],
      top_k: 1,
    }))
    expect(result.match_status).toBe("strong")
    expect(result.retrieval_context?.retrieval_mode).toBe("identity_hydration")
    expect(result.results[0]?.retrievalTrace.matchedFields).toEqual(["source_id"])
    expect(adaptRagResult(result, { kb_version: "test", rag_version: "test" }).match_status).toBe("strong")
  })
})
