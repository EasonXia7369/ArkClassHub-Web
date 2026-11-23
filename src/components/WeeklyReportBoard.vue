<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import dayjs from 'dayjs'
import QRCode from 'qrcode'
import { snapdom } from '@zumer/snapdom'
import { get, post } from '@/api'
import { useClassStore } from '@/stores/class'
import { exportXlsx } from '@/utils/xlsx'
import { saveFile, saveOrShare } from '@/utils/platform'
import { useAi } from '@/composables/useAi'
import { maskZh } from '@/utils/mask'
import { weekdayCn } from '@/utils/dates'
import { parentLinkOf } from '@/utils/publicOrigin'
import Icon from '@/components/Icon.vue'
import ReportSheet from '@/components/report/ReportSheet.vue'
import type { ReportVM } from '@/components/report/ReportSheet.vue'

const props = defineProps<{ classId: number }>()
const store = useClassStore()
const { aiEnabled, ensureStatus } = useAi()
ensureStatus()

/* ---------- 区间：本周 / 本月 / 自定义 ---------- */
type Mode = 'week' | 'month' | 'custom'
const mode = ref<Mode>('week')
const monday = ref(dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD'))
const monthAnchor = ref(dayjs().format('YYYY-MM'))
const customFrom = ref(dayjs().subtract(6, 'day').format('YYYY-MM-DD'))
const customTo = ref(dayjs().format('YYYY-MM-DD'))

const from = computed(() => {
  if (mode.value === 'week') return monday.value
  if (mode.value === 'month') return monthAnchor.value + '-01'
  return customFrom.value
})
const to = computed(() => {
  if (mode.value === 'week') return dayjs(monday.value).add(6, 'day').format('YYYY-MM-DD')
  if (mode.value === 'month') return dayjs(monthAnchor.value + '-01').endOf('month').format('YYYY-MM-DD')
  return customTo.value
})
const title = computed(() => (mode.value === 'month' ? '月报' : '周报'))
const rangeLabel = computed(() => `${from.value} ~ ${to.value}`)
// 环比区间：紧邻当前区间之前的等长窗口
const prevRange = computed(() => {
  if (mode.value === 'month') {
    const p = dayjs(monthAnchor.value + '-01').subtract(1, 'month')
    return { from: p.format('YYYY-MM-DD'), to: p.endOf('month').format('YYYY-MM-DD') }
  }
  const days = dayjs(to.value).diff(dayjs(from.value), 'day') + 1
  return {
    from: dayjs(from.value).subtract(days, 'day').format('YYYY-MM-DD'),
    to: dayjs(from.value).subtract(1, 'day').format('YYYY-MM-DD'),
  }
})

function shift(n: number) {
  if (mode.value === 'month') monthAnchor.value = dayjs(monthAnchor.value + '-01').add(n, 'month').format('YYYY-MM')
  else monday.value = dayjs(monday.value).add(n * 7, 'day').format('YYYY-MM-DD')
}

/* ---------- 数据加载 ---------- */
const report = ref<any>(null)
const reportPrev = ref<any>(null)
const loading = ref(false)
const exams = ref<any[]>([])
const trends = ref<any>(null)
const examDetail = ref<any>(null)
const qrDataUrl = ref('')

const examsCache = new Map<number, any[]>()
const trendsCache = new Map<number, any>()
const detailCache = new Map<number, any>()
const parentCache = new Map<number, string>()

async function load() {
  loading.value = true
  try {
    const [cur, prev] = await Promise.all([
      get<any>(`/api/classes/${props.classId}/report?from=${from.value}&to=${to.value}`),
      get<any>(`/api/classes/${props.classId}/report?from=${prevRange.value.from}&to=${prevRange.value.to}`).catch(() => null),
    ])
    report.value = cur
    reportPrev.value = prev

    // 考试数据（按班级缓存）
    if (!examsCache.has(props.classId)) {
      examsCache.set(props.classId, (await get(`/api/classes/${props.classId}/exams`).catch(() => ({ exams: [] }))).exams ?? [])
    }
    exams.value = examsCache.get(props.classId)!
    if (exams.value.length) {
      if (!trendsCache.has(props.classId)) {
        trendsCache.set(props.classId, await get(`/api/classes/${props.classId}/exams/trends`).catch(() => null))
      }
      trends.value = trendsCache.get(props.classId)
      // 最近一次考试（报告区间结束日前）
      const latest = [...exams.value].filter((e) => e.day <= to.value).sort((a, b) => (a.day < b.day ? 1 : -1))[0]
      if (latest) {
        if (!detailCache.has(latest.id)) detailCache.set(latest.id, await get(`/api/classes/${props.classId}/exams/${latest.id}`))
        examDetail.value = detailCache.get(latest.id)
      } else examDetail.value = null
    } else {
      trends.value = null
      examDetail.value = null
    }

    // 家长视图二维码（按班级缓存）
    if (!parentCache.has(props.classId)) {
      try {
        const detail = await get<any>(`/api/classes/${props.classId}`)
        const k = detail.class?.parent_key ?? detail.parent_key ?? null
        if (k) parentCache.set(props.classId, await QRCode.toDataURL(parentLinkOf(k), { width: 256, margin: 1 }))
        else parentCache.set(props.classId, '')
      } catch {
        parentCache.set(props.classId, '')
      }
    }
    qrDataUrl.value = parentCache.get(props.classId)!
  } finally {
    loading.value = false
  }
}

watch([from, to, () => props.classId], load, { immediate: true })

/* ---------- 脱敏开关 ---------- */
const masked = ref(false)
const nm = (name: string) => (masked.value ? maskZh(name) : name)

/* ---------- 视图模型 ---------- */
const shortDay = (d: string) => d.slice(5)

const vm = computed<ReportVM>(() => {
  const r = report.value
  const cur = mode.value === 'month'
  const exam = examDetail.value
  const examMeta = exam?.exam

  const dailyPoints = (r?.daily ?? []).map((d: any) => ({ label: shortDay(d.day), value: d.rate }))
  const compare = buildCompare()

  const subjects = examMeta
    ? (examMeta.subjects as Array<{ subject: string; full: number }>).flatMap((s) => {
        const st = exam.stats[s.subject]
        return st && st.avg != null ? [{ label: s.subject, value: st.avg, max: s.full }] : []
      })
    : []
  const totalFull = examMeta ? (examMeta.subjects as any[]).reduce((a, b) => a + b.full, 0) : 0
  const totalStats = exam?.stats?.['总分']
  const bands = totalStats
    ? (totalStats.dist as number[]).map((v, i) => ({ label: `${i * 10}~${i * 10 + 10}%`, value: v }))
    : []

  // 历次总分均分（trends 每生序列反推班级均值）
  const examTrend = (() => {
    const ts = trends.value?.students
    const series = trends.value?.series
    if (!ts?.length || !series?.length) return null
    const pts = series
      .map((s: any) => {
        const totals = ts
          .map((stu: any) => stu.exams.find((e: any) => e.exam_id === s.exam_id)?.total)
          .filter((t: any): t is number => t != null)
        return { label: s.name.length > 6 ? s.name.slice(0, 6) : s.name, value: totals.length ? Math.round((totals.reduce((a: number, b: number) => a + b, 0) / totals.length) * 10) / 10 : 0 }
      })
      .filter((p: any) => p.value > 0)
    return pts.length ? pts : null
  })()

  const monthExamRows = cur
    ? (exams.value ?? [])
        .filter((e) => e.day >= from.value && e.day <= to.value)
        .sort((a, b) => (a.day < b.day ? -1 : 1))
        .map((e) => {
          const ts = trends.value?.students
          const totals = ts
            ?.map((stu: any) => stu.exams.find((x: any) => x.exam_id === e.id)?.total)
            .filter((t: any): t is number => t != null) ?? []
          return {
            name: e.name,
            day: e.day,
            avgTotal: totals.length ? String(Math.round((totals.reduce((a: number, b: number) => a + b, 0) / totals.length) * 10) / 10) : '—',
          }
        })
    : []

  return {
    title: title.value,
    className: store.current?.name ?? '',
    rangeText: `${rangeLabel.value}（${weekdayCn(from.value)} 起）`,
    generatedAt: dayjs().format('YYYY-MM-DD HH:mm'),
    aiText: aiText.value,
    dailyPoints,
    compare,
    attendance: (r?.attendance ?? []).map((s: any) => ({ ...s, name: nm(s.name) })),
    leaves: (r?.leaves ?? []).map((l: any) => ({ name: nm(l.name), range: `${l.from_day.slice(5)}~${l.to_day.slice(5)}`, reason: l.reason ?? '' })),
    homework: (r?.homework ?? [])
      .filter((h: any) => h.count)
      .map((h: any) => ({ name: nm(h.name), count: h.count, detail: h.detail.join('；') })),
    exam: examMeta
      ? {
          name: examMeta.name,
          day: examMeta.day,
          subjects,
          bands,
          avgTotal: totalStats?.avg != null ? `${totalStats.avg} / ${totalFull}` : null,
          passRate: totalStats?.passRate != null ? `${totalStats.passRate}%` : null,
          excellentRate: totalStats?.excellentRate != null ? `${totalStats.excellentRate}%` : null,
        }
      : null,
    examTrend,
    monthExamRows,
    diagnosis: diagnosis.value,
    qrDataUrl: qrDataUrl.value,
  }
})

/** 环比：出勤率（均值差）、迟到/请假/作业未交（次数差）。改善 = 绿。 */
function buildCompare() {
  const r = report.value
  const p = reportPrev.value
  if (!r || !p) return null
  const mean = (arr: any[]) => (arr.length ? arr.reduce((a: number, b: any) => a + b.rate, 0) / arr.length : null)
  const curRate = mean(r.daily ?? [])
  const prevRate = mean(p.daily ?? [])
  const cnt = (arr: any[], k: string) => arr.reduce((a, b) => a + (b[k] ?? 0), 0)
  const items: ReportVM['compare'] = []
  const push = (label: string, c: number | null, pv: number | null, isRate: boolean) => {
    let curS = '—'
    let delta = '—'
    let up = false
    let good = false
    if (c != null) curS = isRate ? `${Math.round(c * 100)}%` : String(Math.round(c * 10) / 10)
    if (c != null && pv != null) {
      const d = c - pv
      if (Math.abs(isRate ? d * 100 : d) < (isRate ? 0.05 : 0.05)) delta = '持平'
      else {
        up = d > 0
        delta = `${d > 0 ? '+' : ''}${isRate ? (Math.round(d * 1000) / 10) + 'pp' : Math.round(d * 10) / 10}`
      }
      good = isRate ? d >= 0 : d <= 0
    }
    items.push({ label, cur: curS, delta, up, good })
  }
  push('平均出勤率', curRate, prevRate, true)
  push('迟到人次', cnt(r.attendance ?? [], 'late'), cnt(p.attendance ?? [], 'late'), false)
  push('请假人次', cnt(r.attendance ?? [], 'leave'), cnt(p.attendance ?? [], 'leave'), false)
  push('作业未交人次', cnt(r.homework ?? [], 'count'), cnt(p.homework ?? [], 'count'), false)
  return items
}

/* ---------- AI 总结 / 考试诊断 ---------- */
const aiText = ref('')
const aiBusy = ref(false)
const aiError = ref('')
const diagnosis = ref<ReportVM['diagnosis']>(null)
const diagBusy = ref(false)
const diagError = ref('')

async function genSummary() {
  if (aiBusy.value) return
  aiBusy.value = true
  aiError.value = ''
  aiText.value = ''
  try {
    const res = await post<{ text: string }>(`/api/classes/${props.classId}/report/summary`, { from: from.value, to: to.value })
    aiText.value = res.text
  } catch (e: any) {
    aiError.value = e.message
  } finally {
    aiBusy.value = false
  }
}

async function genDiagnosis() {
  if (diagBusy.value || !examDetail.value) return
  diagBusy.value = true
  diagError.value = ''
  diagnosis.value = null
  try {
    const res = await post<{ summary: ReportVM['diagnosis'] }>(
      `/api/classes/${props.classId}/exams/${examDetail.value.exam.id}/summary`,
      {},
    )
    diagnosis.value = res.summary
  } catch (e: any) {
    diagError.value = e.message
  } finally {
    diagBusy.value = false
  }
}

async function copyAiText() {
  try {
    await navigator.clipboard.writeText(aiText.value)
    toastMsg.value = '已复制'
    setTimeout(() => (toastMsg.value = ''), 1800)
  } catch {
    toastMsg.value = '复制失败，请手动选择文本'
  }
}
const toastMsg = ref('')

/* ---------- 导出 ---------- */
const sheetEl = ref<HTMLElement | null>(null)
const exporting = ref(false)

/* ---------- 预览自适应：整张缩到屏宽看全貌（导出不受影响，transform 只在祖先层） ---------- */
const wrapEl = ref<HTMLElement | null>(null)
const scale = ref(1)
const scaledH = ref(0)
let anchorH = 0
let ro: ResizeObserver | null = null

function updateSheetScale() {
  const w = wrapEl.value?.clientWidth ?? 0
  scale.value = w ? Math.min(1, w / 1080) : 1
  scaledH.value = anchorH ? Math.ceil(anchorH * scale.value) : 0
}

// 报告本体高度变化（区间切换/数据加载）时重算
watch(sheetEl, (el) => {
  ro?.disconnect()
  ro = null
  if (!el) return
  ro = new ResizeObserver(() => {
    anchorH = el.offsetHeight // 布局高度，不受祖先 transform 影响
    updateSheetScale()
  })
  ro.observe(el)
  anchorH = el.offsetHeight
  updateSheetScale()
})

onMounted(() => {
  window.addEventListener('resize', updateSheetScale, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateSheetScale)
  ro?.disconnect()
})


async function exportImage() {
  if (!sheetEl.value || exporting.value) return
  exporting.value = true
  try {
    // 统一导出：截取报告本体（sheet-anchor，不受外层缩放 transform 影响）；
    // 等 webfont 就绪；固定输出 2160px 宽（1080 布局 × 2），显式 dpr=1
    // 抹掉 devicePixelRatio 差异（手机 3x/桌面 1x 导出图不再不同）
    await document.fonts.ready
    const result = await snapdom(sheetEl.value, {
      width: 2160,
      dpr: 1,
      backgroundColor: '#f5f5f7',
    })
    const blob = await result.toBlob({ format: 'png' })
    await saveOrShare(`${title.value}_${store.current?.name}_${from.value}.png`, blob)
  } finally {
    exporting.value = false
  }
}

async function exportXlsxReport() {
  const r = report.value
  if (!r) return
  const sheets: any[] = [
    {
      name: '考勤汇总',
      header: ['序号', '姓名', '请假', '迟到', '旷课', '违纪', '合计'],
      rows: r.attendance.map((s: any, i: number) => [i + 1, nm(s.name), s.leave, s.late, s.absent, s.violate, s.total]),
      widths: [6, 12, 8, 8, 8, 8, 8],
      freeze: 1,
    },
    {
      name: '请假明细',
      header: ['学生', '起', '止', '事由'],
      rows: r.leaves.map((l: any) => [nm(l.name), l.from_day, l.to_day, l.reason]),
      widths: [12, 12, 12, 30],
    },
    {
      name: '作业未交',
      header: ['姓名', '未交次数', '明细'],
      rows: r.homework.filter((h: any) => h.count).map((h: any) => [nm(h.name), h.count, h.detail.join('；')]),
      widths: [12, 10, 60],
    },
  ]
  const e = examDetail.value
  if (e?.stats) {
    const subs = e.exam.subjects as any[]
    sheets.push({
      name: '考试统计',
      header: ['科目', '满分', '平均', '最高', '最低', '及格率%', '优秀率%', '缺考'],
      rows: [...subs, { subject: '总分', full: subs.reduce((a, b) => a + b.full, 0) }].map((s) => {
        const st = e.stats[s.subject]
        return [s.subject, s.full, st?.avg ?? '', st?.max ?? '', st?.min ?? '', st?.passRate ?? '', st?.excellentRate ?? '', st?.absent ?? 0]
      }),
      widths: [10, 8, 8, 8, 8, 9, 9, 8],
    })
    sheets.push({
      name: '考试成绩',
      header: ['姓名', '总分', '排名', ...subs.map((s) => s.subject)],
      rows: e.students
        .filter((s: any) => s.active)
        .map((s: any) => [nm(s.name), s.total ?? '缺考', s.rank ?? '', ...subs.map((sub) => s.scores[sub.subject] ?? '')]),
      widths: [12, 8, 6, ...subs.map(() => 8)],
    })
  }
  await exportXlsx(`${title.value}_${store.current?.name}_${from.value}.xlsx`, sheets)
}
</script>

<template>
  <div class="wrp">
    <div class="toolbar card">
      <template v-if="mode !== 'custom'">
        <button class="nav" @click="shift(-1)">‹</button>
        <span class="range-label">{{ rangeLabel }}</span>
        <button class="nav" @click="shift(1)">›</button>
      </template>
      <template v-else>
        <input v-model="customFrom" type="date" class="ginput" />
        <span class="range-label">~</span>
        <input v-model="customTo" type="date" class="ginput" />
      </template>

      <div class="seg">
        <button class="seg-btn" :class="{ on: mode === 'week' }" @click="mode = 'week'">周</button>
        <button class="seg-btn" :class="{ on: mode === 'month' }" @click="mode = 'month'">月</button>
        <button class="seg-btn" :class="{ on: mode === 'custom' }" @click="mode = 'custom'">自定义</button>
      </div>

      <label class="mask-toggle gmini" :class="{ on: masked }" title="导出时姓名脱敏（张三→张S）">
        <input v-model="masked" type="checkbox" /> 姓名脱敏
      </label>

      <span class="spacer" />

      <button v-if="aiEnabled" class="gmini ai-btn" :disabled="aiBusy || loading" @click="genSummary">
        <Icon name="sparkles" :size="14" /> {{ aiBusy ? '生成中…' : 'AI 总结' }}
      </button>
      <button v-if="aiEnabled && examDetail" class="gmini ai-btn" :disabled="diagBusy || loading" @click="genDiagnosis">
        <Icon name="sparkles" :size="14" /> {{ diagBusy ? '分析中…' : 'AI 考试诊断' }}
      </button>
      <button class="gbtn" :disabled="!report || loading" @click="exportXlsxReport"><Icon name="download" :size="15" /> Excel</button>
      <button class="gbtn primary" :disabled="!report || loading || exporting" @click="exportImage">
        <Icon name="image" :size="15" /> {{ exporting ? '生成中…' : '生成图片' }}
      </button>
    </div>

    <p v-if="aiError || diagError" class="ai-error">{{ aiError || diagError }}</p>
    <div v-if="aiText" class="ai-copy card">
      <p class="ai-text">{{ aiText }}</p>
      <button class="gmini" @click="copyAiText">{{ toastMsg || '复制' }}</button>
    </div>

    <div v-if="loading && !report" class="card pad center">加载中…</div>
    <div v-else-if="report" ref="wrapEl" class="sheet-wrap">
      <!-- 外层只做缩放（transform 不进入 snapdom 克隆），内层恒定 1080 布局宽供导出 -->
      <div
        class="sheet-scale"
        :style="scale < 1 && scaledH ? { transform: `scale(${scale})`, height: scaledH + 'px' } : undefined"
      >
        <div ref="sheetEl" class="sheet-anchor">
          <ReportSheet :vm="vm" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrp { display: flex; flex-direction: column; gap: 16px; }
.toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.nav { width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--line, rgba(0,0,0,0.1)); background: transparent; cursor: pointer; font-size: 18px; }
.range-label { font-weight: 600; font-variant-numeric: tabular-nums; }
.seg { display: flex; border: 1px solid var(--line, rgba(0,0,0,0.1)); border-radius: 10px; overflow: hidden; }
.seg-btn { padding: 6px 14px; background: transparent; border: none; cursor: pointer; font-size: 14px; }
.seg-btn.on { background: var(--accent, #007aff); color: #fff; }
.mask-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.mask-toggle.on { background: var(--accent, #007aff); color: #fff; }
.spacer { flex: 1; }
.ai-error { color: #ff3b30; font-size: 14px; margin: 0; }
.ai-copy { display: flex; align-items: flex-start; gap: 12px; padding: 14px 18px; }
.ai-copy .ai-text { flex: 1; margin: 0; white-space: pre-wrap; line-height: 1.7; }
.pad { padding: 32px; }
.center { text-align: center; color: var(--muted, #6e6e73); }
.sheet-wrap { display: flex; justify-content: center; }
.sheet-scale { transform-origin: top center; }
/* 报告本体恒定 1080px 布局宽：任何设备布局一致；窄屏由外层整体缩小适配屏宽 */
.sheet-anchor { width: 1080px; margin: 0 auto; }
.sheet-anchor > :deep(.rpt) { border-radius: 24px; box-shadow: var(--shadow, 0 8px 40px rgba(0,0,0,0.08)); }
</style>
