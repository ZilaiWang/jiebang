import { Check } from "lucide-react"
import { currentAssessmentAlreadyGraded } from "./orchestrator-view"

export interface LearningLoopStepView {
  id: string
  label: string
  state: "done" | "current" | "todo" | "blocked"
}

/**
 * 学习者视角的「本轮学习进度」：把 诊断→画像→路径→讲义→实验→测评→反馈
 * 映射为 7 个步骤状态。只使用主 Agent 公开字段推导，不虚构状态。
 * - 进度完全由会话真实状态决定（导航切换页面不会改变进度显示）；
 * - 讲义/实验已发布即视为完成（进入测评后仍保持实心打勾）；
 * - 测评/反馈按「当前轮是否已被正式评分」判定完成。
 */
export function learningLoopView(session: any): LearningLoopStepView[] {
  const hasProfile = Boolean(session?.profile)
  const hasPath = Boolean(session?.formal_path && session?.current_path_node)
  const hasLesson = Boolean(session?.learning_resources?.concept_lesson)
  const hasFeedback = Boolean(session?.feedback)
  const graded = currentAssessmentAlreadyGraded(session)
  const waiting = session?.waiting_for?.type
  const completed = session?.status === "completed"
  const blocked = session?.status === "blocked" || session?.status === "failed"

  const defs: Array<{ id: string; label: string }> = [
    { id: "diagnosis", label: "客观诊断" },
    { id: "profile", label: "学习者画像" },
    { id: "path", label: "学习路径" },
    { id: "lesson", label: "定制讲义" },
    { id: "lab", label: "代码实验" },
    { id: "assessment", label: "正式测评" },
    { id: "feedback", label: "评分反馈" },
  ]

  const isDone = (id: string): boolean => {
    switch (id) {
      case "diagnosis":
        return hasProfile || hasPath || hasFeedback || completed || waiting === "assessment_answers"
      case "profile":
        return hasProfile || hasPath
      case "path":
        return hasPath
      case "lesson":
      case "lab":
        // 讲义/代码实验已发布即视为本轮已完成该环节（进入测评后仍保持实心打勾）
        return hasLesson || graded || completed
      case "assessment":
        return graded || completed
      case "feedback":
        return completed
      default:
        return false
    }
  }

  let currentId = "diagnosis"
  if (waiting === "diagnosis_answers") currentId = "diagnosis"
  else if (graded) currentId = "feedback"
  else if (waiting === "assessment_answers" && Array.isArray(session?.assessment?.payload?.items) && session.assessment.payload.items.length > 0) currentId = "assessment"
  else if (hasLesson) currentId = "lesson"
  else if (hasPath) currentId = "path"
  else if (hasProfile) currentId = "profile"

  return defs.map((step) => {
    const done = isDone(step.id)
    const current = step.id === currentId && !done
    const state: LearningLoopStepView["state"] = done
      ? "done"
      : current
        ? (blocked ? "blocked" : "current")
        : "todo"
    return { id: step.id, label: step.label, state }
  })
}

export function LearningLoopStepper({ session }: { session: any }) {
  const steps = learningLoopView(session)
  return (
    <nav className="learning-loop" aria-label="本轮学习进度">
      {steps.map((step, index) => (
        <div className={`loop-step is-${step.state}`} key={step.id}>
          <span className="loop-dot" aria-hidden="true">
            {step.state === "done" ? <Check size={12} /> : step.state === "blocked" ? "!" : index + 1}
          </span>
          <b>{step.label}</b>
          {index < steps.length - 1 ? <i className="loop-link" aria-hidden="true" /> : null}
        </div>
      ))}
    </nav>
  )
}
