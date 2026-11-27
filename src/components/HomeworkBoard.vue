<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { get, put, del } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useClassStore } from '@/stores/class'
import { useChatStore } from '@/stores/chat'
import { exportXlsx } from '@/utils/xlsx'
import { dk, weekdayCn } from '@/utils/dates'
import { initialOf } from '@/utils/pinyin'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ classId: number }>()
const store = useClassStore()
const chat = useChatStore()
const auth = useAuthStore()

const isStudent = computed(() => auth.user?.role === 'student')

const sub = ref<'miss' | 'task' | 'history'>('miss')

/* ---------- 作业未交 ---------- */
const day = ref(dk())
const subject = ref('')
const title = ref('')
const missing = ref<Set<number>>(new Set())
/** 当前正在登记的作业项序号（同一天同一科可以有多项，各收各的未交名单） */
const itemNo = ref(0)
const rangeFrom = ref(dayjs().startOf('month').format('YYYY-MM-DD'))
const rangeTo = ref(dk())
const rangeRecords = ref<any[]>([])
const rangeTasks = ref<any[]>([])

const subjects = computed(() => store.current?.subjects ?? [])

const todayRecords = computed(() =>
  rangeRecords.value.filter((r) => r.day === day.value && !r.deleted),
)

/** 当天该科的所有作业项（按项序号升序） */
const items = computed(() =>
  todayRecords.value
    .filter((r) => r.subject === subject.value)
    .sort((a: any, b: any) => (a.item_no ?? 0) - (b.item_no ?? 0)),
)

/** 当前项已保存过的记录（新增项时为 null） */
const currentRec = computed(
  () => items.value.find((r: any) => (r.item_no ?? 0) === itemNo.value) ?? null,
)

const todayTask = computed(() =>
  rangeTasks.value.find((t) => t.day === day.value && t.subject === subject.value),
)

/** 项序号标记：用 ① 这类圈码，比「第1项/第2项」短得多，不抢作业内容的视觉位置 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
function noMark(no: number): string {
  return no >= 0 && no < CIRCLED.length ? CIRCLED[no] : `第${no + 1}项`
}

/** 项标签：显示作业内容（没有内容时给「未命名」，让缺填一眼看出来）
 *  序号只作圈码前缀——用户要按内容区分是哪项作业，不是按序号 */
function itemLabel(r: any): string {
  return r.title || '未命名'
}

/** 把当前项已保存的数据回填到编辑区 */
function syncEdit() {
  const rec = currentRec.value
  missing.value = new Set(rec?.missing ?? [])
  title.value = rec?.title ?? ''
}

/** 切换到某一项；序号不存在 = 新建项 */
function selectItem(n: number) {
  itemNo.value = n
  syncEdit()
  surname.value = ''
}

/** 新增一项：序号接在已有项后面 */
function addItem() {
  const used = items.value.map((r: any) => r.item_no ?? 0)
  selectItem(used.length ? Math.max(...used) + 1 : 0)
}

