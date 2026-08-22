import { describe, expect, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { CollaborationDrawer } from "./App"

describe("collaboration drawer empty session", () => {
  test("shows every agent as unfinished and includes the waiting-user legend", () => {
    render(<CollaborationDrawer session={null} onClose={() => {}} />)
    expect(screen.getByText("背景采集｜Agent background-collector")).toBeTruthy()
    expect(screen.getByText("学习者自评｜Agent self-assessor")).toBeTruthy()
    expect(screen.getByText("客观诊断｜Agent objective-diagnostician")).toBeTruthy()
    expect(screen.getByText("画像构建｜Agent profile-builder")).toBeTruthy()
    expect(screen.getByText("路径规划｜Agent path-planner")).toBeTruthy()
    expect(screen.getByText("定制讲义｜Agent concept-tutor")).toBeTruthy()
    expect(screen.getByText("代码实验｜Agent code-lab")).toBeTruthy()
    expect(screen.getByText("分阶测评｜Agent tiered-evaluator")).toBeTruthy()
    expect(screen.getByText("● 提取学习者背景、过往经验和学习目标。")).toBeTruthy()
    expect(document.querySelectorAll(".vertical-station.is-pending")).toHaveLength(8)
    expect(screen.getByText("等待用户输入")).toBeTruthy()
  })
})
