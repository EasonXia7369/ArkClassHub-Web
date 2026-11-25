<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { get } from '@/api'
import dayjs from 'dayjs'
import { useAuthStore } from '@/stores/auth'
import { useClassStore } from '@/stores/class'
import { useChatStore, type ChatMessage, type ParentMsg } from '@/stores/chat'
import { useNotify } from '@/composables/useNotify'
import { usePush } from '@/composables/usePush'
import { useEscClose } from '@/composables/useEscClose'
import Icon from '@/components/Icon.vue'

const auth = useAuthStore()
const store = useClassStore()
const chat = useChatStore()
const route = useRoute()
const notify = useNotify()
const {
  supported: pushSupported,
  subscribed: pushSubscribed,
  busy: pushBusy,
  serverEnabled: pushServerEnabled,
  error: pushError,
  init: initPush,
  enable: enablePush,
  disable: disablePush,
} = usePush()
/** 推送开关入口：仅网页端（非桌面壳）且服务端已配置 VAPID 时显示 */
const pushVisible = computed(() => pushSupported && pushServerEnabled.value)

const QUICK_PHRASES = ['作业收齐了', '请求老师来教室', '收到，请指示', '一切正常', '请查看大板']
const quickPhrases = ref<string[]>(QUICK_PHRASES)
const popupOn = ref(localStorage.getItem('ark-popup-on') !== '0')
function togglePopup() {
  popupOn.value = !popupOn.value
  localStorage.setItem('ark-popup-on', popupOn.value ? '1' : '0')
}

const isStudent = computed(() => auth.user?.role === 'student')

/* ---------- 群组切换：班级消息 / 家长留言（推送通知 ?tab=parent 直达） ---------- */
const activeTab = ref<'class' | 'parent'>(route.query.tab === 'parent' ? 'parent' : 'class')
const parentListEl = ref<HTMLElement | null>(null)
const parentInput = ref('')
const sendingReply = ref(false)

function scrollToChat(target: 'class' | 'parent' = 'class') {
  const el = target === 'class' ? listEl.value : parentListEl.value
  nextTick(() => el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }))
}

function switchTab(t: 'class' | 'parent') {
  activeTab.value = t
  if (t === 'parent') {
    chat.markAllParentRead()
    scrollToChat('parent')
  } else {
    scrollToChat('class')
  }
}

function parentTimeLabel(ts: string) {
  const d = dayjs(ts)
  return d.isSame(dayjs(), 'day') ? d.format('HH:mm') : d.format('MM-DD HH:mm')
}

/** 引用回复：回复必须针对某条家长留言（家长端按孩子过滤，未引用的回复家长看不到） */
const replyTarget = ref<ParentMsg | null>(null)

function startReply(m: ParentMsg) {
  replyTarget.value = m
}

function cancelReply() {
  replyTarget.value = null
}

function clipBody(s: string, n = 24): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

async function sendReply() {
  const body = parentInput.value.trim()
  if (!body || !store.current || sendingReply.value) return
  if (!replyTarget.value) {
    error.value = '请先点击某条留言的「回复」，针对该留言回复（家长只能看到与自己孩子相关的对话）'
    return
  }
  error.value = ''
  sendingReply.value = true
  try {
    await chat.sendParentReply(store.current.id, body, replyTarget.value.id)
    parentInput.value = ''
    replyTarget.value = null
    notify.beep('sent')
    scrollToChat('parent')
  } catch (e: any) {
    error.value = e.message
  } finally {
    sendingReply.value = false
  }
}

async function deleteParentMsg(m: ParentMsg) {
  if (!confirm('删除这条留言？删除后家长端也不再显示。')) return
  await chat.deleteParentMessage(store.current!.id, m.id)
}

// 家长留言组开着时，新留言直接视为已读（徽标只在其他组/页面累计）
watch(
  () => [chat.parentUnread, activeTab.value] as const,
  ([unread, tab]) => {
    if (unread > 0 && tab === 'parent') chat.markAllParentRead()
  },
)

const listEl = ref<HTMLElement | null>(null)
const input = ref('')
const sending = ref(false)
const error = ref('')

// 录音状态
const recording = ref(false)
const recordSeconds = ref(0)
const recordError = ref('')
let mediaRecorder: MediaRecorder | null = null
let recordStream: MediaStream | null = null
let recordChunks: Blob[] = []
let recordTimer: ReturnType<typeof setInterval> | null = null

// 图片预览
const previewImage = ref<string | null>(null)

