<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { get } from '@/api'
import { useClassStore } from '@/stores/class'
import { exportXlsx } from '@/utils/xlsx'
import { SLOT_LABEL, weekdayCn } from '@/utils/dates'

const props = defineProps<{ classId: number }>()
const store = useClassStore()

const month = ref(dayjs().format('YYYY-MM'))
const mode = ref<'day' | 'time'>('day')
const sortKey = ref<string | null>(null)
const sortDir = ref(-1)
const data = ref<any>(null)
const className = computed(() => store.current?.name ?? '班级')

const CNT = ['leave', 'late', 'absent', 'violate'] as const

async function load() {
  const res = await get<any>(
    `/api/classes/${props.classId}/attendance/stats?month=${month.value}&mode=${mode.value}`,
  )
  data.value = res
}

watch([month, mode, props.classId], load, { immediate: true })

const sortedStats = computed(() => {
  if (!data.value) return []
  const list = [...data.value.stats]
  if (sortKey.value) {
    const k = sortKey.value
    list.sort((a, b) => (a[k] - b[k]) * sortDir.value)
  }
  return list
})

function setSort(k: string) {
  if (sortKey.value === k) sortDir.value *= -1
  else {
    sortKey.value = k
    sortDir.value = -1
  }
}

const violationText = computed(() => {
  if (!data.value) return new Map<number, string>()
  const map = new Map<number, string>()
  for (const v of data.value.violations) {
    const stu = data.value.stats.find((s: any) => s.name === v.name)
    if (!stu) continue
    const line = `${v.day} ${SLOT_LABEL[v.slot]}${v.note ? ' ' + v.note : ''}`
    map.set(stu.id, map.has(stu.id) ? map.get(stu.id) + '；' + line : line)
  }
  return map
})

const customFrom = ref(dayjs().startOf('month').format('YYYY-MM-DD'))
const customTo = ref(dayjs().format('YYYY-MM-DD'))
const customData = ref<any>(null)

async function loadCustom() {
  customData.value = await get<any>(
    `/api/classes/${props.classId}/report?from=${customFrom.value}&to=${customTo.value}`,
  )
}

watch([customFrom, customTo, props.classId], loadCustom, { immediate: true })

async function doExportRange() {
  if (!customData.value) return
  const r = customData.value
  const statsRows = r.stats.map((s: any, i: number) => [i + 1, s.name, s.leave, s.late, s.absent, s.violate, s.total, violationText.value.get(s.id) ?? ''])
  const detailRows = r.details.map((d: any) => [d.day, weekdayCn(d.day), d.name, SLOT_LABEL[d.slot], ({ present: '出勤', leave: '请假', late: '迟到', absent: '旷课', violate: '违纪' } as any)[d.status], d.note || ''])
  const vioRows = r.violations.map((v: any) => [v.day, weekdayCn(v.day), v.name, SLOT_LABEL[v.slot], v.note || ''])
  await exportXlsx(`考勤统计_${className.value}_${customFrom.value}至${customTo.value}.xlsx`, [
    { name: '考勤汇总', header: ['序号', '姓名', '请假', '迟到', '旷课', '违纪', '合计', '异常情况'], rows: statsRows, widths: [6, 12, 8, 8, 8, 8, 8, 40], freeze: 1 },
    { name: '每日明细', header: ['日期', '星期', '姓名', '时段', '状态', '备注'], rows: detailRows, widths: [12, 8, 12, 8, 10, 30], freeze: 1 },
    { name: '异常记录', header: ['日期', '星期', '姓名', '时段', '说明'], rows: vioRows, widths: [12, 8, 12, 8, 40], freeze: 1 },
  ])
}

