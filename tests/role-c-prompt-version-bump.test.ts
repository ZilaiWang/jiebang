import { describe, expect, test } from "bun:test"
import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_PROMPT_MANIFEST_VERSION,
} from "../src/role-c-content/prompts/common-policy"
import { CONCEPT_TUTOR_SYSTEM_PROMPT } from "../src/role-c-content/prompts/concept-tutor/system.prompt"
import { CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT } from "../src/role-c-content/prompts/code-lab/secure-stage.prompt"
import { CODE_LAB_PUBLIC_REVIEW_REVISION_SYSTEM_PROMPT, CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT } from "../src/role-c-content/prompts/code-lab/public-stage.prompt"
import { stagedRepairPrompt } from "../src/role-c-content/prompts/staged-repair.prompt"

describe("role c prompt manifest version", () => {
  test("prompt manifest version 遵循语义化格式（不再硬编码具体值）", () => {
    expect(ROLE_C_PROMPT_MANIFEST_VERSION).toMatch(/^c-prompts-\d+\.\d+\.\d+$/)
  })

  test("keeps teaching scenarios inside the frozen evidence boundary", () => {
    expect(ROLE_C_COMMON_SYSTEM_POLICY).toContain("专业能力主张必须由 evidence 提供支持")
    expect(ROLE_C_COMMON_SYSTEM_POLICY).toContain("虚构标签不能豁免这些专业规则")
    expect(CONCEPT_TUTOR_SYSTEM_PROMPT).toContain("不得新增用途、领域、能力或真实案例")
    expect(CONCEPT_TUTOR_SYSTEM_PROMPT).toContain("不能自行扩展为网站、游戏、自动化、科学计算等其他用途")
  })

  test("makes an empty import contract explicit during authoring and repair", () => {
    expect(CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT).toContain("allowed_imports=[] 时不得出现任何 import")
    expect(stagedRepairPrompt("base", ["STATIC_UNLISTED_IMPORT"])).toContain("新 reference_solution 必须完全不含 import")
  })

  test("repairs code-lab execution intent as one coherent contract", () => {
    const prompt = stagedRepairPrompt("base", ["FUNCTION_OUTPUT_CONTRACT_MISMATCH"])
    expect(prompt).toContain("不得只改 execution_mode 字段")
    expect(prompt).toContain("execution_mode 已由编排器冻结为 function")
    expect(prompt).toContain("instruction、public_test 和 hints 都围绕入口函数的返回值")
    expect(prompt).toContain("previous_output 是尚未通过的模型草稿")
  })

  test("debugging_repair 只描述可观察现象，禁止声称不存在的缺陷", () => {
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("禁止写源码机制")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("给定输入 X，观察到错误输出/状态 Y")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("凡不能在 starter 上真实复现的现象必须删掉")
    expect(CODE_LAB_PUBLIC_REVIEW_REVISION_SYSTEM_PROMPT).toContain("二选一修复")
    expect(CODE_LAB_PUBLIC_REVIEW_REVISION_SYSTEM_PROMPT).toContain("禁止保留一个代码中不存在的缺陷描述")
  })

  test("troubleshooting 的原因必须锚定 cited_facts，不得编造证据外语言机制", () => {
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("原因只能指向当前 cited_facts 直接陈述的内容")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("不得写 print 函数用法、语法错误触发条件、缩进对齐规则")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("不得为凑“原因”而补充证据外机制")
    expect(CODE_LAB_PUBLIC_REVIEW_REVISION_SYSTEM_PROMPT).toContain("必须删除该机制并改为锚定 cited_facts")
    expect(CODE_LAB_PUBLIC_REVIEW_REVISION_SYSTEM_PROMPT).toContain("不得为保留 troubleshooting 的“原因”而继续编造证据外机制")
  })

  test("公开样例 input 必须两两不同，repair 提供专门指导", () => {
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("所有公开样例的 input 必须两两不同")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("fault_localization 尤其要避免用同一个输入重复展示")
    const repair = stagedRepairPrompt("base", ["programming_task 公开样例输入不得重复"])
    expect(repair).toContain("每个 objective 的 public_test.input 与 additional_public_examples 的 input 必须两两不同")
    expect(repair).toContain("不同公开样例要用不同输入触发不同目标对应的可观察现象")
  })

  test("stdin 正常输入保持 token 合同，同时保留边界与错误分区语义", () => {
    const repair = stagedRepairPrompt("base", ["$.secure_draft.payload.hidden_tests.h1.input: 隐藏输入的 token 类型序列 text/integer 与公开输入合同不一致"])
    expect(repair).toContain("nominal/anti_hardcode 的 input 必须与公开输入逐个对齐 token 类型")
    expect(repair).toContain("boundary/error_path 可以按冻结分区要求使用空值、缺失值或非法类型")
    expect(repair).toContain("避开 public 已用值")
  })
})
