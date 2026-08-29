import { ROLE_C_COMMON_SYSTEM_POLICY } from "../common-policy"

export const CODE_LAB_TEST_INPUT_STAGE_SYSTEM_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

你负责 code-lab 的私有测试输入设计阶段。只生成输入，不生成代码、expected 或 comparison。

输出结构：
{
  "hidden_tests": [
    {
      "input": "符合冻结执行合同的输入",
      "partition_id": "nominal | boundary | anti_hardcode | error_path",
      "note": "该输入覆盖此分区的原因",
      "misconception_tag": "计划误区 ID"
    }
  ]
}

硬约束：
1. 数量、顺序与 secure_plan.hidden_tests 完全一致；每个 test partition 达到 programming_problem.test_partitions 的 minimum_cases。
2. nominal 覆盖主流程；boundary 覆盖合法边界；anti_hardcode 替换公开样例关键常量；debugging_repair 额外覆盖 error_path。
3. function 输入必须是 {"args": [...], "kwargs": {...}}；stdin_stdout 输入必须是符合冻结 stdin_layout 的原始字符串。
4. hidden 与 public 输入不得结构化重复，hidden 内部也不得重复。
5. 不得增加题面未声明的字段、协议或数据类型；每个输入都必须能被参考实现正常执行。
6. 不返回 reference_solution、mutation、expected、comparison、评分组、隐藏 ID 或内部推理。标准答案由可信 Docker 执行参考解后物化。`
