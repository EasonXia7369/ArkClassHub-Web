/**
 * 纯前端预览（Mock API）：`npm run dev:mock` 时由 vite.config.ts 的 mockServer 插件加载，
 * 接管所有 /api/* 请求，无需启动后端即可预览画面。
 * 数据保存在内存里，PUT/POST 会真实修改状态（重启 dev server 才重置）。
 * 未匹配的端点返回 404 并在终端打印路径，按需在 routes 表里补充。
 */

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const mondayOf = (s) => {
  const d = new Date(s + 'T00:00:00')
  const wd = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (wd - 1))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const weekdayOf = (s) => {
  const d = new Date(s + 'T00:00:00').getDay()
  return d === 0 ? 7 : d
}

/* ---------- 内存数据 ---------- */

const user = { id: 1, name: '演示老师', role: 'teacher', schoolId: 1 }

const klass = {
  id: 1,
  name: '三年二班',
  grade: '三年级',
  teacher_name: '演示老师',
  student_pass_hash: null,
  subjects: ['语文', '数学', '英语', '科学', '体育', '美术'],
  quote_config: null,
}

const students = [
  '陈一诺',
  '王子涵',
  '李思远',
  '赵雨桐',
  '刘浩然',
  '孙可欣',
  '周子墨',
  '林晓彤',
].map((name, i) => ({ id: i + 1, name, seq: i + 1, pinyin_initial: name[0], active: 1 }))

const teachers = [{ id: 1, name: '演示老师', role: 'teacher', is_owner: 1 }]

// 考勤：key = `${student_id}|${slot}|${day}`（present 不落盘）
const attendanceMap = new Map()
function seedAttendance() {
  const today = todayStr()
  const put = (sid, slot, status, note = '') => attendanceMap.set(`${sid}|${slot}|${today}`, { student_id: sid, slot, status, note })
  put(2, 'morning', 'late', '迟到 10 分钟')
  put(3, 'morning', 'leave')
  put(5, 'noon', 'violate', '课间打闹')
  put(8, 'morning', 'absent')
}
seedAttendance()

let hwTasks = [
  { day: todayStr(), subject: '语文', content: '生字表抄写一遍，家长签字' },
  { day: todayStr(), subject: '数学', content: '练习册第 32~33 页' },
]
let hwRecords = [
  { day: todayStr(), subject: '语文', title: '生字抄写', missing: [4, 7], deleted: false },
]

const timetable = [
  { weekday: 1, period: 1, subject: '语文', teacher: '演示老师' },
  { weekday: 1, period: 2, subject: '数学', teacher: '演示老师' },
  { weekday: 1, period: 3, subject: '英语', teacher: '外教 Amy' },
  { weekday: 1, period: 4, subject: '体育', teacher: '强教练' },
  { weekday: 2, period: 1, subject: '数学', teacher: '演示老师' },
  { weekday: 2, period: 2, subject: '语文', teacher: '演示老师' },
  { weekday: 2, period: 3, subject: '科学', teacher: '演示老师' },
  { weekday: 2, period: 4, subject: '美术', teacher: '林老师' },
  { weekday: 3, period: 1, subject: '英语', teacher: '外教 Amy' },
  { weekday: 3, period: 2, subject: '语文', teacher: '演示老师' },
  { weekday: 3, period: 3, subject: '数学', teacher: '演示老师' },
  { weekday: 3, period: 4, subject: '体育', teacher: '强教练' },
  { weekday: 4, period: 1, subject: '语文', teacher: '演示老师' },
  { weekday: 4, period: 2, subject: '英语', teacher: '外教 Amy' },
  { weekday: 4, period: 3, subject: '数学', teacher: '演示老师' },
  { weekday: 4, period: 4, subject: '科学', teacher: '演示老师' },
  { weekday: 5, period: 1, subject: '数学', teacher: '演示老师' },
  { weekday: 5, period: 2, subject: '语文', teacher: '演示老师' },
  { weekday: 5, period: 3, subject: '美术', teacher: '林老师' },
  { weekday: 5, period: 4, subject: '班会', teacher: '演示老师' },
]

