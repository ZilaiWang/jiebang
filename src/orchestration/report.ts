import type { OrchestrationRunSummary, TraceEvent } from "./types"

export function renderTraceSummaryMarkdown(summary: OrchestrationRunSummary): string {
  const lines = [
    "# Learning Orchestrator Run Summary",
    "",
    `- Run ID: ${summary.run_id}`,
    `- Session ID: ${summary.session_id}`,
    `- Mode: ${summary.mode}`,
    `- Status: ${summary.status}`,
    `- Started at: ${summary.started_at}`,
    `- Finished at: ${summary.finished_at}`,
    `- Completed steps: ${summary.completed_steps}/${summary.total_steps}`,
  ]

  if (summary.blocked_stage) {
    lines.push(`- Blocked stage: ${summary.blocked_stage}`)
  }

  if (summary.failed_stage) {
    lines.push(`- Failed stage: ${summary.failed_stage}`)
  }

  if (summary.learner_memory_ref) {
    lines.push(`- Learner memory: ${summary.learner_memory_ref}`)
  }

  if (summary.clarification_requests.length > 0) {
    lines.push("", "## Clarification requests", "")
    for (const request of summary.clarification_requests) {
      lines.push(`- ${request.question} — ${request.reason}`)
    }
  }

  lines.push(
    "",
    "## Trace Events",
    "",
    "| Step | Stage | Worker | Event | Message |",
    "|---:|---|---|---|---|",
  )

  for (const event of summary.events) {
    lines.push(renderEventRow(event))
  }

  const errorEvents = summary.events.filter((event) => event.error)
  if (errorEvents.length > 0) {
    lines.push("", "## Errors", "")
    for (const event of errorEvents) {
      lines.push(
        `- Step ${event.step_index} ${event.error?.code}: ${event.error?.message}`,
      )
    }
  }

  return `${lines.join("\n")}\n`
}

function renderEventRow(event: TraceEvent): string {
  return `| ${event.step_index} | ${event.stage} | ${event.worker ?? "—"} | ${event.event_type} | ${escapeTableCell(event.message)} |`
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}
