---
source_id: K014
title: 参数与返回值
module: Python基础
difficulty: basic
prerequisites: [K013]
keywords: [参数, 返回值, return, 函数输入, 函数输出]
---

# K014 参数与返回值

## 1. 核心定义

参数用于把外部数据传入函数。

## 2. 必须掌握

- 参数用于把外部数据传入函数。
- return 用于把函数结果返回给调用者。
- 没有显式 return 的函数默认返回 None。

## 3. 示例

### 带参数和返回值的成绩处理函数

```python
def calc_average(scores):
    total = sum(scores)
    count = len(scores)
    return total / count

def get_grade(score):
    if score >= 90:
        return "优秀"
    elif score >= 60:
        return "及格"
    else:
        return "不及格"

avg = calc_average([85, 92, 78, 95])
print("平均分：", avg)
print("等级：", get_grade(avg))
```

calc_average 接收成绩列表作为参数，用 return 返回平均分；get_grade 根据分数返回等级。return 让调用者获得函数结果。

### 无 return 的函数

```python
def show_info(name, score):
    print(name + "的成绩是：" + str(score))

result = show_info("小明", 92)
print("返回值：", result)  # 输出 None
```

没有 return 语句的函数默认返回 None。

## 4. 常见错误

- 定义函数时写了参数但调用时忘记传参，导致 TypeError。
- 函数内处理了结果但忘记写 return，调用方得到 None 而非预期值。
- return 之后的代码不会执行，误把代码写在 return 后。

## 5. 实操任务

- 写一个带参数的求平均值函数
- 判断函数返回值类型

## 6. 分阶测试题

- Level 1: 函数没有写 return 语句时，调用后得到什么？（A. None  B. 0  C. 报错  D. 最后一个表达式的值）
- Level 2: 写一个函数 calc(scores)，接收成绩列表，返回最高分、最低分和平均分三个值。

## 7. 可引用事实

- F001: 参数用于把外部数据传入函数。
- F002: return 用于把函数结果返回给调用者。
- F003: 没有显式 return 的函数默认返回 None。
