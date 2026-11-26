<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { get, post, put, del } from '@/api'
import { useClassStore } from '@/stores/class'
import { useAi } from '@/composables/useAi'
import Icon from '@/components/Icon.vue'
import TrendChart from '@/components/TrendChart.vue'
import { useEscClose } from '@/composables/useEscClose'

const store = useClassStore()
const { aiEnabled, ensureStatus } = useAi()
ensureStatus()

/* ---------- 视图状态 ---------- */
const view = ref<'list' | 'exam' | 'trends'>('list')
const exams = ref<any[]>([])
const loading = ref(false)
const error = ref('')
const toastMsg = ref('')
function toast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => (toastMsg.value = ''), 2400)
}

const classSubjects = computed<string[]>(() => {
  const raw = (store.current as any)?.subjects_json ?? (store.current as any)?.subjects
  if (Array.isArray(raw)) return raw.map((s: any) => String(s))
  try {
    return JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
})

async function loadExams() {
  if (!store.current) return
  loading.value = true
  error.value = ''
  try {
    const res = await get<{ exams: any[] }>(`/api/classes/${store.current.id}/exams`)
    exams.value = res.exams
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

watch(
  () => store.current?.id,
  () => {
    view.value = 'list'
    loadExams()
  },
  { immediate: true },
)

/* ---------- 编辑考试（改名 / 改日期） ---------- */
const showEditMeta = ref(false)
const editName = ref('')
const editDay = ref('')
const savingMeta = ref(false)
const editMetaError = ref('')

function openEditMeta() {
  if (!exam.value) return
  editName.value = exam.value.name
  editDay.value = exam.value.day
  editMetaError.value = ''
  showEditMeta.value = true
}

async function saveEditMeta() {
  if (!store.current || !exam.value || savingMeta.value) return
  const n = editName.value.trim()
  if (!n) {
    editMetaError.value = '考试名称不能为空'
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(editDay.value)) {
    editMetaError.value = '请选择考试日期'
    return
  }
  savingMeta.value = true
  editMetaError.value = ''
  try {
    const res = await put<{ exam: any }>(
      `/api/classes/${store.current.id}/exams/${exam.value.id}`,
      { name: n, day: editDay.value },
    )
    // 就地更新，避免整页重载丢失编辑态
    exam.value = { ...exam.value, name: res.exam?.name ?? n, day: res.exam?.day ?? editDay.value }
    showEditMeta.value = false
    toast('考试信息已更新')
    loadExams()
    loadTrends()
  } catch (e: any) {
    editMetaError.value = e.message
  } finally {
    savingMeta.value = false
  }
}

/* ---------- 新建考试 ---------- */
const showNew = ref(false)
const newName = ref('')
const newDay = ref(new Date().toISOString().slice(0, 10))
const newSubs = ref<Array<{ subject: string; full: number }>>([])
const creating = ref(false)

function openNew() {
  newSubs.value = (classSubjects.value.length ? classSubjects.value : ['语文', '数学', '英语']).map(
    (s) => ({ subject: s, full: 100 }),
  )
  newName.value = ''
  showNew.value = true
}

async function createExam() {
  if (!store.current || creating.value) return
  creating.value = true
  error.value = ''
  try {
    const res = await post<{ exam: any }>(`/api/classes/${store.current.id}/exams`, {
      name: newName.value.trim(),
      day: newDay.value,
      subjects: newSubs.value,
    })
    showNew.value = false
    toast('考试已创建')
    await loadExams()
    openExam(res.exam.id)
  } catch (e: any) {
    error.value = e.message
  } finally {
    creating.value = false
  }
}

async function removeExam(e: any) {
  if (!confirm(`删除考试「${e.name}」及其全部成绩？`)) return
  try {
    await del(`/api/classes/${store.current!.id}/exams/${e.id}`)
    toast('已删除')
    loadExams()
  } catch (err: any) {
    error.value = err.message
  }
}

/* ---------- 考试详情 ---------- */
const exam = ref<any>(null)
const students = ref<any[]>([])
const stats = ref<Record<string, any>>({})
const loadingExam = ref(false)

async function openExam(id: number) {
  view.value = 'exam'
  loadingExam.value = true
  error.value = ''
  try {
    const res = await get<any>(`/api/classes/${store.current!.id}/exams/${id}`)
    exam.value = res.exam
    students.value = res.students
    stats.value = res.stats
    exitEdit()
    // 重置上一场考试的 AI 总结，再拉本场已缓存的（不触发 AI）
    aiSummary.value = null
    aiSumCached.value = false
    loadCachedSummary()
    loadTrends()
  } catch (e: any) {
    error.value = e.message
  } finally {
    loadingExam.value = false
  }
}

/* ---------- 录分（矩阵编辑） ---------- */
const editing = ref(false)
const draft = ref<Record<string, string>>({}) // `${studentId}|${subject}` -> 输入框内容
/** 排名草稿：`${studentId}|${subject}|class` / `...|school` */
const draftRank = ref<Record<string, string>>({})
/** 是否显示排名录入列（有排名数据时自动展开，也可手动切换） */
const showRankCols = ref(false)
const saving = ref(false)

function startEdit() {
  const d: Record<string, string> = {}
  const r: Record<string, string> = {}
  let hasRank = false
  for (const s of students.value) {
    for (const sub of exam.value.subjects) {
      const v = s.scores[sub.subject]
      d[`${s.id}|${sub.subject}`] = v === null || v === undefined ? '' : String(v)
      const rk = s.ranks?.[sub.subject]
      if (rk?.class != null) {
        r[`${s.id}|${sub.subject}|class`] = String(rk.class)
        hasRank = true
      }
      if (rk?.school != null) {
        r[`${s.id}|${sub.subject}|school`] = String(rk.school)
        hasRank = true
      }
    }
  }
  draft.value = d
  draftRank.value = r
  if (hasRank) showRankCols.value = true
  editing.value = true
}

function exitEdit() {
  editing.value = false
  draft.value = {}
  draftRank.value = {}
}

/** Excel 单列粘贴：从当前单元格向下填充同科分数 */
function onPaste(e: ClipboardEvent, studentId: number, subject: string) {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!text || (!text.includes('\n') && !text.includes('\t'))) return
  e.preventDefault()
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '')
  const idx = students.value.findIndex((s) => s.id === studentId)
  let r = idx
  for (const line of lines) {
    if (r >= students.value.length) break
    const cell = line.includes('\t') ? (line.split('\t').pop() ?? '').trim() : line.trim()
    draft.value[`${students.value[r].id}|${subject}`] = cell
    r++
  }
  toast(`已粘贴 ${Math.min(lines.length, students.value.length - idx)} 行，请核对后保存`)
}

async function saveScores() {
  if (!store.current || !exam.value || saving.value) return
  const scores: Array<{
    student_id: number
    subject: string
    score: number | null
    class_rank?: number | null
    school_rank?: number | null
  }> = []
  for (const s of students.value) {
    for (const sub of exam.value.subjects) {
      const raw = (draft.value[`${s.id}|${sub.subject}`] ?? '').trim()
      const score = raw === '' ? null : Number(raw)
      // 空分不提交排名（缺考无排名可言）
      const cr = score === null ? null : Number(draftRank.value[`${s.id}|${sub.subject}|class`] ?? '') || null
      const sr = score === null ? null : Number(draftRank.value[`${s.id}|${sub.subject}|school`] ?? '') || null
      scores.push({
        student_id: s.id,
        subject: sub.subject,
        score,
        class_rank: cr,
        school_rank: sr,
      })
    }
  }
  saving.value = true
  error.value = ''
  try {
    await put(`/api/classes/${store.current!.id}/exams/${exam.value.id}/scores`, { scores })
    toast('成绩已保存')
    editing.value = false
    draftRank.value = {}
    await openExam(exam.value.id)
  } catch (e: any) {
    error.value = e.message
  } finally {
    saving.value = false
  }
}

/* ---------- 趋势（SVG 折线） ---------- */
const trends = ref<{ series: any[]; students: any[] } | null>(null)
const trendSub = ref('')
const trendStudentId = ref<number | null>(null)

async function loadTrends() {
  try {
    const res = await get<any>(`/api/classes/${store.current!.id}/exams/trends`)
    trends.value = res
    const subs = exam.value?.subjects ?? []
    if (subs.length && !res.series.some((s: any) => s.subjectAvgs[subs[0].subject] !== null)) {
      trendSub.value = ''
    }
    trendSub.value = subs[0]?.subject ?? ''
  } catch {
    trends.value = null
  }
}

const trendPoints = computed(() => {
  if (!trends.value || !exam.value) return null
  const sub = trendSub.value || exam.value.subjects[0]?.subject
  if (!sub) return null
  const pts = trends.value.series
    .map((s: any) => ({ label: s.name, day: s.day, v: s.subjectAvgs[sub] }))
    .filter((p: any) => p.v !== null)
  if (pts.length < 2) return null
  const stuPts =
    trendStudentId.value !== null
      ? (trends.value.students.find((s: any) => s.id === trendStudentId.value)?.exams ?? [])
          .map((e: any) => ({ label: e.name, v: e.scores[sub] }))
          .filter((p: any) => p.v !== null)
      : []
  const all = [...pts.map((p: any) => p.v), ...stuPts.map((p: any) => p.v)]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1
  const W = 560
  const H = 150
  const x = (i: number, len: number) => 36 + (i * (W - 60)) / Math.max(1, len - 1)
  const y = (v: number) => H - 24 - ((v - min) / span) * (H - 48)
  const toLine = (arr: any[]) => arr.map((p: any, i: number) => `${x(i, arr.length)},${y(p.v)}`).join(' ')
  return {
    W,
    H,
    cls: toLine(pts),
    clsPts: pts,
    stu: stuPts.length >= 2 ? toLine(stuPts) : null,
    stuPts,
    labels: pts.map((p: any) => p.label),
    y,
    x,
  }
})

const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1)

