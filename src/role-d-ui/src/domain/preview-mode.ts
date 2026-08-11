import type { LearningArtifactView } from "./types"

const citations = [{ sourceId: "K007", factId: "F001" }]

export const previewLearningArtifacts: LearningArtifactView[] = [
  {
    id: "PREVIEW-LESSON-K007",
    kind: "lesson",
    title: "Python for 循环与 range",
    status: "mock",
    content: "for 循环适合按顺序重复处理一组数据；range 可以生成一段整数序列。",
    options: [],
    citations,
    evidenceStatus: "grounded",
  },
  {
    id: "PREVIEW-LAB-K007",
    kind: "lab",
    title: "遍历列表中的学习任务",
    status: "mock",
    content: "tasks = [\"认识循环\", \"理解 range\", \"完成练习\"]\n\nfor task in tasks:\n    print(task)",
    options: [],
    citations,
    evidenceStatus: "grounded",
  },
  {
    id: "PREVIEW-ASSESSMENT-K007",
    kind: "assessment",
    title: "循环基础界面预览测评",
    status: "mock",
    content: "以下题目仅用于查看测评交互，不提交 C 正式评分。",
    options: [],
    citations,
    evidenceStatus: "grounded",
    items: [
      { id: "PREVIEW-I1", tier: 1, modality: "mcq", prompt: "range(1, 4) 会生成哪些整数？", options: ["A. 1、2、3", "B. 1、2、3、4"], optionIds: ["A", "B"], citations },
      { id: "PREVIEW-I2", tier: 1, modality: "true_false", prompt: "for 循环可以依次遍历列表中的元素。", options: ["A. 错误", "B. 正确"], optionIds: ["A", "B"], citations },
      { id: "PREVIEW-I3", tier: 2, modality: "trace", prompt: "写出下面循环的输出：for i in range(2): print(i)", options: [], citations },
    ],
  },
]
