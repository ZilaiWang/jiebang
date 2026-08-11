# Role C 提示词目录

所有文件位于 `src/role-c-content/prompts/`，统一通过 `index.ts` 导出。

## 公共模块

| 文件 | 说明 |
|------|------|
| `common-policy.ts` | 版本号（`c-prompts-1.16.2`）、权威边界、个性化边界、next_round 语义 |
| `staged-repair.prompt.ts` | 分阶段生成通用修复模板，code-lab / evaluator 共用 |

## Concept Tutor

| 文件 | 说明 |
|------|------|
| `concept-tutor/system.prompt.ts` | 主系统提示词。含概念引入策略、示例设计原则、误区预防、即时检测、提示层级设计、整体连贯性要求 |
| `concept-tutor/repair.prompt.ts` | 校验失败时的定向修复提示词，只修失败项、不扩大内容范围 |
| `concept-tutor/staged.prompt.ts` | 分阶段生成提示词（单个目标组）。含 explanation / worked_example / misconception / micro_check / hints / summary 各字段的生成策略 |

## Code Lab

| 文件 | 说明 |
|------|------|
| `code-lab/system.prompt.ts` | 主系统提示词。含任务驱动设计、公开测试设计、提示层级设计、反思题设计原则 |
| `code-lab/repair.prompt.ts` | 校验失败时的定向修复提示词，含隐藏测试泄漏处理指引 |
| `code-lab/public-stage.prompt.ts` | 公开创作阶段。生成任务说明、starter、公开测试、提示、反思题。含 instruction / starter / public_test / hints / reflection 的设计指导 |
| `code-lab/secure-stage.prompt.ts` | 私有可执行语义阶段。生成参考实现、隐藏测试、mutation。含测试覆盖策略（常规/边界/防硬编码） |
| `code-lab/execution-repair.prompt.ts` | Docker 执行失败后的最小修订补丁。含修复策略（先定位是源码还是测试有误） |
| `code-lab/starter-repair.prompt.ts` | Starter 通过全部测试时退化为学习骨架。保留签名、替换核心逻辑为 TODO |
| `code-lab/public-safety-repair.prompt.ts` | 公开材料可还原完整答案时的安全重写。只改学习者可见内容 |

## Evaluator

| 文件 | 说明 |
|------|------|
| `evaluator/author-system.prompt.ts` | 命题主提示词。含分层设计（Tier1/2/3）、选项设计（错误选项对应 misconception）、code-pair 结构（无主观简答题） |
| `evaluator/author-repair.prompt.ts` | 命题校验失败时的定向修复提示词，含隐藏测试泄漏处理指引 |
| `evaluator/feedback.prompt.ts` | 学习反馈生成。含正向引导策略、具体可行动原则、formative / summative 双模式说明 |
| `evaluator/grader.prompt.ts` | 盲审量规判断器。met / unmet / uncertain 的判断标准与 confidence 取值指导 |
| `evaluator/staged.prompt.ts` | 分阶段命题（3个提示词）：公开出题阶段（题干/选项/难度控制）、私有答案阶段（答案合同/rubric/代码测试）、可信执行修订阶段（修复策略） |

## Critic

| 文件 | 说明 |
|------|------|
| `critic/system.prompt.ts` | 跨产物一致性审查。检查讲义/实验/测评与 GenerationSpec 的目标覆盖、行为匹配、难度对齐、答案一致性 |

## 统一约束

1. 证据、目标、答案语义和 public/secure 边界保持稳定。
2. 输出遵循对应 JSON Schema。
3. ID、item plan、routing、coverage、权重、评分和发布状态由程序确定。
4. 修改提示词后运行 `bun run check` 验证。
