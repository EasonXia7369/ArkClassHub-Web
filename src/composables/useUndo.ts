import { computed, ref } from 'vue'

/**
 * 操作撤销。
 *
 * 设计取舍：不做「客户端快照 + 整页回滚」，而是每个操作自己提供 undo 回调——
 * 因为撤销本质是「把这条数据写回旧值」，走原接口最安全（服务端已校验越权/格式）。
 *
 * 数据是 **栈**：只有栈顶可以撤销；撤销一步后上一层自动变成新的栈顶。
 * 界面上有两个入口：
 *  - 底部提示条（UndoBar）：刚做完就能一键撤销，最常见的路径
 *  - 侧栏/顶栏的「撤销历史」面板：翻看最近做过什么，可以选一条往前回退（会连带撤销中间的）
 *
 * 只在内存里留最近若干步，超过闲置时长自动作废：撤销是把旧值写回库里，
 * 拖太久再写回风险更大（期间别处可能改过同一条）。
 */

export interface UndoEntry {
  /** 展示文案，如「语文 ①背诵课文第3段 · 未交名单」 */
  label: string
  /** 归类，用于面板分组色块（考勤/作业/考试…） */
  kind?: 'attendance' | 'homework' | 'exam' | 'other'
  /** 把数据写回旧值；抛错时提示条会显示失败原因 */
  undo: () => Promise<void> | void
  /** 撤销后让发起方重拉数据（不一定 mounted，可选） */
  reload?: () => Promise<void> | void
}

interface InternalEntry extends UndoEntry {
  id: number
  /** 压栈时间戳（毫秒），面板显示「N 分钟前」 */
  at: number
}

/** 最多保留多少步（面板要能翻，所以比提示条时代放宽） */
const MAX_STEPS = 30
/**
 * 历史闲置多久整栈作废。
 * 撤销是把旧值写回库里，拖太久再写回风险更大（期间别处可能改过同一条）。
 */
const TTL_MS = 30 * 60 * 1000
/** 底部提示条显示多久（历史仍保留，只是不再挡视线） */
const BAR_MS = 9000

const stack = ref<InternalEntry[]>([])
/** 底部提示条是否显示：新操作后弹出，几秒后自己收起；历史面板不受影响 */
const barShowing = ref(false)
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null
let barTimer: ReturnType<typeof setTimeout> | null = null

function armTimer(): void {
  if (typeof window === 'undefined') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    stack.value = []
    barShowing.value = false
    timer = null
  }, TTL_MS)
}

function armBarTimer(): void {
  if (typeof window === 'undefined') return
  if (barTimer) clearTimeout(barTimer)
  barTimer = setTimeout(() => {
    barShowing.value = false
    barTimer = null
  }, BAR_MS)
}

function push(entry: UndoEntry): void {
  seq += 1
  const next = [...stack.value, { ...entry, id: seq, at: Date.now() }]
  stack.value = next.length > MAX_STEPS ? next.slice(next.length - MAX_STEPS) : next
  barShowing.value = true
  armTimer()
  armBarTimer()
}

/** 栈顶（提示条展示的那一项） */
const current = computed(() => stack.value[stack.value.length - 1] ?? null)
const depth = computed(() => stack.value.length)
/** 面板用：从新到旧排列 */
const history = computed(() => [...stack.value].reverse())

const busy = ref(false)
const error = ref('')

/**
 * 撤销到指定条目（含它自己）。
 * 因为只有栈顶安全，撤销中间某项等价于「把它上面的也一起撤了」——
 * 面板点击前会提示要撤几步，避免一键回退太多。
 */
async function undoTo(id: number): Promise<boolean> {
  const idx = stack.value.findIndex((x) => x.id === id)
  if (idx < 0 || busy.value) return false
  const targets = stack.value.slice(idx).reverse() // 从栈顶往下依次撤
  busy.value = true
  error.value = ''
  let okCount = 0
  try {
    for (const t of targets) {
      await t.undo()
      okCount += 1
      stack.value = stack.value.filter((x) => x.id !== t.id)
    }
    // 同一批可能跨板块，逐条 reload 会重复拉；只调最后一个的即可
    await targets[targets.length - 1]?.reload?.()
    return true
  } catch (e: any) {
    error.value = e?.message ?? '撤销失败'
    // 中途失败：已成功的已经出栈，剩下的留着让用户继续尝试
    if (okCount) await targets[okCount - 1]?.reload?.()
    return false
  } finally {
    busy.value = false
    if (stack.value.length) armTimer()
    else clearTimers()
  }
}

/** 撤销栈顶（提示条按钮用） */
async function undo(): Promise<boolean> {
  const top = current.value
  if (!top) return false
  return undoTo(top.id)
}

/** 主动丢弃（点关闭） */
function dismiss(): void {
  stack.value = []
  error.value = ''
  clearTimers()
}

/** 只收起底部提示条，历史仍保留（面板还能翻） */
function hideBar(): void {
  barShowing.value = false
  if (barTimer) {
    clearTimeout(barTimer)
    barTimer = null
  }
}

function clearTimers(): void {
  barShowing.value = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (barTimer) {
    clearTimeout(barTimer)
    barTimer = null
  }
}

/** 清空（退出登录/切班级时调用，避免把 A 班旧值写回 B 班） */
function reset(): void {
  dismiss()
}

/** 相对时间文案（面板用） */
function relTime(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  return `${h} 小时前`
}

export function useUndo() {
  return {
    current,
    depth,
    history,
    barShowing,
    busy,
    error,
    push,
    undo,
    undoTo,
    dismiss,
    hideBar,
    reset,
    relTime,
  }
}
