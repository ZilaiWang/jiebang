import type { CodeTestSuiteResolver, RunnerTestSuite } from "./code-runner"
import type { SecureArtifactStore, SecureStoreContext } from "./secure-artifact-store"
import type { AssessmentSecureArtifact, CodeLabSecureArtifact } from "../contracts/artifacts"

interface RegisteredSuiteRef {
  secure_ref: string
  context: SecureStoreContext
  artifact_type: "code_lab_secure" | "assessment_secure"
}

/** Keeps only an internal suite→opaque-ref index; hidden tests remain in SecureArtifactStore. */
export class SecureStoreCodeTestSuiteRegistry implements CodeTestSuiteResolver {
  private readonly suites = new Map<string, RegisteredSuiteRef>()

  constructor(private readonly store: SecureArtifactStore) {}

  async registerCodeLab(secureRef: string, context: SecureStoreContext): Promise<string> {
    const artifact = await this.store.get(secureRef, context)
    if (artifact.artifact_type !== "code_lab_secure" || !artifact.payload) {
      throw new Error("只有 ready code_lab_secure artifact 可以注册测试套件")
    }
    const codeLabArtifact = artifact as CodeLabSecureArtifact
    const suiteId = codeLabArtifact.payload!.test_suite_id
    const existing = this.suites.get(suiteId)
    if (existing && existing.secure_ref !== secureRef) {
      throw new Error(`test_suite_id 冲突：${suiteId}`)
    }
    this.suites.set(suiteId, { secure_ref: secureRef, context: { ...context }, artifact_type: "code_lab_secure" })
    return suiteId
  }

  async registerAssessment(secureRef: string, context: SecureStoreContext): Promise<string[]> {
    const artifact = await this.store.get(secureRef, context)
    if (artifact.artifact_type !== "assessment_secure" || !artifact.payload) {
      throw new Error("只有 ready assessment_secure artifact 可以注册测试套件")
    }
    const assessment = artifact as AssessmentSecureArtifact
    const suiteIds = assessment.payload!.code_test_suites.map((suite) => suite.test_suite_id)
    for (const suiteId of suiteIds) {
      const existing = this.suites.get(suiteId)
      if (existing && existing.secure_ref !== secureRef) throw new Error(`test_suite_id 冲突：${suiteId}`)
    }
    suiteIds.forEach((suiteId) => this.suites.set(suiteId, {
      secure_ref: secureRef,
      context: { ...context },
      artifact_type: "assessment_secure",
    }))
    return suiteIds
  }

  async resolve(testSuiteId: string): Promise<RunnerTestSuite | undefined> {
    const registered = this.suites.get(testSuiteId)
    if (!registered) return undefined
    const artifact = await this.store.get(registered.secure_ref, registered.context)
    if (!artifact.payload || artifact.artifact_type !== registered.artifact_type) return undefined
    if (artifact.artifact_type === "code_lab_secure") {
      const codeLabArtifact = artifact as CodeLabSecureArtifact
      if (codeLabArtifact.payload!.test_suite_id !== testSuiteId) throw new Error("secure artifact 的 test_suite_id 已变化")
      return {
        test_suite_id: testSuiteId,
        execution_contract: structuredClone(codeLabArtifact.payload!.execution_contract),
        tests: structuredClone(codeLabArtifact.payload!.hidden_tests),
      }
    }
    const assessment = artifact as AssessmentSecureArtifact
    const suite = assessment.payload!.code_test_suites.find((entry) => entry.test_suite_id === testSuiteId)
    if (!suite) throw new Error("secure assessment 的 test_suite_id 已变化")
    return {
      test_suite_id: testSuiteId,
      execution_contract: structuredClone(suite.execution_contract),
      tests: structuredClone(suite.hidden_tests),
    }
  }
}
