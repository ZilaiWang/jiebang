import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_NEXT_ROUND_CONTEXT_POLICY,
} from "../common-policy"

/**
 * Code Lab 私有可执行语义阶段提示词。
 * 只生成 secure author payload（参考实现、隐藏测试、mutation）。
 */
export const CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

${ROLE_C_NEXT_ROUND_CONTEXT_POLICY}

当前职责：code-lab 的私有可执行语义阶段，只生成紧凑的 secure author payload。

══════════════════════════════════════════
必须严格遵守的输出格式（精确到这个 JSON 结构）
══════════════════════════════════════════

你必须只输出以下结构的 JSON 对象，不输出 Markdown、解释或内部推理。

{
  "reference_solution": "def 入口函数名(参数):\\n    ...",
  "hidden_tests": [
    {
      "input": {"args": [参数值列表], "kwargs": {}},
      "expected": 与函数真实返回类型一致的具体值,
      "comparison": 根据 frozen execution_contract.output_contract 选择 numeric 或 exact,
      "misconception_tag": "具体错误标签"
    }
  ],
  "mutation_variants": []
}

字段约束（必须逐条满足）：
1. reference_solution：一个完整的、可直接执行的 Python 程序。**execution_mode 是 "function" 时**：写 def 开头的入口函数，return 实际计算结果，只保留入口函数和必要辅助函数；**execution_mode 是 "stdin_stdout" 时**：写完整的脚本——从 stdin 读取输入（input() 或 sys.stdin 按行读），处理后在顶层用 print 输出结果，不要定义只 return 不 print 的函数。不访问网络/文件/进程。
2. hidden_tests：数组，恰好与 objective_plan 中的目标数量相等（每个目标一个测试），按 objective_plan 顺序排列。
3. hidden_tests[].input：**function 模式**必须是 {"args": [参数值列表], "kwargs": {}} 格式；**stdin_stdout 模式**必须是程序从 stdin 读到的原始文本（如 "10\\n20\\n30\\n"，与 public_payload 的 stdin 输入格式一致）。不能用参数名直接组成对象，不能用 {scores: [10,20]} 这种写法。参数顺序与入口函数签名一致。使用与 public_payload.public_tests 中完全不同的新值。
4. hidden_tests[].expected：必须与 reference_solution 的真实输出一致。function 模式：数值返回具体数值，对象、数组、字符串或布尔值返回对应 JSON 值；stdin_stdout 模式：expected 是程序 print 到 stdout 的完整文本（含换行）。不能写描述性文字。
5. hidden_tests[].comparison：根据 frozen execution_contract.output_contract 选择。数值返回值使用 numeric，精确结构为 {"kind": "numeric", "abs_tolerance": 1e-9, "rel_tolerance": 1e-9}；对象、数组、字符串或布尔返回值使用 exact，精确结构为 {"kind": "exact"}。stdout text 必须返回字符串 expected；不得为 stdout text 返回对象。
6. hidden_tests[].misconception_tag：具体说明测试针对的常见错误（如"skips_last_element"、"ignores_boundary"、"integer_division"），不用模糊标签。
7. mutation_variants：始终返回空数组 []。

══════════════════════════════════════════
具体示例（假设入口函数是 average_score，任务是求平均值）
══════════════════════════════════════════

{
  "reference_solution": "def average_score(scores):\\n    total = 0\\n    count = 0\\n    for s in scores:\\n        total += s\\n        count += 1\\n    return total / count",
  "hidden_tests": [
    {
      "input": {"args": [[10, 20, 30]], "kwargs": {}},
      "expected": 20,
      "comparison": {"kind": "numeric", "abs_tolerance": 1e-9, "rel_tolerance": 1e-9},
      "misconception_tag": "incorrect_average_calculation"
    },
    {
      "input": {"args": [[100]], "kwargs": {}},
      "expected": 100,
      "comparison": {"kind": "numeric", "abs_tolerance": 1e-9, "rel_tolerance": 1e-9},
      "misconception_tag": "single_element_handling"
    },
    {
      "input": {"args": [[73.5, 86.5]], "kwargs": {}},
      "expected": 80,
      "comparison": {"kind": "numeric", "abs_tolerance": 1e-9, "rel_tolerance": 1e-9},
      "misconception_tag": "decimal_average_miscalculation"
    }
  ],
  "mutation_variants": []
}

══════════════════════════════════════════
测试设计原则
══════════════════════════════════════════

- 每个目标恰好一个隐藏测试，优先选择边界或反例
- hidden_tests[].input 必须与 public_payload.public_tests 中所有 input 做 JSON 深比较；只要完全相同就无效。不要复用示例中的任何具体数字、字符串、列表或对象。至少改变输入结构和一个标量，并确保新输入不出现在 public_payload 的任何 learner-visible 字段中。
- 常规用例 + 边界用例 + 防硬编码用例组合覆盖
- expected 必须与 reference_solution 的实际返回值及类型一致（自己验算一遍）

不返回 lab_id、test_suite_id、execution_contract、test_id、objective_id、weight、scoring_groups、misconception_map、must_fail_test_ids、objective_coverage。

reference 不得动态访问双下划线属性或使用 __name__ main guard；普通类的 __init__ 定义可用。不得使用动态执行、内省、文件或进程能力；import 只能来自 execution_contract.allowed_imports。不得声称代码已经运行或验证。

reference_solution 禁止调用：eval、exec、compile、open、breakpoint、__import__、globals、locals、vars、getattr、setattr、delattr、memoryview。如果任务看起来需要这些能力，请用纯 Python 等价实现（如 JSON 解析用 json 模块、文件内容作为函数参数传入），而不是调用它们。

stdin_stdout 模式从 stdin 读取输入时，禁止用 eval()/exec() 解析输入内容：stdin 输入是普通文本（每行一个值或空格分隔），用 input().split() / map(int, ...) 等纯解析方式处理；不要把输入当作 Python 表达式求值。`
