<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { get, put } from '@/api'
import { useClassStore } from '@/stores/class'
import { useChatStore } from '@/stores/chat'
import { useEscClose } from '@/composables/useEscClose'

const props = defineProps<{ classId: number }>()
const store = useClassStore()
const chat = useChatStore()

interface Member {
  student_id: number
  name: string
  role: string
}

const weekStart = ref(dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD')) // dayjs startOf week 是周日
const days = ref<Array<{ weekday: number; members: Member[] }>>([])
const editing = ref<number | null>(null) // 正在编辑的 weekday
const picked = ref<Set<number>>(new Set())
const roleDraft = ref<Record<number, string>>({})

const WD = ['一', '二', '三', '四', '五', '六', '日']
const todayWd = computed(() => {
  const d = dayjs().day()
  return d === 0 ? 7 : d
})

function dayLabel(weekday: number, i: number) {
  const date = dayjs(weekStart.value).add(i, 'day')
  return `周${WD[weekday - 1]} ${date.format('MM-DD')}`
}

async function load() {
  const res = await get<any>(
    `/api/classes/${props.classId}/duty?week=${weekStart.value}`,
  )
  days.value = res.days
  editing.value = null
}

watch([weekStart, props.classId], load, { immediate: true })
// 其他端变更值日表 → 自动刷新
watch(() => chat.refreshTick, () => load())

function shiftWeek(n: number) {
  weekStart.value = dayjs(weekStart.value).add(n * 7, 'day').format('YYYY-MM-DD')
}

function openEdit(weekday: number, members: Member[]) {
  editing.value = weekday
  picked.value = new Set(members.map((m) => m.student_id))
  roleDraft.value = Object.fromEntries(members.map((m) => [m.student_id, m.role]))
}

function toggle(sid: number) {
  const next = new Set(picked.value)
  if (next.has(sid)) {
    next.delete(sid)
    delete roleDraft.value[sid]
  } else {
    next.add(sid)
    roleDraft.value[sid] = ''
  }
  picked.value = next
}

async function saveEdit() {
  if (editing.value === null) return
  const members = [...picked.value].map((sid) => ({
    student_id: sid,
    role: roleDraft.value[sid] ?? '',
  }))
  await put(`/api/classes/${props.classId}/duty`, {
    week_start: weekStart.value,
    weekday: editing.value,
    members,
  })
  await load()
}

function cancelEdit() {
  editing.value = null
}

useEscClose(editing, cancelEdit)
</script>

<template>
  <div class="toolbar card">
    <button class="nav" @click="shiftWeek(-1)">‹</button>
    <span class="week-label">{{ weekStart }} 那周（{{ dayjs(weekStart).format('MM-DD') }} ~ {{ dayjs(weekStart).add(6, 'day').format('MM-DD') }}）</span>
    <button class="nav" @click="shiftWeek(1)">›</button>
    <button class="mini" @click="weekStart = dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD')">本周</button>
  </div>
  <p class="foot-note" style="margin: 0 0 8px">点某一天安排值日生；值日生当天在一体机上登记考勤和作业。</p>

  <div class="dutygrid">
    <div
      v-for="(d, i) in days"
      :key="d.weekday"
      class="daycard card"
      :class="{ today: d.weekday === todayWd }"
    >
      <div class="dayhead" @click="openEdit(d.weekday, d.members)">
        <b>{{ dayLabel(d.weekday, i) }}</b>
        <span v-if="d.weekday === todayWd" class="today-badge">今天</span>
        <span class="edit-hint">✎</span>
      </div>
      <div v-if="d.members.length" class="members">
        <span v-for="m in d.members" :key="m.student_id" class="member">
          {{ m.name }}<i v-if="m.role">{{ m.role }}</i>
        </span>
      </div>
      <p v-else class="none">未安排</p>
    </div>
  </div>

  <!-- 编辑面板 -->
  <Teleport to="body">
    <div v-if="editing !== null" class="pop-backdrop" @click.self="cancelEdit">
      <div class="pop">
        <div class="pop-title">
          安排值日 · {{ weekStart }} 周{{ WD[editing - 1] }}
        </div>
        <div class="sgrid">
          <button
            v-for="s in store.students.filter((x) => x.active)"
            :key="s.id"
            class="stu"
            :class="{ pick: picked.has(s.id) }"
            @click="toggle(s.id)"
          >
            {{ s.name }}
            <input
              v-if="picked.has(s.id)"
              v-model="roleDraft[s.id]"
              class="role"
              placeholder="职责"
              maxlength="8"
              @click.stop
            />
          </button>
        </div>
        <div class="pop-acts">
          <button class="btn" @click="cancelEdit">取消</button>
          <button class="btn primary" @click="saveEdit">保存（{{ picked.size }} 人）</button>
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
.nav {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--field);
  font-size: 17px;
  color: var(--muted);
  cursor: pointer;
  flex: none;
}
.week-label {
  flex: 1;
  text-align: center;
  font-weight: 700;
  font-size: 14.5px;
  padding: 8px 4px;
  background: var(--field);
  border: 1px solid var(--line);
  border-radius: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mini {
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--field);
  font-size: 12.5px;
  color: var(--muted);
  cursor: pointer;
  flex: none;
}
.dutygrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.daycard {
  padding: 10px 12px;
  min-height: 90px;
}
.daycard.today {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-soft);
}
.dayhead {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13.5px;
}
.edit-hint {
  margin-left: auto;
  color: var(--faint);
  font-size: 12px;
}
.today-badge {
  background: var(--primary);
  color: var(--on-primary);
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 999px;
  font-weight: 700;
}
.members {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.member {
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.member i {
  font-style: normal;
  font-size: 10.5px;
  opacity: 0.75;
  font-weight: 600;
}
.none {
  margin: 10px 0 0;
  color: var(--faint);
  font-size: 12px;
}
.foot-note {
  color: var(--faint);
  font-size: 12px;
  margin: 8px 2px;
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
  width: min(560px, 94vw);
  max-height: 84vh;
  overflow: auto;
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
.sgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
}
.stu {
  padding: 8px 6px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--field);
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: stretch;
}
.stu.pick {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
}
.role {
  font-family: inherit;
  font-size: 11.5px;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 3px 6px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.pop-acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
.btn {
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--line);
  background: var(--field);
  padding: 9px 16px;
  border-radius: 10px;
  font-weight: 700;
}
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}
</style>
