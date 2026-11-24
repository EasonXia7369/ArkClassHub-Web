import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get, getToken, mediaUrl, post, upload, wsUrl } from '@/api'
import { useIdentityStore } from '@/stores/identity'

export interface ChatMessage {
  id: number
  class_id: number
  sender_role: 'teacher' | 'student'
  sender_name?: string
  actor_student_id?: number | null
  popup?: boolean
  kind: 'text' | 'image' | 'voice'
  body: string
  has_media: boolean
  media_mime: string | null
  media_duration_ms: number | null
  created_at: string
}

/** 家长留言（家长 ↔ 老师，独立于班级聊天的第二个群组；无媒体） */
export interface ParentMsg {
  id: number
  sender_type: 'parent' | 'teacher'
  sender_name: string
  body: string
  created_at: string
  /** 老师回复引用的目标留言 id（家长留言无此字段） */
  reply_to?: number | null
  reply_name?: string | null
  reply_body?: string | null
}

type ConnState = 'off' | 'connecting' | 'open' | 'retrying'

/** 离线待发队列条目（仅文字；媒体文件不入 localStorage） */
interface PendingMsg {
  classId: number
  body: string
  queuedAt: string
}

const QUEUE_KEY = 'ark-msg-queue'
const SEEN_PREFIX = 'ark-seen-'
const PARENT_SEEN_PREFIX = 'ark-pseen-'

/**
 * 班级消息群（班主任 ↔ 值日生一体机）。
 *
 * 实时：WebSocket（每班一个 Durable Object）；断线自动重连 + after 增量补拉。
 * 离线优先：
 *  - 发送不依赖连接——接口不可达时文字消息进入本地队列，恢复后自动重发
 *  - 上线（重连/打开页面/网络恢复）→ refreshTick 全量同步信号，各板块自动重拉
 *  - 补拉后对比本地已读水位，离线期间的新消息弹「离线摘要」提醒
 */
