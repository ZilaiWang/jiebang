#!/usr/bin/env python
"""Real KnowBalance main-Agent learning-loop verification.

Runs create -> diagnosis -> first assessment -> async poll. It never reads
Role C secure answers. Choose answer behavior with --answer-mode.
"""
from __future__ import annotations
import argparse
import json
import time
import urllib.error
import urllib.request
import uuid


def request(base: str, learner: str, path: str, body=None, timeout=900):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base + path, data=data, method="POST" if data else "GET")
    req.add_header("Authorization", f"Bearer {learner}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code}: {error.read().decode('utf-8', 'replace')}") from error


def public_answers(items, mode):
    answers = []
    for index, item in enumerate(items):
        options = item.get("options") or []
        if options:
            pick = options[0] if mode != "medium" or index % 2 == 0 else options[-1]
            option_id = pick.get("option_id", "") if isinstance(pick, dict) else pick
            answers.append({"item_id": item["item_id"], "selected_option_id": option_id, "hint_level_used": 0})
        elif item.get("modality") == "code":
            code = item.get("starter_code") or "pass"
            if mode == "low":
                code = "pass"
            answers.append({"item_id": item["item_id"], "code_response": code, "hint_level_used": 0})
        else:
            answers.append({"item_id": item["item_id"], "text_response": "0", "hint_level_used": 0})
    return answers


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8787")
    parser.add_argument("--goal", default="学习列表")
    parser.add_argument("--node", default="PY-CH03-S01")
    parser.add_argument("--answer-mode", choices=("low", "medium", "public-first"), default="low")
    parser.add_argument("--poll-timeout", type=int, default=900)
    args = parser.parse_args()
    learner = f"verify-loop-{uuid.uuid4().hex[:10]}"
    created = request(args.base, learner, "/orchestrator/sessions", {
        "mode": "deterministic",
        "learner_request": {
            "learner_id": learner,
            "goal": args.goal,
            "background": "真实完整链路验证",
            "self_rating": "beginner",
            "learning_goal_spec": {"mode": "curriculum_node", "selected_node_ids": [args.node]},
        },
    }, timeout=60)
    session_id = created["session_id"]
    diagnosis_items = (created.get("waiting_for") or {}).get("items") or []
    diagnosis_answers = {}
    for item in diagnosis_items:
        options = item.get("options") or []
        first = options[0] if options else "0"
        diagnosis_answers[item["item_id"]] = first.get("option_id", "") if isinstance(first, dict) else first
    diagnosed = request(args.base, learner, f"/orchestrator/sessions/{session_id}/commands", {
        "command_id": f"diagnose-{uuid.uuid4().hex}",
        "type": "submit_diagnosis_answers",
        "payload": {"answers": diagnosis_answers},
    })
    if diagnosed.get("status") == "blocked":
        print(json.dumps({"session": session_id, "stage": "first_generation", "status": "blocked", "reason": diagnosed.get("blocked_reason")}, ensure_ascii=False))
        return 2
    assessment_items = (diagnosed.get("waiting_for") or {}).get("items") or []
    submitted = request(args.base, learner, f"/orchestrator/sessions/{session_id}/commands", {
        "command_id": f"assess-{uuid.uuid4().hex}",
        "type": "submit_assessment_answers",
        "payload": {"answers": public_answers(assessment_items, args.answer_mode)},
    })
    deadline = time.time() + args.poll_timeout
    latest = submitted
    while latest.get("status") == "running" and time.time() < deadline:
        time.sleep(4)
        latest = request(args.base, learner, f"/orchestrator/sessions/{session_id}", timeout=30)
    result = {
        "session": session_id,
        "learner": learner,
        "status": latest.get("status"),
        "round": latest.get("round_no"),
        "waiting": (latest.get("waiting_for") or {}).get("type"),
        "decision": ((latest.get("feedback") or {}).get("final_decision") or {}).get("action"),
        "adaptation": (latest.get("adaptation") or {}).get("adaptation_action"),
        "blocked_reason": latest.get("blocked_reason"),
        "path_nodes": [(node.get("node_id"), node.get("status")) for node in ((latest.get("formal_path") or {}).get("nodes") or [])],
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if latest.get("status") in {"waiting_for_user", "completed"} else 3


if __name__ == "__main__":
    raise SystemExit(main())