/* ---------- 趋势分析视图（全班一张图 + 点击学生看个人） ---------- */
/** 各科配色（循环使用，与主题协调） */
const SUBJECT_COLORS = [
  '#0a84ff', // 蓝
  '#30d158', // 绿
  '#ff9f0a', // 橙
  '#bf5af2', // 紫
  '#ff375f', // 红
  '#40c8e0', // 青
  '#ffd60a', // 黄
  '#64a2ff', // 浅蓝
]

const trendLoading = ref(false)
const trendError = ref('')
/** 全班趋势数据（与 loadTrends 共用 trends） */
const trendSubjectOrder = computed<string[]>(() => {
  if (!trends.value?.series?.length) return []
  // 取所有场次科目的并集，按首次出现顺序（最后一场可能少考某科，只看它会漏科目）
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of trends.value.series) {
    for (const sub of s.subjects ?? []) {
      const name = sub?.subject
      if (name && !seen.has(name)) {
        seen.add(name)
        out.push(name)
      }
    }
  }
  return out
})

/** 全班：各科均分 + 总分均分，画在同一张图（按得分率归一化） */
const classTrend = computed(() => {
  if (!trends.value?.series?.length) return null
  const series = trends.value.series
  const labels = series.map((s: any) => s.name)
  const subs = trendSubjectOrder.value
  if (!subs.length) return null

  const out: Array<{
    name: string
    color: string
    values: Array<number | null>
    fulls: number[]
    dashed?: boolean
    width?: number
  }> = []

  subs.forEach((sub, i) => {
    out.push({
      name: sub,
      color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
      values: series.map((s: any) => s.subjectAvgs?.[sub] ?? null),
      fulls: series.map((s: any) => s.subjects?.find((x: any) => x.subject === sub)?.full ?? 100),
    })
  })

  // 总分线：实线加粗，与科目区分
  out.push({
    name: '总分',
    color: 'var(--text)',
    values: series.map((s: any) => s.totalAvg ?? null),
    fulls: series.map((s: any) => s.totalFull ?? 100),
    width: 3,
  })

  return { labels, series: out, examCount: series.length }
})

/** 单个学生：拆成「各科」与「总分」两组，分两张图画（各科满分不同、总分是另一个量纲） */
function studentTrendOf(sid: number) {
  if (!trends.value?.series?.length) return null
  const stu = trends.value.students.find((s: any) => s.id === sid)
  if (!stu) return null
  const series = trends.value.series
  const labels = series.map((s: any) => s.name)
  const subs = trendSubjectOrder.value

  // 各科：每科单独一张图（同科目量纲一致，用原始分最直观），横向并排
  const subjectCharts = subs.map((sub, i) => ({
    subject: sub,
    color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
    series: [
      {
        name: sub,
        color: SUBJECT_COLORS[i % SUBJECT_COLORS.length],
        values: stu.exams.map((e: any) => e.scores?.[sub] ?? null) as Array<number | null>,
        fulls: series.map((s: any) => s.subjects?.find((x: any) => x.subject === sub)?.full ?? 100) as number[],
        width: 2.4,
      },
    ],
  }))

  // 总分：原始分（同一量纲，用 score 模式），单独一张
  const totalSeries = [
    {
      name: '总分',
      color: 'var(--text)',
      values: stu.exams.map((e: any) => e.total ?? null) as Array<number | null>,
      fulls: series.map((s: any) => s.totalFull ?? 100) as number[],
      width: 3,
    },
  ]

  return { labels, subjectCharts, totalSeries, student: stu }
}

async function openTrends() {
  view.value = 'trends'
  if (trends.value) return
  trendLoading.value = true
  trendError.value = ''
  try {
    const res = await get<any>(`/api/classes/${store.current!.id}/exams/trends`)
    trends.value = res
  } catch (e: any) {
    trendError.value = e.message
  } finally {
    trendLoading.value = false
  }
}

