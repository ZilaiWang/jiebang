# PY035 CSV 文本数据处理

- 模块：Python程序设计
- 难度：intermediate

## 可审核事实
- PY035:F001 — CSV 常用逗号分隔一行中的多个字段。
- PY035:F002 — csv 模块可帮助读取和写入 CSV 表格数据。
- PY035:F003 — 处理 CSV 成绩表时通常需要逐行读取记录。

## 教学示例

```python
import csv

with open("scores.csv", "r", encoding="utf-8") as f:
    reader = csv.reader(f)
    for row in reader:
        print(row)
```

csv.reader æè¡è¯»å CSV æä»¶ï¼æ¯ä¸è¡ä¼è¢«è§£ææå­æ®µåè¡¨ã

## 练习任务
- 读取 CSV 成绩表并输出每行字段
- 说明 CSV 与普通文本行的关系

## 题目种子
- `choice`：CSV 一行中的多个字段通常用什么分隔？（答案：逗号；引用：PY035:F001）
- `short_answer`：csv 模块有什么作用？（答案：csv 模块可帮助读取和写入 CSV 表格数据。；引用：PY035:F002）
- `debugging`：判断正误：处理 CSV 成绩表不需要逐行读取记录。（答案：错误。处理 CSV 成绩表时通常需要逐行读取记录。；引用：PY035:F003）
- `practice`：写代码读取 scores.csv 并逐行输出。（答案：能使用 open、csv.reader 和 for 循环。；引用：PY035:F002）
