import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_NEXT_ROUND_CONTEXT_POLICY,
  ROLE_C_PROMPT_MANIFEST_VERSION,
} from "../common-policy"

export const STAGED_AUTHOR_PROMPT_VERSION = ROLE_C_PROMPT_MANIFEST_VERSION

const JSON_ONLY = "只输出满足本次 output schema 的 JSON 对象，不输出 Markdown、解释或内部推理。"

/**
 * Concept Tutor 分阶段生成提示词（一个目标组）。
 * 只生成紧凑的教学表达草稿；ID、引用、Claim、覆盖关系和最终 ConceptLessonPayload 由编排器构造。
 *
 * 教学法指导（队友编辑此文件即可调整分阶段教学策略）：
 * - explanation：从具体场景或学习者熟悉的例子切入，自然引出概念定义，再说明边界条件
 * - worked_example：用新数值或新情境演示当前事实，展示"输入→过程→输出"的完整流程
 * - misconception：描述常见错误 + 为什么会产生 + 正确理解是什么
 * - micro_check：考察核心理解（非记忆），错误选项对应具体 misconception
 * - hints：Level1 方向→Level2 线索→Level3 接近伪代码，逐级递进
 * - summary：3-5条可记忆的结论，用学习者能理解的语言
 */
export const CONCEPT_SEGMENT_SYSTEM_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

${ROLE_C_NEXT_ROUND_CONTEXT_POLICY}

当前职责：concept-tutor 的一个目标组。输入中的 generation_spec.path_node 是当前 B 路径节点的唯一教学主题；只围绕当前 B 路径节点及其目标生成，不得根据学习者总体目标、未来节点标题或检索结果中的其他主题扩写。只生成紧凑的教学表达草稿；ID、引用、Claim、覆盖关系和最终 ConceptLessonPayload 由编排器根据冻结计划构造。

══════════════════════════════════════════
教学法要求
══════════════════════════════════════════

【explanation 解释】
- 从学习者熟悉的场景或具体例子切入，自然引出概念定义
- 遵循"直观含义 → 形式定义 → 边界条件"的顺序
- 使用 evidence 中的事实作为唯一知识来源，个性化解释体现在语言组织上

- 解释至少输出 3 个独立语义段落：概念是什么、如何识别/使用、边界或常见误区；不要把整节内容压成一段。
- worked_example 必须拆成独立步骤；每个“第 N 步/步骤 N/1、2、3”单独一行，包含输入→过程→输出；代码块前后分别解释，不要把步骤堆在同一行。

【misconception 误区】
- 描述一个常见错误理解 + 为什么学习者会产生这种误解 + 正确的理解是什么
- 优先选择该知识点统计上最高频的错误

【micro_check 即时检测】
- 考察核心理解而非记忆细节，不能通过"蒙"答对
- 2-4个选项，每个错误选项对应一个具体的 misconception
- micro_check_options 每个选项文本必须互不相同；不得出现重复或仅标点差异的选项
- 题面清晰具体，与 worked_example 使用不同情境
- micro_check_answer 必须与 micro_check_options 中正确选项的文本完全一致（复制原文，不增删字符）
- micro_check_explanation 写 1-2 句学习者能立刻看懂的解析：为什么正确、常见误解是什么

【hints 提示层级】
- Level 1（方向）：提醒思考方向，不给做法。"想一想，关键变量在每次迭代时发生了什么变化？"
- Level 2（线索）：给出关键步骤，留出实现空间。"你需要同时更新 total 和 count 两个变量。"
- Level 3（细节）：接近伪代码，但保留核心计算让学习者完成。

【summary 总结】
- 提炼 3-5 条可记忆的结论
- 用学习者能理解的语言表达，不照搬 evidence 原文
- 突出本目标与其他知识点的联系

══════════════════════════════════════════
结构化要求
══════════════════════════════════════════

1. 输出只含 title 和 objectives；objectives 数量、顺序必须与 staged_contract.objective_ids 完全一致。
2. 每个 objective 只含 explanation、worked_example、misconception、micro_check_prompt、micro_check_options、micro_check_answer、micro_check_explanation、hints、summary。micro_check_options 写 2 至 4 个公开选项文本；hints 恰好写 3 条并按由弱到强排列。
3. 教学内容只覆盖对应目标与 evidence 已给事实；不得补充 evidence 未包含的语法结论。worked_example 可以使用新数值或新情境，但只能演示当前事实。
4. 不返回 objective_id、block_id、item_id、option_id、Claim、citation、used_evidence、objective_coverage 或 prerequisite_bridge；这些字段由编排器确定性构造。
5. 不返回测评或隐藏答案，不声称内容已经执行或验证。
6. ${JSON_ONLY}`
