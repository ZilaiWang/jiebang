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
  ExternalLink,
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
  Sparkles,
  Target,
  Trash2,
  UserPlus,
  UserRound,
  X,
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
  saveProviderConfiguration,
  submitAssessmentAnswers,
  submitDiagnosisAnswers,
} from "./orchestrator-client"
import { semanticLessonLines, indentParagraphText } from "./lesson-format"
import { abilityRadarView, answersMatchAssessmentItems, answersToSubmission, assessmentComplete, assessmentFeedbackView, blockedSessionAction, completedNodeFromPath, diagnosisComplete, finalFeedbackAction, initialGoalSelection, isFinalAdvanceSession, isFinalMasterySession, microCheckFeedbackView, nextRoundResourceGate, nextUnmasteredPathNode, pageForSession, pathChainView, pathNodeTitle, shouldPollOrchestratorSession } from "./orchestrator-view"
import type { AssessmentPayload, Citation, CodeLabPayload, LessonPayload, PublicSessionFixture } from "./types"
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
} from "./workspace"

const WORKSPACE_STORAGE_KEY = "knowbalance-v4-workspace"

type LiveContextValue = {
  session: PublicSessionFixture | null
  isLive: boolean
  learnerId: string
  busy: string
  error: string
  diagnosisAnswers: Record<string, string>
  assessmentAnswers: Record<string, string>
  setDiagnosisAnswer: (itemId: string, answer: string) => void
  setAssessmentAnswer: (itemId: string, answer: string) => void
  clearAssessmentAnswers: () => void
  create: (input: { goal: string; nodeId?: string; custom?: boolean; planName: string }) => Promise<void>
  submitDiagnosis: () => Promise<void>
  submitAssessment: () => Promise<void>
  retry: () => Promise<void>
  refreshEvents: () => Promise<void>
  reset: () => void
}

const LiveContext = createContext<LiveContextValue | null>(null)

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
]

