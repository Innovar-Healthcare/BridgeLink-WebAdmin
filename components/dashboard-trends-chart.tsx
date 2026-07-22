"use client";

/**
 * DashboardTrendsChart — extracted Recharts rendering for lazy loading.
 * Recharts (~1.1 MB) is only loaded when the Message Trends tab is active.
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { DotItemDotProps } from "recharts";
import { useTheme } from "@/lib/hooks/use-theme";
import { TREND_COLORS } from "./dashboard-bottom-panel/trend-config";
import type { TrendKey } from "./dashboard-bottom-panel/trend-config";

export interface TrendsChartProps {
  chartType: "line" | "stacked";
  chartData: Array<Record<string, unknown>>;
  activeSeries: Array<{ key: TrendKey; label: string }>;
}

// ─── Per-series marker shapes (mirrors Java's JFreeChart default shape sequence) ─

type MarkerShape = "square" | "circle" | "triangle" | "diamond" | "cross";

const SERIES_SHAPES: Record<TrendKey, MarkerShape> = {
  received: "square",
  sent: "circle",
  filtered: "triangle",
  queued: "diamond",
  error: "cross",
};

function renderMarker(
  shape: MarkerShape,
  cx: number,
  cy: number,
  color: string
): React.ReactElement {
  const s = 4;
  switch (shape) {
    case "square":
      return <rect x={cx - s} y={cy - s} width={s * 2} height={s * 2} fill={color} />;
    case "circle":
      return <circle cx={cx} cy={cy} r={s} fill={color} />;
    case "triangle":
      return (
        <polygon points={`${cx},${cy - s} ${cx + s},${cy + s} ${cx - s},${cy + s}`} fill={color} />
      );
    case "diamond":
      return (
        <polygon
          points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
          fill={color}
        />
      );
    case "cross":
      return (
        <path
          d={`M${cx - s},${cy - s} L${cx + s},${cy + s} M${cx + s},${cy - s} L${cx - s},${cy + s}`}
          stroke={color}
          strokeWidth={2}
          fill="none"
        />
      );
  }
}

function makeDot(shape: MarkerShape, color: string): (props: DotItemDotProps) => React.ReactNode {
  return function Dot({ cx, cy }: DotItemDotProps) {
    if (cx == null || cy == null) return null;
    return renderMarker(shape, cx, cy, color);
  };
}

export default function DashboardTrendsChart({
  chartType,
  chartData,
  activeSeries,
}: TrendsChartProps) {
  const { isDark } = useTheme();

  const gridStroke = isDark ? "#374151" : "#e5e7eb";
  const tickFill = isDark ? "#9ca3af" : "#374151";
  const tooltipBg = isDark ? "#1f2937" : "#ffffff";
  const tooltipBorder = isDark ? "#374151" : "#e5e7eb";

  const tickStyle = { fontSize: 10, fill: tickFill };
  const tooltipStyle = {
    fontSize: 11,
    backgroundColor: tooltipBg,
    border: `1px solid ${tooltipBorder}`,
  };

  const yAxisTickFormatter = (v: number) => v.toLocaleString();

  return (
    <ResponsiveContainer width="100%" height="100%">
      {chartType === "line" ? (
        <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="label" tick={tickStyle} interval="preserveStartEnd" minTickGap={24} />
          <YAxis
            tick={tickStyle}
            width={44}
            allowDecimals={false}
            domain={[0, "auto"]}
            tickFormatter={yAxisTickFormatter}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => [
              typeof value === "number" ? value.toLocaleString() : value,
              name,
            ]}
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          {activeSeries.map(({ key, label }) => (
            <Line
              key={key}
              type="linear"
              dataKey={key}
              name={label}
              stroke={TREND_COLORS[key]}
              dot={makeDot(SERIES_SHAPES[key], TREND_COLORS[key])}
              activeDot={{ r: 5 }}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="label" tick={tickStyle} interval="preserveStartEnd" minTickGap={24} />
          <YAxis
            tick={tickStyle}
            width={44}
            allowDecimals={false}
            domain={[0, "auto"]}
            tickFormatter={yAxisTickFormatter}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value, name) => [
              typeof value === "number" ? value.toLocaleString() : value,
              name,
            ]}
          />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
          {activeSeries.map(({ key, label }) => (
            <Bar
              key={key}
              dataKey={key}
              name={label}
              stackId="a"
              fill={TREND_COLORS[key]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
