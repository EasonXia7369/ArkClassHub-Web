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
import { computed } from 'vue'

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

const PAD = { top: 14, right: 12, bottom: 30, left: 34 }
const W = 640

const H = computed(() => props.height)
const plotW = computed(() => W - PAD.left - PAD.right)
const plotH = computed(() => H.value - PAD.top - PAD.bottom)

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
  if (n <= 1) return PAD.left + plotW.value / 2
  return PAD.left + (i * plotW.value) / (n - 1)
}

/** 把原始分转成绘图用的归一值（rate 模式除以满分；score 模式原样） */
function normAt(v: number, full: number): number {
  if (props.mode === 'score') return v
  return full > 0 ? v / full : 0
}

function yAt(norm: number): number {
  const { min, max } = valueRange.value
  const span = max - min || 1
  return PAD.top + plotH.value - ((norm - min) / span) * plotH.value
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

/** x 轴标签：点太多时隔几个显示 */
const xTicks = computed(() => {
  const n = props.labels.length
  const step = n <= 6 ? 1 : Math.ceil(n / 6)
  return props.labels
    .map((label, i) => ({ i, label, x: xAt(i) }))
    .filter((t) => t.i % step === 0 || t.i === n - 1)
})

const hasData = computed(() => lines.value.some((l) => l.dots.length > 0))
</script>

<template>
  <div class="trend-wrap">
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
        <text v-for="(t, i) in yTicks" :key="'t' + i" :x="PAD.left - 6" :y="t.y + 3" text-anchor="end" class="axis-text">
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
        text-anchor="middle"
        class="axis-text"
      >{{ t.label }}</text>

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