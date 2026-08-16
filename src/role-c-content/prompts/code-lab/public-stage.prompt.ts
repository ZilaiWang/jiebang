import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_NEXT_ROUND_CONTEXT_POLICY,
} from "../common-policy"

const JSON_ONLY = "只输出满足本次 output schema 的 JSON 对象，不输出 Markdown、解释或内部推理。"

/**
 * Code Lab 公开创作阶段提示词。
 * 只生成 public author payload（任务说明、starter、公开测试、提示、反思题）。
 *
 * 门禁定位：报错 STDIN_FUNCTION_CONTRACT_MISMATCH / FUNCTION_OUTPUT_CONTRACT_MISMATCH 时，
 * 先查下方「execution_contract 执行方式」段。execution_mode 由编排器确定性冻结，
 * 模型只抄写不更改（详见 providers/staged-generation.ts 的 codeLabExecutionContractIssues）。
 *
 * 教学设计指导（队友可编辑）：
 * - instruction：解释"这个步骤为什么需要"和"它和整体任务的关系"，不只是重复 evidence
 * - starter：保留函数签名和必要导入，核心逻辑用 TODO 留空，让学习者有明确起点
 * - public_test：第一个测试覆盖最基本情况（快速正反馈），后续覆盖典型场景
 * - hints：Level1方向→Level2结构→Level3细节，逐级递进
 * - reflection_question：促使思考设计正确性、边界情况和改进方向
 */
export const CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

${ROLE_C_NEXT_ROUND_CONTEXT_POLICY}

当前职责：code-lab 的公开创作阶段，只生成紧凑的 public author payload。实验 ID、目标 ID、引用、Claim、覆盖关系与 used_evidence 由编排器根据冻结计划构造。

══════════════════════════════════════════
教学设计要求
══════════════════════════════════════════

【instruction 任务说明】
- 说明学习者要完成的可观察行为，以及它如何直接练习当前 evidence 事实；任务要求可以定义输入和期望输出，但不得借机补充新的语言知识
- 用学习者能理解的语言描述，避免过度技术化的术语堆砌
- 每条 instruction 聚焦一个目标，保持简洁
- observable_behavior 为 recognize 或 explain 时，把非目标语法作为已给骨架，只让学习者补全能体现当前事实的最小部分；不得要求 type/print/循环/条件/容器等 evidence 未提供的旁支知识

【execution_contract 执行方式】
- execution_mode 已由编排器根据当前学习目标确定性冻结，取值就是 staged_contract.execution_mode；你**不得自行判断或更改模式**，只在这个已冻结的模式下创作其余字段（文字、starter、测试、input/output 合同描述）
- 冻结为 stdin_stdout：不设置 entry_point；任务描述为完整程序从标准输入读取并向标准输出写出结果；input_contract/output_contract 描述标准输入文本与标准输出文本
- 冻结为 function：设置与 starter 函数签名一致的 entry_point；任务描述为实现并返回结果，不把 print 或标准输出作为答案；input_contract/output_contract 描述参数类型与返回值类型
- execution_contract 里的 execution_mode 直接抄写 staged_contract.execution_mode，不要写成另一个值

【task_contract 完整任务契约（存在时强制遵循）】
- staged_contract.task_contract 给出本实验的完整判题契约：program_entry（程序入口）、input_form（输入形式）、output_form（输出形式）、grading_invocation（判题调用方式）、output_constraint（输出约束）。
- 你创作的 instruction、starter_code、public_test、execution_contract 必须与这些字段一致：
  - input_form=stdin_lines 时，题目的外部输入是标准输入文本，不得把函数参数当作判题入口；output_form=stdout_lines 时，评分产物是标准输出文本，不得把函数返回值当作判题结果。完整程序内可以定义辅助函数来组织逻辑。
  - input_form=function_arguments 时，判题器以参数调用入口函数；output_form=return_value 时，评分产物是函数返回值，不得把 print 输出作为评分结果。
- 若 staged_contract 没有 task_contract（旧路径），按上方 execution_mode 规则执行。

