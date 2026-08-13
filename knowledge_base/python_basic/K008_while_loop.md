---
source_id: K008
title: while 循环
module: Python基础
difficulty: beginner
prerequisites: [K006]
keywords: [while, 循环, 条件循环, 重复执行]
---

# K008 while 循环

## 1. 核心定义

while 会在条件为 True 时重复执行代码块。

## 2. 必须掌握

- while 会在条件为 True 时重复执行代码块。
- while 循环必须更新循环条件以避免死循环。
- while 适合重复次数不确定但停止条件明确的任务。

## 3. 示例

### 从 1 数到 5

```python
count = 1
while count <= 5:
    print("第", count, "次")
    count = count + 1
```

每次循环把 count 加 1，直到 count > 5 时条件为 False 退出。

### 直到输入正确密码

```python
password = ""
while password != "abc123":
    password = input("请输入密码：")
print("登录成功！")
```

循环持续要求输入，直到用户输入正确密码，属于"重复次数不确定但终止条件明确"的典型场景。

## 4. 常见错误

- 忘记在循环体内更新循环变量（如漏写 count = count + 1），导致条件永远为 True 形成死循环。
- 初始条件直接为 False 导致循环体一次都不执行，误以为 while 会至少执行一次。

## 5. 实操任务

- 用 while 从 1 打印到 5
- 用 while 实现"猜数字"游戏：程序想一个 1-100 的数，用户猜直到猜对

## 6. 分阶测试题

- Level 1: 以下哪段代码会导致死循环？（A. while False: print(1)  B. while True: break  C. x=0; while x<5: x+=1  D. x=5; while x>0: print(x)）
- Level 2: 用 while 循环计算 1 到 100 的和。

## 7. 可引用事实

- F001: while 会在条件为 True 时重复执行代码块。
- F002: while 循环必须更新循环条件以避免死循环。
- F003: while 适合重复次数不确定但停止条件明确的任务。
