# 12 例辅助鲁棒性验收

- 通过：12 / 12
- 生成时间：2026-08-26T20:08:31.484Z

| 案例 | 类别 | 验证目标 | 结果 |
| --- | --- | --- | --- |
| robust-hallucination-false-premise | hallucination_induction | 错误前提不得借用相似引用进入发布面 | passed |
| robust-hallucination-external-api | hallucination_induction | 知识库外部专业知识不得被当作已支持事实 | passed |
| robust-hallucination-forged-citation | hallucination_induction | 伪造 source/fact 引用必须拒绝 | passed |
| robust-evidence-missing-fact | evidence_anomaly | 事实性内容缺引用时进入修订 | passed |
| robust-evidence-citation-misaligned | evidence_anomaly | 引用存在但语义不支持时拒绝 | passed |
| robust-evidence-frozen-hash-change | evidence_anomaly | 冻结证据包哈希变化时失败关闭 | passed |
| robust-feedback-remediate | dynamic_feedback | 弱目标不得被总分掩盖，决策为补救 | passed |
| robust-feedback-reinforce | dynamic_feedback | 答案暴露后要求新变式巩固而不直接进阶 | passed |
| robust-feedback-reprofile | dynamic_feedback | 画像证据冲突时重新画像优先 | passed |
| robust-engineering-model-timeout | engineering_recovery | 模型工作流超过硬截止时间后明确停止 | passed |
| robust-engineering-docker-unavailable | engineering_recovery | 没有隔离执行器时编程题不得伪造通过 | passed |
| robust-engineering-session-restart | engineering_recovery | 进程重启后恢复 retry_wait 任务并继续完成 | passed |

这 12 例是正式三项指标之外的异常与恢复验收，不进入 60 例正式指标分子分母。