async function doExport() {
  if (!data.value) return
  const statsRows = sortedStats.value.map((s: any, i: number) => [
    { v: i + 1 },
    { v: s.name },
    { v: s.leave },
    { v: s.late },
    { v: s.absent },
    { v: s.violate },
    { v: s.total },
    { v: violationText.value.get(s.id) ?? '' },
  ])
  const detailRows = data.value.details.map((d: any) => [
    { v: d.day },
    { v: weekdayCn(d.day) },
    { v: d.name },
    { v: SLOT_LABEL[d.slot] },
    { v: ({ present: '出勤', leave: '请假', late: '迟到', absent: '旷课', violate: '违纪' } as any)[d.status] },
    { v: d.note || '' },
  ])
  const vioRows = data.value.violations.map((v: any) => [
    { v: v.day },
    { v: weekdayCn(v.day) },
    { v: v.name },
    { v: SLOT_LABEL[v.slot] },
    { v: v.note || '' },
  ])
  await exportXlsx(`考勤统计_${className.value}_${month.value}.xlsx`, [
    {
      name: '月度统计',
      header: ['序号', '姓名', '请假', '迟到', '旷课', '违纪', '合计', '违纪情况'],
      rows: statsRows,
      widths: [6, 12, 8, 8, 8, 8, 8, 40],
      freeze: 1,
    },
    {
      name: '每日明细',
      header: ['日期', '星期', '姓名', '时段', '状态', '备注'],
      rows: detailRows,
      widths: [12, 8, 12, 8, 10, 30],
      freeze: 1,
    },
    {
      name: '违纪记录',
      header: ['日期', '星期', '姓名', '时段', '说明'],
      rows: vioRows,
      widths: [12, 8, 12, 8, 40],
      freeze: 1,
    },
  ])
}
</script>

