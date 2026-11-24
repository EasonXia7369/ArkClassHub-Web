<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { get, post } from '@/api'
import { SLOT_LABEL } from '@/utils/dates'
import { CONSENT_VERSION, type ConsentState } from '@/utils/consent'
import ConsentDialog from '@/components/ConsentDialog.vue'

const route = useRoute()
const router = useRouter()
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

/* ---------- 绑定孩子（身份证后六位 → 长效令牌）+ 给老师留言 ---------- */
const RELATIONS = ['爸爸', '妈妈', '爷爷', '奶奶', '外公', '外婆', '其他']
const bound = ref<{ id: number; name: string; no: string } | null>(null)
const bindTail = ref('')
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

/* ---------- 服务协议与隐私政策同意（家长侧） ---------- */
/**
 * 家长同意时机：进入页面即弹（未绑定也能浏览全班脱敏视图，同样属于使用服务）。
 * - 未绑定：同意只记在本机（无账号可挂），记版本号；换设备会再弹一次
 * - 已绑定：以服务端 parent_binds.consent_version 为准，同意即写库
 * - 本机已同意后完成绑定：绑定成功时自动补写服务端记录，避免再弹一遍
 */
const LS_PCONSENT = 'ark-pconsent-'
const localAgreed = ref(localStorage.getItem(LS_PCONSENT + key.value) === CONSENT_VERSION)
const consent = ref<ConsentState | null>(null)
const consentBusy = ref(false)
const consentError = ref('')

/** 需要弹同意框？ */
const showConsent = computed(() => {
  if (!data.value) return false // 主数据未到，先不弹（避免闪一下就消失）
  if (bound.value && consent.value?.agreed) return false // 已绑定且已同意
  if (!bound.value && localAgreed.value) return false // 未绑定但本机已同意
  return true
})

function markLocalAgreed() {
  localStorage.setItem(LS_PCONSENT + key.value, CONSENT_VERSION)
  localAgreed.value = true
}

async function agreeConsent() {
  if (consentBusy.value) return
  consentBusy.value = true
  consentError.value = ''
  try {
    if (bound.value && parentToken()) {
      const res = await post<{ consent: ConsentState }>(
        `/api/parent/${key.value}/consent?${ptkQ()}`,
        { version: CONSENT_VERSION },
      )
      consent.value = res.consent
    }
    // 未绑定也记本机，绑定成功后会自动补写服务端
    markLocalAgreed()
  } catch (e: any) {
    consentError.value = e.message
  } finally {
    consentBusy.value = false
  }
}

/** 不同意 → 清除本机令牌并回到班级码入口（绑定记录仍在，可重新进入后再选） */
function declineConsent() {
  setParentToken('')
  bound.value = null
  consent.value = null
  router.replace('/parent')
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
    consent.value = data.value?.consent ?? null
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
        bindError.value = '绑定已失效，请重新绑定（身份证后六位）'
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
      /** 学校官方校排名（仅当学校成绩单提供；系统自算的班内排名不对家长开放） */
      schoolRank: (v.school_rank as number | null) ?? null,
      delta: deltaOf(ei, sub),
    })),
  }))
})

watch(key, () => {
  bound.value = null
  bindTail.value = ''
  bindError.value = ''
  // 换班级链接 → 本机同意状态按 key 重新读（不同班级视为不同服务入口）
  localAgreed.value = localStorage.getItem(LS_PCONSENT + key.value) === CONSENT_VERSION
  consent.value = null
  // 身份来源优先级：入口页 ?rel= > 本机记住 > 默认妈妈
  const qRel = (route.query.rel as string) ?? ''
  if (qRel && RELATIONS.includes(qRel)) relation.value = qRel
  else {
    const r = localStorage.getItem(LS_REL + key.value)
    if (r && RELATIONS.includes(r)) relation.value = r
    else relation.value = '妈妈'
  }
  // 注意：无论是否带 ?no= 都必须 load()，否则页面数据为空、整页只剩空壳
  // （?no= 现在只作为兼容旧二维码的无效参数，绑定不再需要学号）
  if (parentToken()) bound.value = { id: 0, name: '', no: '' }
  load()
}, { immediate: true })

/** 身份证后六位 → 服务端 HMAC 校验（班内比对）并签发长效令牌 */
async function bindParent(tail: string) {
  if (bindBusy.value) return
  bindError.value = ''
  bindBusy.value = true
  try {
    const res = await post<{ token: string; student: { name: string; student_no: string }; consent?: ConsentState }>(
      `/api/parent/${key.value}/bind`,
      { id_tail: tail },
    )
    setParentToken(res.token)
    bound.value = { id: 0, name: res.student.name, no: res.student.student_no }
    // 新绑定记录未同意协议 → 记录服务端状态；若本机此前已同意过，立即补写，不再打扰
    consent.value = res.consent ?? null
    if (localAgreed.value) {
      try {
        const cr = await post<{ consent: ConsentState }>(
          `/api/parent/${key.value}/consent?${ptkQ()}`,
          { version: CONSENT_VERSION },
        )
        consent.value = cr.consent
      } catch {
        /* 补写失败则回落到弹框（load() 会同步为未同意） */
      }
    }
    rememberIdentity()
    bindTail.value = ''
    await load()
  } catch (e: any) {
    bindError.value = e.message
  } finally {
    bindBusy.value = false
  }
}

