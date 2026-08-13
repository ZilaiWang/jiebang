---
source_id: K016
title: 异常处理
module: Python基础
difficulty: intermediate
prerequisites: [K006]
keywords: [异常, 报错, try, except, 错误处理]
---

# K016 异常处理

## 1. 核心定义

try/except 用于捕获并处理运行时异常。

## 2. 必须掌握

- try/except 用于捕获并处理运行时异常。
- 异常处理可以避免程序因可预期错误直接终止。
- except 分支应针对具体错误给出处理逻辑。

## 3. 示例

### 处理数字转换异常

```python
user_input = input("请输入成绩：")
try:
    score = int(user_input)
    if score >= 60:
        print("及格")
    else:
        print("不及格")
except ValueError:
    print("输入无效，请输入数字。")
```

当用户输入非数字字符串时，int() 抛出 ValueError，被 except 捕获后给出友好提示而不是程序崩溃。

### 处理文件操作异常

```python
filename = input("请输入文件名：")
try:
    with open(filename, "r", encoding="utf-8") as f:
        print(f.read())
except FileNotFoundError:
    print("文件不存在，请检查文件名。")
except PermissionError:
    print("没有权限读取该文件。")
```

针对不同类型的异常分别处理，比捕获所有异常更精确。

## 4. 常见错误

- except 后面不写具体异常类型（裸 except），会捕获所有异常包括 KeyboardInterrupt 和 SystemExit，导致程序无法正常中断。
- try 块太大，把不相干可能出错的代码也包进去，难以定位问题来源。
- 在 except 块中直接 pass 忽略异常，导致错误隐含不报难以调试。

## 5. 实操任务

- 读取用户输入的数字并做除法，捕获除零和类型错误
- 处理文件读取时可能出现的各种异常

## 6. 分阶测试题

- Level 1: 如果 try 块中没有抛出异常，except 块会执行吗？（A. 会  B. 不会  C. 看情况  D. 报错）
- Level 2: 写一个 safe_divide(a, b) 函数，返回 a/b 的结果，如果 b 为 0 则返回"除数不能为0"。

## 7. 可引用事实

- F001: try/except 用于捕获并处理运行时异常。
- F002: 异常处理可以避免程序因可预期错误直接终止。
- F003: except 分支应针对具体错误给出处理逻辑。
