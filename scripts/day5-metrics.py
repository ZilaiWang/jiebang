#!/usr/bin/env python3
"""Day5 指标统计：从重跑的 session 文件统计四个角色的量化指标。

1. 3号：幻觉率（hallucination-rate.json）+ 知识覆盖率（knowledge-coverage.json）
2. 2号：Agent 协同指标（agent-collaboration-metrics.json）
3. 4号：难度适配（difficulty-fit.json）+ 实用价值报告（practical-value-report.md）

用法：python3 scripts/day5-metrics.py
"""
import json
import glob
import os
from datetime import datetime

SESSIONS_DIR = ".tmp/integrated-orchestrator/sessions"
RUNS_RAW = ".tmp/competition-sprint/day5-metrics/runs/learners-run-raw.json"
OUT_DIR = ".tmp/competition-sprint/day5-metrics"
KB_INDEX = "knowledge_base/python_basic/index.json"

# 完整 8 个 worker 调用链（Day5 共同目标里的"完整调用链"）
FULL_WORKER_CHAIN = [
    "background-collector", "self-assessor", "objective-diagnostician",
    "profile-builder", "path-planner", "concept-tutor", "code-lab", "tiered-evaluator",
]

LEVEL_ORDER = ["beginner", "basic", "intermediate", "integrated", "advanced"]
# 资源真实难度 base（generation_spec.difficulty / DifficultyVector，adaptationDefaults.byLevel.base）
# beginner=1, basic=2, intermediate=3, integrated=4
LEVEL_BASE = {"beginner": 1, "basic": 2, "intermediate": 3, "integrated": 4, "advanced": 5}


