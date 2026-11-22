<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import dayjs from 'dayjs'
import { get, post } from '@/api'
import { SLOT_LABEL } from '@/utils/dates'

const route = useRoute()
const key = computed(() => String(route.params.key))

const data = ref<any>(null)
const error = ref('')
const loading = ref(false)

const STATUS: Record<string, { label: string; cls: string }> = {
  present: { label: '出勤', cls: 'st-present' },
  leave: { label: '请假', cls: 'st-leave' },
  late: { label: '迟到', cls: 'st-late' },
  absent: { label: '旷课', cls: 'st-absent' },
  violate: { label: '违纪', cls: 'st-violate' },
}

/* ---------- 绑定孩子（学号 + 绑定码 → 长效令牌）+ 给老师留言 ---------- */
const RELATIONS = ['爸爸', '妈妈', '爷爷', '奶奶', '外公', '外婆', '其他']
const bound = ref<{ id: number; name: string; no: string } | null>(null)
const bindNo = ref('')
const bindCode = ref('')
const bindError = ref('')
const bindBusy = ref(false)
const relation = ref('妈妈')
const msgBody = ref('')
const sending = ref(false)
const msgError = ref('')
const sentOk = ref(false)
const thread = ref<
  { id: number; sender_type: string; sender_name: string; body: string; created_at: string; reply_name?: string | null; reply_body?: string | null }[]
>([])
let threadAfter = 0
let pollTimer: ReturnType<typeof setInterval> | null = null

const LS_PTK = 'ark-ptk-'
const LS_REL = 'ark-prel-'

/** 家长绑定令牌（长效，存本机；解绑/重置码不影响已签发令牌） */
function parentToken(): string {
  return localStorage.getItem(LS_PTK + key.value) ?? ''
}
function setParentToken(t: string) {
  if (t) localStorage.setItem(LS_PTK + key.value, t)
  else localStorage.removeItem(LS_PTK + key.value)
}

/** 家长接口鉴权：令牌走 ?ptk= query（与教师登录的 Authorization 隔离） */
function ptkQ(): string {
  const t = parentToken()
  return t ? `ptk=${encodeURIComponent(t)}` : ''
}

function rememberIdentity() {
  if (bound.value) {
    localStorage.setItem(
      LS_PTK + key.value + '-no',
      JSON.stringify({ no: bound.value.no, name: bound.value.name }),
    )
  }
  localStorage.setItem(LS_REL + key.value, relation.value)
}

