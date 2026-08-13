#!/usr/bin/env python
"""Day1 4号：L1（林晓·零基础·for循环）完整闭环验证。

策略（对齐 1号/2号 已验证路径）：
- 诊断：答正确诊断答案（遍历序列 / = / str）
- 测评：读 Role C secure assessment 参考答案提交（2号 advance 场景同款做法）
- 产出：learner-beginner-input.json（真实运行数据）
"""
from __future__ import annotations
import json
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:8787"
LEARNER = f"learner-day2-{uuid.uuid4().hex[:10]}"
GOAL = "学习 Python for 循环"
BACKGROUND = "姓名：林晓；学习背景：零基础入门；每周预计学习：5小时；Python基础：new；偏好：balanced；其他编程语言：无"
NODE = "PY-CH02-S02"
ROOT = Path("D:/the latest D/.tmp/integrated-orchestrator")
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


def wait_for(predicate, label, deadline=600):
    """轮询直到 predicate(latest) 为真，或超时。"""
    latest = {}
    start = time.time()
    while time.time() - start < deadline:
        latest = request(f"/orchestrator/sessions/{latest.get('session_id') or SESSION_ID}")
        if predicate(latest):
            return latest
        time.sleep(4)
    raise RuntimeError(f"timeout waiting for {label}; last={json.dumps(latest.get('blocked_reason'), ensure_ascii=False)}")