/** 点击学生 → 弹窗看个人折线 */
const trendStudent = ref<any>(null)
function openStudentTrend(sid: number) {
  const t = studentTrendOf(sid)
  if (t) trendStudent.value = t
}

/** 该学生是否有足够数据画线（≥2 场有分） */
function studentHasTrend(sid: number): boolean {
  const stu = trends.value?.students?.find((s: any) => s.id === sid)
  if (!stu) return false
  return stu.exams.filter((e: any) => e.total !== null).length >= 2
}

/* ---------- AI 考试总结（结构化分块；结果缓存，数据未变不重复消耗额度） ---------- */
const aiSummary = ref<any>(null)
const aiSumBusy = ref(false)
const aiSumError = ref('')
const aiSumCached = ref(false)

async function genSummary(force = false) {
  if (aiSumBusy.value || !exam.value) return
  aiSumBusy.value = true
  aiSumError.value = ''
  if (force) aiSummary.value = null
  try {
    const res = await post<{ summary: any; cached?: boolean }>(
      `/api/classes/${store.current!.id}/exams/${exam.value.id}/summary`,
      { force },
    )
    aiSummary.value = res.summary
    aiSumCached.value = !!res.cached
  } catch (e: any) {
    aiSumError.value = e.message
  } finally {
    aiSumBusy.value = false
  }
}

/** 打开考试时读取上次的总结（不触发 AI 调用）。 */
async function loadCachedSummary() {
  if (!exam.value) return
  try {
    const res = await get<{ summary: any; cached?: boolean }>(
      `/api/classes/${store.current!.id}/exams/${exam.value.id}/summary`,
    )
    if (res.summary) {
      aiSummary.value = res.summary
      aiSumCached.value = true
    }
  } catch {
    /* 静默 */
  }
}

/* ---------- AI 个人点评（全班一键 / 单条；评语存库可编辑） ---------- */
const showComments = ref(false)
const comments = ref<Record<number, { text: string; updated_at: string; busy?: boolean; error?: string }>>({})
const commentsLoading = ref(false)
const genAllBusy = ref(false)
const genAllProgress = ref(0)
const genAllTotal = ref(0)
const editingSid = ref<number | null>(null)
const editText = ref('')

async function openComments() {
  showComments.value = true
  commentsLoading.value = true
  try {
    const res = await get<{ comments: any[] }>(`/api/classes/${store.current!.id}/exams/${exam.value!.id}/comments`)
    const map: Record<number, { text: string; updated_at: string }> = {}
    for (const c of res.comments) map[c.student_id] = { text: c.text, updated_at: c.updated_at }
    comments.value = map
  } catch (e: any) {
    error.value = e.message
  } finally {
    commentsLoading.value = false
  }
}

async function genOneComment(sid: number) {
  const entry = comments.value[sid]
  if (entry?.busy) return
  comments.value[sid] = { text: entry?.text ?? '', updated_at: entry?.updated_at ?? '', busy: true }
  try {
    const res = await post<{ comment: { text: string; updated_at: string } }>(
      `/api/classes/${store.current!.id}/exams/${exam.value!.id}/comments`,
      { student_id: sid },
    )
    comments.value[sid] = { text: res.comment.text, updated_at: res.comment.updated_at }
  } catch (e: any) {
    comments.value[sid] = { text: entry?.text ?? '', updated_at: entry?.updated_at ?? '', error: e.message }
  }
}

/** 全班一键：并发 3 个逐生生成，进度条可见；失败的可单独重试 */
async function genAllComments() {
  if (genAllBusy.value) return
  const targets = students.value.filter((s) => s.active)
  genAllBusy.value = true
  genAllTotal.value = targets.length
  genAllProgress.value = 0
  let done = 0
  const queue = [...targets]
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift()!
      const prev = comments.value[s.id]
      comments.value[s.id] = { text: prev?.text ?? '', updated_at: prev?.updated_at ?? '', busy: true }
      try {
        const res = await post<{ comment: { text: string; updated_at: string } }>(
          `/api/classes/${store.current!.id}/exams/${exam.value!.id}/comments`,
          { student_id: s.id },
        )
        comments.value[s.id] = { text: res.comment.text, updated_at: res.comment.updated_at }
      } catch (e: any) {
        comments.value[s.id] = { text: prev?.text ?? '', updated_at: prev?.updated_at ?? '', error: e.message }
      }
      done++
      genAllProgress.value = done
    }
  }
  await Promise.all([worker(), worker(), worker()])
  genAllBusy.value = false
  toast(`已生成 ${genAllProgress.value} 条评语，失败的可单独重试`)
}

function startEditComment(sid: number) {
  editingSid.value = sid
  editText.value = comments.value[sid]?.text ?? ''
}

async function saveComment(sid: number) {
  try {
    const res = await put<{ comment: { text: string; updated_at: string } }>(
      `/api/classes/${store.current!.id}/exams/${exam.value!.id}/comments/${sid}`,
      { text: editText.value },
    )
    comments.value[sid] = { text: res.comment.text, updated_at: res.comment.updated_at }
    editingSid.value = null
    toast('评语已保存')
  } catch (e: any) {
    error.value = e.message
  }
}

async function copyComment(sid: number) {
  try {
    const name = students.value.find((s) => s.id === sid)?.name ?? ''
    await navigator.clipboard.writeText(comments.value[sid]?.text ?? '')
    toast(`已复制 ${name} 的评语`)
  } catch {
    toast('复制失败，请手动选择文本')
  }
}

/* ---------- 智能导入：AI 解析 → 直接灌进录分矩阵（矩阵即预览） ---------- */
const showImport = ref(false)
const importText = ref('')
const importBusy = ref(false)
const importError = ref('')
const importSummary = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

function openImport() {
  showImport.value = true
  importText.value = ''
  importError.value = ''
  importSummary.value = ''
}

/** 单元格取值：兼容富文本 / 公式 / 超链接 / 日期等 ExcelJS 值形态 */
function cellText(v: any): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text ?? '').join('').trim()
    if ('text' in v) return String(v.text ?? '').trim()
    if ('result' in v) return String(v.result ?? '').trim()
    if ('formula' in v) return String(v.result ?? '').trim()
    if (v instanceof Date) return v.toISOString().slice(0, 10)
  }
  return String(v).trim()
}

/**
 * xlsx → TSV 文本。
 * 关键：必须按列索引逐格取值（`getCell(c)`），不能用 `eachCell({includeEmpty:false})`——
 * 后者会跳过空单元格，导致整行左移，表头与数据列号错位（成绩单常见「学籍号」整列为空）。
 */
