---
source_id: K004
title: 输入输出
module: Python基础
difficulty: beginner
prerequisites: [K002, K003]
keywords: [input, print, 输入, 输出, 交互]
---

# K004 输入输出

## 1. 核心定义

print 用于向屏幕输出内容。

## 2. 必须掌握

- print 用于向屏幕输出内容。
- input 用于读取用户输入并返回字符串。
- 需要数值计算时应把 input 结果转换为数字类型。

## 3. 示例

### 读取姓名并输出问候

```python
name = input("请输入你的姓名：")
print("你好，" + name + "！欢迎来到Python学习。")
```

input 读取用户输入，print 把拼接后的问候语输出到屏幕。

### 读取数字并计算和

```python
a = input("请输入第一个数：")
b = input("请输入第二个数：")
total = int(a) + int(b)
print("两数之和为：", total)
```

input 返回字符串，int() 转换后才能做算术运算。

## 4. 常见错误

- 忘记用 int() 把 input 结果转数字就做加法，导致字符串拼接而非数值求和。
- print 多个值时忘记用逗号分隔，误用 + 拼接非字符串类型导致 TypeError。

## 5. 实操任务

- 读取姓名并输出欢迎语
- 读取两个数字并输出和

## 6. 分阶测试题

- Level 1: input 函数返回的数据类型是什么？（A. int  B. float  C. str  D. bool）
- Level 2: 写一段代码：读取用户输入的两个数字，输出它们的乘积。

## 7. 可引用事实

- F001: print 用于向屏幕输出内容。
- F002: input 用于读取用户输入并返回字符串。
- F003: 需要数值计算时应把 input 结果转换为数字类型。
