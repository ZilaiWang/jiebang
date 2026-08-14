/**
 * 分阶段生成的通用修复提示词模板。
 * 用于 code-lab 和 evaluator 的分阶段校验失败重试。
 */
export function stagedRepairPrompt(basePrompt: string, issues: string[]): string {
  return `${basePrompt}

上一次本阶段输出未通过校验。保持冻结合同不变，只修复以下失败项：
${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}

这里的冻结合同只指 previous_input 中的 generation_spec、staged_contract 身份、目标、证据和安全边界。previous_output 是尚未通过的模型草稿，其中的 execution_contract、任务文字、starter、公开测试、提示、参考实现和测试语义都不是上游冻结合同；只要失败项要求，就必须协同修改这些草稿字段。

若失败项包含 hidden_test_input_leak：读取 repair_context.forbidden_public_inputs 和 forbidden_public_scalar_values，重新设计所有失败的 hidden_tests.input。新输入不得与任一公开输入 JSON 相同，且其中每个数字、字符串、布尔值和 null 都不得复用 forbidden_public_scalar_values。必须同步根据 reference_solution 重算每个 expected；不得删除或改写 public payload，不得原样返回 previous_output。
若失败项包含 hidden_test_expected_leak：不要改 public payload；改用不同隐藏输入并根据 reference_solution 重新计算 expected，确保 expected 的完整结构及非低熵文本不出现在公开说明、提示或测试描述中。
若失败项包含 static_unlisted_import、STATIC_UNLISTED_IMPORT、static_forbidden_import 或 STATIC_FORBIDDEN_IMPORT：以 previous_input 中冻结的 execution_contract.allowed_imports 为唯一权威，逐行删除或改写 reference_solution 中所有不在该数组内的 import/from import。allowed_imports=[] 时新 reference_solution 必须完全不含 import/from import，也不得为类型注解导入 typing；使用内置语法完成任务，不得增加、猜测或修改冻结的 allowed_imports。修复输出中 reference_solution 必须与 previous_output 不同。
若失败项包含 FUNCTION_OUTPUT_CONTRACT_MISMATCH：必须重新选择并统一一个执行模式。若当前目标以 print/屏幕输出为可观察结果，改为 stdin_stdout，删除 entry_point，把 input_contract/output_contract、starter_code、instruction、public_test 和 hints 全部改成完整程序的标准输入/输出语义，不能再出现“提交函数”或“返回值”。否则保留 function，确保 entry_point 与 starter_code 的 def 签名一致，把可观察结果改成 JSON 可序列化的函数返回值，并删除 print/stdout 作为评分结果的要求。不得只改 execution_mode 字段。
若失败项包含 STDIN_FUNCTION_CONTRACT_MISMATCH：保持 stdin_stdout 时，必须删除函数、entry_point、return 和返回值措辞，按标准输入/标准输出同步重写任务、starter 和公开测试；若学习任务本质必须调用函数，则整体改为 function 并同步提供 entry_point、def starter、函数调用封装输入和 JSON 可序列化返回值。不得混用两种模式。
若失败项指出 items[n] 与已发布题目重复：必须完整重写这些下标对应的题目，不保留原题干骨架；选择/判断题改用新的判断角度和具体情境，追踪题改变控制流或数据流结构，简答题改用新的错误诊断、比较或迁移任务，代码题改变函数任务、参数组织和输出行为。只换数字、变量名、选项顺序、干扰项或背景名仍视为重复。严格执行输入中的 repair_directive.required_change_indices 和 variation_token。
修复必须产生与 previous_output 不同的相关字段；若原隐藏输入是公开输入的轻微改写，不得只调整顺序或包装层。
修复期间若输入含 revision_objections，不得撤销已经完成的外审修订，也不得把审核消息、定位信息或建议动作复制到公开产物。`
}
