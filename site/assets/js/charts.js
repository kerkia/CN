// ECharts wrappers applying the dataviz mark specs: 2px lines, >=8px markers
// with a 2px surface ring, 10% area wash, hairline solid gridlines, crosshair
// tooltip with the value leading, one y-axis only.

import { esc, fmt, fmtDate } from "./util.js";

const registry = new Set();

export const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const METHOD_SLOT = { official: 1, v2026: 2, top6w: 3 };
export const methodColor = (m) => css(`--s${METHOD_SLOT[m]}`);
export const slotColor = (i) => css(`--s${(i % 8) + 1}`);
// Secondary encoding for method when colour is spent on runners.
export const METHOD_DASH = { official: "solid", v2026: [8, 5], top6w: [2, 4] };

function theme() {
  return {
    surface: css("--surface"), ink: css("--ink"), ink2: css("--ink-2"), ink3: css("--ink-3"),
    grid: css("--grid"), axis: css("--axis"), border: css("--border-strong"),
  };
}

export function disposeAll() {
  for (const c of registry) { try { c.dispose(); } catch (e) {} }
  registry.clear();
}

function init(el) {
  const existing = window.echarts.getInstanceByDom(el);
  if (existing) existing.dispose();
  const c = window.echarts.init(el, null, { renderer: "canvas" });
  registry.add(c);
  const ro = new ResizeObserver(() => c.resize());
  ro.observe(el);
  c.on("finished", () => {});
  return c;
}

function baseTooltip(th, extra = {}) {
  return {
    backgroundColor: th.surface,
    borderColor: th.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: th.ink, fontSize: 13 },
    extraCssText: "box-shadow: 0 8px 24px rgba(0,0,0,.14); border-radius: 10px;",
    ...extra,
  };
}
function axisCommon(th) {
  return {
    axisLine: { lineStyle: { color: th.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: th.ink3, fontSize: 12 },
    splitLine: { lineStyle: { color: th.grid, width: 1, type: "solid" } },
  };
}
const keyLine = (color, dash) =>
  `<span style="display:inline-block;width:14px;height:0;border-top:2px ${
    dash && dash !== "solid" ? "dashed" : "solid"} ${color};margin-right:6px;vertical-align:middle"></span>`;

/**
 * Time series. series: [{ name, color, dash, data: [[iso, value, extra?]],
 *   kind: "line" | "dots", step, area, endLabel }]
 */
export function timeChart(el, { series, yName = "CN", onClick, zoom, tooltipExtra, yMin, yMax, digits = 0 } = {}) {
  const th = theme();
  const c = init(el);
  // phones: no room for end labels, the legend already names every series
  const narrow = el.clientWidth < 520;
  const opt = {
    animationDuration: 300,
    textStyle: { fontFamily: css("--font") || "system-ui" },
    grid: { left: narrow ? 44 : 52, right: narrow || !series.some((s) => s.endLabel) ? 16 : 110, top: 18, bottom: zoom === false ? 32 : 70 },
    tooltip: baseTooltip(th, {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: th.axis, width: 1 } },
      formatter(params) {
        if (!params.length) return "";
        const d = params[0].axisValue;
        const rows = params
          .filter((p) => p.value && p.value[1] != null)
          .map((p) => {
            const s = series[p.seriesIndex];
            const extra = tooltipExtra ? tooltipExtra(s, p.value) : "";
            return `<div style="display:flex;align-items:center;gap:8px;margin-top:3px">${
              keyLine(s.color, s.dash)}<b style="font-size:14px">${fmt(p.value[1], digits)}</b>
              <span style="color:${th.ink2}">${esc(s.name)}</span>${extra}</div>`;
          });
        return `<div style="color:${th.ink3};font-size:12px">${esc(fmtDate(
          typeof d === "number" ? new Date(d).toISOString().slice(0, 10) : d))}</div>${rows.join("")}`;
      },
    }),
    xAxis: { type: "time", ...axisCommon(th), splitLine: { show: false } },
    yAxis: {
      type: "value", name: yName, nameTextStyle: { color: th.ink3, fontSize: 12, padding: [0, 0, 0, -30] },
      scale: true, min: yMin, max: yMax, ...axisCommon(th),
      axisLabel: { color: th.ink3, fontSize: 12, formatter: (v) => fmt(v, digits) },
    },
    dataZoom: zoom === false ? [] : [
      // weakFilter: points outside the window leave the y extent, so the scale follows the zoom
      { type: "inside", xAxisIndex: 0, filterMode: "weakFilter", start: zoom?.start ?? 0, end: zoom?.end ?? 100 },
      {
        type: "slider", xAxisIndex: 0, filterMode: "weakFilter", height: 22, bottom: 12,
        start: zoom?.start ?? 0, end: zoom?.end ?? 100,
        borderColor: th.grid, backgroundColor: "transparent", fillerColor: "rgba(42,120,214,0.10)",
        dataBackground: { lineStyle: { color: th.axis }, areaStyle: { color: th.grid } },
        handleStyle: { color: th.surface, borderColor: th.axis },
        textStyle: { color: th.ink3, fontSize: 11 },
        labelFormatter: (v) => fmtDate(new Date(v).toISOString().slice(0, 10), "short"),
      },
    ],
    series: series.map((s) => (s.kind === "dots" ? {
      name: s.name, type: "scatter", data: s.data, symbolSize: 8, z: 3,
      itemStyle: { color: s.color, borderColor: th.surface, borderWidth: 2, opacity: 0.85 },
      emphasis: { scale: 1.4 },
    } : {
      name: s.name, type: "line", data: s.data, step: s.step ? "end" : false,
      showSymbol: !!s.markers, symbol: "circle", symbolSize: 8, connectNulls: false,
      lineStyle: { width: 2, color: s.color, type: s.dash || "solid", cap: "round", join: "round" },
      itemStyle: { color: s.color, borderColor: th.surface, borderWidth: 2 },
      areaStyle: s.area ? { color: s.color, opacity: 0.10 } : undefined,
      emphasis: { focus: "series", lineStyle: { width: 2.5 } },
      endLabel: s.endLabel && !narrow ? {
        show: true, color: th.ink2, fontSize: 12, distance: 8,
        formatter: (p) => `${s.endLabel}  ${fmt(p.value[1])}`,
      } : undefined,
      labelLayout: { moveOverlap: "shiftY" },
      z: 2,
    })),
  };
  c.setOption(opt);
  if (onClick) {
    c.getZr().on("click", (ev) => {
      const pt = [ev.offsetX, ev.offsetY];
      if (!c.containPixel("grid", pt)) return;
      const [x] = c.convertFromPixel({ gridIndex: 0 }, pt);
      onClick(new Date(x).toISOString().slice(0, 10));
    });
  }
  return c;
}

