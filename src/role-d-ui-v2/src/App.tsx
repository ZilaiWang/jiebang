import {
  ArrowDown,
  ArrowRight,
  CalendarClock,
  BookOpen,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  FileText,
  FlaskConical,
  FolderTree,
  GraduationCap,
  History,
  Home,
  Layers3,
  Lightbulb,
  ListChecks,
  Menu,
  MessageCircleQuestion,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Settings2,
  SlidersHorizontal,
  Clock,
  TrendingUp,
  BadgeCheck,
  Eye,
  MapPin,
  Scale,
  TriangleAlert,
  Gauge,
  Sparkles,
  TerminalSquare,
  Target,
  Trash2,
  UserPlus,
  UserRound,
  X,
  Sun,
  Moon,
} from "lucide-react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import EditorExport from "react-simple-code-editor"
import Prism from "prismjs"
import "prismjs/components/prism-python"
import "prismjs/themes/prism-tomorrow.css"
import learningCatIllustration from "./assets/knowbalance-learning-cat.jpg"
import { PYTHON_CURRICULUM } from "./curriculum"
import {
  createOrchestratorSession,
  getOrchestratorEvents,
  getOrchestratorSession,
  getProviderConfiguration,
  newClientId,
  retryOrchestratorSession,
  runAssessmentCode as requestAssessmentCode,
  submitCodeLab as requestCodeLab,
  debugCodeLab as requestCodeLabDebug,
  runExampleCode as requestExampleCode,
  saveProviderConfiguration,
  submitAssessmentAnswers,
  submitDiagnosisAnswers,
  submitProfileAnswers,
  submitProfileGapAnswer,
} from "./orchestrator-client"
import { indentParagraphText, lessonPointParagraphs, normalizePythonDisplayIndentation, semanticLessonLines } from "./lesson-format"
import {
  buildFactIndex,
  lookupFact,
  uniqueCitations as uniqueFactCitations,
  type FactIndex,
} from "./fact-lookup"
import { codeSubmissionHint, labFeedbackExplanations, publicTestChecklist } from "./lab-feedback"
import { effectiveGapAnswerFormat, gapAnswerGuidance, gapAnswerIssue, gapTemplatePreview } from "./gap-guidance"
import { LoopVisualizerToggle } from "./loop-visualizer"
import { LearningLoopStepper } from "./learning-progress"
import { abilityRadarView, activeAdaptationView, agentTimelineView, answersMatchAssessmentItems, answersToSubmission, assessmentComplete, assessmentEntryBlockedByPriorFeedback, assessmentFeedbackView, blockedSessionAction, collaborationDrawerView, completedNodeFromPath, diagnosisComplete, finalFeedbackAction, initialGoalSelection, isFinalAdvanceSession, isFinalMasterySession, knowledgeCandidateCards, mainFlowStatusView, microCheckFeedbackView, nextRoundResourceGate, nextUnmasteredPathNode, pageForSession, pathChainView, pathNodeTitle, pathNodeWhyView, resourceMatchView, sessionNeedsEventRefresh, shouldPollOrchestratorSession, type ResourceFitEntry } from "./orchestrator-view"
import type { AssessmentPayload, Citation, CodeLabPayload, LessonPayload, PublicSessionFixture } from "./types"
import { planNavSection } from "./plan-navigation"
import {
  activePlan,
  activeUser,
  addPlan,
  addUser,
  deletePlan,
  learnerBackground,
  loadWorkspace,
  markPlanConceptMastered,
  masteredConceptsForUser,
  planNameFromGoal,
  recordPlanPublicState,
  renamePlan,
  selectPlan,
  selectUser,
  type LearnerProfileDraft,
  type WorkspaceState,
  type WorkspaceUser,
  type GoalUseCase,
  type LearningStyle,
  type ExplanationPreference,
  type PracticePreference,
  type PacePreference,
} from "./workspace"

const WORKSPACE_STORAGE_KEY = "knowbalance-v4-workspace"

/** 支持 ?session=xxx&learner=xxx 直链：自动预置一个绑定该会话的体验工作区，免去手动 F12 设置。 */
function workspaceFromUrl(): WorkspaceState | null {
  const params = new URLSearchParams(window.location.search)
  const session = params.get("session")
  const learner = params.get("learner")
  if (!session || !learner) return null
  const name = params.get("name") ?? "体验学习者"
  const goalUseCase = (params.get("goal") ?? "coursework") as GoalUseCase
  return {
    version: 1,
    activeUserId: learner,
    users: [{
      id: learner,
      name,
      weeklyHours: 5,
      pythonLevel: "new",
      learningStyle: "balanced",
      background: "零基础入门",
      priorLanguages: [],
      intakeVersion: 2,
      goalUseCase,
      plans: [{
        id: "plan-demo-1",
        name: "学习 Python for 循环",
        sessionId: session,
        createdAt: "2026-08-17T12:00:00.000Z",
        updatedAt: "2026-08-17T12:00:00.000Z",
      }],
      activePlanId: "plan-demo-1",
    }],
  }
}

/** 实时检查 Docker 是否就绪（每次创建前调用，不依赖页面加载时的缓存值）。 */
export async function checkDockerReady(fetchImpl: typeof fetch = fetch): Promise<{ ready: boolean; error?: string }> {
  try {
    const response = await fetchImpl("/orchestrator/docker-status")
    const data = await response.json() as { docker?: { ready?: boolean; error?: string } }
    return data?.docker?.ready
      ? { ready: true }
      : { ready: false, error: data?.docker?.error ?? "无法检测 Docker 状态" }
  } catch {
    return { ready: false, error: "无法连接主 Agent，请确认已启动" }
  }
}

export type LiveContextValue = {
  session: PublicSessionFixture | null
  isLive: boolean
  learnerId: string
  busy: string
  error: string
  dockerReady: boolean
  diagnosisAnswers: Record<string, string>
  assessmentAnswers: Record<string, string>
  setDiagnosisAnswer: (itemId: string, answer: string) => void
  setAssessmentAnswer: (itemId: string, answer: string) => void
  clearAssessmentAnswers: () => void
  create: (input: { goal: string; nodeId?: string; custom?: boolean; planName: string }) => Promise<void>
  submitDiagnosis: () => Promise<void>
  submitProfileClarification: (answers: Array<{ question_id: string; value: string | string[] | number }>) => Promise<void>
  submitProfileGap: (questionId: string, sourceId: string, answer: string) => Promise<void>
  submitAssessment: () => Promise<void>
  runAssessmentItemCode: (itemId: string, code: string) => Promise<void>
  runPublishedCodeLab: (labId: string, submission: string | { gap_answers: Record<string, string> }) => Promise<void>
  debugPublishedCodeLab?: (labId: string, submission: string | { gap_answers: Record<string, string> }, publicCaseId: string) => Promise<void>
  runExampleCode: (code: string) => Promise<any>
  retry: () => Promise<void>
  refreshEvents: () => Promise<void>
  reset: () => void
}

export const LiveContext = createContext<LiveContextValue | null>(null)

function useLive() {
  const value = useContext(LiveContext)
  if (!value) throw new Error("LiveContext is not available")
  return value
}

function useRequiredSession() {
  const { session } = useLive()
  if (!session) throw new Error("This page requires an active orchestrator session")
  return session
}

type Page = "home" | "goal" | "diagnosis" | "path" | "lesson" | "assessment" | "feedback" | "history"
type LessonTab = "lesson" | "lab" | "checks"
type SideTab = "hint" | "evidence" | "agents"

const navItems: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: "goal", label: "新建学习", icon: Target },
  { id: "path", label: "学习方案", icon: FolderTree },
  { id: "lesson", label: "互动学习", icon: BookOpen },
  { id: "assessment", label: "正式测评", icon: ListChecks },
  { id: "history", label: "协同记录", icon: History },
]

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => {
    const fromUrl = workspaceFromUrl()
    if (fromUrl) {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(fromUrl))
      return fromUrl
    }
    return loadWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY))
  })
  const currentUser = activeUser(workspace)
  const currentPlan = activePlan(workspace)
  const learnerId = currentUser?.id ?? ""
  const [liveSession, setLiveSession] = useState<PublicSessionFixture | null>(null)
  const [page, setPage] = useState<Page>("home")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [diagnosisAnswers, setDiagnosisAnswers] = useState<Record<string, string>>({})
  const [assessmentAnswers, setAssessmentAnswers] = useState<Record<string, string>>({})
  const [provider, setProvider] = useState({ configured: false, provider_mode: "model" as const, endpoint: "", model_id: "" })
  const [dockerStatus, setDockerStatus] = useState<{ ready: boolean; error?: string }>({ ready: false })
  const [providerOpen, setProviderOpen] = useState(false)
  const [collaborationOpen, setCollaborationOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [confirmSwitchUserId, setConfirmSwitchUserId] = useState<string | null>(null)
  const [userDetailUserId, setUserDetailUserId] = useState<string | null>(null)
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("knowbalance:theme")
      if (saved === "dark" || saved === "light") return saved
    } catch { /* 存储不可用时忽略 */ }
    return "light"
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem("knowbalance:theme", theme) } catch { /* 忽略 */ }
  }, [theme])
  const [openPlanAfterProvider, setOpenPlanAfterProvider] = useState(false)
  const [requestedPlanId, setRequestedPlanId] = useState<string | null>(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [feedbackDismissed, setFeedbackDismissed] = useState(false)
  const [masteryNotice, setMasteryNotice] = useState<{ title: string; concept: string; final: boolean } | null>(null)
  const celebratedRoundRef = useRef("")
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "auto" }) }, [page])

  useEffect(() => {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace))
  }, [workspace])

  useEffect(() => {
    getProviderConfiguration().then(setProvider).catch(() => setProvider({ configured: false, provider_mode: "model", endpoint: "", model_id: "" }))
    // 检测 Docker 状态
    checkDockerReady()
      .then(setDockerStatus)
      .catch(() => setDockerStatus({ ready: false, error: "无法连接主 Agent，请确认已启动" }))
  }, [])

  useEffect(() => {
    if (workspace.users.length === 0) setProfileOpen(true)
  }, [workspace.users.length])

  useEffect(() => {
    if (!currentPlan?.sessionId || !learnerId) {
      setLiveSession(null)
      return
    }
    let cancelled = false
    let timer: number | undefined
    const load = async () => {
      if (cancelled) return
      try {
        const restored = await getOrchestratorSession(currentPlan.sessionId!, learnerId)
        const eventResult = await getOrchestratorEvents(currentPlan.sessionId!, learnerId).catch(() => ({ events: [] }))
        if (cancelled) return
        const merged = { ...restored, events: eventResult.events ?? [] } as PublicSessionFixture
        setLiveSession(merged)
        if (requestedPlanId === currentPlan.id) {
          setPage(pageForSession(merged, { feedbackDismissed }))
          setRequestedPlanId(null)
        }
        if (shouldPollOrchestratorSession(merged)) {
          setBusy("主 Agent正在调用 C 生成并审核下一轮资源…")
          timer = window.setTimeout(() => void load(), 800)
        } else {
          setBusy("")
        }
      } catch (reason) {
        if (!cancelled) {
          setLiveSession(null)
          setError(reason instanceof Error ? reason.message : "无法恢复计划会话")
          setBusy("")
        }
      }
    }
    setBusy("正在恢复这个计划的主 Agent会话…")
    void load()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [currentPlan?.id, currentPlan?.sessionId, learnerId, requestedPlanId, liveSession?.status])

  useEffect(() => {
    if (!liveSession || !currentUser || !currentPlan) return
    // 完成弹窗：feedback 为 advance 且 session 已结束（completed / 无下一节点）
    const isAdvance = (liveSession.feedback as any)?.final_decision?.action === "advance"
    const isCompleted = liveSession.status === "completed"
    if (!isAdvance && !isCompleted) return
    const key = `${liveSession.session_id}:${liveSession.round_no}`
    if (celebratedRoundRef.current === key) return
    const completedNode = completedNodeFromPath(liveSession)
    if (!completedNode) return
    const ragItems = ((liveSession.rag_result as any)?.results ?? []).map((item: any) => ({ source_id: item.source_id ?? item.sourceId, title: item.title }))
    const concept = pathNodeTitle(completedNode, ragItems)
    const final = isFinalAdvanceSession(liveSession)
    celebratedRoundRef.current = key
    setWorkspace((value) => markPlanConceptMastered(value, currentUser.id, currentPlan.id, concept))
    setPage("feedback")
    setMasteryNotice({
      title: final ? `恭喜你已完成对${concept}的学习！` : "恭喜你！本轮正确率已达标！",
      concept,
      final,
    })
  }, [liveSession?.session_id, liveSession?.round_no, liveSession?.status, liveSession?.feedback, currentUser?.id, currentPlan?.id])

  useEffect(() => {
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      setScrollProgress(max <= 0 ? 0 : Math.min(1, window.scrollY / max))
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [page])

  const applySession = async (next: any, options: { keepPage?: boolean } = {}) => {
    const previousAssessmentId = liveSession?.assessment?.artifact_id
    const nextAssessmentId = next?.assessment?.artifact_id
    const assessmentChanged = Boolean(
      liveSession
      && (liveSession.round_no !== next?.round_no || (previousAssessmentId && nextAssessmentId && previousAssessmentId !== nextAssessmentId)),
    )
    if (assessmentChanged) setAssessmentAnswers({})
    let merged = { ...next, events: Array.isArray(next.events) ? next.events : liveSession?.events ?? [] } as PublicSessionFixture
    if (learnerId && sessionNeedsEventRefresh(liveSession, merged)) {
      const eventResult = await getOrchestratorEvents(merged.session_id, learnerId).catch(() => ({ events: merged.events ?? [] }))
      merged = { ...merged, events: eventResult.events ?? [] }
    }
    setLiveSession(merged)
    if (currentUser && currentPlan) setWorkspace((value) => recordPlanPublicState(value, currentUser.id, currentPlan.id, {
      sessionId: merged.session_id,
      status: merged.status,
      stage: merged.current_stage,
      knownConcepts: merged.profile?.known_concepts ?? currentPlan.knownConcepts ?? [],
    }))
    if (!options.keepPage) setPage(pageForSession(merged, { feedbackDismissed }))
    setError("")
  }

  const liveValue: LiveContextValue = {
    session: liveSession,
    isLive: Boolean(liveSession),
    learnerId,
    busy,
    error,
    dockerReady: dockerStatus.ready,
    diagnosisAnswers,
    assessmentAnswers,
    setDiagnosisAnswer: (itemId, answer) => setDiagnosisAnswers((current) => ({ ...current, [itemId]: answer })),
    setAssessmentAnswer: (itemId, answer) => {
      setAssessmentAnswers((current) => ({ ...current, [itemId]: answer }))
      setLiveSession((current) => current?.code_execution?.itemId === itemId
        ? { ...current, code_execution: null }
        : current)
    },
    clearAssessmentAnswers: () => setAssessmentAnswers({}),
    create: async ({ goal, nodeId, custom, planName }) => {
      if (!currentUser || !currentPlan) {
        setError("请先在首页选择用户和学习计划")
        setPage("home")
        return
      }
      if (!provider.configured) {
        setOpenPlanAfterProvider(false)
        setProviderOpen(true)
        return
      }
      // 每次创建前实时检查 Docker（不用页面加载时的缓存值）
      const docker = await checkDockerReady()
      setDockerStatus(docker)
      if (!docker.ready) {
        setError("Docker 代码沙箱未就绪：请先打开右上角「API设置」→ 检查 Docker 状态 → 一键配置 Docker")
        setProviderOpen(true)
        return
      }
      setBusy("主 Agent正在创建会话并选择客观诊断题…")
      setError("")
      try {
        setWorkspace((value) => renamePlan(value, currentUser.id, currentPlan.id, planName))
        const created = await createOrchestratorSession({
          learnerId: currentUser.id,
          goal,
          background: learnerBackground(currentUser),
          selfRating: currentUser.pythonLevel,
          learningGoalSpec: custom
            ? { mode: "custom_goal", custom_goal: goal }
            : { mode: "curriculum_node", selected_node_ids: nodeId ? [nodeId] : [] },
          profileIntake: currentUser.intakeVersion === 2
            ? {
                learner_id: currentUser.id,
                goal,
                background_summary: currentUser.background,
                prior_languages: currentUser.priorLanguages,
                self_rating: profileSelfRating(currentUser.pythonLevel),
                goal_use_case: currentUser.goalUseCase,
                desired_outcome: currentUser.desiredOutcome || goal,
                weekly_time_budget_minutes: currentUser.weeklyHours * 60,
                session_time_budget_minutes: currentUser.sessionMinutes,
                explanation_preference: currentUser.explanationPreference,
                practice_preference: currentUser.practicePreference,
                pace_preference: currentUser.pacePreference,
                preferred_contexts: currentUser.preferredContexts,
                tool_constraints: currentUser.toolConstraints,
                accommodations: currentUser.accommodations,
                privacy: {
                  personalization_enabled: true,
                  retention: currentUser.retention,
                  allow_profile_display: true,
                },
              }
            : undefined,
        })
        await applySession(created)
        setDiagnosisAnswers({})
        setAssessmentAnswers({})
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "创建主 Agent会话失败")
      } finally { setBusy("") }
    },
    submitDiagnosis: async () => {
      if (!liveSession || !diagnosisComplete(liveSession, diagnosisAnswers)) return
      setBusy("主 Agent正在生成画像、路径、RAG与 C 学习资源…")
      setError("")
      try {
        const next = await submitDiagnosisAnswers(liveSession.session_id, learnerId, diagnosisAnswers)
        const eventResult = await getOrchestratorEvents(liveSession.session_id, learnerId).catch(() => ({ events: [] }))
        await applySession({ ...next, events: eventResult.events ?? [] })
        setAssessmentAnswers({})
      } catch (reason) { setError(reason instanceof Error ? reason.message : "提交诊断失败") }
      finally { setBusy("") }
    },
    submitProfileClarification: async (answers) => {
      if (!liveSession || liveSession.waiting_for?.type !== "profile_answers") return
      setBusy("正在补充结构化画像并准备客观诊断…")
      setError("")
      try {
        await applySession(await submitProfileAnswers(liveSession.session_id, learnerId, answers))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "提交画像信息失败")
      } finally { setBusy("") }
    },
    submitProfileGap: async (questionId, sourceId, answer) => {
      if (!liveSession || liveSession.waiting_for?.type !== "profile_gap_questions") return
      setBusy("正在记录你的困难并生成下一轮内容…")
      setError("")
      try {
        await applySession(await submitProfileGapAnswer(liveSession.session_id, learnerId, questionId, sourceId, answer))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "提交困难反馈失败")
      } finally { setBusy("") }
    },
    submitAssessment: async () => {
      if (!liveSession || !assessmentComplete(liveSession, assessmentAnswers)) return
      setBusy("Role C正在正式评分并由主 Agent决定下一步…")
      setError("")
      try {
        const next = await submitAssessmentAnswers(liveSession.session_id, learnerId, answersToSubmission(liveSession.assessment?.payload?.items ?? [], assessmentAnswers))
        const eventResult = await getOrchestratorEvents(liveSession.session_id, learnerId).catch(() => ({ events: [] }))
        await applySession({ ...next, events: eventResult.events ?? [] })
        setAssessmentAnswers({})
        setFeedbackDismissed(false)
        setPage("feedback")
      } catch (reason) { setError(reason instanceof Error ? reason.message : "提交正式测评失败") }
      finally { setBusy("") }
    },
    runAssessmentItemCode: async (itemId, code) => {
      if (!liveSession || !itemId || !code.trim()) return
      setBusy("正在通过 Docker 检查这段代码…")
      setError("")
      try {
        await applySession(
          await requestAssessmentCode(liveSession.session_id, learnerId, itemId, code),
          { keepPage: true },
        )
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "代码运行失败")
      } finally { setBusy("") }
    },
    runPublishedCodeLab: async (labId, submission) => {
      if (!liveSession || !labId || (typeof submission === "string" ? !submission.trim() : Object.keys(submission.gap_answers).length === 0)) return
      setBusy("正在通过 Docker 运行代码实验…")
      setError("")
      try {
        await applySession(
          await requestCodeLab(liveSession.session_id, learnerId, labId, submission),
          { keepPage: true },
        )
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "代码实验运行失败")
      } finally { setBusy("") }
    },
    debugPublishedCodeLab: async (labId, submission, publicCaseId) => {
      if (!liveSession || !labId || !publicCaseId || (typeof submission === "string" ? !submission.trim() : Object.keys(submission.gap_answers).length === 0)) return
      setBusy("正在通过 Docker 调试公开样例…")
      setError("")
      try {
        await applySession(await requestCodeLabDebug(liveSession.session_id, learnerId, labId, submission, { public_case_id: publicCaseId }), { keepPage: true })
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "公开样例调试失败")
      } finally { setBusy("") }
    },
    runExampleCode: async (code) => {
      if (!liveSession || !code.trim()) return null
      setBusy("正在通过 Docker 运行示例代码…")
      setError("")
      try {
        const updated = await requestExampleCode(liveSession.session_id, learnerId, code)
        await applySession(updated, { keepPage: true })
        return updated?.code_execution ?? null
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "示例代码运行失败")
        return null
      } finally { setBusy("") }
    },
    retry: async () => {
      if (!liveSession) return
      setBusy("主 Agent正在从持久化检查点重试…")
      setError("")
      try { await applySession(await retryOrchestratorSession(liveSession.session_id, learnerId)) }
      catch (reason) { setError(reason instanceof Error ? reason.message : "重试失败") }
      finally { setBusy("") }
    },
    refreshEvents: async () => {
      if (!liveSession) return
      const result = await getOrchestratorEvents(liveSession.session_id, learnerId)
      setLiveSession((current) => current ? { ...current, events: result.events ?? [] } : current)
    },
    reset: () => {
      setLiveSession(null)
      setDiagnosisAnswers({})
      setAssessmentAnswers({})
      setError("")
      setPage("goal")
    },
  }

  const requestNewPlan = async () => {
    if (!currentUser) {
      setProfileOpen(true)
      return
    }
    if (!provider.configured) {
      setOpenPlanAfterProvider(true)
      setProviderOpen(true)
      return
    }
    // 点击「新建计划」立即实时检查 Docker（不等选完主题）
    const docker = await checkDockerReady()
    setDockerStatus(docker)
    if (!docker.ready) {
      setOpenPlanAfterProvider(true)
      setError("Docker 代码沙箱未就绪：请先打开右上角「API设置」→ 检查 Docker 状态 → 一键配置 Docker")
      setProviderOpen(true)
      return
    }
    const id = newClientId("plan")
    setWorkspace((value) => addPlan(value, currentUser.id, { id, name: "待选择学习目标" }))
    setPage("goal")
  }

  const enterPlan = (planId: string) => {
    if (!currentUser) return
    const plan = currentUser.plans.find((candidate) => candidate.id === planId)
    setWorkspace((value) => selectPlan(value, currentUser.id, planId))
    if (plan?.sessionId && liveSession?.session_id === plan.sessionId) setPage(pageForSession(liveSession, { feedbackDismissed }))
    else if (plan?.sessionId) setRequestedPlanId(planId)
    else setPage("goal")
  }

  return (
    <LiveContext.Provider value={liveValue}>
      <div className="app-shell motion-on">
        <div className="reading-progress" aria-hidden="true"><span style={{ transform: `scaleX(${scrollProgress})` }} /></div>
        <Atmosphere />
        <header className="topbar topbar-simple">
          <button className="brand" type="button" onClick={() => setPage("home")}>
            <span className="brand-mark"><Layers3 size={22} /></span>
            <span><b>KnowBalance</b><small>多 Agent 协同学习空间</small></span>
          </button>
          {page !== "home" && currentPlan ? <nav className="primary-nav plan-nav" aria-label="计划导航">
            {navItems.map((item) => <NavButton item={item} current={planNavSection(page)} disabled={!liveSession && item.id !== "goal"} onClick={setPage} key={item.id} />)}
          </nav> : <span className="home-top-note">今天，也让自己多懂一些 Python。</span>}
          <div className="top-actions">
            <button className="theme-toggle" type="button" aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"} title={theme === "dark" ? "浅色模式" : "深色模式"} onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
            <button className={`collaboration-button${liveSession?.status === "running" ? " is-live" : ""}`} type="button" onClick={() => setCollaborationOpen(true)}><Bot size={16} /><span>协同流程</span>{liveSession?.status === "running" ? <i /> : null}</button>
            <button className={`api-button${provider.configured ? " is-ready" : ""}`} type="button" onClick={() => setProviderOpen(true)}><Settings2 size={16} /><span>API设置</span><small>{provider.configured ? provider.model_id : "未配置"}</small></button>
            <button className="avatar-button avatar-with-name" type="button" aria-label="切换学习者" onClick={() => setUserOpen((value) => !value)}><UserRound size={18} /><span>{currentUser?.name ?? "选择用户"}</span></button>
          </div>
        </header>
        {busy && <div className="live-operation" role="status"><span className="operation-spinner" />{busy}</div>}
        {error && <div className="live-error" role="alert"><b>主 Agent请求未完成</b><span>{error}</span><button type="button" onClick={() => setError("")}>知道了</button></div>}
        {collaborationOpen ? <CollaborationDrawer session={liveSession} onClose={() => setCollaborationOpen(false)} /> : null}
        <main>
          {page === "home" && <HomeDashboard user={currentUser} mastered={currentUser ? masteredConceptsForUser(workspace, currentUser.id) : []} providerConfigured={provider.configured} onNewPlan={requestNewPlan} onEnterPlan={enterPlan} onDeletePlan={(planId) => currentUser && setWorkspace((value) => deletePlan(value, currentUser.id, planId))} />}
          {page === "goal" && currentPlan ? <GoalPage onContinue={() => setPage("diagnosis")} /> : null}
          {page === "diagnosis" && (liveSession ? <DiagnosisPage onContinue={() => setPage("path")} /> : <NoSessionState onStart={() => setPage("goal")} />)}
          {page === "path" && (liveSession ? <PathPage planName={currentPlan?.name} onContinue={() => setPage("lesson")} /> : <NoSessionState onStart={() => setPage("goal")} />)}
          {page === "lesson" && (liveSession ? <LessonPage user={currentUser} onAssessment={() => setPage("assessment")} /> : <NoSessionState onStart={() => setPage("goal")} />)}
          {page === "assessment" && (liveSession ? (
            assessmentEntryBlockedByPriorFeedback(liveSession, feedbackDismissed)
              ? <RedirectPage title="本轮测评已结束" message="你已经完成本轮测评，无法返回答题界面。" action="查看评分反馈" onAction={() => setPage("feedback")} />
              : <AssessmentPage onFeedback={() => setPage("feedback")} />
          ) : <NoSessionState onStart={() => setPage("goal")} />)}
          {page === "feedback" && (liveSession ? <FeedbackPage masteryNotice={masteryNotice} onMasteryDismiss={() => setMasteryNotice(null)} onContinue={() => {
            if (masteryNotice?.final || isFinalAdvanceSession(liveSession)) {
              setMasteryNotice(null)
              setFeedbackDismissed(true)
              setPage("home")
              return
            }
            const nextNode = nextUnmasteredPathNode(liveSession)
            const gate = nextRoundResourceGate(liveSession)
            if (!gate.ready) return
            setMasteryNotice(null)
            setFeedbackDismissed(true)
            setPage(nextNode && (liveSession?.learning_resources?.concept_lesson || liveSession?.learning_resources?.code_lab)
              ? "lesson"
              : pageForSession(liveSession, { feedbackDismissed: true }))
          }} /> : <NoSessionState onStart={() => setPage("goal")} />)}
          {page === "history" && (liveSession ? <HistoryPage /> : <NoSessionState onStart={() => setPage("goal")} />)}
        </main>
        {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} onCreate={(profile) => { setWorkspace((value) => addUser(value, profile)); setProfileOpen(false); setPage("home") }} />}
        {userOpen && createPortal(<UserSwitcher workspace={workspace} onClose={() => setUserOpen(false)} onAdd={() => { setUserOpen(false); setProfileOpen(true) }} onSelect={(id) => { setConfirmSwitchUserId(id); setUserOpen(false) }} onViewDetail={(id) => { setUserDetailUserId(id) }} />, document.body)}
        {userDetailUserId && createPortal(<UserDetailModal user={workspace.users.find(u => u.id === userDetailUserId)!} onClose={() => setUserDetailUserId(null)} />, document.body)}
        {confirmSwitchUserId && createPortal(<ConfirmSwitchUserModal targetUser={workspace.users.find(u => u.id === confirmSwitchUserId)} currentUser={currentUser} onCancel={() => setConfirmSwitchUserId(null)} onConfirm={() => { setWorkspace((value) => selectUser(value, confirmSwitchUserId)); setPage("home"); setConfirmSwitchUserId(null) }} />, document.body)}
        {providerOpen && <ApiConfigModal current={provider} dockerStatus={dockerStatus} onDockerSetup={() => { fetch("/orchestrator/docker-setup").then(r => r.json()).then(d => { if (d.ready) setDockerStatus({ ready: true }) }) }} onDockerReady={() => setDockerStatus({ ready: true })} onClose={() => { setProviderOpen(false); setOpenPlanAfterProvider(false) }} onSave={async (input) => { const saved = await saveProviderConfiguration(input); setProvider(saved); setProviderOpen(false); if (openPlanAfterProvider && currentUser) { const id = newClientId("plan"); setWorkspace((value) => addPlan(value, currentUser.id, { id, name: "待选择学习目标" })); setOpenPlanAfterProvider(false); setPage("goal") } }} />}
      </div>
    </LiveContext.Provider>
  )
}

