# 测试数据说明（test-data-guide）

> 本文档说明：**评测用了几组学习者数据、每组是什么画像、测试结果是多少、指标怎么复跑。**

---

## 一、五组学习者样例

数据文件：`.tmp/competition-sprint/day0-precheck/learners.json`

| 编号 | 姓名 | 画像类型 | 目标 | 关键特征 |
|---|---|---|---|---|
| L1 | 林晓 | 零基础 | 学习 Python for 循环 | 完全没接触过 Python，new |
| L2 | 陈昊 | 基础薄弱 | 带循环的成绩统计程序 | 学过一点 C，beginner，循环/列表易错 |
| L3 | 张伟 | 项目目标 | 读取成绩文件统计平均分 | 转行做数据分析，intermediate，SQL 基础 |
| L4 | 王芳 | 画像冲突 | 学习文件读写 | 自评 intermediate 有基础，但诊断 beginner 题都错 → 触发 reprofile |
| L5 | 李强 | 基础较强 | 成绩统计器综合项目 | Java 基础，advanced，project 型 |

每组都包含完整契约字段：learner_request（姓名/背景/每周小时/自评/目标）+ 预期画像（known/weak/level/能力三维）。

---

## 二、测试结果

### 主项目测试

| 命令 | 结果 |
|---|---|
| `bun run test` | **452 pass / 47 skip / 0 fail**（共 499 用例，102 个文件） |

> 说明：3号 Day7 报告「458 pass」，是在其 Day7 修复分支（多目标代码实验等）上跑的，多出 6 个用例，待合并后对齐。

### 前端测试

| 命令 | 结果 |
|---|---|
| `bun run role-d:v2:test` | **67 pass / 0 fail**（main 分支） |

> 说明：4号 的 PR#23（Day6 前端可解释性）新增 6 个前端用例，合并后为 **73 pass / 0 fail**。

### 类型检查

| 命令 | 结果 |
|---|---|
| `bun run typecheck` | **0 错误** |

---

## 三、三大量化指标（Day5 实测）

| 指标 | 目标 | 实测 | 达标 |
|---|---:|---:|---|
| 幻觉率 | < 5% | 0% | ✅ |
| 难度适配率 | ≥ 85% | 100% | ✅ |
| 覆盖率 | ≥ 90% | 100% | ✅ |

指标数据文件（`.tmp/competition-sprint/day5-metrics/`）：

```text
hallucination-rate.json   幻觉率（每组的无效引用比例）
difficulty-fit.json       难度适配率（资源难度 base vs 画像 level）
knowledge-coverage.json   覆盖率（目标知识点 vs 覆盖知识点）
```

---

## 四、怎么复跑

```bash
# 1. 主项目测试
bun run test

# 2. 前端测试
bun run role-d:v2:test

# 3. 类型检查
bun run typecheck

# 4. 一键全量（含构建）
bun run check
```

---

## 五、数据真实性说明

```text
· 五组学习者输入严格对齐前端 learner_request 契约，不做假。
· 三指标来自真实运行 session 的统计脚本，不是手填。
· 难度适配率口径 = 资源生成 DifficultyVector（按画像 level 算 base 1-4），
  非「知识点难度」，与赛题口径一致。
· 测试结果是真实命令输出，0 失败。
```