function scrollToBottom() {
  nextTick(() => {
    listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' })
  })
}

function timeLabel(ts: string) {
  return dayjs(ts).format('HH:mm')
}

function onIncoming(m: ChatMessage) {
  notify.beep('incoming')
  notify.showNotification(
    m.sender_role === 'teacher' ? '老师来消息了' : '大板来消息了',
    m.kind === 'text' ? m.body : m.kind === 'voice' ? `[语音 ${(m.media_duration_ms ?? 0) / 1000}s]` : '[图片]',
  )
  scrollToBottom()
}

onMounted(async () => {
  await notify.requestPermission().catch(() => {})
  initPush().catch(() => {})
  if (store.current) {
    try {
      const res = await get<{ phrases: string[] }>(`/api/classes/${store.current.id}/quick-phrases`)
      if (res.phrases.length) quickPhrases.value = res.phrases
    } catch {
      /* 用默认 */
    }
  }
  if (store.current) {
    await chat.loadHistory(store.current.id).catch(() => {})
    await chat.loadParentHistory(store.current.id).catch(() => {})
    chat.connect(store.current.id, onIncoming)
    if (activeTab.value === 'parent') chat.markAllParentRead()
    scrollToChat(activeTab.value)
  }
})

watch(
  () => store.current?.id,
  async (cid) => {
    if (!cid) return
    chat.reset()
    await chat.loadHistory(cid).catch(() => {})
    await chat.loadParentHistory(cid).catch(() => {})
    chat.connect(cid, onIncoming)
    if (activeTab.value === 'parent') chat.markAllParentRead()
    scrollToChat(activeTab.value)
  },
)

onBeforeUnmount(() => {
  // 切换板块不断开 WS（大板仍需实时弹窗），仅清除弹层
  chat.popup = null
})

async function sendText() {
  const body = input.value.trim()
  if (!body || !store.current || sending.value) return
  error.value = ''
  sending.value = true
  try {
    const res = await chat.sendText(store.current.id, body)
    input.value = ''
    if (res.queued) {
      notify.beep('sent')
      toast('当前无法送达，已存入待发队列，恢复后自动发送')
    } else {
      notify.beep('sent')
      scrollToBottom()
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    sending.value = false
  }
}

async function sendQuick(phrase: string) {
  input.value = phrase
  await sendText()
}

function pickImage() {
  const fileInput = document.createElement('input')
  fileInput.type = 'file'
  fileInput.accept = 'image/*'
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]
    if (!file || !store.current) return
    error.value = ''
    try {
      const blob = await compressImage(file)
      await chat.sendMedia(store.current.id, 'image', blob, blob.type || 'image/jpeg', undefined, popupOn.value)
      notify.beep('sent')
      scrollToBottom()
    } catch (e: any) {
      error.value = e.message
    }
  }
  fileInput.click()
}

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const maxEdge = 1600
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('图片处理失败'))
        if (blob.size > 400 * 1024) {
          // 再压一档
          canvas.toBlob(
            (b2) => (b2 ? resolve(b2) : reject(new Error('图片压缩后仍超限'))),
            'image/jpeg',
            0.6,
          )
        } else {
          resolve(blob)
        }
      },
      'image/webp',
      0.85,
    )
  })
}

async function toggleRecord() {
  if (recording.value) {
    stopRecording(true)
    return
  }
  recordError.value = ''
  try {
    recordStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    )
    mediaRecorder = new MediaRecorder(recordStream, mime ? { mimeType: mime } : undefined)
    recordChunks = []
    mediaRecorder.ondataavailable = (e) => e.data.size && recordChunks.push(e.data)
    mediaRecorder.onstop = () => finalizeRecording()
    mediaRecorder.start()
    recording.value = true
    recordSeconds.value = 0
    recordTimer = setInterval(() => {
      recordSeconds.value++
      if (recordSeconds.value >= 60) stopRecording(true)
    }, 1000)
  } catch (e: any) {
    recordError.value = '无法访问麦克风：' + (e.message ?? '权限被拒绝')
  }
}

function stopRecording(send: boolean) {
  if (recordTimer) clearInterval(recordTimer)
  ;(mediaRecorder as any)._shouldSend = send
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
}

