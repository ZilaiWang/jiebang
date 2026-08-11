# PY033 time 与 datetime 基础

- 模块：Python程序设计
- 难度：basic

## 可审核事实
- PY033:F001 — datetime 可表示日期和时间。
- PY033:F002 — datetime.now 可获取当前日期时间。
- PY033:F003 — strftime 可把日期时间格式化为字符串。

## 教学示例

```python
from datetime import datetime

now = datetime.now()
print(now.strftime("%Y-%m-%d"))
```

datetime.now è·åå½åæ¶é´ï¼strftime ææå®æ ¼å¼è¾åºæ¥æå­ç¬¦ä¸²ã

## 练习任务
- 获取当前日期并格式化输出
- 说明 datetime 和字符串日期的区别

## 题目种子
- `choice`：获取当前日期时间常用哪个调用？（答案：datetime.now()；引用：PY033:F002）
- `short_answer`：strftime 的作用是什么？（答案：strftime 可把日期时间格式化为字符串。；引用：PY033:F003）
- `debugging`：判断正误：datetime 不能表示日期。（答案：错误。datetime 可表示日期和时间。；引用：PY033:F001）
- `practice`：写代码输出今天的年月日字符串。（答案：能使用 datetime.now 和 strftime。；引用：PY033:F003）
