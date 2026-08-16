#!/usr/bin/env python
"""从 session 文件提取陈昊、李强的跑通结果，更新五组汇总 learners-run-raw.json。"""
import json

RAW = ".tmp/competition-sprint/day5-metrics/runs/learners-run-raw.json"
SESSION_MAP = {
    "陈昊": ".tmp/integrated-orchestrator/sessions/SESSION-dbc1bb62-b544-435d-9cae-0913c5388355.json",
    "李强": ".tmp/integrated-orchestrator/sessions/SESSION-5c535738-9c4d-47ac-a122-125822a1b18f.json",
}
N_CORRECT = {"陈昊": 3, "李强": 5}


def extract(name, path, n_correct):
    d = json.load(open(path, encoding="utf-8"))
    lr = d.get("learner_request") or {}
    profile = d.get("profile") or {}
    decision = (d.get("feedback") or {}).get("final_decision") or {}
    nra = d.get("next_round_action") or {}
    adapt = d.get("adaptation") or {}
    path_nodes = [
        {"node_id": n.get("node_id"), "status": n.get("status"), "title": n.get("title")}
        for n in ((d.get("formal_path") or {}).get("nodes") or [])
    ]
    return {
        "learner_id": lr.get("learner_id"),
        "archetype": lr.get("self_rating"),
        "goal": lr.get("goal"),
        "status": d.get("status"),
        "round": d.get("round_no"),
        "wrong_difficulty": None,
        "n_correct": n_correct,
        "profile": {
            "level": profile.get("level"),
            "known_concepts": profile.get("known_concepts"),
            "weak_concepts": profile.get("weak_concepts"),
        },
        "path_nodes": path_nodes,
        "decision_action": decision.get("action"),
        "next_round_action": nra.get("action"),
        "adaptation": adapt.get("adaptation_action"),
        "blocked_reason": d.get("blocked_reason"),
    }


def main():
    data = json.load(open(RAW, encoding="utf-8"))
    for i, r in enumerate(data["results"]):
        name = r["name"]
        if name in SESSION_MAP:
            extracted = extract(name, SESSION_MAP[name], N_CORRECT[name])
            extracted["name"] = name
            extracted["attempts"] = 2 if name == "陈昊" else 1
            data["results"][i] = extracted
    json.dump(data, open(RAW, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("更新完成，五组最终状态：")
    for r in data["results"]:
        p = r.get("profile") or {}
        print(f"  {r['name']}: status={r.get('status')} level={p.get('level')} decision={r.get('decision_action')}")


if __name__ == "__main__":
    main()