/** Wheel/pinch zoom plus a box-zoom and a reset button, for value-axis charts. */
function zoomable(th, { y = false } = {}) {
  return {
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none" },
      ...(y ? [{ type: "inside", yAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: "shift" }] : []),
    ],
    toolbox: {
      right: 6, top: 0, itemSize: 14,
      iconStyle: { borderColor: th.ink3 }, emphasis: { iconStyle: { borderColor: th.ink } },
      feature: {
        dataZoom: { yAxisIndex: y ? 0 : "none", title: { zoom: "Zoomer sur une zone", back: "Zoom précédent" } },
        restore: { title: "Réinitialiser" },
      },
    },
  };
}

/** Frequency polygons (one per method) — overlapping bars would hide each other. */
export function distributionChart(el, { series, binSize = 250 }) {
  const th = theme();
  const c = init(el);
  c.setOption({
    animationDuration: 300,
    grid: { left: 52, right: 24, top: 28, bottom: 40 },
    ...zoomable(th),
    tooltip: baseTooltip(th, {
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: th.axis } },
      formatter(params) {
        if (!params.length) return "";
        const x = params[0].value[0];
        const head = `<div style="color:${th.ink3};font-size:12px">CN ${fmt(x - binSize / 2)} – ${fmt(x + binSize / 2)}</div>`;
        return head + params.map((p) => {
          const s = series[p.seriesIndex];
          return `<div style="display:flex;align-items:center;gap:8px;margin-top:3px">${keyLine(s.color)}<b>${
            fmt(p.value[1])}</b><span style="color:${th.ink2}">${esc(s.name)}</span></div>`;
        }).join("");
      },
    }),
    xAxis: {
      type: "value", name: "CN", nameLocation: "end", nameTextStyle: { color: th.ink3 },
      ...axisCommon(th), splitLine: { show: false },
      axisLabel: { color: th.ink3, formatter: (v) => fmt(v) },
    },
    yAxis: { type: "value", ...axisCommon(th), axisLabel: { color: th.ink3, formatter: (v) => fmt(v) } },
    series: series.map((s) => ({
      name: s.name, type: "line", data: s.bins, smooth: 0.25, showSymbol: false, symbolSize: 8,
      lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color, borderColor: th.surface, borderWidth: 2 },
      areaStyle: { color: s.color, opacity: 0.10 },
    })),
  });
  return c;
}

