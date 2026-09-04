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
- debugging_repair：starter_code 必须包含真实存在、可由公开样例复现的缺陷；缺陷数量至少达到 programming_problem.required_mutation_count。先逐行核对 starter 里的实际错误，再写题面，绝不能声称一个代码中不存在的缺陷。题面要求学习者按“复现现象→定位原因→修复→回归验证”完成相互依赖的调试步骤，而不是重写成另一任务。
- debugging_repair 输出前执行机械自检：starter_code 中不得出现 TODO、pass、NotImplementedError、空函数或“缺陷/错误/修复/正确写法”注释；必须直接放入一份完整可运行、但会在公开样例上产生错误结果的实现。statement 只写正确目标、输入输出和可观察的错误现象，不编号列出缺陷，不解释错误源码表达式，也不写修复后的表达式。
- debugging_repair 描述缺陷时禁止写源码机制：不得写“某分支在另一分支之前/之后”“条件顺序颠倒”“索引从某值开始”“缺少某行/某操作”“把某变量加到了错误的计数器”等定位性描述；只能用“给定输入 X，观察到错误输出/状态 Y（而正确应为 Z）”的可观察现象形式。写完 starter_code 后必须逐条把 instruction、hints、troubleshooting 声称的现象代入 starter 在心里复现一遍，凡不能在 starter 上真实复现的现象必须删掉，或把 starter 改成能产生该现象、同时仍保留该 objective 目标逻辑的真实缺陷。绝不保留一个代码中不存在的缺陷描述。
- debugging_repair 必须让 objective_plan 中每个 objective 对应 starter 中一个不同且真实存在的故障，该故障必须直接练习该 objective 所引用的行为或边界事实，并至少有一个公开或错误路径案例可观察到。不得用“验证空输入”“回归检查”等没有实际故障的步骤凑 objective 数量；故障总数必须达到 required_mutation_count。
- 每处调试修复都应保留并正确使用该 objective 的目标操作；不得通过删除整段目标逻辑、绕开目标操作或改写成无关实现来“修复”。
- debugging_repair 的公开说明只能给诊断边界：可以指出观察哪个输出、追踪哪个状态或核对哪条当前事实；不得写出修复后的完整代码，不得用“把/将某行改为/替换为……”直接给出应提交的表达式、关键字或语句。practical_guide.steps 描述调试动作与验证方法，troubleshooting 描述学习者修复后仍可能观察到的症状，不得逐项公布 starter 中全部缺陷及精确修法。
- 题面可以采用在线评测题的清晰结构，但不得复刻或声称来自洛谷、蓝桥杯等第三方题目。