function HomeDashboard({ user, mastered, providerConfigured, onNewPlan, onEnterPlan, onDeletePlan }: {
  user?: ReturnType<typeof activeUser>
  mastered: string[]
  providerConfigured: boolean
  onNewPlan: () => void
  onEnterPlan: (planId: string) => void
  onDeletePlan: (planId: string) => void
}) {
  const [metricOpen, setMetricOpen] = useState<"hallucination" | "adaptation" | "coverage" | null>(null)
  return <div className="page page-home dashboard-home">
    <section className="home-hero fluid-hero">
      <span className="hero-glow glow-one" /><span className="hero-glow glow-two" /><span className="hero-sweep" />
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={15} /> 欢迎回到 <span className="brand-art">KnowBalance</span></span><h1>Hello, <em>{user?.name ?? "新同学"}</em></h1><p className="hero-slogan"><span className="brand-art slogan-art">八位 Agent</span> 同心协作，<br/>&nbsp;&nbsp;&nbsp;&nbsp;让每次学习都有<span className="brand-art slogan-art">专属节奏</span>。</p><div className="hero-facts"><span><CalendarClock size={16} /> {user ? `每周 ${user.weeklyHours} 小时` : "正在建立档案"}</span><span><GraduationCap size={16} /> {user ? pythonLevelLabel(user.pythonLevel) : "认识你的起点"}</span><span className={providerConfigured ? "fact-ready" : "fact-warning"}><Settings2 size={16} /> {providerConfigured ? "通用模型已就绪" : "API待配置"}</span></div></div>
      <div className="hero-illustration" aria-hidden="true">
        <img src={learningCatIllustration} alt="KnowBalance 学习伙伴" className="hero-cat-illustration" />
        <div className="metric-bubbles">
          <button className="metric-bubble bubble-violet" type="button" onClick={() => setMetricOpen("hallucination")} aria-label="查看知识谬误率指标详情"><strong>＜5%</strong><small>知识谬误率</small></button>
          <button className="metric-bubble bubble-mint" type="button" onClick={() => setMetricOpen("adaptation")} aria-label="查看难度适配率指标详情"><strong>≥85%</strong><small>难度适配率</small></button>
          <button className="metric-bubble bubble-blue" type="button" onClick={() => setMetricOpen("coverage")} aria-label="查看知识点覆盖率指标详情"><strong>≥90%</strong><small>知识点覆盖率</small></button>
        </div>
        <div className="floating-decorations">
          <span className="float-star star-1">✦</span>
          <span className="float-star star-2">✧</span>
          <span className="float-star star-3">✦</span>
          <span className="float-star star-4">✧</span>
          <span className="float-star star-5">✦</span>
          {/* 窗户区域的星星 */}
          <span className="float-star window-star-1">✦</span>
          <span className="float-star window-star-2">✧</span>
          <span className="float-star window-star-3">✦</span>
          <span className="float-star window-star-4">✧</span>
          <span className="float-star window-star-5">✦</span>
          <span className="float-star window-star-6">✧</span>
          <span className="float-bubble bubble-1"></span>
          <span className="float-bubble bubble-2"></span>
          <span className="float-bubble bubble-3"></span>
          <span className="float-bubble bubble-4"></span>
          <span className="float-bubble bubble-5"></span>
        </div>
        <div className="hero-illustration-fade" />
      </div>
    </section>
    <AgentGallery />
    <section className="home-bento">
      <section className="plan-manager">
      <header><div><span className="section-kicker section-kicker-with-icon"><Layers3 size={18} /> 计划管理</span><h2>学习，从计划开始</h2><p>计划只保存草稿和主 Agent会话入口；路径、内容与评分仍由上游生成。</p></div><button className="primary-action new-plan-button" type="button" onClick={onNewPlan}>＋ 新建计划</button></header>
      {user?.plans.length ? <div className="plan-card-grid">{user.plans.map((plan, index) => <article className="plan-card" key={plan.id} onClick={() => onEnterPlan(plan.id)}><div className={`plan-number tone-${index % 4}`}>{String(index + 1).padStart(2,"0")}</div><div className="plan-card-copy"><span>{plan.sessionId ? stageLabelFromSaved(plan.stage) : "等待选择学习目标"}</span><h3>{plan.name}</h3><p>{plan.sessionId ? `主 Agent会话 · ${plan.status ?? "已保存"}` : "点击进入，选择章节或填写自定义目标"}</p></div><button className="delete-plan" type="button" aria-label={`删除${plan.name}`} onClick={(event) => { event.stopPropagation(); onDeletePlan(plan.id) }}><Trash2 size={16} /></button><ChevronRight className="plan-enter" size={20} /></article>)}</div> : <article className="empty-plan-panel"><FolderTree size={34} /><h3>还没有学习计划</h3><p>点击新建后直接选择章节或填写自定义目标，计划名会自动生成。</p><button className="primary-action" type="button" onClick={onNewPlan}>新建第一个计划</button></article>}
      </section>
      <aside className="mastery-island"><header><span className="mastery-icon"><CheckCircle2 /></span><div><span className="section-kicker-light"><BookOpen size={16} /> 学习历程</span><h2>已掌握</h2></div><strong>{mastered.length}</strong></header>{mastered.length ? <div className="mastery-cloud">{mastered.map((concept, index) => <span style={{ "--mastery-index": index } as React.CSSProperties} key={concept}>{concept}</span>)}</div> : <div className="mastery-empty"><p>完成主 Agent画像后，这里会记录公开的已掌握知识。</p><small>D 不根据计划名称或答题数量自行判断掌握。</small></div>}<footer><ShieldCheck size={15} /> 来自主 Agent公开画像</footer></aside>
    </section>
    <section className="home-value-river"><article><Bot /><div><b>协同正在发生</b><p>八个固定角色各守边界，D只接收主 Agent公开状态。</p></div></article><article><ShieldCheck /><div><b>每一步都有出处</b><p>题目、路径、讲义与测评均保留真实来源和审核状态。</p></div></article><article><Clock3 /><div><b>学习不会丢失</b><p>计划绑定服务端会话，刷新后仍能从当前阶段继续。</p></div></article></section>
    {metricOpen && <MetricDetailModal metric={metricOpen} onClose={() => setMetricOpen(null)} />}
  </div>
}

function MetricDetailModal({ metric, onClose }: { metric: "hallucination" | "adaptation" | "coverage"; onClose: () => void }) {
  const contents = {
    hallucination: {
      title: "专业知识谬误率（幻觉率）< 5%",
      badge: "正式口径 · 逐声明审核",
      emoji: "🛡️",
      intro: "AI 讲课会不会「编造」？我们把「防幻觉」做成了架构级约束，而不是靠提示词求 AI 自觉。",
      points: [
        { head: "只讲知识库里有据可查的事实", body: "生成讲义时必须引用知识库事实（K001/F001 粒度），未引用或引用无效即判定不合格。" },
        { head: "三道独立审核关卡", body: "事实审核 + 教学审核 + 资源适配审核逐层把关，未过审自动修复重生成。" },
        { head: "每句话都可溯源", body: "讲义每段都关联事实来源，前端「知识来源」可展开查看事实原文，一键核查。" },
      ],
      evidence: "正式报告按已审核事实声明给出问题声明数、总声明数与审核覆盖率；结果以 evaluation/results 的冻结报告为准。",
      tech: ["RAG 检索", "fact_id 强制溯源", "三层审核流水线", "自动修复重生成"],
    },
    adaptation: {
      title: "学习者画像-资源难度适配准确率 ≥ 85%",
      badge: "校准中",
      emoji: "🎯",
      intro: "同一份知识，对不同的人难度不一样。系统按每个学习者的能力画像，动态调配讲义、实验和测评的难度，让每个人都在「跳一跳够得着」的区间。",
      points: [
        { head: "先画像，再适配", body: "客观诊断生成三维能力画像（概念理解 / 代码认知 / 诊断表现），作为难度适配的依据。" },
        { head: "官方结构适配审核", body: "每轮生成后对比目标难度与实测难度（脚手架、认知负荷等维度），给出匹配/偏难/偏易判定。" },
        { head: "三档动态决策", body: "按审核结果自动切换：补救（remediate）/ 巩固（reinforce）/ 进阶（advance）。" },
      ],
      evidence: "适配审核引擎升级中，实测数据将在校准后更新（目标阈值 ≥85%）。",
      tech: ["三维能力画像", "target vs observed 对比", "resource_fit 审核", "三档动态决策"],
    },
    coverage: {
      title: "核心知识点覆盖率 ≥ 90%",
      badge: "正式口径 · 案例—事实计数",
      emoji: "🗺️",
      intro: "学得深不难，难的是「该学的都学到了」。系统按知识图谱组织内容，确保每个学习目标都被完整覆盖。",
      points: [
        { head: "知识点图谱化组织", body: "知识库按模块-知识点结构化组织，知识点间带前置依赖关系，形成可导航的学习图谱。" },
        { head: "目标-资源覆盖对照", body: "生成讲义时为每个学习目标规划内容分区（讲解/示例/误区/小结/检查），并公开覆盖对照。" },
        { head: "讲义-实验-测评三件套", body: "每个核心知识点配齐定制讲义、代码实验、正式测评，学练测闭环覆盖。" },
      ],
      evidence: "正式报告按每个案例的核心事实分别计数，只有内容实际表达、引用有效且审核支持时才计为覆盖。",
      tech: ["知识图谱", "前置依赖规划", "objective_coverage 对照", "学练测闭环"],
    },
  } as const
  const content = contents[metric]
  return <Modal title={content.title} subtitle={`${content.emoji} 核心指标 · ${content.badge}`} onClose={onClose} backdropClass="metric-modal-backdrop">
    <div className="metric-detail-body">
      <p className="metric-detail-intro">{content.intro}</p>
      <div className="metric-detail-points">{content.points.map((point, index) => <article key={index}><b><span className="metric-point-num">{index + 1}</span><em className="metric-point-head">{point.head}</em></b><p>{point.body}</p></article>)}</div>
      <div className="metric-detail-evidence"><strong>📊 实测数据</strong><p>{content.evidence}</p></div>
      <div className="metric-detail-tech">{content.tech.map((tag) => <span key={tag}>{tag}</span>)}</div>
    </div>
  </Modal>
}

function UserSwitcher({ workspace, onClose, onAdd, onSelect, onViewDetail }: { workspace: WorkspaceState; onClose: () => void; onAdd: () => void; onSelect: (id: string) => void; onViewDetail: (id: string) => void }) {
  return <div className="user-switcher-backdrop" role="presentation" onMouseDown={onClose}><section className="user-popover" role="dialog" aria-modal="true" aria-label="切换学习者" onMouseDown={(event) => event.stopPropagation()}><div className="popover-title"><div><span>学习者空间</span><b>切换学习者</b></div><button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div><div className="user-options">{workspace.users.map((user) => <div className={workspace.activeUserId === user.id ? "user-option-row is-active" : "user-option-row"} key={user.id}><button className="user-option-main" type="button" onClick={() => onSelect(user.id)}><span>{user.name.slice(0,1)}</span><div><b>{user.name}</b><small>{user.plans.length} 个计划 · 每周 {user.weeklyHours} 小时</small></div>{workspace.activeUserId === user.id && <Check size={16} />}</button><button className="user-option-detail" type="button" title="查看填写内容" onClick={(event) => { event.stopPropagation(); onViewDetail(user.id) }}><Eye size={15} /> 查看详情</button></div>)}</div><button className="add-user-button" type="button" onClick={onAdd}><UserPlus size={16} /> 新建学习者</button></section></div>
}

function UserDetailModal({ user, onClose }: { user: WorkspaceUser; onClose: () => void }) {
  const v2 = user.intakeVersion === 2
  return <div className="user-switcher-backdrop" role="presentation" onMouseDown={onClose}><section className="user-detail-modal" role="dialog" aria-modal="true" aria-label="学习者详情" onMouseDown={(event) => event.stopPropagation()}><div className="popover-title"><div><span>学习者详情</span><b>{user.name}</b></div><button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
    <div className="user-detail-body">
      <section className="user-detail-section"><h3>基础信息</h3><dl><div><dt>姓名</dt><dd>{user.name}</dd></div><div><dt>每周投入</dt><dd>{user.weeklyHours} 小时</dd></div><div><dt>Python 水平</dt><dd>{pythonLevelLabel(user.pythonLevel)}</dd></div><div><dt>学习风格</dt><dd>{learningStyleLabel(user.learningStyle)}</dd></div><div><dt>背景描述</dt><dd>{user.background || "未填写"}</dd></div>{user.priorLanguages?.length ? <div><dt>已学语言</dt><dd>{user.priorLanguages.join("、")}</dd></div> : null}</dl></section>
      {v2 ? <section className="user-detail-section"><h3>画像补充 · 结构化采集</h3><dl><div><dt>学习用途</dt><dd>{goalUseCaseLabel(user.goalUseCase)}</dd></div><div><dt>预期成果</dt><dd>{user.desiredOutcome || "未填写"}</dd></div><div><dt>单次时长</dt><dd>{user.sessionMinutes ? `${user.sessionMinutes} 分钟` : "未填写"}</dd></div><div><dt>讲解偏好</dt><dd>{explanationPreferenceDetailLabel(user.explanationPreference)}</dd></div><div><dt>练习偏好</dt><dd>{practicePreferenceDetailLabel(user.practicePreference)}</dd></div><div><dt>学习节奏</dt><dd>{pacePreferenceDetailLabel(user.pacePreference)}</dd></div>{user.preferredContexts?.length ? <div><dt>熟悉场景</dt><dd>{user.preferredContexts.join("、")}</dd></div> : null}{user.toolConstraints?.length ? <div><dt>工具约束</dt><dd>{user.toolConstraints.join("、")}</dd></div> : null}{user.accommodations?.length ? <div><dt>无障碍需求</dt><dd>{user.accommodations.join("、")}</dd></div> : null}{user.retention ? <div><dt>数据留存</dt><dd>{user.retention === "cross_session" ? "跨会话保留" : "仅本次会话"}</dd></div> : null}</dl></section> : <p className="user-detail-note">该学习者未走结构化采集表单，仅保留基础字段。</p>}
      <section className="user-detail-section"><h3>学习计划</h3>{user.plans.length ? <ul className="user-detail-plans">{user.plans.map((plan) => <li key={plan.id}><b>{plan.name}</b><small>{plan.sessionId ? `${stageLabelFromSaved(plan.stage)} · ${plan.status ?? "已保存"}` : "尚未建立主 Agent 会话"}</small></li>)}</ul> : <p className="user-detail-note">暂无学习计划。</p>}</section>
    </div>
    <div className="user-detail-actions"><button className="primary-action" type="button" onClick={onClose}>关闭</button></div>
  </section></div>
}

