# Role D 新版前端使用说明

当前活动前端只有：

```text
src/role-d-ui-v2
```

它只调用 learning-orchestrator 主 Agent 的统一持续会话接口，不直接调用 A、B、C 或任何 Worker。

## 正确拓扑

```text
用户 → Role D v2 → learning-orchestrator 主 Agent → 八个 Worker / A-B-C → 主 Agent持久状态 → Role D v2展示
```

## 启动

终端一：

```bash
bun scripts/learning-orchestrator-api.ts --host=127.0.0.1 --port=8787 --data-root=.tmp/role-d-ui-v2-orchestrator
```

终端二：

```bash
bun run role-d:v2:dev -- --host 127.0.0.1 --port 4175
```

浏览器打开：

```text
http://127.0.0.1:4175/
```

## 验证

```bash
bun run role-d:v2:test
bun x tsc -p src/role-d-ui-v2/tsconfig.json --noEmit
bun run role-d:v2:build
```

或一次运行：

```bash
bun run role-d:v2:verify
```

## Role D运行时边界

Role D只调用：

- `POST /orchestrator/sessions`
- `GET /orchestrator/sessions/:id`
- `POST /orchestrator/sessions/:id/commands`
- `GET /orchestrator/sessions/:id/events`

Role D不负责：

- 生成或挑选专业题目；
- 构建画像、RAG和学习路径；
- 直连A/B/C；
- 编排八个Worker；
- 本地判分或决定下一步；
- 保存权威mastery、评分或路径状态。

## 当前联调限制

当前主 Agent持续会话只接受 `deterministic`模式。该限制属于主 Agent后端，不属于Role D。主 Agent提供生产模式后，Role D客户端再移除对应模式参数。
