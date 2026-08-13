// bun test DOM 环境（jsdom）—— 供前端交互测试使用
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:4175/",
  pretendToBeVisual: true,
})

const g = globalThis as Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
g.navigator = dom.window.navigator
g.HTMLElement = dom.window.HTMLElement
g.Element = dom.window.Element
g.Node = dom.window.Node
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0)
g.cancelAnimationFrame = (id: number) => clearTimeout(id)
g.MutationObserver = dom.window.MutationObserver
g.CustomEvent = dom.window.CustomEvent
g.Event = dom.window.Event
g.KeyboardEvent = dom.window.KeyboardEvent
g.MouseEvent = dom.window.MouseEvent
g.TextEncoder = TextEncoder
g.TextDecoder = TextDecoder
