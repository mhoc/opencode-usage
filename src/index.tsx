/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import { useBindings } from "@opentui/keymap/solid"
import { createResource, createSignal, For, Show } from "solid-js"
import {
  type TuiPlugin,
  type TuiPluginApi,
  type TuiPluginModule,
  type TuiRouteCurrent,
} from "@opencode-ai/plugin/tui"
import {
  formatCompact,
  formatCost,
  formatInteger,
  loadUsageReport,
  type ModelUsage,
  type UsageOptions,
  type UsageWindow,
} from "./usage.ts"
import type { CodexReport, CodexUsageWindow } from "./codex.ts"

const ROUTE = "usagex.modal"
const command = {
  open: "usagex.open",
}

type Color = TuiPluginApi["theme"]["current"]["text"]
type UsageTab =
  | { kind: "codex"; label: string; report: CodexReport }
  | { kind: "usage"; label: string; window: UsageWindow }

function truncate(value: string, width: number) {
  if (value.length <= width) return value
  if (width <= 1) return value.slice(0, width)
  return `${value.slice(0, width - 1)}…`
}

function formatStart(value?: number) {
  return value === undefined ? "All recorded usage" : `Since ${new Date(value).toLocaleString()}`
}

function Cell(props: { width: number; value: string; color: Color; right?: boolean; bold?: boolean }) {
  return (
    <box width={props.width} justifyContent={props.right ? "flex-end" : "flex-start"} flexShrink={0}>
      <text fg={props.color}>{props.bold ? <b>{props.value}</b> : props.value}</text>
    </box>
  )
}

function SummaryCard(props: { label: string; value: string; color: Color; muted: Color }) {
  return (
    <box flexDirection="column" flexGrow={1}>
      <text fg={props.muted}>{props.label}</text>
      <text fg={props.color}>
        <b>{props.value}</b>
      </text>
    </box>
  )
}

function formatDuration(seconds?: number) {
  if (seconds === undefined) return "Usage"
  if (seconds % 604_800 === 0) return `${seconds / 604_800} week`
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day`
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour`
  return `${Math.round(seconds / 60)} minute`
}

