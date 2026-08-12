#!/usr/bin/env python
"""Day1 4号：用 L1（林晓·零基础·for循环）跑真实闭环，输出 learner-beginner-input.json。

按 1号 Day1 实际学习者描述：完全没接触过 Python；每周 5 小时；目标 for 循环；零基础入门。
self_rating=new；节点 PY-CH02-S02（1号路由脚本同款 for 循环节点）。
"""
from __future__ import annotations
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:8787"
LEARNER = "learner-demo-beginner-001"
GOAL = "学习 Python for 循环"
BACKGROUND = "姓名：林晓；学习背景：零基础入门；每周预计学习：5小时；Python基础：new；偏好：balanced；其他编程语言：无"
NODE = "PY-CH02-S02"
OUT = Path("D:/the latest D/.tmp/competition-sprint/day1-closed-loop/learner-beginner-input.json")


def request(path: str, body=None, timeout=900):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method="POST" if data else "GET")
    req.add_header("Authorization", f"Bearer {LEARNER}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code}: {error.read().decode('utf-8', 'replace')}") from error


def complete_function_from_starter(starter: str, prompt: str) -> str:
    """P7 合规：基于 starter 骨架补全完整函数定义（含 def 行）。"""
    if not starter or "def " not in starter:
        return "def solve(data):\n    return data\n"
    lines = starter.splitlines()
    # 找到 def 行和参数
    def_line = next((l for l in lines if "def " in l), "def solve(data):")
    # 根据题目语义生成实现
    if "sum_1_to_10" in starter or "计算 1 到 10 的和" in prompt or "range" in prompt and "求和" in prompt:
        body = "    total = 0\n    for i in range(1, 11):\n        total += i\n    return total"
    elif "print_list" in starter or "遍历列表" in prompt or "打印每个元素" in prompt:
        body = "    for item in numbers:\n        print(item)"
    else:
        body = "    return data"
    return f"{def_line}\n{body}\n"


