import { computed, ref } from 'vue'

/**
 * 操作撤销。
 *
 * 设计取舍：不做「客户端快照 + 整页回滚」，而是每个操作自己提供 undo 回调——
 * 因为撤销本质是「把这条数据写回旧值」，走原接口最安全（服务端已校验越权/格式）。
 *
 * 语义是 **栈**：撤销一步后，上一一步自动变成新的可撤销项，所以连点可以连续回退。
 * 界面只有一条提示条 + 一个「撤销」按钮，不额外引入历史面板。
 *
 * 只在内存里留最近若干步：刷新页面就失效（避免把过期旧值写回库里）。
 */

export interface UndoEntry {
  /** 展示文案，如「语文 ①背诵课文第3段 · 未交名单」 */
  label: string
  /** 把数据写回旧值；抛错时提示条会显示失败原因 */
  undo: () => Promise<void> | void
  /** 撤销后让发起方重拉数据（不一定 mounted，可选） */
  reload?: () => Promise<void> | void
}

interface InternalEntry extends UndoEntry {
  id: number
}

/** 最多保留多少步（防止连续点格子把无意义的历史堆满） */
const MAX_STEPS = 12
/** 提示条停留时长（毫秒）：超时即整栈作废，避免很久之后误撤销 */
const TTL_MS = 9000

const stack = ref<InternalEntry[]>([])
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null

function armTimer(): void {
  if (typeof window === 'undefined') return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    stack.value = []
    timer = null
  }, TTL_MS)
}

function push(entry: UndoEntry): void {
  seq += 1
  const next = [...stack.value, { ...entry, id: seq }]
  stack.value = next.length > MAX_STEPS ? next.slice(next.length - MAX_STEPS) : next
  armTimer()
}

/** 栈顶（提示条展示的那一项） */
const current = computed(() => stack.value[stack.value.length - 1] ?? null)
const depth = computed(() => stack.value.length)

const busy = ref(false)
const error = ref('')

/**
 * 撤销栈顶。返回是否成功。
 * 成功后栈自动弹出，`current` 变成上一项，可以接着撤销。
 */
async function undo(): Promise<boolean> {
  const top = current.value
  if (!top || busy.value) return false
  busy.value = true
  error.value = ''
  try {
    await top.undo()
    await top.reload?.()
    stack.value = stack.value.filter((x) => x.id !== top.id)
    if (stack.value.length) armTimer()
    else if (timer) {
      clearTimeout(timer)
      timer = null
    }
    return true
  } catch (e: any) {
    error.value = e?.message ?? '撤销失败'
    return false
  } finally {
    busy.value = false
  }
}

/** 主动收起（点关闭，或换了个不兼容的操作） */
function dismiss(): void {
  stack.value = []
  error.value = ''
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** 清空（退出登录/切班级时调用，避免把 A 班旧值写回 B 班） */
function reset(): void {
  dismiss()
}

export function useUndo() {
  return {
    current,
    depth,
    busy,
    error,
    push,
    undo,
    dismiss,
    reset,
  }
}
