import { useEffect, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"
import {
  loopSteps,
  parseLoopVisualization,
  type LoopParsed,
} from "./loop-parse"

/**
 * 循环遍历可视化组件（Day6 方案 C，加分项）。
 * 仅当代码块可安全解析为列表字面量遍历时显示入口按钮；
 * 解析不出（range/变量/表达式）不渲染，绝不影响原内容展示。
 */

export function LoopVisualizerToggle({ code }: { code: string }) {
  const parsed = parseLoopVisualization(code)
  const [open, setOpen] = useState(false)
  if (!parsed) return null
  return <div className="loop-visualizer-wrap">
    <button type="button" className="loop-visualizer-toggle" onClick={() => setOpen((value) => !value)}>
      <Play size={13} /> {open ? "收起循环可视化" : "可视化循环执行"} <ChevronDown size={13} />
    </button>
    {open && <LoopVisualizer parsed={parsed} />}
  </div>
}

export function LoopVisualizer({ parsed }: { parsed: LoopParsed }) {
  const steps = loopSteps(parsed)
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setStep((value) => {
      if (value >= steps.length - 1) {
        setPlaying(false)
        return value
      }
      return value + 1
    }), 900)
    return () => window.clearInterval(timer)
  }, [playing, steps.length])
  const view = steps[Math.min(step, steps.length - 1)]!
  return <div className="loop-visualizer">
    <div className="loop-visualizer-elements">
      {parsed.elements.map((element, index) => {
        const isVisited = index < view.round
        const isCurrent = view.round > 0 && index === view.round - 1
        return <span key={`${index}-${element}`} className={`loop-element${isCurrent ? " is-current" : ""}${isVisited ? " is-visited" : ""}`}><small>#{index + 1}</small>{element}</span>
      })}
    </div>
    <div className="loop-visualizer-state">
      <code>第 {view.round} / {steps.length - 1} 轮</code>
      {view.round > 0
        ? <code>循环变量 <b>{view.variable}</b> = {view.current}</code>
        : <code>循环尚未开始（for {view.variable} in [...]）</code>}
      {view.remaining.length > 0
        ? <code>剩余 {view.remaining.length} 个元素</code>
        : <code>全部元素已遍历完成</code>}
    </div>
    <div className="loop-visualizer-controls">
      <button type="button" disabled={step === 0} onClick={() => { setPlaying(false); setStep((value) => Math.max(0, value - 1)) }}><ChevronLeft size={14} /> 上一步</button>
      <button type="button" onClick={() => { if (!playing && step >= steps.length - 1) setStep(0); setPlaying((value) => !value) }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "暂停" : "自动演示"}</button>
      <button type="button" disabled={step >= steps.length - 1} onClick={() => { setPlaying(false); setStep((value) => Math.min(steps.length - 1, value + 1)) }}>下一步 <ChevronRight size={14} /></button>
    </div>
  </div>
}
