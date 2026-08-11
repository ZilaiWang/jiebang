# PY034 GUI 基础概念

- 模块：Python程序设计
- 难度：intermediate

## 可审核事实
- PY034:F001 — GUI 程序通过窗口、按钮等控件与用户交互。
- PY034:F002 — 事件处理用于响应用户点击等操作。
- PY034:F003 — tkinter 是 Python 常见的图形界面库之一。

## 教学示例

```python
import tkinter as tk

def greet():
    label.config(text="ä½ å¥½")

window = tk.Tk()
label = tk.Label(window, text="ç­å¾ç¹å»")
button = tk.Button(window, text="é®å", command=greet)
```

çªå£ãæ ç­¾åæé®æ¯å¸¸è§æ§ä»¶ï¼command ç»å®ç¹å»åçå¤çå½æ°ã

## 练习任务
- 说明按钮点击为什么需要事件处理
- 识别窗口、标签、按钮三个控件

## 题目种子
- `choice`：GUI 程序主要通过什么与用户交互？（答案：窗口和控件；引用：PY034:F001）
- `short_answer`：事件处理的作用是什么？（答案：事件处理用于响应用户点击等操作。；引用：PY034:F002）
- `debugging`：判断正误：GUI 程序不需要响应用户操作。（答案：错误。GUI 程序通常通过事件处理响应用户操作。；引用：PY034:F002）
- `practice`：描述一个按钮点击后改变文本的 GUI 流程。（答案：能说明窗口、按钮、事件处理函数之间的关系。；引用：PY034:F001）