function ConfirmSwitchUserModal({ targetUser, currentUser, onCancel, onConfirm }: { targetUser: { name: string; plans: unknown[] } | undefined; currentUser?: { name: string }; onCancel: () => void; onConfirm: () => void }) {
  if (!targetUser) return null
  return <div className="user-switcher-backdrop" role="presentation" onMouseDown={onCancel}><section className="user-popover confirm-switch-modal" role="dialog" aria-modal="true" aria-label="确认切换用户" onMouseDown={(event) => event.stopPropagation()}><div className="popover-title"><div><span>确认切换</span><b>确定要切换学习者吗？</b></div></div><div className="confirm-switch-content"><div className="confirm-switch-icon"><UserRound size={28} /></div><p>即将从 <b>{currentUser?.name ?? "当前用户"}</b> 切换到 <b>{targetUser.name}</b></p><small>切换后将返回首页，当前学习进度会自动保存</small></div><div className="confirm-switch-actions"><button className="secondary-action" type="button" onClick={onCancel}>取消</button><button className="primary-action" type="button" onClick={onConfirm}>确认切换</button></div></section></div>
}

function ProfileModal({ onClose, onCreate }: { onClose: () => void; onCreate: (profile: LearnerProfileDraft) => void }) {
  const [name, setName] = useState("")
  const [weeklyHours, setWeeklyHours] = useState(5)
  const [pythonLevel, setPythonLevel] = useState<LearnerProfileDraft["pythonLevel"]>("beginner")
  const [learningStyle, setLearningStyle] = useState<LearnerProfileDraft["learningStyle"]>("balanced")
  const [background, setBackground] = useState("")
  const [languages, setLanguages] = useState("")
  const [goalUseCase, setGoalUseCase] = useState<NonNullable<LearnerProfileDraft["goalUseCase"]>>("coursework")
  const [desiredOutcome, setDesiredOutcome] = useState("")
  const [sessionMinutes, setSessionMinutes] = useState(30)
  const [pacePreference, setPacePreference] = useState<NonNullable<LearnerProfileDraft["pacePreference"]>>("steady")
  const [preferredContexts, setPreferredContexts] = useState("")
  const [toolConstraints, setToolConstraints] = useState("")
  const [accommodations, setAccommodations] = useState("")
  const [retention, setRetention] = useState<NonNullable<LearnerProfileDraft["retention"]>>("session_only")
  const splitItems = (value: string) => value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
  const save = () => onCreate({
    id: newClientId("learner"),
    name: name.trim(),
    weeklyHours,
    pythonLevel,
    learningStyle,
    background: background.trim(),
    priorLanguages: splitItems(languages),
    intakeVersion: 2,
    goalUseCase,
    desiredOutcome: desiredOutcome.trim(),
    sessionMinutes,
    explanationPreference: explanationPreferenceForStyle(learningStyle),
    practicePreference: practicePreferenceForStyle(learningStyle),
    pacePreference,
    preferredContexts: splitItems(preferredContexts),
    toolConstraints: splitItems(toolConstraints),
    accommodations: splitItems(accommodations),
    retention,
  })
  return <Modal title="认识你，从更合适的第一步开始" subtitle="这些明确选择会由 B 转换成教学策略，能力仍以客观诊断为准。" onClose={onClose}>
    <div className="form-grid">
      <label><span>怎么称呼你？</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：林晓" /></label>
      <label><span>你和 Python 的熟悉程度</span><select value={pythonLevel} onChange={(event) => setPythonLevel(event.target.value as LearnerProfileDraft["pythonLevel"])}><option value="new">完全没接触过</option><option value="beginner">了解一点基础</option><option value="intermediate">能写简单程序</option><option value="advanced">有项目经验</option></select></label>
      <label><span>这次学习主要用于</span><select value={goalUseCase} onChange={(event) => setGoalUseCase(event.target.value as typeof goalUseCase)}><option value="coursework">课程学习或作业</option><option value="competition">竞赛准备</option><option value="job">求职或岗位提升</option><option value="project">完成实际项目</option><option value="certification">考试或认证</option><option value="interest">个人兴趣</option><option value="other">其他</option></select></label>
      <label><span>你更喜欢怎样学？</span><select value={learningStyle} onChange={(event) => setLearningStyle(event.target.value as LearnerProfileDraft["learningStyle"])}><option value="balanced">讲解与练习平衡</option><option value="practice">先看例子、多动手</option><option value="concept">先理解原理</option><option value="project">按步骤完成项目</option></select></label>
      <label><span>每周预计学习时长</span><select value={weeklyHours} onChange={(event) => setWeeklyHours(Number(event.target.value))}>{[2,3,5,7,10,14].map((hours) => <option value={hours} key={hours}>{hours} 小时 / 周</option>)}</select></label>
      <label><span>单次学习时长</span><select value={sessionMinutes} onChange={(event) => setSessionMinutes(Number(event.target.value))}>{[15,20,30,45,60,90].map((minutes) => <option value={minutes} key={minutes}>{minutes} 分钟</option>)}</select></label>
      <label><span>学习节奏</span><select value={pacePreference} onChange={(event) => setPacePreference(event.target.value as typeof pacePreference)}><option value="slow">慢一些，多铺垫</option><option value="steady">稳定推进</option><option value="fast">快节奏、少重复</option></select></label>
      <label><span>画像保留方式</span><select value={retention} onChange={(event) => setRetention(event.target.value as typeof retention)}><option value="session_only">只用于当前会话</option><option value="cross_session">跨会话保留并更新</option></select></label>
      <label className="full-field"><span>目前的学习/工作背景</span><input value={background} onChange={(event) => setBackground(event.target.value)} placeholder="必填，例如：高中生、计算机专业大一、转行学习" /></label>
      <label className="full-field"><span>希望最终能够独立完成什么？</span><input value={desiredOutcome} onChange={(event) => setDesiredOutcome(event.target.value)} placeholder="例如：能独立编写并调试一个成绩统计程序" /></label>
      <label className="full-field"><span>熟悉的例子或应用场景</span><input value={preferredContexts} onChange={(event) => setPreferredContexts(event.target.value)} placeholder="选填，用顿号或逗号分隔" /></label>
      <label className="full-field"><span>接触过其他编程语言吗？</span><input value={languages} onChange={(event) => setLanguages(event.target.value)} placeholder="选填，用顿号或逗号分隔" /></label>
      <label className="full-field"><span>设备、软件或网络限制</span><input value={toolConstraints} onChange={(event) => setToolConstraints(event.target.value)} placeholder="选填，例如：只能使用浏览器、网络不稳定" /></label>
      <label className="full-field"><span>阅读或无障碍需求</span><input value={accommodations} onChange={(event) => setAccommodations(event.target.value)} placeholder="选填，例如：短段落、减少术语密度" /></label>
    </div>
    <div className="modal-actions"><button className="secondary-action" type="button" onClick={onClose}>以后再说</button><button className="primary-action" disabled={!name.trim() || !background.trim()} type="button" onClick={save}>保存学习档案</button></div>
  </Modal>
}

function profileSelfRating(level: LearnerProfileDraft["pythonLevel"]): "beginner" | "basic" | "intermediate" | "integrated" {
  return ({ new: "beginner", beginner: "basic", intermediate: "intermediate", advanced: "integrated" } as const)[level]
}

function explanationPreferenceForStyle(style: LearnerProfileDraft["learningStyle"]): NonNullable<LearnerProfileDraft["explanationPreference"]> {
  return ({ practice: "example_first", concept: "principle_first", project: "step_by_step", balanced: "balanced" } as const)[style]
}

function practicePreferenceForStyle(style: LearnerProfileDraft["learningStyle"]): NonNullable<LearnerProfileDraft["practicePreference"]> {
  return ({ practice: "coding", concept: "quiz", project: "project", balanced: "mixed" } as const)[style]
}


function ApiConfigModal({ current, dockerStatus, onDockerSetup, onDockerReady, onClose, onSave }: { current: { configured: boolean; endpoint: string; model_id: string }; dockerStatus: { ready: boolean; error?: string }; onDockerSetup: () => void; onDockerReady: () => void; onClose: () => void; onSave: (input: { endpoint: string; modelId: string; apiKey: string }) => Promise<void> }) {
  const [endpoint, setEndpoint] = useState(current.endpoint || "https://api.deepseek.com/chat/completions")
  const [modelId, setModelId] = useState(current.model_id || "deepseek-chat")
  const [apiKey, setApiKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState("")
  const submit = async () => { setSaving(true); setFailure(""); try { await onSave({ endpoint: endpoint.trim(), modelId: modelId.trim(), apiKey: apiKey.trim() }) } catch (reason) { setFailure(reason instanceof Error ? reason.message : "保存失败") } finally { setSaving(false) } }
  return <Modal title={current.configured ? "切换通用模型 API" : "先连接你的通用模型"} subtitle="密钥只发送到本机主 Agent并保存于本地运行目录，浏览器不会保存或再次读取它。" onClose={onClose}>
    <div className={`docker-status-banner ${dockerStatus.ready ? "is-ready" : "is-warning"}`}>
      {dockerStatus.ready
        ? <><CheckCircle2 size={16} /><span>Docker 代码沙箱已就绪</span></>
        : <><ShieldCheck size={16} /><span>{dockerStatus.error ?? "正在检测 Docker…"}</span></>}
      {!dockerStatus.ready && <button className="docker-setup-button" type="button" onClick={() => {
        setFailure("正在配置 Docker，请稍候…（可能需要 30 秒）")
        onDockerSetup()
        // 轮询直到 Docker 稳定就绪：要求连续 3 次确认（约 9 秒稳定期），
        // 避免 Docker Desktop 冷启动时引擎瞬时可用就被误判为完成
        let stableCount = 0
        const poll = setInterval(async () => {
          try {
            const res = await fetch("/orchestrator/docker-status")
            const data = await res.json()
            if (data?.docker?.ready) {
              stableCount += 1
              if (stableCount >= 3) {
                clearInterval(poll)
                setFailure("")
                onDockerReady()
              }
            } else {
              stableCount = 0
            }
          } catch {
            stableCount = 0
          }
        }, 3000)
        setTimeout(() => { clearInterval(poll); setFailure("Docker 配置超时。请手动启动 Docker Desktop 后刷新页面。") }, 45000)
      }}>🔧 一键配置 Docker</button>}
    </div>
    <div className="api-security-note"><ShieldCheck size={19} /><div><b>本机配置，不进入前端计划</b><p>保存后主 Agent立即使用新配置；接口响应只返回模型名称和地址，不返回密钥。</p></div></div>
    <div className="form-grid"><label className="full-field"><span>兼容接口地址</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://.../chat/completions" /></label><label><span>模型 ID</span><input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="deepseek-chat" /></label><label><span>API Key</span><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={current.configured ? "输入新密钥以切换" : "仅发送到本机主 Agent"} /></label></div>{failure && <p className="form-error">{failure}</p>}<div className="modal-actions"><button className="secondary-action" type="button" onClick={onClose}>取消</button><button className="primary-action" disabled={saving || !endpoint.trim() || !modelId.trim() || !apiKey.trim()} type="button" onClick={() => void submit()}>{saving ? "正在安全保存…" : "保存并启用"}</button></div></Modal>
}

function Modal({ title, subtitle, onClose, children, backdropClass }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; backdropClass?: string }) {
  return <div className={`modal-backdrop ${backdropClass ?? ""}`} role="presentation" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" aria-label="关闭" onClick={onClose}><X /></button></header>{children}</section></div>
}

function pythonLevelLabel(level: LearnerProfileDraft["pythonLevel"]) {
  return ({ new: "Python 零基础", beginner: "Python 入门阶段", intermediate: "Python 进阶阶段", advanced: "Python 项目阶段" })[level]
}

function goalUseCaseLabel(value?: GoalUseCase) {
  return ({ coursework: "课程学习", competition: "竞赛", job: "求职就业", project: "项目学习", certification: "考证", interest: "兴趣探索", other: "其他" } as Record<string, string>)[value ?? ""] ?? value ?? "未填写"
}
function goalUseCaseDetail(value?: GoalUseCase) {
  return ({ coursework: "贴近课本 · 基础概念讲起 · 练习以选择与基础应用为主", competition: "重算法原理 · 复杂度与边界条件 · 编程与综合题占比更高", job: "更重实际工作场景 · 代码阅读 · 错误排查 · 小型项目练习", project: "重任务拆解 · 可交付成果导向 · 综合应用", certification: "按考纲覆盖考点 · 高频练习与自测", interest: "按兴趣节奏推进 · 通俗讲解为主", other: "按你的背景灵活调整讲解方式" } as Record<string, string>)[value ?? ""] ?? ""
}
function learningStyleLabel(value?: LearningStyle) {
  return ({ practice: "偏练习", concept: "偏概念", project: "偏项目", balanced: "均衡" } as Record<string, string>)[value ?? ""] ?? value ?? "未填写"
}
function explanationPreferenceDetailLabel(value?: ExplanationPreference) {
  return ({ analogy_first: "先类比", principle_first: "先讲原理", example_first: "先看例子", step_by_step: "分步讲解", balanced: "均衡" } as Record<string, string>)[value ?? ""] ?? value ?? "未填写"
}
function practicePreferenceDetailLabel(value?: PracticePreference) {
  return ({ quiz: "选择题", coding: "引导编程", project: "项目任务", mixed: "混合练习" } as Record<string, string>)[value ?? ""] ?? value ?? "未填写"
}
function pacePreferenceDetailLabel(value?: PacePreference) {
  return ({ slow: "慢速稳步", steady: "匀速推进", fast: "快速推进" } as Record<string, string>)[value ?? ""] ?? value ?? "未填写"
}

function stageLabelFromSaved(stage?: string) {
  return ({ objective_diagnosis: "正在客观诊断", assessment: "学习资源已生成", completed: "计划已完成", blocked: "等待处理阻塞", failed: "流程需要恢复" } as Record<string, string>)[stage ?? ""] ?? "主 Agent会话已建立"
}


function Atmosphere() {
  return <div className="ambient-layer" aria-hidden="true"><span className="ambient-blob blob-blue" /><span className="ambient-blob blob-mint" /><span className="ambient-blob blob-gold" /><span className="ambient-grid" /><div className="learning-constellation"><i className="constellation-line line-a" /><i className="constellation-line line-b" /><b className="constellation-node node-main">M</b><b className="constellation-node node-a">A</b><b className="constellation-node node-b">B</b><b className="constellation-node node-c">C</b></div></div>
}

function NavButton({ item, current, onClick, disabled = false }: { item: (typeof navItems)[number]; current: Page; onClick: (page: Page) => void; disabled?: boolean }) {
  const Icon = item.icon
  return <button className={current === item.id ? "is-active" : ""} disabled={disabled} type="button" onClick={() => onClick(item.id)}><Icon size={16} />{item.label}</button>
}

export function GoalPage({ onContinue: _onContinue }: { onContinue: () => void }) {
  const { create, busy, dockerReady } = useLive()
  const chapters = PYTHON_CURRICULUM
  const initial = initialGoalSelection()
  const [mode, setMode] = useState<"catalog" | "custom">(initial.mode)
  const [selected, setSelected] = useState(initial.selectedNodeId)
  const [customGoal, setCustomGoal] = useState(initial.customGoal)
  const selectedTopic = chapters.flatMap((chapter) => chapter.topics).find((topic) => topic.node_id === selected)
  return <div className="page narrow-page"><PageHeading kicker="建立学习目标" title="这次，你想真正学会什么？" description="课程目录来自仓库中的 Python curriculum；也可以保留自定义目标模式。历史学习情况由主 Agent读取，不再要求你重复填写。" />
    <div className="segmented"><button className={mode === "catalog" ? "is-active" : ""} onClick={() => setMode("catalog")} type="button">从课程目录选择</button><button className={mode === "custom" ? "is-active" : ""} onClick={() => setMode("custom")} type="button">自定义学习目标</button></div>
    {mode === "catalog" ? <div className="chapter-grid">{chapters.map((chapter) => <article className={`chapter-card ${chapter.tone}`} key={chapter.node_id}><h2>{chapter.title}</h2>{chapter.topics.map((topic) => <button className={selected === topic.node_id ? "is-selected" : ""} type="button" key={topic.node_id} onClick={() => setSelected(topic.node_id)}><span>{topic.title}</span>{selected === topic.node_id && <Check size={16} />}</button>)}</article>)}</div> : <article className="custom-goal-card"><label htmlFor="custom-goal">用自己的话描述学习目标</label><textarea id="custom-goal" value={customGoal} onChange={(event) => setCustomGoal(event.target.value)} /><p>主 Agent会把自定义描述映射到真实课程知识与学习路径；D 不在本地推断结果。</p></article>}
    <div className="history-read-card"><div className="history-icon"><History /></div><div><b>历史学习情况由主 Agent处理</b><p>D 不要求用户手动填写薄弱知识，也不预先声称历史已经读取；画像生成后再展示主 Agent公开结果。</p></div><span>服务端负责</span></div>
    <div className="page-actions">{!dockerReady ? <p className="docker-gate-note"><ShieldCheck size={15} /> 创建学习计划前需要 Docker 代码沙箱。请先打开右上角「API设置」→ 检查 Docker 状态 → 一键配置 Docker。</p> : null}<button className="primary-action" disabled={Boolean(busy) || !dockerReady || (mode === "custom" ? customGoal.trim().length === 0 : !selectedTopic)} type="button" onClick={() => void create(mode === "custom" ? { goal: customGoal.trim(), custom: true, planName: planNameFromGoal({ mode: "custom", customGoal }) } : { goal: `学习${selectedTopic?.title ?? "Python基础"}`, nodeId: selectedTopic?.node_id, planName: planNameFromGoal({ mode: "catalog", chapterTitle: selectedTopic?.title ?? "Python基础" }) })}>{busy ? "正在创建会话…" : "确认目标并创建主 Agent会话"} <ArrowRight /></button></div>
  </div>
}

export function DiagnosisPage({ onContinue: _onContinue }: { onContinue: () => void }) {
  const { isLive, diagnosisAnswers: liveAnswers, setDiagnosisAnswer, submitDiagnosis, busy } = useLive()
  const activeSession = useRequiredSession()
  const [index, setIndex] = useState(0)
  if (activeSession.waiting_for?.type === "profile_answers") {
    return <ProfileClarificationForm questions={activeSession.waiting_for.items as ProfileQuestionView[]} />
  }
  if (activeSession.waiting_for?.type === "profile_gap_questions") {
    return <ProfileGapForm questions={activeSession.waiting_for.items as any[]} session={activeSession} />
  }
  const items = activeSession.waiting_for?.type === "diagnosis_answers" ? activeSession.waiting_for.items as any[] : []
  const previewItems = items
  const answers = isLive ? liveAnswers : {}
  const item = previewItems[index]
  if (!item) return <EmptyState title="当前会话没有公开题目" body="D 不会为了页面完整而自造诊断题。主 Agent 会在取得 A 的事实证据后调用 AI 当次命题。" />
  return <div className="page diagnosis-page"><PageHeading kicker="客观诊断 · 主 Agent实时题目" title="一次只回答一个问题" description="题目由 AI 根据当前学习目标、A 的事实证据和公开题面历史当次生成；D 只展示公开题干和来源。" /><LearningLoopStepper session={activeSession} />
    <section className="diagnosis-shell"><div className="diagnosis-progress"><span>问题 {index + 1} / {previewItems.length}</span><div><i style={{ width: `${((index + 1) / previewItems.length) * 100}%` }} /></div><b>{Math.round(((index + 1) / previewItems.length) * 100)}%</b></div><article className="question-card"><div className="question-meta"><span>{item.difficulty ?? "诊断题"}</span><span>{item.concept}</span><span>{item.source_id}</span></div><h2>{item.question}</h2>{item.options?.length ? <div className="diagnosis-options">{item.options.map((option: string, optionIndex: number) => <button type="button" className={answers[item.item_id] === option ? "is-selected" : ""} onClick={() => setDiagnosisAnswer(item.item_id, option)} key={`${optionIndex}-${option}`}><span>{String.fromCharCode(65 + optionIndex)}</span><b>{option}</b>{answers[item.item_id] === option && <Check size={18} />}</button>)}</div> : <textarea placeholder="写下你的回答" value={answers[item.item_id] ?? ""} onChange={(event) => setDiagnosisAnswer(item.item_id, event.target.value)} />}
      <details className="why-question"><summary><CircleHelp size={16} /> 为什么问我这道题？</summary><p>用于诊断：{item.concept}。题目来源：{item.source_id}{item.fact_id ? ` / ${item.fact_id}` : ""}。D 不在浏览器中保存答案键。</p></details></article>
      <div className="diagnosis-actions"><button className="secondary-action" disabled={index === 0} type="button" onClick={() => setIndex((value) => value - 1)}><ChevronLeft /> 上一题</button>{index < previewItems.length - 1 ? <button className="primary-action" disabled={!answers[item.item_id]} type="button" onClick={() => setIndex((value) => value + 1)}>下一题 <ChevronRight /></button> : <button className="primary-action" disabled={Boolean(busy) || !diagnosisComplete(activeSession, answers)} type="button" onClick={() => void submitDiagnosis()}>{busy ? "正在生成学习资源…" : "提交诊断并生成学习方案"} <ArrowRight /></button>}</div></section>
  </div>
}

