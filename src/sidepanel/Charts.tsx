/**
 * Recharts-based visualizations for the side panel (Market Report + Bookmarks).
 *
 * Loaded lazily (see the views) so Recharts + its d3 deps stay out of the main
 * bundle. Colors are a fixed vivid palette that reads well on both the dark and
 * light themes; axis/tooltip chrome uses the theme CSS variables so it tracks
 * the active theme. Each chart card carries a +/− zoom control that scales the
 * chart's primary dimension. Charts animate on mount via Recharts' built-in
 * animation, which we disable under `prefers-reduced-motion`.
 */
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { t, type Lang } from "@/lib/i18n";
import type { MarketReport } from "@/lib/market-report";
import type { BookmarkNode } from "@/lib/bookmarks";

// Vivid, theme-agnostic series colors (mirrors the status/accent palette).
const C = {
  ok: "#62d488",
  fail: "#ff6b6b",
  neutral: "#8a90a4",
  accent: "#7c9cff",
};

const animate = !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

const tickStyle = { fill: "var(--muted)", fontSize: 10 } as const;
// All tooltip text uses --text so it stays legible against the --panel-2 box on
// either theme (Recharts' default label/item gray washes out on the dark panel).
const tooltipProps = {
  contentStyle: {
    background: "var(--panel-2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 11,
    padding: "4px 8px",
    color: "var(--text)",
  },
  labelStyle: { color: "var(--text)", fontWeight: 600 },
  itemStyle: { color: "var(--text)" },
} as const;

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.25;

/** A chart card with a title, optional hint, +/− zoom, and a hide/show toggle. */
function ChartCard({
  title,
  hint,
  lang,
  render,
}: {
  title: string;
  hint?: string;
  lang: Lang;
  render: (zoom: number) => React.ReactNode;
}) {
  const [zoom, setZoom] = useState(1);
  const [hidden, setHidden] = useState(false);
  const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  return (
    <div className={`chart-card${hidden ? " collapsed" : ""}`}>
      <div className="chart-head">
        <span className="chart-title">{title}</span>
        <span className="chart-controls">
          {hint && <span className="chart-hint">{hint}</span>}
          {!hidden && (
            <>
              <button
                type="button"
                className="chart-zoom"
                onClick={() => setZoom((z) => clamp(z - ZOOM_STEP))}
                disabled={zoom <= ZOOM_MIN}
                title={t(lang, "chart.zoomOut")}
                aria-label={t(lang, "chart.zoomOut")}
              >
                −
              </button>
              <button
                type="button"
                className="chart-zoom"
                onClick={() => setZoom((z) => clamp(z + ZOOM_STEP))}
                disabled={zoom >= ZOOM_MAX}
                title={t(lang, "chart.zoomIn")}
                aria-label={t(lang, "chart.zoomIn")}
              >
                +
              </button>
            </>
          )}
          <button
            type="button"
            className="chart-zoom chart-toggle"
            onClick={() => setHidden((h) => !h)}
            title={t(lang, hidden ? "chart.show" : "chart.hide")}
            aria-label={t(lang, hidden ? "chart.show" : "chart.hide")}
            aria-expanded={!hidden}
          >
            {hidden ? "▸" : "▾"}
          </button>
        </span>
      </div>
      {!hidden && render(zoom)}
    </div>
  );
}

/** Horizontal bars — readable for long category labels in a narrow panel. */
function HBars({ data, zoom }: { data: { name: string; value: number; color: string }[]; zoom: number }) {
  const rowH = 28 * zoom;
  const height = Math.max(80, Math.round(data.length * rowH + 20));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 30, bottom: 4, left: 4 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={92} tick={tickStyle} axisLine={false} tickLine={false} />
        {/* Subtle accent wash on hover so the row highlight never hides the labels. */}
        <Tooltip {...tooltipProps} cursor={{ fill: "var(--accent)", fillOpacity: 0.12 }} />
        <Bar
          dataKey="value"
          radius={[0, 4, 4, 0]}
          isAnimationActive={animate}
          label={{ position: "right", fill: "var(--text)", fontSize: 11 }}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MarketCharts({ reports, lang }: { reports: MarketReport[]; lang: Lang }) {
  // Oldest → newest so the trend reads left-to-right. (The per-report coverage
  // donut was dropped — the trend across runs is the useful view.)
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

  if (trend.length < 2) return null;

  return (
    <div className="charts">
      {trend.length >= 2 && (
        <ChartCard
          title={t(lang, "chart.trend")}
          hint={`${trend.length} · ${t(lang, "chart.sites")}`}
          lang={lang}
          render={(z) => (
            <ResponsiveContainer width="100%" height={Math.round(120 * z)}>
              <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
                <defs>
                  <linearGradient id="covGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.accent} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={C.accent} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="i" tick={tickStyle} axisLine={false} tickLine={false} />
                <YAxis tick={tickStyle} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
                <Tooltip {...tooltipProps} />
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
          )}
        />
      )}
    </div>
  );
}

export function BookmarkCharts({ nodes, lang }: { nodes: BookmarkNode[]; lang: Lang }) {
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

  if (folders.length === 0) return null;

  return (
    <div className="charts">
      <ChartCard
        title={t(lang, "chart.folders")}
        hint={t(lang, "chart.total").replace("{n}", String(totalBookmarks))}
        lang={lang}
        render={(z) => <HBars data={folders} zoom={z} />}
      />
    </div>
  );
}
