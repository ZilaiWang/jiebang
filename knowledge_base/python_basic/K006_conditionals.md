---
source_id: K006
title: 条件判断
module: Python基础
difficulty: beginner
prerequisites: [K003, K005]
keywords: [if, elif, else, 条件, 判断, 分支]
---

# K006 条件判断

## 1. 核心定义

if 根据条件真假决定是否执行代码块。

## 2. 必须掌握

- if 根据条件真假决定是否执行代码块。
- elif 用于追加多个互斥条件分支。
- else 处理前面条件都不满足的情况。

## 3. 示例

### 成绩等级判断

```python
score = 82
if score >= 60:
    print("pass")
else:
    print("retry")
```

if/else 根据条件真假选择不同分支。

## 4. 常见错误

- 把概念记成语法碎片，不结合实际任务使用。
- 生成内容时不标注 source_id 与 fact_id，导致后续无法审核。

## 5. 实操任务

- 根据分数输出及格或不及格
- 写出多分支等级判断

## 6. 分阶测试题

- Level 1: 当 if 条件不满足且存在 else 时，程序会执行什么？
- Level 2: 请完成一个与“条件判断”相关的小练习。

## 7. 可引用事实

- F001: if 根据条件真假决定是否执行代码块。
- F002: elif 用于追加多个互斥条件分支。
- F003: else 处理前面条件都不满足的情况。