async function finalizeRecording() {
  recording.value = false
  recordStream?.getTracks().forEach((t) => t.stop())
  const duration = recordSeconds.value * 1000
  // 先取快照再清引用（此前顺序颠倒导致永远不发）
  const shouldSend = !!(mediaRecorder as any)?._shouldSend
  const mimeType = (mediaRecorder?.mimeType ?? 'audio/webm').split(';')[0]
  const blob = new Blob(recordChunks, { type: mimeType })
  mediaRecorder = null
  if (!shouldSend) return
  if (!store.current) return
  if (blob.size === 0) {
    recordError.value = '录音为空'
    return
  }
  if (blob.size > 400 * 1024) {
    recordError.value = '录音过大（超 60 秒或码率异常），请缩短后重试'
    return
  }
  error.value = ''
  try {
    await chat.sendMedia(store.current.id, 'voice', blob, mimeType, Math.max(duration, 100), popupOn.value)
    notify.beep('sent')
    scrollToBottom()
  } catch (e: any) {
    error.value = e.message
  }
}

const toastMsg = ref('')
function toast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => (toastMsg.value = ''), 2600)
}

/** 推送通知开关：开启走权限→订阅→上报流程；关闭取消订阅 */
async function togglePush() {
  if (pushBusy.value) return
  if (pushSubscribed.value) {
    await disablePush()
    toast('推送通知已关闭')
  } else {
    const ok = await enablePush()
    if (ok) toast('推送通知已开启，关掉页面也能收到提醒')
    else toast(pushError.value || '开启推送失败')
  }
}
const deletingId = ref<number | null>(null)
async function deleteMsg(m: ChatMessage) {
  if (!confirm('删除这条消息？')) return
  await chat.deleteMessage(store.current!.id, m.id)
}
const playingId = ref<number | null>(null)
function playVoice(m: ChatMessage) {
  playingId.value = m.id
  const audio = new Audio(chat.mediaSrc(m))
  audio.onended = () => (playingId.value = null)
  audio.onerror = () => (playingId.value = null)
  audio.play()
}

useEscClose(previewImage, () => (previewImage.value = null))
</script>