export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([])
  const conn = ref<ConnState>('off')
  const unread = ref(0)
  /** 家长留言群组：消息列表 + 未读（打开家长留言组时清零，水位存 localStorage） */
  const parentMessages = ref<ParentMsg[]>([])
  const parentUnread = ref(0)
  /** 收到数据变更广播或上线全量同步时 +1，各板块监听后重拉 */
  const refreshTick = ref(0)
  const popup = ref<ChatMessage | null>(null) // 大板全屏弹出卡片（收到的老师消息）
  /** 离线摘要：补拉后发现的新消息 */
  const offlineSummary = ref<{ count: number; last: ChatMessage | null } | null>(null)
  /** 待发队列长度（发消息 UI 可显示「排队中」） */
  const pendingCount = ref(0)

  let classId = 0
  let ws: WebSocket | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let retryDelay = 1000
  let manuallyClosed = false
  let flushing = false

  /* ---------- 本地已读水位（离线摘要依据） ---------- */

  function seenId(cid: number): number {
    return Number(localStorage.getItem(SEEN_PREFIX + cid) ?? 0)
  }
  function markSeenId(cid: number, id: number): void {
    if (id > seenId(cid)) localStorage.setItem(SEEN_PREFIX + cid, String(id))
  }

  /* ---------- 家长留言已读水位 ---------- */

  function parentSeenId(cid: number): number {
    return Number(localStorage.getItem(PARENT_SEEN_PREFIX + cid) ?? 0)
  }
  function markParentSeen(cid: number, id: number): void {
    if (id > parentSeenId(cid)) localStorage.setItem(PARENT_SEEN_PREFIX + cid, String(id))
  }
  /** 打开「家长留言」组时清零未读 */
  function markAllParentRead(): void {
    parentUnread.value = 0
    if (classId && parentMessages.value.length) {
      markParentSeen(classId, parentMessages.value[parentMessages.value.length - 1].id)
    }
  }

  /* ---------- 离线待发队列 ---------- */

  function readQueue(): PendingMsg[] {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
    } catch {
      return []
    }
  }
  function writeQueue(q: PendingMsg[]): void {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
    pendingCount.value = q.length
  }

  function enqueue(cid: number, body: string): void {
    const q = readQueue()
    q.push({ classId: cid, body, queuedAt: new Date().toISOString() })
    writeQueue(q)
  }

  /** 队列重发：逐条发送，失败即停（保持剩余队列）。 */
  async function flushQueue(): Promise<void> {
    if (flushing) return
    const q = readQueue()
    if (!q.length) return
    flushing = true
    try {
      while (q.length) {
        const item = q[0]
        await post(`/api/classes/${item.classId}/messages`, { body: item.body })
        q.shift()
        writeQueue(q)
      }
    } catch {
      // 网络/服务端仍不可达：保留队列，等下次触发
    } finally {
      flushing = false
    }
  }

  /* ---------- 生命周期 ---------- */

  function reset() {
    manuallyClosed = true
    ws?.close()
    ws = null
    if (retryTimer) clearTimeout(retryTimer)
    if (pingTimer) clearInterval(pingTimer)
    classId = 0
    messages.value = []
    unread.value = 0
    parentMessages.value = []
    parentUnread.value = 0
    popup.value = null
    conn.value = 'off'
    manuallyClosed = false
  }

  function maxId(): number {
    return messages.value.length ? messages.value[messages.value.length - 1].id : 0
  }

  /** 家长留言已拉到的最大 id（增量拉取游标） */
  function parentMaxId(): number {
    return parentMessages.value.length ? parentMessages.value[parentMessages.value.length - 1].id : 0
  }

  async function loadHistory(cid: number, after = 0): Promise<void> {
    const res = await get<{ messages: ChatMessage[] }>(
      `/api/classes/${cid}/messages?after=${after}&limit=300`,
    )
    if (after === 0) {
      messages.value = res.messages
    } else if (res.messages.length) {
      const seen = new Set(messages.value.map((m) => m.id))
      for (const m of res.messages) if (!seen.has(m.id)) messages.value.push(m)
    }

    // 离线摘要：全量补拉后对比本地已读水位
    if (after === 0) {
      const stored = seenId(cid)
      const fresh = messages.value.filter((m) => m.id > stored)
      if (stored > 0 && fresh.length > 0) {
        unread.value += fresh.length
        const last = fresh[fresh.length - 1]
        offlineSummary.value = { count: fresh.length, last }
      }
      if (messages.value.length) markSeenId(cid, maxId())
    } else if (res.messages.length) {
      markSeenId(cid, maxId())
    }
  }

  function connect(cid: number, onIncoming?: (m: ChatMessage) => void): void {
    const token = getToken()
    if (!token || !cid) return
    if (ws && classId === cid && (conn.value === 'open' || conn.value === 'connecting')) return

    manuallyClosed = false
    classId = cid
    conn.value = 'connecting'
    ws?.close()

    const socket = new WebSocket(wsUrl(`/api/classes/${cid}/messages/ws?token=${token}`))
    ws = socket

    socket.onopen = () => {
      if (ws !== socket) return
      conn.value = 'open'
      retryDelay = 1000
      // 重连补拉断线期间的消息 + 冲刷离线队列
      loadHistory(cid, maxId()).catch(() => {})
      flushQueue().catch(() => {})
      // 家长留言也要拉一次：教师不一定在消息页，靠这里才能把「离线期间的家长留言」
      // 计入红点（parentUnread）。带 after 增量，进消息页时 MessagesView 会全量重拉。
      loadParentHistory(cid, parentMaxId()).catch(() => {})
      if (pingTimer) clearInterval(pingTimer)
      pingTimer = setInterval(() => {
        try {
          socket.send('ping')
        } catch {
          /* ignore */
        }
      }, 30_000)
    }

    socket.onmessage = (ev) => {
      if (ws !== socket) return
      try {
        const data = JSON.parse(ev.data as string)
        if (data.type === 'refresh') {
          refreshTick.value++
          return
        }
        if (data.type === 'message-deleted') {
          messages.value = messages.value.filter((x) => x.id !== data.id)
          return
        }
        if (data.type === 'parent-message-deleted') {
          parentMessages.value = parentMessages.value.filter((x) => x.id !== data.id)
          return
        }
        if (data.type === 'parent-message') {
          const m = data.message as ParentMsg
          if (!parentMessages.value.some((x) => x.id === m.id)) {
            parentMessages.value.push(m)
            // 家长留言不打断大板（不弹窗/不响铃），只累计未读，打开家长留言组时清零
            if (m.id > parentSeenId(cid)) parentUnread.value++
            markParentSeen(cid, m.id)
          }
          return
        }
        if (data.type === 'message') {
          const m = data.message as ChatMessage
          if (!messages.value.some((x) => x.id === m.id)) {
            messages.value.push(m)
            unread.value++
            markSeenId(cid, m.id)
            if (m.sender_role === 'teacher') {
              if (m.popup !== false) popup.value = m
              onIncoming?.(m)
            }
          }
        }
      } catch {
        /* ignore malformed */
      }
    }

    socket.onclose = () => {
      if (ws !== socket) return
      ws = null
      if (pingTimer) clearInterval(pingTimer)
      if (manuallyClosed) {
        conn.value = 'off'
        return
      }
      conn.value = 'retrying'
      retryTimer = setTimeout(() => connect(cid, onIncoming), retryDelay)
      retryDelay = Math.min(retryDelay * 2, 30_000)
    }

    socket.onerror = () => socket.close()
  }

  async function sendText(cid: number, body: string, popup = true): Promise<{ queued: boolean }> {
    const identity = useIdentityStore()
    try {
      const res = await post<{ message: ChatMessage }>(`/api/classes/${cid}/messages`, {
        body,
        popup,
        actor_student_id: identity.studentId ?? undefined,
      })
      if (!messages.value.some((m) => m.id === res.message.id)) messages.value.push(res.message)
      markSeenId(cid, res.message.id)
      return { queued: false }
    } catch (e: any) {
      // 网络/后端不可达：进本地队列，恢复后自动重发
      enqueue(cid, body)
      return { queued: true }
    }
  }

  async function sendMedia(
    cid: number,
    kind: 'image' | 'voice',
    blob: Blob,
    mime: string,
    durationMs?: number,
    popup = true,
  ): Promise<void> {
    const identity = useIdentityStore()
    const q = new URLSearchParams({ kind, mime })
    if (identity.studentId) q.set('actor', String(identity.studentId))
    q.set('popup', popup ? '1' : '0')
    if (kind === 'voice' && durationMs) q.set('duration', String(durationMs))
    const res = await upload<{ message: ChatMessage }>(
      `/api/classes/${cid}/messages/upload?${q.toString()}`,
      blob,
    )
    if (!messages.value.some((m) => m.id === res.message.id)) messages.value.push(res.message)
    markSeenId(cid, res.message.id)
  }

  async function deleteMessage(cid: number, msgId: number): Promise<void> {
    const { del } = await import('@/api')
    await del(`/api/classes/${cid}/messages/${msgId}`)
    messages.value = messages.value.filter((x) => x.id !== msgId)
  }

  /* ---------- 家长留言（第二个群组） ---------- */

  /** 家长留言历史 / 增量；全量时对比水位恢复未读。 */
  async function loadParentHistory(cid: number, after = 0): Promise<void> {
    const res = await get<{ messages: ParentMsg[] }>(
      `/api/classes/${cid}/parent-messages?after=${after}`,
    )
    if (after === 0) {
      parentMessages.value = res.messages
      const stored = parentSeenId(cid)
      if (stored > 0) {
        const fresh = res.messages.filter((m) => m.id > stored)
        if (fresh.length) parentUnread.value += fresh.length
      }
    } else if (res.messages.length) {
      const seen = new Set(parentMessages.value.map((m) => m.id))
      const stored = parentSeenId(cid)
      let added = 0
      for (const m of res.messages) {
        if (seen.has(m.id)) continue
        parentMessages.value.push(m)
        // 增量拉到的新留言同样计红点：教师不在消息页时靠这里把未读补上
        if (m.id > stored) added++
      }
      if (added) parentUnread.value += added
    }
    if (parentMessages.value.length) {
      markParentSeen(cid, parentMessages.value[parentMessages.value.length - 1].id)
    }
  }

  async function sendParentReply(cid: number, body: string, replyTo?: number): Promise<void> {
    const res = await post<{ message: ParentMsg }>(`/api/classes/${cid}/parent-messages`, {
      body,
      reply_to: replyTo,
    })
    if (!parentMessages.value.some((m) => m.id === res.message.id)) {
      parentMessages.value.push(res.message)
    }
    markParentSeen(cid, res.message.id)
  }

  async function deleteParentMessage(cid: number, msgId: number): Promise<void> {
    const { del } = await import('@/api')
    await del(`/api/classes/${cid}/parent-messages/${msgId}`)
    parentMessages.value = parentMessages.value.filter((x) => x.id !== msgId)
  }

  function markAllRead(): void {
    unread.value = 0
    if (classId) markSeenId(classId, maxId())
  }

  function mediaSrc(m: ChatMessage): string {
    return mediaUrl(m.class_id, m.id)
  }

  /* 网络恢复：重连 + 冲刷队列 + 全量同步信号 */
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (classId) {
        connect(classId)
        refreshTick.value++
        flushQueue().catch(() => {})
      }
    })
  }

  return {
    messages,
    conn,
    unread,
    parentMessages,
    parentUnread,
    refreshTick,
    popup,
    offlineSummary,
    pendingCount,
    connect,
    reset,
    loadHistory,
    sendText,
    sendMedia,
    deleteMessage,
    markAllRead,
    markSeenId,
    loadParentHistory,
    sendParentReply,
    deleteParentMessage,
    markAllParentRead,
    flushQueue,
    mediaSrc,
  }
})
