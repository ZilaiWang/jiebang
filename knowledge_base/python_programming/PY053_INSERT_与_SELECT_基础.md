# PY053 INSERT 与 SELECT 基础

- 模块：Python程序设计
- 难度：intermediate
- 来源范围：Python程序设计基础教程 / 基于数据库的持久化

## 可审核事实
- PY053:F001 — INSERT 用于向表中插入记录。
- PY053:F002 — SELECT 用于从表中查询记录。
- PY053:F003 — 查询结果通常需要逐行读取或遍历处理。

## 教学示例

```python
insert_sql = "INSERT INTO students(name, score) VALUES (?, ?)"
select_sql = "SELECT name, score FROM students"
print(insert_sql)
print(select_sql)
```

INSERT 写入学生成绩，SELECT 查询学生姓名和成绩。

## 练习任务
- 写 INSERT 语句插入学生成绩
- 写 SELECT 语句查询学生成绩

## 题目种子
- `choice`：从数据库表中查询记录常用哪个 SQL 关键字？（答案：SELECT）
- `short_answer`：INSERT 的作用是什么？（答案：INSERT 用于向表中插入记录。）
- `debugging`：判断正误：SELECT 用于删除记录。（答案：错误。SELECT 用于从表中查询记录。）
- `practice`：写出插入并查询 students 表记录的 SQL 思路。（答案：能区分 INSERT 插入和 SELECT 查询。）