function ProfileGapForm({ questions, session }: { questions: any[]; session: unknown }) {
  const { submitProfileGap, busy } = useLive()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const complete = questions.every((q) => answers[q.question_id]?.trim())
  const submit = async () => {
    if (!complete) return
    setError(null)
    try {
      for (const q of questions) {
        await submitProfileGap(q.question_id, q.source_id ?? "", answers[q.question_id])
      }
      setDone(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提交失败，请重试")
    }
  }
  if (done) return <EmptyState title="已记录你的困难" body="主 Agent正在根据你的反馈调整下一轮内容…" />
  return <div className="page diagnosis-page"><PageHeading kicker="画像追问 · B主动提问" title="刚才的题目，你主要卡在哪里？" description="B 会在补救轮次主动询问具体困难，用于更精确地调整下一轮讲解；答案会写回你的学习记忆。" /><LearningLoopStepper session={session as never} />{questions.map((q) => <div className="profile-gap-card" key={q.question_id}><div className="profile-gap-head"><span><MessageCircleQuestion size={16} /></span><div><b>{q.question}</b>{q.reason ? <small>{q.reason}</small> : null}</div></div><div className="profile-gap-options">{q.options?.map((option: string) => <button className={answers[q.question_id] === option ? "is-selected" : ""} type="button" key={option} onClick={() => setAnswers((current) => ({ ...current, [q.question_id]: option }))}><span>{String.fromCharCode(65 + (q.options?.indexOf(option) ?? 0))}</span><b>{option}</b></button>)}</div></div>)}{error ? <p className="profile-gap-error" role="alert">{error}</p> : null}<div className="page-actions"><button className="primary-action" disabled={Boolean(busy) || !complete} type="button" onClick={() => void submit()}>{busy ? "正在提交…" : "提交我的困难"}</button></div></div>
}

function confidenceDimensionLabel(dim: string): string {
  const labels: Record<string, string> = {
    goal: "学习目标",
    goal_profile: "目标用途",
    level: "学习等级",
    knowledge_state: "知识掌握",
    learning_barrier: "学习障碍",
    task_ability: "任务能力",
    explanation_preference: "讲解偏好",
    practice_preference: "练习偏好",
  }
  return labels[dim] ?? dim
}

function barrierLabel(barrier: string): string {
  const labels: Record<string, string> = {
    concept_recall: "概念忘记",
    code_translation: "不会转代码",
    debugging: "不会调试",
    boundary_condition: "边界条件",
    problem_understanding: "题目没看懂",
    unknown: "不确定",
  }
  return labels[barrier] ?? barrier
}

interface ProfileQuestionView {
  id: string
  prompt: string
  reason: string
  answer_type: "text" | "number" | "single_choice" | "multi_text"
  options?: Array<{ value: string; label: string }>
}

function ProfileClarificationForm({ questions }: { questions: ProfileQuestionView[] }) {
  const { submitProfileClarification, busy } = useLive()
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const complete = questions.every((question) => answers[question.id]?.trim())
  const submit = () => submitProfileClarification(questions.map((question) => ({
    question_id: question.id,
    value: question.answer_type === "number"
      ? Number(answers[question.id])
      : question.answer_type === "multi_text"
        ? answers[question.id]!.split(/[、,，]/).map((item) => item.trim()).filter(Boolean)
        : answers[question.id]!,
  })))
  return <div className="page narrow-page"><PageHeading kicker="画像补充 · B结构化采集" title="先补充几项会真正影响教学方式的信息" description="主 Agent逐项收集缺失字段；背景只用于表达与任务组织，能力仍由接下来的客观诊断确定。" />
    <section className="custom-goal-card"><div className="form-grid">{questions.map((question) => <label className="full-field" key={question.id}><span>{question.prompt}</span>{question.answer_type === "single_choice" ? <select value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}><option value="">请选择</option>{question.options?.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select> : <input type={question.answer_type === "number" ? "number" : "text"} min={question.answer_type === "number" ? 1 : undefined} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder={question.answer_type === "multi_text" ? "可填写多项，用顿号或逗号分隔" : "请填写"} />}<small>{question.reason}</small></label>)}</div></section>
    <div className="page-actions"><button className="primary-action" disabled={!complete || Boolean(busy)} type="button" onClick={() => void submit()}>{busy ? "正在提交…" : "提交并继续客观诊断"} <ArrowRight /></button></div>
  </div>
}

function PathPage({ planName, onContinue }: { planName?: string; onContinue: () => void }) {
  const { retry, reset, busy } = useLive()
  const activeSession = useRequiredSession()
  const profile = activeSession.profile
  // 完整 LearnerProfileV2（背景/偏好/约束/进度）由 publicSessionView 附加到 profile_v2；无则回退 v1 字段。
  const profileDetail = (activeSession as any).profile_v2 ?? profile
  if (profileDetail && (activeSession as any).learning_barriers?.length) {
    profileDetail.learning_barriers = (activeSession as any).learning_barriers
  }
  const profileConfidence = (activeSession as any).profile_confidence ?? null
  const formalPath = activeSession.formal_path as any
  const ragResult = activeSession.rag_result as any
  const objectives = activeSession.current_path_node?.objectives ?? []
  const displayPlanName = planName && planName !== "待选择学习目标"
    ? planName
    : formalPath?.original_goal ?? profile?.goal ?? activeSession.current_path_node?.goal ?? "当前学习计划"
  const pathNodes = Array.isArray(formalPath?.nodes) ? formalPath.nodes : []
  const ragItems = Array.isArray(ragResult?.results) ? ragResult.results : []
  const radar = abilityRadarView(profile)
  const chain = pathChainView(pathNodes as any, ragItems, profile?.known_concepts ?? [])
  const candidateCards = knowledgeCandidateCards(activeSession.rag_result, {
    current_path_node: activeSession.current_path_node,
    formal_path: formalPath,
    profile,
  })
  const titleForPathNode = (node: any) => pathNodeTitle(node, ragItems, formalPath?.original_goal)
  const currentFullNode = pathNodes.find((node: any) => node?.node_id === activeSession.current_path_node?.node_id) ?? activeSession.current_path_node
  const whyCurrent = pathNodeWhyView(currentFullNode, ragItems, profile?.known_concepts ?? [], formalPath?.original_goal)
  const hasLesson = Boolean(activeSession.learning_resources.concept_lesson?.payload)
  const hasBlockedResource = activeSession.status === "blocked" || activeSession.status === "failed"
  const recoveryAction = blockedSessionAction(activeSession)
  if (!activeSession.current_path_node) return <BlockedResourceState session={activeSession} busy={busy} onRetry={() => void retry()} onRestart={reset} title="学习方案尚未形成可恢复检查点" />
  return <div className="page path-page week2-plan-page">
    <PageHeading kicker="学习方案 · Week 2 可视化报告" title={`本次计划：${displayPlanName}`} description="诊断完成后先在这里查看主 Agent公开的画像、A知识检索候选、正式路径和Agent协同过程；只有你主动点击后才进入 C 生成的互动学习内容。" />
    <LearningLoopStepper session={activeSession} />

    <section className="week2-summary-grid">
      <article className="profile-visual-card profile-visual-wide">
        <header><span><UserRound size={18} /></span><div><small>学习者画像 · B公开结果</small><h2>{profile ? difficultyLabel(profile.level) : "尚未生成画像"}</h2></div></header>
        {profile ? <div className="profile-layout">
          <div className="profile-layout-main">
          <div className="profile-level-track"><i style={{ width: `${difficultyPosition(profile.level)}%` }} /><b style={{ left: `${difficultyPosition(profile.level)}%` }} /></div>
          <div className="profile-level-labels"><span>入门</span><span>基础</span><span>进阶</span><span>综合</span></div>
          <div className={`ability-radar ${radar.status === "verified" ? "is-verified" : "is-pending"}`} aria-label="能力雷达图">
            {radar.status === "verified" ? <RadarChart dimensions={radar.dimensions} /> : <div><b>等待 B 公开</b><span>能力维度与数值</span></div>}
          </div>
          <p className="radar-caption">能力雷达图 · {radar.status === "verified" ? "B公开维度" : "待上游数据"}</p>
          {radar.status === "verified" && <div className="radar-legend">
            <p><b>概念理解</b> — 已知概念 ÷（已知+薄弱），封底 20% 封顶 95%</p>
            <p><b>代码认知</b> — 画像等级映射：入门 20% / 基础 45% / 进阶 70% / 综合 90%</p>
            <p><b>诊断表现</b> — 客观题正确数 ÷ 总作答数，封底 15% 封顶 100%</p>
          </div>}
          <dl><div><dt>本次目标</dt><dd>{profile.goal}</dd></div><div><dt>已掌握</dt><dd>{profile.known_concepts.length ? profile.known_concepts.join("、") : "主 Agent未公开已掌握概念"}</dd></div><div><dt>待补强</dt><dd className="weak-concept-cell">{profile.weak_concepts.length ? profile.weak_concepts.map((concept) => <em className="weak-concept-tag" key={concept} title="知识盲区">{concept}</em>) : "本轮诊断未公开薄弱概念"}</dd></div></dl>
          <p className="truth-note">能力雷达需要B公开多个能力维度及数值。当前合同只公开等级和概念集合，因此D不虚构雷达百分比。</p>
          </div>
          <div className="profile-detail-block">
            <b className="profile-detail-title"><Sparkles size={13} /> 画像详情 · 驱动个性化生成</b>
            {profileDetail.background_context || profileDetail.goal_context || profileDetail.learning_preferences ? <div className="profile-detail-sections">
              {profileDetail.background_context ? <section className="profile-detail-section"><header><span className="pd-icon pd-icon-person"><UserRound size={13} /></span><b>背景信息</b></header><div className="pd-grid"><div><dt>教育阶段</dt><dd>{profileDetail.background_context.education_stage || "未公开"}</dd></div><div><dt>身份角色</dt><dd>{profileDetail.background_context.role_context || "未公开"}</dd></div><div><dt>学科背景</dt><dd>{profileDetail.background_context.discipline_background?.length ? profileDetail.background_context.discipline_background.join("、") : "未公开"}</dd></div><div><dt>先备知识</dt><dd>{profileDetail.background_context.prior_topics?.length ? profileDetail.background_context.prior_topics.join("、") : profileDetail.background_context.prior_languages?.length ? profileDetail.background_context.prior_languages.join("、") : "未公开"}</dd></div></div></section> : null}
              {profileDetail.goal_context ? <section className="profile-detail-section"><header><span className="pd-icon pd-icon-goal"><Target size={13} /></span><b>目标用途</b></header><div className="pd-goal"><span className="pd-use-case">{useCaseLabel(profileDetail.goal_context.use_case)}</span>{profileDetail.goal_context.desired_outcome ? <p>{profileDetail.goal_context.desired_outcome}</p> : null}{profileDetail.goal_context.deadline ? <small>目标期限：{profileDetail.goal_context.deadline}</small> : null}</div></section> : null}
              {profileDetail.learning_preferences ? <section className="profile-detail-section"><header><span className="pd-icon pd-icon-pref"><SlidersHorizontal size={13} /></span><b>学习偏好</b></header><div className="pd-chips"><span title="讲解方式">{explanationPreferenceLabel(profileDetail.learning_preferences.explanation)}</span><span title="练习方式">{practicePreferenceLabel(profileDetail.learning_preferences.practice)}</span><span title="学习节奏">{pacePreferenceLabel(profileDetail.learning_preferences.pace)}</span>{profileDetail.learning_preferences.preferred_contexts?.length ? <span title="熟悉场景">{profileDetail.learning_preferences.preferred_contexts.join("、")}</span> : null}</div></section> : null}
              {profileDetail.learning_constraints ? <section className="profile-detail-section"><header><span className="pd-icon pd-icon-time"><Clock size={13} /></span><b>时间与工具</b></header><div className="pd-grid"><div><dt>每周投入</dt><dd>{formatMinutes(profileDetail.learning_constraints.weekly_time_budget_minutes)}</dd></div><div><dt>单次时长</dt><dd>{profileDetail.learning_constraints.session_time_budget_minutes ? formatMinutes(profileDetail.learning_constraints.session_time_budget_minutes) : "未公开"}</dd></div>{profileDetail.learning_constraints.tool_constraints?.length ? <div><dt>工具约束</dt><dd>{profileDetail.learning_constraints.tool_constraints.join("、")}</dd></div> : null}{profileDetail.learning_constraints.accommodations?.length ? <div><dt>无障碍需求</dt><dd>{profileDetail.learning_constraints.accommodations.join("、")}</dd></div> : null}</div></section> : null}
              {profileDetail.progress ? <section className="profile-detail-section"><header><span className="pd-icon pd-icon-progress"><TrendingUp size={13} /></span><b>知识点掌握进度</b></header>{(() => { const mastery = profileDetail.progress.mastery_by_source_id || {}; const keys = Object.keys(mastery); return keys.length ? <div className="pd-mastery">{keys.slice(0, 6).map((key) => <div className="pd-mastery-row" key={key}><span>{key}</span><i><em style={{ width: `${Math.round((mastery[key] ?? 0) * 100)}%` }} /></i><b>{Math.round((mastery[key] ?? 0) * 100)}%</b></div>)}</div> : <p className="pd-empty">尚未产生测评证据，掌握度将在后续轮次更新</p> })()}<div className="pd-progress-meta"><span>最近准确率：{profileDetail.progress.last_assessment_accuracy != null ? `${Math.round(profileDetail.progress.last_assessment_accuracy * 100)}%` : "暂无"}</span>{profileDetail.progress.recent_error_patterns?.length ? <span>高频错误：{profileDetail.progress.recent_error_patterns.slice(0, 3).join("、")}</span> : null}</div></section> : null}
              {profileDetail.self_assessment || profileDetail.ability_dimensions?.length ? <section className="profile-detail-section"><header><span className="pd-icon pd-icon-evidence"><Scale size={13} /></span><b>证据与判断</b></header>{profileDetail.self_assessment ? <div className="pd-evidence-row"><span className="pd-evidence-label">你的自评</span><em className="pd-self">{difficultyLabel(profileDetail.self_assessment.reported_level)}</em>{profileDetail.ability_dimensions?.length ? <span className="pd-evidence-label">客观诊断</span> : null}{profileDetail.ability_dimensions?.length ? <em className="pd-objective">{difficultyLabel((() => { const byValue = [...profileDetail.ability_dimensions].sort((a, b) => b.value - a.value)[0]; return byValue?.value >= 0.7 ? "integrated" : byValue?.value >= 0.45 ? "intermediate" : byValue?.value >= 0.2 ? "basic" : "beginner" })())}</em> : null}</div> : null}{profileDetail.ability_dimensions?.length ? <div className="pd-evidence-dims">{profileDetail.ability_dimensions.map((dim: { label: string; value: number }) => <div className="pd-dim-row" key={dim.label}><span>{dim.label}</span><i><em style={{ width: `${Math.round(dim.value * 100)}%` }} /></i><b>{Math.round(dim.value * 100)}%</b></div>)}</div> : null}<p className="pd-evidence-note">能力由客观诊断决定（客观答题结果为最高依据）；自评仅作参考，冲突时以客观为准。</p></section> : null}
              {profileDetail.learning_barriers?.length ? <section className="profile-detail-section"><header><span className="pd-icon pd-icon-barrier"><TriangleAlert size={13} /></span><b>学习障碍</b></header><div className="pd-barrier-chips">{[...new Map(profileDetail.learning_barriers.map((entry) => [entry.barrier, entry])).values()].map((entry) => <span className={`pd-barrier-tag pd-barrier-${entry.barrier}`} key={entry.barrier} title={`${entry.source_id} · 出现 ${entry.count} 次`}>{barrierLabel(entry.barrier)}<em>{entry.count}</em></span>)}</div><p className="pd-evidence-note">由 B 在补救轮次主动追问"你主要卡在哪里"获得，用于精确调整下一轮讲解。</p></section> : null}
              {profileConfidence ? <section className="profile-detail-section"><header><span className="pd-icon pd-icon-confidence"><Gauge size={13} /></span><b>画像置信度</b></header><div className="pd-confidence-grid">{(Object.entries(profileConfidence.fields ?? {}) as Array<[string, { confidence: number; impact: number; evidence_count: number; status: string }]>).map(([dim, field]) => <div className="pd-confidence-row" key={dim}><span className={field.status === "sufficient" ? "is-sufficient" : ""} title={confidenceDimensionLabel(dim)}>{confidenceDimensionLabel(dim)}</span><i><em className={field.status === "sufficient" ? "is-sufficient" : ""} style={{ width: `${Math.round(field.confidence * 100)}%` }} /></i><b>{Math.round(field.confidence * 100)}%</b><small>{field.evidence_count} 条</small></div>)}</div><p className="pd-evidence-note">B 按"教学影响度 × 不确定性"决定追问优先级；达到 75% 置信度即停止追问。</p></section> : null}
            </div> : <p className="pd-empty">主 Agent尚未公开画像详情字段（背景 / 目标 / 偏好 / 约束 / 进度）。</p>}
            <div className="profile-detail-footer">
              <span><BadgeCheck size={12} /> 画像版本 {profileDetail.profile_version ?? "v1"}</span>
              {profileDetail.provenance?.field_sources?.length ? <span className="pd-sources">数据来源：{sourceLabel(profileDetail.provenance.field_sources[0]?.source)} · {profileDetail.provenance.field_sources.length} 项已记录</span> : <span>由主 Agent基于背景、自评与客观诊断生成</span>}
            </div>
          </div>
        </div> : <MissingContent text="主 Agent尚未公开 B 学习者画像。" />}
      </article>
    </section>

    <div className="wave-divider wave-divider-top" aria-hidden="true" />
    <section className="week2-lower-grid">
      <article className="knowledge-match-card">
        <header><span><Target size={18} /></span><div><small>知识检索匹配 · A检索 / B采用</small><h2>{candidateCards.length ? `${candidateCards.length} 个知识候选` : "尚无知识候选"}</h2></div></header>
        {candidateCards.length ? <div className="knowledge-candidate-grid">{candidateCards.map((candidate, index) => <article className="knowledge-candidate" key={candidate.sourceId}><div className="knowledge-candidate-top"><span>{String(index + 1).padStart(2, "0")}</span><div><small>知识候选</small><h3>{candidate.title}</h3></div></div><div className="knowledge-candidate-detail"><span>知识点</span><b>{candidate.sourceId}</b></div><div className="knowledge-candidate-reasons"><span>为何选</span>{candidate.reasons.length ? <ol>{candidate.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ol> : <p>A 已检索到该知识点，B 将其纳入正式学习路径；当前公开字段未说明更具体的采用原因。</p>}</div></article>)}</div> : <MissingContent text="主 Agent尚未公开知识候选。" />}
        <p className="truth-note">A 先检索知识候选，B 再结合学习目标、学习者画像和先修关系进行选择与排序，形成正式学习路径；这里展示的是被 B 采用的知识节点。</p>
      </article>
      <article className="current-objectives-card"><header><span className="card-head-icon"><MapPin size={18} /></span><div><small>当前节点与观察目标</small><h2>{titleForPathNode(activeSession.current_path_node)}</h2></div><span>{activeSession.current_path_node?.goal && titleForPathNode(activeSession.current_path_node) !== activeSession.current_path_node.goal ? `${activeSession.current_path_node.goal} · ` : ""}{activeSession.current_path_node?.node_id}</span></header>{whyCurrent ? <p className="node-why"><b>为什么学它：</b>{whyCurrent}</p> : null}<div className="path-chain">{chain.map((entry: any, index: number) => <div className="chain-item" key={entry.node_id}><article className={`chain-node chain-${entry.status}`}><span className="chain-status">{entry.status === "completed" || entry.status === "reference_mastered" ? <Check size={15} /> : <i />}</span><div className="chain-body"><b>{entry.title}</b><small>{entry.source_id}{entry.status === "reference_mastered" ? " · 已掌握" : entry.status === "reference_pending" ? " · 先修" : ""}</small></div><em>{entry.status === "completed" ? "本轮已学习" : entry.status === "in_progress" ? "当前节点" : entry.status === "blocked" ? "受阻" : entry.status === "reference_mastered" ? "已掌握" : entry.status === "reference_pending" ? "先修待补" : "待学习"}</em></article>{index < chain.length - 1 && <ArrowDown className="chain-arrow" size={15} />}</div>)}</div>{objectives.length ? <div className="objective-list"><small className="objective-kicker">当前节点观察目标</small>{objectives.map((objective, index) => <article key={objective.objective_id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{pathNodeTitle({ target_source_ids: [objective.source_id] }, ragItems)} · {behaviorLabel(objective.observable_behavior)}</b><p>来源 {objective.source_id} · 事实 {objective.required_fact_ids.length ? objective.required_fact_ids.join("、") : "尚未绑定"} · {objective.importance}</p></div></article>)}</div> : null}</article>
      <div className="wave-divider wave-divider-bottom" aria-hidden="true" />
      <article className="agent-collaboration-card"><header><span className="card-head-icon"><Bot size={18} /></span><div><small>Agent协同过程 · 主 Agent台账</small><h2>{activeSession.worker_ledger.length} 个Worker状态</h2></div></header><div className="agent-collaboration-list">{activeSession.worker_ledger.map((worker) => <article key={worker.worker}><span className={`agent-status status-${worker.status}`} /><div><b>{workerLabel(worker.worker)}</b><p>{worker.summary ?? "主 Agent未公开摘要"}</p></div><em>{worker.status}</em></article>)}</div></article>
      <ContentReviewCard session={activeSession} />
    </section>


    {hasBlockedResource && <section className="plan-resource-status is-blocked"><ShieldCheck /><div><b>学习方案已保存，C互动资源尚未通过可信门禁</b><p>{activeSession.blocked_reason ?? "主 Agent未公开具体阻塞原因"}</p></div><button className="secondary-action" disabled={Boolean(busy)} type="button" onClick={recoveryAction.canRetry ? () => void retry() : reset}>{busy ? "正在恢复…" : recoveryAction.label}</button></section>}
    <section className="plan-enter-learning"><div><b>{hasLesson ? "互动学习资源已由主 Agent公开" : "互动学习资源尚未发布"}</b><p>{hasLesson ? "你可以主动进入C生成并经可信审核的讲义、代码实验和理解检查。" : "学习方案仍可查看；D不会用静态内容冒充C资源。"}</p></div><button className="primary-action" disabled={!hasLesson} type="button" onClick={onContinue}>进入互动学习 <ArrowRight /></button></section>
    <section className="provenance-note"><ShieldCheck /><div><b>Week 2 可视化只展示真实上游结果</b><p>画像和路径来自B，难度匹配与证据来自A，学习内容与测评来自C，协同状态来自主 Agent；D只负责可视化，不生成结论。</p></div></section>
  </div>
}

function ContentReviewCard({ session }: { session: PublicSessionFixture }) {
  const review = session.content_review
  if (!review) return null
  return <article className="agent-collaboration-card"><header><span className="card-head-icon"><ShieldCheck size={18} /></span><div><small>内容审核 · 发布门禁</small><h2>{reviewStatusLabel(review.overall_status)}</h2></div></header><div className="agent-collaboration-list">{Object.entries(review.workers).map(([worker, state]) => <article key={worker}><span className={`agent-status status-${state.status}`} /><div><b>{workerLabel(worker)}</b><p>{state.last_error ?? `审核 ${state.review_attempt_no} 次，修复 ${state.repair_attempt_no} 次`}</p></div><em>{state.published ? "published" : state.status}</em></article>)}</div><p className="truth-note">{review.publish_allowed ? "审核已通过，公开资源允许展示。" : "审核未通过前，D 不展示 C 的讲义、代码实验或正式测评。"}</p></article>
}

function resourceFitBasisText(entry: ResourceFitEntry): string {
  const basis = entry.verdict === "fit" ? "与目标一致" : "与目标存在差异"
  const reasons = entry.reasonLabels.length ? ` · ${entry.reasonLabels.join("；")}` : ""
  return `目标 ${basis}（结构适配指数 ${Math.round(entry.score * 100)}/100）${reasons}`
}

function ResourceMatchCard({ session, resource, assessment, compact = false }: { session: PublicSessionFixture; resource: any; assessment?: AssessmentPayload; compact?: boolean }) {
  const match = resourceMatchView(session, resource, assessment)
  const ringStyle = { "--match-score": `${match.score * 3.6}deg` } as React.CSSProperties
  const resourceKindLabel = (kind: string) => ({ concept_lesson: "定制讲义", code_lab: "代码实验", assessment: "正式测评" } as Record<string, string>)[kind] ?? kind
  const verdictLabel = (verdict: string) => ({ fit: "匹配", too_hard: "偏难", too_easy: "偏易", uncertain: "未判定" } as Record<string, string>)[verdict] ?? verdict
  return <article className={`resource-match-card ${compact ? "is-compact" : ""} is-${match.source}`} aria-label="本轮结构适配指数">
    <header><span><Sparkles size={15} /> 本轮结构适配指数</span><em>{match.label}</em></header>
    <div className="resource-match-score" style={ringStyle}><div><strong>{match.score}</strong><small>/ 100</small></div></div>
    <div className="resource-match-summary"><b>{match.label}</b><p>{match.source === "official" ? `规则估计 · ${match.overallVerdict === "fit" ? "整体匹配" : match.overallVerdict === "too_hard" ? "整体偏难" : match.overallVerdict === "too_easy" ? "整体偏易" : "未判定"}` : "讲义与正式测评面向当前画像的页面展示指数"}</p>{match.aggregation && match.aggregation.weakestScore !== undefined ? <small className="resource-match-aggregation">加权平均 {match.aggregation.weightedMean} · 最弱资源 {resourceKindLabel(match.aggregation.weakestKind)} {match.aggregation.weakestScore} · 瓶颈保护后 {match.aggregation.finalScore}</small> : null}</div>
    {match.source === "official" && match.resources.length
      ? <div className="resource-fit-list">{match.resources.map((entry) => <div className={`resource-fit-row is-${entry.verdict}`} key={entry.artifactId}>
          <div className="resource-fit-kind"><b>{resourceKindLabel(entry.kind)}</b><em>{verdictLabel(entry.verdict)}</em></div>
          <div className="resource-fit-meter"><i style={{ width: `${Math.round(entry.score * 100)}%` }} /></div>
          <span className="resource-fit-score">{Math.round(entry.score * 100)}</span>
          {entry.mismatchedDimensions.length ? <small className="resource-fit-note">需关注：{entry.reasonLabels.join("、")}</small> : <small className="resource-fit-note ok">未发现显著维度偏差</small>}
        </div>)}</div>
      : <dl>
          <div><dt>学习目标覆盖</dt><dd>{match.matchedObjectiveCount} / {match.objectiveCount || "--"}<span>{match.objectiveScore}分</span></dd></div>
          <div><dt>画像 · 资源层级</dt><dd>{match.learnerLevel} · {match.resourceLevel}<span>{match.levelScore}分</span></dd></div>
          <div><dt>内容审核</dt><dd>{match.reviewLabel}<span>{match.reviewScore == null ? "待返回" : `${match.reviewScore}分`}</span></dd></div>
        </dl>}
    <details><summary>查看匹配依据 <ChevronDown size={14} /></summary>
      {match.source === "official"
        ? <ul>{match.resources.map((entry) => <li key={entry.artifactId}><b>{resourceKindLabel(entry.kind)}</b>：{resourceFitBasisText(entry)}</li>)}</ul>
        : <ul><li>覆盖当前路径或本轮适配目标</li><li>对比 B 画像等级与公开资源层级</li><li>读取主 Agent公开的内容审核状态</li></ul>}
      <p>{match.note}</p></details>
  </article>
}

function LessonPage({ user, onAssessment }: { user?: WorkspaceUser; onAssessment: () => void }) {
  const { retry, reset, runPublishedCodeLab, debugPublishedCodeLab, runExampleCode, busy } = useLive()
  const activeSession = useRequiredSession()
  const lesson = activeSession.learning_resources.concept_lesson?.payload
  const lab = activeSession.learning_resources.code_lab?.payload
  const adaptation = activeAdaptationView(activeSession)
  const profileV2 = (activeSession as any).profile_v2 ?? activeSession.profile
  const [tab, setTab] = useState<LessonTab>("lesson")
  const [sideTab, setSideTab] = useState<SideTab>("evidence")
  const switchTab = (next: LessonTab) => {
    setTab(next)
    // 理解检查和代码实验优先展示各自的 C 公开提示。
    if (next === "checks" || next === "lab") setSideTab("hint")
    else setSideTab("evidence")
  }
  const [activeSection, setActiveSection] = useState("prerequisite")
  const [visitedSections, setVisitedSections] = useState<Set<string>>(new Set())
  const [matchOpen, setMatchOpen] = useState(false)
  const [code, setCode] = useState(lab?.starter_code ?? "")
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({})
  const [lastExecutedCode, setLastExecutedCode] = useState<string | null>(null)
  const lessonArtifactId = activeSession.learning_resources.concept_lesson?.artifact_id
  useEffect(() => {
    setCode(lab?.starter_code ?? "")
    setGapAnswers({})
    setLastExecutedCode(null)
  }, [activeSession.round_no, activeSession.learning_resources.code_lab?.payload?.lab_id])
  // 切到新讲义时清空已读记录（按 artifact 身份隔离，不带旧讲义的进度）。
  useEffect(() => {
    setVisitedSections(new Set())
    setActiveSection("prerequisite")
  }, [lessonArtifactId])
  if (!lesson) return <BlockedResourceState session={activeSession} busy={busy} onRetry={() => void retry()} onRestart={reset} title="互动学习资源未通过可信发布" />
  const sections = lesson ? lessonOutline(lesson) : []
  const visibleSectionCount = sections.filter((section) => section.visible).length
  const readingProgress = visibleSectionCount === 0
    ? 0
    : Math.round((visitedSections.size / visibleSectionCount) * 100)
  // 已读 = 主动点击目录访问；滚动仅更新高亮（activeSection），不记为已读。
  const handleSectionClick = (id: string) => {
    setActiveSection(id)
    setVisitedSections((prev) => (prev.has(id) ? prev : new Set([...prev, id])))
  }
  const handleSectionScroll = (id: string) => {
    setActiveSection(id)
  }
  return <div className="lesson-page"><LearningLoopStepper session={activeSession} /><header className="lesson-topline"><div><span className="eyebrow"><BookOpen size={15} /> 第 {activeSession.round_no} 轮学习</span>{adaptation ? <span className={`lesson-adaptation-badge is-${adaptation.adaptation_action}`}>{adaptation.adaptation_action === "remediate" ? "针对性补救" : adaptation.adaptation_action === "reinforce" ? "巩固强化" : "下一节点适配"}</span> : null}{user?.goalUseCase ? <span className="lesson-goal-badge"><Target size={13} /> {goalUseCaseLabel(user.goalUseCase)}导向</span> : null}<h1>{lesson?.title ?? "当前没有可发布的 C 讲义"}<button className="resource-match-trigger" type="button" onClick={() => setMatchOpen(true)} aria-label="查看本轮结构适配指数"><Sparkles size={14} />结构适配指数</button></h1><p>{activeSession.current_path_node?.node_id} · {lesson?.objective_ids.join(" / ")}</p>{user?.goalUseCase ? <div className="lesson-goal-note">本讲义按你的目标定制：{goalUseCaseDetail(user.goalUseCase)}</div> : null}{profileV2?.learning_preferences || profileV2?.progress ? <div className="lesson-profile-note"><Sparkles size={14} /><b>画像驱动本轮生成</b><span>{profileV2.learning_preferences?.explanation ? `讲解方式：${explanationPreferenceDetailLabel(profileV2.learning_preferences.explanation)}` : ""}{profileV2.learning_preferences?.practice ? ` · 练习方式：${practicePreferenceDetailLabel(profileV2.learning_preferences.practice)}` : ""}{profileV2.learning_preferences?.pace ? ` · 节奏：${pacePreferenceDetailLabel(profileV2.learning_preferences.pace)}` : ""}{profileV2.progress?.last_assessment_accuracy != null ? ` · 上轮准确率 ${Math.round(profileV2.progress.last_assessment_accuracy * 100)}%` : ""}</span></div> : null}{adaptation ? <div className="lesson-adaptation-note"><TrendingUp size={14} /><b>本轮适配：{adaptation.adaptation_action === "remediate" ? "针对性补救" : adaptation.adaptation_action === "reinforce" ? "巩固强化" : "下一节点适配"}</b><span>{adaptation.adaptation_summary}</span>{adaptation.addressed_misconception_tags.length ? <em>针对误区：{adaptation.addressed_misconception_tags.join("、")}</em> : null}</div> : null}</div><div className="lesson-top-actions"><span><CheckCircle2 size={15} /> 主 Agent已发布公开学习资源</span><button type="button" onClick={onAssessment}>进入正式测评 <ArrowRight /></button></div></header>
    <div className="lesson-tabs lesson-tabs-standalone" role="tablist"><span className={`tab-glider glider-${tab}`} aria-hidden="true" /><button className={tab === "lesson" ? "is-active" : ""} type="button" onClick={() => switchTab("lesson")}><BookOpen size={17} /> 定制讲义</button><button className={tab === "lab" ? "is-active" : ""} type="button" onClick={() => switchTab("lab")}><Code2 size={17} /> 代码实验</button><button className={tab === "checks" ? "is-active" : ""} type="button" onClick={() => switchTab("checks")}><ListChecks size={17} /> 理解检查</button></div>
    <div className={`lesson-layout${tab === "lesson" ? "" : tab === "lab" ? " lab-fullwidth" : " lesson-layout-no-outline"}`}>
      {tab === "lesson" ? <aside className="lesson-outline"><div className="outline-head"><FolderTree size={18} /><b>本节目录</b></div>{sections.map((section, index) => <button className={activeSection === section.id ? "is-active" : ""} type="button" onClick={() => { handleSectionClick(section.id); document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) }} key={section.id}><span>{String(index + 1).padStart(2, "0")}</span><b>{section.title}</b></button>)}<div className="outline-progress"><span>阅读进度</span><div><i style={{ width: `${readingProgress}%` }} /></div><small>已读 {visitedSections.size} / {visibleSectionCount} 节</small></div></aside> : null}
      <section className="lesson-main">
        {!lesson ? <EmptyState title="C 讲义尚未发布" body="D 不会生成占位知识。请等待主 Agent返回 learning_resources.concept_lesson。" /> : tab === "lesson" ? <LessonContent lesson={lesson} onActive={handleSectionScroll} onRunExample={runExampleCode} /> : tab === "lab" ? <LabContent lab={lab} code={code} setCode={setCode} gapAnswers={gapAnswers} setGapAnswers={setGapAnswers} busy={busy} execution={activeSession.code_execution?.labId === lab?.lab_id ? activeSession.code_execution : null} onDebug={async (publicCaseId) => { if (!lab || !debugPublishedCodeLab) return; const submission = lab.programming_task?.submission_mode === "gap_answers" ? { gap_answers: gapAnswers } : code; await debugPublishedCodeLab(lab.lab_id, submission, publicCaseId) }} onRun={async () => { if (!lab) return; const submission = lab.programming_task?.submission_mode === "gap_answers" ? { gap_answers: gapAnswers } : code; await runPublishedCodeLab(lab.lab_id, submission); setLastExecutedCode(typeof submission === "string" ? submission : JSON.stringify(submission)) }} /> : <ChecksContent lesson={lesson} />}
      </section>
      {tab !== "lab" ? <aside className="lesson-side">{tab === "checks" ? <><div className="side-tabs"><button className={sideTab === "hint" ? "is-active" : ""} onClick={() => setSideTab("hint")} type="button">学习提示</button></div>{sideTab === "hint" ? <HintPanel resource={lesson} /> : null}</> : tab === "lab" ? <><div className="side-tabs"><button className={sideTab === "hint" ? "is-active" : ""} onClick={() => setSideTab("hint")} type="button">实验提示</button><button className={sideTab === "evidence" ? "is-active" : ""} onClick={() => setSideTab("evidence")} type="button">知识来源</button><button className={sideTab === "agents" ? "is-active" : ""} onClick={() => setSideTab("agents")} type="button">Agent过程</button></div>{sideTab === "hint" ? <HintPanel resource={lab} /> : sideTab === "evidence" ? <EvidencePanel resource={lab} /> : <AgentPanel />}</> : <><div className="side-tabs"><button className={sideTab === "evidence" ? "is-active" : ""} onClick={() => setSideTab("evidence")} type="button">知识来源</button><button className={sideTab === "agents" ? "is-active" : ""} onClick={() => setSideTab("agents")} type="button">Agent过程</button></div>{sideTab === "evidence" ? <EvidencePanel resource={lesson} /> : <AgentPanel />}</>}</aside> : null}
          </div>
          {matchOpen ? <Modal title="本轮结构适配指数" subtitle="规则估计 · 尚未校准" onClose={() => setMatchOpen(false)}><ResourceMatchCard session={activeSession} resource={lesson} assessment={activeSession.assessment?.payload} /></Modal> : null}
  </div>
}

function LessonContent({ lesson, onActive, onRunExample }: { lesson: LessonPayload; onActive: (id: string) => void; onRunExample: (code: string) => Promise<any> }) {
  return <div className="lesson-document">
    <LessonSection id="prerequisite" title="连接已有知识" tone="warm" icon={<Layers3 />} onActive={onActive}>{lesson.prerequisite_bridge.length ? lesson.prerequisite_bridge.map((block) => <RenderLessonBlock block={block} key={block.block_id} />) : <p className="no-prerequisite-note">当前结点无前置知识结点</p>}</LessonSection>
    <LessonSection id="concept" title="核心概念" tone="plain" icon={<Lightbulb />} onActive={onActive}>{lesson.explanation_blocks.map((block) => block.block_type === "paragraph"
      ? <SemanticLessonPoints key={block.block_id} text={(block as any).text ?? ""} />
      : <RenderLessonBlock block={block} key={block.block_id} onRunExample={onRunExample} />)}</LessonSection>
    <LessonSection id="examples" title="分步示例" tone="blue" icon={<Braces />} onActive={onActive}>{lesson.worked_examples.length ? lesson.worked_examples.map((block) => <RenderLessonBlock block={block} key={block.block_id} onRunExample={onRunExample} />) : <MissingContent text="C 未公开 worked_examples" />}</LessonSection>
    <LessonSection id="misconceptions" title="常见误区" tone="amber" icon={<MessageCircleQuestion />} onActive={onActive}>{lesson.misconceptions.length ? <ul className="lesson-point-list misconception-point-list">{lesson.misconceptions.map((item) => <li key={item.misconception_tag}><b>{item.objective_id}</b>{lessonPointParagraphs(item.explanation).map((para, pIndex) => <span className="misconception-text" key={`${item.misconception_tag}-${pIndex}`}>{para}</span>)}<small>{formatCitations(item.citations)}</small></li>)}</ul> : <MissingContent text="C 未公开 misconceptions" />}</LessonSection>
    <LessonSection id="summary" title="本节小结" tone="mint" icon={<CheckCircle2 />} onActive={onActive}>{lesson.summary.length ? <ol className="summary-list">{lesson.summary.flatMap((block) => { const raw = "text" in block ? (block as any).text ?? "" : ""; const cleaned = stripClaimTextFromBody(raw, (block as any).claims ?? []); return cleaned.split(/\n+/).filter(Boolean).map((line, j, arr) => { return <li key={`${block.block_id}-${j}`}><p className="summary-line">{line.trim()}</p></li>; }) })}</ol> : <MissingContent text="C 未公开 summary" />}</LessonSection>
  </div>
}

function LessonSection({ id, title, tone, icon, children, onActive }: { id: string; title: string; tone: string; icon: React.ReactNode; children: React.ReactNode; onActive: (id: string) => void }) {
  return <section id={`section-${id}`} className={`lesson-section tone-${tone}`} onMouseEnter={() => onActive(id)}><header><span>{icon}</span><h2>{title}</h2></header>{children}</section>
}

function SemanticLessonText({ text }: { text: string }) {
  const indented = indentParagraphText(text)
  return <>{semanticLessonLines(indented).map((line, index) => <span className="semantic-lesson-line" key={`${index}-${line}`}>{line}</span>)}</>
}

/**
 * 圆点分段的讲义正文：每个段落（空行或换行分隔）前带小圆点，
 * 圆点与段落首行对齐；段落之间留空行，段落内部换行紧凑不空行。
 */
function SemanticLessonPoints({ text }: { text: string }) {
  const paragraphs = lessonPointParagraphs(text)
  if (paragraphs.length === 0) return null
  return <ul className="lesson-point-list">{paragraphs.map((paragraph, index) => <li key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph.split(/\r?\n/u).map((line, lineIndex) => <span className="point-line" key={lineIndex}>{line}</span>)}</li>)}</ul>
}

/** 事实证据：C 公开的 claim 文本 + 引用来源，离上文空一行，紫色小字。 */
function ClaimEvidence(_props: { claims: Array<{ claim_id: string; text: string }>; citations: Citation[] }) {
  return null
}

/** 从段落文本中移除已作为 ClaimEvidence 独立展示的 claim 文本，避免重复。 */
function stripClaimTextFromBody(bodyText: string, _claims: Array<{ text: string }>): string {
  return stripDuplicateNumberedSteps(bodyText)
}

/**
 * C 生成的段落有时同时包含"第一步：xxx。第二步：yyy。"文字版步骤
 * 和"1. xxx 2. yyy"数字列表版（内容重复）。检测到这种重复时，
 * 删除数字列表部分，只保留"第X步"文字版。
 */
function stripDuplicateNumberedSteps(text: string): string {
  const cnSteps = [...text.matchAll(/第[一二三四五六七八九十]+步[：:]/g)]
  if (cnSteps.length < 2) return text
  // 数字列表部分：从 "1." 或 "1、" 开始到结尾
  const numberedMatch = text.match(/(?:^|[。；;\n])\s*1[\.、]\s*[\s\S]*$/)
  if (!numberedMatch || numberedMatch.index == null) return text
  const head = text.slice(0, numberedMatch.index)
  const numberedPart = numberedMatch[0].replace(/^[。；;\n]\s*/, "")
  // 提取数字列表项（1. 2. 3. ...）逐条与"第X步"内容比对，确认重复才删除
  const numberedItems = numberedPart.split(/(?=\d+[\.、]\s*)/).map((s) => s.replace(/^\d+[\.、]\s*/, "").trim()).filter(Boolean)
  if (numberedItems.length === 0) return text
  // 提取"第X步"内容（去掉前缀"第一步："）
  const stepTexts = cnSteps.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length
    const end = cnSteps[i + 1]?.index ?? text.length
    return text.slice(start, end).replace(/[。；;\n].*$/, "").trim()
  })
  const stepNorm = stepTexts.map((s) => s.replace(/[\s，。,；;：:（）()]/g, ""))
  const itemNorm = numberedItems.map((s) => s.replace(/[\s，。,；;：:（）()]/g, ""))
  // 每条数字项都至少与某个步骤内容有 60% 相似（或包含关系）
  const allDuplicate = numberedItems.every((item) => {
    const iNorm = item.replace(/[\s，。,；;：:（）()]/g, "")
    return stepNorm.some((s) => s.includes(iNorm) || iNorm.includes(s) || (iNorm.length > 4 && s.length > 4 && (s.includes(iNorm.slice(0, Math.max(4, Math.floor(iNorm.length * 0.6)))))))
  })
  if (!allDuplicate) return text
  return head.trimEnd() + (head.endsWith("。") || head.endsWith("；") || head.endsWith(";") ? "" : "。")
}