<template>
  <div class="chat-wrap glass">
    <div class="chat-head">
      <span class="conn-dot" :class="chat.conn" />
      <span class="conn-text">
        {{ chat.conn === 'open' ? '实时连接' : chat.conn === 'retrying' ? '重连中…' : chat.conn === 'connecting' ? '连接中…' : '未连接' }}
      </span>
      <div class="gseg chat-tabs">
        <button :class="{ on: activeTab === 'class' }" @click="switchTab('class')">班级消息</button>
        <button :class="{ on: activeTab === 'parent' }" @click="switchTab('parent')">
          家长留言<span v-if="chat.parentUnread" class="tab-badge">{{ chat.parentUnread > 99 ? '99+' : chat.parentUnread }}</span>
        </button>
      </div>
      <span class="hint">
        {{ activeTab === 'parent' ? '家长 ↔ 老师，与班级消息相互独立' : isStudent ? '发消息给老师' : '发消息到教室大屏' }}
      </span>
      <button
        v-if="pushVisible"
        class="gbtn icon push-toggle"
        :class="{ 'popup-on': pushSubscribed }"
        :disabled="pushBusy"
        :title="pushSubscribed ? '推送通知已开启，点击关闭' : '开启推送通知（关掉页面也能收到消息和考勤/作业提醒）'"
        @click="togglePush"
      >
        <Icon :name="pushSubscribed ? 'bell' : 'bellOff'" :size="18" />
      </button>
    </div>

    <template v-if="activeTab === 'class'">
    <div ref="listEl" class="chat-list" @scroll.passive>
      <div
        v-for="m in chat.messages"
        :key="m.id"
        class="msg-row"
        :class="{
          mine: (m.sender_role === 'teacher' && !isStudent) || (m.sender_role === 'student' && isStudent),
        }"
      >
        <div class="bubble">
          <div class="meta">
            <span>{{ m.sender_name ?? (m.sender_role === 'teacher' ? '老师' : '值日生') }}</span>
            <span class="meta-time">{{ timeLabel(m.created_at) }}</span>
            <button
              v-if="m.sender_role === 'teacher' ? !isStudent : true"
              class="meta-del"
              @click="deleteMsg(m)"
            >删除</button>
          </div>
          <template v-if="m.kind === 'text'">{{ m.body }}</template>
          <template v-else-if="m.kind === 'image'">
            <img :src="chat.mediaSrc(m)" class="chat-img" loading="lazy" @click="previewImage = chat.mediaSrc(m)" />
          </template>
          <template v-else-if="m.kind === 'voice'">
            <button class="voice" @click="playVoice(m)">
              <Icon :name="playingId === m.id ? 'clock' : 'play'" :size="16" />
              {{ ((m.media_duration_ms ?? 0) / 1000).toFixed(1) }}" 语音
            </button>
          </template>
        </div>
      </div>
      <p v-if="!chat.messages.length" class="empty" style="text-align: center; padding: 24px 0">
        还没有消息，打个招呼吧
      </p>
    </div>

    <div class="quickbar">
      <button v-for="p in quickPhrases" :key="p" class="chip-btn" @click="sendQuick(p)">{{ p }}</button>
      <span class="foot-note" style="margin-left: auto; flex: none">在「管理 → 班级设置」自定义</span>
    </div>

    <div class="inputbar">
      <template v-if="!isStudent">
        <button
          class="gbtn icon"
          :class="{ 'popup-on': popupOn }"
          :title="popupOn ? '发送后弹到大屏（点击关闭）' : '发送后不弹大屏（点击开启）'"
          @click="togglePopup"
        >
          <Icon name="monitor" :size="18" />
        </button>
        <button class="gbtn icon" title="发送图片" @click="pickImage"><Icon name="image" :size="18" /></button>
        <button
          class="gbtn icon"
          :class="{ recording }"
          :title="recording ? '停止并发送' : '录语音（最长 60 秒）'"
          @click="toggleRecord"
        >
          <Icon name="mic" :size="18" />
        </button>
      </template>
      <input
        v-model="input"
        class="ginput flex1"
        :placeholder="recording ? `录音中 ${recordSeconds}s，再点麦克风发送` : '输入消息…'"
        maxlength="500"
        :disabled="recording"
        @keyup.enter="sendText"
      />
      <button class="gbtn primary" :disabled="sending || recording || !input.trim()" @click="sendText">
        <Icon name="send" :size="16" /> 发送
      </button>
    </div>
    <p v-if="recording" class="foot-note rec-hint">● 录音中 {{ recordSeconds }}s / 60s —— 点麦克风结束并发送</p>
    </template>

    <!-- 家长留言群组：家长 ↔ 老师，独立于班级聊天 -->
    <template v-else>
      <div ref="parentListEl" class="chat-list" @scroll.passive>
        <div
          v-for="m in chat.parentMessages"
          :key="m.id"
          class="msg-row"
          :class="{ mine: m.sender_type === 'teacher' }"
        >
          <div class="bubble">
            <div class="meta">
              <span class="p-sender" :class="{ 'p-teacher': m.sender_type === 'teacher' }">{{ m.sender_name }}</span>
              <span class="meta-time">{{ parentTimeLabel(m.created_at) }}</span>
              <button
                v-if="m.sender_type === 'parent'"
                class="meta-del p-reply-btn"
                @click="startReply(m)"
              >回复</button>
              <button v-if="!isStudent" class="meta-del" @click="deleteParentMsg(m)">删除</button>
            </div>
            <div v-if="m.reply_name" class="quote-block">回复 <b>{{ m.reply_name }}</b>：{{ clipBody(m.reply_body ?? '') }}</div>
            {{ m.body }}
          </div>
        </div>
        <p v-if="!chat.parentMessages.length" class="empty" style="text-align: center; padding: 24px 0">
          还没有家长留言。家长打开班级的「家长视图」链接即可留言。
        </p>
      </div>
      <p class="foot-note parent-tip">
        家长通过「管理 → 班级设置 → 家长视图」的链接进入留言；回复前先点某条留言的「回复」（家长只能看到与自己孩子相关的对话）。本群组与班级消息互不相通。
      </p>
      <div v-if="!isStudent" class="reply-wrap">
        <div v-if="replyTarget" class="reply-bar">
          <span class="reply-quote">回复 <b>{{ replyTarget.sender_name }}</b>：{{ clipBody(replyTarget.body) }}</span>
          <button class="meta-del" @click="cancelReply">✕</button>
        </div>
        <div v-else class="reply-hint">先点某条留言的「回复」，再输入内容（家长只能看到针对自己孩子的回复）</div>
      </div>
      <div v-if="!isStudent" class="inputbar">
        <input
          v-model="parentInput"
          class="ginput flex1"
          placeholder="回复家长…"
          maxlength="500"
          @keyup.enter="sendReply"
        />
        <button class="gbtn primary" :disabled="sendingReply || !parentInput.trim()" @click="sendReply">
          <Icon name="send" :size="16" /> 回复
        </button>
      </div>
      <div v-else class="inputbar"><span class="hint" style="margin: 0 auto">老师在这里回复家长</span></div>
    </template>

    <p v-if="error || recordError" class="err">{{ error || recordError }}</p>
    <div v-if="toastMsg" class="gtoast">{{ toastMsg }}</div>
  </div>

  <!-- 图片全屏预览 -->
  <Teleport to="body">
    <div v-if="previewImage" class="img-preview" @click="previewImage = null">
      <img :src="previewImage" alt="图片预览" />
    </div>
  </Teleport>
