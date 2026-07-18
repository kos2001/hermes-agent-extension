/**
 * Dependency-free SVG/CSS visualizations for the side panel (Market Report +
 * Bookmarks). These replaced Recharts — at ≤8 data points per chart the
 * library was ~44% of the shipped extension JS for two tiny charts.
 *
 * Still code-split (see the lazy imports in the views), colors are a fixed
 * vivid palette that reads well on both themes, and axis/label chrome uses the
 * theme CSS variables. Each chart card carries a +/− zoom control that scales
 * the chart's primary dimension. Values surface via native tooltips (`title`),
 * which need no positioning code and can't overflow the narrow panel.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { MarketReport } from "@/lib/market-report";
import type { BookmarkNode } from "@/lib/bookmarks";

/** Series accent — mirrors the status/accent palette used across the panel. */
const ACCENT = "#7c9cff";

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

/** Track a container's width so SVG charts re-plot when the panel resizes. */
function useMeasuredWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Horizontal bars — readable for long category labels in a narrow panel. */
function HBars({ data, zoom }: { data: { name: string; value: number; color: string }[]; zoom: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="hx-bars">
      {data.map((d) => (
        <div key={d.name} className="hx-bar-row" style={{ height: 28 * zoom }} title={`${d.name}: ${d.value}`}>
          <span className="hx-bar-label">{d.name}</span>
          <span className="hx-bar-track">
            <span className="hx-bar-fill" style={{ width: `${(d.value / max) * 100}%`, background: d.color }} />
          </span>
          <span className="hx-bar-value">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Line-with-area trend: straight segments, gradient fill, per-point tooltip. */
function AreaTrend({
  data,
  height,
  name,
}: {
  data: { label: string; value: number }[];
  height: number;
  name: string;
}) {
  const [wrapRef, width] = useMeasuredWidth();
  const m = { top: 6, right: 10, bottom: 16, left: 30 };
  const iw = Math.max(0, width - m.left - m.right);
  const ih = Math.max(0, height - m.top - m.bottom);
  const max = Math.max(1, ...data.map((d) => d.value));
  const x = (i: number) => m.left + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => m.top + ih - (v / max) * ih;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${m.top + ih} L${x(0)},${m.top + ih} Z`;
  const yTicks = [...new Set([0, Math.round(max / 2), max])];
  return (
    <div ref={wrapRef} className="hx-area">
      {width > 0 && (
        <svg width={width} height={height} role="img">
          <defs>
            <linearGradient id="hxCovGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.5} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          {yTicks.map((v) => (
            <g key={v}>
              <line className="hx-grid" x1={m.left} x2={width - m.right} y1={y(v)} y2={y(v)} />
              <text className="hx-tick" x={m.left - 5} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {v}
              </text>
            </g>
          ))}
          <path d={area} fill="url(#hxCovGrad)" />
          <path d={line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (
            <g key={d.label}>
              <circle cx={x(i)} cy={y(d.value)} r={3} fill={ACCENT} />
              {/* Oversized transparent hit area so the native tooltip is easy to reach. */}
              <circle cx={x(i)} cy={y(d.value)} r={9} fill="transparent">
                <title>{`${d.label} — ${name}: ${d.value}`}</title>
              </circle>
              <text className="hx-tick" x={x(i)} y={height - 3} textAnchor="middle">
                {d.label}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
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
          label: String(i + 1),
          value: r.sites.filter((s) => !s.error && s.summary).length,
        })),
    [reports],
  );

  if (trend.length < 2) return null;

  return (
    <div className="charts">
      <ChartCard
        title={t(lang, "chart.trend")}
        hint={`${trend.length} · ${t(lang, "chart.sites")}`}
        lang={lang}
        render={(z) => <AreaTrend data={trend} height={Math.round(120 * z)} name={t(lang, "chart.covered")} />}
      />
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
        color: ACCENT,
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