async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    let text = ''
    if (/\.csv$|\.txt$/i.test(file.name)) {
      text = (await file.text()).replace(/^\uFEFF/, '')
    } else {
      const ExcelJS = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await file.arrayBuffer())
      const ws = wb.worksheets[0]
      // 先求整表最大列数（含表头合并区），保证每行列数一致、列号对齐
      let maxCol = 0
      ws.eachRow({ includeEmpty: true }, (row) => {
        if (row.cellCount > maxCol) maxCol = row.cellCount
      })
      const lines: string[] = []
      ws.eachRow({ includeEmpty: true }, (row) => {
        const cells: string[] = []
        for (let c = 1; c <= maxCol; c++) cells.push(cellText(row.getCell(c).value))
        // 只裁掉行尾空列（保留行中空位，维持列对齐）
        while (cells.length && !cells[cells.length - 1]) cells.pop()
        if (cells.length) lines.push(cells.join('\t'))
      })
      text = lines.join('\n')
    }
    importText.value = text
  } catch (err: any) {
    importError.value = '文件读取失败：' + (err.message ?? '未知错误')
  } finally {
    ;(e.target as HTMLInputElement).value = ''
  }
}

/**
 * 解析并直接填入录分矩阵：
 * 命中的学生 → 写入 draft 对应科目；未命中的行单独列出，让用户手工指认或忽略。
 * 解析完立即进入编辑态，用户在矩阵里扫一眼即可保存（不再有第二层预览弹窗）。
 */
async function parseImport() {
  if (!importText.value.trim() || importBusy.value || !exam.value) return
  importBusy.value = true
  importError.value = ''
  importSummary.value = ''
  try {
    const res = await post<any>(`/api/classes/${store.current!.id}/exams/${exam.value.id}/import-parse`, {
      text: importText.value,
    })

    // 进入编辑态（保留已有成绩作为底稿）
    if (!editing.value) startEdit()

    const examSubs: string[] = exam.value.subjects.map((s: any) => s.subject)
    let filled = 0
    let gotRank = false
    const unmatched: string[] = []

    for (const row of res.rows ?? []) {
      if (!row.matched || !row.student_id) {
        if (row.name) unmatched.push(row.name)
        continue
      }
      for (const sub of examSubs) {
        const sc = row.scores?.[sub]
        if (sc === null || sc === undefined) continue
        const num = Number(sc)
        if (!Number.isFinite(num)) continue
        draft.value[`${row.student_id}|${sub}`] = String(num)
        filled++

        // 排名同时写入草稿，并自动展开排名列（AI 解析出的排名是本轮新数据，
        // startEdit 时 s.ranks 还是旧的空值，不能靠它判断）
        const cr = row.class_ranks?.[sub]
        const sr = row.school_ranks?.[sub]
        if (cr !== null && cr !== undefined) {
          draftRank.value[`${row.student_id}|${sub}|class`] = String(cr)
          gotRank = true
        }
        if (sr !== null && sr !== undefined) {
          draftRank.value[`${row.student_id}|${sub}|school`] = String(sr)
          gotRank = true
        }
      }
    }
    if (gotRank) showRankCols.value = true

    showImport.value = false
    const parts = [`已填入 ${filled} 个分数`]
    if (unmatched.length) parts.push(`${unmatched.length} 人未匹配：${unmatched.slice(0, 5).join('、')}${unmatched.length > 5 ? '…' : ''}`)
    importSummary.value = parts.join('；')
    toast(`解析完成，${parts[0]}——请在表格中核对后保存`)
  } catch (e: any) {
    importError.value = e.message
  } finally {
    importBusy.value = false
  }
}

/* ---------- Esc 关闭各弹层（逐个套在打开态上） ---------- */
useEscClose(showNew, () => (showNew.value = false))
useEscClose(showEditMeta, () => (showEditMeta.value = false))
useEscClose(showImport, () => (showImport.value = false))
useEscClose(showComments, () => (showComments.value = false))
useEscClose(trendStudent, () => (trendStudent.value = null))
</script>