export function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => loadWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY)))
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
  const [userOpen, setUserOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [confirmSwitchUserId, setConfirmSwitchUserId] = useState<string | null>(null)
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
    fetch("/health").then(r => r.json()).then(data => {
      setDockerStatus(data?.docker ?? { ready: false, error: "无法检测 Docker 状态" })
    }).catch(() => setDockerStatus({ ready: false, error: "无法连接主 Agent，请确认已启动" }))
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

  const applySession = (next: any) => {
    const previousAssessmentId = liveSession?.assessment?.artifact_id
    const nextAssessmentId = next?.assessment?.artifact_id
    const assessmentChanged = Boolean(
      liveSession
      && (liveSession.round_no !== next?.round_no || (previousAssessmentId && nextAssessmentId && previousAssessmentId !== nextAssessmentId)),
    )
    if (assessmentChanged) setAssessmentAnswers({})
    const merged = { ...next, events: Array.isArray(next.events) ? next.events : [] } as PublicSessionFixture
    setLiveSession(merged)
    if (currentUser && currentPlan) setWorkspace((value) => recordPlanPublicState(value, currentUser.id, currentPlan.id, {
      sessionId: merged.session_id,
      status: merged.status,
      stage: merged.current_stage,
      knownConcepts: merged.profile?.known_concepts ?? currentPlan.knownConcepts ?? [],
    }))
    setPage(pageForSession(merged, { feedbackDismissed }))
    setError("")
  }

  const liveValue: LiveContextValue = {
    session: liveSession,
    isLive: Boolean(liveSession),
    learnerId,
    busy,
    error,
    diagnosisAnswers,
    assessmentAnswers,
    setDiagnosisAnswer: (itemId, answer) => setDiagnosisAnswers((current) => ({ ...current, [itemId]: answer })),
    setAssessmentAnswer: (itemId, answer) => setAssessmentAnswers((current) => ({ ...current, [itemId]: answer })),
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
        })
        applySession(created)
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
        applySession({ ...next, events: eventResult.events ?? [] })
        setAssessmentAnswers({})
      } catch (reason) { setError(reason instanceof Error ? reason.message : "提交诊断失败") }
      finally { setBusy("") }
    },
    submitAssessment: async () => {
      if (!liveSession || !assessmentComplete(liveSession, assessmentAnswers)) return
      setBusy("Role C正在正式评分并由主 Agent决定下一步…")
      setError("")
      try {
        const next = await submitAssessmentAnswers(liveSession.session_id, learnerId, answersToSubmission(liveSession.assessment?.payload?.items ?? [], assessmentAnswers))
        const eventResult = await getOrchestratorEvents(liveSession.session_id, learnerId).catch(() => ({ events: [] }))
        applySession({ ...next, events: eventResult.events ?? [] })
        setAssessmentAnswers({})
        setFeedbackDismissed(false)
        setPage("feedback")
      } catch (reason) { setError(reason instanceof Error ? reason.message : "提交正式测评失败") }
      finally { setBusy("") }
    },
    retry: async () => {
      if (!liveSession) return
      setBusy("主 Agent正在从持久化检查点重试…")
      setError("")
      try { applySession(await retryOrchestratorSession(liveSession.session_id, learnerId)) }
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

  const requestNewPlan = () => {
    if (!currentUser) {
      setProfileOpen(true)
      return
    }
    if (!provider.configured) {
      setOpenPlanAfterProvider(true)
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
            <button className={`api-button${provider.configured ? " is-ready" : ""}`} type="button" onClick={() => setProviderOpen(true)}><Settings2 size={16} /><span>API设置</span><small>{provider.configured ? provider.model_id : "未配置"}</small></button>
            <button className="avatar-button avatar-with-name" type="button" aria-label="切换学习者" onClick={() => setUserOpen((value) => !value)}><UserRound size={18} /><span>{currentUser?.name ?? "选择用户"}</span></button>
          </div>
        </header>
        {busy && <div className="live-operation" role="status"><span className="operation-spinner" />{busy}</div>}
        {error && <div className="live-error" role="alert"><b>主 Agent请求未完成</b><span>{error}</span><button type="button" onClick={() => setError("")}>知道了</button></div>}
        <main>
          {page === "home" && <HomeDashboard user={currentUser} mastered={currentUser ? masteredConceptsForUser(workspace, currentUser.id) : []} providerConfigured={provider.configured} onNewPlan={requestNewPlan} onEnterPlan={enterPlan} onDeletePlan={(planId) => currentUser && setWorkspace((value) => deletePlan(value, currentUser.id, planId))} />}
          {page === "goal" && currentPlan ? <GoalPage onContinue={() => setPage("diagnosis")} /> : null}
          {page === "diagnosis" && (liveSession ? <DiagnosisPage onContinue={() => setPage("path")} /> : <NoSessionState onStart={() => setPage("goal")} />)}
          {page === "path" && (liveSession ? <PathPage planName={currentPlan?.name} onContinue={() => setPage("lesson")} /> : <NoSessionState onStart={() => setPage("goal")} />)}
          {page === "lesson" && (liveSession ? <LessonPage onAssessment={() => setPage("assessment")} /> : <NoSessionState onStart={() => setPage("goal")} />)}
          {page === "assessment" && (liveSession ? (
            liveSession.status === "completed" || (liveSession.feedback && feedbackDismissed)
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
        {userOpen && createPortal(<UserSwitcher workspace={workspace} onClose={() => setUserOpen(false)} onAdd={() => { setUserOpen(false); setProfileOpen(true) }} onSelect={(id) => { setConfirmSwitchUserId(id); setUserOpen(false) }} />, document.body)}
        {confirmSwitchUserId && createPortal(<ConfirmSwitchUserModal targetUser={workspace.users.find(u => u.id === confirmSwitchUserId)} currentUser={currentUser} onCancel={() => setConfirmSwitchUserId(null)} onConfirm={() => { setWorkspace((value) => selectUser(value, confirmSwitchUserId)); setPage("home"); setConfirmSwitchUserId(null) }} />, document.body)}
        {providerOpen && <ApiConfigModal current={provider} dockerStatus={dockerStatus} onDockerSetup={() => { fetch("/orchestrator/docker-setup").then(r => r.json()).then(d => { if (d.ready) setDockerStatus({ ready: true }) }) }} onClose={() => { setProviderOpen(false); setOpenPlanAfterProvider(false) }} onSave={async (input) => { const saved = await saveProviderConfiguration(input); setProvider(saved); setProviderOpen(false); if (openPlanAfterProvider && currentUser) { const id = newClientId("plan"); setWorkspace((value) => addPlan(value, currentUser.id, { id, name: "待选择学习目标" })); setOpenPlanAfterProvider(false); setPage("goal") } }} />}
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
  return <div className="page page-home dashboard-home">
    <section className="home-hero fluid-hero">
      <span className="hero-glow glow-one" /><span className="hero-glow glow-two" /><span className="hero-sweep" />
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={15} /> 欢迎回到 <span className="brand-art">KnowBalance</span></span><h1>Hello, <em>{user?.name ?? "新同学"}</em></h1><p className="hero-slogan"><span className="brand-art slogan-art">八位 Agent</span> 同心协作，<br/>&nbsp;&nbsp;&nbsp;&nbsp;让每次学习都有<span className="brand-art slogan-art">专属节奏</span>。</p><div className="hero-facts"><span><CalendarClock size={16} /> {user ? `每周 ${user.weeklyHours} 小时` : "正在建立档案"}</span><span><GraduationCap size={16} /> {user ? pythonLevelLabel(user.pythonLevel) : "认识你的起点"}</span><span className={providerConfigured ? "fact-ready" : "fact-warning"}><Settings2 size={16} /> {providerConfigured ? "通用模型已就绪" : "API待配置"}</span></div></div>
      <div className="hero-illustration" aria-hidden="true">
        <img src={learningCatIllustration} alt="KnowBalance 学习伙伴" className="hero-cat-illustration" />
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
    <section className="home-bento">
      <section className="plan-manager">
      <header><div><span className="section-kicker section-kicker-with-icon"><Layers3 size={18} /> 计划管理</span><h2>学习，从计划开始</h2><p>计划只保存草稿和主 Agent会话入口；路径、内容与评分仍由上游生成。</p></div><button className="primary-action new-plan-button" type="button" onClick={onNewPlan}>＋ 新建计划</button></header>
      {user?.plans.length ? <div className="plan-card-grid">{user.plans.map((plan, index) => <article className="plan-card" key={plan.id} onClick={() => onEnterPlan(plan.id)}><div className={`plan-number tone-${index % 4}`}>{String(index + 1).padStart(2,"0")}</div><div className="plan-card-copy"><span>{plan.sessionId ? stageLabelFromSaved(plan.stage) : "等待选择学习目标"}</span><h3>{plan.name}</h3><p>{plan.sessionId ? `主 Agent会话 · ${plan.status ?? "已保存"}` : "点击进入，选择章节或填写自定义目标"}</p></div><button className="delete-plan" type="button" aria-label={`删除${plan.name}`} onClick={(event) => { event.stopPropagation(); onDeletePlan(plan.id) }}><Trash2 size={16} /></button><ChevronRight className="plan-enter" size={20} /></article>)}</div> : <article className="empty-plan-panel"><FolderTree size={34} /><h3>还没有学习计划</h3><p>点击新建后直接选择章节或填写自定义目标，计划名会自动生成。</p><button className="primary-action" type="button" onClick={onNewPlan}>新建第一个计划</button></article>}
      </section>
      <aside className="mastery-island"><header><span className="mastery-icon"><CheckCircle2 /></span><div><span className="section-kicker-light"><BookOpen size={16} /> 学习历程</span><h2>已掌握</h2></div><strong>{mastered.length}</strong></header>{mastered.length ? <div className="mastery-cloud">{mastered.map((concept, index) => <span style={{ "--mastery-index": index } as React.CSSProperties} key={concept}>{concept}</span>)}</div> : <div className="mastery-empty"><p>完成主 Agent画像后，这里会记录公开的已掌握知识。</p><small>D 不根据计划名称或答题数量自行判断掌握。</small></div>}<footer><ShieldCheck size={15} /> 来自主 Agent公开画像</footer></aside>
    </section>
    <section className="home-value-river"><article><Bot /><div><b>协同正在发生</b><p>八个固定角色各守边界，D只接收主 Agent公开状态。</p></div></article><article><ShieldCheck /><div><b>每一步都有出处</b><p>题目、路径、讲义与测评均保留真实来源和审核状态。</p></div></article><article><Clock3 /><div><b>学习不会丢失</b><p>计划绑定服务端会话，刷新后仍能从当前阶段继续。</p></div></article></section>
  </div>
}

function UserSwitcher({ workspace, onClose, onAdd, onSelect }: { workspace: WorkspaceState; onClose: () => void; onAdd: () => void; onSelect: (id: string) => void }) {
  return <div className="user-switcher-backdrop" role="presentation" onMouseDown={onClose}><section className="user-popover" role="dialog" aria-modal="true" aria-label="切换学习者" onMouseDown={(event) => event.stopPropagation()}><div className="popover-title"><div><span>学习者空间</span><b>切换学习者</b></div><button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></div><div className="user-options">{workspace.users.map((user) => <button className={workspace.activeUserId === user.id ? "is-active" : ""} type="button" key={user.id} onClick={() => onSelect(user.id)}><span>{user.name.slice(0,1)}</span><div><b>{user.name}</b><small>{user.plans.length} 个计划 · 每周 {user.weeklyHours} 小时</small></div>{workspace.activeUserId === user.id && <Check size={16} />}</button>)}</div><button className="add-user-button" type="button" onClick={onAdd}><UserPlus size={16} /> 新建学习者</button></section></div>
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
  return <Modal title="认识你，从更合适的第一步开始" subtitle="几项轻量信息会交给主 Agent和B，用于画像与路径设计。" onClose={onClose}><div className="form-grid"><label><span>怎么称呼你？</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：林晓" /></label><label><span>每周预计学习时长</span><select value={weeklyHours} onChange={(event) => setWeeklyHours(Number(event.target.value))}>{[2,3,5,7,10,14].map((hours) => <option value={hours} key={hours}>{hours} 小时 / 周</option>)}</select></label><label><span>你和 Python 的熟悉程度</span><select value={pythonLevel} onChange={(event) => setPythonLevel(event.target.value as LearnerProfileDraft["pythonLevel"])}><option value="new">完全没接触过</option><option value="beginner">了解一点基础</option><option value="intermediate">能写简单程序</option><option value="advanced">有项目经验</option></select></label><label><span>你更喜欢怎样学？</span><select value={learningStyle} onChange={(event) => setLearningStyle(event.target.value as LearnerProfileDraft["learningStyle"])}><option value="balanced">讲解与练习平衡</option><option value="practice">多动手、多练习</option><option value="concept">先理解原理</option><option value="project">跟着项目学习</option></select></label><label className="full-field"><span>目前的学习/工作背景</span><input value={background} onChange={(event) => setBackground(event.target.value)} placeholder="例如：高中生、计算机专业大一、转行学习" /></label><label className="full-field"><span>接触过其他编程语言吗？</span><input value={languages} onChange={(event) => setLanguages(event.target.value)} placeholder="选填，用顿号或逗号分隔" /></label></div><div className="modal-actions"><button className="secondary-action" type="button" onClick={onClose}>以后再说</button><button className="primary-action" disabled={!name.trim()} type="button" onClick={() => onCreate({ id: newClientId("learner"), name: name.trim(), weeklyHours, pythonLevel, learningStyle, background: background.trim(), priorLanguages: languages.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })}>保存学习档案</button></div></Modal>
}


function ApiConfigModal({ current, dockerStatus, onDockerSetup, onClose, onSave }: { current: { configured: boolean; endpoint: string; model_id: string }; dockerStatus: { ready: boolean; error?: string }; onDockerSetup: () => void; onClose: () => void; onSave: (input: { endpoint: string; modelId: string; apiKey: string }) => Promise<void> }) {
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
        // 轮询直到 Docker 就绪
        const poll = setInterval(async () => {
          try {
            const res = await fetch("/health")
            const data = await res.json()
            if (data?.docker?.ready) {
              clearInterval(poll)
              setFailure("")
              location.reload()
            }
          } catch {}
        }, 3000)
        setTimeout(() => { clearInterval(poll); setFailure("Docker 配置超时。请手动启动 Docker Desktop 后刷新页面。") }, 45000)
      }}>🔧 一键配置 Docker</button>}
    </div>
    <div className="api-security-note"><ShieldCheck size={19} /><div><b>本机配置，不进入前端计划</b><p>保存后主 Agent立即使用新配置；接口响应只返回模型名称和地址，不返回密钥。</p></div></div>
    <div className="form-grid"><label className="full-field"><span>兼容接口地址</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://.../chat/completions" /></label><label><span>模型 ID</span><input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="deepseek-chat" /></label><label><span>API Key</span><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={current.configured ? "输入新密钥以切换" : "仅发送到本机主 Agent"} /></label></div>{failure && <p className="form-error">{failure}</p>}<div className="modal-actions"><button className="secondary-action" type="button" onClick={onClose}>取消</button><button className="primary-action" disabled={saving || !endpoint.trim() || !modelId.trim() || !apiKey.trim()} type="button" onClick={() => void submit()}>{saving ? "正在安全保存…" : "保存并启用"}</button></div></Modal>
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" aria-label="关闭" onClick={onClose}><X /></button></header>{children}</section></div>
}

function pythonLevelLabel(level: LearnerProfileDraft["pythonLevel"]) {
  return ({ new: "Python 零基础", beginner: "Python 入门阶段", intermediate: "Python 进阶阶段", advanced: "Python 项目阶段" })[level]
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

function planNavSection(page: Page): Page {
  if (page === "diagnosis") return "goal"
  if (page === "feedback" || page === "history") return "assessment"
  return page
}

function GoalPage({ onContinue: _onContinue }: { onContinue: () => void }) {
  const { create, busy } = useLive()
  const chapters = PYTHON_CURRICULUM
  const initial = initialGoalSelection()
  const [mode, setMode] = useState<"catalog" | "custom">(initial.mode)
  const [selected, setSelected] = useState(initial.selectedNodeId)
  const [customGoal, setCustomGoal] = useState(initial.customGoal)
  const selectedTopic = chapters.flatMap((chapter) => chapter.topics).find((topic) => topic.node_id === selected)
  return <div className="page narrow-page"><PageHeading kicker="建立学习目标" title="这次，你想真正学会什么？" description="课程目录来自仓库中的 Python curriculum；也可以保留自定义目标模式。历史学习情况由主 Agent读取，不再要求你重复填写。" />
    <div className="segmented"><button className={mode === "catalog" ? "is-active" : ""} onClick={() => setMode("catalog")} type="button">从课程目录选择</button><button className={mode === "custom" ? "is-active" : ""} onClick={() => setMode("custom")} type="button">自定义学习目标</button></div>
    {mode === "catalog" ? <div className="chapter-grid">{chapters.map((chapter) => <article className={`chapter-card ${chapter.tone}`} key={chapter.node_id}><h2>{chapter.title}</h2>{chapter.topics.map((topic) => <button className={selected === topic.node_id ? "is-selected" : ""} type="button" key={topic.node_id} onClick={() => setSelected(topic.node_id)}><span>{topic.title}</span>{selected === topic.node_id && <Check size={16} />}</button>)}</article>)}</div> : <article className="custom-goal-card"><label htmlFor="custom-goal">用自己的话描述学习目标</label><textarea id="custom-goal" value={customGoal} onChange={(event) => setCustomGoal(event.target.value)} /><p>主 Agent会把自定义描述映射到真实课程知识与题库；D 不在本地推断结果。</p></article>}
    <div className="history-read-card"><div className="history-icon"><History /></div><div><b>历史学习情况由主 Agent处理</b><p>D 不要求用户手动填写薄弱知识，也不预先声称历史已经读取；画像生成后再展示主 Agent公开结果。</p></div><span>服务端负责</span></div>
    <div className="page-actions"><button className="primary-action" disabled={Boolean(busy) || (mode === "custom" ? customGoal.trim().length === 0 : !selectedTopic)} type="button" onClick={() => void create(mode === "custom" ? { goal: customGoal.trim(), custom: true, planName: planNameFromGoal({ mode: "custom", customGoal }) } : { goal: `学习${selectedTopic?.title ?? "Python基础"}`, nodeId: selectedTopic?.node_id, planName: planNameFromGoal({ mode: "catalog", chapterTitle: selectedTopic?.title ?? "Python基础" }) })}>{busy ? "正在创建会话…" : "确认目标并创建主 Agent会话"} <ArrowRight /></button></div>
  </div>
}

function DiagnosisPage({ onContinue: _onContinue }: { onContinue: () => void }) {
  const { isLive, diagnosisAnswers: liveAnswers, setDiagnosisAnswer, submitDiagnosis, busy } = useLive()
  const activeSession = useRequiredSession()
  const items = activeSession.waiting_for?.type === "diagnosis_answers" ? activeSession.waiting_for.items as any[] : []
  const previewItems = items
  const [index, setIndex] = useState(0)
  const answers = isLive ? liveAnswers : {}
  const item = previewItems[index]
  if (!item) return <EmptyState title="当前合同样例没有公开题目" body="D 不会为了页面完整而自造诊断题。正式接入后由主 Agent返回 A 题库中的公开题目。" />
  return <div className="page diagnosis-page"><PageHeading kicker="客观诊断 · 主 Agent实时题目" title="一次只回答一个问题" description="题目由主 Agent基于学习目标、历史与 A 题库动态选择；D 只展示公开题干和来源。" />
    <section className="diagnosis-shell"><div className="diagnosis-progress"><span>问题 {index + 1} / {previewItems.length}</span><div><i style={{ width: `${((index + 1) / previewItems.length) * 100}%` }} /></div><b>{Math.round(((index + 1) / previewItems.length) * 100)}%</b></div><article className="question-card"><div className="question-meta"><span>{item.difficulty ?? "诊断题"}</span><span>{item.concept}</span><span>{item.source_id}</span></div><h2>{item.question}</h2>{item.options?.length ? <div className="diagnosis-options">{item.options.map((option: string, optionIndex: number) => <button type="button" className={answers[item.item_id] === option ? "is-selected" : ""} onClick={() => setDiagnosisAnswer(item.item_id, option)} key={`${optionIndex}-${option}`}><span>{String.fromCharCode(65 + optionIndex)}</span><b>{option}</b>{answers[item.item_id] === option && <Check size={18} />}</button>)}</div> : <textarea placeholder="写下你的回答" value={answers[item.item_id] ?? ""} onChange={(event) => setDiagnosisAnswer(item.item_id, event.target.value)} />}
      <details className="why-question"><summary><CircleHelp size={16} /> 为什么问我这道题？</summary><p>用于诊断：{item.concept}。题目来源：{item.source_id}{item.fact_id ? ` / ${item.fact_id}` : ""}。D 不在浏览器中保存答案键。</p></details></article>
      <div className="diagnosis-actions"><button className="secondary-action" disabled={index === 0} type="button" onClick={() => setIndex((value) => value - 1)}><ChevronLeft /> 上一题</button>{index < previewItems.length - 1 ? <button className="primary-action" disabled={!answers[item.item_id]} type="button" onClick={() => setIndex((value) => value + 1)}>下一题 <ChevronRight /></button> : <button className="primary-action" disabled={Boolean(busy) || !diagnosisComplete(activeSession, answers)} type="button" onClick={() => void submitDiagnosis()}>{busy ? "正在生成学习资源…" : "提交诊断并生成学习方案"} <ArrowRight /></button>}</div></section>
  </div>
}

function PathPage({ planName, onContinue }: { planName?: string; onContinue: () => void }) {
  const { retry, reset, busy } = useLive()
  const activeSession = useRequiredSession()
  const profile = activeSession.profile
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
  const hasLesson = Boolean(activeSession.learning_resources.concept_lesson?.payload)
  const hasBlockedResource = activeSession.status === "blocked" || activeSession.status === "failed"
  if (!activeSession.current_path_node) return <BlockedResourceState session={activeSession} busy={busy} onRetry={() => void retry()} onRestart={reset} title="学习方案尚未形成可恢复检查点" />
  return <div className="page path-page week2-plan-page">
    <PageHeading kicker="学习方案 · Week 2 可视化报告" title={`本次计划：${displayPlanName}`} description="诊断完成后先在这里查看主 Agent公开的画像、难度匹配、正式路径和Agent协同过程；只有你主动点击后才进入 C 生成的互动学习内容。" />

    <section className="week2-summary-grid">
      <article className="profile-visual-card">
        <header><span><UserRound size={18} /></span><div><small>学习者画像 · B公开结果</small><h2>{profile ? difficultyLabel(profile.level) : "尚未生成画像"}</h2></div></header>
        {profile ? <>
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
          <dl><div><dt>本次目标</dt><dd>{profile.goal}</dd></div><div><dt>已掌握</dt><dd>{profile.known_concepts.length ? profile.known_concepts.join("、") : "主 Agent未公开已掌握概念"}</dd></div><div><dt>待补强</dt><dd>{profile.weak_concepts.length ? profile.weak_concepts.join("、") : "本轮诊断未公开薄弱概念"}</dd></div></dl>
          <p className="truth-note">能力雷达需要B公开多个能力维度及数值。当前合同只公开等级和概念集合，因此D不虚构雷达百分比。</p>
        </> : <MissingContent text="主 Agent尚未公开 B 学习者画像。" />}
      </article>

      <article className="difficulty-curve-card">
        <header><span><Target size={18} /></span><div><small>难度匹配曲线 · A检索证据</small><h2>{ragItems.length ? `${ragItems.length} 个公开知识候选` : "尚无难度匹配数据"}</h2></div></header>
        {ragItems.length ? <div className="difficulty-bars">{ragItems.slice(0, 8).map((item: any) => <article key={item.source_id}><div><b>{item.title}</b><small>{item.source_id} · {difficultyLabel(item.difficulty)}</small></div><span><i style={{ width: `${Math.min(100, Math.max(4, Number(item.score) || 0))}%` }} /></span><em className={item.retrieval_trace?.difficulty_match ? "is-match" : "is-gap"}>{item.retrieval_trace?.difficulty_match ? "难度匹配" : "需复核"}</em></article>)}</div> : <MissingContent text="主 Agent尚未公开 A RAG 难度匹配结果。" />}
        <p className="truth-note">曲线长度使用A公开检索分数；匹配状态使用 retrieval_trace.difficulty_match。D不自行计算“适配率”。</p>
      </article>
    </section>

    <section className="learning-path-visual">
      <header><div><small>学习路径图 · B正式路径</small><h2>{formalPath?.original_goal ?? displayPlanName}</h2></div><span>{pathNodes.length} 个节点</span></header>
      {pathNodes.length ? <div className="path-node-flow">{pathNodes.map((node: any, index: number) => <article className={`path-flow-node status-${node.status ?? "pending"}`} key={node.node_id}><div className="path-flow-index">{String(index + 1).padStart(2, "0")}</div><div><span>{node.status === "in_progress" ? "当前节点" : node.status === "completed" ? "已完成" : node.status === "blocked" ? "受阻" : "待学习"}</span><h3>{pathNodeTitle(node, ragItems)}</h3><p>目标来源：{node.target_source_ids?.join("、") || "未公开"}</p><small>先修：{node.prerequisite_source_ids?.length ? node.prerequisite_source_ids.join("、") : "无公开先修"}{node.goal && pathNodeTitle(node, ragItems) !== node.goal ? ` · 计划：${node.goal}` : ""}</small></div>{index < pathNodes.length - 1 && <ArrowRight className="path-flow-arrow" size={18} />}</article>)}</div> : <MissingContent text="B尚未公开正式学习路径节点。" />}
    </section>

    <section className="week2-lower-grid">
      <article className="current-objectives-card"><header><div><small>当前节点与观察目标</small><h2>{pathNodeTitle(activeSession.current_path_node, ragItems)}</h2></div><span>{activeSession.current_path_node?.goal && pathNodeTitle(activeSession.current_path_node, ragItems) !== activeSession.current_path_node.goal ? `${activeSession.current_path_node.goal} · ` : ""}{activeSession.current_path_node?.node_id}</span></header><div className="path-chain">{chain.map((entry: any, index: number) => <div className="chain-item" key={entry.node_id}><article className={`chain-node chain-${entry.status}`}><span className="chain-status">{entry.status === "completed" || entry.status === "reference_mastered" ? <Check size={15} /> : <i />}</span><div className="chain-body"><b>{entry.title}</b><small>{entry.source_id}{entry.status === "reference_mastered" ? " · 已掌握" : entry.status === "reference_pending" ? " · 先修" : ""}</small></div><em>{entry.status === "completed" ? "本轮已学习" : entry.status === "in_progress" ? "当前节点" : entry.status === "blocked" ? "受阻" : entry.status === "reference_mastered" ? "已掌握" : entry.status === "reference_pending" ? "先修待补" : "待学习"}</em></article>{index < chain.length - 1 && <ArrowDown className="chain-arrow" size={15} />}</div>)}</div>{objectives.length ? <div className="objective-list"><small className="objective-kicker">当前节点观察目标</small>{objectives.map((objective, index) => <article key={objective.objective_id}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{pathNodeTitle({ target_source_ids: [objective.source_id] }, ragItems)} · {behaviorLabel(objective.observable_behavior)}</b><p>来源 {objective.source_id} · 事实 {objective.required_fact_ids.length ? objective.required_fact_ids.join("、") : "尚未绑定"} · {objective.importance}</p></div></article>)}</div> : null}</article>
      <article className="agent-collaboration-card"><header><div><small>Agent协同过程 · 主 Agent台账</small><h2>{activeSession.worker_ledger.length} 个Worker状态</h2></div><Bot size={22} /></header><div className="agent-collaboration-list">{activeSession.worker_ledger.map((worker) => <article key={worker.worker}><span className={`agent-status status-${worker.status}`} /><div><b>{workerLabel(worker.worker)}</b><p>{worker.summary ?? "主 Agent未公开摘要"}</p></div><em>{worker.status}</em></article>)}</div></article>
    </section>

    {hasBlockedResource && <section className="plan-resource-status is-blocked"><ShieldCheck /><div><b>学习方案已保存，C互动资源尚未通过可信门禁</b><p>{activeSession.blocked_reason ?? "主 Agent未公开具体阻塞原因"}</p></div><button className="secondary-action" disabled={Boolean(busy)} type="button" onClick={() => void retry()}>{busy ? "正在原样重试…" : "原样重试 C 资源"}</button></section>}
    <section className="plan-enter-learning"><div><b>{hasLesson ? "互动学习资源已由主 Agent公开" : "互动学习资源尚未发布"}</b><p>{hasLesson ? "你可以主动进入C生成并经可信审核的讲义、代码实验和理解检查。" : "学习方案仍可查看；D不会用静态内容冒充C资源。"}</p></div><button className="primary-action" disabled={!hasLesson} type="button" onClick={onContinue}>进入互动学习 <ArrowRight /></button></section>
    <section className="provenance-note"><ShieldCheck /><div><b>Week 2 可视化只展示真实上游结果</b><p>画像和路径来自B，难度匹配与证据来自A，学习内容与测评来自C，协同状态来自主 Agent；D只负责可视化，不生成结论。</p></div></section>
  </div>
}

function LessonPage({ onAssessment }: { onAssessment: () => void }) {
  const { retry, reset, busy } = useLive()
  const activeSession = useRequiredSession()
  const lesson = activeSession.learning_resources.concept_lesson?.payload
  const lab = activeSession.learning_resources.code_lab?.payload
  const adaptation = activeSession.adaptation?.adaptation_action === "remediate" || activeSession.adaptation?.adaptation_action === "reinforce"
    ? activeSession.adaptation
    : null
  const [tab, setTab] = useState<LessonTab>("lesson")
  const [sideTab, setSideTab] = useState<SideTab>("hint")
  const [activeSection, setActiveSection] = useState("prerequisite")
  const [code, setCode] = useState(lab?.starter_code ?? "")
  if (!lesson) return <BlockedResourceState session={activeSession} busy={busy} onRetry={() => void retry()} onRestart={reset} title="互动学习资源未通过可信发布" />
  const sections = lesson ? lessonOutline(lesson) : []
  return <div className="lesson-page"><header className="lesson-topline"><div><span className="eyebrow"><BookOpen size={15} /> 第 {activeSession.round_no} 轮学习</span>{adaptation ? <span className={`lesson-adaptation-badge is-${adaptation.adaptation_action}`}>{adaptation.adaptation_action === "remediate" ? "针对性补救" : adaptation.adaptation_action === "reinforce" ? "巩固强化" : "下一节点适配"}</span> : null}<h1>{lesson?.title ?? "当前没有可发布的 C 讲义"}</h1><p>{activeSession.current_path_node?.node_id} · {lesson?.objective_ids.join(" / ")}</p></div><div className="lesson-top-actions"><span><CheckCircle2 size={15} /> 主 Agent已发布公开学习资源</span><button type="button" onClick={onAssessment}>进入正式测评 <ArrowRight /></button></div></header>
    <div className="lesson-layout">
      <aside className="lesson-outline"><div className="outline-head"><FolderTree size={18} /><b>本节目录</b></div>{sections.map((section, index) => <button className={activeSection === section.id ? "is-active" : ""} type="button" onClick={() => { setActiveSection(section.id); document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) }} key={section.id}><span>{String(index + 1).padStart(2, "0")}</span><b>{section.title}</b></button>)}<div className="outline-progress"><span>当前内容结构</span><div><i style={{ width: "58%" }} /></div><small>由 C 公开字段直接渲染</small></div></aside>
      <section className="lesson-main"><div className="lesson-tabs" role="tablist"><span className={`tab-glider glider-${tab}`} aria-hidden="true" /><button className={tab === "lesson" ? "is-active" : ""} type="button" onClick={() => setTab("lesson")}><BookOpen size={17} /> 定制讲义</button><button className={tab === "lab" ? "is-active" : ""} type="button" onClick={() => setTab("lab")}><Code2 size={17} /> 代码实验</button><button className={tab === "checks" ? "is-active" : ""} type="button" onClick={() => setTab("checks")}><ListChecks size={17} /> 理解检查</button></div>
        {!lesson ? <EmptyState title="C 讲义尚未发布" body="D 不会生成占位知识。请等待主 Agent返回 learning_resources.concept_lesson。" /> : tab === "lesson" ? <LessonContent lesson={lesson} onActive={setActiveSection} /> : tab === "lab" ? <LabContent lab={lab} code={code} setCode={setCode} /> : <ChecksContent lesson={lesson} />}
      </section>
      <aside className="lesson-side"><div className="side-tabs"><button className={sideTab === "hint" ? "is-active" : ""} onClick={() => setSideTab("hint")} type="button">学习提示</button><button className={sideTab === "evidence" ? "is-active" : ""} onClick={() => setSideTab("evidence")} type="button">知识来源</button><button className={sideTab === "agents" ? "is-active" : ""} onClick={() => setSideTab("agents")} type="button">Agent过程</button></div>{sideTab === "hint" ? <HintPanel lesson={lesson} /> : sideTab === "evidence" ? <EvidencePanel lesson={lesson} /> : <AgentPanel />}</aside>
    </div>
  </div>
}

function LessonContent({ lesson, onActive }: { lesson: LessonPayload; onActive: (id: string) => void }) {
  return <div className="lesson-document">
    <LessonSection id="prerequisite" title="连接已有知识" tone="warm" icon={<Layers3 />} onActive={onActive}>{lesson.prerequisite_bridge.length ? lesson.prerequisite_bridge.map((block) => <RenderLessonBlock block={block} key={block.block_id} />) : <MissingContent text="C 未公开 prerequisite_bridge" />}</LessonSection>
    <LessonSection id="concept" title="核心概念" tone="plain" icon={<Lightbulb />} onActive={onActive}>{lesson.explanation_blocks.map((block) => <RenderLessonBlock block={block} key={block.block_id} />)}</LessonSection>
    <LessonSection id="examples" title="分步示例" tone="blue" icon={<Braces />} onActive={onActive}>{lesson.worked_examples.length ? lesson.worked_examples.map((block) => <RenderLessonBlock block={block} key={block.block_id} />) : <MissingContent text="C 未公开 worked_examples" />}</LessonSection>
    <LessonSection id="misconceptions" title="常见误区" tone="amber" icon={<MessageCircleQuestion />} onActive={onActive}>{lesson.misconceptions.length ? <div className="misconception-grid">{lesson.misconceptions.map((item) => <article key={item.misconception_tag}><b>{item.objective_id}</b><p>{item.explanation}</p><small>{formatCitations(item.citations)}</small></article>)}</div> : <MissingContent text="C 未公开 misconceptions" />}</LessonSection>
    <LessonSection id="summary" title="本节小结" tone="mint" icon={<CheckCircle2 />} onActive={onActive}>{lesson.summary.length ? <ol className="summary-list">{lesson.summary.flatMap((block) => { const raw = "text" in block ? (block as any).text ?? "" : ""; const cleaned = stripClaimTextFromBody(raw, (block as any).claims ?? []); return cleaned.split(/\n+/).filter(Boolean).map((line, j, arr) => { const globalIndex = arr.length > 1 ? j : 0; return <li key={`${block.block_id}-${j}`}><span className="summary-num">{globalIndex + 1}.</span><p className="summary-line">{line.trim()}</p></li>; }) })}</ol> : <MissingContent text="C 未公开 summary" />}</LessonSection>
  </div>
}

function LessonSection({ id, title, tone, icon, children, onActive }: { id: string; title: string; tone: string; icon: React.ReactNode; children: React.ReactNode; onActive: (id: string) => void }) {
  return <section id={`section-${id}`} className={`lesson-section tone-${tone}`} onMouseEnter={() => onActive(id)}><header><span>{icon}</span><h2>{title}</h2></header>{children}</section>
}

function SemanticLessonText({ text }: { text: string }) {
  const indented = indentParagraphText(text)
  return <>{semanticLessonLines(indented).map((line, index) => <span className="semantic-lesson-line" key={`${index}-${line}`}>{line}</span>)}</>
}

/** 事实证据：C 公开的 claim 文本 + 引用来源，离上文空一行，紫色小字。 */
function ClaimEvidence({ claims, citations }: { claims: Array<{ claim_id: string; text: string }>; citations: Citation[] }) {
  if (!claims.length && !citations.length) return null
  return <div className="claim-evidence">
    <div className="claim-label">证据事实：</div>
    {citations.length > 0 && <div className="claim-citations">{formatCitations(citations)}</div>}
    {claims.map((claim) => <p key={claim.claim_id} className="claim-text">{claim.text}</p>)}
  </div>
}

/** 从段落文本中移除已作为 ClaimEvidence 独立展示的 claim 文本，避免重复。 */
function stripClaimTextFromBody(bodyText: string, claims: Array<{ text: string }>): string {
  if (!claims.length) {
    return bodyText.replace(/\s*证据事实[：:]\s*/gu, "").trim()
  }
  let cleaned = bodyText
  for (const claim of claims) {
    const escaped = claim.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    cleaned = cleaned.replace(new RegExp(`\\s*${escaped}\\s*[；;]?`, "gu"), "")
    cleaned = cleaned.replace(new RegExp(`\\s*证据事实[：:]\\s*${escaped}\\s*`, "gu"), "")
  }
  cleaned = cleaned.replace(/\s*证据事实[：:]\s*/gu, "")
  return cleaned.replace(/^[；;，,。.\s]+/u, "").replace(/[；;\s]+$/u, "").trim()
}

function RenderLessonBlock({ block }: { block: LessonPayload["explanation_blocks"][number] }) {
  const claims = ("claims" in block && Array.isArray((block as any).claims) ? (block as any).claims as Array<{ claim_id: string; text: string }> : [])
  const citations = claims.flatMap((claim) => (claim as any).citations ?? [])
  const bodyText = "text" in block ? stripClaimTextFromBody((block as any).text ?? "", claims) : ""
  if (block.block_type === "heading") return <h3 className="block-heading">{block.text}</h3>
  if (block.block_type === "paragraph") return <article className="prose-block"><p><SemanticLessonText text={bodyText} /></p><ClaimEvidence claims={claims} citations={citations} /></article>
  if (block.block_type === "code") return <article className="code-example"><div className="code-head"><span>{block.caption ?? "Python 示例"}</span><small>{block.language}</small></div><CodeViewer code={block.code} /><ClaimEvidence claims={claims} citations={citations} /></article>
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

function PythonCodeEditor({ value, onChange, minHeight = 260, ariaLabel = "Python 代码编辑器" }: { value: string; onChange: (value: string) => void; minHeight?: number; ariaLabel?: string }) {
  return <div className="python-editor" aria-label={ariaLabel}><Editor value={value} onValueChange={onChange} highlight={highlightPython} padding={16} textareaId={ariaLabel.replace(/\s+/g, "-")} style={{ minHeight, fontFamily: 'Consolas, "Liberation Mono", monospace', fontSize: 13, lineHeight: 1.7 }} /></div>
}

function CodeViewer({ code }: { code: string }) {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const lines = code.split("\n")
  useEffect(() => {
    if (!playing || lines.length < 2) return
    const timer = window.setInterval(() => setStep((value) => {
      if (value >= lines.length - 1) {
        setPlaying(false)
        return value
      }
      return value + 1
    }), 720)
    return () => window.clearInterval(timer)
  }, [playing, lines.length])
  const effectiveStep = Math.min(step, Math.max(0, lines.length - 1))
  return <div className="code-viewer"><div className="code-lines">{lines.map((line, index) => <div className={index === effectiveStep ? "is-current" : index < effectiveStep ? "is-past" : ""} key={`${index}-${line}`}><span>{index + 1}</span><code className="language-python" dangerouslySetInnerHTML={{ __html: highlightPython(line || " ") }} /></div>)}</div><div className="code-controls"><button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))}><ChevronLeft size={15} /> 上一步</button><button type="button" onClick={() => { setPlaying((value) => !value); if (!playing && effectiveStep >= lines.length - 1) setStep(0) }}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "暂停播放" : "自动演示"}</button><button type="button" onClick={() => setStep((value) => Math.min(lines.length - 1, value + 1))}>下一步 <ChevronRight size={15} /></button></div></div>
}

