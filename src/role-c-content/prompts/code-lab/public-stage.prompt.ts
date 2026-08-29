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

先读取 learning_design 与 task_contract：把 adaptation_decisions 落到任务粒度、starter 留白和提示渐退上。若 learning_design.pedagogy_contract 存在，practice.shape 决定练习形态，guided_to_independent_sequence 决定从示范到独立完成的渐退顺序，hint_levels 决定提示层数，require_acceptance_criteria / require_expected_output / require_troubleshooting 必须落实为可见任务说明。candidate_context 只改变任务组织与练习路径，不得改变执行接口或评分语义。

质量对照：好实验让学习者承担目标行为，旁支输入/输出胶水由平台提供，并用公开自查暴露典型误区；坏实验把完整答案写进 starter、只让学习者抄写常量，或用无关复杂场景掩盖目标。

当前职责：code-lab 的公开创作阶段，只生成紧凑的 public author payload。实验 ID、目标 ID、引用、Claim、覆盖关系与 used_evidence 由编排器根据冻结计划构造。

【programming_problem 编程题蓝图】
- staged_contract.programming_problem 冻结题型、提交方式、难度、测试分区和学习者承担的行为。你只负责创作题面，不得更换 task_kind 或 submission_mode。
- 题目必须是本轮根据学习目标、学习者水平和当前进度新生成的任务；不得套用固定题干、固定数据或知识点专用硬编码模板。
- statement 要包含任务背景、明确目标与验收边界；input_description、output_description 必须逐字遵守冻结 execution_contract；constraints 至少给出两条可核验约束。若 objectives 提供的公开测试少于 programming_problem.public_case_count，additional_public_examples 必须补足数量，并使用相同输入形状但不同数据。
- code_completion：programming_task 必须提供 gap_template；模板只允许 {{gap:gap_id}} 标记，每个 gap 恰好出现一次。浏览器只提交 gap_answers，外围代码不可编辑。marker 是服务端内部结构，不得在 statement、instruction、hint 或 reflection 中对学习者展示或要求其理解。每个 gap 必须用 label 和 answer_format 明确说明填写的是字符串、表达式、语句还是变量名。
- function_implementation：学习者实现冻结 entry_point 的函数体；starter_code 保留签名并留出核心逻辑。
- stdin_stdout_program：学习者提交完整程序，题面按标准输入/输出描述，样例与所有目标共用同一输入形状。
- debugging_repair：starter_code 必须包含一个与当前误区相符、可由公开样例复现的缺陷；题面要求定位并修复，而不是重写成另一任务。
- 题面可以采用在线评测题的清晰结构，但不得复刻或声称来自洛谷、蓝桥杯等第三方题目。

【practical_guide 实操指南】
- staged_contract.practical_guide_plan 是冻结结构：readiness_slots、step_slots、troubleshooting_slots 的数量和顺序必须逐项对应；不得新增、删除或合并槽位。
- practice_goal 写当前真实任务的实践目标；deliverable 写学习者最终可提交、可运行、可验证的具体产物。
- readiness_checks 每项写“检查什么、何时算就绪”；steps 每项必须同时写 action、input、expected_result、verification，形成可执行闭环，不能只写概念说明。
- troubleshooting 必须针对本任务可能出现的可观察症状，给出原因、恢复步骤和恢复后验证；不得写“检查代码”“按需调整”等泛化句。
- extension_task 必须改变输入规模、任务结构或约束中的一个维度，并给出验证方法；不得提前给出完整答案。
- 验收条件由编排器根据 public_tests 确定性生成，模型不得另造测试 ID 或期望值。
- 指南正文只可使用 evidence.facts、冻结 execution contract 和 public tests 中已公开的信息；不得引入未给出的 Python 规则、隐藏测试或参考实现。

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
- 冻结为 stdin_stdout：不设置 entry_point；input_form=stdin_lines 时从标准输入读取，input_form=none 时不读取输入；两者都向标准输出写出结果，input_contract/output_contract 与之一致
- 冻结为 function：设置与 starter 函数签名一致的 entry_point；任务描述为实现并返回结果，不把 print 或标准输出作为答案；input_contract/output_contract 描述参数类型与返回值类型
- execution_contract 里的 execution_mode 直接抄写 staged_contract.execution_mode，不要写成另一个值

