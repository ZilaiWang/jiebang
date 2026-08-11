# 角色 A Week 1 验收报告：知识库与 RAG 检索层

## 1. 角色 A 负责范围

角色 A 在第一阶段负责搭建“领域知识库 + RAG 检索层”，为后续画像构建、路径规划、讲义生成、代码实验、分阶测试题提供可溯源知识依据。

## 2. 已交付文件

| 类型 | 路径 | 说明 |
|---|---|---|
| 知识库 Markdown | `knowledge_base/python_basic/*.md` | 18 个 Python 基础知识点 |
| 知识库索引 | `knowledge_base/python_basic/index.json` | 面向非 TypeScript 消费方的知识目录 |
| 运行时知识库 | `src/knowledge/python-basic.ts` | TypeScript 运行时知识注册表 |
| 知识库类型 | `src/knowledge/types.ts` | facts、examples、quizItems 等结构 |
| RAG 检索器 | `src/rag/retriever.ts` | `retrieveKnowledge()` 检索入口 |
| 输出 Schema | `schemas/rag_result.schema.json` | RAG 结果结构约束 |
| API 文档 | `docs/rag_api.md` | B/C/D 联调用法说明 |
| Demo 输入 | `examples/rag_demo_input.json` | 标准检索输入 |
| 画像样例 | `examples/learner_beginner.json`、`examples/learner_loop_weak.json`、`examples/learner_project_goal.json` | B/C/D 联调标准输入 |
| Demo 脚本 | `scripts/rag-demo.ts` | 一键展示 RAG Top-K 输出 |

## 3. 如何运行 Demo

```bash
npm exec -- bun scripts/rag-demo.ts
```

预期输出包含：

```text
Query: 初学者，不会循环，需要完成成绩统计程序
Top 3:
1. K007 for 循环
2. K018 成绩统计器综合项目
3. K009 列表
```

## 4. 如何验证

当前环境中直接 `bun` 不在 PATH，推荐验证命令是：

```bash
npm exec -- bun run check
```

该命令会执行：

```bash
tsc --noEmit
bun test ./tests
```

## 5. 验收标准对应关系

| Week 1 要求 | 当前证据 |
|---|---|
| 1 个垂直知识库切片 | `knowledge_base/python_basic/` |
| 15-20 个知识点 | 当前 18 个知识点 |
| 可检索 | `retrieveKnowledge()` |
| 可溯源 | `sourceId/source_id` + `factId/fact_id` |
| 支持讲义/实验/测试题生成 | `examples`、`practiceTasks`、`quizItems` |
| 支持联调 | 3 个 learner profile 样例 + `rag-demo.ts` |
| 可验证 | `npm exec -- bun run check` |

## 6. 和 B/C/D 的对接方式

- B 角色可使用 learner profile 样例测试画像输出格式。
- C 角色应把 `rag_result.results[*].facts/examples/practiceTasks/quizItems` 作为生成依据。
- D 角色可读取 `retrieval_trace` 展示推荐原因。

## 7. 当前限制

1. 检索仍是轻量规则检索，不是 embedding 语义检索。
2. 第一阶段以 `src/knowledge/python-basic.ts` 为运行时真源，Markdown 与 `index.json` 是交付/展示源。
3. OpenCode 主编排尚未自动调用 `retrieveKnowledge()`，仍需下一步和 orchestrator/path-planner 联调。
4. 当前知识范围只覆盖 Python 基础，不覆盖机器学习或深度学习。

## 8. 第一阶段结论

角色 A 的第一阶段交付已经具备：知识库、RAG 检索、溯源字段、联调样例、验收命令和演示脚本。下一步应进入 B/C/D 联调，而不是继续扩展知识库范围。
