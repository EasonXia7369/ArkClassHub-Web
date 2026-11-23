<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { get, post, put } from '@/api'

/**
 * 校管理员（role=admin + 所属学校）：本校教师/年级/班级/年级主任一站式管理。
 * 平台超管的全局管理在「账号/邀请码/学校」板块。
 */

interface Teacher {
  id: number
  name: string
  created_at: string
  class_count: number
}
interface Grade {
  id: number
  name: string
  sort: number
  class_count: number
  directors: string | null
  /** 现有主任的教师 id（逗号分隔）：编辑器回显用，缺失会导致一保存就清空全部主任 */
  director_ids?: string | null
}
interface SchoolClass {
  id: number
  name: string
  grade_id: number | null
  grade_name: string | null
  teacher_name: string
  student_count: number
}

const school = ref<{ id: number; name: string } | null>(null)
const teachers = ref<Teacher[]>([])
const grades = ref<Grade[]>([])
const classes = ref<SchoolClass[]>([])
const toastMsg = ref('')

/* 建教师 */
const newTName = ref('')
const newTPass = ref('')

/* 建年级 */
const newGradeName = ref('')

/* 建班 */
const newClsName = ref('')
const newClsGrade = ref<number | null>(null)
const newClsTeacher = ref<number | null>(null)

/* 年级主任编辑 */
const dirEditing = ref<number | null>(null)
const dirPicks = ref<Set<number>>(new Set())

/* 邀请码 */
interface Invite {
  code: string
  role: string
  used_at: string | null
  expires_at: string
  used_by_name: string | null
}
const invites = ref<Invite[]>([])

function toast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => (toastMsg.value = ''), 2600)
}

async function load() {
  const res = await get<{
    school: { id: number; name: string }
    teachers: Teacher[]
    grades: Grade[]
    classes: SchoolClass[]
  }>('/api/school/overview')
  school.value = res.school
  teachers.value = res.teachers
  grades.value = res.grades
  classes.value = res.classes
  invites.value = (await get<{ invites: Invite[] }>('/api/school/invites')).invites
}

async function genInvite() {
  try {
    const res = await post<{ code: string }>('/api/school/invites', { role: 'teacher' })
    toast(`邀请码 ${res.code} 已生成（教师激活后加入本校）`)
    await load()
  } catch (e: any) {
    toast(e.message)
  }
}

async function createTeacher() {
  try {
    const res = await post<{ user: { name: string } }>('/api/school/teachers', {
      name: newTName.value.trim(),
      password: newTPass.value,
    })
    toast(`教师「${res.user.name}」已创建`)
    newTName.value = ''
    newTPass.value = ''
    await load()
  } catch (e: any) {
    toast(e.message)
  }
}

async function createGrade() {
  try {
    await post('/api/school/grades', { name: newGradeName.value.trim() })
    toast('年级已创建')
    newGradeName.value = ''
    await load()
  } catch (e: any) {
    toast(e.message)
  }
}

async function createClass() {
  try {
    await post('/api/school/classes', {
      name: newClsName.value.trim(),
      grade_id: newClsGrade.value ?? undefined,
      teacher_id: newClsTeacher.value,
    })
    toast('班级已创建')
    newClsName.value = ''
    newClsGrade.value = null
    newClsTeacher.value = null
    await load()
  } catch (e: any) {
    toast(e.message)
  }
}

