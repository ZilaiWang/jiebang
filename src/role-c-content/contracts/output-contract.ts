import type { ExecutionContract } from "./artifacts"

export type OutputContractKind = "string" | "number" | "array" | "object" | "boolean" | "unknown"
export type OutputContract = ExecutionContract["output_contract"]

const KNOWN_KINDS = new Set<OutputContractKind>([
  "string",
  "number",
  "array",
  "object",
  "boolean",
  "unknown",
])

/** Single authority for output-contract interpretation. Explicit kind wins; legacy type remains supported. */
export function classifyOutputContract(contract: OutputContract): OutputContractKind {
  if (contract.kind && KNOWN_KINDS.has(contract.kind)) return contract.kind

  const text = [contract.type, ...(contract.constraints ?? [])]
    .join(" ")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()

  // Containers must win over element words such as "list of numbers" or
  // "object mapping names to numeric scores".
  if (/(?:array|list|数组|列表)/u.test(text)) return "array"
  if (/(?:object|dict|map|对象|字典|映射)/u.test(text)) return "object"
  if (/(?:stdout|标准输出|text|string|str|字符串|文本)/u.test(text)) return "string"
  if (/(?:number|numeric|float|integer|int|数值|数字|整数|浮点)/u.test(text)) return "number"
  if (/(?:boolean|bool|布尔)/u.test(text)) return "boolean"
  return "unknown"
}

export function classifyExpectedValue(value: unknown): OutputContractKind {
  if (Array.isArray(value)) return "array"
  if (value !== null && typeof value === "object") return "object"
  if (typeof value === "string") return "string"
  if (typeof value === "number" && Number.isFinite(value)) return "number"
  if (typeof value === "boolean") return "boolean"
  return "unknown"
}