【practical_guide 实操指南】
- staged_contract.practical_guide_plan 是冻结结构：readiness_slots、step_slots、troubleshooting_slots 的数量和顺序必须逐项对应；不得新增、删除或合并槽位。
- 输出前分别核对数组长度：readiness_checks 必须等于 readiness_slots，steps 必须等于 step_slots，troubleshooting 必须等于 troubleshooting_slots；一个 slot 只对应一个条目。
- practice_goal 写当前真实任务的实践目标；deliverable 写学习者最终可提交、可运行、可验证的具体产物。
- readiness_checks 每项写“检查什么、何时算就绪”；steps 每项必须同时写 action、input、expected_result、verification，形成可执行闭环，不能只写概念说明。
- 程序填空题可以在指南中明确提到题面可见的 TODO 或待填写区域；这类文字是在说明学习者操作，不是未完成的占位正文。
- 指南最终会原样显示给学习者，只能使用“完整代码预览”“待填写位置”“公开样例”“预期输出”等界面用语。不得写 starter_code、expected_behavior、public_test、TODO_FILL_FACT 等内部字段或占位标记；指向已给代码时，变量名必须与本次实际 starter_code / gap_template 一致。学习者需要自行定义的中间变量要先说明“定义/保存为”，后续步骤使用同一名称，不得假称已在骨架中提供。
- troubleshooting 必须针对本任务可能出现的可观察症状，给出原因、恢复步骤和恢复后验证；不得写“检查代码”“按需调整”等泛化句。原因只能指向当前 cited_facts 直接陈述的内容：症状表述为“学习者输出/结果与某条 cited_fact 描述不符”，原因是“没有正确体现该 cited_fact”，恢复步骤是“对照该 cited_fact 核对并修正”。不得写 print 函数用法、语法错误触发条件、缩进对齐规则、循环体归属、异常类型等 cited_facts 未提供的语言机制或 API 知识；对 explain/recognize 且 facts 为介绍性陈述的目标，troubleshooting 的可写空间就是 cited_facts 本身，不得为凑“原因”而补充证据外机制。
- extension_task 必须改变输入规模、任务结构或约束中的一个维度，并给出验证方法；不得提前给出完整答案。若扩展任务要新增变量，必须明确写“新增/定义变量”，不得把新变量写成当前代码已存在的变量。
- 扩展任务仍使用当前任务已经引用的操作规则。输入值或数量变化不等于新增操作规则：新的参数语义、运算符、反向执行、异常路径需要各自的当前证据；没有相应事实时，通过组合已有操作或更换合法数据形成变式。不能仅引用一般定义来支持新的边界行为。
- extension_task、troubleshooting 和提示中的事实反例只能直接否定当前 cited fact，不得另造具体行业用途、API、语法或运行机制。程序填空的学习者区域称为“填写框”或“空位”，不得称为“空格”，避免与空格字符混淆。
- learner_action=recall_fact 时，填写目标始终是 cited fact 的完整句子，不是事实中的单个符号、关键词或对象名；三级提示必须围绕“识别完整事实→确认整句边界→核对完整填写”逐级展开，不得把局部关键词误写成最终提交内容。
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
- function 的 return_value 表示判题使用返回值，并不表示必须返回字典。按当前题目选用证据支持的数值、字符串、列表、布尔或字典结果，在 output_contract 中填写明确 kind/type；此具体类型随题面冻结，参考实现与全部测试保持一致。不得为符合接口而引入目标证据之外的数据结构。
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
- debugging_repair 是唯一例外：starter 必须是一份可运行、包含真实缺陷、会在至少一个公开样例上产生错误结果的完整实现；必须保留待定位的条件、循环、索引或其他目标逻辑，不能用 TODO、pass、NotImplementedError 或空函数替代故障。它不得已经满足全部公开测试，也不得在注释中写出修法。
- 非 debugging_repair 的 function 模式：提供与 entry_point 完全一致的函数签名和必要导入，用 TODO 注释标出需要完成的部分。
- 非 debugging_repair 的 stdin_stdout 模式：提供与 task_contract.input_form 一致的完整程序骨架和 TODO；input_form=stdin_lines 时读取 stdin 并写入 stdout，input_form=none 时不读取输入、只使用空 input 测试输出。不得设置 entry_point，也不得要求学习者只提交函数或把函数返回值作为评分结果。非 recall_fact 的完整程序内允许使用 def/return 定义辅助函数。
- 非 debugging_repair 的核心逻辑必须留空（function 模式函数体写 pass 或 raise NotImplementedError("TODO")；stdin_stdout 模式只保留安全的读取/输出骨架或 TODO），不得包含实际答案逻辑。
- 非 debugging_repair 绝对不可写 return 语句返回完整计算结果、完整循环体或条件判断，以及任何可能直接通过测试的代码。调试题则相反：错误实现必须完整可运行，但不能是正确答案。
- 普通实现题宁可留出清晰待完成区域，也不可写出接近答案的代码；调试题宁可减少场景装饰，也必须保证故障真实、可复现且未公布修复代码。
- learner_adaptation.level=beginner 时可保留完整外围骨架并逐步提示；level=basic 时只保留输入输出胶水、必要初始化和 TODO 边界，目标行为需要的两到三个相连操作必须由学习者完成，不得把核心循环、判断、调用或索引语句逐行写好。

【public_test 公开测试】
- 第一个测试覆盖最基本情况，让学习者快速获得正向反馈
- 后续测试覆盖典型场景和边界情况
- description 描述可观察行为，expected_behavior 描述正确运行时的预期
- function 模式的 input 使用调用封装，expected_behavior 描述函数返回值；stdin_stdout 模式的 input 是标准输入文本，expected_behavior 描述标准输出文本
- stdin_stdout 的公开测试按精确输出设计：除非提示文字本身就是学习目标，否则使用不带提示参数的 input()；starter、instruction 或题目要求产生的每一段输出都必须出现在 output_contract 与 expected_behavior 中，不能只描述其中一部分
- stdin_layout=single_line_text 时，public_test.input 必须是单行文本（末尾可带一个换行），所有案例使用同一字段顺序。
- 多目标实验仍然只是一个连贯任务：所有 objectives 共用同一个外部输入协议、输出协议和 starter，每个 public_test 只用不同数据检查该任务中的不同目标。不得把每个 objective 写成不同函数、不同输入形状或彼此无关的小题
- 所有公开样例的 input 必须两两不同（含每个 objective 的 public_test.input 与 additional_public_examples 的 input）。fault_localization 尤其要避免用同一个输入重复展示：每个公开样例用不同输入复现不同目标对应的可观察现象；多个目标确实共用同一组输入时，只保留一个 objective 的 public_test，其余目标改用能各自复现其缺陷的输入，或合并为一个 additional_public_example 并保证其余 input 互不相同。
- stdin_stdout 多目标时，各测试的输入行数、字段含义和输出形式必须一致；不得通过“输入一行做判断、两行做加法、三行做平均值”这类分支把多道题塞进一个程序

