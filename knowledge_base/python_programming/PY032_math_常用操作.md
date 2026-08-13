# PY032 math 常用操作

- 模块：Python程序设计
- 难度：basic

## 可审核事实
- PY032:F001 — math 模块提供常用数学函数和常量。
- PY032:F002 — sqrt 可计算平方根。
- PY032:F003 — ceil 和 floor 可分别进行向上取整和向下取整。

## 教学示例

```python
import math

radius = 3
area = math.pi * radius ** 2
print(round(area, 2))
print(math.sqrt(81))
```

math.pi æä¾åå¨çå¸¸éï¼math.sqrt è®¡ç®å¹³æ¹æ ¹ã

## 练习任务
- 用 math.sqrt 计算平方根
- 用 math.pi 计算圆面积

## 题目种子
- `choice`：计算平方根常用 math 中哪个函数？（答案：sqrt；引用：PY032:F002）
- `short_answer`：ceil 和 floor 的区别是什么？（答案：ceil 向上取整，floor 向下取整。；引用：PY032:F003）
- `debugging`：判断正误：math 模块不包含数学常量。（答案：错误。math 模块提供常用数学函数和常量。；引用：PY032:F001）
- `practice`：写代码计算 49 的平方根。（答案：能调用 math.sqrt(49)。；引用：PY032:F002）
