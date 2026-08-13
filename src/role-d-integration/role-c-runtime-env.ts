import { isAbsolute, resolve } from "node:path"

export const DEFAULT_ROLE_C_RUNTIME_DATA_DIRECTORY = ".tmp/role-c-runtime"

export function resolveRoleCRuntimeEnvironment(
  processEnvironment: Record<string, string | undefined>,
  privateEnvText = "",
): Record<string, string | undefined> {
  const fileEnvironment = parseEnvFile(privateEnvText)
  return { ...fileEnvironment, ...processEnvironment }
}

export function resolveRoleCRuntimeDataDirectory(
  environment: Record<string, string | undefined>,
  projectDirectory: string,
): string {
  const configured = environment.ROLE_C_RUNTIME_DATA_DIR?.trim()
    || DEFAULT_ROLE_C_RUNTIME_DATA_DIRECTORY
  return isAbsolute(configured)
    ? resolve(configured)
    : resolve(projectDirectory, configured)
}

export function resolveRoleCProviderMode(
  environment: Record<string, string | undefined>,
): "model" | "deterministic" | "unconfigured" {
  const explicit = environment.ROLE_C_PROVIDER_MODE?.trim().toLocaleLowerCase()
  if (explicit && explicit !== "model" && explicit !== "deterministic") {
    throw new Error("ROLE_C_PROVIDER_MODE 只允许 model 或 deterministic")
  }
  if (explicit === "model") return "model"
  if (explicit === "deterministic") return "deterministic"
  return environment.ROLE_C_MODEL_ENDPOINT?.trim() && environment.ROLE_C_MODEL_ID?.trim()
    ? "model"
    : "unconfigured"
}

function parseEnvFile(text: string): Record<string, string> {
  const output: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const rawValue = line.slice(separator + 1).trim()
    const value = rawValue.length >= 2
      && ((rawValue.startsWith('"') && rawValue.endsWith('"'))
        || (rawValue.startsWith("'") && rawValue.endsWith("'")))
      ? rawValue.slice(1, -1)
      : rawValue
    output[key] = value
  }
  return output
}
