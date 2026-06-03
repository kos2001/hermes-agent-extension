/**
 * Recharts-based visualizations for the side panel (Market Report + Bookmarks).
 *
 * Loaded lazily (see the views) so Recharts + its d3 deps stay out of the main
 * bundle. Colors are a fixed vivid palette that reads well on both the dark and
 * light themes; axis/tooltip chrome uses the theme CSS variables so it tracks
 * the active theme. Charts animate on mount via Recharts' built-in animation,
 * which we disable under `prefers-reduced-motion`.
 */
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { t, type Lang } from "@/lib/i18n";
import type { MarketReport } from "@/lib/market-report";
import type { Action, BookmarkNode } from "@/lib/bookmarks";

// Vivid, theme-agnostic series colors (mirrors the status/accent palette).
const C = {
  ok: "#62d488",
  fail: "#ff6b6b",
  neutral: "#8a90a4",
  accent: "#7c9cff",
  amber: "#f0b870",
  purple: "#b083ff",
};

const animate = !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

const tickStyle = { fill: "var(--muted)", fontSize: 10 } as const;
const tooltipStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 11,
  padding: "4px 8px",
} as const;

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        {hint && <span className="chart-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Donut with a centered total — used for categorical breakdowns. */
function Donut({ data, total }: { data: { name: string; value: number; color: string }[]; total: number }) {
  return (
    <div className="chart-donut-wrap">
      <ResponsiveContainer width="100%" height={150}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={42}
            outerRadius={62}
            paddingAngle={2}
            stroke="none"
            isAnimationActive={animate}
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "var(--text)" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="chart-donut-center">
        <strong>{total}</strong>
      </div>
      <ul className="chart-legend">
        {data.map((d) => (
          <li key={d.name}>
            <i style={{ background: d.color }} />
            {d.name} <b>{d.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars — readable for long category labels in a narrow panel. */
function HBars({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(80, data.length * 28 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={92} tick={tickStyle} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--panel-2)" }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={animate} label={{ position: "right", fill: "var(--muted)", fontSize: 10 }}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MarketCharts({ reports, lang }: { reports: MarketReport[]; lang: Lang }) {
  const latest = reports[0];
  const donut = useMemo(() => {
    if (!latest) return null;
    const failed = latest.sites.filter((s) => s.error).length;
    const covered = latest.sites.filter((s) => !s.error && s.summary).length;
    const data = [
      { name: t(lang, "chart.covered"), value: covered, color: C.ok },
      { name: t(lang, "chart.failed"), value: failed, color: C.fail },
      { name: t(lang, "chart.skipped"), value: latest.skipped, color: C.neutral },
    ].filter((d) => d.value > 0);
    return { data, total: covered + failed + latest.skipped };
  }, [latest, lang]);

  // Oldest → newest so the trend reads left-to-right.
  const trend = useMemo(
    () =>
      reports
        .slice(0, 8)
        .reverse()
        .map((r, i) => ({
          i: i + 1,
          covered: r.sites.filter((s) => !s.error && s.summary).length,
        })),
    [reports],
  );

  if (!donut || donut.total === 0) return null;

  return (
    <div className="charts">
      <Panel title={t(lang, "chart.coverage")} hint={latest.folderTitle}>
        <Donut data={donut.data} total={donut.total} />
      </Panel>
      {trend.length >= 2 && (
        <Panel title={t(lang, "chart.trend")} hint={`${trend.length} · ${t(lang, "chart.sites")}`}>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
              <defs>
                <linearGradient id="covGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.accent} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={C.accent} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <XAxis dataKey="i" tick={tickStyle} axisLine={false} tickLine={false} />
              <YAxis tick={tickStyle} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area
                type="monotone"
                dataKey="covered"
                name={t(lang, "chart.covered")}
                stroke={C.accent}
                strokeWidth={2}
                fill="url(#covGrad)"
                isAnimationActive={animate}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  );
}

export function BookmarkCharts({
  actions,
  nodes,
  lang,
}: {
  actions: Action[];
  nodes: BookmarkNode[];
  lang: Lang;
}) {
  const breakdown = useMemo(() => {
    if (actions.length === 0) return null;
    let dup = 0;
    let dead = 0;
    let low = 0;
    let move = 0;
    for (const a of actions) {
      if (a.kind === "move") move++;
      else if (a.reason === "duplicate") dup++;
      else if (a.reason === "dead") dead++;
      else low++;
    }
    return [
      { name: t(lang, "chart.duplicate"), value: dup, color: C.accent },
      { name: t(lang, "chart.dead"), value: dead, color: C.fail },
      { name: t(lang, "chart.lowValue"), value: low, color: C.amber },
      { name: t(lang, "chart.move"), value: move, color: C.purple },
    ].filter((d) => d.value > 0);
  }, [actions, lang]);

  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      if (!n.url) continue; // count bookmarks, not folders
      const key = n.parentTitle?.trim() || "—";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({
        name: name.length > 14 ? name.slice(0, 13) + "…" : name,
        value,
        color: C.accent,
      }));
  }, [nodes]);

  const totalBookmarks = useMemo(() => nodes.filter((n) => n.url).length, [nodes]);

  if (!breakdown && folders.length === 0) return null;

  return (
    <div className="charts">
      {breakdown && breakdown.length > 0 && (
        <Panel title={t(lang, "chart.actions")} hint={String(actions.length)}>
          <Donut data={breakdown} total={actions.length} />
        </Panel>
      )}
      {folders.length > 0 && (
        <Panel title={t(lang, "chart.folders")} hint={t(lang, "chart.total").replace("{n}", String(totalBookmarks))}>
          <HBars data={folders} />
        </Panel>
      )}
    </div>
  );
}