function RenderLessonBlock({ block, onRunExample }: { block: LessonPayload["explanation_blocks"][number]; onRunExample?: (code: string) => Promise<any> }) {
  const claims = ("claims" in block && Array.isArray((block as any).claims) ? (block as any).claims as Array<{ claim_id: string; text: string }> : [])
  const citations = claims.flatMap((claim) => (claim as any).citations ?? [])
  const bodyText = "text" in block ? stripClaimTextFromBody((block as any).text ?? "", claims) : ""
  if (block.block_type === "heading") return <h3 className="block-heading">{block.text}</h3>
  if (block.block_type === "paragraph") return <article className="prose-block"><p><SemanticLessonText text={bodyText} /></p><ClaimEvidence claims={claims} citations={citations} /></article>
  if (block.block_type === "code") return <article className="code-example"><div className="code-head"><span>{block.caption ?? "Python 示例"}</span><small>{block.language}</small></div><CodeViewer code={block.code} onRun={onRunExample} /><CitationChips citations={citations} /></article>
  if (block.block_type === "callout") return <article className={`callout callout-${block.tone}`}><b>{block.title}</b><p><SemanticLessonText text={bodyText} /></p><ClaimEvidence claims={claims} citations={citations} /></article>
  if (block.block_type === "comparison") return <article className="comparison-block"><h3>{block.title}</h3><div>{block.columns.map((column) => <section key={column.heading}><b>{column.heading}</b><p><SemanticLessonText text={stripClaimTextFromBody(column.content, claims)} /></p></section>)}</div><ClaimEvidence claims={claims} citations={citations} /></article>
  return null
}

