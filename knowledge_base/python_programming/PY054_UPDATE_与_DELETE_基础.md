# PY054 UPDATE 与 DELETE 基础

- 模块：Python程序设计
- 难度：intermediate
- 来源范围：Python程序设计基础教程 / 基于数据库的持久化

## 可审核事实
- PY054:F001 — UPDATE 用于修改已有记录。
- PY054:F002 — DELETE 用于删除已有记录。
- PY054:F003 — UPDATE 和 DELETE 通常应配合 WHERE 条件限定影响范围。

## 教学示例

```python
update_sql = "UPDATE students SET score = ? WHERE name = ?"
delete_sql = "DELETE FROM students WHERE name = ?"
print(update_sql)
print(delete_sql)
```

WHERE 条件限定被更新或删除的学生记录。

## 练习任务
- 写 UPDATE 语句修改指定学生成绩
- 说明 DELETE 为什么通常要加 WHERE

## 题目种子
- `choice`：修改已有记录常用哪个 SQL 关键字？（答案：UPDATE）
- `short_answer`：WHERE 在 UPDATE/DELETE 中有什么作用？（答案：UPDATE 和 DELETE 通常应配合 WHERE 条件限定影响范围。）
- `debugging`：判断正误：DELETE 不需要限定条件也一定安全。（答案：错误。DELETE 通常应配合 WHERE 条件限定影响范围。）
- `practice`：写出按姓名更新学生成绩的 SQL 思路。（答案：能使用 UPDATE SET 和 WHERE 条件。）
