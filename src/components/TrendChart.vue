<script setup lang="ts">
/**
 * 通用折线图（SVG，无第三方依赖）。
 *
 * 用途：历次考试趋势对比。支持多条线（各科 / 总分），每个数据点可独立缺省（缺考或该场没考该科）。
 * 设计取舍：
 *  - 归一化按「得分率」画（value / full），因为各科满分可能不同（语文150、物理100），
 *    直接画绝对分会让满分低的科目永远在底部。y 轴标签仍显示得分率百分比。
 *  - 单点也能画（只有一个圆点 + 提示「暂无对比数据」由调用方决定是否显示）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface TrendSeries {
  /** 线名（科目名 或「总分」） */
  name: string
  /** 颜色（CSS 变量或 hex） */
  color: string
  /** 与 labels 等长的数值数组；null = 该场无此科数据 */
  values: Array<number | null>
  /** 各点满分（用于归一化）；缺省按 100 */
  fulls?: Array<number>
  /** 是否虚线（总分线用实线加粗，科目线用细线） */
  dashed?: boolean
  /** 线宽 */
  width?: number
}

const props = withDefaults(
  defineProps<{
    /** x 轴标签（考试名或日期） */
    labels: string[]
    series: TrendSeries[]
    /** 图高 */
    height?: number
    /** 显示数值标签（点较多时关闭避免拥挤） */
    showValues?: boolean
    /**
     * y 轴口径：
     *  - 'rate'（默认）：按得分率归一化，适合不同满分的科目同图对比
     *  - 'score'：用原始分数，适合同一科目/同一量纲（如总分）
     */
    mode?: 'rate' | 'score'
  }>(),
  { height: 190, showValues: false, mode: 'rate' },
)

/**
 * 绘图宽度 = 容器实际像素宽。
 *
 * 不能固定 640 再用 CSS 缩放到 100%：手机上容器只有 350 左右，SVG 整体缩到 0.55 倍，
 * 9.5px 的轴标签会变成 5px，图挤成一团看不清。让 viewBox 宽度跟着容器走，
 * 1 个 SVG 单位就等于 1 个真实像素，字号和线宽才不会被压扁。
 */
const wrapEl = ref<HTMLElement | null>(null)
const vbW = ref(640)
let ro: ResizeObserver | null = null

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? 0
    if (w > 0) vbW.value = Math.max(260, Math.round(w))
  })
  if (wrapEl.value) ro.observe(wrapEl.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
})

const W = computed(() => vbW.value)
/** 窄屏收窄左侧留白（y 轴百分比标签本来就短） */
const isNarrow = computed(() => W.value < 420)
const PAD = computed(() => ({
  top: 14,
  right: 10,
  bottom: 28,
  left: isNarrow.value ? 30 : 34,
}))

const H = computed(() => props.height)
const plotW = computed(() => W.value - PAD.value.left - PAD.value.right)
const plotH = computed(() => H.value - PAD.value.top - PAD.value.bottom)

/**
 * 数值范围：
 *  - rate 模式：得分率（0~1）
 *  - score 模式：原始分数
 * 统一成「归一值」再画，避免两套坐标逻辑。
 */
const valueRange = computed(() => {
  const vals: number[] = []
  for (const s of props.series) {
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) return
      if (props.mode === 'score') {
        vals.push(v)
      } else {
        const full = s.fulls?.[i] ?? 100
        if (full > 0) vals.push(v / full)
      }
    })
  }
  if (!vals.length) return { min: 0, max: props.mode === 'score' ? 100 : 1 }
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const pad = Math.max(props.mode === 'score' ? 5 : 0.05, (hi - lo) * 0.25)
  return {
    min: Math.max(0, lo - pad),
    max: props.mode === 'score' ? hi + pad : Math.min(1.05, hi + pad),
  }
})

function xAt(i: number): number {
  const n = props.labels.length
  if (n <= 1) return PAD.value.left + plotW.value / 2
  return PAD.value.left + (i * plotW.value) / (n - 1)
}

/** 把原始分转成绘图用的归一值（rate 模式除以满分；score 模式原样） */
function normAt(v: number, full: number): number {
  if (props.mode === 'score') return v
  return full > 0 ? v / full : 0
}

function yAt(norm: number): number {
  const { min, max } = valueRange.value
  const span = max - min || 1
  return PAD.value.top + plotH.value - ((norm - min) / span) * plotH.value
}

