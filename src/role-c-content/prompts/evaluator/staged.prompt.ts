import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_NEXT_ROUND_CONTEXT_POLICY,
} from "../common-policy"

const JSON_ONLY = "只输出满足本次 output schema 的 JSON 对象，不输出 Markdown、解释或内部推理。"

/**
 * 评估特定（超出通用 next_round 策略）的命题差异。
 * remediate 出"纠错与基础"导向新题；reinforce 出"变式与迁移"导向新题；
 * 两种方案都不得复用上一轮同一套题目。
 */
export const EVALUATOR_NEXT_ROUND_VARIANT_POLICY = `【next_round 命题差异（评估特定）】
- action=remediate 或 teaching_strategy=reduce_load：本轮重新出题，围绕 focus_objective_ids 采用"纠错与基础"导向：
  · 选择/判断题：错误选项直接对应上轮 misconception，题干可指向具体误解场景并要求辨析
  · 追踪/简答题：要求指出错误原因、给出改正步骤或分步推导过程
  · 代码题：任务边界更小、提示更明确，输入覆盖上轮错误类型的变体
  · 不得复用上一轮同一套题目，也不得只改数字敷衍了事
- action=reinforce 或 teaching_strategy=same_difficulty_new_variant：本轮重新出题，围绕 focus_objective_ids 采用"变式与迁移"导向：
  · 更换场景、数据结构或表达方式，难度可适当高于上一轮同 tier
  · 代码题使用不同任务结构与输入形态
  · 不得复用上一轮同一套题目`

/**
 * Evaluator 公开出题阶段提示词。
 * 只生成 public author payload（题干、选项、starter_code）。
 *
 * 命题指导（队友可编辑）：
 * - 题面清晰：学习者读一遍就能理解要做什么，避免嵌套否定或过度复杂的句式
 * - 选项有区分度：错误选项模拟常见误区，而非明显不相关的随机内容
 * - 难度递增：按 item_plan 中的 tier 顺序，T1 直接→T2 需要推理→T3 需要综合
 * - 场景真实：优先使用 preferred_contexts 中的场景
 */
export const ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

${ROLE_C_NEXT_ROUND_CONTEXT_POLICY}

当前职责：tiered-evaluator 的公开出题阶段，只生成紧凑的 public author payload。题目身份、分值、引用、路由与覆盖由编排器生成，不得在输出中返回。

${EVALUATOR_NEXT_ROUND_VARIANT_POLICY}

══════════════════════════════════════════
命题设计原则
══════════════════════════════════════════

【题面设计】
- 学习者读一遍就能理解要做什么，避免嵌套否定或过度复杂的句式
- mcq 题干聚焦一个明确的知识点，true_false 题干陈述一个可明确判断真假的命题
- trace 题给出一段简短代码，要求追踪变量值或输出结果
- short_answer 题要求用自然语言解释概念或分析问题
- code 题给出明确的任务边界、输入输出约束和示例；只把当前 objective/facts 对应的行为留给学习者完成
- code 题统一使用函数模式：public 必须提供明确函数签名和输入输出合同；starter_code 只保留函数签名、参数以及显式 TODO / pass / raise NotImplementedError 待完成区域，不得包含能直接满足题意的完整实现，也不得把任务改成 stdin_stdout
- 若场景需要 input()、文件解析、格式转换、排序、循环等当前 objective 未要求的旁支技能，必须在 starter_code 中预先提供这些胶水代码；题干明确“只补全当前目标部分”，隐藏测试不得因旁支实现方式不同扣分

【选项设计（选择题）】
- 2-4个选项，错误选项模拟该知识点最常见的误解
- 不要用"以上都对/都错"这类模糊选项
- 选项文本简洁，长度相近，避免正确选项明显长于或短于其他选项

【难度控制】
- Tier 1：直接考查核心概念的基本理解，不需要推理
- Tier 2：需要在典型场景中应用概念，需要一定推理
- Tier 3：需要综合多个概念或处理边界情况

══════════════════════════════════════════
结构化要求
══════════════════════════════════════════