/** Grouped columns (<=24px, rounded data end) for counts per category. */
export function columnChart(el, { categories, series, yName, digits = 0 }) {
  const th = theme();
  const c = init(el);
  c.setOption({
    animationDuration: 300,
    grid: { left: 56, right: 16, top: 26, bottom: 36 },
    tooltip: baseTooltip(th, {
      trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(127,127,127,.08)" } },
      formatter(params) {
        return `<div style="color:${th.ink3};font-size:12px">${esc(params[0].axisValue)}</div>` +
          params.map((p) => `<div style="display:flex;gap:8px;align-items:center;margin-top:3px">${
            keyLine(series[p.seriesIndex].color)}<b>${fmt(p.value, digits)}</b><span style="color:${th.ink2}">${
            esc(series[p.seriesIndex].name)}</span></div>`).join("");
      },
    }),
    xAxis: { type: "category", data: categories, ...axisCommon(th), splitLine: { show: false } },
    yAxis: { type: "value", name: yName, nameTextStyle: { color: th.ink3 }, ...axisCommon(th),
      axisLabel: { color: th.ink3, formatter: (v) => fmt(v, Number.isInteger(v) ? 0 : 1) } },
    series: series.map((s) => ({
      name: s.name, type: "bar", data: s.data, barMaxWidth: 24, barGap: "12%",
      itemStyle: { color: s.color, borderRadius: [4, 4, 0, 0] },
    })),
  });
  return c;
}

/**
 * Choropleth on a registered map (see geo.js). values: Map(feature code -> number);
 * features without a value stay neutral. Sequential ramp --q1…--q5, light to dark.
 * tip(code) returns the tooltip HTML of a feature.
 */
export function mapChart(el, { map, values, tip, onClick, name = "", digits = 0, traffic = false }) {
  const th = theme();
  const c = init(el);
  // traffic light: red at the smallest value, yellow halfway, green at the largest, linear in between
  const vals = [...values.values()];
  const lo = traffic && vals.length ? Math.min(...vals) : 0;
  const max = traffic ? Math.max(lo + (digits ? 0.1 : 1), ...vals) : Math.max(digits ? 0.1 : 1, ...vals);
  c.setOption({
    animationDuration: 300,
    tooltip: baseTooltip(th, { trigger: "item", triggerOn: "mousemove|click", confine: true, formatter: (p) => tip(p.name) }),
    visualMap: {
      type: "continuous", min: lo, max, calculable: false, orient: "horizontal", left: "center", bottom: 4,
      itemWidth: 10, itemHeight: 160, text: [fmt(max, digits), fmt(lo, digits)], textStyle: { color: th.ink3, fontSize: 12 },
      inRange: { color: traffic ? ["#d64545", "#f0c43c", "#2f9e57"] : [1, 2, 3, 4, 5].map((i) => css(`--q${i}`)) },
    },
    series: [{
      type: "map", map, name, nameProperty: "code", roam: false, selectedMode: false,
      layoutCenter: ["50%", "46%"], layoutSize: "92%",
      itemStyle: { areaColor: css("--surface-2"), borderColor: th.surface, borderWidth: 1 },
      emphasis: { label: { show: false }, itemStyle: { areaColor: css("--s4"), borderColor: th.ink, borderWidth: 1.5 } },
      data: [...values.entries()].map(([code, value]) => ({ name: code, value })),
    }],
  });
  if (onClick) c.on("click", (p) => onClick(p.name));
  return c;
}

/**
 * Empirical CDF, one point per runner. series: [{ name, color, data: [[cn, pct, lic, label]],
 * highlight }] — a highlight series is drawn on top with larger ringed markers.
 */