const Editor = ((EditorExport as unknown as { default?: typeof EditorExport }).default ?? EditorExport) as typeof EditorExport

function highlightPython(code: string): string {
  try {
    const grammar = Prism.languages.python ?? Prism.languages.plain
    return Prism.highlight(code, grammar, "python")
  } catch {
    return code.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character))
  }
}

function PythonCodeBlock({ code, className = "" }: { code: string; className?: string }) {
  return <pre className={`python-code-block ${className}`.trim()}><code className="language-python" dangerouslySetInnerHTML={{ __html: highlightPython(code) }} /></pre>
}

function PythonCodeEditor({ value, onChange, minHeight = 260, ariaLabel = "Python 代码编辑器", executionMode }: { value: string; onChange: (value: string) => void; minHeight?: number; ariaLabel?: string; executionMode?: string }) {
  return <div className="python-editor" aria-label={ariaLabel}><Editor value={value} onValueChange={onChange} highlight={highlightPython} padding={16} textareaId={ariaLabel.replace(/\s+/g, "-")} style={{ minHeight, fontFamily: 'Consolas, "Liberation Mono", monospace', fontSize: 13, lineHeight: 1.7 }} /><p className="code-submit-hint">{codeSubmissionHint(executionMode)}</p></div>
}

function judgeVerdictLabel(verdict: NonNullable<PublicSessionFixture["code_execution"]>["verdict"]): string {
  return ({
    accepted: "评测通过",
    compile_error: "语法错误",
    wrong_answer: "结果错误",
    presentation_error: "输出格式错误",
    runtime_error: "运行时错误",
    time_limit_exceeded: "运行超时",
    memory_limit_exceeded: "内存超限",
    output_limit_exceeded: "输出超限",
    security_violation: "违反运行规则",
    internal_error: "评测服务异常",
  } as const)[verdict ?? "internal_error"]
}

function CodeViewer({ code, onRun }: { code: string; onRun?: (code: string) => Promise<any> }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ status: string; stdout: string; error?: string } | null>(null)
  const lines = normalizePythonDisplayIndentation(code).split("\n")
  const run = async () => {
    if (!onRun || running) return
    setRunning(true)
    setResult(null)
    try {
      const execution = await onRun(code)
      const stdout = typeof execution?.stdout === "string" ? execution.stdout : ""
      const error = typeof execution?.error === "string" ? execution.error : ""
      if (execution?.status === "blocked" || error) {
        setResult({ status: "failed", stdout, error: error || "运行失败" })
      } else {
        setResult({ status: "ok", stdout })
      }
    } catch (reason) {
      setResult({ status: "failed", stdout: "", error: reason instanceof Error ? reason.message : "运行失败" })
    } finally {
      setRunning(false)
    }
  }
  return <div className="code-viewer"><div className="code-lines">{lines.map((line, index) => <div key={`${index}-${line}`}><span>{index + 1}</span><code className="language-python" dangerouslySetInnerHTML={{ __html: highlightPython(line || " ") }} /></div>)}</div>
    <div className="example-run-bar">{onRun ? <button className="example-run-button" type="button" onClick={() => void run()} disabled={running}>{running ? <span className="spinner" /> : <Play size={14} />}{running ? "运行中…" : "运行代码"}</button> : null}{result ? <span className={`example-run-status is-${result.status}`}>{result.status === "ok" ? "运行完成" : "运行失败"}</span> : null}</div>
    {result ? <pre className={`example-run-output${result.status === "ok" ? "" : " is-error"}`}>{result.stdout || result.error || "（无输出）"}</pre> : null}
  </div>
}

function labGuideSections(instructions: CodeLabPayload["instructions"]) {
  // 按"实践目标/操作步骤/预期结果/验收标准/常见错误/拓展任务"标题分区；无结构化标题时返回 null（保持原样渲染）
  const keywords = ["实践目标", "操作步骤", "前置条件", "示例代码", "预期结果", "验收标准", "常见错误", "错误与解决", "拓展任务", "实践任务"]
  const heads = instructions.filter((block) => block.block_type === "heading")
  const headTexts = heads.map((block) => (block as any).title ?? (block as any).text ?? "")
  const matched = headTexts.filter((text) => keywords.some((keyword) => text.includes(keyword)))
  if (matched.length < 2) return null
  const sections: Array<{ title: string; blocks: typeof instructions }> = []
  let current: { title: string; blocks: typeof instructions } | null = null
  for (const block of instructions) {
    const text = block.block_type === "heading" ? ((block as any).title ?? (block as any).text ?? "") : ""
    if (block.block_type === "heading" && keywords.some((keyword) => text.includes(keyword))) {
      current = { title: text, blocks: [] }
      sections.push(current)
    } else if (current) {
      current.blocks.push(block)
    }
  }
  return sections.length ? sections : null
}

function labHintLadder(lab?: CodeLabPayload): { objective_id: string; hints: Array<{ hint_level: number; text: string; citations: any[] }> } | null {
  // 优先取 lab.hint_ladders（完整结构），回退 programming_task.hint_ladders（简化结构）
  if (lab?.hint_ladders?.length) return lab.hint_ladders[0]
  const taskLadder = (lab as any)?.programming_task?.hint_ladders
  if (taskLadder?.length) return { objective_id: "programming-task", hints: taskLadder.map((h: any) => ({ hint_level: h.level, text: h.text, citations: [] })) }
  return null
}

function LabHintPanel({ lab }: { lab?: CodeLabPayload }) {
  const [level, setLevel] = useState(1)
  const ladder = labHintLadder(lab)
  const hint = ladder?.hints.find((item) => item.hint_level === level)
  return <div className="lab-hint-ladder"><h3><Lightbulb size={15} /> 三级提示 · 卡住时逐步展开</h3>{hint ? <><p className="hint-copy">{hint.text}</p>{hint.citations?.length ? <CitationChips citations={hint.citations} /> : null}<div className="hint-levels">{[1, 2, 3].map((value) => <button className={level === value ? "is-active" : ""} type="button" onClick={() => setLevel(value)} key={value}>提示 {value}</button>)}</div></> : <p className="muted-copy">C 未公开本实验的分层提示。</p>}</div>
}

function LabContent({ lab, code, setCode, gapAnswers, setGapAnswers, busy, execution, onDebug, onRun }: { lab?: CodeLabPayload; code: string; setCode: (code: string) => void; gapAnswers: Record<string, string>; setGapAnswers: (answers: Record<string, string>) => void; busy: string; execution: PublicSessionFixture["code_execution"]; onDebug: (publicCaseId: string) => Promise<void>; onRun: () => Promise<void> }) {
  if (!lab) return <EmptyState title="代码实验尚未发布" body="D 不会自造 starter code 或测试。请等待主 Agent返回 learning_resources.code_lab。" />
  const task = lab.programming_task
  const gapMode = task?.submission_mode === "gap_answers" && task.gap_template
  const gapIssues = gapMode
    ? Object.fromEntries(task!.gap_template!.gaps.map((gap) => [gap.gap_id, gapAnswerIssue(gap, gapAnswers[gap.gap_id] ?? "")]))
    : {}
  const gapReady = Boolean(gapMode && task!.gap_template!.gaps.every((gap) =>
    gapAnswers[gap.gap_id]?.trim() && !gapIssues[gap.gap_id]))
  const guidedOutput = Boolean(gapMode && task!.gap_template!.gaps.every((gap) =>
    effectiveGapAnswerFormat(gap) === "python_string_literal"))
  const legacyGuidedOutput = Boolean(guidedOutput && task!.gap_template!.gaps.some((gap) => !gap.answer_format))
  const feedback = labFeedbackExplanations(execution?.feedback)
  const checklist = execution && execution.status !== "passed"
    ? publicTestChecklist(lab.public_tests)
    : []
  const firstPublicCaseId = task?.public_examples[0]?.case_id ?? lab.public_tests[0]?.test_id
  const anchorIds = ["lab-task", ...(lab.practical_guide ? ["lab-guide-block"] : []), ...(lab.reflection_questions?.length ? ["lab-reflect"] : [])]
  const [activeAnchorId, setActiveAnchorId] = useState(anchorIds[0] ?? "lab-task")
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.boundingClientRect.top < window.innerHeight * 0.5) setActiveAnchorId(entry.target.id)
      }
    }, { threshold: 0.05 })
    for (const id of anchorIds) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])
  return <div className="lab-workspace">
    <section className="lab-instructions">
      <span className="eyebrow"><FlaskConical size={15} /> {lab.lab_id}</span>
      <h2>{lab.title}</h2>
      <nav className="lab-progress" aria-label="代码实验进度">
        {anchorIds.map((id, index) => <button type="button" key={id} className={`lab-progress-seg ${activeAnchorId === id ? "is-active" : ""} ${index < anchorIds.indexOf(activeAnchorId) ? "is-done" : ""}`} onClick={() => setActiveAnchorId(id)}><span className="lab-progress-dot">{index + 1}</span><b>{id === "lab-task" ? "任务" : id === "lab-guide-block" ? "实操指南" : "提示与反思"}</b>{index < anchorIds.length - 1 ? <i className="lab-progress-line" /> : null}</button>)}
      </nav>
      {task && activeAnchorId === "lab-task" ? <article id="lab-task" className="lab-block lab-block-task"><div className="lab-block-head"><span className="lab-block-icon"><ListChecks size={15} /></span><b>编程任务</b><span className="programming-task-kind">{guidedOutput ? "引导式运行" : task.task_kind === "code_completion" ? "程序填空" : task.task_kind === "function_implementation" ? "函数实现" : task.task_kind === "debugging_repair" ? "调试修复" : "标准输入输出"}</span></div><h3>{guidedOutput ? "你要完成什么" : "编程任务"}</h3><p>{legacyGuidedOutput ? "这是一道入门运行练习：程序主体已经写好，你只需在右侧唯一的输入框中填写要输出的文字，并用英文引号包起来；不要输入变量名、等号或 print。" : task.statement}</p><dl><div><dt>{guidedOutput ? "你填写" : "输入"}</dt><dd>{task.input_description}</dd></div><div><dt>{guidedOutput ? "程序输出" : "输出"}</dt><dd>{task.output_description}</dd></div></dl><ul>{task.constraints.map((entry) => <li key={entry}>{entry}</li>)}</ul></article> : null}
      {activeAnchorId === "lab-task" ? (() => { const guide = labGuideSections(lab.instructions); return guide ? <div className="lab-guide">{guide.map((section, index) => <section className={`lab-guide-section tone-${index % 4}`} key={section.title}><h3>{section.title}</h3><div>{section.blocks.map((block) => <RenderLessonBlock block={block} key={block.block_id} />)}</div></section>)}</div> : lab.instructions.map((block) => <RenderLessonBlock block={block} key={block.block_id} />) })() : null}
      {lab.practical_guide && activeAnchorId === "lab-guide-block" ? <div id="lab-guide-block" className="lab-block lab-block-guide"><div className="lab-block-head"><span className="lab-block-icon"><Target size={15} /></span><b>实操指南</b><small>{lab.practical_guide.estimated_minutes} 分钟 · 含步骤/验收/常见错误/拓展</small></div><div className="practical-guide"><h3><Target size={16} /> 实操指南 · {lab.practical_guide.estimated_minutes} 分钟</h3><section className="pg-goal"><small>实践目标</small><p>{lab.practical_guide.practice_goal}</p>{lab.practical_guide.deliverable ? <p className="pg-deliverable">交付物：{lab.practical_guide.deliverable}</p> : null}</section>{lab.practical_guide.steps?.length ? <section className="pg-steps"><small>操作步骤</small><ol>{lab.practical_guide.steps.map((step) => <li key={step.sequence}><b>第 {step.sequence} 步 · {step.title}</b><p>{step.action}</p>{step.input ? <p className="pg-input">输入：{step.input}</p> : null}{step.expected_result ? <p className="pg-expected">预期结果：{step.expected_result}</p> : null}</li>)}</ol></section> : null}{lab.practical_guide.readiness_checks?.length ? <section className="pg-readiness"><small>前置条件</small><ul>{lab.practical_guide.readiness_checks.map((check) => <li key={check.title}><b>{check.title}</b><p>{check.check}（就绪：{check.ready_when}）</p></li>)}</ul></section> : null}{lab.practical_guide.acceptance_criteria?.length ? <section className="pg-acceptance"><small>验收标准</small><ul>{lab.practical_guide.acceptance_criteria.map((criterion) => <li key={criterion.criterion_id}><CheckCircle2 size={14} /><span>{criterion.description}</span></li>)}</ul></section> : null}{lab.practical_guide.troubleshooting?.length ? <section className="pg-errors"><small>常见错误与解决</small><dl>{lab.practical_guide.troubleshooting.map((error, index) => <div key={index}><dt>{error.symptom}</dt><dd>原因：{error.likely_cause} · 解决：{error.recovery_steps?.join("；")}{error.verification ? ` · 验证：${error.verification}` : ""}</dd></div>)}</dl></section> : null}{lab.practical_guide.extension_task ? <section className="pg-extension"><small>拓展任务</small><ul><li><p>{lab.practical_guide.extension_task.task}</p><span>变化维度：{lab.practical_guide.extension_task.changed_dimension}{lab.practical_guide.extension_task.verification ? ` · 验证：${lab.practical_guide.extension_task.verification}` : ""}</span></li></ul></section> : null}</div></div> : null}
      {activeAnchorId === "lab-guide-block" ? <div id="lab-samples" className="lab-block lab-samples-block"><div className="lab-block-head"><span className="lab-block-icon"><CheckCircle2 size={15} /></span><b>公开样例</b><small>预期行为参考</small></div><div className="public-tests"><h3>公开样例</h3>{(task?.public_examples ?? lab.public_tests).map((test) => <article key={"case_id" in test ? test.case_id : test.test_id}><CheckCircle2 size={16} /><div><b>{test.description}</b><p>{test.expected_behavior}</p></div></article>)}</div></div> : null}
      {activeAnchorId === "lab-reflect" ? <div id="lab-hints" className="lab-block lab-block-hints"><div className="lab-block-head"><span className="lab-block-icon"><Lightbulb size={15} /></span><b>三级提示</b><small>卡住时逐步展开，由浅到深</small></div><LabHintPanel lab={lab} /></div> : null}
      {lab.reflection_questions?.length && activeAnchorId === "lab-reflect" ? <div id="lab-reflect" className="lab-block lab-block-reflect"><div className="lab-block-head"><span className="lab-block-icon"><MessageCircleQuestion size={15} /></span><b>完成实验后，想一想</b><small>反思问题 · 检查是否真正理解</small></div><div className="lab-reflection"><h3><MessageCircleQuestion size={16} /> 完成实验后，想一想</h3><ol>{lab.reflection_questions.map((question, index) => <li key={index}><span>{String(index + 1).padStart(2, "0")}</span><p>{question}</p></li>)}</ol><small>反思问题来自 C 的公开 reflection_questions，用于检查你是否真正理解。</small></div></div> : null}
    </section>
    <section className="editor-panel">
      <header><div><Braces size={17} /><b>{guidedOutput ? "填写并运行" : gapMode ? "程序填空" : "Python 编辑器"}</b></div><small>{lab.execution_contract.execution_mode} · {lab.execution_contract.resource_limits.timeout_ms}ms</small></header>
      {gapMode ? <div className="gap-editor">
        <div className="gap-howto"><b>只填写下面的空格</b><span>不用复制整段代码。你填写后，系统会自动放入完整程序。</span></div>
        <div className="gap-preview-head"><b>完整代码预览</b><small>方括号表示尚未填写的位置，不是需要输入的代码。</small></div>
        <pre aria-label="填写后的完整代码预览">{gapTemplatePreview(task!.gap_template!, gapAnswers)}</pre>
        {task!.gap_template!.gaps.map((gap) => {
          const issue = gapIssues[gap.gap_id]
          return <label key={gap.gap_id}><b>{gap.label}</b><small>{gapAnswerGuidance(gap)}</small>{gap.max_lines > 1 ? <textarea value={gapAnswers[gap.gap_id] ?? ""} placeholder={gap.placeholder ?? "填写代码"} onChange={(event) => setGapAnswers({ ...gapAnswers, [gap.gap_id]: event.target.value })} /> : <input value={gapAnswers[gap.gap_id] ?? ""} placeholder={gap.placeholder ?? "填写代码"} onChange={(event) => setGapAnswers({ ...gapAnswers, [gap.gap_id]: event.target.value })} />}{issue ? <span className="gap-answer-error" role="alert">{issue}</span> : null}</label>
        })}
      </div> : <PythonCodeEditor value={code} onChange={setCode} minHeight={300} ariaLabel="代码实验 Python 编辑器" executionMode={lab.execution_contract.execution_mode} />}
      <footer><button type="button" onClick={() => gapMode ? setGapAnswers({}) : setCode(lab.starter_code)}><RotateCcw size={15} /> 重置</button><button className="secondary-action" disabled={Boolean(busy) || !firstPublicCaseId || (gapMode ? !gapReady : !code.trim())} type="button" onClick={() => firstPublicCaseId && void onDebug(firstPublicCaseId)}><Play size={15} /> 调试公开样例</button><button className="run-button" disabled={Boolean(busy) || (gapMode ? !gapReady : !code.trim())} type="button" onClick={() => void onRun()}><ShieldCheck size={15} /> {busy ? "评测中…" : "正式提交"}</button></footer>
      <div className="run-result is-visible lab-run-output" role="status">
        {execution ? <><b>{execution.status === "completed" ? "公开样例调试完成" : execution.verdict ? judgeVerdictLabel(execution.verdict) : execution.status === "passed" ? "代码实验通过" : execution.status === "blocked" ? "代码实验暂时无法运行" : "代码实验尚未通过"}</b>
        <p>{execution.status === "completed" ? `实际结果：${typeof execution.actual === "string" ? execution.actual : JSON.stringify(execution.actual)}` : typeof execution.passedChecks === "number" && typeof execution.totalChecks === "number" ? `通过 ${execution.passedChecks} / ${execution.totalChecks} 项检查。` : execution.message ?? "服务端未返回公开检查摘要。"}</p>
        {feedback.length ? <div className="failure-reasons">{feedback.map((entry) => <p key={entry.code}><b>{entry.label}</b>{entry.message}</p>)}</div> : null}
        {checklist.length ? <details className="public-test-checklist"><summary>按公开测试自查</summary>{checklist.map((item) => <article key={item.test_id}><b>{item.description}</b><p>{item.expected_behavior}</p></article>)}</details> : null}</> : <div className="lab-run-placeholder"><TerminalSquare size={15} /><span>调试输出区——点击"调试公开样例"或"正式提交"后，这里显示运行结果</span></div>}
      </div>
    </section>
  </div>
}

function ChecksContent({ lesson }: { lesson: LessonPayload }) {
  const [open, setOpen] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  return <div className="checks-workspace"><header><span className="eyebrow"><ListChecks size={15} /> 课件内理解检查</span><h2>边学边检查，不计入正式 mastery</h2><p>题目、正确选项和解析均来自 C 的公开 micro_checks；D 只在你选择后展示。</p></header>{lesson.micro_checks.length ? lesson.micro_checks.map((check, index) => {
    const selected = answers[check.item_id]
    const feedback = microCheckFeedbackView(check, selected)
    return <article className="micro-check" key={check.item_id}><div className="micro-number">{String(index + 1).padStart(2, "0")}</div><div><h3>{check.prompt}</h3>{check.options?.length ? <div className="check-options">{check.options.map((option) => <button className={`${selected === option.option_id ? "is-selected" : ""} ${feedback && option.option_id === check.answer_option_id ? "is-answer" : ""}`.trim()} onClick={() => setAnswers((current) => ({ ...current, [check.item_id]: option.option_id }))} type="button" key={option.option_id}>{option.label}. {option.text}</button>)}</div> : <textarea value={selected ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [check.item_id]: event.target.value }))} placeholder="C 未公开可自动核对的选项；请写下你的理解" />}{feedback && <div className={`micro-feedback ${feedback.correct ? "is-correct" : "is-wrong"}`} role="status"><b>{feedback.correct ? "回答正确" : "回答错误"}</b><p>正确答案：{feedback.answer_text}</p><small>{feedback.explanation}</small></div>}<button className="source-toggle" type="button" onClick={() => setOpen(open === check.item_id ? null : check.item_id)}>{open === check.item_id ? "收起来源" : "查看来源"} <ChevronDown size={15} /></button>{open === check.item_id && <p className="source-line">{formatCitations(check.citations)}</p>}</div></article>
  }) : <MissingContent text="C 未公开 micro_checks，D 不补造理解题。" />}</div>
}

