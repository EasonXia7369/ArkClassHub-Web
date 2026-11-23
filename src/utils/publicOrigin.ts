/**
 * 对外可访问的站点源（家长链接 / 二维码用）。
 *
 * 为什么不能直接 `location.origin`：桌面端 Electron 壳的 origin 是 `ark://app`，
 * 本地开发是 `localhost` —— 手机扫这些地址打不开。所以优先级是：
 *
 *   VITE_PUBLIC_ORIGIN（部署时显式指定，推荐）
 *   → location.origin（自托管/自定义域名，若它不是不可外达的地址）
 *   → 兜底：抛错前的最后一层保底（保留生产域名，避免二维码没人能扫）
 *
 * 自托管部署只需在构建环境里设 `VITE_PUBLIC_ORIGIN=https://你的域名`，不必改代码。
 */

/** Electron 壳 / 本地开发等「手机扫不到」的 origin 判定 */
function isUnreachableOrigin(origin: string): boolean {
  if (!origin) return true
  // Electron 自定义协议（ark://app）、file://
  if (!/^https?:/i.test(origin)) return true
  try {
    const host = new URL(origin).hostname
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host === '::1' ||
      host.endsWith('.local')
    )
  } catch {
    return true
  }
}

/** 生产兜底域名：仅在完全没有可用 origin 时使用（保持既有单域名部署可用） */
const FALLBACK_ORIGIN = 'https://ach.macrostar.top'

export function publicOrigin(): string {
  const env = (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.trim()
  if (env) return env.replace(/\/+$/, '')
  const origin = typeof location === 'undefined' ? '' : location.origin
  if (!isUnreachableOrigin(origin)) return origin
  return FALLBACK_ORIGIN
}

/** 家长视图链接（不带学号上下文） */
export function parentLinkOf(key: string): string {
  return `${publicOrigin()}/parent/${key}`
}

/** 家长绑定链接（二维码用：只带学号上下文，身份证后六位绝不进二维码） */
export function parentBindLink(key: string, studentNo: string): string {
  return `${parentLinkOf(key)}?no=${encodeURIComponent(studentNo)}`
}