const surnameBar = computed(() => {
  const map = new Map<string, number>()
  for (const s of store.students.filter((x) => x.active)) {
    const k = initialOf(s)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})
const surname = ref('')

const filteredStudents = computed(() =>
  store.students
    .filter((s) => s.active)
    .filter((s) => !surname.value || initialOf(s) === surname.value),
)

async function loadRange() {
  const [rec, task] = await Promise.all([
    get<any>(`/api/classes/${props.classId}/hw-records?from=${rangeFrom.value}&to=${rangeTo.value}`),
    get<any>(`/api/classes/${props.classId}/hw-tasks?from=${rangeFrom.value}&to=${rangeTo.value}`),
  ])
  rangeRecords.value = rec.records
  rangeTasks.value = task.tasks
}

watch([rangeFrom, rangeTo, props.classId], loadRange, { immediate: true })
// 其他端变更作业 → 自动刷新
watch(() => chat.refreshTick, () => loadRange())

watch(day, () => {
  // 换天：回到第一项（若该科当天没有记录则序号归 0）
  itemNo.value = items.value.length ? (items.value[0].item_no ?? 0) : 0
  syncEdit()
})

watch(subject, () => {
  itemNo.value = items.value.length ? (items.value[0].item_no ?? 0) : 0
  syncEdit()
})

function toggle(sid: number) {
  const next = new Set(missing.value)
  if (next.has(sid)) next.delete(sid)
  else next.add(sid)
  missing.value = next
}

async function saveMiss() {
  if (!subject.value.trim()) {
    alert('请先选科目')
    return
  }
  // 作业内容是区分「是哪一项」的唯一依据，空着会让多项记录全变成「未命名」
  if (!title.value.trim() && !currentRec.value?.title) {
    alert('请先填写作业内容——同一天同一科有多项时，靠它区分是哪项作业')
    return
  }
  // 只改名单、没改内容时不要用空字符串覆盖库里的名称
  const body = {
    day: day.value,
    subject: subject.value.trim(),
    item_no: itemNo.value,
    missing: [...missing.value],
  } as Record<string, unknown>
  if (title.value.trim()) body.title = title.value.trim()
  await put(`/api/classes/${props.classId}/hw-records`, body)
  await loadRange()
  // loadRange 后 items 可能新增了这一项，保持停在当前项
  syncEdit()
}

async function markAllPresent() {
  missing.value = new Set()
  await saveMiss()
}

async function deleteCurrent() {
  if (!subject.value.trim()) return
  const label = currentRec.value?.title
    ? `「${currentRec.value.title}」`
    : `${noMark(itemNo.value)}（未命名）`
  if (!confirm(`删除 ${day.value} ${subject.value} 的${label}？`)) return
  const q =
    `/api/classes/${props.classId}/hw-records?day=${day.value}&subject=${encodeURIComponent(subject.value.trim())}` +
    `&item_no=${itemNo.value}`
  await del(q)
  await loadRange()
  // 删掉当前项后回到第一项
  itemNo.value = items.value.length ? (items.value[0].item_no ?? 0) : 0
  syncEdit()
}

/* ---------- 统计 ---------- */
/** 哪些「科目@日期」有多个项（只有这些才需要显示圈码，单项不必标序号） */
const multiSubjects = computed(() => {
  const seen = new Map<string, number>()
  for (const r of rangeRecords.value) {
    if (r.deleted) continue
    const k = `${r.subject}@${r.day}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  const out = new Set<string>()
  for (const [k, n] of seen) if (n > 1) out.add(k)
  return out
})

const perStudent = computed(() => {
  const counts = new Map<number, { name: string; count: number; detail: string[] }>()
  for (const s of store.students.filter((x) => x.active)) {
    counts.set(s.id, { name: s.name, count: 0, detail: [] })
  }
  for (const r of rangeRecords.value) {
    if (r.deleted) continue
    for (const sid of r.missing) {
      const entry = counts.get(sid)
      if (!entry) continue
      entry.count++
      // 多项时用作业名区分，没有名称退回圈码；单项不标序号（日期+科目已足够）
      const multi = multiSubjects.value.has(`${r.subject}@${r.day}`)
      const tag = multi ? (r.title ? `（${r.title}）` : `（${noMark(r.item_no ?? 0)}）`) : ''
      entry.detail.push(`${r.day} ${r.subject}${tag}`)
    }
  }
  return [...counts.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
})

async function exportMiss() {
  const rows = perStudent.value.map((s, i) => [
    { v: i + 1 },
    { v: s.name },
    { v: s.count },
    { v: s.detail.join('；') },
  ])
  const listRows = rangeRecords.value
    .filter((r) => !r.deleted)
    .map((r) => [
      { v: r.day },
      { v: weekdayCn(r.day) },
      { v: r.subject },
      { v: r.title || (r.item_no ? `第${r.item_no + 1}项` : '') },
      { v: r.missing.map((id: number) => store.students.find((s) => s.id === id)?.name ?? id).join('、') },
    ])
  await exportXlsx(`作业统计_${store.current?.name}_${rangeFrom.value}至${rangeTo.value}.xlsx`, [
    {
      name: '作业汇总',
      header: ['序号', '姓名', '未交次数', '未交明细'],
      rows,
      widths: [6, 12, 10, 60],
      freeze: 1,
    },
    {
      name: '作业明细',
      header: ['日期', '星期', '科目', '作业内容', '未交学生'],
      rows: listRows,
      widths: [12, 8, 10, 40, 40],
      freeze: 1,
    },
  ])
}

/* ---------- 作业布置 ---------- */
const taskDay = ref(dk())
const taskSubject = ref('')
const taskContent = ref('')

const dayTasks = computed(() => rangeTasks.value.filter((t) => t.day === taskDay.value))

watch(taskSubject, () => {
  taskContent.value = dayTasks.value.find((t) => t.subject === taskSubject.value)?.content ?? ''
})

watch(taskDay, () => {
  taskContent.value = dayTasks.value.find((t) => t.subject === taskSubject.value)?.content ?? ''
})

async function saveTask() {
  if (!taskSubject.value.trim()) {
    alert('请先选科目')
    return
  }
  await put(`/api/classes/${props.classId}/hw-tasks`, {
    day: taskDay.value,
    subject: taskSubject.value.trim(),
    content: taskContent.value,
  })
  await loadRange()
}

/* ---------- 区间作业记录（回填 / 删除） ---------- */
const missNames = (missing: number[]) =>
  missing.map((id) => store.students.find((s) => s.id === id)?.name ?? `#${id}`).join('、') || '无'

async function loadMiss(r: any) {
  sub.value = 'miss'
  day.value = r.day
  subject.value = r.subject
  itemNo.value = r.item_no ?? 0
  title.value = r.title
  missing.value = new Set(r.missing)
}

async function deleteMiss(r: any) {
  const label = r.title ? `「${r.title}」` : `${noMark(r.item_no ?? 0)}（未命名）`
  if (!confirm(`删除 ${r.day} ${r.subject} 的${label}？`)) return
  await del(
    `/api/classes/${props.classId}/hw-records?day=${r.day}&subject=${encodeURIComponent(r.subject)}&item_no=${r.item_no ?? 0}`,
  )
  await loadRange()
}

function loadTask(t: any) {
  taskDay.value = t.day
  taskSubject.value = t.subject
  taskContent.value = t.content
}

/* ---------- 历史作业（按天分组查看区间内布置过的作业） ---------- */
const histFrom = ref(dayjs().subtract(29, 'day').format('YYYY-MM-DD'))
const histTo = ref(dk())
const histTasks = ref<Array<{ day: string; weekday: string; items: any[] }>>([])
const histLoading = ref(false)

async function loadHistory() {
  if (!dateOk(histFrom.value) || !dateOk(histTo.value) || histFrom.value > histTo.value) return
  histLoading.value = true
  try {
    const res = await get<any>(
      `/api/classes/${props.classId}/hw-tasks?from=${histFrom.value}&to=${histTo.value}`,
    )
    const map = new Map<string, any[]>()
    for (const t of res.tasks) {
      const arr = map.get(t.day) ?? []
      arr.push(t)
      map.set(t.day, arr)
    }
    histTasks.value = [...map.entries()]
      .map(([day, items]) => ({ day, weekday: weekdayCn(day), items }))
      .sort((a, b) => b.day.localeCompare(a.day))
  } finally {
    histLoading.value = false
  }
}

function dateOk(v: string | null | undefined): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

function histQuick(kind: '7d' | '30d' | 'month') {
  histTo.value = dk()
  histFrom.value =
    kind === '7d'
      ? dayjs().subtract(6, 'day').format('YYYY-MM-DD')
      : kind === '30d'
        ? dayjs().subtract(29, 'day').format('YYYY-MM-DD')
        : dayjs().startOf('month').format('YYYY-MM-DD')
  loadHistory()
}

function editHist(t: any) {
  loadTask(t)
  sub.value = 'task'
}

async function deleteHist(t: any) {
  if (!confirm(`删除 ${t.day} ${t.subject} 的作业布置？`)) return
  await put(`/api/classes/${props.classId}/hw-tasks`, {
    day: t.day,
    subject: t.subject,
    content: '',
  })
  await loadHistory()
  toastHist(`已删除 ${t.day} ${t.subject}`)
}

const histToast = ref('')
function toastHist(msg: string) {
  histToast.value = msg
  setTimeout(() => (histToast.value = ''), 2000)
}

watch(sub, (v) => {
  if (v === 'history' && !histTasks.value.length) loadHistory()
})
watch([histFrom, histTo], () => {
  if (sub.value === 'history' && dateOk(histFrom.value) && dateOk(histTo.value)) loadHistory()
})
</script>

<template>
  <div class="gseg subbar">
    <button :class="{ on: sub === 'miss' }" @click="sub = 'miss'">作业未交</button>
    <button :class="{ on: sub === 'task' }" @click="sub = 'task'">作业布置</button>
    <button :class="{ on: sub === 'history' }" @click="sub = 'history'">历史作业</button>
  </div>

  <!-- ======== 作业未交 ======== -->
  <template v-if="sub === 'miss'">
    <div class="card toolbar">
      <input v-model="day" type="date" />
      <select v-model="subject" class="subject-sel">
        <option value="" disabled>科目</option>
        <option v-for="s in subjects" :key="s" :value="s">{{ s }}</option>
      </select>
      <input v-model="title" type="text" class="title-in" placeholder="作业内容：如 第3章练习册 P32 / 背诵课文" maxlength="40" />
    </div>

    <!-- 作业项选择：同一天同一科可以有多项作业，各自一份未交名单 -->
    <div v-if="subject" class="card pad item-bar">
      <div class="item-head">
        <h3 class="sec-title">作业项 <em>{{ items.length }}</em></h3>
        <button class="gmini" @click="addItem"><Icon name="plus" :size="12" /> 新增一项</button>
      </div>
      <p v-if="!items.length" class="item-empty">
        这一科当天还没有登记过。填好下面的作业内容后点「保存」即创建第 1 项。
      </p>
      <div v-else class="item-tabs">
        <button
          v-for="r in items"
          :key="r.item_no ?? 0"
          class="item-tab"
          :class="{ on: itemNo === (r.item_no ?? 0), unnamed: !r.title }"
          @click="selectItem(r.item_no ?? 0)"
        >
          <span class="item-name">
            <span class="item-no">{{ noMark(r.item_no ?? 0) }}</span>{{ itemLabel(r) }}
          </span>
          <span class="item-cnt" :class="{ nz: r.missing.length }">{{ r.missing.length }} 人未交</span>
        </button>
        <button v-if="!currentRec" class="item-tab on ghost" :class="{ unnamed: !title.trim() }">
          <span class="item-name">
            <span class="item-no">{{ noMark(itemNo) }}</span>{{ title.trim() || '未命名' }}
          </span>
          <span class="item-cnt">未保存</span>
        </button>
      </div>
      <p v-if="items.length" class="foot-note" style="margin-top: 8px">
        当前登记：
        <b>{{ currentRec ? itemLabel(currentRec) : '新的一项（填好内容后保存创建）' }}</b>
      </p>
    </div>

    <div class="surname">
      <button :class="{ on: !surname }" @click="surname = ''">全部</button>
      <button
        v-for="[letter, count] in surnameBar"
        :key="letter"
        :class="{ on: surname === letter }"
        @click="surname = surname === letter ? '' : letter"
      >
        <b>{{ letter }}</b><small>{{ count }}</small>
      </button>
    </div>

    <div class="card pad">
      <div class="sgrid">
        <button
          v-for="s in filteredStudents"
          :key="s.id"
          class="stu"
          :class="{ miss: missing.has(s.id) }"
          @click="toggle(s.id)"
        >
          {{ s.name }}
        </button>
      </div>
    </div>
    <p class="foot-note">
      已选 {{ missing.size }} 人未交。点姓名切换状态，
      <a class="lnk" @click="markAllPresent">一键全部交齐</a> ·
      <a class="lnk danger" @click="deleteCurrent">删除当前项</a>
      <button class="btn primary save-btn" @click="saveMiss">保存</button>
    </p>

    <div class="card toolbar" style="margin-top: 14px">
      <input v-model="rangeFrom" type="date" />
      <span class="to">至</span>
      <input v-model="rangeTo" type="date" />
      <button class="mini" @click="rangeFrom = dayjs().startOf('month').format('YYYY-MM-DD'); rangeTo = dk()">本月</button>
      <button class="mini" @click="rangeFrom = dk(dayjs().subtract(6, 'day')); rangeTo = dk()">近7天</button>
      <button class="mini" @click="exportMiss">导出</button>
    </div>

    <div class="card tablecard">
      <div class="table-scroll">
      <table class="stats">
        <thead>
          <tr><th class="c-idx">#</th><th class="c-name">姓名</th><th class="c-count">未交次数</th><th class="c-detail">未交明细</th></tr>
        </thead>
        <tbody>
          <tr v-for="(s, i) in perStudent" :key="s.id">
            <td class="idx">{{ i + 1 }}</td>
            <td class="name">{{ s.name }}</td>
            <td :class="{ nz: s.count }">{{ s.count || '' }}</td>
            <td class="vio">{{ s.detail.join('；') }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <div class="card pad" style="margin-top: 12px">
      <h3 class="sec-title">区间作业记录 <em>{{ rangeRecords.filter((r) => !r.deleted).length }}</em></h3>
      <div v-if="rangeRecords.filter((r) => !r.deleted).length" class="rec-list">
        <div
          v-for="r in rangeRecords.filter((x) => !x.deleted)"
          :key="r.day + r.subject + (r.item_no ?? 0)"
          class="rec-row"
        >
          <div class="rec-main">
            <b class="num">{{ r.day }}</b> · <b>{{ r.subject }}</b>
            <!-- 多项时才需要圈码区分；内容在前，序号只做辅助 -->
            <span v-if="multiSubjects.has(r.subject + '@' + r.day)" class="rec-item-no">{{ noMark(r.item_no ?? 0) }}</span>
            <span v-if="r.title" class="rec-title">{{ r.title }}</span>
            <span v-else class="rec-title faint">（未命名）</span>
            <span class="rec-missing">未交：{{ missNames(r.missing) }}</span>
          </div>
          <div class="rec-acts">
            <button class="gmini" @click="loadMiss(r)">载入</button>
            <button v-if="!isStudent" class="gmini danger" @click="deleteMiss(r)">删除</button>
          </div>
        </div>
      </div>
      <p v-else class="empty">该区间没有作业记录</p>
    </div>
  </template>

  <!-- ======== 作业布置（学生为只读视图） ======== -->
  <template v-else-if="sub === 'task'">
    <div class="card toolbar">
      <input v-model="taskDay" type="date" />
      <button class="mini" @click="taskDay = dk()">今天</button>
    </div>

    <div class="card pad">
      <div class="surname" style="padding-top: 0">
        <button
          v-for="s in subjects"
          :key="s"
          :class="{ on: taskSubject === s }"
          @click="taskSubject = s"
        >
          {{ s }}
        </button>
      </div>
      <textarea
        v-model="taskContent"
        placeholder="选择科目，填写当天作业内容，如：《练习册》P32 第1-8题…"
        maxlength="300"
      ></textarea>
      <div class="task-acts">
        <button class="btn primary" style="flex: 1" @click="saveTask">保存本科目作业</button>
        <button class="mini danger" @click="taskContent = ''; saveTask()">清空本科目</button>
      </div>
    </div>
    <p class="foot-note">按日期 × 科目保存；内容清空后保存即删除该科作业。值日生可代老师布置，操作记为「学生」。</p>

    <div class="card" style="margin-top: 12px">
      <div class="pad">
        <h3 class="sec-title">当日作业一览 <em>{{ dayTasks.length }}</em></h3>
        <div v-if="dayTasks.length" class="daylist">
          <div v-for="t in dayTasks" :key="t.subject" class="dayitem">
            <b>{{ t.subject }}</b>：{{ t.content }}
          </div>
        </div>
        <p v-else class="empty">当天还没有布置作业</p>
      </div>
    </div>

    <div class="card pad" style="margin-top: 12px">
      <h3 class="sec-title">区间作业记录 <em>{{ rangeTasks.length }}</em></h3>
      <div v-if="rangeTasks.length" class="rec-list">
        <div v-for="t in rangeTasks" :key="t.day + t.subject" class="rec-row">
          <div class="rec-main">
            <b class="num">{{ t.day }}</b> · <b>{{ t.subject }}</b>：{{ t.content }}
          </div>
          <div class="rec-acts">
            <button v-if="!isStudent" class="gmini" @click="loadTask(t)">载入修改</button>
          </div>
        </div>
      </div>
      <p v-else class="empty">该区间没有布置过作业</p>
    </div>
  </template>

  <!-- ======== 历史作业（按天分组查看区间内布置过的作业） ======== -->
  <template v-if="sub === 'history'">
    <div class="card toolbar">
      <input v-model="histFrom" type="date" />
      <span class="hint">至</span>
      <input v-model="histTo" type="date" />
      <button class="mini" @click="histQuick('7d')">近7天</button>
      <button class="mini" @click="histQuick('30d')">近30天</button>
      <button class="mini" @click="histQuick('month')">本月</button>
    </div>

    <p v-if="histLoading" class="card pad empty">加载中…</p>
    <div v-else-if="histTasks.length" class="hist-list">
      <div v-for="g in histTasks" :key="g.day" class="card pad hist-day">
        <h3 class="sec-title">{{ g.day }} <em>{{ g.weekday }}</em></h3>
        <div v-for="t in g.items" :key="t.subject" class="hist-row">
          <b class="hist-subj">{{ t.subject }}</b>
          <span class="hist-content">{{ t.content || '—' }}</span>
          <div v-if="!isStudent" class="rec-acts">
            <button class="gmini" @click="editHist(t)">编辑</button>
            <button class="gmini danger" @click="deleteHist(t)">删除</button>
          </div>
        </div>
      </div>
      <p class="foot-note" style="margin: 10px 2px 0">
        编辑会跳到「作业布置」并回填对应日期；删除 = 清空该科作业（历史记录保留原软删标记）。
      </p>
    </div>
    <p v-else class="card pad empty">该区间没有布置过作业</p>
    <div v-if="histToast" class="gtoast">{{ histToast }}</div>
  </template>
</template>

<style scoped>
/* tab 样式统一走全局 gseg 分段控件（与考勤/消息/管理一致），这里只保留间距 */
.subbar {
  margin-bottom: 10px;
}
/* ---------- 历史作业 ---------- */
.hist-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hist-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line-soft);
  flex-wrap: wrap;
}
.hist-row:last-child {
  border-bottom: none;
}
.hist-subj {
  color: var(--primary);
  flex: none;
  width: 56px;
}
.hist-content {
  flex: 1;
  min-width: 200px;
  line-height: 1.6;
}
.subbar button.on {
  background: var(--field);
  color: var(--primary);
}
.card {
  background: var(--panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow), var(--glass-inset);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.toolbar input[type='date'] {
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  border: 1px solid var(--line);
  background: var(--field);
  padding: 9px 11px;
  border-radius: 10px;
  outline: none;
}
.subject-sel {
  width: 104px;
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  border: 1px solid var(--line);
  background: var(--field);
  padding: 9px 11px;
  border-radius: 10px;
  outline: none;
  flex: none;
}
.title-in {
  flex: 1;
  min-width: 150px;
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  border: 1px solid var(--line);
  background: var(--field);
  padding: 9px 11px;
  border-radius: 10px;
  outline: none;
}
.mini {
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--field);
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
}
.mini.danger {
  color: var(--absent);
}
.surname {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 2px 8px;
  scrollbar-width: none;
}
.surname::-webkit-scrollbar {
  display: none;
}
.surname button {
  flex: none;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--field);
  font-size: 13px;
  color: var(--muted);
  cursor: pointer;
  font-weight: 600;
}
.surname button b {
  color: var(--text);
}
.surname button small {
  font-size: 10.5px;
  color: var(--faint);
  margin-left: 2px;
}
.surname button.on {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}
.surname button.on b,
.surname button.on small {
  color: var(--on-primary);
}
.pad {
  padding: 14px 16px;
}
.sgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 8px;
}
/* 手机端：登记网格加密（更多列、更小按钮），一屏尽量看全 */
@media (max-width: 860px) {
  .sgrid {
    grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
    gap: 6px;
  }
  .stu {
    padding: 8px 4px;
    font-size: 12.5px;
    border-radius: 8px;
  }
}
.stu {
  padding: 10px 6px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--field);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  transition: 0.12s;
}
.stu.miss {
  background: var(--absent-bg);
  border-color: var(--absent);
  color: var(--absent);
}
.stu:active {
  transform: scale(0.95);
}
.foot-note {
  color: var(--faint);
  font-size: 12px;
  margin: 10px 2px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.lnk {
  color: var(--primary);
  cursor: pointer;
  text-decoration: underline;
}
.lnk.danger {
  color: var(--absent);
}
.save-btn {
  padding: 7px 18px;
  margin-left: auto;
}
.btn {
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--line);
  background: var(--field);
  padding: 9px 14px;
  border-radius: 10px;
  font-weight: 700;
  color: var(--text);
}
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}
.to {
  color: var(--faint);
  font-size: 12.5px;
}
.tablecard {
  overflow: hidden;
}
.stats {
  width: 100%;
  border-collapse: collapse;
}
.stats th {
  background: var(--field);
  color: var(--muted);
  font-size: 12px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
  text-align: center;
  white-space: nowrap;
}
/* 列宽用 class 而不是内联 width：手机端要能覆盖，「未交次数」被挤成竖排就是宽度不够 */
.stats th.c-idx {
  width: 30px;
}
.stats th.c-name {
  width: 88px;
}
.stats th.c-detail {
  text-align: left;
  padding-left: 10px;
}
/* 手机端：列宽收窄，避免「未交次数」被挤成竖排 */
@media (max-width: 860px) {
  .stats th,
  .stats td {
    padding: 7px 4px;
  }
  .stats th.c-idx {
    width: 22px;
  }
  .stats th.c-name {
    width: 62px;
  }
  .stats th.c-count {
    width: 48px;
  }
  .stats td.vio {
    font-size: 12px;
    line-height: 1.5;
  }
}
.stats td {
  padding: 6px;
  border-bottom: 1px solid var(--line-soft);
  text-align: center;
  font-size: 13px;
}
.stats td.idx {
  color: var(--faint);
  font-size: 12px;
}
.stats td.name {
  text-align: left;
  font-weight: 600;
}
.stats td.nz {
  font-weight: 700;
  color: var(--absent);
}
.stats td.vio {
  text-align: left;
  padding-left: 10px;
  color: var(--muted);
  font-size: 12px;
}
textarea {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px;
  outline: none;
  box-sizing: border-box;
}
.task-acts {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}
.sec-title {
  margin: 0 0 8px;
  font-size: 14px;
}
.sec-title em {
  color: var(--faint);
  font-style: normal;
  font-size: 12px;
}
.daylist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dayitem {
  font-size: 13px;
  padding: 8px 10px;
  background: var(--primary-soft);
  border-radius: 8px;
}
.empty {
  color: var(--faint);
  font-size: 12.5px;
}
.rec-list {
  display: flex;
  flex-direction: column;
}
.rec-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 2px;
  border-bottom: 1px solid var(--line-soft);
  flex-wrap: wrap;
}
.rec-main {
  font-size: 13px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 200px;
}
.rec-title {
  color: var(--muted);
  font-size: 12px;
}
.rec-title.faint {
  color: var(--faint);
}
.rec-item-no {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
}
.rec-missing {
  color: var(--absent);
  font-size: 12px;
}
.rec-acts {
  display: flex;
  gap: 6px;
  flex: none;
}

