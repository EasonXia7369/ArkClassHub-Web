import dayjs from 'dayjs'

export const dk = (d: Date | dayjs.Dayjs = new Date()) => dayjs(d).format('YYYY-MM-DD')

export const weekdayCn = (k: string) => '周' + ['日', '一', '二', '三', '四', '五', '六'][dayjs(k).day()]

export const SLOT_LABEL: Record<string, string> = {
  morning: '早',
  noon: '中',
  evening: '晚',
}

/**
 * 考勤状态元数据。
 * icon 是 Icon.vue 的语义名（lucide）：原先用 ✓⭕□×△ 符号，
 * 手机上细笔画糊在一起、且不同字体渲染不一致，统一换成矢量图标。
 */
export const STATUS_META: Record<string, { label: string; icon: string }> = {
  present: { label: '出勤', icon: 'statusPresent' },
  leave: { label: '请假', icon: 'statusLeave' },
  late: { label: '迟到', icon: 'statusLate' },
  absent: { label: '旷课', icon: 'statusAbsent' },
  violate: { label: '违纪', icon: 'statusViolate' },
}