</template>

<style scoped>
.chat-wrap {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 150px);
  min-height: 420px;
  padding: 0;
  overflow: hidden;
}
.chat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.chat-tabs button {
  position: relative;
}
.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  margin-left: 5px;
  border-radius: 999px;
  background: var(--tile-msg, var(--absent));
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.p-sender {
  color: var(--tile-msg, var(--primary));
  font-weight: 600;
}
.p-teacher {
  color: var(--primary);
}
.parent-tip {
  padding: 6px 16px 0;
}
.quote-block {
  font-size: 11.5px;
  color: var(--muted);
  background: var(--field);
  border-left: 3px solid var(--primary);
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quote-block b {
  color: var(--primary);
}
.p-reply-btn {
  color: var(--primary);
}
.p-reply-btn:hover {
  color: var(--primary);
}
.reply-wrap {
  padding: 0 16px;
}
.reply-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--primary-soft);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
}
.reply-bar b {
  color: var(--primary);
}
.reply-quote {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reply-hint {
  font-size: 11.5px;
  color: var(--faint);
}
/* 手机端：头部紧凑（说明文字隐藏，只留连接态+群组切换+推送开关） */
@media (max-width: 860px) {
  .chat-head .hint {
    display: none;
  }
  .chat-head .push-toggle {
    margin-left: auto;
  }
}
.conn-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--faint);
}
.conn-dot.open {
  background: var(--present);
  box-shadow: 0 0 6px var(--present);
}
.conn-dot.connecting,
.conn-dot.retrying {
  background: var(--leave);
  animation: blink 1s infinite;
}
@keyframes blink {
  50% {
    opacity: 0.3;
  }
}
.conn-text {
  font-size: 12.5px;
  color: var(--muted);
  font-weight: 600;
}
.hint {
  margin-left: auto;
}
.push-toggle {
  flex: none;
}
.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.msg-row {
  display: flex;
}
.msg-row.mine {
  justify-content: flex-end;
}
.bubble {
  max-width: 78%;
  background: var(--field);
  border: 1px solid var(--line);
  border-radius: 14px 14px 14px 4px;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg-row.mine .bubble {
  background: var(--primary-soft);
  border-color: var(--primary);
  border-radius: 14px 14px 4px 14px;
}
.meta {
  font-size: 10.5px;
  color: var(--faint);
  margin-bottom: 3px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.meta-time {
  font-variant-numeric: tabular-nums;
}
.meta-del {
  background: none;
  border: none;
  color: var(--faint);
  font-size: 10px;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.meta-del:hover {
  color: var(--absent);
}
.popup-on {
  background: var(--primary-soft) !important;
  color: var(--primary);
  border-color: var(--primary);
}
.chat-img {
  max-width: min(320px, 100%);
  border-radius: 10px;
  display: block;
  cursor: zoom-in;
}
.voice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  border: none;
  background: none;
  color: var(--primary);
  cursor: pointer;
  padding: 0;
}
.quickbar {
  display: flex;
  gap: 6px;
  padding: 8px 16px 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.quickbar::-webkit-scrollbar {
  display: none;
}
.chip-btn {
  flex: none;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--field);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: 0.12s;
}
.chip-btn:hover {
  background: var(--field-hover);
  color: var(--primary);
  border-color: var(--primary);
}
.inputbar {
  display: flex;
  gap: 8px;
  padding: 10px 16px 12px;
}
.flex1 {
  flex: 1;
  min-width: 0;
}
.gbtn.recording {
  background: var(--absent-bg);
  border-color: var(--absent);
  color: var(--absent);
  animation: pulse 1s infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.55;
  }
}
.rec-hint {
  padding: 0 16px 8px;
  color: var(--absent);
  font-weight: 700;
}
.img-preview {
  position: fixed;
  inset: 0;
  background: rgba(6, 10, 22, 0.85);
  z-index: 130;
  display: grid;
  place-items: center;
  padding: 24px;
  cursor: zoom-out;
}
.img-preview img {
  max-width: 96vw;
  max-height: 92vh;
  border-radius: 12px;
}
</style>
