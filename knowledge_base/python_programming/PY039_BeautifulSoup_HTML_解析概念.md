# PY039 BeautifulSoup HTML 解析概念

- 模块：Python程序设计
- 难度：intermediate

## 可审核事实
- PY039:F001 — HTML 解析用于从网页文本中提取结构化信息。
- PY039:F002 — BeautifulSoup 是 Python 中常见的 HTML 解析工具之一。
- PY039:F003 — 解析网页时通常需要先获取 HTML 文本再查找目标标签。

## 教学示例

```python
from bs4 import BeautifulSoup

html = "<h1>æ é¢</h1><p>æ­£æ</p>"
soup = BeautifulSoup(html, "html.parser")
print(soup.find("h1").text)
```

BeautifulSoup æ HTML ææ¬è§£ææå¯æ¥è¯¢å¯¹è±¡ï¼find å¯æ¥æ¾ç®æ æ ç­¾ã

## 练习任务
- 从 HTML 中提取标题文本
- 说明获取 HTML 和解析 HTML 的先后关系

## 题目种子
- `choice`：HTML 解析的主要目标是什么？（答案：提取结构化信息；引用：PY039:F001）
- `short_answer`：解析网页前通常需要先做什么？（答案：通常需要先获取 HTML 文本再查找目标标签。；引用：PY039:F003）
- `debugging`：判断正误：BeautifulSoup 是常见的 HTML 解析工具之一。（答案：正确。BeautifulSoup 是 Python 中常见的 HTML 解析工具之一。；引用：PY039:F002）
- `practice`：描述从网页 HTML 中提取 h1 文本的步骤。（答案：能说明获取 HTML、构造 BeautifulSoup、查找标签。；引用：PY039:F003）
