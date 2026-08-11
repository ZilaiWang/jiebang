# PY051 SQLite 数据库连接

- 模块：Python程序设计
- 难度：intermediate
- 来源范围：Python程序设计基础教程 / 基于数据库的持久化

## 可审核事实
- PY051:F001 — SQLite 是轻量级本地数据库，适合入门级持久化练习。
- PY051:F002 — Python 的 sqlite3 模块可通过 connect 打开或创建数据库文件。
- PY051:F003 — 数据库连接使用后应提交事务并关闭连接。

## 教学示例

```python
import sqlite3

conn = sqlite3.connect("students.db")
conn.close()
```

sqlite3.connect 打开或创建 students.db，使用结束后关闭连接。

## 练习任务
- 用 sqlite3.connect 创建本地数据库连接
- 说明数据库连接为什么需要关闭

## 题目种子
- `choice`：sqlite3.connect 的主要作用是什么？（答案：打开或创建 SQLite 数据库连接）
- `short_answer`：为什么连接使用后需要关闭？（答案：数据库连接使用后应提交事务并关闭连接。）
- `debugging`：判断正误：SQLite 只能连接远程服务器。（答案：错误。SQLite 是轻量级本地数据库，适合入门级持久化练习。）
- `practice`：写代码连接 students.db 并关闭连接。（答案：能使用 sqlite3.connect 并调用 close。）