【task_contract 完整任务契约（存在时强制遵循）】
- staged_contract.task_contract 给出本实验的完整判题契约：program_entry（程序入口）、input_form（输入形式）、stdin_layout（stdin 确切布局）、output_form（输出形式）、grading_invocation（判题调用方式）、output_constraint（输出约束）。
- 你创作的 instruction、starter_code、public_test、execution_contract 必须与这些字段一致：
  - learner_action=recall_fact / learner_owned_region=fact_literal 时，这是“第一次填写并运行”的引导式练习，不是猜答案。statement 必须直接写明目标输出句子、只填写等号右边且需要带英文引号；唯一 gap 使用 answer_format=python_string_literal。学习者只替换由当前 cited fact 直接给出的短句；input_form=none，public_test.input 为空字符串。starter_code 必须已给出赋值和 print 胶水，用 TODO 标出唯一事实文本待填区；不得读取 input，不得要求学习者编写 if/elif、循环、函数或其他旁支逻辑。instruction、hints 和反思题不得要求学习者推断证据没有说明的参数、冒号、缩进、API、错误结果或运行机制。
  - learner_action=implement_program 时，学习者补完整程序的核心处理逻辑；learner_action=implement_function 时，学习者补入口函数体并返回结果。
  - input_form=stdin_lines 时，题目的外部输入是标准输入文本，不得把函数参数当作判题入口；output_form=stdout_lines 时，评分产物是标准输出文本，不得把函数返回值当作判题结果。完整程序内可以定义辅助函数来组织逻辑。
  - stdin_layout=single_line_text 时，每个测试的全部输入都在一行，字段用空格分隔；starter、public_test.input、execution_contract.input_contract 必须使用这一布局，不得改成“首行 n，后续 n 行”。一次 input().strip().split() 应能读取全部 token。
  - input_form=function_arguments 时，判题器以参数调用入口函数；output_form=return_value 时，评分产物是函数返回值，不得把 print 输出作为评分结果。
- 若 staged_contract 没有 task_contract（旧路径），按上方 execution_mode 规则执行。

【starter_code 起始代码】
- function 模式：提供与 entry_point 完全一致的函数签名和必要导入，用 TODO 注释标出需要完成的部分
- stdin_stdout 模式：提供与 task_contract.input_form 一致的完整程序骨架和 TODO；input_form=stdin_lines 时读取 stdin 并写入 stdout，input_form=none 时不读取输入、只使用空 input 测试输出。不得设置 entry_point，也不得要求学习者只提交函数或把函数返回值作为评分结果。非 recall_fact 的完整程序内允许使用 def/return 定义辅助函数。
- 核心逻辑必须留空（function 模式函数体写 pass 或 raise NotImplementedError("TODO")；stdin_stdout 模式只保留安全的读取/输出骨架或 TODO），不得包含实际答案逻辑
- 绝对不可：写 return 语句返回计算结果、写完整的循环体或条件判断、写任何可能通过测试的代码
- 宁可太简单被安全门禁退回，也不可写出接近答案的代码
- learner_adaptation.level=beginner 时可保留完整外围骨架并逐步提示；level=basic 时只保留输入输出胶水、必要初始化和 TODO 边界，目标行为需要的两到三个相连操作必须由学习者完成，不得把核心循环、判断、调用或索引语句逐行写好。

【public_test 公开测试】
- 第一个测试覆盖最基本情况，让学习者快速获得正向反馈
- 后续测试覆盖典型场景和边界情况
- description 描述可观察行为，expected_behavior 描述正确运行时的预期
- function 模式的 input 使用调用封装，expected_behavior 描述函数返回值；stdin_stdout 模式的 input 是标准输入文本，expected_behavior 描述标准输出文本
- stdin_stdout 的公开测试按精确输出设计：除非提示文字本身就是学习目标，否则使用不带提示参数的 input()；starter、instruction 或题目要求产生的每一段输出都必须出现在 output_contract 与 expected_behavior 中，不能只描述其中一部分
- stdin_layout=single_line_text 时，public_test.input 必须是单行文本（末尾可带一个换行），所有案例使用同一字段顺序。
- 多目标实验仍然只是一个连贯任务：所有 objectives 共用同一个外部输入协议、输出协议和 starter，每个 public_test 只用不同数据检查该任务中的不同目标。不得把每个 objective 写成不同函数、不同输入形状或彼此无关的小题
- stdin_stdout 多目标时，各测试的输入行数、字段含义和输出形式必须一致；不得通过“输入一行做判断、两行做加法、三行做平均值”这类分支把多道题塞进一个程序

