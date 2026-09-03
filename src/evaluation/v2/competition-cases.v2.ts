import type { ArtifactKind, Difficulty } from "../competition-metrics"
import type { CompetitionProfileFixtureIdV2 } from "./competition-profiles.v2"

export type CompetitionObservableBehaviorV2 =
  | "explain"
  | "apply"
  | "trace"
  | "debug"
  | "create"
export type CompetitionQueryStyleV2 =
  | "structured"
  | "colloquial"
  | "goal_oriented"
  | "fragmentary"
  | "mixed_language"
  | "typo_noisy"
export type CompetitionLearningActionV2 =
  | "remediate"
  | "reinforce"
  | "advance"
  | "reprofile"

export interface CompetitionEvaluationCaseV2 {
  case_id: string
  suite: "competition-main-v2"
  profile_fixture_id: CompetitionProfileFixtureIdV2
  profile_archetype_id: string
  query: {
    raw: string
    style: CompetitionQueryStyleV2
    normalized_intent: string
  }
  target_source_ids: string[]
  objectives: Array<{
    source_id: string
    observable_behavior: CompetitionObservableBehaviorV2
    importance: "core"
    is_primary: boolean
    required_fact_policy: "source_core_facts"
  }>
  artifact_plan: {
    lesson: { shape: string; expected_difficulty: Difficulty }
    lab: {
      shape: string
      expected_difficulty: Difficulty
      docker_required: true
    }
    assessment: {
      shape: string
      expected_difficulty: Difficulty
      blueprint: {
        tier_1_count: number
        tier_2_count: number
        tier_3_count: number
        required_modalities: import("../../role-c-content/contracts/profile-adapter").AssessmentBlueprint["required_modalities"]
      }
    }
  }
  manual_review_focus: ArtifactKind
  counterfactual_group_id?: string
  dynamic_trajectory?: {
    trajectory_id: string
    expected_action: CompetitionLearningActionV2
    synthetic_answer_policy:
      | "mostly_incorrect"
      | "partial_60_percent"
      | "all_correct"
      | "profile_conflict_sequence"
    minimum_rounds: 1 | 2
    main_metric_checkpoint: "round_1_publication"
    follow_up_excluded_from_main_metrics: true
    next_target_source_ids?: string[]
  }
  tags: string[]
}

