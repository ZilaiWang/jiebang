import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_NEXT_ROUND_CONTEXT_POLICY,
} from "../common-policy"

const JSON_ONLY = "只输出满足本次 output schema 的 JSON 对象，不输出 Markdown、解释或内部推理。"

/**
 * Code Lab Starter 修复提示词。
 * 当 Docker 验证发现 starter 已能通过全部测试时，将其退化为真正的学习骨架。
 *
 * 修复策略：
 * - 保留函数签名、参数、返回合同和允许的 import
 * - 用 pass/raise NotImplementedError/TODO 替换核心逻辑
 * - 不改变题目要求或公开测试
 */
export const CODE_LAB_STARTER_REPAIR_SYSTEM_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

${ROLE_C_NEXT_ROUND_CONTEXT_POLICY}

当前职责：可信 Docker 已证明公开 starter_code 完整通过了全部隐藏测试。只输出一个最小公开补丁 {"starter_code": "..."}，把 starter 改为确实需要学习者完成的代码骨架。

要求：
1. 保留 public_payload 定义的函数名、参数、返回合同、允许 import 和任务边界；不得改变题目、公开测试或执行模式。
2. starter 必须可解析、可安全启动，但不得直接完成任务。用 pass、明确 TODO 或局部未完成分支留下实质工作，不能只删注释、改变量名或写一个仍等价于完整答案的实现。
3. 不接收也不得猜测参考答案、隐藏输入、expected、评分组或 mutation；不得在 starter 中写入答案或测试材料。
4. 不得使用网络、宿主文件、shell、进程、动态执行或内省；不得动态访问双下划线属性，普通类的 __init__ 定义可用；import 只能来自 public_payload.execution_contract.allowed_imports。
5. 文件类任务仍使用文本参数或 io.StringIO 的内存合同，不得调用 open 或访问宿主路径。
6. ${JSON_ONLY}`
