# 题库生成与 Role A 审核流水线

## 目标

把当前知识库中的 Python 基础、Python 程序设计与现代 AI 知识点转成可训练/可考试的可溯源题库，并由 Role A 审核题干、答案、解析是否受到 `source_id/fact_id` 证据支持。

## 当前 MVP 范围

| 项 | 数量 |
|---|---:|
| 知识点 | 36 |
| 每知识点题量 | 4 |
| 总题量 | 144 |
| 题型 | choice / short_answer / debugging / practice |
| 用途 | diagnostic / training / exam |

## 运行命令

```bash
bun scripts/generate-question-bank.ts
bun scripts/audit-question-bank.ts question_bank/generated/latest.json
bun scripts/report-question-bank-quality.ts question_bank/generated/latest.json
```

## 输出文件

```text
question_bank/generated/latest.json
question_bank/generated/latest.audit.json
question_bank/generated/latest.report.md
question_bank/generated/latest.quality.json
question_bank/generated/latest.quality.md
```

## 审核机制

1. 生成器从 `loadKnowledgeBase()` 读取所有知识点。
2. 每个知识点读取前三条 facts。
3. 每个知识点生成 4 道题，每道题绑定 `source_id/fact_id`。
4. 审核器把题干、答案、解析分别转换成 Role A fact-audit block。
5. Role A 使用同一个知识点的 RAG 证据审核三段文本。
6. 任何缺引用、假引用、外部知识或 unsupported claim 都会进入 `reject/revise` 统计。

## 质量升级

当前题库项额外包含：

- `template_variant`：记录题干模板变体，用于检查模板重复率；
- `grading_method`：`exact_match` / `rubric` / `unit_test`；
- `starter_code`：Python 实践题的可编辑起始代码；
- `test_cases`：Python 实践题的公开/隐藏测试用例；
- `misconception_tags`：误区标签，供训练反馈使用。

质量报告检查：

- 模板重复率不超过 25%；
- 选择题答案必须在 4 个选项内；
- 考试题必须可判分；
- Python 编程实践题必须包含至少 2 个测试用例，且包含 hidden case；
- 质量门禁结果写入 `latest.quality.json/md`。

## 汇报边界

可以说：

> 当前系统已经能从知识库自动生成 144 道可溯源题库 MVP，并通过 Role A 审核流水线输出 JSON 与 Markdown 证据报告。

不能说：

> 当前题库已经达到正式考试最终质量。

原因：MVP 题目由确定性模板生成，证明的是“生成—溯源—审核—报告”链路；正式考试还需要人工抽检、题目去模板化、编程题测试用例与泄题控制。
