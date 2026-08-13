---
source_id: K017
title: 模块导入
module: Python基础
difficulty: intermediate
prerequisites: [K013]
keywords: [import, 模块, 导入, 库, 复用代码]
---

# K017 模块导入

## 1. 核心定义

import 用于导入模块。

## 2. 必须掌握

- import 用于导入模块。
- 模块可以复用其他文件或标准库中的功能。
- from ... import ... 可导入模块中的指定对象。

## 3. 示例

### 用 math 模块计算统计值

```python
import math

scores = [85, 92, 78, 95, 88]
mean = sum(scores) / len(scores)
std_dev = math.sqrt(sum((x - mean) ** 2 for x in scores) / len(scores))
print("平均分：", round(mean, 2))
print("标准差：", round(std_dev, 2))
```

import math 导入整个 math 模块，math.sqrt 使用其中的平方根函数。

### 从模块导入指定函数

```python
from math import sqrt, pi

r = 5
area = pi * r ** 2
print("半径为", r, "的圆面积：", round(area, 2))

result = sqrt(144)
print("144 的平方根：", result)
```

from ... import ... 只导入需要的函数或常量，调用时无需加模块前缀。

## 4. 常见错误

- 忘记 import 直接使用 sqrt()、pi 等函数，导致 NameError。
- 使用 from math import * 通配导入污染命名空间，可能与自定义变量冲突。
- 导入的模块名拼写错误（如 improt math），Python 会抛出 ModuleNotFoundError。

## 5. 实操任务

- 导入 math 模块并使用 sqrt 计算平方根
- 使用 from ... import ... 方式导入特定函数

## 6. 分阶测试题

- Level 1: 以下哪种方式导入后可以直接调用 sqrt(9) 而不需要写 math.sqrt(9)？（A. import math  B. from math import sqrt  C. include math  D. import *）
- Level 2: 导入 random 模块，写代码生成 5 个 1 到 100 之间的随机整数并输出。

## 7. 可引用事实

- F001: import 用于导入模块。
- F002: 模块可以复用其他文件或标准库中的功能。
- F003: from ... import ... 可导入模块中的指定对象。
