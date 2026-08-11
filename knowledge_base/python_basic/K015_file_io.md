---
source_id: K015
title: 文件读写
module: Python基础
difficulty: intermediate
prerequisites: [K003, K012]
keywords: [文件, 读取, 写入, open, read, write, 文本文件]
---

# K015 文件读写

## 1. 核心定义

open 可用于打开文件。

## 2. 必须掌握

- open 可用于打开文件。
- read 可读取文件内容。
- 写文件时应明确写入模式并注意覆盖风险。

## 3. 示例

### 读取成绩文件

```python
with open("scores.txt", "r", encoding="utf-8") as f:
    content = f.read()
    print("文件内容：")
    print(content)
```

with 语句自动管理文件关闭，"r" 表示只读模式。read() 一次性读取全部内容。

### 写入统计结果

```python
students = ["小明:92", "小红:85", "小刚:78"]
with open("report.txt", "w", encoding="utf-8") as f:
    for student in students:
        f.write(student + "\n")
print("报告已写入 report.txt")
```

"w" 写入模式会覆盖已有文件；每调用一次 write 写入一行，需要手动加换行符 \n。

## 4. 常见错误

- 写文件时使用 "w" 模式忘记原有内容会被直接覆盖，应用 "a"（追加）模式保留已有内容。
- 打开文件后忘记关闭导致资源泄漏——应始终使用 with 语句自动管理。
- 读取中文文件时缺少 encoding="utf-8" 参数导致乱码或 UnicodeDecodeError。

## 5. 实操任务

- 读取文本文件内容
- 把统计结果写入文件

## 6. 分阶测试题

- Level 1: 使用 open 的 "w" 模式打开一个已有文件会？（A. 追加内容  B. 覆盖原文件  C. 报错  D. 只读打开）
- Level 2: 写代码：把程序中的学生姓名和成绩逐行写入 score_report.txt，每行格式为"姓名：成绩"。

## 7. 可引用事实

- F001: open 可用于打开文件。
- F002: read 可读取文件内容。
- F003: 写文件时应明确写入模式并注意覆盖风险。
