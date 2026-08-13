---
source_id: K005
title: 运算符
module: Python基础
difficulty: beginner
prerequisites: [K003]
keywords: [运算符, 加减乘除, 比较, 逻辑, operator]
---

# K005 运算符

## 1. 核心定义

算术运算符可进行加减乘除等计算。

## 2. 必须掌握

- 算术运算符可进行加减乘除等计算。
- 比较运算符返回布尔值。
- 逻辑运算符 and、or、not 用于组合条件。

## 3. 示例

### 成绩平均分计算

```python
score1 = 85
score2 = 92
score3 = 78
average = (score1 + score2 + score3) / 3
print("平均分：", average)
```

算术运算符 + 和 / 用于计算多名学生成绩的平均分。

### 判断是否及格

```python
score = 73
passed = score >= 60
print("是否及格：", passed)

if passed and score < 90:
    print("已通过，可以继续提升。")
```

比较运算符 >= 判断分数是否及格，逻辑运算符 and 组合多个条件。

## 4. 常见错误

- 混淆 /（真除法，返回浮点数）和 //（整数除法），如 7/2=3.5 但 7//2=3。
- 误用 =（赋值）代替 ==（相等判断）写在 if 条件中。
- and/or/not 优先级理解不清，缺少括号导致条件组合结果不符合预期。

## 5. 实操任务

- 计算表达式结果
- 判断比较表达式真假

## 6. 分阶测试题

- Level 1: Python 中 7 // 2 的结果是？（A. 3.5  B. 3  C. 4  D. 报错）
- Level 2: 写代码判断一个年份是否能被 4 整除且不能被 100 整除（闰年条件）。

## 7. 可引用事实

- F001: 算术运算符可进行加减乘除等计算。
- F002: 比较运算符返回布尔值。
- F003: 逻辑运算符 and、or、not 用于组合条件。