【hints 提示层级】
- Level 1（方向）：指出思考方向，不涉及具体做法
- Level 2（结构）：只依据当前 facts 指出要选择或填写的目标语义
- Level 3（细节）：说明如何在 starter 已给骨架内应用当前事实；不得教授 evidence 未包含的函数、运算符、语法或运行机制
- 三级提示必须逐条结合当前 objective 的事实内容、概念名、变量变化或输入输出关系即时创作；至少两级要明确点出本实验特有的概念或操作。不得复用“定位核心事实 / 保留主语对象关系 / 只替换 TODO”之类可套在任何实验上的固定模板，也不得让不同 objective 使用相同提示。
- Level 1、2、3 不能只是同一句话换标点或近义改写；信息应逐级增加。Level 3 可以给出针对本题的伪代码、状态变化或定位位置，但除题面已经公开目标文本的 recall_fact 外，不得直接给出可提交的完整答案。
- learner_adaptation.level=basic 时，三级提示可以指出已引用的事实或操作顺序，但不得给出可以逐字复制成完整答案的连续代码语句；学习者仍需自己把两到三个步骤连接起来。

【reflection_question 反思题】
- 只围绕当前 facts 与本实验已明示的输入输出合同提问；不得预设 evidence 未说明的语言行为、边界或泛化规则
- 每个 objective 只写一个聚焦问题，不得用两个问号串联两个问题，也不得询问“这段操作与某条事实有什么关系”；这种关系本身若未被 facts 明说，就是新的无依据结论。
- 优先让学习者指出自己的实现对应了哪条当前事实，或如何用公开测试检查任务合同。不得询问未转换会发生什么、某种错误写法为何报错、未给代码会走哪个分支等证据外假设。
- debug 任务的反思题只围绕诊断当前 starter_code 中已展示的错误。不得让学习者预测“修复后”“修复版本”“修正后”代码会输出什么、走哪个分支、生成哪些值——修复版本代码没有给出，学习者无法凭证据回答，也禁止断言“端点遗漏不会引发异常”“只会导致数量不足”等 cited_facts 未提供的因果或异常行为结论。需要讨论修复行为时，必须先给出具体修复代码再提问，否则只问当前 starter 的错误定位与可观察现象。

══════════════════════════════════════════
结构化要求
══════════════════════════════════════════

1. 输出只含 title、execution_contract、starter_code、objectives、practical_guide、programming_task。objectives 数量、顺序必须与 staged_contract.objective_plan 一致；每项只含 instruction_text、public_test、hints、reflection_question。programming_task 只含 statement、input_description、output_description、constraints、必要时的 additional_public_examples，以及 code_completion 必需的 gap_template；其他题型不得返回 gap_template。
2. function 模式下每个 public_test.input（包括 additional_public_examples）必须统一写成 {"args": [...], "kwargs": {...}}，并逐个严格匹配 starter_code 的入口函数签名：不得遗漏必填参数、不得增加多余位置参数；即使只有一个参数也放入 args，不能用参数名直接组成普通对象。若 solve 只有一个列表参数，多组数据必须作为 args[0] 的一个列表传入，不能拆成多个位置参数。
3. execution_mode 已经冻结（见 staged_contract.execution_mode），你只需严格遵守，不得混用另一模式的措辞、输入封装或 starter 结构：
   - function：instruction、starter、公开测试都围绕 entry_point；不得把 print/标准输出当评分结果；每个 public_test.input 必须统一写成 {"args": [...], "kwargs": {...}}。
   - stdin_stdout：instruction、starter、公开测试都围绕完整程序的标准输入和标准输出；不得要求学习者提交入口函数或把入口函数的返回值作为评分结果。