/* ---------- 作业项选择器 ---------- */
.item-bar {
  margin-bottom: 8px;
}
.item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.item-empty {
  color: var(--faint);
  font-size: 12.5px;
  line-height: 1.7;
  margin: 0;
}
.item-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: none;
}
.item-tabs::-webkit-scrollbar {
  display: none;
}
.item-tab {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--field);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: 0.12s;
}
.item-tab.on {
  border-color: var(--primary);
  background: var(--primary-soft);
  box-shadow: 0 0 0 1px var(--primary) inset;
}
.item-tab.ghost {
  border-style: dashed;
}
.item-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  /* 作业名可能很长：超宽时省略，不把选择条撑到屏幕外 */
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item-tab.on .item-name {
  color: var(--primary);
}
/* 圈码：弱化处理，只当序号用，不抢作业名的视觉位置 */
.item-no {
  font-weight: 600;
  color: var(--faint);
  margin-right: 4px;
}
.item-tab.on .item-no {
  color: var(--primary);
}
/* 未命名的项弱化显示，让「该给它起个名字」一眼可见 */
.item-tab.unnamed .item-name {
  color: var(--faint);
  font-weight: 600;
}
.item-cnt {
  font-size: 11px;
  color: var(--faint);
  white-space: nowrap;
}
.item-cnt.nz {
  color: var(--absent);
  font-weight: 700;
}
@media (max-width: 860px) {
  .item-tab {
    padding: 7px 10px;
  }
  .item-name {
    font-size: 12.5px;
    max-width: 150px;
  }
}
</style>