<template>
  <div class="toolbar card">
    <input v-model="month" type="month" />
    <div class="seg">
      <button :class="{ on: mode === 'day' }" @click="mode = 'day'">按天</button>
      <button :class="{ on: mode === 'time' }" @click="mode = 'time'">按次</button>
    </div>
    <button class="mini" @click="doExport">导出本月</button>
    <input v-model="customFrom" type="date" class="ginput" style="width: 130px" />
    <span style="color: var(--faint)">至</span>
    <input v-model="customTo" type="date" class="ginput" style="width: 130px" />
    <button class="mini" :disabled="!customData" @click="doExportRange">导出区间</button>
  </div>
  <p v-if="data" class="foot-note" style="margin: 0 0 8px">
    统计区间：{{ data.range.from }} ～ {{ data.range.to }}（{{ mode === 'day' ? '按天：同一天同种状态只算 1 次' : '按次：每个时段各算 1 次' }}）
  </p>

  <div class="card tablecard">
    <div class="table-scroll">
    <table class="stats">
      <thead>
        <tr>
          <th style="width: 30px">#</th>
          <th style="width: 88px">姓名</th>
          <th class="sortable" @click="setSort('leave')">请假</th>
          <th class="sortable" @click="setSort('late')">迟到</th>
          <th class="sortable" @click="setSort('absent')">旷课</th>
          <th class="sortable" @click="setSort('violate')">违纪</th>
          <th class="sortable" @click="setSort('total')">合计</th>
          <th style="text-align: left; padding-left: 10px">违纪情况</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(s, i) in sortedStats" :key="s.id">
          <td class="idx">{{ i + 1 }}</td>
          <td class="name">{{ s.name }}</td>
          <td :class="{ nz: s.leave }">{{ s.leave || '' }}</td>
          <td :class="{ nz: s.late }">{{ s.late || '' }}</td>
          <td :class="{ nz: s.absent }">{{ s.absent || '' }}</td>
          <td :class="{ nz: s.violate }">{{ s.violate || '' }}</td>
          <td class="total">{{ s.total || '' }}</td>
          <td class="vio">{{ violationText.get(s.id) || '' }}</td>
        </tr>
      </tbody>
    </table>
    </div>
  </div>

  <!-- 手机端：每人一张横条卡（桌面显示上方表格，≤700px 显示这里） -->
  <div class="card stat-cards">
    <div v-for="(s, i) in sortedStats" :key="s.id" class="stat-row" :class="{ clean: !s.total }">
      <div class="row-head">
        <span class="idx">{{ i + 1 }}</span>
        <b class="name">{{ s.name }}</b>
        <span class="total" :class="{ bad: s.total > 0 }">合计 {{ s.total || 0 }}</span>
      </div>
      <div class="chips">
        <span class="chip" :class="{ nz: s.leave > 0 }">请假 {{ s.leave || 0 }}</span>
        <span class="chip" :class="{ nz: s.late > 0 }">迟到 {{ s.late || 0 }}</span>
        <span class="chip" :class="{ nz: s.absent > 0 }">旷课 {{ s.absent || 0 }}</span>
        <span class="chip" :class="{ nz: s.violate > 0 }">违纪 {{ s.violate || 0 }}</span>
      </div>
      <p v-if="violationText.get(s.id)" class="vio-line">{{ violationText.get(s.id) }}</p>
    </div>
    <p v-if="!sortedStats.length" class="empty" style="padding: 14px">本月暂无数据</p>
  </div>

  <div v-if="data" class="card" style="margin-top: 12px">
    <div class="pad">
      <h3 class="sec-title">违纪记录明细 <em>{{ data.violations.length }}</em></h3>
      <div v-if="data.violations.length" class="vio-list">
        <div v-for="(v, i) in data.violations" :key="i" class="vio-item">
          <b>{{ v.day }}</b> {{ weekdayCn(v.day) }} · {{ v.name }} · {{ SLOT_LABEL[v.slot] }}
          <span v-if="v.note"> — {{ v.note }}</span>
        </div>
      </div>
      <p v-else class="empty">本月没有违纪记录</p>
    </div>
  </div>
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
.toolbar input[type='month'] {
  flex: 1;
  min-width: 130px;
  font-family: inherit;
  font-size: 14px;
  color: var(--text);
  border: 1px solid var(--line);
  background: var(--field);
  padding: 9px 11px;
  border-radius: 10px;
  outline: none;
}
.seg {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
  background: var(--field);
}
.seg button {
  padding: 9px 12px;
  font-size: 12.5px;
  color: var(--muted);
  border: none;
  background: none;
  cursor: pointer;
  font-weight: 600;
}
.seg button.on {
  background: var(--primary-soft);
  color: var(--primary);
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
.tablecard {
  overflow: hidden;
}
.stats {
  width: 100%;
  border-collapse: collapse;
}
.stats th {
  position: sticky;
  top: 0;
  background: var(--field);
  color: var(--muted);
  font-size: 12px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
}
.stats th.sortable {
  cursor: pointer;
  user-select: none;
}
.stats th.sortable:hover {
  color: var(--primary);
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
.stats td.total {
  font-weight: 700;
}
.stats td.vio {
  text-align: left;
  padding-left: 10px;
  color: var(--muted);
  font-size: 12px;
}
.pad {
  padding: 14px 16px;
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
.vio-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.vio-item {
  font-size: 12.5px;
  color: var(--text);
  padding: 6px 8px;
  background: var(--violate-bg);
  border-radius: 8px;
}
.empty {
  color: var(--faint);
  font-size: 12.5px;
}
/* ---------- 手机端卡片视图（≤700px 用卡片替代表格） ---------- */
.stat-cards {
  display: none;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}
.stat-row {
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--field);
}
.stat-row.clean {
  opacity: 0.75;
}
.row-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.row-head .idx {
  color: var(--faint);
  font-size: 12px;
  width: 20px;
  flex: none;
}
.row-head .name {
  font-size: 14.5px;
  flex: 1;
}
.row-head .total {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.row-head .total.bad {
  color: var(--absent);
}
.chips {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.chip {
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--panel);
  border: 1px solid var(--line-soft);
  color: var(--faint);
  font-variant-numeric: tabular-nums;
}
.chip.nz {
  color: var(--absent);
  border-color: var(--absent);
  background: var(--absent-bg, rgba(255, 59, 48, 0.1));
  font-weight: 700;
}
.vio-line {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
@media (max-width: 700px) {
  .tablecard {
    display: none;
  }
  .stat-cards {
    display: flex;
  }
}
.foot-note {
  color: var(--faint);
  font-size: 12px;
  margin: 0 0 8px;
}
</style>