function LabContent({ lab, code, setCode }: { lab?: CodeLabPayload; code: string; setCode: (code: string) => void }) {
  if (!lab) return <EmptyState title="代码实验尚未发布" body="D 不会自造 starter code 或测试。请等待主 Agent返回 learning_resources.code_lab。" />
  return <div className="lab-workspace"><section className="lab-instructions"><span className="eyebrow"><FlaskConical size={15} /> {lab.lab_id}</span><h2>{lab.title}</h2>{lab.instructions.map((block) => <RenderLessonBlock block={block} key={block.block_id} />)}<div className="public-tests"><h3>公开测试</h3>{lab.public_tests.map((test) => <article key={test.test_id}><CheckCircle2 size={16} /><div><b>{test.description}</b><p>{test.expected_behavior}</p></div></article>)}</div></section><section className="editor-panel"><header><div><Braces size={17} /><b>Python 编辑器</b></div><small>{lab.execution_contract.execution_mode} · {lab.execution_contract.resource_limits.timeout_ms}ms</small></header><PythonCodeEditor value={code} onChange={setCode} minHeight={420} ariaLabel="代码实验 Python 编辑器" /><footer><button type="button" onClick={() => setCode(lab.starter_code)}><RotateCcw size={15} /> 重置</button></footer><div className="run-result is-visible"><b>当前主 Agent合同未提供代码运行命令</b><p>D 仅展示 C 发布的 starter code 与公开测试，不在浏览器伪造运行输出或通过状态。</p></div></section></div>
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

function HintPanel({ lesson }: { lesson?: LessonPayload }) {
  const [level, setLevel] = useState(1)
  const ladder = lesson?.hint_ladders?.[0]
  const hint = ladder?.hints.find((item) => item.hint_level === level)
  return <div className="side-panel-content"><span className="side-kicker"><Lightbulb size={15} /> 分层提示</span><h3>{ladder ? `${ladder.objective_id} 的提示阶梯` : "当前没有公开提示"}</h3>{hint ? <><p className="hint-copy">{hint.text}</p><CitationChips citations={hint.citations} /><div className="hint-levels">{[1, 2, 3].map((value) => <button className={level === value ? "is-active" : ""} type="button" onClick={() => setLevel(value)} key={value}>提示 {value}</button>)}</div></> : <p className="muted-copy">D 不会临时生成提示。接入后仅展示 C 公开的 hint_ladders。</p>}</div>
}

function EvidencePanel({ lesson }: { lesson?: LessonPayload }) {
  const evidence = uniqueCitations([...(lesson?.used_evidence ?? []), ...(lesson ? lesson.prerequisite_bridge.flatMap(blockCitations) : [])])
  return <div className="side-panel-content"><span className="side-kicker"><ShieldCheck size={15} /> 可追溯证据</span><h3>{evidence.length} 条公开引用</h3><p className="muted-copy">只展示 source_id / fact_id；缺失证据会如实显示，不生成虚构来源。</p><div className="evidence-list">{evidence.map((citation) => <article key={`${citation.source_id}-${citation.fact_id}`}><FileText size={16} /><div><b>{citation.source_id}</b><span>{citation.fact_id}</span></div><ExternalLink size={14} /></article>)}</div></div>
}

function AgentPanel() {
  const activeSession = useRequiredSession()
  const workers = activeSession.worker_ledger
  return <div className="side-panel-content"><span className="side-kicker"><Bot size={15} /> 主 Agent协同</span><h3>{workers.length} 个固定 Worker</h3><p className="muted-copy">状态来自持久化 worker_ledger。这里不播放与真实事件无关的“AI思考”动画。</p><div className="agent-list">{workers.map((worker) => <article key={worker.worker}><span className={`agent-status status-${worker.status}`} /> <div><b>{workerLabel(worker.worker)}</b><small>{worker.status}</small></div></article>)}</div></div>
}

function AssessmentPage({ onFeedback: _onFeedback }: { onFeedback: () => void }) {
  const { isLive, assessmentAnswers: answers, setAssessmentAnswer, clearAssessmentAnswers, submitAssessment, retry, reset, busy } = useLive()
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
  return <div className="page assessment-page"><PageHeading kicker={`正式测评 · ${assessment.title}`} title="提交后进入 Role C 正式评分" description="正确答案、评分规范与隐藏测试始终保留在服务端。当前作答会通过主 Agent命令提交，不在 D 中评分。" />
    <section className="assessment-shell"><aside><b>测评进度</b>{assessment.items.map((candidate, itemIndex) => <button className={itemIndex === index ? "is-active" : answers[candidate.item_id] ? "is-complete" : ""} type="button" onClick={() => setIndex(itemIndex)} key={candidate.item_id}><span>{itemIndex + 1}</span><small>{modalityLabel(candidate.modality)}</small></button>)}<p>{complete} / {assessment.items.length} 已作答</p></aside><article className="formal-question"><div className="question-meta"><span>第 {index + 1} 题</span><span>Tier {item.tier}</span><span>{item.max_score} 分</span></div><h2 className={isCodePrompt ? "formal-question-prompt is-code" : "formal-question-prompt"}>{item.prompt}</h2>{item.modality === "code" ? <PythonCodeEditor value={answers[item.item_id] ?? item.starter_code ?? ""} onChange={(value) => setAssessmentAnswer(item.item_id, value)} minHeight={360} ariaLabel={`正式测评第 ${index + 1} 题 Python 编辑器`} /> : item.options?.length ? <div className="formal-options">{item.options.map((option) => <button className={answers[item.item_id] === option.option_id ? "is-selected" : ""} type="button" onClick={() => setAssessmentAnswer(item.item_id, option.option_id)} key={option.option_id}><span>{option.label}</span><b>{option.text}</b></button>)}</div> : <textarea rows={6} value={answers[item.item_id] ?? ""} onChange={(event) => setAssessmentAnswer(item.item_id, event.target.value)} /> }<div className="formal-actions"><button className="secondary-action" disabled={index === 0} type="button" onClick={() => setIndex((value) => value - 1)}>上一题</button>{index < assessment.items.length - 1 ? <button className="primary-action" disabled={!answers[item.item_id]} type="button" onClick={() => setIndex((value) => value + 1)}>保存并下一题</button> : <button className="primary-action" disabled={Boolean(busy) || !assessmentComplete(activeSession, answers) || !isLive} type="button" onClick={() => void submitAssessment()}>{busy ? "正在正式评分…" : "提交正式测评"} <ArrowRight /></button>}</div></article></section>
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
  if (!feedback && activeSession.status !== "blocked" && activeSession.status !== "failed") return <div className="page feedback-page"><PageHeading kicker="正式反馈" title="等待 Role C 正式评分结果" description="D 不会根据作答或题目难度在浏览器里估算结果。" /><section className="feedback-empty"><div className="feedback-icon"><Sparkles /></div><h2>评分结果尚未返回</h2><p>完成正式测评后，主 Agent会持久化公开反馈与下一步决策。</p><button className="primary-action" type="button" onClick={onContinue}>返回互动学习</button></section></div>
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
  const adaptation = activeSession.adaptation?.adaptation_action === "remediate" || activeSession.adaptation?.adaptation_action === "reinforce"
    ? activeSession.adaptation
    : null
const finalAction = finalFeedbackAction(activeSession)
  return <div className="page feedback-page">{masteryNotice && <MasteryCelebration notice={masteryNotice} onClose={onMasteryDismiss} />}<PageHeading kicker={`正式反馈 · 第 ${activeSession.round_no > 1 ? activeSession.round_no - 1 : activeSession.round_no} 轮`} title={activeSession.status === "blocked" ? "下一步暂时受阻" : decisionTitle(decision?.action)} description={feedbackSummary || activeSession.blocked_reason || "主 Agent已返回本轮正式决策。"} /> <section className="feedback-result-grid"><article className="score-card"><span>本轮正式得分</span><strong>{feedback?.round_score ? `${feedback.round_score.raw_score} / ${feedback.round_score.max_score}` : "--"}</strong><p>{feedback?.round_score ? `正确率 ${Math.round(feedback.round_score.accuracy * 100)}% · 证据分 ${Math.round(feedback.round_score.evidence_score * 100)}%${wrongCount ? ` · ${wrongCount} 题未答对` : ""}` : "已保留此前评分，等待下一轮恢复。"}</p></article><article className="decision-card"><span>主 Agent下一步</span><h2>{decision?.action ? decisionLabel(decision.action) : "等待恢复"}</h2><p>{decision?.reason_codes?.join("、") || activeSession.blocked_reason || "暂无公开原因码"}</p></article></section><section className="decision-plan-card"><header><div><small>动态规划 · 下一轮方案选择</small><h2>主 Agent基于本轮结果选择下一轮方案</h2></div><span>{decision?.action ?? "pending"}</span></header><div className="decision-plan-grid">{planOptions.map((option) => <article className={decision?.action === option.action ? "is-current" : ""} key={option.action}><b>{option.title}</b><p>{option.description}</p>{decision?.action === option.action ? <em>本轮决策</em> : <i />}</article>)}</div></section>{adaptation ? <section className="adaptation-card"><small>本轮C资源适配说明</small><h2>{adaptation.adaptation_action === "remediate" ? "针对性补救" : adaptation.adaptation_action === "reinforce" ? "巩固强化" : "下一节点适配"}</h2><p>{adaptation.adaptation_summary}</p><p>目标：{adaptation.target_objective_ids.join("、") || "主Agent未公开具体目标"}</p>{adaptation.addressed_misconception_tags.length ? <p>针对误区：{adaptation.addressed_misconception_tags.join("、")}</p> : null}</section> : null}{itemViews.length ? <section className="item-feedback-list"><h2>逐题结果{wrongCount ? ` · ${wrongCount} 题待订正` : ""}</h2>{itemViews.map((view, index) => <article className={view.correct === false ? "is-wrong" : view.correct === true ? "is-correct" : "is-blank"} key={view.item_id}><header><span>{modalityLabel(view.modality as any)}</span><b>第 {index + 1} 题</b><em>{view.raw_score} / {view.max_score} 分</em></header><p className="item-prompt">{view.prompt}</p><dl><dt>你的答案</dt><dd>{view.your_answer_text}</dd></dl><div className="item-verdict">{view.correct === true ? "回答正确" : view.correct === false ? "回答错误" : "未作答"}</div>{view.correct_answer_text ? <dl className="correct-answer"><dt>参考答案</dt><dd className={view.correct_answer_kind === "code" ? "is-code" : ""}>{view.correct_answer_text}</dd></dl> : null}{view.feedback_message ? <p className="item-message">{view.feedback_message}</p> : null}{view.next_step ? <p className="item-next">下一步：{view.next_step}</p> : null}{view.correct === false && !view.correct_answer_text ? <small className="answer-boundary">C 本轮未公开结构化参考答案，仅提供评分反馈与下一步建议。</small> : null}</article>)}</section> : feedback?.your_answers?.length ? <section className="item-feedback-list"><p className="answer-boundary">本轮题目快照由旧版会话产生未公开，此处仅显示评分汇总；下一轮重新提交后可查看逐题结果。</p></section> : null}{feedback?.objective_results?.length ? <section className="objective-feedback"><h2>学习目标反馈</h2>{feedback.objective_results.map((item: any) => <article key={item.objective_id}><div><b>{item.objective_id}</b><span>{Math.round(item.accuracy * 100)}%</span></div><div className="objective-meter"><i style={{ width: `${Math.round(item.accuracy * 100)}%` }} /></div><p>{item.misconception_tags?.length ? `需要关注：${item.misconception_tags.join("、")}` : "本轮未返回误区标签"}</p></article>)}</section> : null}<div className="page-actions">{activeSession.status === "blocked" || activeSession.status === "failed" ? (() => { const action = blockedSessionAction(activeSession); return <button className="primary-action" disabled={Boolean(busy)} type="button" onClick={action.canRetry ? () => void retry() : reset}>{busy ? "正在恢复…" : action.label}</button> })() : <button className="primary-action" disabled={!(finalAction?.ready ?? nextRoundGate.ready)} type="button" onClick={onContinue}>{finalAction?.label ?? nextRoundGate.label}</button>}</div></div>
}

function HistoryPage() {
  const { refreshEvents } = useLive()
  const activeSession = useRequiredSession()
  const events = activeSession.events.slice(-10).reverse()
  return <div className="page history-page"><PageHeading kicker="学习记录" title="主 Agent持久化的真实过程" description="页面读取 events 与 worker_ledger，不由 D 拼接虚假的执行链。" /><div className="history-refresh"><button className="secondary-action" type="button" onClick={() => void refreshEvents()}>刷新真实事件</button></div><section className="history-layout"><article className="session-summary"><span>当前实时会话</span><h2>{activeSession.session_id}</h2><p>此处仅展示主 Agent公开会话状态和事件。</p><dl><div><dt>状态</dt><dd>{activeSession.status}</dd></div><div><dt>阶段</dt><dd>{activeSession.current_stage}</dd></div><div><dt>轮次</dt><dd>{activeSession.round_no}</dd></div><div><dt>更新时间</dt><dd>{formatTime(activeSession.updated_at)}</dd></div></dl></article><div className="event-timeline">{events.map((event, index) => <article key={`${event.seq ?? index}-${event.event_type}`}><span className={`event-dot status-${event.status ?? "pending"}`} /><div><div><b>{eventStage(event)}</b><time>{formatTime(event.timestamp ?? event.occurred_at)}</time></div><p>{event.summary || event.event_type}</p><small>{event.agent || event.worker || "learning-orchestrator"}</small></div></article>)}</div></section></div>
}

function BlockedResourceState({ session, busy, onRetry, onRestart, title }: { session: PublicSessionFixture; busy: string; onRetry: () => void; onRestart: () => void; title: string }) {
  const action = blockedSessionAction(session)
  return <div className="page"><section className="empty-state blocked-resource-state"><ShieldCheck size={29} /><h2>{title}</h2><p>{session.blocked_reason || "主 Agent尚未发布这一阶段的公开内容。"}</p><small>{action.canRetry ? "画像与学习路径已经保留；重试只会重新请求 C 生成、Docker验证和正式审核，不会改写你的诊断答案。" : "这是修复前创建的旧计划，没有保存真实诊断检查点；为避免篡改画像，不能用答案键自动重试。"}</small><button className="primary-action" disabled={Boolean(busy)} type="button" onClick={action.canRetry ? onRetry : onRestart}>{busy ? "正在恢复…" : action.label}</button></section></div>
}

function NoSessionState({ onStart }: { onStart: () => void }) {
  return <div className="page"><section className="empty-state"><ShieldCheck size={29} /><h2>需要先创建主 Agent会话</h2><p>为避免伪造，D 不会在没有服务端会话时展示画像、学习方案、C 讲义、正式测评、评分或 Worker状态。</p><button className="primary-action" type="button" onClick={onStart}>新建真实学习会话</button></section></div>
}

function PageHeading({ kicker, title, description }: { kicker: string; title: string; description: string }) {
  return <header className="page-heading"><span>{kicker}</span><h1>{title}</h1><p>{description}</p></header>
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
  return <div className="citation-chips">{unique.map((citation) => <span key={`${citation.source_id}-${citation.fact_id}`}>{citation.source_id} · {citation.fact_id}</span>)}</div>
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

function modalityLabel(modality: AssessmentPayload["items"][number]["modality"]) {
  return ({ mcq: "选择题", true_false: "判断题", trace: "代码追踪", short_answer: "简答题", code: "代码题" })[modality]
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

function difficultyPosition(value?: string) {
  return ({ beginner: 12, basic: 38, intermediate: 66, integrated: 92 } as Record<string, number>)[value ?? ""] ?? 0
}

function behaviorLabel(value: string) {
  return ({ recognize: "识别概念", trace: "追踪执行过程", apply: "应用知识", create: "完成作品" } as Record<string, string>)[value] ?? value
}

function workerLabel(worker: string) {
  return ({
    "background-collector": "历史与背景",
    "self-assessor": "学习者自评",
    "objective-diagnostician": "客观诊断",
    "profile-builder": "画像构建",
    "path-planner": "路径规划",
    "concept-tutor": "定制讲义",
    "code-lab": "代码实验",
    "tiered-evaluator": "分阶测评",
  } as Record<string, string>)[worker] ?? worker
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