/** 每条线的 polyline points 与可见点 */
const lines = computed(() =>
  props.series.map((s) => {
    const pts: Array<{ x: number; y: number; v: number; full: number; label: string }> = []
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) return
      const full = s.fulls?.[i] ?? 100
      if (full <= 0) return
      pts.push({ x: xAt(i), y: yAt(normAt(v, full)), v, full, label: props.labels[i] ?? '' })
    })
    return {
      name: s.name,
      color: s.color,
      dashed: !!s.dashed,
      width: s.width ?? 2,
      points: pts.map((p) => `${p.x},${p.y}`).join(' '),
      dots: pts,
    }
  }),
)

/**
 * 数值标签的避让：同一条 x 上多个科目的点若纵向距离太近，标签会互相压叠。
 * 按 x 分组，组内按 y 排序后交替上下放置（上一个在上，下一个在下），并把间距不足的推开。
 */
const valueLabels = computed(() => {
  if (!props.showValues) return []
  type Lbl = { x: number; y: number; text: string; color: string; anchor: 'above' | 'below' }
  const all: Lbl[] = []
  for (const l of lines.value) {
    for (const d of l.dots) {
      all.push({ x: d.x, y: d.y, text: String(d.v), color: l.color, anchor: 'above' })
    }
  }
  // 按 x 聚类（同一场考试的点 x 相同）
  const byX = new Map<number, Lbl[]>()
  for (const lb of all) {
    const key = Math.round(lb.x)
    const arr = byX.get(key) ?? []
    arr.push(lb)
    byX.set(key, arr)
  }
  const out: Lbl[] = []
  const MIN_GAP = 11 // 标签最小纵向间距（px）
  for (const arr of byX.values()) {
    arr.sort((a, b) => a.y - b.y)
    arr.forEach((lb, i) => {
      // 交替上下，避免同侧堆叠
      lb.anchor = i % 2 === 0 ? 'above' : 'below'
      // 与已放置标签保持间距：同侧才需要推开
      let ty = lb.y + (lb.anchor === 'above' ? -7 : 12)
      for (let guard = 0; guard < 12; guard++) {
        const clash = out.some((o) => Math.abs(o.x - lb.x) < 22 && Math.abs(o.y - ty) < MIN_GAP)
        if (!clash) break
        ty += lb.anchor === 'above' ? -MIN_GAP : MIN_GAP
      }
      out.push({ ...lb, y: ty })
    })
  }
  return out
})

/** y 轴刻度（4 条水平线） */
const yTicks = computed(() => {
  const { min, max } = valueRange.value
  const out: Array<{ y: number; text: string }> = []
  for (let i = 0; i <= 4; i++) {
    const norm = min + ((max - min) * i) / 4
    out.push({
      y: yAt(norm),
      text: props.mode === 'score' ? String(Math.round(norm)) : `${Math.round(norm * 100)}%`,
    })
  }
  return out
})

/**
 * x 轴标签：按实际文字宽度决定显示几个。
 * 之前用固定「每 62px 一个」，中文考试名（如「MobTrend-1」）实际要 70+px，
 * 窄屏上标签首尾相接糊成一片。现在按字号粗估宽度，选能让相邻标签不碰的最小步长。
 */
function estTextW(text: string, fontPx: number): number {
  let w = 0
  for (const ch of text) {
    // CJK/全角按 1 个字号，其余按 0.6 个字号（实测拉丁字符约 0.56，取 0.6 留余量）
    w += /[\u3000-\u9fff\uff00-\uffef\u2026]/.test(ch) ? fontPx : fontPx * 0.6
  }
  return w
}

/** 轴标签字号（与 CSS 保持一致，用于估宽） */
const axisFont = computed(() => (isNarrow.value ? 10.5 : 9.5))

