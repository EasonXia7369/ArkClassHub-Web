/**
 * 运行环境探测与统一文件导出。
 * - Web/PWA：Blob URL + 隐形锚点下载（与原行为完全一致）
 * - Electron 桌面端：主进程原生「另存为」对话框 + 落盘
 *   （壳工程 preload 经 contextBridge 暴露 window.ark，见 ArkClassHub Windows/preload.js）
 * 桌面分支全部运行时探测，浏览器构建不会执行桌面路径。
 */

/** 前端热同步状态（1.0.2+ 壳提供，旧壳/浏览器端为 undefined） */
export interface ArkWebSyncState {
  source: 'live' | 'bundled'
  hash: string | null
  lastCheck: string | null
  lastSwap: string | null
  lastError: string | null
  disabled: boolean
  checking: boolean
}

interface ArkDesktopBridge {
  desktop: true
  saveFile(filename: string, data: Uint8Array): Promise<string | null>
  windowState(): Promise<{ fullscreen: boolean; alwaysOnTop: boolean; autostart: boolean }>
  setFullscreen(on: boolean): Promise<void>
  setAlwaysOnTop(on: boolean): Promise<void>
  setAutostart(on: boolean): Promise<boolean>
  /** 大板自适应缩放开关（壳主进程驱动窗口 resize 缩放；1.0.5+ 壳提供） */
  setBoardScale?(on: boolean): Promise<boolean>
  webSyncState?(): Promise<ArkWebSyncState>
  checkWebSync?(): Promise<{ updated: boolean; hash?: string; error?: string; skipped?: boolean; reason?: string }>
  /** 桌面壳版本号（1.0.3+ 壳提供） */
  version?(): Promise<string>
  /** 重新加载页面（1.0.6+ 壳提供） */
  reload?(): Promise<void>
}

export const desktopBridge: ArkDesktopBridge | null =
  typeof window !== 'undefined' && (window as any).ark?.desktop
    ? ((window as any).ark as ArkDesktopBridge)
    : null

/** 是否运行在桌面壳(Electron)中 */
export const isDesktop = desktopBridge !== null

/** 统一导出入口：浏览器走锚点下载，桌面端弹原生「另存为」对话框 */
export async function saveFile(filename: string, blob: Blob): Promise<void> {
  if (desktopBridge) {
    const buf = new Uint8Array(await blob.arrayBuffer())
    await desktopBridge.saveFile(filename, buf)
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    a.remove()
  }, 3000)
}

/**
 * 移动端友好的保存：优先调起系统分享面板（微信/QQ/保存到相册等），
 * 不支持或用户取消时回落到浏览器下载。
 */
export async function saveOrShare(filename: string, blob: Blob): Promise<void> {
  if (desktopBridge) return saveFile(filename, blob)
  try {
    const file = new File([blob], filename, { type: blob.type })
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return
    }
  } catch (e: any) {
    // 用户在分享面板点取消（AbortError）→ 不再重复下载
    if (e?.name === 'AbortError') return
  }
  await saveFile(filename, blob)
}
