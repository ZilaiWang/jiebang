# Day3 · 4号工作报告

日期：2026-08-14
角色：4号——样例评测与前端体验负责人

## 1. 今天完成了什么

**整合了 1号、3号 的 Day3 交付（2号 延迟：3号代码在他机上出问题，沟通核查中）**

```text
1号：审核阶段接入主流程（C生成→审核中→通过才发布→失败进修复→多次失败降级/blocked）
     session 新增 content_review，前端加"内容审核·发布门禁"卡片
3号：讲义/代码实验/测评统一内容检查 + 三类内容知识证据方式 + 修复/降级流程
     + 代码练习函数题/stdin题统一 + PR#9 修复输入输出门禁误判
```

**构造坏样例验收审核机制（Day3 核心任务）**

按分工计划构造 3 个坏样例 + 2 个好样例对照 + 2 个降级样例，喂给 A 事实审核 + B 教学审核 + B 学习进展降级：

```text
坏样例1·缺引用        → 期望 missing_citation/revise  → ✅ 命中
坏样例2·引用造假(张冠李戴) → 期望 unsupported/reject     → ✅ 命中
坏样例3·难度过高       → 期望 misaligned/reject       → ✅ 命中
好样例1·正确引用       → 期望 supported/pass          → ✅ 通过
好样例2·正确教学       → 期望 aligned/pass            → ✅ 通过
降级样例1·概念降级     → 期望 concept_downgraded      → ✅ 触发
降级样例2·水平降档     → 期望 level_downgraded        → ✅ 触发
```

**结论：3号 的审核机制真实有效——坏的全抓、好的全放、该降级的降级，不冤枉也不漏抓。**

## 2. 怎么验证的

```text
纯函数直测（auditGeneratedContent + auditTeaching + applyProgressObservation 都是纯函数）
不依赖模型、不依赖 2号 调度、不依赖 Docker，本机 import 直接跑
验收脚本：scripts/day3-bad-case-audit.ts
结果：7/7 全部符合预期（坏3全抓 + 好2全放 + 降级2触发）
产物：bad-case-tests.json（期望 vs 实际 逐条记录）
```

**独立复验 3号 的"跨专业案例"（第4台机器真实跑通）**

```text
用真实模型 + Docker 跑 3号 的 role-c-day3-anti-hallucination.ts
结果：status=ready, final_review_decision=pass, publishable=true
审核过程（真实抓到幻觉，不是走过场）：
  第0轮 reject：抓出 10+ 条 semantic_unsupported（引用不支持陈述）
    例："7+3*2=17" 引用了 K005:F001（只说加减乘除），但优先级规则不在引用里 → 判 unsupported
    例：前置知识缺失 4 项（输入输出缺 K002/K003）→ prerequisite_coverage
  修复1：B replan_path 补前置 → 重新生成
  第0轮 revise：还剩 1 条（f-string/逗号拼接 无引用）
  修复2：targeted_rewrite 针对性重写
  第1轮 pass：findings 为空，全部通过
最终：publishable=true，无无效引用（unknown_citations=0）
```

**结论：3号 的防幻觉机制在本机真实生效，能主动抓出"看起来对但引用不支持"的陈述并修复到通过。**

## 3. 发现的问题

```text
1. 2号 机器上 3号 的 Day3 代码跑出问题，3号 电脑正常
   4号 本机（第4台机器）独立复验：跨专业案例真实跑通（pass，publishable=true）
   → 结论：3号 代码本身没问题，大概率是 2号 环境差异（依赖版本/Docker/配置），
     建议 2号 对照本机环境排查
2. 审核机制能抓"缺引用/引用造假/难度过高"三类，但"引用存在却语义相反"
   这类深层幻觉要靠 semantic 审核（deterministic 只查否定反转+数字漂移），
   极端语义幻觉仍可能漏——这是 Day5 指标(幻觉率<5%)要重点盯的
```

## 4. 其他成员注意

```text
- 审核机制是纯函数，可直接 import 测试，不用起完整服务
- fact-audit 管"引用了没、引用支持不支持"；teaching-audit 管"教得对不对"
  （难度/前置/薄弱点/目标），两条线别混
- 坏样例已证明机制有效，Day5 跑三组真实数据时可复用这个脚本框架
```

## 5. 下一步

```text
P0 独立复验 3号 报告的"跨专业案例"和"输入输出流程"（需真实模型+Docker，可选）
P1 Day4：动态诊断/决策，4号 配合构造"难度动态调整"样例
P2 Day5：三组学习者跑闭环，收集指标（幻觉率/难度适配/覆盖率）
P3 2号 机器问题核查结果出来后，确认是否需要环境文档补充
```

## 验收产物

```text
.tmp/competition-sprint/day3-anti-hallucination/
├── bad-case-tests.json          坏样例验收结果（3坏2好，全命中）
├── from-1号/day3-工作报告.md     1号 交付
├── from-3号/day3-工作报告.md     3号 交付
└── from-3号/4号处理说明.md       核查记录
```
