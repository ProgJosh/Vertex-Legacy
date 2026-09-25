"use client";

import * as echarts from "echarts";
import { useEffect, useRef } from "react";

export function PortfolioChart({ labels, values }: { labels: string[]; values: string[] }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current || !values.length) return;
    const chart = echarts.init(root.current);
    chart.setOption({
      backgroundColor: "transparent",
      textStyle: { color: "#9fa3a7" },
      tooltip: { trigger: "axis", valueFormatter: (value: unknown) => "₱" + String(value) },
      grid: { left: 52, right: 14, top: 20, bottom: 40 },
      xAxis: { type: "category", data: labels, axisLine: { lineStyle: { color: "#333" } } },
      yAxis: { type: "value", axisLine: { lineStyle: { color: "#333" } }, splitLine: { lineStyle: { color: "#242628" } } },
      series: [{
        type: "bar",
        data: values,
        itemStyle: { color: "#b8924a" },
        barMaxWidth: 44,
      }],
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [labels, values]);
  if (!values.length) return <div className="empty-state">No holdings are available to chart.</div>;
  return <div className="chart" ref={root} role="img" aria-label="Portfolio cost basis by plan" />;
}
