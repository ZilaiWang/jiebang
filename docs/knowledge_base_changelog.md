# 知识库更新日志

## 2026-07-31 — v0.2.0 知识库质量增强

- 修复 10 个知识点（K004/K005/K008/K010/K011/K012/K014/K015/K016/K017）的占位示例，替换为真实教学代码（input/运算符/while/字典/集合/字符串/函数/文件/异常/模块导入）
- 每个知识点的"常见错误"从模板粘贴改为针对该知识点的真实易错点
- 分阶测试题 Level 1 从开放式 short 改为带选项的 choice，Level 2 改为可判分的具体任务
- 同步更新 `src/knowledge/python-basic.ts`（运行时真源）、`knowledge_base/python_basic/*.md`（展示源）和 `index.json`（版本 0.1.0 → 0.2.0）
- RAG 同义词表从 4 组扩展至 13 组（新增：条件判断、变量、输入、输出、字典、字符串、异常、文件、模块等）
- 外部知识检测列表从 5 个词扩展至 30+（覆盖深度学习、数据库、Web、并发、测试、工具链等领域术语）
- 新增 Week3 离线评测框架：`src/evaluation/week3-evaluation.ts` 与 `scripts/week3-evaluation.ts`，生成 60 组用例并输出幻觉率、难度适配准确率、核心知识点覆盖率三项指标

## 2026-07-18 — 小组联调增强包 v1

- GitHub 仓库已同步到：`https://github.com/jiangdongouyang-lab/knowbalance.git`
- 当前基准提交：`1d9cabb feat: add role A python knowledge base and RAG retriever`
- 新增 B/C/D 联调说明：`docs/team_integration_guide.md`
- 新增 B 调 A 的输入协议：`schemas/rag_request.schema.json`
- 新增 C/D 消费样例：`examples/rag_result_example.json`
- 历史端到端联调脚本已下线；当前通过主 Agent持续会话 API 与 `src/role-d-ui-v2` 联调

B/C/D 更新方式：

```bash
git pull origin main
bun install
bun run check
bun run role-d:v2:verify
```

## 当前知识库范围

- Python 基础 18 个知识点：K001-K018
- 支持 `source_id/fact_id` 溯源
- 支持 `retrieval_trace` 展示推荐原因
- 支持 beginner 口语同义词扩展，例如“一遍遍处理很多数据”可命中循环/列表

## 后续更新规范

A 每次修改知识库后，应记录：

```text
日期
修改了哪些 Kxxx
是否影响 B/C/D 输入输出协议
BCD 是否需要重新 pull
验证命令结果
```
