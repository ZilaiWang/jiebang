# KnowBalance 小组联调指南

## 1. 核心结论

A 角色的知识库已经放在 GitHub 仓库中：

```text
https://github.com/jiangdongouyang-lab/knowbalance.git
```

B/C/D 不需要访问 A 的电脑，也不应该直接读 `D:\MR_fan\...` 这类本地路径。正确方式是：

```text
BCD clone/pull GitHub 仓库 → 在自己电脑安装依赖 → 运行 RAG demo → 按统一协议联调
```

## 2. 下载与更新

第一次下载：

```bash
git clone https://github.com/jiangdongouyang-lab/knowbalance.git
cd knowbalance
npm install -g bun
bun install
bun run check
bun run role-d:v2:verify
```

已经下载过：

```bash
cd knowbalance
git pull origin main
bun install
bun run check
bun run role-d:v2:verify
```

## 3. 知识库结构

```text
knowbalance/
├── knowledge_base/python_basic/       # Markdown 知识库与 index.json
├── src/knowledge/                     # TypeScript 运行时知识库
├── src/rag/retriever.ts               # A RAG 检索入口 retrieveKnowledge()
├── schemas/rag_request.schema.json    # B 调 A 的输入协议
├── schemas/rag_result.schema.json     # A 给 C/D 的输出协议
├── examples/learner_*.json            # B/C/D 联调画像样例
├── examples/rag_result_example.json   # C/D 消费的 RAG 输出样例
├── scripts/learning-orchestrator-api.ts # 主 Agent 持续会话服务入口
└── docs/knowledge_base_changelog.md   # 知识库更新日志
```

## 4. 知识库内容

当前知识库覆盖 Python 基础 18 个知识点：

| 编号 | 知识点 |
|---|---|
| K001 | Python 是什么 |
| K002 | 变量与赋值 |
| K003 | 基本数据类型 |
| K004 | 输入输出 |
| K005 | 运算符 |
| K006 | 条件判断 |
| K007 | for 循环 |
| K008 | while 循环 |
| K009 | 列表 |
| K010 | 字典 |
| K011 | 元组与集合 |
| K012 | 字符串常用操作 |
| K013 | 函数定义与调用 |
| K014 | 参数与返回值 |
| K015 | 文件读写 |
| K016 | 异常处理 |
| K017 | 模块导入 |
| K018 | 成绩统计器综合项目 |

每个知识点包含 `source_id/fact_id/difficulty/keywords/facts/examples/practiceTasks/quizItems/retrieval_trace` 等字段，保证 C/D 生成和展示时可以追溯来源。

## 5. B/A/C/D 联调协议

### B 画像构建

B 输出学习者画像，字段参考：

```json
{
  "learner_id": "demo_loop_weak",
  "level": "beginner",
  "known_concepts": ["变量", "数据类型", "条件判断"],
  "weak_concepts": ["循环", "列表"],
  "goal": "理解重复执行并能遍历一组数据"
}
```

### A RAG 检索

A 使用 B 的画像拼接 query，并调用：

```ts
retrieveKnowledge({ query, learnerLevel: profile.level, topK: 5 })
```

输出 `rag_result` 给 C/D。

### C 内容生成

C 只能基于 `rag_result.results[*].facts/examples/practiceTasks/quizItems` 生成讲义、代码实验、测试题。

红线：知识性陈述必须带 `source_id/fact_id`，不能凭空生成。

### D 展示与状态

D 展示：

- `profile`
- `rag_result`
- `retrieval_trace`
- `citations`

让评委看到“为什么推荐这个知识点”。

## 6. 新版 D 与主 Agent 联调验证

先启动主 Agent：

```bash
bun scripts/learning-orchestrator-api.ts --host=127.0.0.1 --port=8787 --data-root=.tmp/role-d-ui-v2-orchestrator
```

另开一个终端启动新版 D：

```bash
bun run role-d:v2:dev -- --host 127.0.0.1 --port 4175
```

浏览器打开 `http://127.0.0.1:4175/`。新版 D只调用主 Agent持续会话接口；不要启动已下线的旧版 D。

验证命令：

```bash
bun run role-d:v2:verify
```

## 7. 更新规则

A 每次改知识库后：

```bash
git add <changed files>
git commit -m "chore: update knowledge base"
git push origin main
```

B/C/D 每次联调前：

```bash
git pull origin main
bun install
bun run check
```

## 8. 常见坑

| 坑 | 后果 | 正确做法 |
|---|---|---|
| B/C/D 直接读 A 本地路径 | 跨电脑访问不到 | 从 GitHub clone/pull |
| 每个人手动复制文件 | 版本不一致 | 统一以 GitHub main 为准 |
| C 不用 rag_result | 容易幻觉 | 只用 facts/examples/quizItems |
| D 不展示 trace | 看不到推荐依据 | 展示 retrieval_trace/citations |
| A 改完不 push | B/C/D 拿不到更新 | 每次改完 commit + push |