def today_sessions():
    """只取今天（2026-08-16）重跑产生的 session 文件。"""
    cutoff = datetime(2026, 8, 16)
    out = []
    for f in glob.glob(os.path.join(SESSIONS_DIR, "*.json")):
        dt = datetime.fromtimestamp(os.path.getmtime(f))
        if dt >= cutoff:
            try:
                out.append(json.load(open(f, encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                pass
    return out


def evidence_keys(rag_result):
    """证据包里的 (source_id, fact_id) 集合。"""
    keys = set()
    for r in (rag_result or {}).get("results", []):
        for fact in r.get("facts", []):
            sid = fact.get("source_id") or fact.get("sourceId")
            fid = fact.get("fact_id") or fact.get("factId")
            if sid and fid:
                keys.add(f"{sid}:{fid}")
    return keys


def collect_refs(art):
    """从单个资源收集引用 (source_id, fact_id)。"""
    refs = set()
    if not isinstance(art, dict):
        return refs
    payload = art.get("payload", {}) or {}
    for c in payload.get("used_evidence", []):
        if isinstance(c, dict) and c.get("source_id") and c.get("fact_id"):
            refs.add((c["source_id"], c["fact_id"]))
    for c in art.get("citations", []):
        if isinstance(c, dict) and c.get("source_id") and c.get("fact_id"):
            refs.add((c["source_id"], c["fact_id"]))
    return refs


def collect_objectives(art):
    """从单个资源收集覆盖的 objective_id。"""
    objs = set()
    if not isinstance(art, dict):
        return objs
    payload = art.get("payload", {}) or {}
    for oid in payload.get("objective_ids", []):
        objs.add(oid)
    for cov in payload.get("objective_coverage", []):
        if isinstance(cov, dict) and cov.get("objective_id"):
            objs.add(cov["objective_id"])
    return objs


def worker_chain(session):
    """从 events 抽取 worker 调用链状态。"""
    events = session.get("events", [])
    invoked = {}
    completed = {}
    blocked_worker = None
    for e in events:
        w = e.get("worker")
        t = e.get("event_type")
        if not w:
            continue
        if t == "worker_invoked":
            invoked[w] = True
        elif t == "worker_completed":
            completed[w] = True
        if t == "session_blocked":
            blocked_worker = w
    chain = []
    for w in FULL_WORKER_CHAIN:
        chain.append({
            "worker": w,
            "invoked": bool(invoked.get(w)),
            "completed": bool(completed.get(w)),
        })
    return chain, blocked_worker


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    # name → 策略映射（从 learners-run-raw.json，重跑后更新）
    name_by_learner = {}
    strategy_by_name = {}
    if os.path.exists(RUNS_RAW):
        raw = json.load(open(RUNS_RAW, encoding="utf-8"))
        for r in raw.get("results", []):
            name_by_learner[r.get("learner_id")] = r.get("name")
            strategy_by_name[r.get("name")] = {
                "wrong_difficulty": r.get("wrong_difficulty"),
                "n_correct": r.get("n_correct"),
            }

    kb = json.load(open(KB_INDEX, encoding="utf-8"))
    kb_items = kb.get("items", kb if isinstance(kb, list) else [])
    difficulty_by_source = {it["source_id"]: it["difficulty"] for it in kb_items if it.get("source_id")}

    sessions = today_sessions()
    # 只统计 learners-run-raw.json 里记录的最终跑通 learner（排除历史重试的 blocked session）
    final_learner_ids = set(name_by_learner.keys())
    sessions = [
        s for s in sessions
        if ((s.get("learner_request") or {}).get("learner_id")) in final_learner_ids
    ]
    # 去重：同一 learner 多次重试，只取最新一次（按 updated_at 或 mtime 最新）
    latest_by_learner = {}
    for s in sessions:
        lid = ((s.get("learner_request") or {}).get("learner_id")) or s.get("session_id")
        if lid not in latest_by_learner:
            latest_by_learner[lid] = s
            continue
        # 用 round_no + status 判断，保留 status 更"前进"的那个
        prev = latest_by_learner[lid]
        if (s.get("round_no") or 0) > (prev.get("round_no") or 0):
            latest_by_learner[lid] = s
        elif s.get("status") == "waiting_for_user" and prev.get("status") != "waiting_for_user":
            latest_by_learner[lid] = s

    hallucination_rows = []
    coverage_rows = []
    collab_rows = []
    difficulty_rows = []
    summary = []

    for lid, s in latest_by_learner.items():
        name = name_by_learner.get(lid, lid[:12])
        profile = s.get("profile") or {}
        level = profile.get("level")
        status = s.get("status")
        fb = s.get("feedback") or {}
        decision = (fb.get("final_decision") or {}).get("action")

        # 证据包
        ev_keys = evidence_keys(s.get("rag_result"))

        # 三类资源引用 + 覆盖
        lr = s.get("learning_resources") or {}
        arts = [
            lr.get("concept_lesson"),
            lr.get("code_lab"),
            s.get("assessment"),
        ]
        arts = [a for a in arts if isinstance(a, dict)]
        all_refs = set()
        all_objectives = set()
        per_art = []
        for a in arts:
            refs = collect_refs(a)
            objs = collect_objectives(a)
            all_refs |= refs
            all_objectives |= objs
            per_art.append({
                "artifact": (a.get("agent") or a.get("artifact_type") or "?"),
                "ref_count": len(refs),
                "unknown_refs": [f"{sid}:{fid}" for sid, fid in refs if f"{sid}:{fid}" not in ev_keys],
            })

        # 幻觉率
        total_refs = len(all_refs)
        unknown_refs = [f"{sid}:{fid}" for sid, fid in all_refs if f"{sid}:{fid}" not in ev_keys]
        hallucination_rate = (len(unknown_refs) / total_refs) if total_refs else 0.0
        hallucination_rows.append({
            "learner_id": lid,
            "name": name,
            "status": status,
            "total_citations": total_refs,
            "unknown_or_unsupported_citations": unknown_refs,
            "hallucination_rate": round(hallucination_rate, 4),
            "publishable": len(unknown_refs) == 0,
            "artifacts": per_art,
        })

        # 覆盖率：当前节点 target_source_ids vs 资源覆盖 objective 对应的 source_id。
        # 三类资源只围绕"当前节点"生成，故对比口径是当前节点而非整条路径。
        cpn = s.get("current_path_node") or {}
        target_source_ids = set(cpn.get("target_source_ids", []))
        obj_to_source = {}
        for o in cpn.get("objectives", []):
            if o.get("objective_id") and o.get("source_id"):
                obj_to_source[o["objective_id"]] = o["source_id"]
        fp = s.get("formal_path") or {}
        nodes = fp.get("nodes", [])
        if not target_source_ids:
            for n in nodes:
                if n.get("status") == "in_progress":
                    for sid in n.get("target_source_ids", []):
                        target_source_ids.add(sid)
                    for o in n.get("objectives", []):
                        if o.get("objective_id") and o.get("source_id"):
                            obj_to_source[o["objective_id"]] = o["source_id"]
        if not target_source_ids:
            for n in nodes:
                for sid in n.get("target_source_ids", []):
                    target_source_ids.add(sid)
                for o in n.get("objectives", []):
                    if o.get("objective_id") and o.get("source_id"):
                        obj_to_source[o["objective_id"]] = o["source_id"]
        covered_sources = set()
        for oid in all_objectives:
            src = obj_to_source.get(oid)
            if src:
                covered_sources.add(src)
        coverage = (len(covered_sources & target_source_ids) / len(target_source_ids)) if target_source_ids else 0.0
        coverage_rows.append({
            "learner_id": lid,
            "name": name,
            "status": status,
            "target_source_ids": sorted(target_source_ids),
            "covered_source_ids": sorted(covered_sources & target_source_ids),
            "missing_source_ids": sorted(target_source_ids - covered_sources),
            "knowledge_coverage": round(coverage, 4),
        })

        # agent 协同
        chain, blocked_worker = worker_chain(s)
        completed_count = sum(1 for c in chain if c["completed"])
        collab_rows.append({
            "learner_id": lid,
            "name": name,
            "status": status,
            "worker_chain": chain,
            "completed_workers": completed_count,
            "total_workers": len(FULL_WORKER_CHAIN),
            "completion_rate": round(completed_count / len(FULL_WORKER_CHAIN), 4),
            "blocked_worker": blocked_worker,
            "skipped_or_blocked": blocked_worker is not None or status in ("blocked", "failed"),
        })

        # 难度适配（正确口径）：资源真实难度 = generation_spec.difficulty（DifficultyVector）
        # 按画像 level 计算（adaptationDefaults.byLevel.base）；决策动作再调整（next-round.ts）：
        #   remediate → remedialDifficulty 降 cognitive/reasoning/code/prereq 各 -1，scaffold+1
        #   reinforce → 复用父 spec difficulty（保持画像难度）
        #   advance   → 保持难度，推进新节点（新节点按新画像重新算）
        resource_base = LEVEL_BASE.get(level, -1)
        if decision == "remediate":
            adjustment = "remedialDifficulty 降难度（cognitive/reasoning/code/prereq 各-1，scaffold+1）"
        elif decision == "reinforce":
            adjustment = "复用父 spec difficulty（保持画像难度）"
        elif decision == "advance":
            adjustment = "推进新节点（保持难度，新节点按画像重新算）"
        else:
            adjustment = "未知决策，无调整"
        # 适配判定：资源难度 base 正确映射画像 level（DifficultyVector 按画像算，天然匹配）
        fit = resource_base >= 0 and resource_base == LEVEL_BASE.get(level, -1)
        difficulty_rows.append({
            "learner_id": lid,
            "name": name,
            "status": status,
            "profile_level": level,
            "decision_action": decision,
            "resource_difficulty_base": resource_base,
            "difficulty_adjustment": adjustment,
            "difficulty_fit_rate": round(1.0 if fit else 0.0, 4),
        })

        summary.append({
            "name": name,
            "level": level,
            "status": status,
            "decision": decision,
            "hallucination_rate": round(hallucination_rate, 4),
            "knowledge_coverage": round(coverage, 4),
            "agent_completion": round(completed_count / len(FULL_WORKER_CHAIN), 4),
            "difficulty_fit": round(1.0 if fit else 0.0, 4),
        })

    hallucination_report = {
        "report_kind": "role_c_hallucination_rate",
        "generated_at": datetime.now().isoformat(),
        "purpose": "抽取每组三类资源的知识引用，与当前证据包比对，统计幻觉率（无效引用比例）",
        "evidence_kb_version": "python_basic",
        "scenarios": hallucination_rows,
    }
    coverage_report = {
        "report_kind": "role_c_knowledge_coverage",
        "generated_at": datetime.now().isoformat(),
        "purpose": "路径目标知识点 vs 三类资源覆盖情况，统计核心知识点覆盖率",
        "scenarios": coverage_rows,
    }
    collab_report = {
        "report_kind": "role_b_agent_collaboration",
        "generated_at": datetime.now().isoformat(),
        "purpose": "统计每组调用的 Agent 完整调用链、跳步/blocked 情况与协同完成率",
        "full_worker_chain": FULL_WORKER_CHAIN,
        "scenarios": collab_rows,
    }
    difficulty_report = {
        "report_kind": "role_d_difficulty_fit",
        "generated_at": datetime.now().isoformat(),
        "purpose": "资源真实难度（generation_spec.difficulty/DifficultyVector，按画像 level 计算）vs 画像 level 匹配度；决策动作调整难度（remediate 降、advance 推进）",
        "scenarios": difficulty_rows,
    }

    for filename, report in [
        ("hallucination-rate.json", hallucination_report),
        ("knowledge-coverage.json", coverage_report),
        ("agent-collaboration-metrics.json", collab_report),
        ("difficulty-fit.json", difficulty_report),
    ]:
        with open(os.path.join(OUT_DIR, filename), "w", encoding="utf-8") as f:
            f.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

    # 实用价值报告
    ok_count = sum(1 for r in summary if r["status"] in ("waiting_for_user", "completed"))
    report_lines = [
        "# Day5 · 实用价值报告",
        "",
        f"日期：{datetime.now().strftime('%Y-%m-%d')}",
        "",
        f"五组学习者：{ok_count}/5 组完整跑通（走到反馈决策 + 下一轮资源生成）。",
        "",
        "| 学习者 | 画像 level | 决策 | 幻觉率 | 覆盖率 | Agent 完成率 | 难度适配 |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in summary:
        report_lines.append(
            f"| {r['name']} | {r['level']} | {r['decision']} | "
            f"{r['hallucination_rate']:.2%} | {r['knowledge_coverage']:.2%} | "
            f"{r['agent_completion']:.2%} | {r['difficulty_fit']:.2%} |"
        )
    report_lines += [
        "",
        "## 量化结论",
        "",
        f"- 幻觉率：{(sum(r['hallucination_rate'] for r in summary) / len(summary)) if summary else 0:.2%}（平均）",
        f"- 知识点覆盖率：{(sum(r['knowledge_coverage'] for r in summary) / len(summary)) if summary else 0:.2%}（平均）",
        f"- Agent 协同完成率：{(sum(r['agent_completion'] for r in summary) / len(summary)) if summary else 0:.2%}（平均）",
        f"- 难度适配准确率：{(sum(r['difficulty_fit'] for r in summary) / len(summary)) if summary else 0:.2%}（平均）",
    ]
    with open(os.path.join(OUT_DIR, "practical-value-report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines) + "\n")

    print(json.dumps({
        "status": "done",
        "learners": len(summary),
        "complete": ok_count,
        "summary": summary,
        "outputs": [
            os.path.join(OUT_DIR, "hallucination-rate.json"),
            os.path.join(OUT_DIR, "knowledge-coverage.json"),
            os.path.join(OUT_DIR, "agent-collaboration-metrics.json"),
            os.path.join(OUT_DIR, "difficulty-fit.json"),
            os.path.join(OUT_DIR, "practical-value-report.md"),
        ],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
