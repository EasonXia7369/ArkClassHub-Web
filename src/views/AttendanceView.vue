<script setup lang="ts">
import { computed, ref } from 'vue'
import { post } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { useClassStore } from '@/stores/class'
import { dk } from '@/utils/dates'
import AttendanceBoard from '@/components/AttendanceBoard.vue'
import StatsBoard from '@/components/StatsBoard.vue'
import LeavesBoard from '@/components/LeavesBoard.vue'
import WeeklyReportBoard from '@/components/WeeklyReportBoard.vue'
import { useEscClose } from '@/composables/useEscClose'

const auth = useAuthStore()
const store = useClassStore()

const isStudent = computed(() => auth.user?.role === 'student')
const sub = ref<'daily' | 'stats' | 'leaves' | 'report'>('daily')

/* 学生：申请请假（老师审批后生效） */
const showApply = ref(false)
const applySid = ref<number | null>(null)
const applyFrom = ref(dk())
const applyTo = ref(dk())
const applyReason = ref('')
const applyError = ref('')
const busy = ref(false)

async function submitApply() {
  applyError.value = ''
  if (!applySid.value) {
    applyError.value = '请选择请假的学生'
    return
  }
  if (applyFrom.value > applyTo.value) {
    applyError.value = '开始日期不能晚于结束日期'
    return
  }
  busy.value = true
  try {
    await post(`/api/classes/${store.current!.id}/leaves`, {
      student_id: applySid.value,
      from_day: applyFrom.value,
      to_day: applyTo.value,
      reason: applyReason.value,
    })
    showApply.value = false
    applyReason.value = ''
    alert('请假申请已提交，等老师审批后自动计入考勤。')
  } catch (e: any) {
    applyError.value = e.message
  } finally {
    busy.value = false
  }
}

useEscClose(showApply, () => (showApply.value = false))
</script>

<template>
  <div v-if="!isStudent" class="gseg" style="margin-bottom: 12px">
    <button :class="{ on: sub === 'daily' }" @click="sub = 'daily'">每日登记</button>
    <button :class="{ on: sub === 'stats' }" @click="sub = 'stats'">月度统计</button>
    <button :class="{ on: sub === 'leaves' }" @click="sub = 'leaves'">请假</button>
    <button :class="{ on: sub === 'report' }" @click="sub = 'report'">周报</button>
  </div>
  <div v-else class="glass" style="padding: 12px 16px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
    <div style="flex: 1; min-width: 200px">
      <span style="font-size: 13.5px; font-weight: 700">今日登记</span>
      <span class="foot-note" style="margin-left: 8px">点格子标记出勤状态，登记后会记录为「学生」操作。</span>
    </div>
    <button class="gbtn" :disabled="!store.current" @click="showApply = true">申请请假</button>
  </div>

  <template v-if="store.current">
    <AttendanceBoard v-if="sub === 'daily'" :class-id="store.current.id" />
    <StatsBoard v-else-if="sub === 'stats'" :class-id="store.current.id" />
    <LeavesBoard v-else-if="sub === 'leaves'" :class-id="store.current.id" />
    <WeeklyReportBoard v-else :class-id="store.current.id" />
  </template>
  <p v-else class="foot-note">正在加载班级信息…</p>

  <!-- 学生请假申请 -->
  <Teleport to="body">
    <div v-if="showApply" class="gbackdrop" @click.self="showApply = false">
      <div class="gpop">
        <h3 class="sec-title">申请请假</h3>
        <p class="foot-note" style="margin: 0 0 10px">提交后等班主任审批；批准后会自动在起止日期内计入请假。</p>
        <select v-model.number="applySid" class="gselect" style="width: 100%">
          <option :value="null" disabled>请假学生</option>
          <option v-for="s in store.students.filter((x) => x.active)" :key="s.id" :value="s.id">
            {{ s.name }}
          </option>
        </select>
        <div class="row" style="margin-top: 10px; flex-wrap: wrap">
          <input v-model="applyFrom" class="ginput" type="date" />
          <span class="foot-note">至</span>
          <input v-model="applyTo" class="ginput" type="date" />
        </div>
        <input
          v-model="applyReason"
          class="ginput"
          style="width: 100%; margin-top: 10px"
          placeholder="事由：感冒发烧 / 家中有事…"
          maxlength="60"
        />
        <p v-if="applyError" class="err" style="margin: 8px 0 0">{{ applyError }}</p>
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px">
          <button class="gbtn" @click="showApply = false">取消</button>
          <button class="gbtn primary" :disabled="busy" @click="submitApply">提交申请</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
