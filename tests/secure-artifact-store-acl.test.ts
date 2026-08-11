import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  AtomicFileSecureArtifactStore,
  secureStoreDirectoryMode,
  type SecureArtifact,
} from "../src/role-c-content/security/secure-artifact-store"

const secureArtifact: SecureArtifact = {
  schema_version: "1.0",
  run_id: "RUN-ACL",
  artifact_id: "ART-ACL",
  artifact_type: "assessment_secure",
  agent: "tiered-evaluator",
  status: "ready",
  versions: { profile_version: "p1", kb_version: "kb1", rag_version: "rag1", prompt_version: "prompt1", model_config_hash: "model1", schema_version: "1.0" },
  seed: 1,
  input_refs: [],
  citations: [],
  quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1, answer_key_verified: true },
  payload: {
    form_id: "FORM-ACL",
    option_order_seed: 1,
    code_test_suites: [],
    objective_coverage: [{ objective_id: "O1", item_ids: ["I1"], answer_kinds: ["exact_set"] }],
    items: [{
      item_id: "I1", objective_id: "O1", tier: 1, modality: "mcq", max_score: 1,
      answer_spec: { kind: "exact_set", accepted: ["correct"], normalization: ["trim", "casefold"] },
      correct_option_id: "correct", misconception_by_option: {}, evidence_weight: 1,
    }],
  },
  trace_ref: "TRACE-ACL",
}

const context = { principal: "role-c-admin" as const, run_id: "RUN-ACL" }

describe("atomic secure artifact store ACL boundary", () => {
  test("keeps POSIX mode protection while persisting opaque artifact files", async () => {
    const root = await mkdtemp(join(tmpdir(), "secure-store-acl-"))
    try {
      const store = new AtomicFileSecureArtifactStore({ root_directory: root })
      const [ref] = await store.putBatch([secureArtifact], context)
      if (process.platform === "win32") {
        const { stdout } = await promisify(execFile)("icacls.exe", [root], { windowsHide: true })
        expect(stdout.toLowerCase()).not.toContain("builtin\\users:(")
        expect(stdout.toLowerCase()).not.toContain("authenticated users:(")
      } else {
        expect(await secureStoreDirectoryMode(root)).toBe(0o700)
      }
      const batches = await readdir(root)
      expect(batches).toHaveLength(1)
      const files = await readdir(join(root, batches[0]!))
      expect(files).toHaveLength(1)
      expect(JSON.parse(await readFile(join(root, batches[0]!, files[0]!), "utf8")).artifact.api_key).toBeUndefined()
      expect(ref).toMatch(/^secure:\/\/role-c\/v1\/[a-f0-9]{48}\/[a-f0-9]{48}$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