/** 标签截断长度：窄屏更短，避免一屏只有一两个点 */
const xLabelText = (label: string): string => {
  const s = String(label ?? '')
  const max = isNarrow.value ? 7 : 12
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

const xTicks = computed(() => {
  const n = props.labels.length
  if (!n) return []

  type Tick = { i: number; label: string; x: number; anchor: 'start' | 'end' | 'middle' }

  /** 按给定步长取点，并决定首尾是否改成贴边对齐 */
  const shown = (step: number): Tick[] => {
    const list: Tick[] = props.labels
      .map((label, i) => ({ i, label, x: xAt(i), anchor: 'middle' as const }))
      .filter((t) => t.i % step === 0 || t.i === n - 1)
    if (!list.length) return list
    const fw = estTextW(xLabelText(list[0].label), axisFont.value)
    const lw = estTextW(xLabelText(list[list.length - 1].label), axisFont.value)
    // 居中放不下就贴边，避免文字被裁
    if (list[0].x - fw / 2 < PAD.value.left - 4) list[0].anchor = 'start'
    const last = list[list.length - 1]
    if (last.x + lw / 2 > W.value - PAD.value.right + 4) last.anchor = 'end'
    return list
  }

  /** 一个刻度的实际横向占位（按 anchor 换算成左右边界） */
  const span = (t: Tick) => {
    const w = estTextW(xLabelText(t.label), axisFont.value)
    const left = t.anchor === 'start' ? t.x : t.anchor === 'end' ? t.x - w : t.x - w / 2
    return { left, right: left + w }
  }

  // 从 1 开始试步长，直到相邻标签互不重叠且留 6px 空隙
  let step = 1
  for (; step <= n; step++) {
    const list = shown(step)
    let ok = true
    for (let k = 1; k < list.length; k++) {
      const a = span(list[k - 1])
      const b = span(list[k])
      if (b.left - a.right < 6) {
        ok = false
        break
      }
    }
    if (ok) break
  }

  return shown(Math.min(step, n))
})

const hasData = computed(() => lines.value.some((l) => l.dots.length > 0))
</script>

<template>
  <div ref="wrapEl" class="trend-wrap">
    <svg :viewBox="`0 0 ${W} ${H}`" class="trend-svg" preserveAspectRatio="xMidYMid meet">
      <!-- y 轴网格 + 刻度 -->
      <g class="grid">
        <line
          v-for="(t, i) in yTicks"
          :key="'g' + i"
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="t.y"
          :y2="t.y"
          stroke="var(--line-soft)"
          stroke-width="1"
        />
        <text v-for="(t, i) in yTicks" :key="'t' + i" :x="PAD.left - 5" :y="t.y + 3" text-anchor="end" class="axis-text">
          {{ t.text }}
        </text>
      </g>

      <!-- 折线 -->
      <g v-for="(l, li) in lines" :key="'l' + li">
        <polyline
          v-if="l.dots.length > 1"
          :points="l.points"
          fill="none"
          :stroke="l.color"
          :stroke-width="l.width"
          :stroke-dasharray="l.dashed ? '5 4' : undefined"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        <g v-for="(d, di) in l.dots" :key="'d' + li + di">
          <circle :cx="d.x" :cy="d.y" r="3.2" :fill="l.color" />
          <title>{{ l.name }} · {{ d.label }}：{{ d.v }} / {{ d.full }}</title>
        </g>
      </g>

      <!-- 数值标签（统一层渲染，做过避让） -->
      <text
        v-for="(lb, i) in valueLabels"
        :key="'v' + i"
        :x="lb.x"
        :y="lb.y"
        text-anchor="middle"
        class="val-text"
        :fill="lb.color"
      >{{ lb.text }}</text>

      <!-- x 轴标签 -->
      <text
        v-for="t in xTicks"
        :key="'x' + t.i"
        :x="t.x"
        :y="H - 10"
        :text-anchor="t.anchor"
        class="axis-text"
      >{{ xLabelText(t.label) }}</text>

      <!-- 无数据提示 -->
      <text v-if="!hasData" :x="W / 2" :y="H / 2" text-anchor="middle" class="empty-text">
        暂无对比数据
      </text>
    </svg>

    <!-- 图例 -->
    <div v-if="hasData" class="legend">
      <span v-for="(l, i) in lines" :key="'lg' + i" class="legend-item">
        <i class="legend-dot" :style="{ background: l.color }"></i>{{ l.name }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.trend-wrap {
  width: 100%;
}
.trend-svg {
  width: 100%;
  height: auto;
  display: block;
  overflow: visible;
}
.axis-text {
  font-size: 9.5px;
  fill: var(--faint);
}
/* 手机端字号略放大：viewBox 已按容器宽度铺满，不再整体缩放压字 */
@media (max-width: 700px) {
  .axis-text {
    font-size: 10.5px;
  }
  .val-text {
    font-size: 9.5px;
  }
}
.val-text {
  font-size: 9px;
  font-weight: 600;
}
.empty-text {
  font-size: 12px;
  fill: var(--faint);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 8px;
  padding: 0 4px;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--muted);
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}
</style>