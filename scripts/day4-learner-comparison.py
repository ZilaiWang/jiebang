#!/usr/bin/env python
"""Day4 4号：跑三组学习者，精确控制诊断答错难度，让 level/画像/路径/决策分层。

level 判定规则（profile-synthesizer.resolveLevel）：
- 答错某难度题 → level 封顶到该难度前一档（floor=beginner）
- 全对(>=3题) → 自评基础上最多上调一档（不超过答对最高难度）
- 否则用自评；都没有则默认 beginner

动态筛题使不同自评拿到不同难度题：
- new: 全 beginner
- beginner: 含 basic
- intermediate: 含 integrated

三组设计（体现三种自评/客观关系）：
- 陈昊 beginner 全对 → 上调 basic（超自评）
- 张伟 intermediate 答错 basic → 封顶 beginner（低于自评）
- 林晓 new 答错 beginner → beginner（与自评一致）
"""
from __future__ import annotations
import json
import time
import urllib.error
import urllib.request
import uuid
import os

BASE = "http://127.0.0.1:8787"
LEARNERS_FILE = ".tmp/competition-sprint/day0-precheck/learners.json"
SESSIONS_DIR = ".tmp/integrated-orchestrator/sessions"
OUT = ".tmp/competition-sprint/day4-dynamic-decision/learner-comparison-raw.json"

# 三组答错策略：wrong_difficulty=None 表示全对；否则答错第一道该难度的题
STRATEGY = {
    "new": {"wrong_difficulty": "beginner", "assess_mode": "low"},
    "beginner": {"wrong_difficulty": None, "assess_mode": "medium"},
    "intermediate": {"wrong_difficulty": "basic", "assess_mode": "public-first"},
}


def request(learner: str, path: str, body=None, timeout=900):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method="POST" if data else "GET")
    req.add_header("Authorization", f"Bearer {learner}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code}: {error.read().decode('utf-8', 'replace')}") from error


def read_answer_key(session_id, items, retries=10):
    """读诊断正确答案；session_id 本身已带 SESSION- 前缀，文件名就是 {session_id}.json。"""
    path = os.path.join(SESSIONS_DIR, f"{session_id}.json")
    expected_ids = {item["item_id"] for item in items}
    for _ in range(retries):
        if os.path.exists(path):
            try:
                d = json.load(open(path, encoding="utf-8"))
                ak = (d.get("private") or {}).get("diagnosis_answer_key") or {}
                if ak and expected_ids.issubset(ak.keys()):
                    return ak
            except (json.JSONDecodeError, OSError):
                pass
        time.sleep(0.5)
    return {}


def build_diagnosis_answers(items, answer_key, wrong_difficulty):
    """精确控制：wrong_difficulty=None 全对；否则答错第一道该难度的题，其余答对。"""
    answers = {}
    wrong_idx = None
    if wrong_difficulty:
        for i, item in enumerate(items):
            if item.get("difficulty") == wrong_difficulty:
                wrong_idx = i
                break
    for i, item in enumerate(items):
        iid = item["item_id"]
        correct = answer_key.get(iid)
        options = item.get("options") or []
        wrong = next((o for o in options if o != correct), options[0] if options else "0")
        if i == wrong_idx:
            answers[iid] = wrong  # 答错
        else:
            answers[iid] = correct if correct else wrong  # 答对
    return answers


def build_assessment_answers(items, assess_mode):
    answers = []
    for item in items:
        if item.get("options"):
            options = item.get("options") or []
            pick = options[0] if assess_mode == "first" else options[-1]
            opt = pick.get("option_id", "") if isinstance(pick, dict) else pick
            answers.append({"item_id": item["item_id"], "selected_option_id": opt, "hint_level_used": 0})
        elif item.get("modality") == "code":
            code = item.get("starter_code") or "pass"
            if assess_mode == "low":
                code = "pass"
            answers.append({"item_id": item["item_id"], "code_response": code, "hint_level_used": 0})
        else:
            answers.append({"item_id": item["item_id"], "text_response": "0", "hint_level_used": 0})
    return answers


