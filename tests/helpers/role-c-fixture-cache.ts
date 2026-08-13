import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/**
 * 真实模型 fixture 缓存。
 *
 * Role C 学习循环测试的 fixture 需要真实模型生成全套内容
 * （concept 3 段 + code-lab public/secure + assessment public/secure，
 * 约 8-10 次模型调用）。全量测试时每次重新生成既慢又随机红
 * （模型输出有小概率触发安全/合同门禁）。缓存让：
 * - 首次运行：真实模型生成一次并写入 .tmp/role-c-fixtures/
 * - 后续运行：直接读缓存，秒级加载、零随机失败
 * - 生成质量验证仍由 scripts/role-c-real-model-smoke.ts 承担
 *
 * 缓存键建议携带 prompt 版本，提示词变化后自动失效。
 */
export interface CachedRoleCFixture<TArtifact = unknown> {
  pipeline_input: unknown
  pipeline_result: unknown
  /** 完整 secure artifacts（重建内存 store 用，refs 会重新分配） */
  secure_artifacts: TArtifact[]
  snapshot: unknown
}

const CACHE_ROOT = join(process.cwd(), ".tmp", "role-c-fixtures")

export function loadCachedRoleCFixture<TArtifact = unknown>(
  key: string,
): CachedRoleCFixture<TArtifact> | undefined {
  const path = join(CACHE_ROOT, `${key}.json`)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CachedRoleCFixture<TArtifact>
  } catch {
    return undefined
  }
}

export function saveCachedRoleCFixture(
  key: string,
  value: CachedRoleCFixture,
): void {
  mkdirSync(CACHE_ROOT, { recursive: true })
  writeFileSync(join(CACHE_ROOT, `${key}.json`), JSON.stringify(value))
}

/** 清除缓存（真实重新生成时调用）。 */
export function clearRoleCFixtureCache(): void {
  mkdirSync(CACHE_ROOT, { recursive: true })
  for (const entry of readdirSync(CACHE_ROOT)) {
    rmSync(join(CACHE_ROOT, entry), { force: true })
  }
}