function HintPanel({ resource }: { resource?: Pick<LessonPayload, "hint_ladders"> | Pick<CodeLabPayload, "hint_ladders"> }) {
  const [level, setLevel] = useState(1)
  const ladder = resource?.hint_ladders?.[0]
  const hint = ladder?.hints.find((item) => item.hint_level === level)
  return <div className="side-panel-content"><span className="side-kicker"><Lightbulb size={15} /> 分层提示</span><h3>{ladder ? `${ladder.objective_id} 的提示阶梯` : "当前没有公开提示"}</h3>{hint ? <><p className="hint-copy">{hint.text}</p><CitationChips citations={hint.citations} /><div className="hint-levels">{[1, 2, 3].map((value) => <button className={level === value ? "is-active" : ""} type="button" onClick={() => setLevel(value)} key={value}>提示 {value}</button>)}</div></> : <p className="muted-copy">D 不会临时生成提示。接入后仅展示 C 公开的 hint_ladders。</p>}</div>
}

function EvidencePanel({ resource }: { resource?: Pick<LessonPayload, "used_evidence"> & Partial<Pick<LessonPayload, "prerequisite_bridge">> | Pick<CodeLabPayload, "used_evidence"> }) {
  const activeSession = useRequiredSession()
  const factIndex = buildFactIndex(activeSession.rag_result)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const prerequisiteCitations = resource && "prerequisite_bridge" in resource
    ? resource.prerequisite_bridge?.flatMap(blockCitations) ?? []
    : []
  const evidence = uniqueCitations([...(resource?.used_evidence ?? []), ...prerequisiteCitations])
  return <div className="side-panel-content"><span className="side-kicker"><ShieldCheck size={15} /> 可追溯证据</span><h3>{evidence.length} 条公开引用</h3><p className="muted-copy">只展示 source_id / fact_id；缺失证据会如实显示，不生成虚构来源。</p><div className="evidence-list">{evidence.map((citation) => {
    const key = `${citation.source_id}-${citation.fact_id}`
    const hit = lookupFact(factIndex, citation)
    const open = openKey === key
    return <article key={key}><FileText size={16} /><div><b>{citation.source_id}</b><span>{citation.fact_id}</span></div><button className={`fact-detail-toggle ${open ? "is-open" : ""}`} type="button" onClick={() => setOpenKey(open ? null : key)}>{open ? "收起" : "查看详情"}</button>{open ? <div className="fact-original">{hit.found ? <><b>{hit.entry.fact_id}</b><p>{hit.entry.content}</p></> : <p className="fact-missing-note">该事实不在当前会话证据中</p>}</div> : null}</article>
  })}</div></div>
}

function AgentPanel() {
  const activeSession = useRequiredSession()
  const workers = activeSession.worker_ledger
  return <div className="side-panel-content"><span className="side-kicker"><Bot size={15} /> 主 Agent协同</span><h3>{workers.length} 个固定 Worker</h3><p className="muted-copy">状态来自持久化 worker_ledger。这里不播放与真实事件无关的“AI思考”动画。</p><div className="agent-list">{workers.map((worker) => <article key={worker.worker}><span className={`agent-status status-${worker.status}`} /> <div><b>{workerLabel(worker.worker)}</b><small>{worker.status}</small></div></article>)}</div></div>
}

function AssessmentPage({ onFeedback: _onFeedback }: { onFeedback: () => void }) {
  const { isLive, assessmentAnswers: answers, setAssessmentAnswer, clearAssessmentAnswers, submitAssessment, runAssessmentItemCode, retry, reset, busy } = useLive()
  const activeSession = useRequiredSession()
  const assessment = activeSession.assessment?.payload
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const items = assessment?.items ?? []
    if (items.length === 0) return
    if (!answersMatchAssessmentItems(items, answers) && Object.keys(answers).length > 0) {
      clearAssessmentAnswers()
    }
    setIndex(0)
  }, [activeSession.round_no, activeSession.assessment?.artifact_id])
  if (!assessment?.items?.length) return <BlockedResourceState session={activeSession} busy={busy} onRetry={() => void retry()} onRestart={reset} title="正式测评未通过可信发布" />
  const item = assessment.items[index]
  const complete = Object.values(answers).filter(Boolean).length
  const isCodePrompt = item.modality === "code" || item.modality === "trace"
  const codeExecution = activeSession.code_execution?.itemId === item.item_id
    ? activeSession.code_execution
    : null
  return <div className="page assessment-page"><PageHeading kicker={`正式测评 · ${assessment.title}`} title="提交后进入 Role C 正式评分" description="正确答案、评分规范与隐藏测试始终保留在服务端。当前作答会通过主 Agent命令提交，不在 D 中评分。" /><LearningLoopStepper session={activeSession} />
    <section className="assessment-shell"><aside><b>测评进度</b>{assessment.items.map((candidate, itemIndex) => <button className={itemIndex === index ? "is-active" : answers[candidate.item_id] ? "is-complete" : ""} type="button" onClick={() => setIndex(itemIndex)} key={candidate.item_id}><span>{itemIndex + 1}</span><small>{modalityLabel(candidate.modality)}</small></button>)}<p>{complete} / {assessment.items.length} 已作答</p></aside><article className="formal-question"><div className="question-meta"><span>第 {index + 1} 题</span><span className={`tier-badge tier-${item.tier}`}>{tierDualLabel(item).difficulty}</span><span className="cognition-badge">{tierDualLabel(item).cognition}</span><span>{item.max_score} 分</span></div><h2 className={isCodePrompt ? "formal-question-prompt is-code" : "formal-question-prompt"}>{item.prompt}</h2>{item.modality === "code" ? <><PythonCodeEditor value={answers[item.item_id] ?? item.starter_code ?? ""} onChange={(value) => setAssessmentAnswer(item.item_id, value)} minHeight={360} ariaLabel={`正式测评第 ${index + 1} 题 Python 编辑器`} /><div className="assessment-code-run"><button className="secondary-action" disabled={Boolean(busy) || !(answers[item.item_id] ?? item.starter_code ?? "").trim()} type="button" onClick={() => void runAssessmentItemCode(item.item_id, answers[item.item_id] ?? item.starter_code ?? "")}>运行代码</button>{codeExecution ? <div className="run-result is-visible" role="status"><b>{codeExecution.status === "passed" ? "代码检查通过" : codeExecution.status === "blocked" ? "代码暂时无法运行" : "代码检查未通过"}</b><p>{typeof codeExecution.passedChecks === "number" && typeof codeExecution.totalChecks === "number" ? `通过 ${codeExecution.passedChecks} / ${codeExecution.totalChecks} 项检查。` : codeExecution.message ?? "服务端未返回公开检查摘要。"}</p>{codeExecution.feedback?.map((entry) => <small key={entry.code}>{entry.message}</small>)}</div> : null}</div></> : item.options?.length ? <div className="formal-options">{item.options.map((option) => <button className={answers[item.item_id] === option.option_id ? "is-selected" : ""} type="button" onClick={() => setAssessmentAnswer(item.item_id, option.option_id)} key={option.option_id}><span>{option.label}</span><b>{option.text}</b></button>)}</div> : <textarea rows={6} value={answers[item.item_id] ?? ""} onChange={(event) => setAssessmentAnswer(item.item_id, event.target.value)} /> }<div className="formal-actions"><button className="secondary-action" disabled={index === 0} type="button" onClick={() => setIndex((value) => value - 1)}>上一题</button>{index < assessment.items.length - 1 ? <button className="primary-action" disabled={!answers[item.item_id]} type="button" onClick={() => setIndex((value) => value + 1)}>保存并下一题</button> : <button className="primary-action" disabled={Boolean(busy) || !assessmentComplete(activeSession, answers) || !isLive} type="button" onClick={() => void submitAssessment()}>{busy ? "正在正式评分…" : "提交正式测评"} <ArrowRight /></button>}</div></article></section>
  </div>
}

function MasteryCelebration({ notice, onClose }: { notice: { title: string; concept: string; final: boolean }; onClose: () => void }) {
  return <div className="mastery-celebration-backdrop" role="presentation"><section className="mastery-celebration-card" role="dialog" aria-modal="true" aria-label={notice.title}><button className="mastery-celebration-close" aria-label="关闭完成提示" type="button" onClick={onClose}><X size={20} /></button><div className="mastery-celebration-icon"><GraduationCap size={34} /></div><h2>{notice.title}</h2>{notice.final ? <p>本学习路径中的知识结点已经全部完成。你可以关闭提示查看本轮错题和参考答案。</p> : <p>已将 <strong>{notice.concept}</strong> 标记为已掌握，接下来会按正式路径进入下一个未掌握结点。</p>}</section></div>
}

function FeedbackPage({ onContinue, masteryNotice, onMasteryDismiss }: { onContinue: () => void; masteryNotice: { title: string; concept: string; final: boolean } | null; onMasteryDismiss: () => void }) {
  const { retry, reset, busy } = useLive()
  const activeSession = useRequiredSession()
  const feedback: any = activeSession.feedback
  const decision = feedback?.final_decision
  // C 的公开评分摘要嵌套在 grade_result.payload.feedback.summary(后端无顶层 feedback_summary)。
  const feedbackSummary = feedback?.grade_result?.payload?.feedback?.summary || feedback?.feedback_summary || ""
  if (!feedback && activeSession.status !== "blocked" && activeSession.status !== "failed") return <div className="page feedback-page"><PageHeading kicker="正式反馈" title="等待 Role C 正式评分结果" description="D 不会根据作答或题目难度在浏览器里估算结果。" /><LearningLoopStepper session={activeSession} /><section className="feedback-empty"><div className="feedback-icon"><Sparkles /></div><h2>评分结果尚未返回</h2><p>完成正式测评后，主 Agent会持久化公开反馈与下一步决策。</p><button className="primary-action" type="button" onClick={onContinue}>返回互动学习</button></section></div>
  const snapshotItems = Array.isArray(feedback?.assessment_items?.items) ? feedback.assessment_items.items : []
  const assessmentItems = snapshotItems.length > 0 ? snapshotItems : []
  const itemViews = assessmentFeedbackView(assessmentItems, feedback?.grade_result?.payload, feedback?.your_answers ?? [])
  const wrongCount = itemViews.filter((item) => item.correct === false).length
  const planOptions = [
    { action: "remediate", title: "针对性补救", description: "回到当前知识点，重新学习并再次作答" },
    { action: "reinforce", title: "巩固强化", description: "在当前知识点追加巩固练习，加深掌握" },
    { action: "advance", title: "进入下一节点", description: "本轮达标，推进到路径中下一个知识点" },
    { action: "reprofile", title: "重新确认画像", description: "B 需要重新确认画像，再调整后续路径" },
  ]
  const nextRoundGate = nextRoundResourceGate(activeSession)
  const adaptation = activeAdaptationView(activeSession)
const finalAction = finalFeedbackAction(activeSession)
  return <div className="page feedback-page"><LearningLoopStepper session={activeSession} />{masteryNotice && <MasteryCelebration notice={masteryNotice} onClose={onMasteryDismiss} />}<PageHeading kicker={`正式反馈 · 第 ${activeSession.round_no > 1 ? activeSession.round_no - 1 : activeSession.round_no} 轮`} title={activeSession.status === "blocked" ? "下一步暂时受阻" : decisionTitle(decision?.action)} description={feedbackSummary || activeSession.blocked_reason || "主 Agent已返回本轮正式决策。"} /> <section className="feedback-result-grid"><article className="score-card"><span>本轮正式得分</span><strong>{feedback?.round_score ? `${feedback.round_score.raw_score} / ${feedback.round_score.max_score}` : "--"}</strong><p>{feedback?.round_score ? `正确率 ${Math.round(feedback.round_score.accuracy * 100)}% · 证据分 ${Math.round(feedback.round_score.evidence_score * 100)}%${wrongCount ? ` · ${wrongCount} 题未答对` : ""}` : "已保留此前评分，等待下一轮恢复。"}</p></article><article className="decision-card"><span>主 Agent下一步</span><h2>{decision?.action ? decisionLabel(decision.action) : "等待恢复"}</h2><p>{decision?.reason_codes?.map(decisionReasonLabel).join("、") || activeSession.blocked_reason || "暂无公开原因码"}</p></article></section><section className="decision-plan-card"><header><div><small>动态规划 · 下一轮方案选择</small><h2>主 Agent基于本轮结果选择下一轮方案</h2></div><span>{decision?.action ?? "pending"}</span></header><div className="decision-plan-grid">{planOptions.map((option) => <article className={decision?.action === option.action ? "is-current" : ""} key={option.action}><b>{option.title}</b><p>{option.description}</p>{decision?.action === option.action ? <em>本轮决策</em> : <i />}</article>)}</div></section>{adaptation ? <section className="adaptation-card"><small>本轮C资源适配说明</small><h2>{adaptation.adaptation_action === "remediate" ? "针对性补救" : adaptation.adaptation_action === "reinforce" ? "巩固强化" : "下一节点适配"}</h2><p>{adaptation.adaptation_summary}</p><p>目标：{adaptation.target_objective_ids.join("、") || "主Agent未公开具体目标"}</p>{adaptation.addressed_misconception_tags.length ? <p>针对误区：{adaptation.addressed_misconception_tags.join("、")}</p> : null}</section> : null}{itemViews.length ? <section className="item-feedback-list"><h2>逐题结果{wrongCount ? ` · ${wrongCount} 题待订正` : ""}</h2>{itemViews.map((view, index) => <article className={view.correct === false ? "is-wrong" : view.correct === true ? "is-correct" : "is-blank"} key={view.item_id}><header><span>{modalityLabel(view.modality as any)}</span><b>第 {index + 1} 题</b><em>{view.raw_score} / {view.max_score} 分</em></header><p className="item-prompt">{view.prompt}</p><dl><dt>你的答案</dt><dd>{view.your_answer_text}</dd></dl><div className="item-verdict">{view.correct === true ? "回答正确" : view.correct === false ? "回答错误" : "未作答"}</div>{view.correct_answer_text ? <dl className="correct-answer"><dt>参考答案</dt><dd className={view.correct_answer_kind === "code" ? "is-code" : ""}>{view.correct_answer_text}</dd></dl> : null}{view.feedback_message ? <p className="item-message">{view.feedback_message}</p> : null}{view.next_step ? <p className="item-next">下一步：{view.next_step}</p> : null}{view.correct === false && !view.correct_answer_text ? <small className="answer-boundary">C 本轮未公开结构化参考答案，仅提供评分反馈与下一步建议。</small> : null}</article>)}</section> : feedback?.your_answers?.length ? <section className="item-feedback-list"><p className="answer-boundary">本轮题目快照由旧版会话产生未公开，此处仅显示评分汇总；下一轮重新提交后可查看逐题结果。</p></section> : null}{feedback?.objective_results?.length ? <section className="objective-feedback"><h2>学习目标反馈</h2>{feedback.objective_results.map((item: any) => <article key={item.objective_id}><div><b>{item.objective_id}</b><span>{Math.round(item.accuracy * 100)}%</span></div><div className="objective-meter"><i style={{ width: `${Math.round(item.accuracy * 100)}%` }} /></div><p>{item.misconception_tags?.length ? <span className="difficulty-tags">困难识别：{item.misconception_tags.map((tag: string) => <em key={tag} title={tag}>{difficultyTagLabel(tag)}</em>)}</span> : "本轮未返回误区标签"}</p></article>)}</section> : null}<div className="page-actions">{activeSession.status === "blocked" || activeSession.status === "failed" ? (() => { const action = blockedSessionAction(activeSession); return <button className="primary-action" disabled={Boolean(busy)} type="button" onClick={action.canRetry ? () => void retry() : reset}>{busy ? "正在恢复…" : action.label}</button> })() : <button className="primary-action" disabled={!(finalAction?.ready ?? nextRoundGate.ready)} type="button" onClick={onContinue}>{finalAction?.label ?? nextRoundGate.label}</button>}</div></div>
}

function HistoryPage() {
  const { refreshEvents } = useLive()
  const activeSession = useRequiredSession()
  const events = activeSession.events.slice(-10).reverse()
  const timeline = agentTimelineView(activeSession)
  const flow = mainFlowStatusView(activeSession)
  return <div className="page history-page"><PageHeading kicker="Agent 协同记录" title="主 Agent 与执行单元的真实时间线" description="页面只读取 session、worker_ledger_history 与 events，不伪造调用、产物或重试。" /><div className="history-refresh"><button className="secondary-action" type="button" onClick={() => void refreshEvents()}>刷新真实事件</button></div><section className="history-layout"><article className="session-summary"><span>当前主 Agent 会话</span><h2>{activeSession.session_id}</h2><p>{flow.detail}</p><dl><div><dt>主 Agent 状态</dt><dd>{flow.badge}</dd></div><div><dt>当前阶段</dt><dd>{activeSession.current_stage}</dd></div><div><dt>轮次</dt><dd>{activeSession.round_no}</dd></div><div><dt>审核</dt><dd>{activeSession.content_review?.overall_status ?? "未启动"}</dd></div><div><dt>下一步</dt><dd>{activeSession.next_round_action?.action ?? (activeSession.feedback as any)?.final_decision?.action ?? "待决策"}</dd></div></dl></article><div className="agent-timeline">{timeline.length ? timeline.map((entry) => <article className={`agent-timeline-entry status-${entry.status}`} key={entry.id}><span className={`agent-status status-${entry.status}`} /><div className="agent-timeline-body"><header><div><b>{workerLabel(entry.unit)}</b><small>{entry.executionType} · {entry.roundLabel} · {entry.attemptLabel}</small></div><em>{entry.statusLabel}</em></header><p>{entry.summary}</p>{entry.errorLabel ? <p className="agent-timeline-error">{entry.errorLabel}</p> : null}{entry.retryLabel ? <p className="agent-timeline-retry"><RotateCcw size={13} />{entry.retryLabel}</p> : null}{entry.artifactRefs.length ? <div className="agent-artifact-refs">{entry.artifactRefs.map((ref) => <span className={ref.verified ? "is-verified" : "is-unverified"} title={ref.locator ?? "未公开定位"} key={ref.id}><FileText size={12} />{ref.id}{ref.verified ? " · 已核对" : " · 未核对"}</span>)}</div> : <small className="agent-no-artifact">本次执行未公开产物引用</small>}<time>{entry.timeLabel}</time></div></article>) : <MissingContent text="当前会话尚未公开追加式 Worker 调度历史。" />}</div></section><section className="raw-event-section"><header><div><small>会话事件</small><h2>最近 {events.length} 条 events</h2></div></header><div className="event-timeline">{events.map((event, index) => <article key={`${event.seq ?? index}-${event.event_type}`}><span className={`event-dot status-${event.status ?? "pending"}`} /><div><div><b>{eventStage(event)}</b><time>{formatTime(event.timestamp ?? event.occurred_at)}</time></div><p>{event.summary || event.message || event.event_type}</p><small>{event.agent || event.worker || "learning-orchestrator"}</small></div></article>)}</div></section></div>
}

function BlockedResourceState({ session, busy, onRetry, onRestart, title }: { session: PublicSessionFixture; busy: string; onRetry: () => void; onRestart: () => void; title: string }) {
  const action = blockedSessionAction(session)
  return <div className="page"><section className="empty-state blocked-resource-state"><ShieldCheck size={29} /><h2>{title}</h2><p>{session.blocked_reason || "主 Agent尚未发布这一阶段的公开内容。"}</p><small>{action.canRetry ? "画像与学习路径已经保留；重试只会重新请求 C 生成、Docker验证和正式审核，不会改写你的诊断答案。" : "这是修复前创建的旧计划，没有保存真实诊断检查点；为避免篡改画像，不能用答案键自动重试。"}</small><button className="primary-action" disabled={Boolean(busy)} type="button" onClick={action.canRetry ? onRetry : onRestart}>{busy ? "正在恢复…" : action.label}</button></section></div>
}

function NoSessionState({ onStart }: { onStart: () => void }) {
  return <div className="page"><section className="empty-state"><ShieldCheck size={29} /><h2>需要先创建主 Agent会话</h2><p>为避免伪造，D 不会在没有服务端会话时展示画像、学习方案、C 讲义、正式测评、评分或 Worker状态。</p><button className="primary-action" type="button" onClick={onStart}>新建真实学习会话</button></section></div>
}