def run_learner(learner_req, wrong_difficulty, assess_mode):
    learner_id = f"day4-{uuid.uuid4().hex[:10]}"
    created = request(learner_id, "/orchestrator/sessions", {
        "mode": "deterministic",
        "learner_request": {
            "learner_id": learner_id,
            "goal": learner_req.get("goal"),
            "background": learner_req.get("background"),
            "self_rating": learner_req.get("self_rating"),
            "learning_goal_spec": learner_req.get("learning_goal_spec"),
        },
    }, timeout=60)
    session_id = created["session_id"]
    diag_items = (created.get("waiting_for") or {}).get("items") or []
    answer_key = read_answer_key(session_id, diag_items)
    diag_answers = build_diagnosis_answers(diag_items, answer_key, wrong_difficulty)
    diagnosed = request(learner_id, f"/orchestrator/sessions/{session_id}/commands", {
        "command_id": f"diag-{uuid.uuid4().hex}",
        "type": "submit_diagnosis_answers",
        "payload": {"answers": diag_answers},
    })
    deadline = time.time() + 900
    latest = diagnosed
    while (latest.get("status") == "running"
           and (latest.get("waiting_for") or {}).get("type") != "assessment_answers"
           and time.time() < deadline):
        time.sleep(5)
        latest = request(learner_id, f"/orchestrator/sessions/{session_id}", timeout=30)
    if (latest.get("waiting_for") or {}).get("type") != "assessment_answers":
        return {
            "learner_id": learner_id, "archetype": learner_req.get("self_rating"),
            "status": latest.get("status"), "blocked_reason": latest.get("blocked_reason"),
            "profile": latest.get("profile"), "formal_path": latest.get("formal_path"),
            "next_round_action": latest.get("next_round_action"),
        }
    assess_items = (latest.get("waiting_for") or {}).get("items") or []
    assess_answers = build_assessment_answers(assess_items, assess_mode)
    submitted = request(learner_id, f"/orchestrator/sessions/{session_id}/commands", {
        "command_id": f"assess-{uuid.uuid4().hex}",
        "type": "submit_assessment_answers",
        "payload": {"answers": assess_answers},
    })
    deadline = time.time() + 900
    latest = submitted
    while latest.get("status") == "running" and time.time() < deadline:
        time.sleep(5)
        latest = request(learner_id, f"/orchestrator/sessions/{session_id}", timeout=30)
    profile = latest.get("profile") or {}
    path_nodes = [
        {"node_id": n.get("node_id"), "status": n.get("status"), "title": n.get("title")}
        for n in ((latest.get("formal_path") or {}).get("nodes") or [])
    ]
    decision = ((latest.get("feedback") or {}).get("final_decision") or {})
    nra = latest.get("next_round_action") or {}
    return {
        "learner_id": learner_id, "archetype": learner_req.get("self_rating"),
        "goal": learner_req.get("goal"), "status": latest.get("status"),
        "round": latest.get("round_no"),
        "wrong_difficulty": wrong_difficulty,
        "profile": {
            "level": profile.get("level"),
            "known_concepts": profile.get("known_concepts"),
            "weak_concepts": profile.get("weak_concepts"),
        },
        "path_nodes": path_nodes,
        "decision_action": decision.get("action"),
        "next_round_action": nra.get("action"),
        "adaptation": (latest.get("adaptation") or {}).get("adaptation_action"),
        "blocked_reason": latest.get("blocked_reason"),
    }


def main():
    data = json.load(open(LEARNERS_FILE, encoding="utf-8"))
    learners = data["learners"]
    results = []
    for l in learners:
        lr = l["learner_request"]
        rating = lr.get("self_rating", "beginner")
        s = STRATEGY.get(rating, {"wrong_difficulty": None, "assess_mode": "medium"})
        wrong = s["wrong_difficulty"]
        r = None
        for attempt in range(1, 5):
            print(f"[跑] {l.get('name')} ({rating}) 答错难度={wrong} 第{attempt}次", flush=True)
            try:
                r = run_learner(lr, wrong, s["assess_mode"])
            except Exception as e:
                r = {"learner_id": lr.get("learner_id"), "archetype": rating, "error": str(e)}
            prof = r.get("profile", {}) or {}
            print(f"  -> status={r.get('status')} level={prof.get('level')} "
                  f"known={len(prof.get('known_concepts') or [])} weak={len(prof.get('weak_concepts') or [])} "
                  f"decision={r.get('decision_action')}", flush=True)
            # 第一轮跑通 = 拿到了决策动作（remediate/reinforce/advance/reprofile）
            if r.get("decision_action") or r.get("next_round_action"):
                break
        r["name"] = l.get("name")
        r["attempts"] = attempt
        results.append(r)
    out = {"workflow": "Day4_Learner_Comparison", "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "results": results}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n=== 完整结果 ===")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