const DUTY_ROLES = ['黑板', '讲台', '地面', '走廊', '窗台', '图书角']
function dutyMembers(day) {
  const wd = weekdayOf(day)
  // 简单轮换：每天 3 人，按 weekday 偏移取学生
  return [0, 1, 2].map((i) => {
    const s = students[(wd * 3 + i) % students.length]
    return { student_id: s.id, name: s.name, role: DUTY_ROLES[i % DUTY_ROLES.length] }
  })
}

function collectReport(from, to) {
  const days = []
  for (let d = new Date(from + 'T00:00:00'); d <= new Date(to + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const agg = new Map(students.map((s) => [s.id, { leave: 0, late: 0, absent: 0, violate: 0, total: 0 }]))
  const dayAgg = new Map()
  for (const [key, r] of attendanceMap) {
    const day = key.split('|')[2]
    if (!days.includes(day) || r.status === 'present') continue
    const a = agg.get(r.student_id)
    if (!a) continue
    if (['leave', 'late', 'absent', 'violate'].includes(r.status)) {
      a[r.status]++
      a.total++
      const d = dayAgg.get(day) ?? { leave: 0, late: 0, absent: 0, violate: 0, flagged: new Set() }
      d[r.status]++
      d.flagged.add(r.student_id)
      dayAgg.set(day, d)
    }
  }
  return {
    from,
    to,
    total_students: students.length,
    attendance: students.map((s) => ({ seq: s.seq, name: s.name, ...agg.get(s.id) })),
    violations: [...attendanceMap.values()]
      .filter((r) => r.status === 'violate')
      .map((r) => ({ day: todayStr(), name: students.find((s) => s.id === r.student_id)?.name ?? '', slot: r.slot, note: r.note })),
    leave_names: [...attendanceMap.values()].filter((r) => r.status === 'leave').map((r) => students.find((s) => s.id === r.student_id)?.name ?? ''),
    leaves: [],
    homework: hwRecords
      .filter((r) => !r.deleted)
      .flatMap((r) =>
        r.missing.map((sid) => ({ name: students.find((s) => s.id === sid)?.name ?? '', count: 1, detail: [`${r.day} ${r.subject}`] })),
      ),
    daily: [...dayAgg.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([day, d]) => ({
        day,
        leave: d.leave,
        late: d.late,
        absent: d.absent,
        violate: d.violate,
        rate: students.length ? Math.round((1 - d.flagged.size / students.length) * 1000) / 1000 : 1,
      })),
  }
}

/* ---------- 考试（成绩块预览） ---------- */

const EXAM_SUBS = [
  { subject: '语文', full: 100 },
  { subject: '数学', full: 120 },
  { subject: '英语', full: 100 },
]
const shiftDay = (n) => {
  const d = new Date(todayStr() + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const mockExams = [
  { id: 1, name: '第一次月考', day: shiftDay(-24), subjects: EXAM_SUBS },
  { id: 2, name: '期中考试', day: shiftDay(-3), subjects: EXAM_SUBS },
]

// 确定性伪分数：seq/科目决定，两次考试间有涨跌
function examScore(sid, ei, subIdx, full) {
  const base = 0.55 + ((sid * 37 + subIdx * 11) % 45) / 100
  const drift = ei === 1 ? -0.06 + (sid % 3) * 0.03 : (sid % 5) * 0.025 - 0.04
  return Math.round(Math.min(full, Math.max(full * 0.3, full * Math.min(0.98, base + drift))) * 10) / 10
}

function statOfMock(vals, full) {
  const valid = vals.filter((v) => v != null)
  const n = valid.length
  const dist = new Array(10).fill(0)
  for (const v of valid) dist[Math.min(9, Math.max(0, Math.floor((v / full) * 10)))]++
  return {
    count: n,
    absent: vals.length - n,
    avg: n ? Math.round((valid.reduce((a, b) => a + b, 0) / n) * 10) / 10 : null,
    max: n ? Math.max(...valid) : null,
    min: n ? Math.min(...valid) : null,
    passRate: n ? Math.round((valid.filter((v) => v >= full * 0.6).length / n) * 1000) / 10 : null,
    excellentRate: n ? Math.round((valid.filter((v) => v >= full * 0.85).length / n) * 1000) / 10 : null,
    dist,
  }
}

function buildExamDetail(exam) {
  const rows = students.map((s) => {
    const scores = {}
    let total = 0
    let counted = 0
    exam.subjects.forEach((sub, i) => {
      const has = !(s.id === 8 && i === 2) // 林晓彤英语缺考
      scores[sub.subject] = has ? examScore(s.id, exam.id - 1, i, sub.full) : null
      if (has) {
        total += scores[sub.subject]
        counted++
      }
    })
    return { id: s.id, name: s.name, seq: s.seq, active: true, scores, total: counted ? Math.round(total * 10) / 10 : null, absent: [], rank: null }
  })
  const ranked = [...rows.filter((r) => r.total !== null)].sort((a, b) => b.total - a.total)
  ranked.forEach((r, i) => (r.rank = i > 0 && r.total === ranked[i - 1].total ? ranked[i - 1].rank : i + 1))
  const stats = {}
  for (const sub of exam.subjects) stats[sub.subject] = statOfMock(rows.map((r) => r.scores[sub.subject]), sub.full)
  stats['总分'] = statOfMock(rows.map((r) => r.total), exam.subjects.reduce((a, b) => a + b.full, 0))
  return { exam: { id: exam.id, name: exam.name, day: exam.day, subjects: exam.subjects }, students: rows, stats }
}

const mockDetailCache = new Map(mockExams.map((e) => [e.id, buildExamDetail(e)]))

/* ---------- 路由表 ---------- */

const ok = { ok: true }

// 顺序匹配；:name 为路径参数，?a=b 为查询匹配标记（不参与路径匹配）
const routes = [
  ['POST', /^\/api\/auth\/login$/, () => ({ token: 'mock-token', user })],
  ['POST', /^\/api\/auth\/logout$/, () => ok],
  ['POST', /^\/api\/auth\/password$/, () => ok],
  ['POST', /^\/api\/auth\/consent$/, (m, q, body) => ({ consent: { version: body.version ?? 'mock', agreed: true, consented_at: new Date().toISOString() } })],
  ['GET', /^\/api\/auth\/me$/, () => ({
    user,
    consent: { version: 'mock', agreed: true, consented_at: new Date().toISOString() },
  })],

  ['GET', /^\/api\/ai\/status$/, () => ({ enabled: true })],
  ['GET', /^\/api\/push\/config$/, () => ({ enabled: false })],

  ['GET', /^\/api\/classes$/, () => ({ classes: [klass] })],
  ['GET', /^\/api\/classes\/(\d+)$/, () => ({ class: klass, students, teachers })],

  // 考勤
  ['GET', /^\/api\/classes\/(\d+)\/attendance$/, (m, q) => ({
    day: q.get('day') ?? todayStr(),
    records: [...attendanceMap.values()]
      .filter((r) => r.status !== 'present')
      .map((r) => ({ ...r, name: students.find((s) => s.id === r.student_id)?.name ?? '' })),
  })],
  ['PUT', /^\/api\/classes\/(\d+)\/attendance$/, (m, q, body) => {
    for (const e of body.entries ?? []) {
      const key = `${e.student_id}|${e.slot}|${body.day}`
      if (e.status === 'present') attendanceMap.delete(key)
      else attendanceMap.set(key, { student_id: e.student_id, slot: e.slot, status: e.status, note: e.note ?? '' })
    }
    return { ...ok, saved: (body.entries ?? []).length }
  }],
  ['POST', /^\/api\/classes\/(\d+)\/attendance\/insights$/, () => ({
    items: [
      { level: 'warn', text: '王 Z 同学本周连续 2 天迟到，建议与家长沟通作息。' },
      { level: 'info', text: '其余同学出勤稳定，保持现状即可。' },
    ],
  })],

  // 作业
  ['GET', /^\/api\/classes\/(\d+)\/hw-tasks$/, (m, q) => ({
    tasks: hwTasks.filter((t) => t.day >= (q.get('from') ?? '') && t.day <= (q.get('to') ?? '9999')),
  })],
  ['PUT', /^\/api\/classes\/(\d+)\/hw-tasks$/, (m, q, body) => {
    hwTasks = hwTasks.filter((t) => !(t.day === body.day && t.subject === body.subject))
    if (body.content) hwTasks.push({ day: body.day, subject: body.subject, content: body.content })
    return ok
  }],
  ['GET', /^\/api\/classes\/(\d+)\/hw-records$/, () => ({ records: hwRecords.filter((r) => !r.deleted) })],
  ['PUT', /^\/api\/classes\/(\d+)\/hw-records$/, (m, q, body) => {
    hwRecords = hwRecords.filter((r) => !(r.day === body.day && r.subject === body.subject))
    hwRecords.push({ day: body.day, subject: body.subject, title: body.title ?? '', missing: body.missing ?? [], deleted: false })
    return ok
  }],

  // 值日 / 课表
  ['GET', /^\/api\/classes\/(\d+)\/duty\/today$/, (m, q) => {
    const day = todayStr()
    return { day, weekday: weekdayOf(day), members: dutyMembers(day) }
  }],
  ['GET', /^\/api\/classes\/(\d+)\/duty$/, () => {
    const week = mondayOf(todayStr())
    const days = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      members: dutyMembers(week).map((mem, i) => ({ ...mem, role: DUTY_ROLES[(weekday + i) % DUTY_ROLES.length] })),
    }))
    return { week_start: week, days }
  }],
  ['GET', /^\/api\/classes\/(\d+)\/timetable$/, () => ({ timetable })],
  // 考勤统计（月度/按天）：聚合本月考勤 + 明细 + 违纪
  ['GET', /^\/api\/classes\/(\d+)\/attendance\/stats$/, (m, q) => {
    const month = q.get('month') ?? todayStr().slice(0, 7)
    const rows = [...attendanceMap.entries()]
      .map(([key, r]) => ({ ...r, day: key.split('|')[2] }))
      .filter((r) => r.day?.startsWith(month))
    const stats = students.map((s) => {
      const st = { id: s.id, name: s.name, leave: 0, late: 0, absent: 0, violate: 0, total: 0 }
      for (const r of rows) if (r.student_id === s.id && st[r.status] !== undefined) { st[r.status]++; st.total++ }
      return st
    })
    const details = rows.map((r) => ({ day: r.day, name: students.find((s) => s.id === r.student_id)?.name ?? '', slot: r.slot, status: r.status, note: r.note }))
    const violations = rows.filter((r) => r.status === 'violate').map((r) => ({ day: r.day, name: students.find((s) => s.id === r.student_id)?.name ?? '', slot: r.slot, note: r.note }))
    return {
      range: { from: `${month}-01`, to: todayStr() },
      stats,
      details,
      violations,
    }
  }],
  ['GET', /^\/api\/classes\/(\d+)\/timetable\/today$/, () => {
    const day = todayStr()
    return { day, weekday: weekdayOf(day), periods: timetable.filter((t) => t.weekday === weekdayOf(day)) }
  }],

  // 考试（成绩块预览）
  ['GET', /^\/api\/classes\/(\d+)\/exams$/, () => ({ exams: mockExams.map((e) => ({ ...e, created_at: e.day })) })],
  ['GET', /^\/api\/classes\/(\d+)\/exams\/trends$/, () => ({
    series: mockExams.map((e) => {
      const d = mockDetailCache.get(e.id)
      const subjectAvgs = {}
      for (const sub of e.subjects) subjectAvgs[sub.subject] = d.stats[sub.subject].avg
      const totalFull = e.subjects.reduce((a, s) => a + s.full, 0)
      const avgTotal = Object.values(subjectAvgs).reduce((a, v) => a + (v ?? 0), 0)
      return {
        exam_id: e.id,
        name: e.name,
        day: e.day,
        subjectAvgs,
        totalAvg: Math.round(avgTotal * 10) / 10,
        totalFull,
        subjects: e.subjects.map((s) => ({ subject: s.subject, full: s.full })),
      }
    }),
    students: students.map((s) => ({
      id: s.id,
      name: s.name,
      seq: s.seq,
      exams: mockExams.map((e) => {
        const row = mockDetailCache.get(e.id).students.find((r) => r.id === s.id)
        return { exam_id: e.id, name: e.name, day: e.day, scores: row.scores, total: row.total }
      }),
    })),
  })],
  ['GET', /^\/api\/classes\/(\d+)\/exams\/(\d+)$/, (m) => mockDetailCache.get(Number(m[2])) ?? { error: '不存在' }],
  ['POST', /^\/api\/classes\/(\d+)\/exams\/(\d+)\/summary$/, () => new Promise((resolve) =>
    setTimeout(() => resolve({
      summary: {
        overall: '本次期中考试班级整体表现稳中有升，总分均分较上次月考提高约 4 分。语文得分率最高，英语相对薄弱且有一名学生缺考。',
        strengths: ['语文得分率全班最高，阅读部分表现突出', '数学高分段人数增加，满分段出现 2 人'],
        weaknesses: ['英语得分率明显低于其他科目，听力部分失分集中', '数学后 20% 学生与班级均分差距拉大'],
        attention: [
          { name: '林X', reason: '英语缺考，需了解情况' },
          { name: '刘X', reason: '总分较上次下降明显' },
        ],
      },
    }), 600)),
  ],

  // 周报 + AI 总结（延迟 600ms 模拟 AI 生成）
  ['GET', /^\/api\/classes\/(\d+)\/report$/, (m, q) => collectReport(q.get('from') ?? mondayOf(todayStr()), q.get('to') ?? todayStr())],
  ['POST', /^\/api\/classes\/(\d+)\/report\/summary$/, () => new Promise((resolve) =>
    setTimeout(() => resolve({
      text: '本周班级整体运转平稳。出勤方面，全班 8 名同学无旷课，王 Z 同学有 2 次迟到需关注，李 S 同学请假 1 天已正常返园。作业方面，本周语文抄写作业有 2 名同学未按时上交，已当面提醒并要求补交。整体来看同学们精神面貌良好，课堂纪律较上周有进步。请各位家长周末协助检查孩子作业完成情况，并帮助孩子养成早睡早起的好习惯。感谢各位家长的配合！',
    }), 600)),
  ],
]

/* ---------- 中间件 ---------- */

export function mockApiHandler() {
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://mock.local')
    if (!url.pathname.startsWith('/api/')) return next()

    for (const [method, re, handler] of routes) {
      if (req.method !== method) continue
      const m = url.pathname.match(re)
      if (!m) continue
      let body = null
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        for await (const chunk of req) body = (body ?? '') + chunk
        try {
          body = body ? JSON.parse(body) : {}
        } catch {
          body = {}
        }
      }
      try {
        const result = await handler(m, url.searchParams, body)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(result))
      } catch (e) {
        console.error(`[mock] handler error ${req.method} ${url.pathname}:`, e)
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: String(e) }))
      }
      return
    }

    console.warn(`[mock] 未匹配的端点（请在 mock/server.js routes 中补充）: ${req.method} ${url.pathname}`)
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'mock 未实现该端点' }))
  }
}