function startDirectors(g: Grade) {
  dirEditing.value = g.id
  // 回显现有主任：director_ids 是逗号分隔的教师 id 串（服务端 GROUP_CONCAT）。
  // 空/缺失视为「暂无主任」，而非「清空后重建」——否则每次保存都会抹掉已有指派。
  const ids = (g.director_ids ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  dirPicks.value = new Set(ids)
}

async function saveDirectors(g: Grade) {
  try {
    await put(`/api/school/grades/${g.id}/directors`, { user_ids: [...dirPicks.value] })
    toast(`「${g.name}」年级主任已更新`)
    dirEditing.value = null
    await load()
  } catch (e: any) {
    toast(e.message)
  }
}

onMounted(load)
</script>

<template>
  <div>
    <div class="glass pad" style="margin-bottom: 14px">
      <h3 class="sec-title" style="margin: 0 0 4px">{{ school?.name }} · 学校管理</h3>
      <p class="foot-note" style="margin: 0">
        教师 {{ teachers.length }} 人 · 年级 {{ grades.length }} 个 · 班级 {{ classes.length }} 个。年级主任为只读汇总权限。
      </p>
    </div>

    <!-- 教师 -->
    <div class="glass pad" style="margin-bottom: 14px">
      <h3 class="sec-title">教师账号</h3>
      <div class="acct-list">
        <div v-for="t in teachers" :key="t.id" class="acct-row">
          <b>{{ t.name }}</b>
          <span class="foot-note">{{ t.class_count }} 个班</span>
        </div>
        <p v-if="!teachers.length" class="foot-note" style="margin: 0">还没有教师账号</p>
      </div>
      <div class="row" style="margin-top: 10px">
        <input v-model="newTName" class="ginput" placeholder="教师姓名" maxlength="20" style="flex: 1" />
        <input v-model="newTPass" class="ginput" placeholder="初始密码（≥4位）" maxlength="30" style="width: 140px" />
        <button class="gbtn" :disabled="!newTName.trim() || newTPass.length < 4" @click="createTeacher">创建</button>
      </div>
    </div>

    <!-- 年级与主任 -->
    <div class="glass pad" style="margin-bottom: 14px">
      <h3 class="sec-title">年级与年级主任</h3>
      <div v-for="g in grades" :key="g.id" class="grade-row">
        <div class="grade-head">
          <b>{{ g.name }}</b>
          <span class="foot-note">{{ g.class_count }} 个班 · 主任：{{ g.directors || '未指派' }}</span>
          <button class="gmini" style="margin-left: auto" @click="startDirectors(g)">
            {{ dirEditing === g.id ? '取消' : '指派主任' }}
          </button>
        </div>
        <div v-if="dirEditing === g.id">
          <div class="dir-grid">
            <button
              v-for="t in teachers"
              :key="t.id"
              class="gmini"
              :class="{ on: dirPicks.has(t.id) }"
              @click="dirPicks.has(t.id) ? dirPicks.delete(t.id) : dirPicks.add(t.id)"
            >{{ t.name }}</button>
          </div>
          <div style="display: flex; justify-content: flex-end; margin-top: 8px">
            <button class="gbtn primary gmini-size" @click="saveDirectors(g)">保存（{{ dirPicks.size }} 人）</button>
          </div>
        </div>
      </div>
      <p v-if="!grades.length" class="foot-note" style="margin: 0 0 8px">还没有年级，先在下方创建。</p>
      <div class="row" style="margin-top: 8px">
        <input v-model="newGradeName" class="ginput" placeholder="年级名称，如：高二" maxlength="20" style="flex: 1" />
        <button class="gbtn" :disabled="!newGradeName.trim()" @click="createGrade">创建年级</button>
      </div>
    </div>

    <!-- 班级 -->
    <div class="glass pad" style="margin-bottom: 14px">
      <h3 class="sec-title">班级</h3>
      <div class="acct-list">
        <div v-for="cl in classes" :key="cl.id" class="acct-row">
          <b>{{ cl.name }}</b>
          <span class="foot-note">{{ cl.grade_name || '未分组' }} · 班主任 {{ cl.teacher_name }} · {{ cl.student_count }} 名学生</span>
        </div>
        <p v-if="!classes.length" class="foot-note" style="margin: 0">还没有班级</p>
      </div>
      <div class="row" style="margin-top: 10px; flex-wrap: wrap">
        <input v-model="newClsName" class="ginput" placeholder="班级名称" maxlength="20" style="flex: 1; min-width: 120px" />
        <select v-model.number="newClsGrade" class="gselect" style="width: auto">
          <option :value="null" disabled>年级（可选）</option>
          <option v-for="g in grades" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>
        <select v-model.number="newClsTeacher" class="gselect" style="width: auto">
          <option :value="null" disabled>班主任</option>
          <option v-for="t in teachers" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
        <button
          class="gbtn"
          :disabled="!newClsName.trim() || !newClsTeacher"
          @click="createClass"
        >创建班级</button>
      </div>
    </div>

    <!-- 邀请码 -->
    <div class="glass pad">
      <h3 class="sec-title">教师邀请码</h3>
      <p class="foot-note" style="margin: 0 0 8px">教师凭邀请码自行激活，激活后加入本校。有效期 30 天。</p>
      <button class="gbtn primary" @click="genInvite">生成邀请码</button>
      <div class="acct-list" style="margin-top: 10px">
        <div v-for="i in invites" :key="i.code" class="acct-row">
          <b class="num">{{ i.code }}</b>
          <span class="foot-note">
            {{ i.used_at ? `已使用（${i.used_by_name ?? '?'}）` : `有效至 ${i.expires_at.slice(0, 10)}` }}
          </span>
        </div>
        <p v-if="!invites.length" class="foot-note" style="margin: 0">还没有生成过邀请码</p>
      </div>
    </div>

    <div v-if="toastMsg" class="gtoast">{{ toastMsg }}</div>
  </div>
</template>

<style scoped>
.acct-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.acct-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  background: var(--field);
  border-radius: 8px;
  font-size: 13.5px;
}
.grade-row {
  padding: 8px 0;
  border-bottom: 1px solid var(--line-soft);
}
.grade-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dir-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
  gap: 6px;
  margin-top: 8px;
}
.dir-grid .gmini.on {
  background: var(--primary-soft);
  border-color: transparent;
  color: var(--primary);
}
.gmini-size {
  padding: 6px 12px;
  font-size: 12.5px;
}
</style>
