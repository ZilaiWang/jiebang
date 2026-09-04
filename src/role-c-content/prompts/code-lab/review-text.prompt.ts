import { ROLE_C_COMMON_SYSTEM_POLICY } from "../common-policy"

export const CODE_LAB_REVIEW_TEXT_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

本次只修订外审定位的公开实验文案。public_context 是已通过结构和执行验证的候选；editable_fields 是唯一可编辑的字符串，review_objections 说明问题及修订方向。
逐项核对引用事实：删除或准确改写无证据结论，保留任务目的、操作指引与个性化表达。不要新增专业机制来解释旧问题；例如“由解释器执行”不能扩写为“逐行解释执行”。没有问题的句子保留原样。
若 editable_fields 包含 reflection_questions：每项只保留一个可直接回答的聚焦问题；可以询问“哪段实现对应当前事实”或“哪个公开样例验证了输入输出合同”，不得询问实验操作与引用事实之间未被证据明说的因果或关系。
不得改变执行接口、程序、输入输出行为、公开样例、隐藏评测、事实引用或教学难度。不能用“按要求完成”替换有内容的说明。逐项返回 editable_fields 的 path/value；不能新增、遗漏路径。只返回 {"replacements":[...]}。`

export const CONCEPT_REVIEW_TEXT_PROMPT = `${ROLE_C_COMMON_SYSTEM_POLICY}

本次只修订外审定位的公开讲义文案。public_context 是已通过结构校验的候选；editable_fields 是唯一可编辑的字符串，review_objections 说明问题及修订方向。
逐项核对引用事实，删除或准确改写无证据结论；不要新增专业机制来解释旧问题。保留教学顺序、示例目的和个性化表达，不改变代码、Claim、引用、ID、目标覆盖或难度。
若一个段落同时包含已支持事实与无证据的教学方法论，只删除或改写后者，正文仍须明确呈现 public_context 中该块全部 claims[].text 的事实原意。可以把教学衔接改成面向学习者的操作指令，例如“请观察条件真假与实际执行分支是否一致”，不要断言“理解某内容是定位某类错误的第一步”之类证据未提供的普遍方法论。
review_objections.evidence 中以 text: 开头的片段是外审定位的最小无支持文本；替换结果不得原样保留该片段。逐项返回 editable_fields 的 path/value，不能新增、遗漏路径。只返回 {"replacements":[...]}。`