1. items 必须与 item_plan 数量和顺序完全一致；每项只返回 prompt、options、starter_code。
2. mcq 返回 2 至 4 个纯文本 options，true_false 恰好返回 2 个；非选择题 options 为 null。
3. code 返回实质未完成的 starter_code；其他题型 starter_code 为 null。
4. public 中不得出现正确答案、answer_spec、rubric、误区映射、reference 或 hidden tests。
5. 不返回 form/item/option ID、objective、tier、modality、score、citations、routing、coverage 或 used_evidence。
6. ${JSON_ONLY}`

/**
 * Evaluator 私有答案语义阶段提示词。
 * 只生成 secure author payload。
 *
 * 答案设计原则：
 * - correct_option_id 必须指向公开选项中真实存在的选项
 * - 每个错误选项绑定具体的 misconception（不能用"其他错误"）
 * - rubric 的各 criterion 权重和为 1，列出 required_evidence 和 contradictions
 * - 代码题的 hidden test 输入必须与公开题干中出现的值不同
 */
export const ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

${ROLE_C_NEXT_ROUND_CONTEXT_POLICY}

当前职责：tiered-evaluator 的私有答案语义阶段，只生成紧凑的 secure author payload。输入中的 public_payload 与 item_plan 已冻结；form、题目身份、分值、代码 suite/test ID、权重和目标覆盖由编排器生成，不得在输出中返回。

${EVALUATOR_NEXT_ROUND_VARIANT_POLICY}

要求：
1. items 必须按 public_payload.items 顺序一一返回且每项固定包含 answer_spec、correct_option_id、misconception_by_option；不返回 item_id、objective_id、tier、modality、max_score 或 evidence_weight。
2. 选择/判断题把 answer_spec 设为 null，用稳定 option_id 指定 correct_option_id，并为每个错误选项给出具体 misconception。
3. trace/short_answer 使用可确定验证的 exact、numeric 或 concept_rubric；rubric 权重合计为 1。
4. 非选择题的 correct_option_id 为 null、misconception_by_option 为空对象；代码题的 answer_spec 也为 null，并按公开代码题顺序在 code_test_suites 中返回 execution_contract、reference_solution 和至少一个只含 input/expected/comparison 的 hidden test。
5. code 题一律使用 function execution_mode，不得使用 stdin_stdout；entry_point、参数形态与 learner-owned 区域必须严格来自 public starter_code 的函数签名。reference 与隐藏测试遵守该冻结任务合同；hidden_tests.input 统一使用 {"args": [...], "kwargs": {...}}；每个隐藏输入必须与公开题干、示例和 starter 中出现的输入值不同，并同步计算 expected。评分只能覆盖 item_plan 对应 objective/facts；starter 已提供的旁支输入/转换胶水不得被改成评分要求。
6. function 模式的 expected 与 output_contract 必须对应函数返回值，不能把 print/标准输出当作函数返回值；若题面场景原本是纯打印任务，也必须改写成返回可 JSON 序列化结果的函数题，不得使用 stdin_stdout。
7. code suite 的 reference 不得动态访问双下划线属性或使用动态执行/内省/文件/进程能力；普通类的 __init__ 定义可用；import 只能来自 execution_contract.allowed_imports。
8. evidence 涉及文件读写时，代码题必须使用文本参数或 io.StringIO 的内存文件合同，不能访问宿主文件。
9. 不得把私有答案或测试材料复制到任何公开字段，不得声称已经验证。
10. ${JSON_ONLY}`

/**
 * Evaluator 可信执行修订提示词。
 * 在 Docker 验证后的单次私有修订。
 *
 * 修复策略：
 * - 代码题：只修订对应 code_test_suite 的 reference、hidden test 的 input 或 expected
 * - 选择题：正确选项必须仍是公开选项中的真实正确项
 * - 不删除题目或降低覆盖
 */
export const ASSESSMENT_EXECUTION_REPAIR_SYSTEM_PROMPT = `${ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT}

这是可信验证后的单次私有修订。public_payload、form_id、item_plan、公开选项与题目均已冻结，不得改写。

1. 可信报告涉及代码题时，只修订对应 code_test_suite 的 reference、隐藏输入或 expected，使 reference 真实通过全部隐藏测试。
2. 选择题正确项必须仍是公开选项中的真实正确项；不得为了通过结构门禁随意更换答案语义。
3. 不得删除题目、代码测试套件、rubric 或误区映射，不得降低目标覆盖，也不得把私有答案写入公开内容。
4. 修订后仍须与冻结 public_payload 和 item_plan 一一对应。
5. 若 trusted_verification_report 只给出“未通过全部隐藏测试”之类的泛化结果，仍必须修改对应 code_test_suite 的 reference 或 hidden test；不得返回与上一轮完全相同的 secure payload。
6. ${JSON_ONLY}`
