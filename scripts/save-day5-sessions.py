#!/usr/bin/env python
"""Day5 1号收尾：把每组学习者的 session + events 按组归类保存到 runs/。"""
import json
import glob
import os
import shutil

RUNS_DIR = ".tmp/competition-sprint/day5-metrics/runs"
SESSIONS_DIR = ".tmp/integrated-orchestrator/sessions"
RAW = os.path.join(RUNS_DIR, "learners-run-raw.json")


def main():
    data = json.load(open(RAW, encoding="utf-8"))
    results = data["results"]
    saved = []
    for r in results:
        name = r["name"]
        learner_id = r.get("learner_id")
        if not learner_id:
            print(f"[跳过] {name}: 无 learner_id")
            continue
        # 找对应的 session 文件
        match = None
        for f in glob.glob(os.path.join(SESSIONS_DIR, "*.json")):
            s = json.load(open(f, encoding="utf-8"))
            if (s.get("learner_request") or {}).get("learner_id") == learner_id:
                match = f
                break
        if not match:
            print(f"[跳过] {name}: 找不到 session 文件 (learner_id={learner_id})")
            continue
        group_dir = os.path.join(RUNS_DIR, name)
        os.makedirs(group_dir, exist_ok=True)
        session = json.load(open(match, encoding="utf-8"))
        # 保存完整 session（含 events）
        shutil.copy2(match, os.path.join(group_dir, "session.json"))
        # 单独提取 events 保存
        events = session.get("events") or []
        with open(os.path.join(group_dir, "events.json"), "w", encoding="utf-8") as f:
            json.dump(events, f, ensure_ascii=False, indent=2)
        # 保存一个简要摘要（便于快速查看）
        profile = session.get("profile") or {}
        summary = {
            "name": name,
            "learner_id": learner_id,
            "session_id": session.get("session_id"),
            "status": session.get("status"),
            "round_no": session.get("round_no"),
            "self_rating": (session.get("learner_request") or {}).get("self_rating"),
            "goal": (session.get("learner_request") or {}).get("goal"),
            "profile_level": profile.get("level"),
            "known_concepts": profile.get("known_concepts"),
            "weak_concepts": profile.get("weak_concepts"),
            "path_node_count": len((session.get("formal_path") or {}).get("nodes") or []),
            "decision_action": ((session.get("feedback") or {}).get("final_decision") or {}).get("action"),
            "events_count": len(events),
            "blocked_reason": session.get("blocked_reason"),
        }
        with open(os.path.join(group_dir, "summary.json"), "w", encoding="utf-8") as f:
            json.dump(summary, f, ensure_ascii=False, indent=2)
        saved.append(name)
        print(f"[保存] {name}: session.json + events.json ({len(events)}个事件) + summary.json → runs/{name}/")

    print(f"\n共保存 {len(saved)} 组: {saved}")


if __name__ == "__main__":
    main()