export function CollaborationDrawer({ session, onClose }: { session: PublicSessionFixture | null; onClose: () => void }) {
  const view = collaborationDrawerView(session ?? { status: "idle", round_no: 1, worker_ledger_history: [] })
  return createPortal(<div className="collaboration-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}><aside className="collaboration-drawer" role="dialog" aria-modal="true" aria-label="多 Agent 协同流程"><header><div><small>主 Agent · 实时编排</small><h2>协同流程</h2><p>{session ? `第 ${session.round_no} 轮 · ${view?.live ? "正在运行" : "当前状态已保存"}` : "尚未创建真实主 Agent会话"}</p></div><button type="button" aria-label="关闭协同流程" onClick={onClose}><X size={20} /></button></header>{view ? <div className="vertical-metro">{view.stations.map((station, index) => <article className={`vertical-station is-${station.state}`} key={station.unit}><div className="vertical-station-mark"><span>{station.state === "completed" ? <Check size={14} /> : station.state === "current" ? <Bot size={14} /> : station.state === "failed" ? "!" : index + 1}</span>{index < view.stations.length - 1 ? <i /> : null}</div><div className="vertical-station-body"><header><b className="agent-art-title">{workerLabel(station.unit)}｜Agent {station.unit}</b><em>{drawerStateLabel(station.state)}</em></header><small className="agent-task-description">● {workerTaskDescription(station.unit)}</small>{station.executionType && station.executionType !== "unknown" ? <small className="agent-execution-type">{drawerExecutionTypeLabel(station.executionType)}</small> : null}<p>{station.summary}</p><footer><span>第 {station.attempt} 次尝试</span><span>公开产物 {station.publicOutputCount}</span>{station.hadFailure ? <span className="drawer-retry">保留失败/重试记录</span> : null}</footer></div></article>)}</div> : <section className="collaboration-empty"><Bot size={32} /><h3>暂无真实协同记录</h3><p>创建学习计划并启动主 Agent后，这里会按真实 worker_ledger_history 显示执行顺序。</p></section>}<footer className="collaboration-legend"><span><i className="legend-current" /> 正在做</span><span><i className="legend-pending" /> 未工作</span><span><i className="legend-completed" /> 已完成</span><span><i className="legend-waiting" /> 等待用户输入</span><small>紫色动态图标仅在真实会话运行时出现</small></footer></aside></div>, document.body)
}

function PageHeading({ kicker, title, description, icon }: { kicker: string; title: string; description: string; icon?: React.ReactNode }) {
  return <header className="page-heading">{icon ? <span className="page-heading-icon">{icon}</span> : null}<div><span>{kicker}</span><h1>{title}</h1><p>{description}</p></div></header>
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <section className="empty-state"><FileText size={29} /><h2>{title}</h2><p>{body}</p></section>
}

function MissingContent({ text }: { text: string }) {
  return <div className="missing-content"><FileText size={17} /><span>{text}</span></div>
}

function RedirectPage({ title, message, action, onAction }: { title: string; message: string; action: string; onAction: () => void }) {
  return <div className="page"><section className="empty-state"><ShieldCheck size={29} /><h2>{title}</h2><p>{message}</p><button className="primary-action" type="button" onClick={onAction}>{action}</button></section></div>
}

function CitationChips({ citations }: { citations: Citation[] }) {
  const unique = uniqueCitations(citations)
  if (!unique.length) return null
  return <div className="citation-chips" aria-label="知识依据">{unique.map((citation) => <span className="citation-chip" key={`${citation.source_id}-${citation.fact_id}`}>{citation.source_id} · {citation.fact_id}</span>)}</div>
}

function blockCitations(block: LessonPayload["explanation_blocks"][number]): Citation[] {
  if (block.block_type === "paragraph" || block.block_type === "code" || block.block_type === "callout" || block.block_type === "comparison") return block.claims.flatMap((claim) => claim.citations)
  if (block.block_type === "quiz" || block.block_type === "hint" || block.block_type === "citation") return block.citations
  return []
}

function uniqueCitations(citations: Citation[]): Citation[] {
  return [...new Map(citations.map((citation) => [`${citation.source_id}:${citation.fact_id}`, citation])).values()]
}

function lessonOutline(lesson: LessonPayload) {
  return [
    { id: "prerequisite", title: "连接已有知识", visible: lesson.prerequisite_bridge.length > 0 },
    { id: "concept", title: "核心概念", visible: lesson.explanation_blocks.length > 0 },
    { id: "examples", title: "分步示例", visible: lesson.worked_examples.length > 0 },
    { id: "misconceptions", title: "常见误区", visible: lesson.misconceptions.length > 0 },
    { id: "summary", title: "本节小结", visible: lesson.summary.length > 0 },
  ].filter((item) => item.visible)
}

function formatCitations(citations: Citation[]) {
  return uniqueCitations(citations).map((citation) => `${citation.source_id}/${citation.fact_id}`).join("、") || "未公开引用"
}

function diagnosisGateLabel(session: PublicSessionFixture) {
  const count = session.waiting_for?.type === "diagnosis_answers" ? session.waiting_for.items.length : 0
  return count > 0 ? `等待完成 ${count} 道主 Agent诊断题` : "等待主 Agent继续"
}

function waitingLabel(type?: string) {
  return ({ diagnosis_answers: "等待诊断作答", assessment_answers: "等待正式测评", clarification_answer: "等待补充回答" } as Record<string, string>)[type ?? ""] ?? "等待你继续"
}

function stageLabel(session: PublicSessionFixture) {
  if (session.waiting_for?.type === "diagnosis_answers") return `客观诊断 · ${session.waiting_for.items.length} 题`
  if (session.waiting_for?.type === "assessment_answers") return "互动学习与正式测评"
  return ({ objective_diagnosis: "客观诊断", assessment: "互动学习与正式测评", completed: "学习完成", blocked: "流程受阻", failed: "流程失败" } as Record<string, string>)[session.current_stage] ?? session.current_stage
}

function decisionLabel(action?: string) {
  return ({ remediate: "开始针对性补救", reinforce: "进入巩固学习", advance: "进入下一知识节点", reprofile: "重新确认学习画像", complete: "完成本次学习" } as Record<string, string>)[action ?? ""] ?? "等待主 Agent决定"
}

function decisionTitle(action?: string) {
  return ({ remediate: "本轮需要针对性补救", reinforce: "本轮进入巩固学习", advance: "可以进入下一知识节点", reprofile: "需要重新确认学习情况", complete: "本次学习已完成" } as Record<string, string>)[action ?? ""] ?? "主 Agent已完成本轮决策"
}

function decisionReasonLabel(code: string): string {
  const map: Record<string, string> = {
    round_accuracy_below_remediation_threshold: "本轮正确率低于 40%，需要针对性补救",
    round_accuracy_in_reinforcement_band: "本轮正确率处于巩固区间（40%–80%），建议强化练习",
    round_accuracy_at_or_above_advancement_threshold: "本轮正确率达到 80% 及以上，满足进阶条件",
    fresh_independent_assessment_required: "上一卷曾使用提示或答案已曝光，需要新卷独立确认",
    repeated_profile_evidence_conflict: "画像与客观证据多次冲突，需要重新确认画像",
    profile_refresh_recommended: "建议刷新学习者画像",
    mastery_below_0_60: "掌握度低于 0.60，需回到该知识点补救",
    mastery_in_reinforcement_band: "掌握度处于巩固区间，建议继续强化",
    insufficient_evidence_modalities: "测评证据模态不足，暂不进阶",
    mastery_at_least_0_82: "掌握度达到 0.82 以上",
    evidence_sufficient: "测评证据充分",
    remediate_hysteresis_retained: "延续上一轮补救决策",
    advance_hysteresis_retained: "延续上一轮进阶决策",
    learning_stall_path_replan: "连续学习出现停滞，路径需要重新规划",
    path_node_activated: "路径节点已激活",
    initial_path_node_activated: "初始路径节点已激活",
  }
  return map[code] ?? code
}

function modalityLabel(modality: AssessmentPayload["items"][number]["modality"]) {
  return ({ mcq: "选择题", true_false: "判断题", trace: "代码追踪", short_answer: "简答题", code: "代码题" })[modality]
}

/** 双重分阶标签：优先用 C 公开的 difficulty_band/cognitive_level 独立字段，缺失时回退 tier 推导（不伪造） */
function tierDualLabel(item: { tier?: 1 | 2 | 3; difficulty_band?: "foundation" | "improvement" | "integration" | "extension"; cognitive_level?: "remember" | "understand" | "apply" | "analyze" | "create" }) {
  const bandMap: Record<string, string> = { foundation: "基础题", improvement: "提高题", integration: "综合题", extension: "拓展题" }
  const levelMap: Record<string, string> = { remember: "记忆", understand: "理解", apply: "应用", analyze: "分析", create: "创造" }
  if (item.difficulty_band && item.cognitive_level) {
    return { difficulty: bandMap[item.difficulty_band] ?? "基础题", cognition: `${levelMap[item.cognitive_level] ?? item.cognitive_level}`, tier: item.tier }
  }
  const tierMap = ({ 1: { difficulty: "基础题", cognition: "记忆·理解" }, 2: { difficulty: "提高题", cognition: "应用·分析" }, 3: { difficulty: "综合题", cognition: "综合·创造" } } as Record<number, { difficulty: string; cognition: string }>)[item.tier ?? 1] ?? { difficulty: "基础题", cognition: "记忆·理解" }
  return { ...tierMap, tier: item.tier }
}

/** 困难识别标签：把 misconception/error 标签映射为欧阳江栋的 6 类困难（概念忘记/不会转代码/不会调试/边界条件/题目理解困难/其他），未识别保持原文 */
function difficultyTagLabel(tag: string) {
  const rules: Array<{ keys: string[]; label: string }> = [
    { keys: ["concept", "定义", "概念", "principle", "forget"], label: "概念忘记" },
    { keys: ["转代码", "syntax", "语法", "translate", "写代码"], label: "不会转代码" },
    { keys: ["debug", "调试", "trace", "追踪", "运行"], label: "不会调试" },
    { keys: ["boundary", "边界", "off-by-one", "结束值", "range", "skips_last", "skips", "last_element", "integer_division", "整除"], label: "边界条件错误" },
    { keys: ["understand", "理解", "题意", "prompt"], label: "题目理解困难" },
  ]
  const lower = tag.toLowerCase()
  const hit = rules.find((rule) => rule.keys.some((key) => lower.includes(key)))
  return hit?.label ?? "其他困难"
}

interface RadarDimension { label: string; value: number }

function RadarChart({ dimensions }: { dimensions: RadarDimension[] }) {
  const cx = 100, cy = 100, maxR = 56
  const count = dimensions.length
  // 3 轴等边三角形朝上: 顶 90°, 左下 210°, 右下 330°
  const axes = dimensions.map((dim, i) => ({
    label: dim.label,
    value: dim.value,
    angle: -Math.PI / 2 + (Math.PI * 2 * i) / count,
  }))
  const rings = [1, 0.5]

  return <svg viewBox="0 0 200 200" aria-hidden="true">
    {/* 同心圆网格 */}
    {rings.map((scale) =>
      <circle key={scale} cx={cx} cy={cy} r={maxR * scale} fill="none" stroke="#e8e4f0" strokeWidth={scale === 1 ? 1.2 : 0.6} />,
    )}
    {/* 轴线 */}
    {axes.map((axis, i) =>
      <line key={`line-${i}`} x1={cx} y1={cy} x2={cx + Math.cos(axis.angle) * maxR} y2={cy + Math.sin(axis.angle) * maxR} stroke="#e8e4f0" strokeWidth={1} />,
    )}
    {/* 数据多边形 */}
    <polygon
      points={axes.map((a) => `${cx + Math.cos(a.angle) * maxR * a.value},${cy + Math.sin(a.angle) * maxR * a.value}`).join(" ")}
      fill="rgba(124,58,237,.15)"
      stroke="#7c3aed"
      strokeWidth={1.8}
      strokeLinejoin="round"
    />
    {/* 数据点 */}
    {axes.map((axis, i) =>
      <circle key={`dot-${i}`} cx={cx + Math.cos(axis.angle) * maxR * axis.value} cy={cy + Math.sin(axis.angle) * maxR * axis.value} r={4} fill="#7c3aed" stroke="white" strokeWidth={2} />,
    )}
    {/* 百分比标注（在轴线外侧，靠近轴端点） */}
    {axes.map((axis, i) => {
      const pctR = maxR + 10
      const px = cx + Math.cos(axis.angle) * pctR
      const py = cy + Math.sin(axis.angle) * pctR
      return <text key={`pct-${i}`} x={px} y={py} textAnchor="middle" dominantBaseline="middle" fill="#7c3aed" fontSize={13} fontWeight={800}>{Math.round(axis.value * 100)}%</text>
    })}
    {/* 维度标签（在百分比外侧） */}
    {axes.map((axis, i) => {
      const labelR = maxR + 30
      const lx = cx + Math.cos(axis.angle) * labelR
      const ly = cy + Math.sin(axis.angle) * labelR
      const anchor = i === 0 ? "middle" : i === 1 ? "end" : "start"
      const dy = i === 0 ? "-0.2em" : "0.35em"
      return <text key={`label-${i}`} x={lx} y={ly} textAnchor={anchor} dy={dy} fill="#5c4b7a" fontSize={11} fontWeight={600}>{axis.label}</text>
    })}
  </svg>
}

function difficultyLabel(value?: string) {
  return ({ beginner: "入门", basic: "基础", intermediate: "进阶", integrated: "综合" } as Record<string, string>)[value ?? ""] ?? value ?? "未公开"
}

/** 画像 v2 字段标签映射（B 枚举 → 前端中文展示） */
function useCaseLabel(value?: string) {
  return ({ coursework: "课程学习", competition: "竞赛备战", job: "求职就业", project: "项目学习", certification: "考证认证", interest: "兴趣拓展", other: "其他" } as Record<string, string>)[value ?? ""] ?? value ?? "未公开"
}
function explanationPreferenceLabel(value?: string) {
  return ({ analogy_first: "先类比再讲原理", principle_first: "先讲原理", example_first: "先看例子", step_by_step: "按任务分步讲", balanced: "均衡搭配" } as Record<string, string>)[value ?? ""] ?? value ?? "未公开"
}
function practicePreferenceLabel(value?: string) {
  return ({ quiz: "选择题练习", coding: "引导编程", project: "项目实践", mixed: "混合练习" } as Record<string, string>)[value ?? ""] ?? value ?? "未公开"
}
function pacePreferenceLabel(value?: string) {
  return ({ slow: "慢速稳妥", steady: "匀速推进", fast: "快速进阶" } as Record<string, string>)[value ?? ""] ?? value ?? "未公开"
}
function formatMinutes(value: number | undefined | null) {
  if (value == null || !Number.isFinite(value)) return "未公开"
  return value >= 60 ? `${Math.round(value / 60 * 10) / 10}小时` : `${value}分钟`
}
function sourceLabel(value?: string) {
  return ({ learner: "学习者填写", objective_diagnosis: "客观诊断", assessment_history: "测评历史", learner_memory: "历史记忆", system_default: "系统默认" } as Record<string, string>)[value ?? ""] ?? value ?? "未知"
}

function difficultyPosition(value?: string) {
  return ({ beginner: 12, basic: 38, intermediate: 66, integrated: 92 } as Record<string, number>)[value ?? ""] ?? 0
}

function behaviorLabel(value: string) {
  return ({ recognize: "识别概念", trace: "追踪执行过程", apply: "应用知识", create: "完成作品" } as Record<string, string>)[value] ?? value
}

function workerLabel(worker: string) {
  return ({
    "background-collector": "背景采集",
    "self-assessor": "学习者自评",
    "objective-diagnostician": "客观诊断",
    "profile-builder": "画像构建",
    "path-planner": "路径规划",
    "concept-tutor": "定制讲义",
    "code-lab": "代码实验",
    "tiered-evaluator": "分阶测评",
  } as Record<string, string>)[worker] ?? worker
}

function drawerStateLabel(state: string): string {
  return ({ current: "正在做", pending: "未工作", completed: "已经完成", waiting: "等待用户", failed: "失败/阻塞", skipped: "已跳过" } as Record<string, string>)[state] ?? "状态未公开"
}

function workerTaskDescription(worker: string): string {
  return ({
    "background-collector": "提取学习者背景、过往经验和学习目标。",
    "self-assessor": "提取学习者自评等级。",
    "objective-diagnostician": "处理实际诊断答案，形成有知识依据的诊断证据。",
    "profile-builder": "综合背景、自评和客观诊断，生成学习者画像。",
    "path-planner": "根据学习者画像规划个性化学习路径。",
    "concept-tutor": "根据知识证据生成带引用的个性化讲义。",
    "code-lab": "生成代码实验，并保护参考答案和隐藏测试。",
    "tiered-evaluator": "生成分阶正式测评，分离公开题目和私有评分材料。",
  } as Record<string, string>)[worker] ?? "等待公开任务说明。"
}

/** 首页 Hero 下方的八位 Agent 横向长廊：中文名 + 英文名（艺术字）+ 第一人称气泡介绍。 */
const agentGalleryCards: Array<{ id: string; cn: string; en: string; intro: string }> = [
  {
    id: "background-collector",
    cn: "背景采集",
    en: "Agent background-collector",
intro: "我是「雷达」——先把你的背景、经验、每周投入时间都收进档案摸清「你从哪里来、要到哪里去」，后面的伙伴才不会空转",
  },
  {
    id: "self-assessor",
    cn: "学习者自评",
    en: "Agent self-assessor",
intro: "我是「自我介绍的记录员」——你说自己是零基础还是摸过一点 Python？我照单全收，但绝不只信这一句自评只是画像起点，后面伙伴会交叉验证",
  },
  {
    id: "objective-diagnostician",
    cn: "客观诊断",
    en: "Agent objective-diagnostician",
intro: "我是「出卷人」——专治「我以为我会了」。你答题我判分，把结果变成证据链画像里写的是「事实」，不是「感觉」",
  },
  {
    id: "profile-builder",
    cn: "画像构建",
    en: "Agent profile-builder",
intro: "我是「拼图师」——把背景、自评、诊断三块拼图拼成你的学习者画像已知什么、薄弱在哪，后续所有决策都拿它当「底稿」",
  },
  {
    id: "path-planner",
    cn: "路径规划",
    en: "Agent path-planner",
intro: "我是「导航员」——拿着画像从知识库里挑知识点，排成有先后的路径先打地基再盖楼，讲清楚「先学哪个、为什么」",
  },
  {
    id: "concept-tutor",
    cn: "定制讲义",
    en: "Agent concept-tutor",
intro: "我是「一对一讲师」——照着画像和知识库证据，给你现写专属讲义讲解、示例、误区一个不少，每句话都有出处，像「量身裁衣」",
  },
  {
    id: "code-lab",
    cn: "代码实验",
    en: "Agent code-lab",
intro: "我是「实训教练」——光听不练假把式我出代码实验题，给你编辑器、公开测试和实时反馈。标准答案和隐藏测试守得死死的，绝不让题目「泄底」",
  },
  {
    id: "tiered-evaluator",
    cn: "分阶测评",
    en: "Agent tiered-evaluator",
intro: "我是「毕业考官」——每轮出一套由易到难的分阶测评，评分规范锁在服务端、不靠感觉。测完把结果回传画像，让下一轮更贴合你",
  },
]

function HighlightShowcase() {
  const items: Array<{ icon: string; cat: string; title: string; desc: string }> = [
    { icon: "🤝", cat: "协作", title: "八角色流水线", desc: "背景采集→自评→诊断→画像→路径→讲义→实验→测评，八个专职角色分工协作" },
    { icon: "🔗", cat: "协作", title: "证据链传递", desc: "前一个角色的输出是后一个的输入，背景、诊断、画像全程有据可查" },
    { icon: "🎓", cat: "协作", title: "学练测闭环", desc: "每个知识点配齐定制讲义、代码实验、正式测评，测完回传画像" },
    { icon: "🛡️", cat: "制约", title: "事实审核", desc: "生成内容必须引用知识库事实，没引用即不合格，防幻觉第一道闸" },
    { icon: "⚖️", cat: "制约", title: "客观封顶", desc: "自评说厉害但诊断全错？画像按客观数据封顶，不轻信自评" },
    { icon: "🔒", cat: "制约", title: "服务端评分", desc: "标准答案与隐藏测试锁在服务端，Docker 沙箱执行，前端抄不到" },
    { icon: "🚧", cat: "制约", title: "审核不过不放行", desc: "事实/教学/适配三道审核任一不过，自动修复重生成后才发布" },
    { icon: "📊", cat: "实测", title: "正式评测协议", desc: "60 个真实生成案例、180 份资源，逐声明审核、逐资源难度分类并保留分子分母" },
  ]
  return <section className="highlight-showcase" aria-label="项目亮点">
    <header className="highlight-head"><span className="highlight-headline">独特机制与亮点</span><b className="highlight-sub">八角色协作 · 层层把关</b></header>
    <div className="highlight-grid">
      {items.map((it) => <article className="highlight-card" key={it.title}>
        <div className="highlight-icon">{it.icon}</div>
        <div className="highlight-body">
          <small className={"highlight-cat cat-" + (it.cat === "协作" ? "coop" : it.cat === "制约" ? "check" : "data")}>{it.cat}</small>
          <b>{it.title}</b>
          <p>{it.desc}</p>
        </div>
      </article>)}
    </div>
  </section>
}

function AgentGallery() {
  return <><section className="agent-gallery" aria-label="八位 Agent 自我介绍">
    <header className="agent-gallery-head"><span className="agent-gallery-headline">八位 Agent 的自我介绍~</span><b className="agent-gallery-accent">缺一不可</b><b className="agent-gallery-accent accent-delay">互相协作</b></header>
    <div className="agent-gallery-scroll">
      {agentGalleryCards.map((agent) => <article className="agent-gallery-card" key={agent.id}>
        <div className="agent-gallery-title"><b className="agent-art-title">{agent.cn}</b><small>{agent.en}</small></div>
        <div className="agent-gallery-bubble">{renderIntro(agent.intro)}</div>
      </article>)}
    </div>
  </section>
  <HighlightShowcase />
  </>
}

/** 把「」内的关键词用艺术字 <em> 突出渲染 */
function renderIntro(intro: string) {
  const parts = intro.split("「")
  if (parts.length === 1) return <>{intro}</>
  return <>{parts.map((part, i) => {
    if (i === 0) return <span key={i}>{part}</span>
    const close = part.indexOf("」")
    if (close === -1) return <span key={i}>「{part}</span>
    return <span key={i}><em className="agent-intro-accent">{part.slice(0, close)}</em>{part.slice(close + 1)}</span>
  })}</>
}

function drawerExecutionTypeLabel(type: string): string {
  return ({ opencode_primary: "OpenCode 主 Agent", opencode_subagent: "OpenCode 子 Agent", deterministic_adapter: "确定性适配器", reviewed_pipeline: "受审核生成流程", session_logic: "会话逻辑", manual: "人工操作" } as Record<string, string>)[type] ?? "执行类型未公开"
}

function reviewStatusLabel(status: string) {
  return ({
    pending: "等待审核",
    reviewing: "正在审核",
    repairing: "修复后重审",
    passed: "审核通过",
    failed: "审核失败",
    degraded: "已降级发布",
    blocked: "审核阻塞",
  } as Record<string, string>)[status] ?? status
}

function eventStage(event: PublicSessionFixture["events"][number]) {
  if (event.agent) return workerLabel(event.agent)
  if (event.worker) return workerLabel(event.worker)
  return event.event_type ?? "主 Agent事件"
}

function formatTime(value?: string) {
  if (!value) return "--"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}