export function cdfChart(el, { series, onClick }) {
  const th = theme();
  const c = init(el);
  c.setOption({
    animationDuration: 300,
    grid: { left: 52, right: 20, top: 28, bottom: 44 },
    ...zoomable(th, { y: true }),
    tooltip: baseTooltip(th, {
      trigger: "item",
      formatter(p) {
        const [cn, pct, , label] = p.value;
        const s = series[p.seriesIndex];
        return `<b style="font-size:14px">${fmt(cn)}</b> <span style="color:${th.ink2}">${esc(label || "")}</span><br>` +
          `<span style="color:${th.ink3}">${esc(s.name)} · ${fmt(pct, 1)} % des classés à ce CN ou moins</span>`;
      },
    }),
    xAxis: { type: "value", name: "CN", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: th.ink3 },
      scale: true, splitNumber: el.clientWidth < 360 ? 2 : el.clientWidth < 520 ? 3 : 5, ...axisCommon(th), splitLine: { show: false },
      axisLabel: { color: th.ink3, formatter: (v) => fmt(v), hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: 100, name: "%", nameTextStyle: { color: th.ink3 }, ...axisCommon(th),
      axisLabel: { color: th.ink3, formatter: (v) => `${fmt(v)} %` } },
    series: series.map((s) => ({
      // drawn in one pass: progressive chunks leave a half-drawn curve in a background tab
      name: s.name, type: "scatter", data: s.data, z: s.highlight ? 4 : 2, progressive: 0,
      symbolSize: s.highlight ? 8 : 4,
      itemStyle: s.highlight
        ? { color: s.color, borderColor: th.surface, borderWidth: 2 }
        : { color: s.color, opacity: 0.7 },
      emphasis: { scale: 2 },
    })),
  });
  if (onClick) c.on("click", (p) => p.value?.[2] && onClick(p.value[2]));
  return c;
}

/**
 * Reference bands on a category axis, with lines over them.
 * bands: [{ name, color, opacity, lo: [], hi: [] }] aligned to categories;
 * lines: [{ name, color, data, dash, width, markers }] where data is either
 * aligned to categories or a list of [category, value] pairs.
 * tip(axisValue) returns the tooltip HTML for one category.
 */
export function bandChart(el, { categories, bands = [], lines = [], yName = "CN", yMin, yMax, tip, yFormat = (v) => fmt(v), time = false }) {
  const th = theme();
  const c = init(el);
  const series = [];
  // on a time axis, values aligned to `categories` become [date, value] pairs
  const xy = (arr) => (time ? arr.map((v, k) => (Array.isArray(v) ? v : [categories[k], v])) : arr);
  bands.forEach((b, i) => {
    const lo = b.lo.map((v, k) => (v == null || b.hi[k] == null ? null : v));
    series.push({ type: "line", stack: `band${i}`, data: xy(lo), symbol: "none", silent: true, step: b.step,
      lineStyle: { opacity: 0 }, tooltip: { show: false }, z: 1 });
    series.push({ name: b.name, type: "line", stack: `band${i}`, symbol: "none", silent: true, step: b.step,
      data: xy(b.hi.map((v, k) => (v == null || lo[k] == null ? null : v - lo[k]))),
      lineStyle: { opacity: 0 }, areaStyle: { color: b.color, opacity: b.opacity ?? 0.15 }, z: 1 });
  });
  for (const l of lines) {
    series.push({
      name: l.name, type: "line", data: xy(l.data), connectNulls: !time, z: 3, step: l.step,
      symbol: "circle", symbolSize: l.markers === false ? 0 : 8, showSymbol: l.markers !== false,
      lineStyle: { width: l.width || 2, color: l.color, type: l.dash || "solid" },
      itemStyle: { color: l.color, borderColor: th.surface, borderWidth: 2 },
    });
  }
  c.setOption({
    animationDuration: 300,
    grid: { left: 52, right: 20, top: 18, bottom: time ? 60 : 40 },
    tooltip: baseTooltip(th, {
      trigger: "axis", axisPointer: { type: "line", lineStyle: { color: th.axis } },
      formatter: (params) => (params.length && tip ? tip(params[0].axisValue, params) : ""),
    }),
    xAxis: time
      ? { type: "time", ...axisCommon(th), splitLine: { show: false } }
      : { type: "category", data: categories, boundaryGap: false, ...axisCommon(th), splitLine: { show: false },
          axisLabel: { color: th.ink3, fontSize: 12, interval: 0, hideOverlap: true } },
    ...(time ? { dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "weakFilter" },
      { type: "slider", xAxisIndex: 0, filterMode: "weakFilter", height: 20, bottom: 8, borderColor: th.grid,
        backgroundColor: "transparent", fillerColor: "rgba(42,120,214,0.10)", textStyle: { color: th.ink3, fontSize: 11 },
        labelFormatter: (v) => fmtDate(new Date(v).toISOString().slice(0, 10), "short") }] } : {}),
    yAxis: { type: "value", name: yName, nameTextStyle: { color: th.ink3 }, min: yMin, max: yMax, scale: yMin == null,
      ...axisCommon(th), axisLabel: { color: th.ink3, formatter: yFormat } },
    series,
  });
  return c;
}

