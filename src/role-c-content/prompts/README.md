# Role C 提示词结构地图

本目录是 Role C（角色3，生成质量与防幻觉）的全部提示词。目的是让任何人在遇到生成/门禁问题时，能快速定位到「该看哪个文件、哪一段、对应哪道门禁」。

## 一、整体分层

```
common-policy.ts            公共策略（权威边界、安全红线、下一轮语义、版本号）
        │
        ├─ concept-tutor/   讲义（概念讲解）
        ├─ code-lab/        代码实验（公开/私有 + 各种修复）
        ├─ evaluator/       分层测评（命题 + 评分 + 反馈）
        └─ critic/          跨产物审查
        │
staged-repair.prompt.ts     分阶段通用修复模板（所有 stage 失败重试共用）
```

每个角色内部又分「**作者（author）**」和「**修复（repair）**」两个阶段：
- 作者：首次生成内容（public stage / secure stage）
- 修复：校验失败后，带着 `validator_report` 重新生成

## 二、生产（staged）vs 兼容（monolithic）

| 策略 | 说明 | 文件特征 |
|---|---|---|
| **staged（生产默认）** | 分阶段：先公开、后私有、失败分阶段修复 | `*-stage.prompt.ts`、`execution-repair`、`staged-repair` |
| **monolithic（兼容保留）** | 一次生成整个 draft | 各角色的 `system.prompt.ts` + `repair.prompt.ts` |

`.env.role-c.local` 里 `ROLE_C_MODEL_GENERATION_STRATEGY=staged`，所以**排障优先看 staged 那套**；`system.prompt.ts` 只在切到 monolithic 时才生效。

## 三、文件职责速查

### code-lab/（代码实验）

| 文件 | 阶段 | 职责 |
|---|---|---|
| `public-stage.prompt.ts` | 公开作者 | 生成 title / execution_contract / starter / 公开测试 / 提示 |
| `secure-stage.prompt.ts` | 私有作者 | 生成 reference_solution / hidden_tests / 评分组 |
| `starter-repair.prompt.ts` | 修复 | starter 已通过隐藏测试时，恢复为未完成骨架 |
| `execution-repair.prompt.ts` | 修复 | 可信执行失败后修复 reference / hidden_tests |
| `public-safety-repair.prompt.ts` | 修复 | 公开材料泄漏答案时的定点删改 |
| `system.prompt.ts` | monolithic | 旧的整体生成 prompt（兼容） |
| `repair.prompt.ts` | monolithic | 旧的整体修复 prompt（兼容） |

### concept-tutor/（讲义）

| 文件 | 阶段 | 职责 |
|---|---|---|
| `staged.prompt.ts` | 分阶段作者 | 生成单段讲义（explanation / example / misconception / micro_check / summary） |
| `system.prompt.ts` | monolithic | 旧的整体讲义 prompt（兼容） |
| `repair.prompt.ts` | monolithic | 旧的整体修复（兼容） |

### evaluator/（测评）

| 文件 | 阶段 | 职责 |
|---|---|---|
| `staged.prompt.ts` | 分阶段作者 + 修复 | public/secure 命题、执行修复、换题（novelty）修复、下一轮变体策略 |
| `author-system.prompt.ts` | monolithic | 旧的命题 prompt（兼容） |
| `author-repair.prompt.ts` | monolithic | 旧的命题修复（兼容） |
| `grader.prompt.ts` | 评分 | 主观题评分 |
| `feedback.prompt.ts` | 反馈 | 逐题反馈 |

## 四、门禁 → 定位表（排障核心）

遇到报错/门禁，按关键字查：

| 报错关键字 | 校验代码位置 | 应查的提示词段落 |
|---|---|---|
| `STDIN_FUNCTION_CONTRACT_MISMATCH` | `staged-generation.ts` `codeLabExecutionContractIssues` | `code-lab/public-stage.prompt.ts`「execution_contract 执行方式」 |
| `FUNCTION_OUTPUT_CONTRACT_MISMATCH` | `staged-generation.ts` `functionOutputContractIssues` | `code-lab/public-stage.prompt.ts` / `evaluator/staged.prompt.ts` 的「function 模式」 |
| `hidden_test_input_leak` / `hidden_test_expected_leak` | `public-secure-leak-validator` | `code-lab/secure-stage.prompt.ts`（隐藏输入与公开不同）+ `staged-repair.prompt.ts` |
| `static_unlisted_import` / `static_forbidden_import` | `python-static-analyzer` | `code-lab/secure-stage.prompt.ts` 的 import 白名单约束 |
| `reference_solution_leak` / `starter_equals_reference` | `public-secure-leak-validator` | `code-lab/public-safety-repair.prompt.ts` |
| `未在有限修复次数内通过校验` | `model-backed-provider.ts` `generateStage` | 对应 stage 的 prompt + `staged-repair.prompt.ts` 第 8-19 行 |
| 事实审核 `non_factual` / `unsupported` | `fact-audit` | `common-policy.ts`「权威边界」第 4-6 条 |
| 题目重复 / `items[n]` | `assessment-novelty` | `evaluator/staged.prompt.ts` 换题修复 + `staged-repair.prompt.ts` |

## 五、提示词分层的确定性原则

Role C 提示词统一遵循一条分界：**程序管「结构确定性」，模型管「教学语义」**。

- 确定性（程序注入，模型不碰）：execution_mode、language、entry_point 有无、resource_limits、ID/身份/覆盖/引用。
- 语义（模型创作）：题目、讲解、题干、代码逻辑、constraints 描述。

判断一个新字段该放哪层：问「这个值能由规则算出来吗？」能 → 程序；不能（要结合实时内容）→ 模型。

## 六、改提示词的注意事项

1. 改任何 staged 提示词，记得 bump `common-policy.ts` 的 `ROLE_C_PROMPT_MANIFEST_VERSION`（否则旧缓存不失效）。
2. 改完跑 `bun run check` + `bun run test:role-c:real` 验证。
3. 不要用字面措辞去「锁」提示词——行为测试比 prompt 快照更可靠。
