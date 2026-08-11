# PY026 lambda 与排序键

- 模块：Python程序设计
- 难度：intermediate
- 摘要：lambda 可定义简短的匿名函数。

## 可审核事实
- PY026:F001 — lambda 可定义简短的匿名函数。
- PY026:F002 — sorted 的 key 参数可指定排序时使用的比较依据。
- PY026:F003 — lambda 常与 sorted 的 key 参数配合完成简单排序。

## 教学示例

### 按成绩排序学生记录

```python
students = [("小明", 92), ("小红", 85), ("小刚", 98)]
ordered = sorted(students, key=lambda item: item[1], reverse=True)
print(ordered)
```

lambda item: item[1] 指定按元组中的成绩排序，reverse=True 表示降序。

## 练习任务
- 按学生成绩从高到低排序
- 用 sorted 的 key 参数按字符串长度排序

## 题目种子
- L1 `choice`：sorted 的 key 参数主要用于什么？（答案：指定排序依据；引用：PY026:F002）
- L2 `short_answer`：为什么 lambda 常用于简单排序任务？（答案：lambda 可定义简短匿名函数，常与 sorted 的 key 参数配合。；引用：PY026:F003）
- L2 `debugging`：判断正误：sorted 的 key 参数不能和 lambda 配合使用。（答案：错误。lambda 常与 sorted 的 key 参数配合完成简单排序。；引用：PY026:F003）
- L3 `practice`：给定学生元组列表，按第二个元素成绩降序排序。（答案：能使用 sorted(data, key=lambda item: item[1], reverse=True)。；引用：PY026:F002）