/**
 * Force-directed network. nodes: [{ id, name, value, size, color, fixed }],
 * links: [{ source, target, value, width }]. onClick(id) on a node.
 */
export function networkChart(el, { nodes, links, onClick, tip, edgeTip }) {
  const th = theme();
  const c = init(el);
  c.setOption({
    animationDuration: 400,
    tooltip: baseTooltip(th, {
      trigger: "item",
      formatter: (p) => (p.dataType === "edge" ? (edgeTip ? edgeTip(p.data) : "") : (tip ? tip(p.data) : esc(p.name))),
    }),
    series: [{
      type: "graph", layout: "force", roam: true, draggable: true, zoom: 0.9,
      force: { repulsion: 260, edgeLength: [50, 150], gravity: 0.12, friction: 0.25 },
      label: { show: true, position: "right", color: th.ink2, fontSize: 11,
        formatter: (p) => (p.data.label === false ? "" : p.data.short || p.name) },
      labelLayout: { hideOverlap: true },
      emphasis: { focus: "adjacency", lineStyle: { opacity: 0.9 } },
      // a pinned node (the runner at the centre of an ego view) sits in the middle
      data: nodes.map((n) => ({
        ...n, symbolSize: n.size,
        ...(n.pin ? { fixed: true, x: el.clientWidth / 2, y: el.clientHeight / 2 } : {}),
        itemStyle: { color: n.color, borderColor: th.surface, borderWidth: 2 },
      })),
      links: links.map((l) => ({
        ...l, lineStyle: { width: l.width || 1, color: th.axis, opacity: l.opacity ?? 0.45, curveness: 0.08 },
      })),
    }],
  });
  if (onClick) c.on("click", (p) => { if (p.dataType === "node") onClick(p.data.id); });
  return c;
}

/** Numeric x/y lines with markers (e.g. score by finishing place). */
export function xyChart(el, { series, xName, yName, xMin = null }) {
  const th = theme();
  const c = init(el);
  c.setOption({
    animationDuration: 300,
    grid: { left: 56, right: 24, top: 26, bottom: 44 },
    tooltip: baseTooltip(th, {
      trigger: "axis", axisPointer: { type: "line", lineStyle: { color: th.axis } },
      formatter(params) {
        if (!params.length) return "";
        return `<div style="color:${th.ink3};font-size:12px">${esc(xName)} ${fmt(params[0].value[0])}</div>` +
          params.filter((p) => p.value[1] != null).map((p) => {
            const s = series[p.seriesIndex];
            return `<div style="display:flex;align-items:center;gap:8px;margin-top:3px">${keyLine(s.color)}<b>${
              fmt(p.value[1])}</b><span style="color:${th.ink2}">${esc(s.name)}</span></div>`;
          }).join("");
      },
    }),
    xAxis: { type: "value", name: xName, nameLocation: "middle", nameGap: 28, nameTextStyle: { color: th.ink3 },
      min: xMin, minInterval: 1, ...axisCommon(th), splitLine: { show: false },
      axisLabel: { color: th.ink3, formatter: (v) => fmt(v) } },
    yAxis: { type: "value", name: yName, nameTextStyle: { color: th.ink3 }, scale: true, ...axisCommon(th),
      axisLabel: { color: th.ink3, formatter: (v) => fmt(v) } },
    series: series.map((s) => ({
      name: s.name, type: "line", data: s.data, symbol: "circle", symbolSize: 8,
      showSymbol: s.data.length <= 60,
      lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color, borderColor: th.surface, borderWidth: 2 },
    })),
  });
  return c;
}

