---
source_id: K012
title: 字符串常用操作
module: Python基础
difficulty: basic
prerequisites: [K003]
keywords: [字符串, str, 切片, split, join, 文本]
---

# K012 字符串常用操作

## 1. 核心定义

字符串是字符序列。

## 2. 必须掌握

- 字符串是字符序列。
- split 可按分隔符拆分字符串。
- join 可把多个字符串连接成一个字符串。

## 3. 示例

### 拆分和处理成绩数据

```python
data = "小明:92,小红:85,小刚:78"
pairs = data.split(",")
for pair in pairs:
    name, score = pair.split(":")
    print(name, "的成绩是", score)
```

split 把逗号分隔的字符串拆成列表，再逐个拆分出姓名和成绩。

### 拼接报告

```python
names = ["小明", "小红", "小刚"]
scores = [92, 85, 78]
lines = []
for i in range(len(names)):
    lines.append(names[i] + "：" + str(scores[i]) + "分")
report = "\n".join(lines)
print(report)
```

join 把每行报告用换行符连接成完整的多行文本。

## 4. 常见错误

- split 的结果是列表，忘记对每个元素单独处理（如直接 print(data.split(",")) 只输出列表本身）。
- join 只能用于字符串列表，如果列表中有数字（如 [1,2,3]）需先转为字符串。
- 混淆 split（拆分成列表）和 join（把列表合成字符串）的用法方向。

## 5. 实操任务

- 拆分逗号分隔的成绩数据
- 把多行报告用换行符合并为一段字符串

## 6. 分阶测试题

- Level 1: "a,b,c".split(",") 的结果是？（A. "abc"  B. ["a","b","c"]  C. "a b c"  D. ["abc"]）
- Level 2: 给定 data = "张三:88,李四:95,王五:72"，用 split 解析后输出每个同学姓名和成绩。

## 7. 可引用事实

- F001: 字符串是字符序列。
- F002: split 可按分隔符拆分字符串。
- F003: join 可把多个字符串连接成一个字符串。
