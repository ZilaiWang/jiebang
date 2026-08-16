# Day5 · 1号工作报告（4号兼做）

日期：2026-08-16
角色：1号——闭环与主流程（今天 1号 有事，4号 兼做）

## 1. 做了什么

```text
1. 补充两个学习者：画像冲突学习者（王芳）+ 基础较强学习者（李强），
   learners.json 从 3 组扩到 5 组。
2. 跑五组学习者，每组从创建走到反馈决策。
3. 三组完整跑通（走到 feedback 决策 + 第二轮资源生成），两组 code-lab 失败。
4. 每组 session + events 按组归类保存到 runs/。
```

## 2. 五组结果

| 组 | 学习者 | 自评 | 客观画像 | 自评vs客观 | 反馈决策 | 状态 |
|---|---|---|---|---|---|---|
| 1 | 林晓·零基础 | new | beginner | 相仿 | remediate | ✅ 完整跑通 |
| 2 | 陈昊·基础薄弱 | beginner | basic | 客观高于自评 | — | ❌ code-lab |
| 3 | 张伟·项目目标 | intermediate | intermediate | 相仿 | reinforce | ✅ 完整跑通 |
| 4 | 王芳·画像冲突 | intermediate | beginner | 客观低于自评 | advance | ✅ 完整跑通 |
| 5 | 李强·基础较强 | advanced | integrated | 相仿 | — | ❌ code-lab |

五组画像 level 分层：beginner / basic / intermediate / beginner / integrated，五种"自评 vs 客观"关系全部正确体现。

## 3. 完整闭环的三组（走到反馈决策）

```text
林晓：beginner，known=2 weak=1，路径1节点，decision=remediate（补救）✅
张伟：intermediate，known=4 weak=1，路径2节点，decision=reinforce（巩固）✅
王芳：beginner，known=3 weak=1，路径4节点，decision=advance（进阶）✅

三组都走完了：创建→诊断→画像→路径→资源→测评→反馈决策→第二轮生成。
反馈动作分层：补救 / 巩固 / 进阶 三种，靠精确控制测评准确率（答对1题/4题/5题）实现。
```

## 4. 为什么会生成失败（code-lab 死结，讲透）

代码实验（code-lab）生成失败，根因是：**模型生成代码实验时，写的"执行方式"和系统定死的"执行规矩"对不上。**

系统给每个代码实验定一个"执行合同"（execution_contract），规定代码怎么跑、怎么评分，有两种模式：

```text
function 模式：代码必须是函数，评分看函数的返回值（return）
stdin_stdout 模式：代码可以打印，评分看打印输出（print）
```

这个模式是系统按画像和目标"程序化推导 + 冻结"的（deriveCodeLabExecutionMode），模型说了不算：

```text
目标涉及"函数/返回值" 或 画像 level 高（intermediate 以上）→ function 模式
目标涉及"打印/输入输出" 或 画像 level 低（beginner/basic）→ stdin_stdout 模式
```

失败就发生在"模型写的执行方式和冻结的模式不一致"。三种具体错法：

```text
① FUNCTION_OUTPUT_CONTRACT_MISMATCH（最频繁，2次）
   系统冻结 function 模式（要求函数 return 返回值）
   但模型把任务写成了"打印到屏幕"（print）
   例："统计成绩平均分"这个任务，模型天然写成 print(平均分)
       但 function 模式要求 return 平均分，两者冲突

② INVALID_EXPECTED_TYPE（隐藏测试类型错）
   模型生成隐藏测试的 expected（期望值）时，类型和 output_contract 声明不一致
   例：声明"返回数值"，expected 却写成字符串 "42"

③ static_forbidden_import / static_dangerous_builtin（静态分析）
   模型生成的代码用了禁止的 import 或危险的 builtin（如 eval/exec）
```

为什么偏偏是全对的两组（陈昊、李强）挂：

```text
诊断全对 → weak_concepts 空 → 画像"全掌握"（basic/integrated）
→ 系统不再生成"补基础"的简单实验
→ 改生成"成绩统计器/综合项目"这类进阶实验
→ 进阶实验本质是"多步骤计算 + 输出结果"：
   1. 模型习惯把"输出结果"写成 print（和 function 模式冲突）
   2. 复杂计算的 expected 类型容易写错
   3. 容易用花哨的 import/builtin
→ 验证失败

而基础组（林晓/张伟/王芳，weak 有值）生成的是"补薄弱点"的简单实验：
   stdin_stdout 模式，print 合法，类型简单，几乎必过
```

为什么修复修不好：

```text
修复 prompt 明确要求模型："把 output_contract 改成返回值类型、删掉 print、
确保 expected 类型一致、别用危险代码"

但模型的生成习惯（爱写 print、爱把数字写成字符串）和严格类型约束冲突，
重试 4 次都改不好 → 修复预算耗尽 → blocked
```

## 5. 交付产物

```text
.tmp/competition-sprint/day5-metrics/runs/
├── learners-run-raw.json          五组运行结果汇总
├── 林晓/  session.json + events.json(19) + summary.json
├── 陈昊/  session.json + events.json(13) + summary.json
├── 张伟/  session.json + events.json(19) + summary.json
├── 王芳/  session.json + events.json(19) + summary.json
└── 李强/  session.json + events.json(13) + summary.json

新增学习者：.tmp/competition-sprint/day0-precheck/learners.json（3组→5组）
脚本：scripts/day5-learners-run.py、scripts/save-day5-sessions.py
```

## 6. 遗留 + 下一步

```text
1. 陈昊/李强 code-lab 失败：需修 code-lab 类型校验，或改答案降级
   （但改答案会破坏"客观高于自评"/"相仿"关系）。
2. 4号 的活晚上做：difficulty-fit.json + practical-value-report.md。
3. 依赖 2号（agent 协同指标）、3号（幻觉率/覆盖率）的数据，写报告时留占位。
```