/** Ordinary least squares on [[x, y]]: { a, b, r2, n } for y = a + b·x, or null if undefined. */
export function linreg(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  if (!sxx || !syy) return null;
  const b = sxy / sxx;
  return { a: my - b * mx, b, r2: (sxy * sxy) / (sxx * syy), n };
}

/**
 * Scatter with one least-squares line per series. series: [{ name, color,
 * data: [[x, y, lic, label]] }]; the fit is drawn from the series' own x range.
 */
export function regressionChart(el, { series, xName, yName }) {
  const th = theme();
  const c = init(el);
  const fits = series.map((s) => linreg(s.data));
  const lines = series.map((s, i) => {
    const f = fits[i];
    if (!f) return null;
    const xs = s.data.map((p) => p[0]);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    return [[lo, f.a + f.b * lo], [hi, f.a + f.b * hi]];
  });
  c.setOption({
    animationDuration: 300,
    grid: { left: 56, right: 24, top: 26, bottom: 44 },
    ...zoomable(th, { y: true }),
    tooltip: baseTooltip(th, {
      trigger: "item",
      formatter(p) {
        if (p.seriesType !== "scatter") return "";
        const [x, y, , label] = p.value;
        return `<b style="font-size:14px">${fmt(y)}</b> <span style="color:${th.ink2}">${esc(yName)} · ${esc(p.seriesName)}</span><br>` +
          `<span style="color:${th.ink3}">${esc(xName)} ${fmt(x)}${label ? " · " + esc(label) : ""}</span>`;
      },
    }),
    xAxis: { type: "value", name: xName, nameLocation: "middle", nameGap: 28, nameTextStyle: { color: th.ink3 },
      scale: true, ...axisCommon(th), splitLine: { show: false }, axisLabel: { color: th.ink3, formatter: (v) => fmt(v) } },
    yAxis: { type: "value", name: yName, nameTextStyle: { color: th.ink3 }, scale: true, ...axisCommon(th),
      axisLabel: { color: th.ink3, formatter: (v) => fmt(v) } },
    series: [
      ...series.map((s) => ({
        name: s.name, type: "scatter", data: s.data, symbolSize: 7, z: 2, progressive: 0,
        itemStyle: { color: s.color, opacity: 0.6 }, emphasis: { scale: 1.6 },
      })),
      ...lines.map((l, i) => (l ? {
        name: `${series[i].name} — régression`, type: "line", data: l, symbol: "none", silent: true, z: 4,
        lineStyle: { width: 2.5, color: series[i].color, type: [8, 5] }, tooltip: { show: false },
      } : null)).filter(Boolean),
    ],
  });
  return c;
}

/** Scatter with a y = x reference, for method-vs-method agreement. */
export function scatterChart(el, { series, xName, yName, max }) {
  const th = theme();
  const c = init(el);
  c.setOption({
    animationDuration: 300,
    grid: { left: 56, right: 24, top: 26, bottom: 44 },
    tooltip: baseTooltip(th, {
      trigger: "item",
      formatter: (p) => `<b>${fmt(p.value[1])}</b> <span style="color:${th.ink2}">${esc(yName)} / ${esc(p.seriesName)}</span><br>` +
        `<span style="color:${th.ink3}">${esc(xName)} ${fmt(p.value[0])}</span>`,
    }),
    xAxis: { type: "value", name: xName, nameLocation: "middle", nameGap: 28, nameTextStyle: { color: th.ink3 },
      min: 0, max, ...axisCommon(th), axisLabel: { color: th.ink3, formatter: (v) => fmt(v) } },
    yAxis: { type: "value", name: yName, nameTextStyle: { color: th.ink3 }, min: 0, max, ...axisCommon(th),
      axisLabel: { color: th.ink3, formatter: (v) => fmt(v) } },
    series: [
      ...series.map((s) => ({
        name: s.name, type: "scatter", data: s.data, symbolSize: 6, large: s.data.length > 2000,
        itemStyle: { color: s.color, opacity: 0.55 },
      })),
      {
        type: "line", data: [[0, 0], [max, max]], silent: true, symbol: "none",
        lineStyle: { color: th.axis, width: 1 }, tooltip: { show: false },
      },
    ],
  });
  return c;
}
