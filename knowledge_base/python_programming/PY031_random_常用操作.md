# PY031 random 常用操作

- 模块：Python程序设计
- 难度：basic

## 可审核事实
- PY031:F001 — random 模块可用于生成随机数。
- PY031:F002 — randint(a, b) 可生成包含端点 a 和 b 的随机整数。
- PY031:F003 — choice 可从序列中随机选取一个元素。

## 教学示例

```python
import random

score = random.randint(60, 100)
name = random.choice(["å°æ", "å°çº¢", "å°å"])
print(name, score)
```

random.randint çæéæºæç»©ï¼random.choice ä»å§ååè¡¨ä¸­éæºéæ©ä¸ä¸ªå­¦çã

## 练习任务
- 用 randint 生成 1 到 100 的随机整数
- 用 choice 从学生列表中随机选出一名学生

## 题目种子
- `choice`：random.randint(1, 6) 的可能结果包含哪个端点？（答案：1 和 6 都可能包含；引用：PY031:F002）
- `short_answer`：说明 choice 的作用。（答案：choice 可从序列中随机选取一个元素。；引用：PY031:F003）
- `debugging`：判断正误：random 模块只能生成固定数字。（答案：错误。random 模块可用于生成随机数。；引用：PY031:F001）
- `practice`：写代码生成 1 到 10 的随机整数。（答案：能导入 random 并调用 randint(1, 10)。；引用：PY031:F002）