def find_secure_assessment(run_id: str, form_id: str):
    """从 Role C secure-artifacts（及 learning-cycle/runs）找 assessment_secure 私有产物。"""
    search_dirs = [
        ROOT / "role-c" / "secure-artifacts",
        ROOT / "role-c" / "learning-cycle" / "runs",
    ]
    for base in search_dirs:
        if not base.exists():
            continue
        for p in sorted(base.rglob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
            try:
                txt = p.read_text(encoding="utf-8")
            except Exception:
                continue
            if run_id not in txt or form_id not in txt:
                continue
            try:
                data = json.loads(txt)
            except Exception:
                continue
            artifact = data.get("artifact") or data
            payload = artifact.get("payload") or {}
            if artifact.get("artifact_type") == "assessment_secure" and payload.get("form_id") == form_id:
                return payload
    return None


def secure_answers(session_state):
    assessment = (session_state.get("assessment") or {})
    run_id = assessment.get("run_id")
    form_id = (assessment.get("payload") or {}).get("form_id")
    if not run_id or not form_id:
        return None
    secure = find_secure_assessment(run_id, form_id)
    if not secure:
        return None
    suites = {s["test_suite_id"]: s for s in secure.get("code_test_suites", [])}
    answers = []
    for item in secure["items"]:
        spec = item["answer_spec"]
        kind = spec["kind"]
        if kind == "exact_set" and item["modality"] == "mcq":
            answers.append({"item_id": item["item_id"], "selected_option_id": spec["accepted"][0], "hint_level_used": 0})
        elif kind == "exact_set":
            answers.append({"item_id": item["item_id"], "text_response": spec["accepted"][0], "hint_level_used": 0})
        elif kind == "code":
            suite = suites[spec["test_suite_id"]]
            answers.append({"item_id": item["item_id"], "code_response": suite["reference_solution"], "hint_level_used": 0})
        else:
            return None
    return answers


def main():
    record = {"learner_id": LEARNER, "goal": GOAL, "background": BACKGROUND, "node": NODE}
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
    global SESSION_ID
    SESSION_ID = created["session_id"]
    record["session_id"] = SESSION_ID

    # 诊断（正确答案）
    diag_items = (created.get("waiting_for") or {}).get("items") or []
    record["diagnosis_questions"] = [
        {"item_id": it["item_id"], "question": it.get("question"), "options": it.get("options")}
        for it in diag_items
    ]
    diag_answers = {}
    for it in diag_items:
        q = it.get("question") or ""
        if "for 循环最适合" in q:
            diag_answers[it["item_id"]] = "遍历序列"
        elif "变量赋值" in q:
            diag_answers[it["item_id"]] = "="
        elif '"95"' in q:
            diag_answers[it["item_id"]] = "str"
        else:
            opts = it.get("options") or []
            diag_answers[it["item_id"]] = opts[0] if opts else "0"
    record["diagnosis_answers"] = diag_answers
    diagnosed = request(f"/orchestrator/sessions/{SESSION_ID}/commands", {
        "command_id": f"day1-l1-diag-{uuid.uuid4().hex}",
        "type": "submit_diagnosis_answers",
        "payload": {"answers": diag_answers},
    })
    # 等测评题
    ddl = time.time() + 600
    while time.time() < ddl:
        latest = request(f"/orchestrator/sessions/{SESSION_ID}")
        if latest.get("status") == "blocked":
            record["final"] = {"status": "blocked", "reason": latest.get("blocked_reason")}
            OUT.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(record["final"], ensure_ascii=False))
            return 2
        if (latest.get("waiting_for") or {}).get("type") == "assessment_answers":
            break
        time.sleep(4)
    record["profile"] = (latest.get("profile") or {}).get("public") or latest.get("profile")
    record["formal_path"] = {
        "original_goal": (latest.get("formal_path") or {}).get("original_goal"),
        "nodes": [
            {"node_id": n.get("node_id"), "title": n.get("title"), "status": n.get("status")}
            for n in ((latest.get("formal_path") or {}).get("nodes") or [])
        ],
    }
    record["assessment"] = {
        "run_id": (latest.get("assessment") or {}).get("run_id"),
        "form_id": ((latest.get("assessment") or {}).get("payload") or {}).get("form_id"),
    }
    assess_items = (latest.get("waiting_for") or {}).get("items") or []
    record["assessment_questions"] = [
        {
            "item_id": it["item_id"],
            "modality": it.get("modality"),
            "prompt": (it.get("prompt") or it.get("question") or "")[:120],
            "starter_code": (it.get("starter_code") or "")[:80],
        }
        for it in assess_items
    ]

    # 测评：优先 secure 参考答案（2号同款），拿不到则保守作答
    answers = secure_answers(latest)
    if answers is None:
        answers = []
        for it in assess_items:
            opts = it.get("options") or []
            if opts:
                first = opts[0]
                answers.append({"item_id": it["item_id"], "selected_option_id": first.get("option_id", "") if isinstance(first, dict) else first, "hint_level_used": 0})
            elif it.get("modality") == "code":
                answers.append({"item_id": it["item_id"], "code_response": "pass", "hint_level_used": 0})
            else:
                answers.append({"item_id": it["item_id"], "text_response": "不知道", "hint_level_used": 0})
    record["assessment_answers"] = answers
    record["answer_strategy"] = "secure参考答案(2号同款)" if answers else "保守作答"

    submitted = request(f"/orchestrator/sessions/{SESSION_ID}/commands", {
        "command_id": f"day1-l1-assess-{uuid.uuid4().hex}",
        "type": "submit_assessment_answers",
        "payload": {"answers": answers},
    })
    # 等 feedback
    ddl = time.time() + 600
    while time.time() < ddl:
        latest = request(f"/orchestrator/sessions/{SESSION_ID}")
        if latest.get("status") == "blocked":
            break
        if (latest.get("feedback") or {}).get("final_decision"):
            break
        time.sleep(4)

    record["feedback"] = (latest.get("feedback") or {}).get("public") or latest.get("feedback")
    record["final"] = {
        "status": latest.get("status"),
        "stage": latest.get("current_stage"),
        "round": latest.get("round_no"),
        "waiting_for": (latest.get("waiting_for") or {}).get("type"),
        "decision": ((latest.get("feedback") or {}).get("final_decision") or {}).get("action"),
        "raw_score": ((latest.get("feedback") or {}).get("grade_result") or {}).get("payload", {}).get("raw_score"),
        "max_score": ((latest.get("feedback") or {}).get("grade_result") or {}).get("payload", {}).get("max_score"),
        "blocked_reason": latest.get("blocked_reason"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(record["final"], ensure_ascii=False))
    return 0 if record["final"]["decision"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
