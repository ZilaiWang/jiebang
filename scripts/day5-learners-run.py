#!/usr/bin/env python
"""Day5 1号任务：跑五组学习者，精确控制诊断答错难度 + 测评准确率，让决策动作分层。

五组自评 vs 客观模式（用户指定）：
1. 林晓 new          → 相仿（客观 beginner）
2. 陈昊 beginner      → 客观高于自评（全对→basic）
3. 张伟 intermediate  → 相仿（答错 integrated→intermediate）
4. 王芳 intermediate  → 客观低于自评（答错 beginner→beginner）
5. 李强 advanced      → 相仿（全对→integrated）

决策动作阈值（dynamic-feedback）：
  accuracy < 0.4 → remediate；0.4-0.8 → reinforce；>= 0.8 → advance

测评题分值（5题，总10分）：tier1 mcq 1分×2，tier2 tf 2分×2，tier3 mcq 4分×1
按"答对前 N 题"控制得分：
  林晓 n_correct=1 → 1分=10% → remediate
  张伟 n_correct=4 → 6分=60% → reinforce
  王芳 n_correct=5 → 10分=100% → advance
"""
from __future__ import annotations
import json
import time
import urllib.error
import urllib.request
import uuid
import os
import glob

BASE = "http://127.0.0.1:8787"
LEARNERS_FILE = ".tmp/competition-sprint/day0-precheck/learners.json"
SESSIONS_DIR = ".tmp/integrated-orchestrator/sessions"
SECURE_DIR = ".tmp/integrated-orchestrator/role-c/secure-artifacts"
OUT = ".tmp/competition-sprint/day5-metrics/runs/learners-run-raw.json"

# 五组策略：wrong_difficulty 控制画像 level，n_correct 控制测评答对题数（决策动作）
STRATEGY = {
    "林晓": {"wrong_difficulty": "beginner", "n_correct": 1},    # 相仿，10%→remediate
    "陈昊": {"wrong_difficulty": None, "n_correct": 3},          # 客观高于自评（code-lab 死结）
    "张伟": {"wrong_difficulty": "integrated", "n_correct": 4},  # 相仿，60%→reinforce
    "王芳": {"wrong_difficulty": "beginner", "n_correct": 5},    # 客观低于自评，100%→advance
    "李强": {"wrong_difficulty": None, "n_correct": 5},          # 相仿（code-lab 死结）
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


def read_secure_correct_options(session_id):
    """读测评正确答案：从 session 文件的 assessment.run_id 匹配 secure 文件，返回 {item_id: correct_option_id}。"""
    session_path = os.path.join(SESSIONS_DIR, f"{session_id}.json")
    try:
        d = json.load(open(session_path, encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    run_id = ((d.get("assessment") or {}).get("run_id")) or ""
    prefix = run_id.rsplit("-R", 1)[0] if run_id else ""
    if not prefix:
        return {}
    for f in glob.glob(os.path.join(SECURE_DIR, "*", "*.json")):
        try:
            s = json.load(open(f, encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if s.get("artifact_type") != "assessment_secure":
            continue
        art = s.get("artifact") or {}
        if not (art.get("run_id") or "").startswith(prefix):
            continue
        items = (art.get("payload") or {}).get("items", [])
        return {it.get("item_id"): it.get("correct_option_id") for it in items if it.get("correct_option_id")}
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


def build_assessment_answers(items, correct_map, n_correct):
    """精确控制测评：答对前 n_correct 题（提交正确 option_id），其余答错。"""
    answers = []
    for i, item in enumerate(items):
        iid = item["item_id"]
        options = item.get("options") or []
        correct_opt = correct_map.get(iid)
        if i < n_correct and correct_opt:
            answers.append({"item_id": iid, "selected_option_id": correct_opt, "hint_level_used": 0})
        else:
            wrong = next((o.get("option_id") for o in options if o.get("option_id") != correct_opt),
                         (options[0].get("option_id") if options else ""))
            answers.append({"item_id": iid, "selected_option_id": wrong, "hint_level_used": 0})
    return answers


def run_learner(learner_req, wrong_difficulty, n_correct):
    learner_id = f"day5-{uuid.uuid4().hex[:10]}"
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
    correct_map = read_secure_correct_options(session_id)
    assess_answers = build_assessment_answers(assess_items, correct_map, n_correct)
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
        "wrong_difficulty": wrong_difficulty, "n_correct": n_correct,
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
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    data = json.load(open(LEARNERS_FILE, encoding="utf-8"))
    learners = data["learners"]
    targets = os.environ.get("TARGET_NAMES", "").strip()
    if targets:
        target_set = {t.strip() for t in targets.split(",") if t.strip()}
        learners = [l for l in learners if l.get("name") in target_set]
        print(f"只跑: {[l.get('name') for l in learners]}")
    results = []
    for l in learners:
        name = l.get("name")
        lr = l["learner_request"]
        rating = lr.get("self_rating", "beginner")
        s = STRATEGY.get(name, {"wrong_difficulty": None, "n_correct": 3})
        wrong = s["wrong_difficulty"]
        n_correct = s["n_correct"]
        r = None
        for attempt in range(1, 7):
            print(f"[跑] {name} ({rating}) 答错难度={wrong} 答对题数={n_correct} 第{attempt}次", flush=True)
            try:
                r = run_learner(lr, wrong, n_correct)
            except Exception as e:
                r = {"learner_id": lr.get("learner_id"), "archetype": rating, "error": str(e)}
            prof = r.get("profile", {}) or {}
            print(f"  -> status={r.get('status')} level={prof.get('level')} "
                  f"known={len(prof.get('known_concepts') or [])} weak={len(prof.get('weak_concepts') or [])} "
                  f"decision={r.get('decision_action')}", flush=True)
            # 完整跑通 = waiting_for_user（等待下一轮）或 completed（学完）
            if r.get("status") in ("waiting_for_user", "completed"):
                break
        r["name"] = name
        r["attempts"] = attempt
        results.append(r)
    out = {"workflow": "Day5_Learner_Runs", "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "results": results}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n=== 完整结果 ===")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
