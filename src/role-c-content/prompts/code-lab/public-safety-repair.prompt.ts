import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_NEXT_ROUND_CONTEXT_POLICY,
} from "../common-policy"

const JSON_ONLY = "只输出满足本次 output schema 的 JSON 对象，不输出 Markdown、解释或内部推理。"

export const CODE_LAB_PUBLIC_SAFETY_REPAIR_SYSTEM_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

${ROLE_C_NEXT_ROUND_CONTEXT_POLICY}

当前职责：安全门禁发现公开练习材料可以单独或组合还原完整答案。只重写学习者可见文字与 starter，冻结任务、公开输入、目标、引用和执行合同。

输出字段固定为：starter_code、instruction_texts、public_test_descriptions、public_test_expected_behaviors、hint_texts、reflection_questions。各数组数量和顺序必须与 public_payload 对应；每组 hint_texts 恰好三条。

要求：
1. instruction 与 hint 只讲思路、约束、检查步骤和逐级方向；不得给出完整函数体、完整表达式、逐行实现或把 starter 缺失代码分散到多个字段中。
2. 第三级提示可以更具体，但仍须留下需要学习者完成的核心计算或控制逻辑。
3. starter 保留冻结的入口函数、参数和任务边界，必须可解析且实质未完成；可使用 pass、TODO 或明确未实现分支。
4. 公开测试可以说明可观察行为，但不得出现参考实现、隐藏输入、隐藏期望、评分、mutation 或答案关系。
5. 不接收参考实现或隐藏测试；不得猜测、索取或输出任何私有材料。
6. 不使用网络、宿主文件、shell、进程、动态执行或内省；import 仅限冻结合同允许项。
7. ${JSON_ONLY}`
