import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_NEXT_ROUND_CONTEXT_POLICY,
} from "../common-policy"

const JSON_ONLY = "只输出满足本次 output schema 的 JSON 对象，不输出 Markdown、解释或内部推理。"

/**
 * Code Lab 公开创作阶段提示词。
 * 只生成 public author payload（任务说明、starter、公开测试、提示、反思题）。
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
- 解释"这个步骤为什么需要"和"它和整体任务的关系"，不只是复述 evidence 事实
- 用学习者能理解的语言描述，避免过度技术化的术语堆砌
- 每条 instruction 聚焦一个目标，保持简洁

【starter_code 起始代码】
- 提供函数签名和必要导入，用 TODO 注释标出需要完成的部分
- 核心逻辑必须留空（函数体写 pass 或 raise NotImplementedError("TODO")），不得包含任何实际计算或返回逻辑
- 绝对不可：写 return 语句返回计算结果、写完整的循环体或条件判断、写任何可能通过测试的代码
- 宁可太简单被安全门禁退回，也不可写出接近答案的代码

【public_test 公开测试】
- 第一个测试覆盖最基本情况，让学习者快速获得正向反馈
- 后续测试覆盖典型场景和边界情况
- description 描述可观察行为，expected_behavior 描述正确运行时的预期

【hints 提示层级】
- Level 1（方向）：指出思考方向，不涉及具体做法
- Level 2（结构）：给出算法结构或关键步骤
- Level 3（细节）：接近伪代码，保留核心实现让学习者完成

【reflection_question 反思题】
- 促使学习者思考：① 为什么这个设计正确 ② 有哪些边界情况 ③ 如何改进或泛化

══════════════════════════════════════════
结构化要求
══════════════════════════════════════════

1. 输出只含 title、execution_contract、starter_code、objectives。objectives 数量、顺序必须与 staged_contract.objective_plan 一致；每项只含 instruction_text、public_test、hints、reflection_question。
2. function 模式下每个 public_test.input 必须统一写成 {"args": [...], "kwargs": {...}}；即使只有一个参数也放入 args，不能用参数名直接组成普通对象。
3. function 模式只会校验入口函数的返回值，必须返回可 JSON 序列化的结果；以 print/标准输出为结果的任务必须选用 stdin_stdout 模式。
4. 不得出现参考解、隐藏测试输入或期望值、评分组、mutation、答案或 test_suite_id。
5. 每个 objective 写一条 instruction、一个公开测试、恰好三级提示和一个反思问题；不得返回 lab_id、objective_id、block_id、test_id、citation、Claim、coverage 或 used_evidence。
6. 教学文字只使用 evidence 中的事实；编排器会把冻结事实作为 Claim 附加到 instruction。
7. starter 不得直接完成任务，不得使用网络、宿主文件、shell、包安装或环境变量。
8. starter 不得动态访问双下划线属性，不得调用 eval/exec/compile/open/breakpoint/__import__/globals/locals/vars/getattr/setattr/delattr；普通类的 __init__ 定义可用；import 只能来自 execution_contract.allowed_imports。
9. execution_contract.allowed_imports 必须覆盖参考实现与隐藏测试会用到的平台白名单模块（如 json、math、collections、itertools、statistics、re 等）；只声明确实需要的模块，不得声明不允许的模块。secure 阶段不会也无法修改 allowed_imports，声明不足会导致私有参考实现被安全门禁退回。
10. evidence 涉及文件读写时，公开实验须明确采用安全等价环境：把文件文本作为函数参数，或使用 io.StringIO 这类内存文件对象；不得调用 open、访问宿主路径或声称已改写真实文件。
11. ${JSON_ONLY}`
