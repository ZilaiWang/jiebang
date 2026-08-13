/**
 * 分阶段生成的通用修复提示词模板。
 * 用于 code-lab 和 evaluator 的分阶段校验失败重试。
 */
export function stagedRepairPrompt(basePrompt: string, issues: string[]): string {
  return `${basePrompt}

上一次本阶段输出未通过校验。保持冻结合同不变，只修复以下失败项：
${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}

若失败项包含 hidden_test_input_leak：重新设计所有重复的 hidden_tests.input，逐一与冻结 public payload 的 public_tests.input 做 JSON 全值比较，改用公开材料中从未出现的新结构和新标量组合，并同步重算对应 expected；不得删除或改写 public payload。
若失败项包含 hidden_test_expected_leak：不要改 public payload；改用不同隐藏输入并根据 reference_solution 重新计算 expected，确保 expected 的完整结构及非低熵文本不出现在公开说明、提示或测试描述中。
若失败项包含 static_unlisted_import 或 STATIC_UNLISTED_IMPORT：逐行删除或改写 reference_solution 中不在 execution_contract.allowed_imports 的 import/from import；allowed_imports=[] 时输出必须完全不含 import，使用内置语法完成任务，不得增加、猜测或修改冻结的 allowed_imports。
若失败项指出 items[n] 与已发布题目重复：必须完整重写这些下标对应的题目，不保留原题干骨架；选择/判断题改用新的判断角度和具体情境，追踪题改变控制流或数据流结构，简答题改用新的错误诊断、比较或迁移任务，代码题改变函数任务、参数组织和输出行为。只换数字、变量名、选项顺序、干扰项或背景名仍视为重复。严格执行输入中的 repair_directive.required_change_indices 和 variation_token。
修复必须产生与 previous_output 不同的相关字段；若原隐藏输入是公开输入的轻微改写，不得只调整顺序或包装层。
修复期间若输入含 revision_objections，不得撤销已经完成的外审修订，也不得把审核消息、定位信息或建议动作复制到公开产物。`
}
