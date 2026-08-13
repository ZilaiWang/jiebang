---
source_id: K007
title: for 循环
module: Python基础
difficulty: beginner
prerequisites: [K002, K003]
keywords: [for, 循环, 遍历, 重复执行, 序列]
---

# K007 for 循环

## 1. 核心定义

for 循环常用于遍历序列中的元素。

## 2. 必须掌握

- for 循环常用于遍历序列中的元素。
- for 循环适合对列表、字符串等对象逐个处理。
- range 可生成整数序列配合 for 重复执行固定次数。

## 3. 示例

### 遍历成绩列表

```python
scores = [80, 90, 75]
for score in scores:
    print(score)
```

for 循环会依次取出列表中的每个成绩，适合重复处理。

## 4. 常见错误

- 把概念记成语法碎片，不结合实际任务使用。
- 生成内容时不标注 source_id 与 fact_id，导致后续无法审核。

## 5. 实操任务

- 遍历列表并打印每个元素
- 用 for 计算 1 到 10 的和

## 6. 分阶测试题

- Level 1: for 循环最适合用于什么场景？
- Level 2: 请完成一个与“for 循环”相关的小练习。

## 7. 可引用事实

- F001: for 循环常用于遍历序列中的元素。
- F002: for 循环适合对列表、字符串等对象逐个处理。
- F003: range 可生成整数序列配合 for 重复执行固定次数。