/** expected_difficulty is frozen review metadata. It is not projected into the generation or judge request. */
export const COMPETITION_CASES_V2 = [
  {
    case_id: "KB26-M-P01-01",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "请围绕“Python 是什么”安排一次个性化学习，目标是解释并识别；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "解释并识别：Python 是什么",
    },
    target_source_ids: ["K001"],
    objectives: [
      {
        source_id: "K001",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["explain", "single_target", "structured"],
    counterfactual_group_id: "CF-K001",
  },
  {
    case_id: "KB26-M-P01-02",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "我在“变量与赋值”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent: "解释并识别：变量与赋值",
    },
    target_source_ids: ["K002"],
    objectives: [
      {
        source_id: "K002",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["explain", "single_target", "colloquial"],
    counterfactual_group_id: "CF-K002",
  },
  {
    case_id: "KB26-M-P01-03",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "为了独立完成 Python 入门课程中的基础练习，我需要掌握基本数据类型，请按我现在的基础把任务安排到能解释并识别。",
      style: "goal_oriented",
      normalized_intent: "解释并识别：基本数据类型",
    },
    target_source_ids: ["K003"],
    objectives: [
      {
        source_id: "K003",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["explain", "single_target", "goal_oriented"],
    counterfactual_group_id: "CF-K003",
  },
  {
    case_id: "KB26-M-P01-04",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "输入输出；解释并识别；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "解释并识别：输入输出",
    },
    target_source_ids: ["K004"],
    objectives: [
      {
        source_id: "K004",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["explain", "single_target", "fragmentary"],
    counterfactual_group_id: "CF-K004",
  },
  {
    case_id: "KB26-M-P01-05",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "想学 运算符，please help me 解释并识别，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "解释并识别：运算符",
    },
    target_source_ids: ["K005"],
    objectives: [
      {
        source_id: "K005",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["explain", "single_target", "mixed_language"],
    counterfactual_group_id: "CF-K005",
  },
  {
    case_id: "KB26-M-P01-06",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "条件判断这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "解释并识别：条件判断",
    },
    target_source_ids: ["K006"],
    objectives: [
      {
        source_id: "K006",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["explain", "single_target", "typo_noisy"],
    counterfactual_group_id: "CF-K006",
  },
  {
    case_id: "KB26-M-P01-07",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "请围绕“for 循环”安排一次个性化学习，目标是解释并识别；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "解释并识别：for 循环",
    },
    target_source_ids: ["K007"],
    objectives: [
      {
        source_id: "K007",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["explain", "single_target", "structured"],
    counterfactual_group_id: "CF-K007",
  },
  {
    case_id: "KB26-M-P01-08",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "我在“while 循环”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent: "解释并识别：while 循环",
    },
    target_source_ids: ["K008"],
    objectives: [
      {
        source_id: "K008",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["explain", "single_target", "colloquial"],
    counterfactual_group_id: "CF-K008",
  },
  {
    case_id: "KB26-M-P01-09",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "为了独立完成 Python 入门课程中的基础练习，我需要掌握列表，请按我现在的基础把任务安排到能解释并识别。",
      style: "goal_oriented",
      normalized_intent: "解释并识别：列表",
    },
    target_source_ids: ["K009"],
    objectives: [
      {
        source_id: "K009",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["explain", "single_target", "goal_oriented"],
    counterfactual_group_id: "CF-K009",
  },
  {
    case_id: "KB26-M-P01-10",
    suite: "competition-main-v2",
    profile_fixture_id: "P01",
    profile_archetype_id: "humanities-zero-course",
    query: {
      raw: "字典；解释并识别；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "解释并识别：字典",
    },
    target_source_ids: ["K010"],
    objectives: [
      {
        source_id: "K010",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["explain", "single_target", "fragmentary"],
    counterfactual_group_id: "CF-K010",
  },
  {
    case_id: "KB26-M-P02-01",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "想学 元组与集合，please help me 解释并识别，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "解释并识别：元组与集合",
    },
    target_source_ids: ["K011"],
    objectives: [
      {
        source_id: "K011",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["explain", "single_target", "mixed_language"],
    counterfactual_group_id: "CF-K011",
  },
  {
    case_id: "KB26-M-P02-02",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "字符串常用操作这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "解释并识别：字符串常用操作",
    },
    target_source_ids: ["K012"],
    objectives: [
      {
        source_id: "K012",
        observable_behavior: "explain",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "analogy_definition_example",
        expected_difficulty: "beginner",
      },
      lab: {
        shape: "guided_completion",
        expected_difficulty: "beginner",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "beginner",
        blueprint: {
          tier_1_count: 3,
          tier_2_count: 2,
          tier_3_count: 0,
          required_modalities: ["short_answer"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["explain", "single_target", "typo_noisy"],
    counterfactual_group_id: "CF-K012",
  },
  {
    case_id: "KB26-M-P02-03",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "请围绕“Python 是什么”安排一次个性化学习，目标是在新例子中应用；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "在新例子中应用：Python 是什么",
    },
    target_source_ids: ["K001"],
    objectives: [
      {
        source_id: "K001",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["apply", "single_target", "structured"],
    counterfactual_group_id: "CF-K001",
  },
  {
    case_id: "KB26-M-P02-04",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "我在“变量与赋值”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent: "在新例子中应用：变量与赋值",
    },
    target_source_ids: ["K002"],
    objectives: [
      {
        source_id: "K002",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["apply", "single_target", "colloquial"],
    counterfactual_group_id: "CF-K002",
  },
  {
    case_id: "KB26-M-P02-05",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "为了完成输入、判断、循环类课程实验并通过在线判题，我需要掌握基本数据类型，请按我现在的基础把任务安排到能在新例子中应用。",
      style: "goal_oriented",
      normalized_intent: "在新例子中应用：基本数据类型",
    },
    target_source_ids: ["K003"],
    objectives: [
      {
        source_id: "K003",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["apply", "single_target", "goal_oriented"],
    counterfactual_group_id: "CF-K003",
  },
  {
    case_id: "KB26-M-P02-06",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "输入输出；在新例子中应用；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "在新例子中应用：输入输出",
    },
    target_source_ids: ["K004"],
    objectives: [
      {
        source_id: "K004",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["apply", "single_target", "fragmentary"],
    counterfactual_group_id: "CF-K004",
  },
  {
    case_id: "KB26-M-P02-07",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "想学 运算符，please help me 在新例子中应用，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "在新例子中应用：运算符",
    },
    target_source_ids: ["K005"],
    objectives: [
      {
        source_id: "K005",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["apply", "single_target", "mixed_language"],
    counterfactual_group_id: "CF-K005",
  },
  {
    case_id: "KB26-M-P02-08",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "条件判断这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "在新例子中应用：条件判断",
    },
    target_source_ids: ["K006"],
    objectives: [
      {
        source_id: "K006",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["apply", "single_target", "typo_noisy"],
    counterfactual_group_id: "CF-K006",
  },
  {
    case_id: "KB26-M-P02-09",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "请围绕“for 循环”安排一次个性化学习，目标是在新例子中应用；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "在新例子中应用：for 循环",
    },
    target_source_ids: ["K007"],
    objectives: [
      {
        source_id: "K007",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["apply", "single_target", "structured"],
    counterfactual_group_id: "CF-K007",
  },
  {
    case_id: "KB26-M-P02-10",
    suite: "competition-main-v2",
    profile_fixture_id: "P02",
    profile_archetype_id: "vocational-applied-basic",
    query: {
      raw: "我在“while 循环”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent: "在新例子中应用：while 循环",
    },
    target_source_ids: ["K008"],
    objectives: [
      {
        source_id: "K008",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["apply", "single_target", "colloquial"],
    counterfactual_group_id: "CF-K008",
  },
  {
    case_id: "KB26-M-P03-01",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "为了能编写列表、字典、字符串和文件处理脚本，我需要掌握列表，请按我现在的基础把任务安排到能在新例子中应用。",
      style: "goal_oriented",
      normalized_intent: "在新例子中应用：列表",
    },
    target_source_ids: ["K009"],
    objectives: [
      {
        source_id: "K009",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["apply", "single_target", "goal_oriented"],
    counterfactual_group_id: "CF-K009",
  },
  {
    case_id: "KB26-M-P03-02",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "字典；在新例子中应用；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "在新例子中应用：字典",
    },
    target_source_ids: ["K010"],
    objectives: [
      {
        source_id: "K010",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["apply", "single_target", "fragmentary"],
    counterfactual_group_id: "CF-K010",
  },
  {
    case_id: "KB26-M-P03-03",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "想学 元组与集合，please help me 在新例子中应用，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "在新例子中应用：元组与集合",
    },
    target_source_ids: ["K011"],
    objectives: [
      {
        source_id: "K011",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["apply", "single_target", "mixed_language"],
    counterfactual_group_id: "CF-K011",
  },
  {
    case_id: "KB26-M-P03-04",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "字符串常用操作这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "在新例子中应用：字符串常用操作",
    },
    target_source_ids: ["K012"],
    objectives: [
      {
        source_id: "K012",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["apply", "single_target", "typo_noisy"],
    counterfactual_group_id: "CF-K012",
  },
  {
    case_id: "KB26-M-P03-05",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "请围绕“函数定义与调用”安排一次个性化学习，目标是在新例子中应用；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "在新例子中应用：函数定义与调用",
    },
    target_source_ids: ["K013"],
    objectives: [
      {
        source_id: "K013",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["apply", "single_target", "structured"],
    counterfactual_group_id: "CF-K013",
  },
  {
    case_id: "KB26-M-P03-06",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "我在“参数与返回值”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent: "在新例子中应用：参数与返回值",
    },
    target_source_ids: ["K014"],
    objectives: [
      {
        source_id: "K014",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["apply", "single_target", "colloquial"],
    counterfactual_group_id: "CF-K014",
  },
  {
    case_id: "KB26-M-P03-07",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "为了能编写列表、字典、字符串和文件处理脚本，我需要掌握文件读写，请按我现在的基础把任务安排到能在新例子中应用。",
      style: "goal_oriented",
      normalized_intent: "在新例子中应用：文件读写",
    },
    target_source_ids: ["K015"],
    objectives: [
      {
        source_id: "K015",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["apply", "single_target", "goal_oriented"],
    counterfactual_group_id: "CF-K015",
  },
  {
    case_id: "KB26-M-P03-08",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "异常处理；在新例子中应用；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "在新例子中应用：异常处理",
    },
    target_source_ids: ["K016"],
    objectives: [
      {
        source_id: "K016",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["apply", "single_target", "fragmentary"],
    counterfactual_group_id: "CF-K016",
  },
  {
    case_id: "KB26-M-P03-09",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "想学 模块导入，please help me 在新例子中应用，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "在新例子中应用：模块导入",
    },
    target_source_ids: ["K017"],
    objectives: [
      {
        source_id: "K017",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["apply", "single_target", "mixed_language"],
    counterfactual_group_id: "CF-K017",
  },
  {
    case_id: "KB26-M-P03-10",
    suite: "competition-main-v2",
    profile_fixture_id: "P03",
    profile_archetype_id: "business-data-job-basic",
    query: {
      raw: "成绩统计器综合项目这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "在新例子中应用：成绩统计器综合项目",
    },
    target_source_ids: ["K018"],
    objectives: [
      {
        source_id: "K018",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["apply", "single_target", "typo_noisy"],
    counterfactual_group_id: "CF-K018",
  },
  {
    case_id: "KB26-M-P04-01",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "请围绕“输入输出”安排一次个性化学习，目标是在新例子中应用；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "在新例子中应用：输入输出",
    },
    target_source_ids: ["K004"],
    objectives: [
      {
        source_id: "K004",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["apply", "single_target", "structured"],
  },
  {
    case_id: "KB26-M-P04-02",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "我在“for 循环”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent: "在新例子中应用：for 循环",
    },
    target_source_ids: ["K007"],
    objectives: [
      {
        source_id: "K007",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["apply", "single_target", "colloquial"],
  },
  {
    case_id: "KB26-M-P04-03",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "为了能追踪程序状态并处理边界样例，我需要掌握函数定义与调用，请按我现在的基础把任务安排到能在新例子中应用。",
      style: "goal_oriented",
      normalized_intent: "在新例子中应用：函数定义与调用",
    },
    target_source_ids: ["K013"],
    objectives: [
      {
        source_id: "K013",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["apply", "single_target", "goal_oriented"],
  },
  {
    case_id: "KB26-M-P04-04",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "异常处理；在新例子中应用；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "在新例子中应用：异常处理",
    },
    target_source_ids: ["K016"],
    objectives: [
      {
        source_id: "K016",
        observable_behavior: "apply",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "task_steps_transfer",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "guided_implementation",
        expected_difficulty: "basic",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "basic",
        blueprint: {
          tier_1_count: 2,
          tier_2_count: 2,
          tier_3_count: 1,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["apply", "single_target", "fragmentary"],
  },
  {
    case_id: "KB26-M-P04-05",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "想学 函数定义与调用，please help me 跟踪状态和输出，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "跟踪状态和输出：函数定义与调用",
    },
    target_source_ids: ["K013"],
    objectives: [
      {
        source_id: "K013",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["trace", "single_target", "mixed_language"],
    counterfactual_group_id: "CF-K013",
  },
  {
    case_id: "KB26-M-P04-06",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "参数与返回值这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "跟踪状态和输出：参数与返回值",
    },
    target_source_ids: ["K014"],
    objectives: [
      {
        source_id: "K014",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["trace", "single_target", "typo_noisy"],
    counterfactual_group_id: "CF-K014",
  },
  {
    case_id: "KB26-M-P04-07",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "请围绕“文件读写”安排一次个性化学习，目标是跟踪状态和输出；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "跟踪状态和输出：文件读写",
    },
    target_source_ids: ["K015"],
    objectives: [
      {
        source_id: "K015",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["trace", "single_target", "structured"],
    counterfactual_group_id: "CF-K015",
  },
  {
    case_id: "KB26-M-P04-08",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "我在“异常处理”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent: "跟踪状态和输出：异常处理",
    },
    target_source_ids: ["K016"],
    objectives: [
      {
        source_id: "K016",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["trace", "single_target", "colloquial"],
    counterfactual_group_id: "CF-K016",
  },
  {
    case_id: "KB26-M-P04-09",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "为了能追踪程序状态并处理边界样例，我需要掌握模块导入，请按我现在的基础把任务安排到能跟踪状态和输出。",
      style: "goal_oriented",
      normalized_intent: "跟踪状态和输出：模块导入",
    },
    target_source_ids: ["K017"],
    objectives: [
      {
        source_id: "K017",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["trace", "single_target", "goal_oriented"],
    counterfactual_group_id: "CF-K017",
  },
  {
    case_id: "KB26-M-P04-10",
    suite: "competition-main-v2",
    profile_fixture_id: "P04",
    profile_archetype_id: "cs-competition-intermediate",
    query: {
      raw: "成绩统计器综合项目；跟踪状态和输出；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "跟踪状态和输出：成绩统计器综合项目",
    },
    target_source_ids: ["K018"],
    objectives: [
      {
        source_id: "K018",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["trace", "single_target", "fragmentary"],
    counterfactual_group_id: "CF-K018",
  },
  {
    case_id: "KB26-M-P05-01",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "想学 变量与赋值、运算符、条件判断，please help me 跟踪状态和输出，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "跟踪状态和输出：变量与赋值、运算符、条件判断",
    },
    target_source_ids: ["K002", "K005", "K006"],
    objectives: [
      {
        source_id: "K002",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K005",
        observable_behavior: "trace",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K006",
        observable_behavior: "trace",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["trace", "multi_target", "mixed_language", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-01",
      expected_action: "reinforce",
      synthetic_answer_policy: "partial_60_percent",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
    },
  },
  {
    case_id: "KB26-M-P05-02",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "基本数据类型、输入输出、运算符这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "跟踪状态和输出：基本数据类型、输入输出、运算符",
    },
    target_source_ids: ["K003", "K004", "K005"],
    objectives: [
      {
        source_id: "K003",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K004",
        observable_behavior: "trace",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K005",
        observable_behavior: "trace",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["trace", "multi_target", "typo_noisy", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-02",
      expected_action: "advance",
      synthetic_answer_policy: "all_correct",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
      next_target_source_ids: ["K006"],
    },
  },
  {
    case_id: "KB26-M-P05-03",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "请围绕“for 循环、列表”安排一次个性化学习，目标是跟踪状态和输出；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "跟踪状态和输出：for 循环、列表",
    },
    target_source_ids: ["K007", "K009"],
    objectives: [
      {
        source_id: "K007",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K009",
        observable_behavior: "trace",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["trace", "multi_target", "structured", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-03",
      expected_action: "reinforce",
      synthetic_answer_policy: "partial_60_percent",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
    },
  },
  {
    case_id: "KB26-M-P05-04",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "我在“函数定义与调用、参数与返回值、模块导入”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent:
        "跟踪状态和输出：函数定义与调用、参数与返回值、模块导入",
    },
    target_source_ids: ["K013", "K014", "K017"],
    objectives: [
      {
        source_id: "K013",
        observable_behavior: "trace",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K014",
        observable_behavior: "trace",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K017",
        observable_behavior: "trace",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "state_table_execution_trace",
        expected_difficulty: "basic",
      },
      lab: {
        shape: "trace_then_modify",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 3,
          tier_3_count: 1,
          required_modalities: ["trace"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["trace", "multi_target", "colloquial", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-04",
      expected_action: "advance",
      synthetic_answer_policy: "all_correct",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
      next_target_source_ids: ["K015", "K016"],
    },
  },
  {
    case_id: "KB26-M-P05-05",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "为了在岗位任务中完成日志处理、错误定位和代码验收，我需要掌握条件判断、for 循环、列表，请按我现在的基础把任务安排到能定位并修复错误。",
      style: "goal_oriented",
      normalized_intent: "定位并修复错误：条件判断、for 循环、列表",
    },
    target_source_ids: ["K006", "K007", "K009"],
    objectives: [
      {
        source_id: "K006",
        observable_behavior: "debug",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K007",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K009",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "symptom_hypothesis_fix_regression",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "fault_localization",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 2,
          required_modalities: ["trace", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["debug", "multi_target", "goal_oriented", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-05",
      expected_action: "reprofile",
      synthetic_answer_policy: "profile_conflict_sequence",
      minimum_rounds: 2,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
    },
  },
  {
    case_id: "KB26-M-P05-06",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "运算符、while 循环；定位并修复错误；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "定位并修复错误：运算符、while 循环",
    },
    target_source_ids: ["K005", "K008"],
    objectives: [
      {
        source_id: "K005",
        observable_behavior: "debug",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K008",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "symptom_hypothesis_fix_regression",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "fault_localization",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 2,
          required_modalities: ["trace", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["debug", "multi_target", "fragmentary", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-06",
      expected_action: "remediate",
      synthetic_answer_policy: "mostly_incorrect",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
    },
  },
  {
    case_id: "KB26-M-P05-07",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "想学 字典、元组与集合，please help me 定位并修复错误，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "定位并修复错误：字典、元组与集合",
    },
    target_source_ids: ["K010", "K011"],
    objectives: [
      {
        source_id: "K010",
        observable_behavior: "debug",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K011",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "symptom_hypothesis_fix_regression",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "fault_localization",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 2,
          required_modalities: ["trace", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["debug", "multi_target", "mixed_language", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-07",
      expected_action: "reinforce",
      synthetic_answer_policy: "partial_60_percent",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
    },
  },
  {
    case_id: "KB26-M-P05-08",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "基本数据类型、字符串常用操作这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "定位并修复错误：基本数据类型、字符串常用操作",
    },
    target_source_ids: ["K003", "K012"],
    objectives: [
      {
        source_id: "K003",
        observable_behavior: "debug",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K012",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "symptom_hypothesis_fix_regression",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "fault_localization",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 2,
          required_modalities: ["trace", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["debug", "multi_target", "typo_noisy", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-08",
      expected_action: "advance",
      synthetic_answer_policy: "all_correct",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
      next_target_source_ids: ["K015", "K016"],
    },
  },
  {
    case_id: "KB26-M-P05-09",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "请围绕“文件读写、异常处理”安排一次个性化学习，目标是定位并修复错误；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "定位并修复错误：文件读写、异常处理",
    },
    target_source_ids: ["K015", "K016"],
    objectives: [
      {
        source_id: "K015",
        observable_behavior: "debug",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K016",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "symptom_hypothesis_fix_regression",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "fault_localization",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 2,
          required_modalities: ["trace", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["debug", "multi_target", "structured", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-09",
      expected_action: "remediate",
      synthetic_answer_policy: "mostly_incorrect",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
    },
  },
  {
    case_id: "KB26-M-P05-10",
    suite: "competition-main-v2",
    profile_fixture_id: "P05",
    profile_archetype_id: "java-to-python-job",
    query: {
      raw: "我在“函数定义与调用、参数与返回值”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent: "定位并修复错误：函数定义与调用、参数与返回值",
    },
    target_source_ids: ["K013", "K014"],
    objectives: [
      {
        source_id: "K013",
        observable_behavior: "debug",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K014",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "symptom_hypothesis_fix_regression",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "fault_localization",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 2,
          required_modalities: ["trace", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["debug", "multi_target", "colloquial", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P05-10",
      expected_action: "reprofile",
      synthetic_answer_policy: "profile_conflict_sequence",
      minimum_rounds: 2,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
    },
  },
  {
    case_id: "KB26-M-P06-01",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "为了完成带输入校验、异常处理和模块拆分的 Python 项目，我需要掌握输入输出、异常处理，请按我现在的基础把任务安排到能定位并修复错误。",
      style: "goal_oriented",
      normalized_intent: "定位并修复错误：输入输出、异常处理",
    },
    target_source_ids: ["K004", "K016"],
    objectives: [
      {
        source_id: "K004",
        observable_behavior: "debug",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K016",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "symptom_hypothesis_fix_regression",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "fault_localization",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 2,
          required_modalities: ["trace", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["debug", "multi_target", "goal_oriented", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P06-01",
      expected_action: "remediate",
      synthetic_answer_policy: "mostly_incorrect",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
    },
  },
  {
    case_id: "KB26-M-P06-02",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "for 循环、列表、成绩统计器综合项目；定位并修复错误；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "定位并修复错误：for 循环、列表、成绩统计器综合项目",
    },
    target_source_ids: ["K007", "K009", "K018"],
    objectives: [
      {
        source_id: "K007",
        observable_behavior: "debug",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K009",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K018",
        observable_behavior: "debug",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "symptom_hypothesis_fix_regression",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "fault_localization",
        expected_difficulty: "intermediate",
        docker_required: true,
      },
      assessment: {
        shape: "five_item_tiered",
        expected_difficulty: "intermediate",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 2,
          required_modalities: ["trace", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["debug", "multi_target", "fragmentary", "dynamic"],
    dynamic_trajectory: {
      trajectory_id: "TRJ-KB26-M-P06-02",
      expected_action: "advance",
      synthetic_answer_policy: "all_correct",
      minimum_rounds: 1,
      main_metric_checkpoint: "round_1_publication",
      follow_up_excluded_from_main_metrics: true,
      next_target_source_ids: ["K013", "K014", "K017"],
    },
  },
  {
    case_id: "KB26-M-P06-03",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "想学 输入输出、条件判断、异常处理，please help me 独立设计并完成，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "独立设计并完成：输入输出、条件判断、异常处理",
    },
    target_source_ids: ["K004", "K006", "K016"],
    objectives: [
      {
        source_id: "K004",
        observable_behavior: "create",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K006",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K016",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "requirements_decomposition_design_acceptance",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "open_project",
        expected_difficulty: "integrated",
        docker_required: true,
      },
      assessment: {
        shape: "integrated_tiered",
        expected_difficulty: "integrated",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 3,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["create", "multi_target", "mixed_language"],
  },
  {
    case_id: "KB26-M-P06-04",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "for 循环、列表、成绩统计器综合项目这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent: "独立设计并完成：for 循环、列表、成绩统计器综合项目",
    },
    target_source_ids: ["K007", "K009", "K018"],
    objectives: [
      {
        source_id: "K007",
        observable_behavior: "create",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K009",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K018",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "requirements_decomposition_design_acceptance",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "open_project",
        expected_difficulty: "integrated",
        docker_required: true,
      },
      assessment: {
        shape: "integrated_tiered",
        expected_difficulty: "integrated",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 3,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["create", "multi_target", "typo_noisy"],
  },
  {
    case_id: "KB26-M-P06-05",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "请围绕“字典、字符串常用操作”安排一次个性化学习，目标是独立设计并完成；需要讲义、可运行代码实验和正式分阶测评。",
      style: "structured",
      normalized_intent: "独立设计并完成：字典、字符串常用操作",
    },
    target_source_ids: ["K010", "K012"],
    objectives: [
      {
        source_id: "K010",
        observable_behavior: "create",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K012",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "requirements_decomposition_design_acceptance",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "open_project",
        expected_difficulty: "integrated",
        docker_required: true,
      },
      assessment: {
        shape: "integrated_tiered",
        expected_difficulty: "integrated",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 3,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["create", "multi_target", "structured"],
  },
  {
    case_id: "KB26-M-P06-06",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "我在“函数定义与调用、参数与返回值、模块导入”这里总绕不明白，别只讲定义，带我看懂再做一个能跑的练习，最后测一下。",
      style: "colloquial",
      normalized_intent:
        "独立设计并完成：函数定义与调用、参数与返回值、模块导入",
    },
    target_source_ids: ["K013", "K014", "K017"],
    objectives: [
      {
        source_id: "K013",
        observable_behavior: "create",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K014",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K017",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "requirements_decomposition_design_acceptance",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "open_project",
        expected_difficulty: "integrated",
        docker_required: true,
      },
      assessment: {
        shape: "integrated_tiered",
        expected_difficulty: "integrated",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 3,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["create", "multi_target", "colloquial"],
  },
  {
    case_id: "KB26-M-P06-07",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "为了完成带输入校验、异常处理和模块拆分的 Python 项目，我需要掌握字符串常用操作、文件读写、异常处理，请按我现在的基础把任务安排到能独立设计并完成。",
      style: "goal_oriented",
      normalized_intent: "独立设计并完成：字符串常用操作、文件读写、异常处理",
    },
    target_source_ids: ["K012", "K015", "K016"],
    objectives: [
      {
        source_id: "K012",
        observable_behavior: "create",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K015",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K016",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "requirements_decomposition_design_acceptance",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "open_project",
        expected_difficulty: "integrated",
        docker_required: true,
      },
      assessment: {
        shape: "integrated_tiered",
        expected_difficulty: "integrated",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 3,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["create", "multi_target", "goal_oriented"],
  },
  {
    case_id: "KB26-M-P06-08",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "列表、字典、函数定义与调用；独立设计并完成；例子、在线练习、测验都要。",
      style: "fragmentary",
      normalized_intent: "独立设计并完成：列表、字典、函数定义与调用",
    },
    target_source_ids: ["K009", "K010", "K013"],
    objectives: [
      {
        source_id: "K009",
        observable_behavior: "create",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K010",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K013",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "requirements_decomposition_design_acceptance",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "open_project",
        expected_difficulty: "integrated",
        docker_required: true,
      },
      assessment: {
        shape: "integrated_tiered",
        expected_difficulty: "integrated",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 3,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lesson",
    tags: ["create", "multi_target", "fragmentary"],
  },
  {
    case_id: "KB26-M-P06-09",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "想学 运算符、while 循环、函数定义与调用，please help me 独立设计并完成，需要 runnable lab、边界说明和 short assessment。",
      style: "mixed_language",
      normalized_intent: "独立设计并完成：运算符、while 循环、函数定义与调用",
    },
    target_source_ids: ["K005", "K008", "K013"],
    objectives: [
      {
        source_id: "K005",
        observable_behavior: "create",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K008",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K013",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "requirements_decomposition_design_acceptance",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "open_project",
        expected_difficulty: "integrated",
        docker_required: true,
      },
      assessment: {
        shape: "integrated_tiered",
        expected_difficulty: "integrated",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 3,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "lab",
    tags: ["create", "multi_target", "mixed_language"],
  },
  {
    case_id: "KB26-M-P06-10",
    suite: "competition-main-v2",
    profile_fixture_id: "P06",
    profile_archetype_id: "software-project-integrated",
    query: {
      raw: "函数定义与调用、文件读写、异常处理、模块导入这快一直没弄清，帮我按现在水平讲明白，做个能运形的练习，再出测验。",
      style: "typo_noisy",
      normalized_intent:
        "独立设计并完成：函数定义与调用、文件读写、异常处理、模块导入",
    },
    target_source_ids: ["K013", "K015", "K016", "K017"],
    objectives: [
      {
        source_id: "K013",
        observable_behavior: "create",
        importance: "core",
        is_primary: true,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K015",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K016",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
      {
        source_id: "K017",
        observable_behavior: "create",
        importance: "core",
        is_primary: false,
        required_fact_policy: "source_core_facts",
      },
    ],
    artifact_plan: {
      lesson: {
        shape: "requirements_decomposition_design_acceptance",
        expected_difficulty: "intermediate",
      },
      lab: {
        shape: "open_project",
        expected_difficulty: "integrated",
        docker_required: true,
      },
      assessment: {
        shape: "integrated_tiered",
        expected_difficulty: "integrated",
        blueprint: {
          tier_1_count: 1,
          tier_2_count: 2,
          tier_3_count: 3,
          required_modalities: ["short_answer", "code"],
        },
      },
    },
    manual_review_focus: "assessment",
    tags: ["create", "multi_target", "typo_noisy"],
  },
] satisfies CompetitionEvaluationCaseV2[]
export const COMPETITION_CASES_V2_BY_ID = new Map(
  COMPETITION_CASES_V2.map((item) => [item.case_id, item]),
)
