# GLM 生成 + DeepSeek 独立复审：60 例正式评测报告

## 结论

2026-08-27 按仓库正式口径完成 60 例×2 次，共 120 条案例记录。生成模型为 `glm-5.2`，独立复审模型为 `deepseek-v4-pro`。

两轮合并后，幻觉率通过，难度适配和核心知识点覆盖未达标，正式总判定为未通过。

| 指标 | 第 1 次 | 第 2 次 | 两次合并 | 门槛 | 合并判定 |
| --- | ---: | ---: | ---: | ---: | --- |
| 大模型内容幻觉率 | 0.83% | 0.91% | **0.88%** | <5% | 通过 |
| 画像—资源难度适配准确率 | 88.10% | 78.52% | **83.14%** | ≥85% | 未通过 |
| 课程核心知识点覆盖率 | 63.89% | 73.61% | **68.75%** | ≥90% | 未通过 |
| 声明审核覆盖率 | 100.00% | 100.00% | **100.00%** | ≥95% | 通过 |
| 难度审核完整度 | 70.00% | 75.00% | **72.50%** | 100% | 未通过 |

正式脚本没有定义三项等权的单一“均分”，以上合并比例是应对外汇报的正式口径。

## 运行完整性

- 记录：120 / 120。
- `ready / blocked / failed`：87 / 28 / 5。
- Docker 可信执行 `passed / failed / not_reached`：87 / 3 / 30。
- 87 条进入独立复审的 `ready` 记录均完成声明和难度审核，DeepSeek 复审错误为 0。
- DeepSeek 复审调用 654 次：392 次声明审核、261 次难度审核、1 次预检。共计 1,262,713 tokens。

5 条 `failed` 记录的直接原因均为生成运行时限，而非 DeepSeek 鉴权或 JSON 解析：

- 3 条 `MODEL_EXECUTION_BUDGET_EXCEEDED:DEADLINE`。
- 2 条为前述超时触发共享熔断后的 `MODEL_PROVIDER_CIRCUIT_OPEN`。

## 稳定性观察

60 个案例中，44 个两轮状态一致，16 个在 `ready` / `blocked` / `failed` 之间发生变化。其中：

- 36 个 `ready -> ready`。
- 7 个 `blocked -> blocked`。
- 7 个 `blocked -> ready`。
- 6 个 `ready -> blocked`。
- 3 个由第一轮 `failed` 变为第二轮 `ready` 或 `blocked`。
- 1 个 `failed -> failed`。

这表明除知识点覆盖不足外，生成门禁稳定性也是当前主要问题。

## 协议身份

- 运行时仓库 `HEAD`：`65d4ae15b935c1f1db634fd2962f191ec2a84788`。
- 运行时源码树：`sha256:f93b9523399f1cd0560c6e1fecc8f82fa0666747b4cb9cbc40e93ee3affddb0b`。
- 评测协议：`sha256:652fd03851a81191d1380abcc3b520d6885b581567805d6e0653c5e22e0272d4`。
- manifest：`sha256:32590bef2812daf29c05d9bc9a2d0fb758973b43463be032dcba845da885d409`。

本次运行基于最新 `main@65d4ae` 及本分支的 DeepSeek 独立评审适配改动。协议中同时记录了运行时的源码树哈希，用于区分仓库 `HEAD` 与当时尚未提交的适配差异。

## 复现与校验

本地密钥仅保存在 Git 忽略的 `.env.role-c.local`，不得提交或粘贴到 PR。评测脚本默认复用 `.tmp/integrated-orchestrator/provider-config.json` 中已有的 GLM 生成配置，并从本地环境文件读取 DeepSeek 复审配置。

```bash
bun run typecheck
bun test --isolate \
  tests/model-gateway-response-format.test.ts \
  tests/model-gateway-json-extraction.test.ts \
  tests/competition-claim-auditor.test.ts \
  tests/resource-difficulty-judge.test.ts
bun run eval:competition:final
```

本次改动已通过 TypeScript 检查和 20 项相关测试。原始生成产物、运行目录和逐声明审核载荷保留在本地，不进入 PR。

## 后续建议

1. 优先补齐冻结事实束与课程核心知识点的映射，直接改善 68.75% 的覆盖率。
2. 固定生成策略和修复边界，降低两轮状态漂移。
3. 对补充案例单独放宽任务截止时间，并避免单案超时打开全局共享熔断。
4. 待本 PR 合并且上述问题修复后，再在清洁 commit 上运行最终验收。
