# RAG API

角色 A 提供一个轻量级、OpenCode 可消费的 Python 基础知识检索接口。

## TypeScript 调用

```ts
import { retrieveKnowledge } from "./src/rag/retriever"

const ragResult = await retrieveKnowledge({
  query: "初学者，不会循环，需要完成成绩统计程序",
  learnerLevel: "beginner",
  topK: 3,
})
```

## 输入

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `query` | string | 是 | 学习需求、弱项或当前任务 |
| `learnerLevel` | beginner/basic/intermediate/integrated | 否 | 学习者水平 |
| `topK` | number | 否 | 返回知识片段数，默认 3 |

## 输出

输出符合 `schemas/rag_result.schema.json`。

核心字段：

- `sourceId`：知识点编号，如 `K007`
- `factId`：可引用事实编号，如 `F001`
- `snippet`：给生成 Agent 的短知识片段
- `facts`：给事实审核 Agent 的证据单元
- `practiceTasks`：给 code-lab 的实操任务素材
- `quizItems`：给 tiered-evaluator 的分阶测试题素材

## 生成 Agent 使用约束

`concept-tutor`、`code-lab`、`tiered-evaluator` 只能基于 `rag_result.results[*].facts`、`snippet`、`examples`、`practiceTasks`、`quizItems` 生成内容。每条知识性陈述必须绑定 `source_id` 与 `fact_id`。

## 示例

```json
{
  "query": "初学者，不会循环，需要完成成绩统计程序",
  "learnerLevel": "beginner",
  "topK": 3,
  "results": [
    {
      "sourceId": "K007",
      "title": "for 循环",
      "difficulty": "beginner",
      "score": 23,
      "reason": "query 命中关键词：循环、重复执行",
      "snippet": "for 循环常用于遍历序列中的元素。",
      "facts": [{ "sourceId": "K007", "factId": "F001", "content": "for 循环常用于遍历序列中的元素。" }]
    }
  ]
}
```