function formatReset(window: CodexUsageWindow, fetchedAt: number) {
  const seconds = window.resetAfterSeconds ?? (window.resetsAt ? window.resetsAt - fetchedAt / 1000 : undefined)
  if (seconds === undefined) return "Reset time unavailable"
  const safe = Math.max(0, seconds)
  const days = Math.floor(safe / 86_400)
  const hours = Math.floor((safe % 86_400) / 3_600)
  const minutes = Math.ceil((safe % 3_600) / 60)
  const relative = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`
  const at = window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString() : undefined
  return `Resets in ${relative}${at ? ` · ${at}` : ""}`
}

function CodexWindowCard(props: {
  title: string
  window: CodexUsageWindow
  fetchedAt: number
  api: TuiPluginApi
  compact: boolean
}) {
  const theme = props.api.theme.current
  const used = Math.max(0, Math.min(100, props.window.usedPercent))
  const width = props.compact ? 18 : 28
  const filled = Math.round((used / 100) * width)
  const color = used >= 90 ? theme.error : used >= 70 ? theme.warning : theme.primary
  return (
    <box flexDirection="column" flexGrow={1} border borderColor={theme.border} paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{props.title.toUpperCase()}</text>
        <text fg={color}><b>{Math.round(used)}% used</b></text>
      </box>
      <text>
        <span style={{ fg: color }}>{"█".repeat(filled)}</span>
        <span style={{ fg: theme.backgroundElement }}>{"░".repeat(width - filled)}</span>
      </text>
      <text fg={theme.text}>{Math.max(0, Math.round(100 - used))}% remaining</text>
      <text fg={theme.textMuted}>{formatReset(props.window, props.fetchedAt)}</text>
    </box>
  )
}

function CodexView(props: { report: CodexReport; api: TuiPluginApi; compact: boolean }) {
  const theme = props.api.theme.current
  const usage = () => props.report.usage
  const plan = () => usage()?.planType?.replaceAll("_", " ")
  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>Codex subscription limits</b>
          <Show when={plan()}>{(value) => <span style={{ fg: theme.textMuted }}>  {value()}</span>}</Show>
        </text>
        <Show when={usage()?.limitReached}>
          <text fg={theme.error}><b>LIMIT REACHED</b></text>
        </Show>
      </box>

      <Show when={props.report.error}>
        {(error) => (
          <box border borderColor={theme.error} paddingLeft={2} paddingRight={2}>
            <text fg={theme.error}>{error()}</text>
          </box>
        )}
      </Show>

      <Show when={usage()}>
        {(data) => (
          <>
            <box flexDirection={props.compact ? "column" : "row"} gap={1}>
              <Show when={data().primary}>
                {(window) => (
                  <CodexWindowCard
                    title={`${formatDuration(window().windowSeconds)} limit`}
                    window={window()}
                    fetchedAt={props.report.fetchedAt}
                    api={props.api}
                    compact={props.compact}
                  />
                )}
              </Show>
              <Show when={data().secondary}>
                {(window) => (
                  <CodexWindowCard
                    title={`${formatDuration(window().windowSeconds)} limit`}
                    window={window()}
                    fetchedAt={props.report.fetchedAt}
                    api={props.api}
                    compact={props.compact}
                  />
                )}
              </Show>
            </box>
            <Show when={!data().primary && !data().secondary}>
              <text fg={theme.textMuted}>OpenAI returned no Codex usage windows.</text>
            </Show>
            <Show when={data().credits?.unlimited || data().credits?.balance}>
              <text fg={theme.textMuted}>
                Credits: {data().credits?.unlimited ? "Unlimited" : data().credits?.balance}
              </text>
            </Show>
          </>
        )}
      </Show>

      <box flexGrow={1} />
      <text fg={theme.textMuted}>
        OpenAI subscription data · updated {new Date(props.report.fetchedAt).toLocaleTimeString()} · r to refresh
      </text>
    </box>
  )
}

function ModelRow(props: { usage: ModelUsage; modelWidth: number; api: TuiPluginApi; compact: boolean }) {
  const theme = props.api.theme.current
  const name = `${props.usage.provider}/${props.usage.model}`
  return (
    <box flexDirection="column">
      <box flexDirection="row" gap={1}>
        <Cell width={props.modelWidth} value={truncate(name, props.modelWidth)} color={theme.text} />
        <Show when={!props.compact}>
          <Cell width={7} value={formatInteger(props.usage.messages)} color={theme.textMuted} right />
          <Cell width={14} value={formatInteger(props.usage.real)} color={theme.text} right />
          <Cell width={14} value={formatInteger(props.usage.cache)} color={theme.text} right />
        </Show>
        <Cell width={14} value={formatInteger(props.usage.raw)} color={theme.primary} right bold />
        <Cell width={12} value={formatCost(props.usage)} color={theme.success} right />
      </box>
      <text fg={theme.textMuted}>
        {props.compact
          ? `msgs ${formatCompact(props.usage.messages)} · real ${formatCompact(props.usage.real)} · cache ${formatCompact(props.usage.cache)} · in ${formatCompact(props.usage.input)} · out ${formatCompact(props.usage.output)} · reason ${formatCompact(props.usage.reasoning)} · rd ${formatCompact(props.usage.cacheRead)} · wr ${formatCompact(props.usage.cacheWrite)}`
          : `${" ".repeat(Math.min(props.modelWidth, 4))}in ${formatInteger(props.usage.input)}  out ${formatInteger(props.usage.output)}  reason ${formatInteger(props.usage.reasoning)}  cache rd ${formatInteger(props.usage.cacheRead)}  cache wr ${formatInteger(props.usage.cacheWrite)}`}
      </text>
    </box>
  )
}

function UsageModal(props: {
  api: TuiPluginApi
  options: UsageOptions
  close: () => void
}) {
  const dimensions = useTerminalDimensions()
  const [active, setActive] = createSignal(0)
  const [offset, setOffset] = createSignal(0)
  const [report, { refetch }] = createResource(() => loadUsageReport(props.options))

  const tabs = (): UsageTab[] => {
    const data = report()
    if (!data) return []
    return [
      ...(data.codex ? [{ kind: "codex" as const, label: "Codex", report: data.codex }] : []),
      ...data.windows.map((window) => ({ kind: "usage" as const, label: window.label, window })),
    ]
  }
  const tab = () => tabs()[active()]
  const window = () => {
    const selected = tab()
    return selected?.kind === "usage" ? selected.window : undefined
  }
  const dialogWidth = () => Math.min(116, dimensions().width - 2)
  const compact = () => dialogWidth() < 100
  const modelWidth = () => Math.max(18, dialogWidth() - (compact() ? 37 : 70))
  const pageSize = () => Math.max(1, Math.floor((dimensions().height - 21) / 2))
  const visibleModels = () => window()?.models.slice(offset(), offset() + pageSize()) ?? []

  const selectWindow = (index: number) => {
    const count = tabs().length || 4
    setActive((index + count) % count)
    setOffset(0)
  }

  const move = (delta: number) => {
    const count = window()?.models.length ?? 0
    const max = Math.max(0, count - pageSize())
    setOffset((value) => Math.max(0, Math.min(max, value + delta)))
  }

  useBindings(() => ({
    priority: 1000,
    bindings: [
      { key: "escape", cmd: props.close },
      { key: "q", cmd: props.close },
      { key: "left", cmd: () => selectWindow(active() - 1) },
      { key: "h", cmd: () => selectWindow(active() - 1) },
      { key: "right", cmd: () => selectWindow(active() + 1) },
      { key: "l", cmd: () => selectWindow(active() + 1) },
      { key: "tab", cmd: () => selectWindow(active() + 1) },
      { key: "up", cmd: () => move(-1) },
      { key: "k", cmd: () => move(-1) },
      { key: "down", cmd: () => move(1) },
      { key: "j", cmd: () => move(1) },
      { key: "r", cmd: () => void refetch() },
    ],
  }))

  const theme = () => props.api.theme.current

  return (
    <box width="100%" height="100%" backgroundColor={theme().background}>
      <props.api.ui.Dialog size="xlarge" onClose={props.close}>
        <box
          width="100%"
          height={Math.max(18, Math.floor(dimensions().height * 0.7))}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="column"
          gap={1}
        >
          <box flexDirection="row" justifyContent="space-between">
            <text fg={theme().text}>
              <b>OpenCode Usage</b>
              <span style={{ fg: theme().textMuted }}>  local tokens and API-equivalent cost</span>
            </text>
            <Show when={!compact()}>
              <text fg={theme().textMuted}>←/→ window  ↑/↓ scroll  r refresh  esc close</text>
            </Show>
          </box>

          <Show when={report()} fallback={<text fg={theme().textMuted}>Loading usage and current pricing…</text>}>
            {(data) => (
              <>
                <box flexDirection="row" gap={1}>
                  <For each={tabs()}>
                    {(item, index) => {
                      const selected = () => active() === index()
                      return (
                        <box
                          onMouseUp={() => selectWindow(index())}
                          backgroundColor={selected() ? theme().primary : theme().backgroundElement}
                          paddingLeft={2}
                          paddingRight={2}
                        >
                          <text fg={selected() ? theme().selectedListItemText : theme().text}>{item.label}</text>
                        </box>
                      )
                    }}
                  </For>
                </box>

                <Show when={tab()?.kind === "codex" ? data().codex : undefined}>
                  {(codex) => <CodexView report={codex()} api={props.api} compact={compact()} />}
                </Show>

                <Show when={window()}>
                  {(selected) => (
                    <>
                      <box flexDirection="row" border borderColor={theme().border} paddingLeft={2} paddingRight={2}>
                        <SummaryCard label="RAW TOKENS" value={formatInteger(selected().total.raw)} color={theme().primary} muted={theme().textMuted} />
                        <SummaryCard label="REAL TOKENS" value={formatInteger(selected().total.real)} color={theme().text} muted={theme().textMuted} />
                        <SummaryCard label="CACHE TOKENS" value={formatInteger(selected().total.cache)} color={theme().text} muted={theme().textMuted} />
                        <SummaryCard label="API COST" value={formatCost(selected().total)} color={theme().success} muted={theme().textMuted} />
                      </box>

                      <box flexDirection="row" gap={1}>
                        <Cell width={modelWidth()} value="MODEL" color={theme().textMuted} />
                        <Show when={!compact()}>
                          <Cell width={7} value="MSGS" color={theme().textMuted} right />
                          <Cell width={14} value="REAL" color={theme().textMuted} right />
                          <Cell width={14} value="CACHE" color={theme().textMuted} right />
                        </Show>
                        <Cell width={14} value="RAW" color={theme().textMuted} right />
                        <Cell width={12} value="API COST" color={theme().textMuted} right />
                      </box>

                      <Show when={selected().models.length} fallback={<text fg={theme().textMuted}>No token usage in this window.</text>}>
                        <For each={visibleModels()}>
                          {(usage) => (
                            <ModelRow usage={usage} modelWidth={modelWidth()} api={props.api} compact={compact()} />
                          )}
                        </For>
                      </Show>

                      <box flexGrow={1} />
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={theme().textMuted}>
                          Models {selected().models.length ? offset() + 1 : 0}–{Math.min(offset() + pageSize(), selected().models.length)} of{" "}
                          {selected().models.length}
                        </text>
                        <text fg={theme().textMuted}>
                          {formatStart(selected().startsAt)} · updated {new Date(data().generatedAt).toLocaleTimeString()}
                        </text>
                      </box>
                    </>
                  )}
                </Show>

                <Show when={window() && data().pricingWarning}>
                  <text fg={theme().warning}>Pricing unavailable: {data().pricingWarning}</text>
                </Show>
                <Show when={window() && data().unpriced.length}>
                  <text fg={theme().warning}>Unpriced: {data().unpriced.join(", ")}</text>
                </Show>
                <Show when={window()}>
                  <text fg={theme().textMuted}>
                    Real = input + output + reasoning · Cache = reads + writes · models.dev prices are estimates
                  </text>
                </Show>
              </>
            )}
          </Show>

          <Show when={report.error}>
            <text fg={theme().error}>Could not load usage: {report.error instanceof Error ? report.error.message : String(report.error)}</text>
          </Show>
        </box>
      </props.api.ui.Dialog>
    </box>
  )
}

function returnTo(api: TuiPluginApi, route: TuiRouteCurrent) {
  if ("params" in route) {
    api.route.navigate(route.name, route.params)
    return
  }
  api.route.navigate(route.name)
}

const tui: TuiPlugin = async (api, rawOptions) => {
  const options: UsageOptions = {
    db: typeof rawOptions?.db === "string" ? rawOptions.db : undefined,
    pricingUrl: typeof rawOptions?.pricingUrl === "string" ? rawOptions.pricingUrl : undefined,
  }
  let previous: TuiRouteCurrent = { name: "home" }
  const close = () => returnTo(api, previous)

  api.route.register([
    {
      name: ROUTE,
      render: () => <UsageModal api={api} options={options} close={close} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: command.open,
        title: "Open usage report",
        category: "Plugin",
        namespace: "palette",
        slashName: "usagex",
        run() {
          previous = api.route.current
          api.route.navigate(ROUTE)
        },
      },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "usagex",
  tui,
}

export default plugin
