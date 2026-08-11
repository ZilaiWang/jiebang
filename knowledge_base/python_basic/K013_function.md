---
source_id: K013
title: 函数定义与调用
module: Python基础
difficulty: basic
prerequisites: [K002, K006, K007]
keywords: [函数, def, 调用, 复用, function]
---

# K013 函数定义与调用

## 1. 核心定义

def 用于定义函数。

## 2. 必须掌握

- def 用于定义函数。
- 函数把可复用逻辑封装成命名代码块。
- 调用函数时会执行函数体中的代码。

## 3. 示例

### 封装求平均分函数

```python
def average(scores):
    return sum(scores) / len(scores)
print(average([80, 90, 75]))
```

函数把可复用逻辑封装起来，调用时执行函数体。

## 4. 常见错误

- 把概念记成语法碎片，不结合实际任务使用。
- 生成内容时不标注 source_id 与 fact_id，导致后续无法审核。

## 5. 实操任务

- 定义求和函数
- 调用函数输出结果

## 6. 分阶测试题

- Level 1: 定义函数使用哪个关键字？
- Level 2: 请完成一个与“函数定义与调用”相关的小练习。

## 7. 可引用事实

- F001: def 用于定义函数。
- F002: 函数把可复用逻辑封装成命名代码块。
- F003: 调用函数时会执行函数体中的代码。