/** 主接口加载：带令牌时出勤个人化；无令牌 → 全班脱敏视图 */
async function load() {
  loading.value = true
  error.value = ''
  try {
    const q = ptkQ()
    data.value = await get<any>(`/api/parent/${key.value}${q ? '?' + q : ''}`)
    const bs = data.value?.bound_student
    if (bs) {
      const noSaved = localStorage.getItem(LS_PTK + key.value + '-no')
      let no = ''
      try {
        no = JSON.parse(noSaved ?? '{}')?.no ?? ''
      } catch {
        no = ''
      }
      bound.value = { id: bs.id, name: bs.name, no }
      loadExams()
    } else {
      // 令牌无效/未绑定 → 未绑定态（保留绑定框输入）
      if (bound.value) {
        bound.value = null
        bindError.value = '绑定已失效，请重新绑定（学号 + 绑定码）'
        examData.value = null
      }
      setParentToken('')
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

/* ---------- 孩子的成绩（仅绑定后可见：分数+趋势+班级均值，无排名） ---------- */
const examData = ref<{ student: { name: string }; exams: any[] } | null>(null)
const showAllExams = ref(false)

async function loadExams() {
  if (!parentToken()) {
    examData.value = null
    return
  }
  try {
    examData.value = await get<any>(`/api/parent/${key.value}/exams?${ptkQ()}`)
  } catch {
    examData.value = null
  }
}

/** 与孩子上一场考试的同一科目比较：↑ 进步 / ↓ 退步 */
function deltaOf(examIdx: number, subject: string): number | null {
  if (!examData.value) return null
  const list = examData.value.exams
  const cur = list[examIdx]?.scores?.[subject]?.score
  if (cur === null || cur === undefined || examIdx === 0) return null
  const prev = list[examIdx - 1]?.scores?.[subject]?.score
  if (prev === null || prev === undefined) return null
  return Math.round((cur - prev) * 10) / 10
}

/** 渲染模型：每场考试展开为 {sub, score, full, avg, delta} 行 */
const examView = computed(() => {
  if (!examData.value) return []
  return examData.value.exams.map((e: any, ei: number) => ({
    id: e.id,
    name: e.name,
    day: e.day,
    rows: Object.entries(e.scores).map(([sub, v]: [string, any]) => ({
      sub,
      score: v.score as number | null,
      full: v.full as number,
      avg: v.avg as number | null,
      delta: deltaOf(ei, sub),
    })),
  }))
})

watch(key, () => {
  bound.value = null
  bindNo.value = ''
  bindCode.value = ''
  bindError.value = ''
  // 身份来源优先级：入口页 ?rel= > 本机记住 > 默认妈妈
  const qRel = (route.query.rel as string) ?? ''
  if (qRel && RELATIONS.includes(qRel)) relation.value = qRel
  else {
    const r = localStorage.getItem(LS_REL + key.value)
    if (r && RELATIONS.includes(r)) relation.value = r
    else relation.value = '妈妈'
  }
  // 二维码扫码直达：?no=<学号>&bc=<绑定码> → 自动绑定
  const qNo = (route.query.no as string) ?? ''
  const qBc = (route.query.bc as string) ?? ''
  if (qNo && qBc) {
    bindParent(qNo.trim(), qBc.trim())
    return
  }
  if (parentToken()) bound.value = { id: 0, name: '', no: '' }
  load()
}, { immediate: true })

/** 学号 + 绑定码 → 服务端校验并签发长效令牌 */
async function bindParent(no: string, code: string) {
  if (bindBusy.value) return
  bindError.value = ''
  bindBusy.value = true
  try {
    const res = await post<{ token: string; student: { name: string; student_no: string } }>(
      `/api/parent/${key.value}/bind`,
      { student_no: no, bind_code: code },
    )
    setParentToken(res.token)
    bound.value = { id: 0, name: res.student.name, no: res.student.student_no }
    rememberIdentity()
    bindNo.value = ''
    bindCode.value = ''
    await load()
  } catch (e: any) {
    bindError.value = e.message
  } finally {
    bindBusy.value = false
  }
}

function bindNow() {
  const no = bindNo.value.trim()
  const code = bindCode.value.trim()
  if (!no || !code) return
  bindParent(no, code)
}

/** 更换 = 仅清除本机令牌（服务器令牌仍有效，老师可在名单里解绑） */
function unbind() {
  bound.value = null
  bindNo.value = ''
  bindCode.value = ''
  setParentToken('')
  bindError.value = ''
  load()
}

async function loadThread() {
  // 家长只可见自己孩子相关的对话（自己发的留言 + 针对这些留言的老师回复）；未绑定不拉取
  if (!parentToken()) {
    thread.value = []
    threadAfter = 0
    return
  }
  try {
    const res = await get<{ messages: any[] }>(
      `/api/parent/${key.value}/messages?${ptkQ()}&after=${threadAfter}`,
    )
    if (threadAfter === 0) thread.value = res.messages
    else {
      const seen = new Set(thread.value.map((m) => m.id))
      for (const m of res.messages) if (!seen.has(m.id)) thread.value.push(m)
    }
    if (thread.value.length) threadAfter = thread.value[thread.value.length - 1].id
  } catch {
    /* 轮询失败静默，下次再试 */
  }
}

// 绑定变化 → 对话串重置重拉（绑定成功/解绑/换绑）
watch(
  () => bound.value?.no,
  (no) => {
    threadAfter = 0
    thread.value = []
    loadThread()
  },
)

async function sendMsg() {
  const body = msgBody.value.trim()
  if (!body || !bound.value || sending.value) return
  msgError.value = ''
  sending.value = true
  try {
    await post(`/api/parent/${key.value}/messages?${ptkQ()}`, {
      body,
      relation: relation.value,
    })
    msgBody.value = ''
    rememberIdentity()
    sentOk.value = true
    setTimeout(() => (sentOk.value = false), 2500)
    await loadThread()
  } catch (e: any) {
    msgError.value = e.message
  } finally {
    sending.value = false
  }
}

function msgTime(ts: string) {
  const d = dayjs(ts)
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('MM-DD HH:mm')
}

function clipBody(s: string, n = 24): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

// 数据到位后：首拉留言串 + 15s 轮询老师回复
watch(
  () => data.value?.class_name,
  () => {
    loadThread()
    if (!pollTimer) pollTimer = setInterval(loadThread, 15_000)
  },
)

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const weeklyTotals = computed(() => {
  if (!data.value?.weekly) return { leave: 0, late: 0, absent: 0, violate: 0 }
  return data.value.weekly.reduce(
    (acc: any, w: any) => ({
      leave: acc.leave + w.leave,
      late: acc.late + w.late,
      absent: acc.absent + w.absent,
      violate: acc.violate + w.violate,
    }),
    { leave: 0, late: 0, absent: 0, violate: 0 },
  )
})
</script>

<template>
  <div class="parent-page">
    <header class="head">
      <div class="logo-row">
        <svg width="44" height="44" viewBox="0 0 128 128">
          <defs>
            <linearGradient id="pl" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#4f8dff" />
              <stop offset="1" stop-color="#2f49b2" />
            </linearGradient>
          </defs>
          <rect width="128" height="128" rx="30" fill="url(#pl)" />
          <g fill="#fff">
            <path d="M30 74 L98 74 Q96 92 64 94 Q32 92 30 74 Z" opacity=".96" />
            <path d="M60 40 L72 30 V70 H60 Z" opacity=".55" />
          </g>
          <path d="M62 56 L70 64 L86 42" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <div>
          <div class="brand">方舟班级中心</div>
          <div class="brand-en">ARK CLASS HUB</div>
        </div>
      </div>
      <h1>{{ data?.class_name ?? '' }}</h1>
      <p class="date-line" v-if="data">{{ data.day }}（{{ dayjs(data.day).format('dddd') }}）家长视图</p>
      <p class="privacy-note">学生姓名已脱敏（仅显示姓氏和拼音首字母，仅班主任与家长可对应）。默认展示全班视图；输入学号绑定孩子后，出勤与汇总只看 TA 的。本页可给老师留言（与班级消息相互独立）。</p>
    </header>

    <div v-if="loading" class="state">加载中…</div>
    <div v-else-if="error" class="state err">{{ error }}</div>

    <template v-if="data">
      <!-- 给老师留言（绑定孩子后可用） -->
      <section class="card msg-card">
        <h2>给老师留言</h2>

        <!-- 未绑定：学号 + 绑定码 双凭据 -->
        <div v-if="!bound" class="bind-box">
          <p class="hint" style="margin: 0 0 8px">
            输入孩子的<b>学号</b>和<b>绑定码</b>（老师发给你的两个数字/字母串）完成绑定——之后这里显示 TA 的出勤与成绩，留言也署名给 TA：
          </p>
          <div class="compose-row">
            <input
              v-model="bindNo"
              class="ginput bind-input"
              placeholder="学号"
              maxlength="32"
              @keyup.enter="bindNow"
            />
            <input
              v-model="bindCode"
              class="ginput bind-code"
              placeholder="绑定码"
              maxlength="16"
              @keyup.enter="bindNow"
            />
            <select v-model="relation" class="gselect bind-rel" @change="rememberIdentity">
              <option v-for="r in RELATIONS" :key="r" :value="r">{{ r }}</option>
            </select>
            <button class="send-btn" :disabled="bindBusy || !bindNo.trim() || !bindCode.trim()" @click="bindNow">
              {{ bindBusy ? '绑定中…' : '绑定' }}
            </button>
          </div>
          <p v-if="bindError" class="err" style="margin: 8px 0 0">{{ bindError }}</p>
          <p class="foot-note" style="margin: 10px 0 0">学号与绑定码请向班主任索取；也可以直接扫孩子带回家的绑定二维码。</p>
        </div>

        <!-- 已绑定 -->
        <div v-else class="bound-bar">
          <span class="bound-label">已绑定</span>
          <b class="bound-name">{{ bound.name }}</b>
          <span v-if="bound.no" class="hint num">学号 {{ bound.no }}</span>
          <select v-model="relation" class="gselect rel-sel" @change="rememberIdentity">
            <option v-for="r in RELATIONS" :key="r" :value="r">{{ r }}</option>
          </select>
          <button class="gmini" @click="unbind">更换</button>
        </div>

        <div v-if="thread.length" class="thread">
          <div
            v-for="m in thread"
            :key="m.id"
            class="thread-row"
            :class="{ 'is-teacher': m.sender_type === 'teacher' }"
          >
            <div class="thread-bubble">
              <div class="thread-meta">
                <b>{{ m.sender_name }}</b>
                <span>{{ msgTime(m.created_at) }}</span>
              </div>
              <div v-if="m.reply_name" class="quote-block">
                回复 <b>{{ m.reply_name }}</b>：{{ clipBody(m.reply_body ?? '') }}
              </div>
              {{ m.body }}
            </div>
          </div>
        </div>
        <p v-else class="none">{{ bound ? '还没有对话，写下第一条吧' : '还没有留言' }}</p>

        <div v-if="bound" class="composer">
          <textarea
            v-model="msgBody"
            class="gtextarea compose-text"
            rows="3"
            maxlength="500"
            placeholder="给老师留言（500 字以内）…"
            :disabled="sending"
          ></textarea>
          <div class="compose-actions">
            <span class="hint">署名为脱敏名字 + 身份，老师对应得到真实家长</span>
            <button class="send-btn" :disabled="sending || !msgBody.trim()" @click="sendMsg">
              {{ sending ? '发送中…' : '发送留言' }}
            </button>
          </div>
          <p v-if="msgError" class="err" style="margin: 8px 0 0">{{ msgError }}</p>
          <p v-if="sentOk" class="ok-text" style="margin: 8px 0 0; font-size: 12.5px">
            已发送，老师会在消息页的「家长留言」里看到，回复后这里会自动显示
          </p>
        </div>
        <p v-else class="foot-note" style="margin: 12px 0 0">
          绑定孩子后即可给老师留言。
        </p>
      </section>

      <!-- 今日作业 -->
      <section class="card">
        <h2>今日作业</h2>
        <div v-if="data.homework.length" class="hw-list">
          <div v-for="h in data.homework" :key="h.subject" class="hw-item">
            <span class="subj">{{ h.subject }}</span>
            <span class="content">{{ h.content }}</span>
          </div>
        </div>
        <p v-else class="none">今天没有作业</p>
      </section>

      <!-- 今日课程 -->
      <section class="card">
        <h2>今日课程</h2>
        <div v-if="data.timetable.length" class="tt-grid">
          <div v-for="p in data.timetable" :key="p.period" class="tt-item">
            <span class="tt-p">{{ p.period }}</span>
            <span>{{ p.subject }}</span>
            <span v-if="p.teacher" class="tt-teacher">{{ p.teacher }}</span>
          </div>
        </div>
        <p v-else class="none">今天没有课程</p>
      </section>

      <!-- 今日出勤：未绑定=全班脱敏；绑定=仅该孩子 -->
      <section class="card">
        <h2>今日出勤<span v-if="bound" class="bound-suffix"> · {{ bound.name }}</span></h2>
        <div v-if="data.attendance_today.length" class="att-list">
          <div v-for="(a, i) in data.attendance_today" :key="i" class="att-item" :class="STATUS[a.status]?.cls">
            <span class="att-student">{{ a.student }}</span>
            <span>{{ SLOT_LABEL[a.slot] }}</span>
            <span>{{ STATUS[a.status]?.label }}</span>
            <span v-if="a.note" class="att-note">{{ a.note }}</span>
          </div>
        </div>
        <p v-else class="none">{{ bound ? bound.name + ' 今天没有出勤记录（一切正常）' : '今天全班没有出勤记录（一切正常）' }}</p>
      </section>

      <!-- 本周汇总：未绑定=全班每生（脱敏）；绑定=仅该孩子 -->
      <section class="card">
        <h2>本周汇总<span v-if="bound" class="bound-suffix"> · {{ bound.name }}</span></h2>
        <div v-if="weeklyTotals.leave + weeklyTotals.late + weeklyTotals.absent + weeklyTotals.violate > 0" class="week-grid">
          <div class="week-item"><b class="n-leave">{{ weeklyTotals.leave }}</b><span>请假</span></div>
          <div class="week-item"><b class="n-late">{{ weeklyTotals.late }}</b><span>迟到</span></div>
          <div class="week-item"><b class="n-absent">{{ weeklyTotals.absent }}</b><span>旷课</span></div>
          <div class="week-item"><b class="n-violate">{{ weeklyTotals.violate }}</b><span>违纪</span></div>
        </div>
        <p v-else class="none">{{ bound ? bound.name + ' 本周全勤' : '本周全班全勤' }}</p>
      </section>

      <!-- 考试成绩（绑定后可见：仅自己孩子，含班级均值对比，不含排名） -->
      <section v-if="bound && examData" class="card">
        <h2>考试成绩<span class="bound-suffix"> · {{ examData.student.name }}</span></h2>
        <div v-if="examData.exams.length" class="exam-list">
          <div
            v-for="e in showAllExams ? examView : examView.slice(-3)"
            :key="e.id"
            class="pexam"
          >
            <div class="pexam-head">
              <b>{{ e.name }}</b>
              <span class="hint">{{ e.day }}</span>
            </div>
            <div class="pexam-rows">
              <div v-for="row in e.rows" :key="row.sub" class="pexam-row">
                <span class="pexam-subj">{{ row.sub }}</span>
                <span class="num pexam-score">{{ row.score ?? '缺考' }}<i v-if="row.score !== null" class="pexam-full"> / {{ row.full }}</i></span>
                <span class="hint num">
                  班级均分 {{ row.avg ?? '—' }}
                  <b v-if="row.delta !== null" :class="row.delta >= 0 ? 'delta-up' : 'delta-down'">
                    {{ row.delta >= 0 ? '↑' : '↓' }}{{ Math.abs(row.delta) }}
                  </b>
                </span>
              </div>
            </div>
          </div>
          <button v-if="examData.exams.length > 3 && !showAllExams" class="gmini" @click="showAllExams = true">
            查看更早的 {{ examData.exams.length - 3 }} 场考试
          </button>
        </div>
        <p v-else class="none">还没有考试记录</p>
        <p class="foot-note" style="margin: 10px 0 0">仅展示 {{ examData.student.name }} 的成绩与班级均值对比，不含排名。</p>
      </section>

      <footer class="foot">方舟班级中心 · Ark Class Hub</footer>
    </template>
  </div>
</template>

<style scoped>
.parent-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 20px 64px;
}
.head {
  margin-bottom: 20px;
}
.logo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.brand {
  font-size: 15px;
  font-weight: 600;
}
.brand-en {
  font-size: 10px;
  letter-spacing: 0.3em;
  color: var(--faint);
}
h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.date-line {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 14px;
}
.privacy-note {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--faint);
  background: var(--panel-strong);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 10px;
  padding: 8px 12px;
}
.card {
  background: var(--panel-strong);
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 16px;
  padding: 18px 20px;
  margin-bottom: 14px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
}
h2 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}
.hw-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hw-item {
  display: flex;
  gap: 12px;
  align-items: baseline;
}
.subj {
  font-weight: 600;
  color: var(--primary);
  flex: none;
  width: 56px;
}
.content {
  font-size: 16px;
  line-height: 1.7;
}
.tt-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tt-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--field);
  border-radius: 10px;
  padding: 6px 12px;
  font-size: 13.5px;
}
.tt-p {
  background: var(--primary);
  color: var(--on-primary);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
}
.tt-teacher {
  color: var(--muted);
  font-size: 12px;
}
.att-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.att-item {
  display: flex;
  gap: 12px;
  font-size: 13.5px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--field);
  flex-wrap: wrap;
}
.att-student {
  font-weight: 600;
}
.st-present {
  color: var(--present);
}
.st-leave {
  color: var(--leave);
}
.st-late {
  color: var(--primary);
}
.st-absent {
  color: var(--absent);
}
.st-violate {
  color: var(--violate);
}
.att-note {
  color: var(--muted);
  font-size: 12px;
}
.week-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.week-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--field);
  border-radius: 12px;
  padding: 12px 6px;
}
.week-item b {
  font-size: 24px;
  font-weight: 600;
}
.week-item span {
  font-size: 11.5px;
  color: var(--muted);
}
.n-leave {
  color: var(--leave);
}
.n-late {
  color: var(--primary);
}
.n-absent {
  color: var(--absent);
}
.n-violate {
  color: var(--violate);
}
.none {
  color: var(--faint);
  font-size: 13px;
  margin: 4px 0 0;
}
/* ---------- 给老师留言 ---------- */
.msg-card h2 {
  margin-bottom: 8px;
}
.thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
  margin-bottom: 12px;
  padding-right: 4px;
}
.thread-row {
  display: flex;
}
.thread-row.is-teacher {
  justify-content: flex-end;
}
.thread-bubble {
  max-width: 82%;
  background: var(--field);
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 14px 14px 14px 4px;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.thread-row.is-teacher .thread-bubble {
  background: rgba(0, 122, 255, 0.09);
  border-color: rgba(0, 122, 255, 0.35);
  border-radius: 14px 14px 4px 14px;
}
.thread-meta {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 10.5px;
  color: var(--faint);
  margin-bottom: 3px;
}
.thread-meta b {
  color: var(--primary);
  font-weight: 600;
}
.quote-block {
  font-size: 11.5px;
  color: var(--muted);
  background: rgba(0, 0, 0, 0.04);
  border-left: 3px solid var(--primary);
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quote-block b {
  color: var(--primary);
}
.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* ---------- 绑定孩子 ---------- */
.bind-box {
  background: var(--field);
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 12px;
}
.bind-input {
  flex: 1;
  min-width: 0;
}
.bind-code {
  flex: none;
  width: 110px;
  letter-spacing: 0.08em;
}
.bind-rel {
  flex: none;
  width: auto;
  min-width: 84px;
  padding: 8px 8px;
}
.bound-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: rgba(52, 199, 89, 0.1);
  border: 1px solid rgba(52, 199, 89, 0.4);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.bound-label {
  font-size: 12px;
  color: var(--present);
  font-weight: 700;
}
.bound-name {
  font-size: 15px;
  color: var(--text);
}
.rel-sel {
  width: auto;
  padding: 4px 8px;
  font-size: 13px;
}
.bound-suffix {
  font-size: 12.5px;
  color: var(--muted);
  font-weight: 500;
}
/* ---------- 考试成绩卡 ---------- */
.exam-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.pexam {
  background: var(--field);
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 12px;
  padding: 10px 12px;
}
.pexam-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.pexam-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pexam-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13.5px;
  flex-wrap: wrap;
}
.pexam-subj {
  width: 52px;
  flex: none;
  color: var(--muted);
}
.pexam-score {
  font-weight: 700;
}
.pexam-full {
  font-style: normal;
  font-weight: 400;
  color: var(--faint);
  font-size: 11px;
}
.delta-up {
  color: var(--present);
}
.delta-down {
  color: var(--absent);
}
.compose-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.compose-sel {
  flex: 1;
  min-width: 120px;
}
.compose-text {
  width: 100%;
}
.compose-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.send-btn {
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: var(--primary);
  color: #fff;
  padding: 9px 18px;
  border-radius: 10px;
  transition: 0.15s;
}
.send-btn:hover {
  background: var(--primary-dark);
}
.send-btn:active {
  transform: scale(0.96);
}
.send-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.state {
  text-align: center;
  padding: 48px 0;
  color: var(--muted);
}
.err {
  color: var(--absent);
}
.foot {
  text-align: center;
  color: var(--faint);
  font-size: 12px;
  margin-top: 20px;
}
</style>
