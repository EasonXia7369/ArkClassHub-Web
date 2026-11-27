<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { get, put } from '@/api'
import { useClassStore } from '@/stores/class'
import { useIdentityStore } from '@/stores/identity'
import { useChatStore } from '@/stores/chat'
import { STATUS_META, SLOT_LABEL, dk, weekdayCn } from '@/utils/dates'
import Icon from '@/components/Icon.vue'
import { pinyinInitial, initialOf } from '@/utils/pinyin'
import { useEscClose } from '@/composables/useEscClose'
import { useUndo } from '@/composables/useUndo'

const props = defineProps<{ classId: number }>()
const store = useClassStore()
const identity = useIdentityStore()
const chat = useChatStore()
const undo = useUndo()

const day = ref(dk())
const records = ref<Map<string, { status: string; note: string }>>(new Map())
const q = ref('')
const surname = ref('')
const loading = ref(false)

// 弹出的标记面板
const pop = ref<{ sid: number; name: string; slot: string } | null>(null)
const popNote = ref('')
const popStatus = ref<string | null>(null)

const SLOTS = ['morning', 'noon', 'evening'] as const

const activeStudents = computed(() => store.students.filter((s) => s.active))

const surnameBar = computed(() => {
  const map = new Map<string, number>()
  for (const s of activeStudents.value) {
    const k = initialOf(s)
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})

const filtered = computed(() => {
  let list = activeStudents.value
  if (surname.value) {
    list = list.filter((s) => initialOf(s) === surname.value)
  }
  const qv = q.value.trim().toLowerCase()
  if (qv) {
    list = list.filter(
      (s) =>
        s.name.includes(qv) ||
        pinyinInitial(s.name).toLowerCase().includes(qv) ||
        [...s.name].some((c) => c.toLowerCase() === qv),
    )
  }
  return list
})

const summary = computed<{ leave: number; late: number; absent: number; violate: number; marked: number; total: number }>(() => {
  const counts = { leave: 0, late: 0, absent: 0, violate: 0 }
  let marked = 0
  for (const s of activeStudents.value) {
    for (const slot of SLOTS) {
      const rec = records.value.get(`${s.id}|${slot}`)
      if (rec) {
        marked++
        if (rec.status in counts) counts[rec.status as keyof typeof counts]++
      }
    }
  }
  return { ...counts, marked, total: activeStudents.value.length * 3 }
})

const cellOf = (sid: number, slot: string) => records.value.get(`${sid}|${slot}`)

async function load() {
  loading.value = true
  try {
    const res = await get<{ records: any[] }>(
      `/api/classes/${props.classId}/attendance?day=${day.value}`,
    )
    const map = new Map<string, { status: string; note: string }>()
    for (const r of res.records) {
      map.set(`${r.student_id}|${r.slot}`, { status: r.status, note: r.note })
    }
    records.value = map
  } finally {
    loading.value = false
  }
}

watch([day, props.classId], load, { immediate: true })
// 其他端变更考勤 → 自动刷新
watch(() => chat.refreshTick, () => load())

function shiftDay(n: number) {
  day.value = dk(dayjs(day.value).add(n, 'day'))
}

function openPop(sid: number, name: string, slot: string) {
  pop.value = { sid, name, slot }
  popStatus.value = records.value.get(`${sid}|${slot}`)?.status ?? null
  popNote.value = records.value.get(`${sid}|${slot}`)?.note ?? ''
}

async function mark(status: string) {
  if (!pop.value) return
  popStatus.value = status
  // 出勤（清格）直接落库，其余等备注确认？——与旧版一致：点选即保存
  await saveEntry(status, popNote.value)
}

async function saveNote() {
  if (!pop.value || !popStatus.value) return
  await saveEntry(popStatus.value, popNote.value)
  pop.value = null
}

async function clearCell() {
  if (!pop.value) return
  const cid = props.classId
  const d = day.value
  const { sid, slot, name } = pop.value
  // 清格 = 服务端删记录（status: 'present'）；撤销就是把原状态写回
  const prev = records.value.get(`${sid}|${slot}`)
  records.value.delete(`${sid}|${slot}`)
  await put(`/api/classes/${cid}/attendance`, {
    day: d,
    entries: [{ student_id: sid, slot, status: 'present' }],
  })
  pop.value = null

  if (prev) {
    const prevStatus = prev.status
    const prevNote = prev.note
    undo.push({
      label: `${d} ${name} · ${SLOT_LABEL[slot]} 清除标记`,
      kind: 'attendance',
      reload: load,
      undo: () =>
        put(`/api/classes/${cid}/attendance`, {
          day: d,
          entries: [{ student_id: sid, slot, status: prevStatus, note: prevNote }],
        }),
    })
  }
}

async function saveEntry(status: string, note: string) {
  if (!pop.value) return
  const cid = props.classId
  const d = day.value
  const { sid, slot, name } = pop.value
  // 记录旧值：撤销时原样写回；此前没有记录就用 present（服务端会把该格删掉）
  const prev = records.value.get(`${sid}|${slot}`)
  await put(`/api/classes/${cid}/attendance`, {
    day: d,
    actor_student_id: identity.studentId ?? undefined,
    entries: [{ student_id: sid, slot, status, note }],
  })
  if (status === 'present') {
    records.value.delete(`${sid}|${slot}`)
  } else {
    records.value.set(`${sid}|${slot}`, { status, note })
  }

  const label = `${d} ${name} · ${SLOT_LABEL[slot]} ${STATUS_META[status]?.label ?? status}`
  if (prev?.status === status && (prev?.note ?? '') === note) return // 值没变，不必进撤销栈
  undo.push({
    label,
    kind: 'attendance',
    reload: load,
    undo: () =>
      put(`/api/classes/${cid}/attendance`, {
        day: d,
        entries: [
          {
            student_id: sid,
            slot,
            status: prev?.status ?? 'present',
            note: prev?.note ?? '',
          },
        ],
      }),
  })
}

useEscClose(pop, () => (pop.value = null))
</script>

<template>
  <div class="toolbar card">
    <div class="datebar">
      <button class="nav" @click="shiftDay(-1)">‹</button>
      <label class="datewrap">
        <span>{{ day }} {{ weekdayCn(day) }}</span>
        <input v-model="day" type="date" />
      </label>
      <button class="nav" @click="shiftDay(1)">›</button>
      <button class="mini" @click="day = dk()">今天</button>
    </div>
    <input v-model="q" type="search" placeholder="搜姓名 / 拼音首字母" />
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

  <div class="chips">
    <span class="chip ok">出勤 {{ summary.total - summary.marked }}</span>
    <span class="chip leave">请假 {{ summary.leave }}</span>
    <span class="chip late">迟到 {{ summary.late }}</span>
    <span class="chip absent">旷课 {{ summary.absent }}</span>
    <span class="chip violate">违纪 {{ summary.violate }}</span>
  </div>

  <div class="card tablecard">
    <div class="table-scroll">
    <table class="roster">
      <thead>
        <tr>
          <th style="width: 32px">#</th>
          <th style="width: 92px">姓名</th>
          <th v-for="slot in SLOTS" :key="slot">{{ SLOT_LABEL[slot] }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(s, i) in filtered" :key="s.id">
          <td class="idx">{{ i + 1 }}</td>
          <td class="name">{{ s.name }}</td>
          <td v-for="slot in SLOTS" :key="slot">
            <button
              class="cell"
              :class="cellOf(s.id, slot)?.status"
              :title="cellOf(s.id, slot)?.note || ''"
              @click="openPop(s.id, s.name, slot)"
            >
              <Icon
                v-if="cellOf(s.id, slot)"
                :name="STATUS_META[cellOf(s.id, slot)!.status]?.icon ?? 'check'"
                :size="15"
              />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  </div>
  <p class="foot-note">
    点格子标记：空白格＝出勤，其余按图标区分请假、迟到、旷课、违纪；标记后可顺手写备注。
  </p>

  <!-- 标记面板 -->
  <Teleport to="body">
    <div v-if="pop" class="pop-backdrop" @click.self="pop = null">
      <div class="pop">
        <div class="pop-title">{{ pop.name }} · {{ SLOT_LABEL[pop.slot] }} · {{ day }}</div>
        <div class="pop-opts">
          <button
            v-for="(meta, st) in STATUS_META"
            :key="st"
            :class="['b-' + st, { sel: popStatus === st }]"
            @click="mark(st)"
          >
            <Icon :name="meta.icon" :size="15" /> {{ meta.label }}
          </button>
        </div>
        <input
          v-model="popNote"
          type="text"
          placeholder="备注：违纪情况 / 请假原因…"
          maxlength="60"
          @keyup.enter="saveNote"
        />
        <div class="pop-foot">
          <span class="hint">点空白处关闭</span>
          <button class="warn" @click="clearCell">清除本格</button>
          <button class="btn primary" @click="saveNote">保存备注</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
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
.datebar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.nav {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--field);
  font-size: 17px;
  color: var(--muted);
  cursor: pointer;
}
.datewrap {
  position: relative;
  flex: 1 1 auto;
  min-width: 132px;
}
.datewrap span {
  display: block;
  text-align: center;
  white-space: nowrap;
  font-weight: 700;
  font-size: 14.5px;
  padding: 8px 4px;
  background: var(--field);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.datewrap input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  border: none;
  padding: 0;
}
input[type='search'] {
  width: 150px;
  flex: none;
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  border: 1px solid var(--line);
  background: var(--field);
  padding: 9px 11px;
  border-radius: 10px;
  outline: none;
}
/* 手机端：日期导航与搜索框分两行，避免压缩重叠 */
@media (max-width: 860px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  .datebar {
    flex: none;
  }
  .datewrap {
    flex: 1 1 auto;
  }
  input[type='search'] {
    width: 100%;
  }
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
  white-space: nowrap;
  font-weight: 600;
  cursor: pointer;
}
.surname button b {
  font-weight: 700;
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
  opacity: 0.85;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.chip {
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}
.chip.ok {
  background: var(--present-bg);
  color: var(--present);
}
.chip.leave {
  background: var(--leave-bg);
  color: var(--leave);
}
.chip.late {
  background: var(--late-bg);
  color: var(--late);
}
.chip.absent {
  background: var(--absent-bg);
  color: var(--absent);
}
.chip.violate {
  background: var(--violate-bg);
  color: var(--violate);
}
.tablecard {
  overflow: hidden;
}
.roster {
  width: 100%;
  border-collapse: collapse;
}
.roster th {
  position: sticky;
  top: 0;
  background: var(--field);
  color: var(--muted);
  font-size: 12px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
  z-index: 1;
}
.roster td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--line-soft);
  text-align: center;
}
.roster td.idx {
  color: var(--faint);
  font-size: 12px;
}
.roster td.name {
  text-align: left;
  font-weight: 600;
  font-size: 13.5px;
}
.cell {
  width: 42px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--field);
  cursor: pointer;
  transition: 0.12s;
  /* 图标居中：原来用文本符号靠 line-height 对齐，换矢量图标后要显式居中 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--muted);
}
.cell:active {
  transform: scale(0.94);
}
.cell.leave {
  background: var(--leave-bg);
  border-color: var(--leave);
  color: var(--leave);
}
/* 出勤原来靠「留空」表示，改图标后需要一个明确的绿勾状态 */
.cell.present {
  background: var(--present-bg);
  border-color: var(--present);
  color: var(--present);
}
.cell.late {
  background: var(--late-bg);
  border-color: var(--late);
  color: var(--late);
}
.cell.absent {
  background: var(--absent-bg);
  border-color: var(--absent);
  color: var(--absent);
}
.cell.violate {
  background: var(--violate-bg);
  border-color: var(--violate);
  color: var(--violate);
}
.foot-note {
  color: var(--faint);
  font-size: 12px;
  margin: 10px 2px 0;
}
.pop-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 16px;
}
.pop {
  width: min(340px, 94vw);
  background: var(--panel-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-radius: 16px;
  box-shadow: 0 12px 40px -8px rgba(16, 24, 40, 0.35);
  padding: 16px;
}
.pop-title {
  font-weight: 700;
  font-size: 14.5px;
  margin-bottom: 12px;
}
.pop-opts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.pop-opts button {
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--line);
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  background: var(--field);
  /* 图标 + 文字：原来只有文字，加图标后要对齐 */
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.b-present {
  color: var(--present);
}
.b-leave {
  color: var(--leave);
}
.b-late {
  color: var(--late);
}
.b-absent {
  color: var(--absent);
}
.b-violate {
  color: var(--violate);
}
.pop-opts button.sel {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}
.pop input {
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 13.5px;
  border: 1px solid var(--line);
  padding: 9px 11px;
  border-radius: 10px;
  outline: none;
}
.pop-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.pop-foot .hint {
  color: var(--faint);
  font-size: 11.5px;
  flex: 1;
}
.pop-foot .warn {
  color: var(--absent);
  font-size: 12.5px;
  font-weight: 700;
  background: none;
  border: none;
  cursor: pointer;
}
.btn.primary {
  background: var(--primary);
  border: none;
  color: var(--on-primary);
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
</style>
