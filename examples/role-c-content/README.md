# Role C 样例

| 入口 | 内容 |
|---|---|
| `learning_path_node_score_project.json` | 含必填 `assessment_blueprint` 的路径节点样例 |
| `bun run demo:role-c` | concept-tutor 讲义与证据门禁 |
| `bun run demo:role-c:lab` | code-lab public 产物、Docker 验证与 opaque secure ref |
| `bun run demo:role-c:full` | 三 Agent、A/B 审核、Docker 评分、原子投递、mastery 与下一轮审核生成 |
| `bun run smoke:role-c:model` | 三个 Author 的真实模型冒烟 |
| `bun run docker:role-c:build` | 构建专用 Python runner 镜像 |
| `bun run docker:role-c:doctor` | 检查 Docker、专用镜像标签和不可变 image ID |
| `bun run test:role-c:docker` | 正确、错误、超时、输出与内存限制的 Docker 验收 |

真实模型参数从 `.env.role-c.local` 读取。`scripts/role-c-real-model-smoke.ts` 支持 `--agents`、`--no-repair`、staged/monolithic、阶段 token 预算和 concept 并发配置。

自动测试位于 `tests/role-c-*.test.ts`，覆盖内容审核、ready、blocked、failed、revision、checkpoint、cache、runner、secure store、持久化、幂等提交、原子投递和下一轮重放。