function bindNow() {
  const tail = bindTail.value.trim().toUpperCase()
  if (!tail) return
  // 前端先挡格式：5 位数字 + 1 位数字或 X（与服务端 normalizeIdTail 一致）
  if (!/^\d{5}[\dX]$/.test(tail)) {
    bindError.value = '身份证后六位格式不对（5 位数字 + 1 位数字或 X）'
    return
  }
  bindTail.value = tail
  bindParent(tail)
}

/** 更换 = 仅清除本机令牌（服务器令牌仍有效，老师可在名单里解绑） */
function unbind() {
  bound.value = null
  bindTail.value = ''
  setParentToken('')
  bindError.value = ''
  consent.value = null
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
    // 首拉不带 after（服务端据此返回全量）；之后才用游标增量拉，避免 id<=0 的历史被吞掉
    const q = threadAfter > 0 ? `&after=${threadAfter}` : ''
    const res = await get<{ messages: any[] }>(
      `/api/parent/${key.value}/messages?${ptkQ()}${q}`,
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
      <p class="privacy-note">学生姓名已脱敏（仅显示姓氏和拼音首字母，仅班主任与家长可对应）。默认展示全班视图；输入孩子的身份证后六位绑定后，出勤与汇总只看 TA 的。本页可给老师留言（与班级消息相互独立）。</p>
    </header>

    <div v-if="loading" class="state">加载中…</div>
    <div v-else-if="error" class="state err">{{ error }}</div>

    <template v-if="data">
      <!-- 给老师留言（绑定孩子后可用） -->
      <section class="card msg-card">
        <h2>给老师留言</h2>

        <!-- 未绑定：身份证后六位 -->
        <div v-if="!bound" class="bind-box">
          <p class="hint" style="margin: 0 0 8px">
            输入孩子的<b>身份证后六位</b>完成绑定——之后这里显示 TA 的出勤与成绩，留言也署名给 TA：
          </p>
          <div class="compose-row">
            <input
              v-model="bindTail"
              class="ginput bind-code bind-code-solo"
              placeholder="身份证后六位"
              maxlength="6"
              inputmode="numeric"
              autocomplete="off"
              autocapitalize="characters"
              @keyup.enter="bindNow"
            />
            <select v-model="relation" class="gselect bind-rel" @change="rememberIdentity">
              <option v-for="r in RELATIONS" :key="r" :value="r">{{ r }}</option>
            </select>
            <button class="send-btn" :disabled="bindBusy || !bindTail.trim()" @click="bindNow">
              {{ bindBusy ? '绑定中…' : '绑定' }}
            </button>
          </div>
          <p v-if="bindError" class="err" style="margin: 8px 0 0">{{ bindError }}</p>
          <p class="foot-note" style="margin: 10px 0 0">
            身份证后六位仅用于身份核验：系统只保存不可逆的加密校验值，任何人（包括管理员）都无法查看或还原。也可以扫孩子带回家的绑定二维码，扫后填入后六位即可。
          </p>
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

      <!-- 考试成绩（绑定后可见：仅自己孩子，含班级均值对比与学校官方校排名） -->
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
                  <b v-if="row.schoolRank !== null" class="rank-chip">校排名 {{ row.schoolRank }}</b>
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
        <p class="foot-note" style="margin: 10px 0 0">
          仅展示 {{ examData.student.name }} 的成绩、班级均分与学校官方校排名（若学校成绩单提供）；不显示班内排名。
        </p>
      </section>

      <footer class="foot">
        方舟班级中心 · Ark Class Hub ·
        <router-link to="/terms">服务协议</router-link> ·
        <router-link to="/privacy">隐私政策</router-link>
      </footer>
    </template>

    <!-- 家长首次绑定（或协议改版后）强制同意：不勾选不能使用 -->
    <ConsentDialog
      v-if="showConsent"
      :busy="consentBusy"
      :error="consentError"
      decline-text="不同意并返回"
      @agree="agreeConsent"
      @decline="declineConsent"
    />
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
/* 单一凭据（只填后六位）：输入框占满剩余宽度，与身份选择/按钮同排 */
.bind-code-solo {
  flex: 1;
  width: auto;
  min-width: 0;
  max-width: 220px;
  letter-spacing: 0.12em;
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
/* 校排名徽标：学校官方口径，与班级均分并列展示 */
.rank-chip {
  color: var(--primary);
  background: var(--primary-soft);
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 11px;
  font-weight: 600;
}
.compose-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
/* 手机端：学号/后六位各占半行，身份与按钮并排在下一行，避免输入框被挤到看不清 */
@media (max-width: 560px) {
  /* 绑定行：后六位独占一行（便于核对 6 位数字），身份与按钮并排下一行 */
  .bind-box .compose-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .bind-box .compose-row .bind-code-solo {
    grid-column: 1 / -1;
    width: 100%;
    max-width: none;
  }
  .bind-code {
    width: 100%;
    min-width: 0;
  }
  .bind-rel {
    width: 100%;
    min-width: 0;
  }
  .bind-box .compose-row .send-btn {
    width: 100%;
  }
  .thread-bubble {
    max-width: 92%;
  }
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