【hints 提示层级】
- Level 1（方向）：指出思考方向，不涉及具体做法
- Level 2（结构）：只依据当前 facts 指出要选择或填写的目标语义
- Level 3（细节）：说明如何在 starter 已给骨架内应用当前事实；不得教授 evidence 未包含的函数、运算符、语法或运行机制
- learner_adaptation.level=basic 时，三级提示可以指出已引用的事实或操作顺序，但不得给出可以逐字复制成完整答案的连续代码语句；学习者仍需自己把两到三个步骤连接起来。

【reflection_question 反思题】
- 只围绕当前 facts 与本实验已明示的输入输出合同提问；不得预设 evidence 未说明的语言行为、边界或泛化规则
- 优先让学习者指出自己的实现对应了哪条当前事实，或如何用公开测试检查任务合同。不得询问未转换会发生什么、某种错误写法为何报错、未给代码会走哪个分支等证据外假设。

══════════════════════════════════════════
结构化要求
══════════════════════════════════════════

1. 输出只含 title、execution_contract、starter_code、objectives、practical_guide、programming_task。objectives 数量、顺序必须与 staged_contract.objective_plan 一致；每项只含 instruction_text、public_test、hints、reflection_question。programming_task 只含 statement、input_description、output_description、constraints、必要时的 additional_public_examples，以及 code_completion 必需的 gap_template；其他题型不得返回 gap_template。
2. function 模式下每个 public_test.input 必须统一写成 {"args": [...], "kwargs": {...}}；即使只有一个参数也放入 args，不能用参数名直接组成普通对象。
3. execution_mode 已经冻结（见 staged_contract.execution_mode），你只需严格遵守，不得混用另一模式的措辞、输入封装或 starter 结构：
   - function：instruction、starter、公开测试都围绕 entry_point；不得把 print/标准输出当评分结果；每个 public_test.input 必须统一写成 {"args": [...], "kwargs": {...}}。
   - stdin_stdout：instruction、starter、公开测试都围绕完整程序的标准输入和标准输出；不得要求学习者提交入口函数或把入口函数的返回值作为评分结果。
4. 不得出现参考解、隐藏测试输入或期望值、评分组、mutation、答案或 test_suite_id。
5. 每个 objective 写一条 instruction、一个公开测试、恰好三级提示和一个反思问题；不得返回 lab_id、objective_id、block_id、test_id、citation、Claim、coverage 或 used_evidence。
6. 教学文字只使用 evidence.facts；输入中不存在事实身份的示例和练习不会作为可发表知识提供。编排器会把冻结事实作为 Claim 附加到 instruction。
7. starter 不得直接完成任务，不得使用网络、宿主文件、shell、包安装或环境变量。
8. starter 不得动态访问双下划线属性，不得调用 eval/exec/compile/open/breakpoint/__import__/globals/locals/vars/getattr/setattr/delattr；普通类的 __init__ 定义可用；import 只能来自 execution_contract.allowed_imports。
9. execution_contract.allowed_imports 只可从平台白名单 bisect、collections、datetime、decimal、enum、fractions、functools、heapq、itertools、io、json、math、operator、random、re、statistics、string 中选择，并须覆盖 starter、参考实现与隐藏测试实际使用的模块；基础任务优先使用内置语法并返回空数组。不得使用 sys、os、pathlib、subprocess 等平台外模块。secure 阶段不会也无法扩大 allowed_imports。
10. evidence 涉及文件读写时，公开实验须明确采用安全等价环境：把文件文本作为函数参数，或使用 io.StringIO 这类内存文件对象；不得调用 open、访问宿主路径或声称已改写真实文件。
11. ${JSON_ONLY}`
