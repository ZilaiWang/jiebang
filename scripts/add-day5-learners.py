#!/usr/bin/env python
"""补充两个学习者到 learners.json：画像冲突学习者 + 基础较强学习者。"""
import json

LEARNERS_FILE = ".tmp/competition-sprint/day0-precheck/learners.json"

# L4 画像冲突学习者：自评 intermediate（说有基础），客观诊断全错（实际基础差）
L4 = {
    "profile_id": "L4_conflict_wangfang",
    "name": "王芳",
    "archetype": "画像冲突学习者",
    "learner_request": {
        "learner_id": "learner-demo-conflict-004",
        "goal": "学习 Python 文件读写",
        "background": "姓名：王芳；学习背景：自学过一点 Python，自评有基础；每周预计学习：6小时；Python基础：intermediate；偏好：balanced；其他编程语言：无",
        "self_rating": "intermediate",
        "learning_goal_spec": {"mode": "curriculum_node", "selected_node_ids": ["PY-CH04-S04"]},
    },
    "expected_evidence": {
        "background": {
            "evidence_type": "background",
            "learner_id": "learner-demo-conflict-004",
            "education_context": "自学过一点 Python",
            "prior_languages": [],
            "prior_topics": [],
            "goal_raw": "学习 Python 文件读写",
            "time_budget": "6 小时/周",
            "quotes": [{"field": "education_context", "text": "自学过一点 Python"}],
        },
        "self_assessment": {
            "evidence_type": "self_assessment",
            "self_rating": "intermediate",
            "claimed_known": ["变量与赋值", "基本数据类型", "for 循环"],
            "claimed_weak": [],
            "quotes": [{"field": "claimed_known", "text": "基础语法我都会"}],
        },
        "objective_diagnosis": {
            "evidence_type": "objective_diagnosis",
            "items": [
                {"source_id": "K002", "fact_id": None, "question": "以下哪个语句能创建一个变量？", "learner_answer": "错误的答案", "verdict": "incorrect", "concept": "变量与赋值", "difficulty": "beginner"},
                {"source_id": "K003", "fact_id": None, "question": "3.14 属于哪种数据类型？", "learner_answer": "错误的答案", "verdict": "incorrect", "concept": "基本数据类型", "difficulty": "beginner"},
                {"source_id": "K007", "fact_id": None, "question": "for 循环打印 0-4 用什么？", "learner_answer": "错误的答案", "verdict": "incorrect", "concept": "for 循环", "difficulty": "beginner"},
                {"source_id": "K015", "fact_id": None, "question": "读取文件全部内容用什么？", "learner_answer": "错误的答案", "verdict": "incorrect", "concept": "文件读写", "difficulty": "intermediate"},
            ],
            "quotes": [],
        },
    },
    "expected_profile": {
        "learner_id": "learner-demo-conflict-004",
        "level": "beginner",
        "known_concepts": [],
        "weak_concepts": ["变量与赋值", "基本数据类型", "for 循环", "文件读写"],
        "goal": "学习 Python 文件读写",
        "ability_dimensions": [
            {"label": "概念理解", "value": 0.2},
            {"label": "代码认知", "value": 0.2},
            {"label": "诊断表现", "value": 0.15},
        ],
    },
    "note": "自评 intermediate（说有基础），但客观诊断连 beginner 题都答错 → 触发画像冲突/reprofile",
}

# L5 基础较强学习者：自评 advanced（基础强），客观诊断全对（确实强）
L5 = {
    "profile_id": "L5_advanced_liqiang",
    "name": "李强",
    "archetype": "基础较强学习者",
    "learner_request": {
        "learner_id": "learner-demo-advanced-005",
        "goal": "用 Python 完成一个成绩统计器综合项目",
        "background": "姓名：李强；学习背景：计算机相关专业，有 Java 基础；每周预计学习：10小时；Python基础：advanced；偏好：project；其他编程语言：Java",
        "self_rating": "advanced",
        "learning_goal_spec": {"mode": "curriculum_node", "selected_node_ids": ["PY-CH04-S03"]},
    },
    "expected_evidence": {
        "background": {
            "evidence_type": "background",
            "learner_id": "learner-demo-advanced-005",
            "education_context": "计算机相关专业，有 Java 基础",
            "prior_languages": ["Java"],
            "prior_topics": ["变量与赋值", "for 循环", "列表", "函数定义与调用"],
            "goal_raw": "用 Python 完成一个成绩统计器综合项目",
            "time_budget": "10 小时/周",
            "quotes": [{"field": "education_context", "text": "有 Java 基础"}],
        },
        "self_assessment": {
            "evidence_type": "self_assessment",
            "self_rating": "advanced",
            "claimed_known": ["变量与赋值", "基本数据类型", "for 循环", "列表", "函数定义与调用"],
            "claimed_weak": [],
            "quotes": [{"field": "claimed_known", "text": "基础语法和函数都熟练"}],
        },
        "objective_diagnosis": {
            "evidence_type": "objective_diagnosis",
            "items": [
                {"source_id": "K002", "fact_id": None, "question": "以下哪个语句能创建一个变量？", "learner_answer": "x = 5", "verdict": "correct", "concept": "变量与赋值", "difficulty": "beginner"},
                {"source_id": "K007", "fact_id": None, "question": "for 循环打印 0-4 用什么？", "learner_answer": "range(5)", "verdict": "correct", "concept": "for 循环", "difficulty": "beginner"},
                {"source_id": "K009", "fact_id": None, "question": "给列表追加元素用什么？", "learner_answer": "scores.append(78)", "verdict": "correct", "concept": "列表", "difficulty": "basic"},
                {"source_id": "K013", "fact_id": None, "question": "def 定义函数后怎么调用？", "learner_answer": "函数名加括号", "verdict": "correct", "concept": "函数定义与调用", "difficulty": "basic"},
                {"source_id": "K018", "fact_id": None, "question": "统计成绩平均分需要哪些步骤？", "learner_answer": "读取、求和、除以数量", "verdict": "correct", "concept": "成绩统计器综合项目", "difficulty": "integrated"},
            ],
            "quotes": [],
        },
    },
    "expected_profile": {
        "learner_id": "learner-demo-advanced-005",
        "level": "integrated",
        "known_concepts": ["变量与赋值", "基本数据类型", "for 循环", "列表", "函数定义与调用"],
        "weak_concepts": [],
        "goal": "用 Python 完成一个成绩统计器综合项目",
        "ability_dimensions": [
            {"label": "概念理解", "value": 0.95},
            {"label": "代码认知", "value": 0.9},
            {"label": "诊断表现", "value": 1.0},
        ],
    },
    "note": "自评 advanced（基础强），客观诊断全对（确实强）→ 画像 integrated",
}


def main():
    data = json.load(open(LEARNERS_FILE, encoding="utf-8"))
    existing_ids = {l["profile_id"] for l in data["learners"]}
    added = []
    for new in (L4, L5):
        if new["profile_id"] in existing_ids:
            print(f"跳过（已存在）: {new['profile_id']}")
            continue
        data["learners"].append(new)
        added.append(new["profile_id"])
    with open(LEARNERS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"追加 {len(added)} 个学习者: {added}")
    print(f"当前学习者总数: {len(data['learners'])}")
    for l in data["learners"]:
        print(f"  - {l['name']} ({l['archetype']}) self_rating={l['learner_request']['self_rating']}")


if __name__ == "__main__":
    main()