def main():
    record = {"learner_id": LEARNER, "goal": GOAL, "background": BACKGROUND, "node": NODE}
    # 1) 创建会话
    created = request("/orchestrator/sessions", {
        "mode": "deterministic",
        "learner_request": {
            "learner_id": LEARNER,
            "goal": GOAL,
            "background": BACKGROUND,
            "self_rating": "new",
            "learning_goal_spec": {"mode": "curriculum_node", "selected_node_ids": [NODE]},
        },
    }, timeout=60)
    session_id = created["session_id"]
    record["session_id"] = session_id
    record["created_status"] = created.get("status")

    # 2) 诊断答题（零基础学习者：全部选第一项）
    diag_items = (created.get("waiting_for") or {}).get("items") or []
    record["diagnosis_questions"] = [
        {"item_id": it["item_id"], "question": it.get("question"), "options": it.get("options")}
        for it in diag_items
    ]
    diag_answers = {}
    for it in diag_items:
        opts = it.get("options") or []
        q = it.get("question") or ""
        # 按 1号/2号 已验证的正确诊断答案作答（零基础学习者：诊断全对，画像正常）
        correct = opts[0] if opts else "0"
        if "for 循环最适合" in q:
            correct = "遍历序列"
        elif "变量赋值" in q:
            correct = "="
        elif '"95"' in q:
            correct = "str"
        diag_answers[it["item_id"]] = correct
    record["diagnosis_answers"] = diag_answers
    diagnosed = request(f"/orchestrator/sessions/{session_id}/commands", {
        "command_id": f"day1-4-diagnose-{uuid.uuid4().hex}",
        "type": "submit_diagnosis_answers",
        "payload": {"answers": diag_answers},
    })
    # 提交诊断后主 Agent 后台生成资源；轮询直到 waiting_for 变为 assessment_answers 或 blocked
    diag_deadline = time.time() + 600
    while time.time() < diag_deadline:
        if diagnosed.get("status") == "blocked":
            break
        if (diagnosed.get("waiting_for") or {}).get("type") == "assessment_answers":
            break
        time.sleep(4)
        diagnosed = request(f"/orchestrator/sessions/{session_id}", timeout=30)
    record["post_diagnosis_status"] = diagnosed.get("status")
    record["blocked_reason"] = diagnosed.get("blocked_reason")
    if diagnosed.get("status") == "blocked":
        record["stage"] = "blocked_at_generation"
        record["profile"] = None
        record["final"] = {"status": "blocked", "reason": diagnosed.get("blocked_reason")}
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"status": "blocked", "reason": diagnosed.get("blocked_reason")}, ensure_ascii=False))
        return 2
    if (diagnosed.get("waiting_for") or {}).get("type") != "assessment_answers":
        record["final"] = {"status": diagnosed.get("status"), "waiting": (diagnosed.get("waiting_for") or {}).get("type")}
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(record["final"], ensure_ascii=False))
        return 3

    # 3) 画像与路径（诊断后返回）
    record["profile"] = (diagnosed.get("profile") or {}).get("public") or diagnosed.get("profile")
    record["formal_path"] = {
        "original_goal": (diagnosed.get("formal_path") or {}).get("original_goal"),
        "nodes": [
            {"node_id": n.get("node_id"), "title": n.get("title"), "status": n.get("status")}
            for n in ((diagnosed.get("formal_path") or {}).get("nodes") or [])
        ],
    }

    # 4) 正式测评答题（零基础 low：代码题只给 pass，选择题第一项）
    assess_items = (diagnosed.get("waiting_for") or {}).get("items") or []
    record["assessment_questions"] = [
        {
            "item_id": it["item_id"],
            "modality": it.get("modality"),
            "question": it.get("prompt") or it.get("question"),
            "options": it.get("options"),
            "starter_code": it.get("starter_code"),
        }
        for it in assess_items
    ]
    answers = []
    for it in assess_items:
        opts = it.get("options") or []
        if opts:
            # mcq：选第一个选项（真实学习者行为，不保证全对）
            first = opts[0]
            answers.append({"item_id": it["item_id"], "selected_option_id": first.get("option_id", "") if isinstance(first, dict) else first, "hint_level_used": 0})
        elif it.get("modality") == "code":
            # P7 教训：提交完整函数（保留 starter 的 def 行，替换 pass 为真实实现）
            starter = it.get("starter_code") or ""
            code = complete_function_from_starter(starter, it.get("prompt") or "")
            answers.append({"item_id": it["item_id"], "code_response": code, "hint_level_used": 0})
        else:
            # trace：写出可提交的文本答案
            answers.append({"item_id": it["item_id"], "text_response": "apple\nbanana\ncherry", "hint_level_used": 0})
    record["assessment_answers"] = answers
    submitted = request(f"/orchestrator/sessions/{session_id}/commands", {
        "command_id": f"day1-4-assess-{uuid.uuid4().hex}",
        "type": "submit_assessment_answers",
        "payload": {"answers": answers},
    })

    # 5) 轮询直到出现评分反馈（feedback）或 blocked
    deadline = time.time() + 600
    latest = submitted
    while time.time() < deadline:
        if latest.get("status") == "blocked":
            break
        if (latest.get("feedback") or {}).get("final_decision"):
            break
        time.sleep(4)
        latest = request(f"/orchestrator/sessions/{session_id}", timeout=30)

    record["feedback"] = (latest.get("feedback") or {}).get("public") or latest.get("feedback")
    record["final"] = {
        "status": latest.get("status"),
        "stage": latest.get("current_stage"),
        "round": latest.get("round_no"),
        "waiting_for": (latest.get("waiting_for") or {}).get("type"),
        "decision": ((latest.get("feedback") or {}).get("final_decision") or {}).get("action"),
        "raw_score": ((latest.get("feedback") or {}).get("grade_result") or {}).get("payload", {}).get("raw_score"),
        "blocked_reason": latest.get("blocked_reason"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(record["final"], ensure_ascii=False))
    return 0 if latest.get("status") in {"waiting_for_user", "completed"} else 3


if __name__ == "__main__":
    raise SystemExit(main())
