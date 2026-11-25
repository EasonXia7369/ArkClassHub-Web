import { onBeforeUnmount, watch, type Ref } from 'vue'

/**
 * Esc 关闭弹层。
 *
 * 现有弹层都靠点遮罩或点关闭按钮关闭，键盘用户没法退出。
 * 用法：`useEscClose(showImport, () => { showImport.value = false })`
 *
 * 可见性参数接受任意「真值 = 打开」的 ref（`ref(false)`、`ref<T | null>(null)` 都行）。
 *
 * 只在该弹层打开时入栈，关闭即出栈。用一个模块级栈而不是各自绑监听，
 * 是为了在弹层叠加时（比如导入弹窗上又开了学生趋势）一次 Esc 只关最上面那层。
 *
 * 注意：强制同意弹窗（ConsentDialog）故意不用这个——它不允许被跳过。
 */
const stack: Array<() => void> = []
let bound = false

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  // 不拦截输入法组合过程中的 Esc
  if (e.isComposing) return
  const top = stack[stack.length - 1]
  if (!top) return
  e.preventDefault()
  top()
}

function bind() {
  if (bound || typeof window === 'undefined') return
  window.addEventListener('keydown', onKey)
  bound = true
}

function unbindIfEmpty() {
  if (stack.length || !bound || typeof window === 'undefined') return
  window.removeEventListener('keydown', onKey)
  bound = false
}

export function useEscClose(visible: Ref<unknown>, close: () => void): void {
  watch(
    visible,
    (open) => {
      const i = stack.indexOf(close)
      if (open) {
        bind()
        if (i < 0) stack.push(close)
      } else if (i >= 0) {
        stack.splice(i, 1)
        unbindIfEmpty()
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    const i = stack.indexOf(close)
    if (i >= 0) stack.splice(i, 1)
    unbindIfEmpty()
  })
}