<template>
  <!-- 列表 -->
  <div v-if="view === 'list'" class="glass pad">
    <div class="head-row">
      <h2 class="sec-title" style="margin: 0">考试成绩</h2>
      <button v-if="exams.length" class="gbtn" @click="openTrends">
        <Icon name="exam" :size="15" /> 趋势分析
      </button>
      <button class="gbtn primary" @click="openNew"><Icon name="plus" :size="15" /> 新建考试</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loading" class="empty" style="padding: 16px 0">加载中…</p>
    <p v-else-if="!exams.length" class="empty" style="padding: 24px 0; text-align: center">
      还没有考试。新建一场考试，录入或用智能导入成绩。
    </p>
    <div v-else class="exam-list">
      <button v-for="e in exams" :key="e.id" class="exam-item" @click="openExam(e.id)">
        <span class="ico-tile" style="--tile-color: var(--tile-exam)">
          <Icon name="exam" :size="20" />
        </span>
        <span class="exam-meta">
          <b>{{ e.name }}</b>
          <span class="hint">{{ e.day }} · {{ e.subjects.map((s: any) => s.subject).join(' / ') }}</span>
        </span>
        <span class="gmini" @click.stop="removeExam(e)" @keydown.stop>删除</span>
      </button>
    </div>
    <p class="foot-note" style="margin-top: 10px">
      成绩仅教师可见；家长凭学号绑定后在「家长视图」查看自己孩子的分数与趋势（不含排名）。教室大板不显示成绩。
    </p>
  </div>

  <!-- 趋势分析：全班一张图 + 点击学生看个人 -->
  <div v-if="view === 'trends'" class="glass pad">
    <div class="head-row">
      <button class="gbtn icon" title="返回列表" @click="view = 'list'"><Icon name="chevronLeft" :size="16" /></button>
      <div style="min-width: 0">
        <h2 class="sec-title" style="margin: 0">趋势分析</h2>
        <span class="hint">
          {{ classTrend ? `${classTrend.examCount} 场考试 · 按得分率对比（各科满分不同）` : '历次考试对比' }}
        </span>
      </div>
    </div>

    <p v-if="trendLoading" class="empty" style="padding: 24px 0">加载中…</p>
    <p v-else-if="trendError" class="err">{{ trendError }}</p>

    <template v-else-if="classTrend">
      <!-- 全班趋势：各科均分 + 总分均分 -->
      <div class="trend-card">
        <h3 class="trend-title">全班平均分趋势</h3>
        <TrendChart :labels="classTrend.labels" :series="classTrend.series" :height="220" />
        <p v-if="classTrend.examCount < 2" class="foot-note" style="margin: 8px 0 0">
          只有 1 场考试，暂无可对比的趋势——再录入一场即可看到走势。
        </p>
      </div>

      <!-- 学生列表：点击看个人折线 -->
      <div class="trend-card" style="margin-top: 12px">
        <div class="head-row" style="margin-bottom: 8px">
          <h3 class="trend-title" style="margin: 0">点击学生查看个人趋势</h3>
          <span class="foot-note" style="margin-left: auto">至少 2 场有成绩才可对比</span>
        </div>
        <div class="stu-trend-list">
          <button
            v-for="s in trends?.students ?? []"
            :key="s.id"
            class="stu-trend-item"
            :disabled="!studentHasTrend(s.id)"
            @click="openStudentTrend(s.id)"
          >
            <span class="stu-trend-name">{{ s.name }}</span>
            <span class="hint num">
              {{ s.exams.filter((e: any) => e.total !== null).length }} 场
            </span>
            <Icon v-if="studentHasTrend(s.id)" name="chevronLeft" :size="13" class="stu-trend-arrow" />
            <span v-else class="hint">数据不足</span>
          </button>
        </div>
      </div>
    </template>

    <p v-else class="empty" style="padding: 24px 0; text-align: center">还没有考试记录，无法生成趋势</p>
  </div>

  <!-- 学生个人趋势弹窗 -->
  <Teleport to="body">
    <div v-if="trendStudent" class="gbackdrop" @click.self="trendStudent = null">
      <div class="gpop stu-trend-modal" style="width: min(980px, 96vw)">
        <div class="head-row stu-trend-head">
          <h3 class="sec-title" style="margin: 0">{{ trendStudent.student.name }} · 成绩趋势</h3>
          <button class="gbtn icon" style="margin-left: auto" @click="trendStudent = null">
            <Icon name="x" :size="15" />
          </button>
        </div>
        <p class="foot-note" style="margin: 0 0 10px">
          每科单独一张走势图，总分单列（均按原始分，同科量纲一致）
        </p>
        <div class="stu-chart-grid">
          <div v-for="c in trendStudent.subjectCharts" :key="c.subject" class="stu-chart-block">
            <b class="stu-chart-title" :style="{ color: c.color }">{{ c.subject }}</b>
            <TrendChart :labels="trendStudent.labels" :series="c.series" :height="130" mode="score" />
          </div>
          <div class="stu-chart-block stu-chart-total">
            <b class="stu-chart-title">总分</b>
            <TrendChart :labels="trendStudent.labels" :series="trendStudent.totalSeries" :height="130" mode="score" />
            <p class="foot-note" style="margin: 4px 0 0; font-size: 11px">
              各场科目数/满分可能不同，总分不可直接横向比较；建议结合各科走势看。
            </p>
          </div>
        </div>
        <div class="import-acts stu-trend-foot">
          <button class="gbtn primary" @click="trendStudent = null">关闭</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 新建弹窗 -->
  <Teleport to="body">
    <div v-if="showNew" class="gbackdrop" @click.self="showNew = false">
      <div class="gpop" style="width: min(480px, 94vw)">
        <h3 class="sec-title">新建考试</h3>
        <div class="row">
          <div style="flex: 2; min-width: 0">
            <label class="flabel">考试名称</label>
            <input v-model="newName" class="ginput" style="width: 100%" placeholder="如：11月月考" maxlength="40" />
          </div>
          <div style="flex: 1; min-width: 0">
            <label class="flabel">日期</label>
            <input v-model="newDay" type="date" class="ginput" style="width: 100%" />
          </div>
        </div>
        <label class="flabel">科目与满分（及格 = 满分×60%，优秀 = ×85%）</label>
        <div class="sub-row" v-for="(s, i) in newSubs" :key="i">
          <input v-model="s.subject" class="ginput" style="flex: 1" placeholder="科目" maxlength="16" />
          <input v-model.number="s.full" type="number" class="ginput" style="width: 90px" min="1" max="1000" />
          <button class="gmini danger" @click="newSubs.splice(i, 1)">删</button>
        </div>
        <div class="row">
          <button class="gmini" @click="newSubs.push({ subject: '', full: 100 })"><Icon name="plus" :size="13" /> 加科目</button>
          <span class="foot-note">满分默认 100，可改 150 / 300 等</span>
        </div>
        <p v-if="error" class="err">{{ error }}</p>
        <div class="import-acts">
          <button class="gbtn" @click="showNew = false">取消</button>
          <button class="gbtn primary" :disabled="creating || !newName.trim() || !newSubs.length" @click="createExam">
            创建并录分
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 编辑考试名称与日期 -->
  <Teleport to="body">
    <div v-if="showEditMeta" class="gbackdrop" @click.self="showEditMeta = false">
      <div class="gpop" style="width: min(480px, 94vw)">
        <h3 class="sec-title">修改考试信息</h3>
        <div class="row">
          <div style="flex: 2; min-width: 0">
            <label class="flabel">考试名称</label>
            <input
              v-model="editName"
              class="ginput"
              style="width: 100%"
              placeholder="如：11月月考"
              maxlength="40"
              @keyup.enter="saveEditMeta"
            />
          </div>
          <div style="flex: 1; min-width: 0">
            <label class="flabel">日期</label>
            <input v-model="editDay" type="date" class="ginput" style="width: 100%" />
          </div>
        </div>
        <p class="foot-note" style="margin: 10px 0 0">
          改名与改日期不影响已录入的成绩；日期决定历次趋势里的先后顺序。
        </p>
        <p v-if="editMetaError" class="err" style="margin: 8px 0 0">{{ editMetaError }}</p>
        <div class="import-acts">
          <button class="gbtn" @click="showEditMeta = false">取消</button>
          <button
            class="gbtn primary"
            :disabled="savingMeta || !editName.trim() || !editDay"
            @click="saveEditMeta"
          >
            {{ savingMeta ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 详情 / 录分 -->
  <div v-if="view === 'exam'" class="glass pad">
    <div class="head-row">
      <button class="gbtn icon" title="返回列表" @click="view = 'list'"><Icon name="chevronLeft" :size="16" /></button>
      <div style="min-width: 0">
        <h2 class="sec-title" style="margin: 0">
          {{ exam?.name }}
          <button
            v-if="!editing"
            class="gbtn icon meta-edit"
            title="修改考试名称与日期"
            @click="openEditMeta"
          >
            <Icon name="settings" :size="14" />
          </button>
        </h2>
        <span class="hint">{{ exam?.day }} · 满分 {{ exam?.subjects.map((s: any) => s.subject + ' ' + s.full).join(' / ') }}</span>
      </div>
      <template v-if="!editing">
        <template v-if="aiEnabled">
          <button class="gbtn ai-act" :disabled="aiSumBusy" @click="genSummary(!!aiSummary)">
            <Icon name="quote" :size="15" />
            {{ aiSumBusy ? '总结生成中…' : aiSummary ? '重新总结' : 'AI 总结' }}
          </button>
          <button class="gbtn ai-act" @click="openComments"><Icon name="users" :size="15" /> AI 点评</button>
          <button class="gbtn ai-act" @click="openImport"><Icon name="upload" :size="15" /> 智能导入</button>
        </template>
        <button class="gbtn primary" style="margin-left: auto" @click="startEdit">
          <Icon name="settings" :size="15" /> 录分
        </button>
      </template>
      <template v-else>
        <button class="gbtn" style="margin-left: auto" @click="exitEdit">取消</button>
        <button class="gbtn primary" :disabled="saving" @click="saveScores">{{ saving ? '保存中…' : '保存成绩' }}</button>
      </template>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <p v-if="loadingExam" class="empty" style="padding: 16px 0">加载中…</p>

    <!-- AI 考试总结（结构化分块） -->
    <div v-if="aiSummary || aiSumBusy || aiSumError" class="glass ai-card">
      <div class="head-row">
        <h3 class="sec-title" style="margin: 0">AI 考试总结 <em>{{ exam?.name }}</em></h3>
      </div>
      <p v-if="aiSumBusy" class="empty" style="padding: 6px 0">AI 正在分析本场考试…</p>
      <p v-else-if="aiSumError" class="err" style="padding: 4px 0">{{ aiSumError }}</p>
      <template v-else-if="aiSummary">
        <p v-if="aiSumCached" class="ai-cached-tag">已保存的生成结果（成绩未变，不会重复消耗额度）</p>
        <p class="ai-overall">{{ aiSummary.overall }}</p>
        <div class="ai-blocks">
          <div class="ai-block">
            <b class="ai-btitle">强项</b>
            <ul><li v-for="(s, i) in aiSummary.strengths" :key="i">{{ s }}</li></ul>
          </div>
          <div class="ai-block">
            <b class="ai-btitle">弱项</b>
            <ul><li v-for="(s, i) in aiSummary.weaknesses" :key="i">{{ s }}</li></ul>
          </div>
          <div class="ai-block">
            <b class="ai-btitle">建议动作</b>
            <ul><li v-for="(s, i) in aiSummary.actions" :key="i">{{ s }}</li></ul>
          </div>
        </div>
        <div v-if="aiSummary.attention?.length" class="ai-attention">
          <b class="ai-btitle">需关注学生（姓名已脱敏）</b>
          <div class="ai-attention-list">
            <span v-for="(a, i) in aiSummary.attention" :key="i" class="ai-attention-item">
              <b>{{ a.name }}</b>{{ a.reason }}
            </span>
          </div>
        </div>
      </template>
    </div>

    <template v-if="exam && !loadingExam">
      <!-- 统计卡 -->
      <div class="stats-grid">
        <div v-for="sub in exam.subjects" :key="sub.subject" class="stat-card">
          <div class="stat-title">{{ sub.subject }}<span class="hint">（满分 {{ sub.full }}）</span></div>
          <div class="stat-line">
            <span>均分 <b class="num">{{ fmt(stats[sub.subject]?.avg) }}</b></span>
            <span>最高 <b class="num">{{ fmt(stats[sub.subject]?.max) }}</b></span>
            <span>最低 <b class="num">{{ fmt(stats[sub.subject]?.min) }}</b></span>
          </div>
          <div class="stat-line">
            <span class="ok-text">及格 {{ fmt(stats[sub.subject]?.passRate) }}%</span>
            <span style="color: var(--primary)">优秀 {{ fmt(stats[sub.subject]?.excellentRate) }}%</span>
            <span v-if="stats[sub.subject]?.absent" class="err">缺考 {{ stats[sub.subject].absent }}</span>
          </div>
          <div class="dist">
            <div
              v-for="(n, i) in stats[sub.subject]?.dist ?? []"
              :key="i"
              class="dist-col"
              :title="`${i * 10}%–${(i + 1) * 10}%：${n} 人`"
            >
              <div class="dist-bar" :style="{ height: Math.min(100, (n / Math.max(1, Math.max(...(stats[sub.subject]?.dist ?? [1]))) * 100)) + '%' }" />
            </div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-title">总分</div>
          <div class="stat-line">
            <span>均分 <b class="num">{{ fmt(stats['总分']?.avg) }}</b></span>
            <span>最高 <b class="num">{{ fmt(stats['总分']?.max) }}</b></span>
          </div>
        </div>
      </div>

      <!-- 成绩表 / 录分矩阵 -->
      <div class="table-scroll" style="margin-top: 14px">
        <table class="gtable score-table" :class="{ 'with-rank': showRankCols }">
          <thead>
            <tr>
              <th style="width: 34px">#</th>
              <th style="text-align: left">姓名</th>
              <template v-for="sub in exam.subjects" :key="sub.subject">
                <th>{{ sub.subject }}</th>
                <template v-if="showRankCols">
                  <th class="rank-th">班名</th>
                  <th class="rank-th">校名</th>
                </template>
              </template>
              <th>总分</th>
              <th v-if="!editing">班排</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in students" :key="s.id" :class="{ off: !s.active }">
              <td class="num">{{ s.seq }}</td>
              <td style="text-align: left">{{ s.name }}</td>
              <template v-for="sub in exam.subjects" :key="sub.subject">
                <td>
                  <template v-if="editing">
                    <input
                      v-model="draft[`${s.id}|${sub.subject}`]"
                      class="ginput score-input num"
                      inputmode="decimal"
                      :placeholder="s.absent.includes(sub.subject) ? '缺考' : ''"
                      @paste="onPaste($event, s.id, sub.subject)"
                      @keydown.enter="($event.target as HTMLInputElement).blur()"
                    />
                  </template>
                  <template v-else>
                    <span v-if="s.scores[sub.subject] !== null" class="num">{{ fmt(s.scores[sub.subject]) }}</span>
                    <span v-else class="absent-mark">缺考</span>
                  </template>
                </td>
                <template v-if="showRankCols">
                  <td class="rank-td">
                    <input
                      v-if="editing"
                      v-model="draftRank[`${s.id}|${sub.subject}|class`]"
                      class="ginput score-input num rank-input"
                      inputmode="numeric"
                      placeholder="—"
                      @keydown.enter="($event.target as HTMLInputElement).blur()"
                    />
                    <span v-else class="num rank-val">{{ s.ranks?.[sub.subject]?.class ?? '—' }}</span>
                  </td>
                  <td class="rank-td">
                    <input
                      v-if="editing"
                      v-model="draftRank[`${s.id}|${sub.subject}|school`]"
                      class="ginput score-input num rank-input"
                      inputmode="numeric"
                      placeholder="—"
                      @keydown.enter="($event.target as HTMLInputElement).blur()"
                    />
                    <span v-else class="num rank-val">{{ s.ranks?.[sub.subject]?.school ?? '—' }}</span>
                  </td>
                </template>
              </template>
              <td class="num"><b>{{ fmt(s.total) }}</b></td>
              <td v-if="!editing" class="num">{{ s.rank ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="editing" class="foot-note" style="margin-top: 8px">
        <p style="margin: 0">
          留空 = 缺考（不计入统计）。支持从 Excel 复制一列分数，在第一格直接粘贴，自动向下填充。
          <button class="gmini" style="margin-left: 6px" @click="showRankCols = !showRankCols">
            {{ showRankCols ? '隐藏排名列' : '显示排名列（班名/校名）' }}
          </button>
        </p>
        <p v-if="importSummary" class="ok-text" style="margin: 6px 0 0">{{ importSummary }}</p>
      </div>

      <!-- 趋势折线 -->
      <div v-if="trendPoints" style="margin-top: 18px">
        <div class="head-row">
          <h3 class="sec-title" style="margin: 0">历次趋势</h3>
          <select v-model="trendSub" class="gselect" style="width: auto">
            <option v-for="sub in exam.subjects" :key="sub.subject" :value="sub.subject">{{ sub.subject }} 均分</option>
          </select>
          <select v-model.number="trendStudentId" class="gselect" style="width: auto">
            <option :value="null">仅班级</option>
            <option v-for="s in students" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </div>
        <svg :viewBox="`0 0 ${trendPoints.W} ${trendPoints.H}`" class="trend-svg">
          <polyline :points="trendPoints.cls" fill="none" stroke="var(--primary)" stroke-width="2" />
          <circle
            v-for="(p, i) in trendPoints.clsPts"
            :key="i"
            :cx="trendPoints.x(i, trendPoints.clsPts.length)"
            :cy="trendPoints.y(p.v)"
            r="3"
            fill="var(--primary)"
          />
          <polyline v-if="trendPoints.stu" :points="trendPoints.stu" fill="none" stroke="var(--tile-exam)" stroke-width="2" stroke-dasharray="4 3" />
          <circle
            v-for="(p, i) in trendPoints.stuPts"
            :key="'s' + i"
            :cx="trendPoints.x(i, trendPoints.stuPts.length)"
            :cy="trendPoints.y(p.v)"
            r="3"
            fill="var(--tile-exam)"
          />
          <text v-for="(l, i) in trendPoints.labels" :key="'l' + i" :x="trendPoints.x(i, trendPoints.labels.length)" :y="trendPoints.H - 6" text-anchor="middle" class="trend-label">{{ l }}</text>
        </svg>
        <p class="foot-note">蓝实线 = 班级{{ trendSub }}均分；青虚线 = 选中学生的{{ trendSub }}分数。</p>
      </div>
    </template>
  </div>

  <!-- AI 点评弹层：全班一键 / 单条生成 / 编辑 / 复制 -->
  <Teleport to="body">
    <div v-if="showComments" class="gbackdrop" @click.self="showComments = false">
      <div class="gpop" style="width: min(680px, 96vw)">
        <div class="head-row">
          <h3 class="sec-title" style="margin: 0">AI 点评 · {{ exam?.name }}</h3>
          <button class="gmini" style="margin-left: auto" :disabled="genAllBusy || !aiEnabled" @click="genAllComments">
            {{ genAllBusy ? `生成中 ${genAllProgress}/${genAllTotal}` : '全班一键生成' }}
          </button>
          <button class="gmini" @click="showComments = false">关闭</button>
        </div>
        <div v-if="genAllBusy" class="progress"><div class="progress-bar" :style="{ width: (genAllProgress / Math.max(1, genAllTotal)) * 100 + '%' }" /></div>
        <p class="foot-note" style="margin: 8px 0 0">
          评语结合该生本次各科（vs 班级均分）与历次趋势生成，可直接复制发家长；也可编辑后保存。逐个生成时可在输入框补充说明。
        </p>
        <p v-if="commentsLoading" class="empty" style="padding: 12px 0">加载中…</p>
        <div v-else class="comment-list">
          <div v-for="s in students" :key="s.id" class="comment-row" :class="{ off: !s.active }">
            <div class="comment-head">
              <b>{{ s.name }}</b>
              <span class="hint num">{{ comments[s.id]?.updated_at ? comments[s.id].updated_at.slice(5, 16).replace('T', ' ') : '未生成' }}</span>
              <span style="flex: 1" />
              <button
                v-if="!editingSid || editingSid !== s.id"
                class="gmini"
                :disabled="comments[s.id]?.busy || genAllBusy"
                @click="genOneComment(s.id)"
              >
                {{ comments[s.id]?.busy ? '生成中…' : comments[s.id]?.text ? '重新生成' : '生成' }}
              </button>
              <button v-if="comments[s.id]?.text && editingSid !== s.id" class="gmini" @click="startEditComment(s.id)">编辑</button>
              <button v-if="comments[s.id]?.text && editingSid !== s.id" class="gmini" @click="copyComment(s.id)">复制</button>
            </div>
            <p v-if="comments[s.id]?.error" class="err" style="margin: 4px 0 0">{{ comments[s.id].error }}</p>
            <template v-if="editingSid === s.id">
              <textarea v-model="editText" class="gtextarea" rows="4" maxlength="600" style="margin-top: 6px; width: 100%"></textarea>
              <div class="head-row" style="justify-content: flex-end; margin-top: 6px">
                <button class="gmini" @click="editingSid = null">取消</button>
                <button class="gmini" @click="saveComment(s.id)">保存</button>
              </div>
            </template>
            <p v-else-if="comments[s.id]?.text" class="comment-text">{{ comments[s.id].text }}</p>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 智能导入：粘贴/上传 → AI 解析 → 直接填入下方录分矩阵（矩阵即预览） -->
  <Teleport to="body">
    <div v-if="showImport" class="gbackdrop" @click.self="showImport = false">
      <div class="gpop" style="width: min(720px, 96vw)">
        <h3 class="sec-title">智能导入成绩 · {{ exam?.name }}</h3>
        <p class="foot-note" style="margin: 0 0 8px">
          上传 Excel/CSV 或直接粘贴成绩单原文，格式任意（AI 解析）。
          支持「分数 / 班名 / 校名」多列科目组的成绩单，分数与排名会一并填入表格。
          <b class="err">解析请求将发送至 AI 服务（含学生姓名）。</b>
        </p>
        <textarea
          v-model="importText"
          class="gtextarea"
          style="width: 100%; min-height: 150px"
          placeholder="直接粘贴整张成绩单，或点下方「上传 Excel/CSV」&#10;（可含三行表头、学籍号、班级排名、校排名等列）"
        ></textarea>
        <div class="row" style="margin-top: 8px">
          <button class="gmini" @click="fileInput?.click()"><Icon name="upload" :size="13" /> 上传 Excel/CSV</button>
          <input ref="fileInput" type="file" accept=".xlsx,.csv,.txt" hidden @change="onImportFile" />
          <button
            class="gbtn primary"
            style="margin-left: auto"
            :disabled="importBusy || !importText.trim()"
            @click="parseImport"
          >
            {{ importBusy ? 'AI 解析中…' : '解析并填入表格' }}
          </button>
        </div>
        <p v-if="importError" class="err" style="margin: 8px 0 0">{{ importError }}</p>
        <p class="foot-note" style="margin: 10px 0 0">
          解析结果会直接写入下方录分表格，关闭本窗口即可逐格核对、改错，确认无误后点「保存成绩」。
        </p>
      </div>
    </div>
  </Teleport>

  <div v-if="toastMsg" class="gtoast">{{ toastMsg }}</div>
</template>

<style scoped>
.pad {
  padding: 16px 18px;
}
.head-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.exam-list {
  display: flex;
  flex-direction: column;
  margin-top: 10px;
}
.exam-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 6px;
  border: none;
  border-bottom: 1px solid var(--line-soft);
  background: none;
  cursor: pointer;
  font-family: inherit;
  color: var(--text);
  text-align: left;
  transition: background 0.15s;
}
.exam-item:hover {
  background: var(--field);
}
.exam-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.exam-meta b {
  font-size: 14.5px;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.stat-card {
  background: var(--field);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}
.stat-title {
  font-weight: 600;
  font-size: 13.5px;
  margin-bottom: 6px;
}
.stat-line {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}
.stat-line b {
  color: var(--text);
  font-size: 13px;
}
.dist {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 36px;
  margin-top: 8px;
}
.dist-col {
  flex: 1;
  display: flex;
  align-items: flex-end;
  height: 100%;
}
.dist-bar {
  width: 100%;
  min-height: 2px;
  background: var(--primary);
  opacity: 0.75;
  border-radius: 2px 2px 0 0;
}
.score-table th,
.score-table td {
  padding: 7px 8px;
}
.score-input {
  width: 58px;
  padding: 4px 6px;
  text-align: center;
}
.absent-mark {
  color: var(--faint);
  font-size: 11.5px;
}
tr.off td {
  color: var(--faint);
}
.trend-svg {
  width: 100%;
  max-width: 640px;
  display: block;
  background: var(--field);
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
}
.trend-label {
  font-size: 10px;
  fill: var(--faint);
}
.sub-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.import-acts {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}
/* ---------- AI 区块 ---------- */
.ai-act {
  margin-left: auto;
}
.ai-card {
  margin-top: 12px;
  padding: 14px 16px;
}
.ai-overall {
  margin: 8px 0 10px;
  font-size: 14px;
  line-height: 1.8;
}
/* 标题旁的编辑按钮：小、弱化，不干扰主操作 */
.meta-edit {
  padding: 3px 5px;
  margin-left: 4px;
  vertical-align: middle;
  color: var(--faint);
}
.meta-edit:hover {
  color: var(--primary);
  background: var(--primary-soft);
}
/* 趋势分析视图 */
.trend-card {
  background: var(--field);
  border: 1px solid var(--line-soft);
  border-radius: 14px;
  padding: 14px 16px;
}
.trend-title {
  margin: 0 0 10px;
  font-size: 13.5px;
  font-weight: 600;
}
.stu-trend-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
}
.stu-trend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--line-soft);
  background: var(--panel-strong);
  font-family: inherit;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s, border-color 0.15s;
}
.stu-trend-item:hover:not(:disabled) {
  background: var(--primary-soft);
  border-color: var(--primary);
}
.stu-trend-item:disabled {
  opacity: 0.55;
  cursor: default;
}
.stu-trend-name {
  font-weight: 600;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* chevronLeft 图标旋转成「指向右侧」 */
.stu-trend-arrow {
  transform: rotate(180deg);
  color: var(--faint);
  flex: none;
}
/* 学生弹窗里的分组图 */
.stu-chart-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.stu-chart-block {
  background: var(--field);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  padding: 8px 10px 6px;
  min-width: 0;
}
/* 总分段：占满整行，与各科区分 */
.stu-chart-total {
  grid-column: 1 / -1;
  background: var(--primary-soft);
  border-color: transparent;
}
.stu-chart-title {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 2px;
}

/* 个人趋势弹窗：标题与「关闭」常驻，图表区自己滚。
 * 7 张图叠起来有 1200+px，手机上一屏放不下；整页滚会让标题和关闭按钮跑出视野。 */
.stu-trend-modal {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 32px);
  overflow: hidden;
}
.stu-trend-head {
  flex: none;
  margin-bottom: 4px;
}
.stu-trend-modal > .foot-note {
  flex: none;
}
.stu-chart-grid {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  /* 顶部/底部给一点内边距，滚到底时不贴边 */
  padding: 2px 2px 10px;
  margin: 0 -2px;
}
.stu-trend-foot {
  flex: none;
  margin-top: 10px;
}

/* 手机端：单列堆叠，图高抬到 150 让曲线有起伏空间；弹窗贴满视口 */
@media (max-width: 700px) {
  .stu-chart-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .stu-trend-modal {
    /* 100% 而不是 100vw：父层有 10px padding，100vw 会横向溢出 */
    width: 100% !important;
    max-height: calc(100dvh - 20px);
    padding: 12px 12px calc(12px + env(safe-area-inset-bottom));
    margin: 0;
  }
  .stu-chart-block {
    padding: 8px 8px 4px;
  }
}
/* 缓存标识：说明这是上次生成的结果，数据未变 */
.ai-cached-tag {
  margin: 0 0 8px;
  font-size: 11.5px;
  color: var(--muted);
  background: var(--field);
  border-radius: 8px;
  padding: 4px 10px;
  display: inline-block;
}
.ai-blocks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.ai-block {
  background: var(--field);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.ai-btitle {
  font-size: 12.5px;
  color: var(--primary);
}
.ai-block ul {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
}
.ai-attention {
  margin-top: 10px;
}
.ai-attention-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.ai-attention-item {
  font-size: 13px;
  background: var(--absent-bg);
  border-radius: 8px;
  padding: 6px 10px;
}
.ai-attention-item b {
  margin-right: 6px;
}
.comment-list {
  max-height: 420px;
  overflow-y: auto;
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.comment-row {
  background: var(--field);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
}
.comment-row.off {
  opacity: 0.55;
}
.comment-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.comment-text {
  margin: 6px 0 0;
  font-size: 13.5px;
  line-height: 1.7;
  white-space: pre-wrap;
}
.progress {
  height: 6px;
  background: var(--field);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 10px;
}
.progress-bar {
  height: 100%;
  background: var(--primary);
  transition: width 0.3s var(--ease-spring);
}
/* 排名列（班名 / 校名）：窄列、弱化底色，与分数列区分 */
.rank-th {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted);
  background: var(--field);
}
.rank-td {
  padding-left: 2px;
  padding-right: 2px;
}
.rank-input {
  width: 46px;
  min-width: 0;
  padding: 6px 4px;
  font-size: 12.5px;
  text-align: center;
  color: var(--muted);
}
.rank-val {
  font-size: 12px;
  color: var(--muted);
}
/* 排名列打开后，分数输入框收窄，避免表格过宽 */
.score-table.with-rank .score-input:not(.rank-input) {
  width: 58px;
}
</style>
