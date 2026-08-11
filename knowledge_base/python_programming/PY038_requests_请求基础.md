# PY038 requests 请求基础

- 模块：Python程序设计
- 难度：intermediate

## 可审核事实
- PY038:F001 — requests 可用于发送 HTTP 请求。
- PY038:F002 — GET 请求常用于获取网页或接口数据。
- PY038:F003 — 响应状态码可用于判断请求是否成功。

## 教学示例

```python
import requests

response = requests.get("https://example.com")
print(response.status_code)
print(response.text[:50])
```

requests.get åé GET è¯·æ±ï¼status_code å¯æ¥çååºç¶æç ã

## 练习任务
- 发送 GET 请求并查看状态码
- 说明状态码为什么能帮助判断请求结果

## 题目种子
- `choice`：GET 请求常用于什么？（答案：获取网页或接口数据；引用：PY038:F002）
- `short_answer`：响应状态码有什么作用？（答案：响应状态码可用于判断请求是否成功。；引用：PY038:F003）
- `debugging`：判断正误：requests 不能发送 HTTP 请求。（答案：错误。requests 可用于发送 HTTP 请求。；引用：PY038:F001）
- `practice`：写出发送网页 GET 请求并打印状态码的代码思路。（答案：能使用 requests.get 和 status_code。；引用：PY038:F001）