4. 不得出现参考解、隐藏测试输入或期望值、评分组、mutation、答案或 test_suite_id。
5. 每个 objective 写一条 instruction、一个公开测试、恰好三级提示和一个反思问题；不得返回 lab_id、objective_id、block_id、test_id、citation、Claim、coverage 或 used_evidence。
6. 教学文字只使用 evidence.facts；输入中不存在事实身份的示例和练习不会作为可发表知识提供。编排器会把冻结事实作为 Claim 附加到 instruction。
7. starter 不得直接完成任务，不得使用网络、宿主文件、shell、包安装或环境变量。
8. starter 不得动态访问双下划线属性，不得调用 eval/exec/compile/breakpoint/__import__/globals/locals/vars/getattr/setattr/delattr；普通类的 __init__ 定义可用；import 只能来自 execution_contract.allowed_imports。open 按公共文件沙箱策略使用，只能操作本次测试的相对文件名。
9. execution_contract.allowed_imports 只可从平台白名单 bisect、collections、datetime、decimal、enum、fractions、functools、heapq、itertools、io、json、math、operator、random、re、statistics、string 中选择，并须覆盖 starter、参考实现与隐藏测试实际使用的模块；基础任务优先使用内置语法并返回空数组。不得使用 sys、os、pathlib、subprocess 等平台外模块。secure 阶段不会也无法扩大 allowed_imports。
10. evidence 涉及文件读写时，使用公共策略规定的独立临时文件环境，明确初始 files 夹具或 stdin 建文件流程、文件名和观察结果；学习者须实际完成目标文件操作。若要求先读取已有文件，每个 objectives[].public_test.input 和 additional_public_examples[].input 都须写全 files 初始内容，例如 {"args":["data.txt","新内容"],"kwargs":{},"files":{"data.txt":"原有内容"}}。仅在题面说“平台会创建文件”而不给出 files，判题器不会自动猜测文件内容。
11. ${JSON_ONLY}`

/** Full-candidate revision after the independent critic found concrete defects. */
export const CODE_LAB_PUBLIC_REVIEW_REVISION_SYSTEM_PROMPT = `${CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT}

当前职责：根据 reviewer_findings 修订 prior_candidate，重新输出一份完整 public author payload。逐条解决 reviewer_findings，同时保持 staged_contract 的目标、执行接口、测试形状和编程题型不变。不得只改说明文字来掩盖代码问题。

若为 debugging_repair，必须完成以下一致性自检：
1. starter_code 中确实存在 programming_problem.required_mutation_count 个可复现缺陷；
2. 题面声称的每个缺陷都能在实际 starter 中找到，公开样例能观察到至少一个错误现象；
3. 正确实现应同时满足所有 objectives 的统一输入输出合同，不能让某个 public_test 只描述部分实际输出；
4. instruction、三级提示和 practical_guide 只教学习者如何复现、追踪、定位和验证，不直接给出修复后的关键代码；
5. contract.artifact_task.lab.learner_owned_dependent_steps 个核心调试动作仍由学习者完成。
6. 若 reviewer 指出“题面声称的缺陷在实际 starter 中不存在或与实际代码不符”，二选一修复：把该缺陷真实注入 starter 并同步修正题面现象，或把题面现象改为 starter 实际能复现的现象；禁止保留一个代码中不存在的缺陷描述。缺陷描述仍只能用“给定输入 X → 错误输出/状态 Y”的可观察现象，不得写源码机制。
7. 若 reviewer 指出 troubleshooting（或任何指南/说明）包含 cited_facts 未提供的语言机制断言（print 用法、语法错误触发条件、缩进对齐规则、循环体归属、异常类型等），必须删除该机制并改为锚定 cited_facts：症状写“学习者输出/结果与某条 cited_fact 描述不符”，原因写“没有正确体现该 cited_fact”，恢复写“对照该 cited_fact 核对并修正”。不得为保留 troubleshooting 的“原因”而继续编造证据外机制；若 cited_facts 不足以支撑“原因”，只保留可观察症状与对照核对动作即可。
8. 若 reviewer 指出 execution_contradiction（声称的缺陷现象与 starter 实际行为矛盾）或 instructional_contract_mismatch（starter 已正确、无可定位缺陷），说明 starter 没有真正注入缺陷，只声称了缺陷。必须先改 starter：把对应的正确分支/循环/索引改成会真实产生该现象的错误实现——例如声称“某日志出现两次”就必须把 elif 改成 if（违反 if/elif/else 互斥语义）使该分支可能重复触发，声称“多返回了日志/少返回了日志”就必须真的写错循环边界或分支条件。再把题面现象、practical_guide 的 expected_result 与改后的 starter 逐条对齐，保证每个声称的现象都能在改后的 starter 上真实复现。绝不允许保留正确代码却声称它出错。

只输出修订后的完整 Schema JSON。`
