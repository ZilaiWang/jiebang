---
source_id: K010
title: 字典
module: Python基础
difficulty: basic
prerequisites: [K002, K003]
keywords: [字典, dict, 键值对, 姓名, 查成绩, 映射]
---

# K010 字典

## 1. 核心定义

字典使用键值对保存数据。

## 2. 必须掌握

- 字典使用键值对保存数据。
- 字典适合根据唯一键快速查找对应值。
- 可以用 dict[key] 访问指定键的值。

## 3. 示例

### 建立学生成绩字典

```python
scores = {"小明": 92, "小红": 85, "小刚": 78}
print("小红的成绩：", scores["小红"])

scores["小刚"] = 82  # 修改成绩
scores["小丽"] = 95   # 新增学生
print("全部成绩：", scores)
```

字典用姓名做键（key）、成绩做值（value），通过键快速查找对应值。

### 遍历字典

```python
scores = {"小明": 92, "小红": 85, "小刚": 78}
total = 0
for name, score in scores.items():
    print(name, ":", score)
    total += score
print("平均分：", total / len(scores))
```

.items() 同时取出键和值，适合批量处理字典内容。

## 4. 常见错误

- 访问不存在的键（如 scores["小王"]）直接导致 KeyError，应先用 in 判断或使用 .get()。
- 混淆字典和列表：字典用花括号 {} 但内容为 key:value 对，列表用方括号 []。

## 5. 实操任务

- 建立姓名到成绩的字典
- 根据姓名查询成绩，处理查不到的情况

## 6. 分阶测试题

- Level 1: 访问字典中不存在的键会引发什么错误？（A. ValueError  B. TypeError  C. KeyError  D. IndexError）
- Level 2: 给定 scores = {"小明": 92, "小红": 85}，写代码查找"小刚"的成绩，如果不存在输出"未找到"。

## 7. 可引用事实

- F001: 字典使用键值对保存数据。
- F002: 字典适合根据唯一键快速查找对应值。
- F003: 可以用 dict[key] 访问指定键的值。