【starter_code 起始代码】
- function 模式：提供与 entry_point 完全一致的函数签名和必要导入，用 TODO 注释标出需要完成的部分
- stdin_stdout 模式：提供拥有标准输入和标准输出的完整程序骨架和 TODO；不得设置 entry_point，也不得要求学习者只提交函数或把函数返回值作为评分结果。完整程序内允许使用 def/return 定义辅助函数，但主程序仍必须读取 stdin 并写入 stdout。
- 核心逻辑必须留空（function 模式函数体写 pass 或 raise NotImplementedError("TODO")；stdin_stdout 模式只保留安全的读取/输出骨架或 TODO），不得包含实际答案逻辑
- 绝对不可：写 return 语句返回计算结果、写完整的循环体或条件判断、写任何可能通过测试的代码
- 宁可太简单被安全门禁退回，也不可写出接近答案的代码

【public_test 公开测试】
- 第一个测试覆盖最基本情况，让学习者快速获得正向反馈
- 后续测试覆盖典型场景和边界情况
- description 描述可观察行为，expected_behavior 描述正确运行时的预期
- function 模式的 input 使用调用封装，expected_behavior 描述函数返回值；stdin_stdout 模式的 input 是标准输入文本，expected_behavior 描述标准输出文本
- stdin_stdout 的公开测试按精确输出设计：除非提示文字本身就是学习目标，否则使用不带提示参数的 input()；starter、instruction 或题目要求产生的每一段输出都必须出现在 output_contract 与 expected_behavior 中，不能只描述其中一部分

【hints 提示层级】
- Level 1（方向）：指出思考方向，不涉及具体做法
- Level 2（结构）：只依据当前 facts 指出要选择或填写的目标语义
- Level 3（细节）：说明如何在 starter 已给骨架内应用当前事实；不得教授 evidence 未包含的函数、运算符、语法或运行机制

【reflection_question 反思题】
- 只围绕当前 facts 与本实验已明示的输入输出合同提问；不得预设 evidence 未说明的语言行为、边界或泛化规则

══════════════════════════════════════════
结构化要求
══════════════════════════════════════════

1. 输出只含 title、execution_contract、starter_code、objectives。objectives 数量、顺序必须与 staged_contract.objective_plan 一致；每项只含 instruction_text、public_test、hints、reflection_question。
2. function 模式下每个 public_test.input 必须统一写成 {"args": [...], "kwargs": {...}}；即使只有一个参数也放入 args，不能用参数名直接组成普通对象。
3. execution_mode 已经冻结（见 staged_contract.execution_mode），你只需严格遵守，不得混用另一模式的措辞、输入封装或 starter 结构：
   - function：instruction、starter、公开测试都围绕 entry_point；不得把 print/标准输出当评分结果；每个 public_test.input 必须统一写成 {"args": [...], "kwargs": {...}}。
   - stdin_stdout：instruction、starter、公开测试都围绕完整程序的标准输入和标准输出；不得要求学习者提交入口函数或把入口函数的返回值作为评分结果。
4. 不得出现参考解、隐藏测试输入或期望值、评分组、mutation、答案或 test_suite_id。
5. 每个 objective 写一条 instruction、一个公开测试、恰好三级提示和一个反思问题；不得返回 lab_id、objective_id、block_id、test_id、citation、Claim、coverage 或 used_evidence。
6. 教学文字只使用 evidence.facts；输入中不存在事实身份的示例和练习不会作为可发表知识提供。编排器会把冻结事实作为 Claim 附加到 instruction。
7. starter 不得直接完成任务，不得使用网络、宿主文件、shell、包安装或环境变量。
8. starter 不得动态访问双下划线属性，不得调用 eval/exec/compile/open/breakpoint/__import__/globals/locals/vars/getattr/setattr/delattr；普通类的 __init__ 定义可用；import 只能来自 execution_contract.allowed_imports。
9. execution_contract.allowed_imports 必须覆盖参考实现与隐藏测试会用到的平台白名单模块（如 json、math、collections、itertools、statistics、re 等）；只声明确实需要的模块，不得声明不允许的模块。secure 阶段不会也无法修改 allowed_imports，声明不足会导致私有参考实现被安全门禁退回。
10. evidence 涉及文件读写时，公开实验须明确采用安全等价环境：把文件文本作为函数参数，或使用 io.StringIO 这类内存文件对象；不得调用 open、访问宿主路径或声称已改写真实文件。
11. ${JSON_ONLY}`
