# PY037 wordcloud 词云概念

- 模块：Python程序设计
- 难度：intermediate

## 可审核事实
- PY037:F001 — 词云可用不同大小的文字展示词频高低。
- PY037:F002 — wordcloud 是 Python 中常见的词云生成工具之一。
- PY037:F003 — 生成词云前通常需要准备词语及其频率。

## 教学示例

```python
from wordcloud import WordCloud

freq = {"Python": 5, "æ°æ®": 3, "å­¦ä¹ ": 2}
wc = WordCloud(width=400, height=200).generate_from_frequencies(freq)
```

generate_from_frequencies æ ¹æ®è¯é¢å­å¸çæè¯äºå¯¹è±¡ã

## 练习任务
- 说明词云中文字大小和词频的关系
- 准备一个词频字典用于生成词云

## 题目种子
- `choice`：词云通常用什么表现词频高低？（答案：文字大小；引用：PY037:F001）
- `short_answer`：生成词云前通常需要准备什么？（答案：通常需要准备词语及其频率。；引用：PY037:F003）
- `debugging`：判断正误：词云不能用于文本可视化。（答案：错误。词云是一种文本可视化方式。；引用：PY037:F001）
- `practice`：给出一个可用于生成词云的词频字典。（答案：能构造词语到频率的映射。；引用：PY037:F003）
