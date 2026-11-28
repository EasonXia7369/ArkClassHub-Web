<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useDark, useToggle } from '@vueuse/core'
import { useAuthStore } from '@/stores/auth'
import { useClassStore } from '@/stores/class'
import { useChatStore } from '@/stores/chat'
import { useNotify } from '@/composables/useNotify'
import { isDesktop, desktopBridge, type ArkWebSyncState } from '@/utils/platform'
import Icon from '@/components/Icon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import ConsentDialog from '@/components/ConsentDialog.vue'
import UndoBar from '@/components/UndoBar.vue'
import UndoHistory from '@/components/UndoHistory.vue'
import { useEscClose } from '@/composables/useEscClose'
import { useUndo } from '@/composables/useUndo'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const store = useClassStore()
const chat = useChatStore()
const notify = useNotify()

const isDark = useDark({ storageKey: 'ark-theme' })
const toggleDark = useToggle(isDark)

/* 桌面端设置（仅桌面壳显示）：全屏（大板/一体机用）/ 窗口置顶 / 开机自启 / 前端热同步 */
const deskPop = ref(false)
const deskFullscreen = ref(false)
const deskOnTop = ref(false)
const deskAutostart = ref(false)
const webSync = ref<ArkWebSyncState | null>(null)
const syncBusy = ref(false)

async function initDesktopState() {
  try {
    const s = await desktopBridge!.windowState()
    deskFullscreen.value = s.fullscreen
    deskOnTop.value = s.alwaysOnTop
    deskAutostart.value = s.autostart
  } catch {
    /* 状态读取失败不阻塞面板 */
  }
}

async function loadWebSync() {
  try {
    webSync.value = (await desktopBridge?.webSyncState?.()) ?? null
  } catch {
    webSync.value = null
  }
}

async function checkWebSync() {
  if (!desktopBridge?.checkWebSync || syncBusy.value) return
  syncBusy.value = true
  try {
    const r = await desktopBridge.checkWebSync()
    if (r.updated) toast('前端已更新到最新，正在刷新页面')
    else if (r.error) toast('检查更新失败：' + r.error)
    else if (r.skipped) toast(webSync.value?.disabled ? '热同步已被禁用（存在 web-sync-off）' : '无需更新')
    else toast('已是最新版本')
  } catch (e: any) {
    toast('检查更新失败：' + (e.message ?? '未知错误'))
  } finally {
    syncBusy.value = false
  }
  setTimeout(loadWebSync, 1000)
}

/** 前端版本指纹缩写：index-CALAtp8x.js → CALAtp8x */
function shortHash(hash: string | null) {
  return hash ? hash.replace(/^index-/, '').replace(/\.js$/, '') : '—'
}
async function setFullscreen(on: boolean) {
  await desktopBridge!.setFullscreen(on)
  deskFullscreen.value = on
}
async function setOnTop(on: boolean) {
  await desktopBridge!.setAlwaysOnTop(on)
  deskOnTop.value = on
}
async function setAutostart(on: boolean) {
  deskAutostart.value = await desktopBridge!.setAutostart(on)
}
function onDeskKeydown(e: KeyboardEvent) {
  if (e.key === 'F11') {
    e.preventDefault()
    setFullscreen(!deskFullscreen.value)
  }
}
watch(deskPop, (open) => {
  if (open) {
    initDesktopState()
    loadWebSync()
  }
})
onMounted(() => {
  if (isDesktop) window.addEventListener('keydown', onDeskKeydown)
})
onBeforeUnmount(() => {
  if (isDesktop) window.removeEventListener('keydown', onDeskKeydown)
})

const NAV = [
  { to: '/board', name: '大板', icon: 'board', key: 'board' },
  { to: '/attendance', name: '出勤', icon: 'attendance', key: 'attend' },
  { to: '/homework', name: '作业', icon: 'homework', key: 'hw' },
  { to: '/exams', name: '考试', icon: 'exam', key: 'exam' },
  { to: '/messages', name: '消息', icon: 'chat', key: 'msg', badge: true },
  { to: '/manage', name: '管理', icon: 'manage', key: 'manage' },
]

const switching = ref(false)

/**
 * 「消息」红点合计：班级聊天 + 家长留言，两个群组都在消息板块里，
 * 但红点要在板块外（侧栏/底导航）也能看到，否则老师不在消息页时完全无感。
 * 家长留言只在侧栏计数，**不弹窗、不响铃、不推系统通知**（对应 chat.ts 里 parent-message 分支）。
 */
const msgUnread = computed(() => chat.unread + chat.parentUnread)

// 收到消息：提示音 + 系统通知（页面在后台时）；弹层卡片由 chat.popup 驱动
function onIncoming(m: { kind: string; body: string; sender_role: string }) {
  notify.beep('incoming')
  notify.showNotification(
    m.sender_role === 'teacher' ? '老师来消息了' : '大板来消息了',
    m.kind === 'text' ? m.body : m.kind === 'voice' ? '[语音消息]' : '[图片]',
  )
}

async function switchClass(e: Event) {
  const id = Number((e.target as HTMLSelectElement).value)
  switching.value = true
  try {
    await store.switchTo(id)
  } finally {
    switching.value = false
  }
}

function logout() {
  auth.logout()
  chat.reset()
  store.reset()
  router.replace('/login')
}

/* ---------- 服务协议与隐私政策同意（教师/管理员；学生一体机不适用） ---------- */
const consentBusy = ref(false)
const consentError = ref('')

async function agreeConsent() {
  if (consentBusy.value) return
  consentBusy.value = true
  consentError.value = ''
  try {
    await auth.agreeConsent()
  } catch (e: any) {
    consentError.value = e.message
  } finally {
    consentBusy.value = false
  }
}

/** 不同意 → 登出并回到登录页（cookie/令牌一并清除，下次进入须重新选择） */
function declineConsent() {
  logout()
}

/* ---------- toast ---------- */
const toastMsg = ref('')
function toast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => (toastMsg.value = ''), 2600)
}

// 班级就绪后建立消息实时连接；切换班级时重连
watch(
  () => store.current?.id,
  (cid) => {
    if (cid) chat.connect(cid, onIncoming)
    else chat.reset()
  },
)

onMounted(async () => {
  if (!store.loaded) {
    try {
      await store.loadClasses()
      if (store.current) chat.connect(store.current.id, onIncoming)
    } catch {
      /* 未登录等场景由路由守卫处理 */
    }
  }
})

// 消息板块打开时清除未读
watch(
  () => route.path,
  (p) => {
    if (p.startsWith('/messages')) chat.markAllRead()
  },
  { immediate: true },
)

onBeforeUnmount(() => chat.reset())

/* ---------- Esc 关闭桌面设置浮层 / 消息弹层 ----------
 * chat.popup / offlineSummary 是 Pinia store 上的值（已解包），不能直接当 ref 传，
 * 所以包一层 computed 只提供「是否打开」。 */
useEscClose(deskPop, () => (deskPop.value = false))
const msgPopupOpen = computed(() => !!chat.popup)
useEscClose(msgPopupOpen, () => (chat.popup = null))
const offlineOpen = computed(() => !!chat.offlineSummary)
useEscClose(offlineOpen, () => (chat.offlineSummary = null))

/* ---------- 撤销栈：退出/切班级时清空 ----------
 * 撤销是「把旧值写回库里」，跨班级留着会把 A 班的值写到 B 班，所以必须在切换点清掉。
 * 退出登录同理（下一个账号不该看到上一个账号的可撤销操作）。 */
const undo = useUndo()
watch(() => store.current?.id, () => undo.reset())
watch(() => auth.user?.userId, () => undo.reset())

/** 撤销历史面板（侧栏/顶栏按钮打开） */
const undoOpen = ref(false)

/** 手机端「⋯」锚定菜单（iOS 风，从按钮下方弹出） */
const menuOpen = ref(false)
const moreBtn = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

async function openMenu() {
  menuOpen.value = true
  await nextTick()
  const r = moreBtn.value?.getBoundingClientRect()
  if (r) {
    menuStyle.value = {
      top: Math.round(r.bottom + 8) + 'px',
      right: Math.max(12, Math.round(window.innerWidth - r.right)) + 'px',
    }
  }
}
useEscClose(menuOpen, () => (menuOpen.value = false))
</script>

<template>
  <div class="shell">
    <!-- 桌面侧栏 -->
    <aside class="rail glass">
      <button class="rail-logo" title="关于方舟班级中心" @click="router.push('/about')">
        <BrandLogo :size="26" />
      </button>
      <div class="rail-brand">方舟班级中心</div>
      <nav class="rail-nav">
        <RouterLink
          v-for="item in NAV"
          :key="item.to"
          :to="item.to"
          class="rail-item"
          :class="{ on: route.path.startsWith(item.to) }"
        >
          <span
            class="nav-icon-wrap ico-tile"
            :style="{ '--tile-color': `var(--tile-${item.key})`, '--tile-bg': `var(--tile-${item.key}-bg)` }"
          >
            <Icon :name="item.icon" :size="19" />
            <b v-if="item.badge && msgUnread" class="badge">{{ msgUnread > 99 ? '99+' : msgUnread }}</b>
          </span>
          <span>{{ item.name }}</span>
        </RouterLink>
      </nav>
      <div class="rail-foot">
        <!-- 撤销历史：有记录时才出现角标，空的时候仍可点开看说明 -->
        <button class="rail-item" title="撤销历史" @click="undoOpen = true">
          <span class="undo-icon-wrap">
            <Icon name="undo" :size="20" />
            <b v-if="undo.depth.value" class="badge">{{ undo.depth.value > 30 ? '30+' : undo.depth.value }}</b>
          </span>
          <span>撤销</span>
        </button>
        <button v-if="isDesktop" class="rail-item" title="桌面设置" @click="deskPop = !deskPop">
          <Icon name="manage" :size="20" />
          <span>桌面</span>
        </button>
        <button class="rail-item" title="关于" @click="router.push('/about')">
          <Icon name="info" :size="20" />
          <span>关于</span>
        </button>
        <button class="rail-item" :title="isDark ? '切换浅色' : '切换深色'" @click="toggleDark()">
          <Icon :name="isDark ? 'sun' : 'moon'" :size="20" />
          <span>{{ isDark ? '浅色' : '深色' }}</span>
        </button>
        <button class="rail-item" title="退出登录" @click="logout">
          <Icon name="logout" :size="20" />
          <span>退出</span>
        </button>
      </div>
    </aside>

    <div class="main-col">
      <!-- 顶栏 -->
      <header class="topbar" :class="{ wide: route.path.startsWith('/board') }">
        <div class="top-left">
          <h1>{{ store.current?.name ?? '班级中心' }}</h1>
          <select
            v-if="store.classes.length > 1"
            class="gselect cls-switch"
            :value="store.current?.id"
            @change="switchClass"
          >
            <option v-for="c in store.classes" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="top-right">
          <span class="whoami"><span class="whoami-name">{{ auth.user?.name }}</span><i v-if="auth.user?.role === 'admin'">管理员</i><i v-else-if="auth.user?.role === 'student'">值日生</i></span>
          <!-- 手机端收纳：撤销/关于/深浅色/退出 收进「⋯」底部动作面板（≤860px），桌面端这些按钮本就隐藏走侧栏 -->
          <button class="gbtn icon topbtn topbtn-fold" title="撤销历史" @click="undoOpen = true">
            <span class="undo-icon-wrap">
              <Icon name="undo" :size="17" />
              <b v-if="undo.depth.value" class="badge">{{ undo.depth.value > 30 ? '30+' : undo.depth.value }}</b>
            </span>
          </button>
          <button class="gbtn icon topbtn topbtn-fold" title="关于" @click="router.push('/about')">
            <Icon name="info" :size="17" />
          </button>
          <button class="gbtn icon topbtn topbtn-fold" :title="isDark ? '切换浅色' : '切换深色'" @click="toggleDark()">
            <Icon :name="isDark ? 'sun' : 'moon'" :size="17" />
          </button>
          <button class="gbtn icon topbtn topbtn-fold" title="退出登录" @click="logout">
            <Icon name="logout" :size="17" />
          </button>
          <button ref="moreBtn" class="gbtn icon topbtn more-top" title="更多" @click="openMenu">
            <Icon name="more" :size="17" />
          </button>
        </div>
      </header>

      <main class="content" :class="{ switching, wide: route.path.startsWith('/board') }">
        <RouterView />
      </main>
    </div>

    <!-- 手机底部导航 -->
    <nav class="mobilenav glass-strong">
      <RouterLink
        v-for="item in NAV"
        :key="item.to"
        :to="item.to"
        class="mobile-item"
        :class="{ on: route.path.startsWith(item.to) }"
      >
        <span
          class="nav-icon-wrap ico-tile"
          :style="{ '--tile-color': `var(--tile-${item.key})`, '--tile-bg': `var(--tile-${item.key}-bg)` }"
        >
          <Icon :name="item.icon" :size="19" />
          <b v-if="item.badge && msgUnread" class="badge mobile">{{ msgUnread > 99 ? '99+' : msgUnread }}</b>
        </span>
        <span>{{ item.name }}</span>
      </RouterLink>
    </nav>

    <!-- 桌面端设置弹层（仅 Tauri 桌面构建出现） -->
    <Teleport to="body">
      <div v-if="deskPop" class="desk-overlay" @click.self="deskPop = false">
        <div class="desk-pop glass-strong">
          <div class="desk-pop-title">
            <Icon name="manage" :size="15" />
            桌面设置
            <button class="gbtn icon close" @click="deskPop = false"><Icon name="x" :size="14" /></button>
          </div>
          <div class="desk-row">
            <span>全屏模式<small>F11 或点击切换，大板/一体机用</small></span>
            <button class="gbtn gmini" :class="{ primary: deskFullscreen }" @click="setFullscreen(!deskFullscreen)">
              {{ deskFullscreen ? '已开启' : '已关闭' }}
            </button>
          </div>
          <div class="desk-row">
            <span>窗口置顶<small>始终浮在其他窗口上方</small></span>
            <button class="gbtn gmini" :class="{ primary: deskOnTop }" @click="setOnTop(!deskOnTop)">
              {{ deskOnTop ? '已开启' : '已关闭' }}
            </button>
          </div>
          <div class="desk-row">
            <span>开机自启<small>开机后直接进入班级中心</small></span>
            <button class="gbtn gmini" :class="{ primary: deskAutostart }" @click="setAutostart(!deskAutostart)">
              {{ deskAutostart ? '已开启' : '已关闭' }}
            </button>
          </div>
          <div v-if="webSync" class="desk-row">
            <span>
              前端版本
              <small>
                {{ webSync.source === 'live' ? '已同步线上最新' : '内置版本' }} · {{ shortHash(webSync.hash) }}
                <template v-if="webSync.lastError"> · 上次失败</template>
              </small>
            </span>
            <button class="gbtn gmini" :disabled="syncBusy" @click="checkWebSync">检查更新</button>
          </div>
          <button class="gbtn" style="width: 100%; margin-top: 6px" @click="deskPop = false; router.push('/about')">
            关于方舟班级中心
          </button>
          <p class="desk-keys">
            右键：复制/粘贴、图片另存为 · Esc 关闭弹窗 · F11 全屏 · Ctrl+R 重新加载（开发版）
          </p>
        </div>
      </div>
    </Teleport>

    <!-- 离线摘要：上线补拉后发现的离线新消息 -->
    <Teleport to="body">
      <div v-if="chat.offlineSummary && !chat.popup" class="offline-overlay" @click.self="chat.offlineSummary = null">
        <div class="msg-pop glass-strong offline-pop">
          <div class="msg-pop-head">
            <Icon name="chat" :size="16" />
            离线期间收到 {{ chat.offlineSummary.count }} 条新消息
            <button class="gbtn icon close" @click="chat.offlineSummary = null"><Icon name="x" :size="15" /></button>
          </div>
          <div v-if="chat.offlineSummary.last" class="msg-pop-body">
            <p>{{ chat.offlineSummary.last.sender_role === 'teacher' ? '老师' : '值日生' }}：{{ chat.offlineSummary.last.kind === 'text' ? chat.offlineSummary.last.body : '[媒体消息]' }}</p>
          </div>
          <div class="msg-pop-foot">
            <button class="gbtn primary" @click="chat.offlineSummary = null; chat.markAllRead(); router.push('/messages')">查看消息</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 收到消息弹层：一体机（学生）全屏卡片，教师右下角卡片 -->
    <Teleport to="body">
      <div
        v-if="chat.popup"
        class="msg-pop-overlay"
        :class="{ fullscreen: auth.user?.role === 'student' }"
        @click.self="chat.popup = null"
      >
        <div class="msg-pop glass-strong">
          <div class="msg-pop-head">
            <Icon name="chat" :size="16" />
            {{ chat.popup.sender_role === 'teacher' ? '老师' : '值日生' }} 发来消息
            <button class="gbtn icon close" @click="chat.popup = null"><Icon name="x" :size="15" /></button>
          </div>
          <div class="msg-pop-body">
            <img
              v-if="chat.popup.kind === 'image' && chat.popup.class_id"
              :src="chat.mediaSrc(chat.popup)"
              alt="图片消息"
            />
            <p v-else-if="chat.popup.kind === 'voice'" class="voice-hint">
              [语音消息 {{ ((chat.popup.media_duration_ms ?? 0) / 1000).toFixed(0) }} 秒] —— 到「消息」板块收听
            </p>
            <p v-else>{{ chat.popup.body }}</p>
          </div>
          <div class="msg-pop-foot">
            <button class="gbtn primary" @click="chat.popup = null; router.push('/messages')">
              打开消息板块
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <div v-if="toastMsg" class="gtoast">{{ toastMsg }}</div>

    <!-- 撤销提示条：有可撤销操作时浮在底部（与 gtoast 互斥排队见 useUndo） -->
    <UndoBar />
    <!-- 撤销历史面板：侧栏/顶栏按钮打开 -->
    <UndoHistory :open="undoOpen" @close="undoOpen = false" />

    <!-- 手机端「⋯」锚定菜单（iOS 风）：撤销/关于/深浅色/退出 -->
    <Teleport to="body">
      <div v-if="menuOpen" class="menu-backdrop" @click.self="menuOpen = false" @contextmenu.prevent="menuOpen = false">
        <div class="top-menu glass-strong" :style="menuStyle">
          <button class="menu-item" @click="menuOpen = false; undoOpen = true">
            <Icon name="undo" :size="17" />
            <span class="mi-label">撤销历史</span>
            <b v-if="undo.depth.value" class="mi-badge">{{ undo.depth.value > 30 ? '30+' : undo.depth.value }}</b>
            <Icon name="chevronRight" :size="14" />
          </button>
          <div class="menu-sep" />
          <button class="menu-item" @click="menuOpen = false; router.push('/about')">
            <Icon name="info" :size="17" />
            <span class="mi-label">关于方舟班级中心</span>
            <Icon name="chevronRight" :size="14" />
          </button>
          <div class="menu-sep" />
          <button class="menu-item" @click="toggleDark()">
            <Icon :name="isDark ? 'sun' : 'moon'" :size="17" />
            <span class="mi-label">{{ isDark ? '切换到浅色模式' : '切换到深色模式' }}</span>
            <span class="mi-state">{{ isDark ? '深色' : '浅色' }}</span>
          </button>
          <div class="menu-sep" />
          <button class="menu-item danger" @click="menuOpen = false; logout()">
            <Icon name="logout" :size="17" />
            <span class="mi-label">退出登录</span>
          </button>
        </div>
      </div>
    </Teleport>

    <!-- 首次访问（或协议改版后）强制同意：不勾选不能进入 -->
    <ConsentDialog
      v-if="auth.needsConsent"
      :busy="consentBusy"
      :error="consentError"
      decline-text="不同意并退出"
      @agree="agreeConsent"
      @decline="declineConsent"
    />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}
.nav-icon-wrap {
  position: relative;
  display: inline-flex;
}
/* 撤销按钮的角标容器（顶栏与侧栏共用） */
.undo-icon-wrap {
  position: relative;
  display: inline-flex;
}
/* 选中行：tile 已带板块色，行高亮改为中性玻璃提亮，避免「全蓝」单一印象 */
.rail-item.on {
  background: var(--field);
  color: var(--text);
}
.mobile-item.on {
  background: var(--field);
  color: var(--text);
}
.badge {
  position: absolute;
  top: -6px;
  right: -10px;
  background: var(--absent);
  color: #fff;
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 999px;
  font-style: normal;
}
.badge.mobile {
  top: -4px;
  right: -8px;
}

/* 消息弹层 */
.msg-pop-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 20px;
  pointer-events: none;
}
.msg-pop-overlay.fullscreen {
  align-items: center;
  justify-content: center;
  background: rgba(6, 10, 22, 0.45);
  pointer-events: auto;
}
.msg-pop {
  width: min(360px, 92vw);
  padding: 14px 16px;
  pointer-events: auto;
  animation: pop-in 0.25s ease;
}
.fullscreen .msg-pop {
  width: min(560px, 94vw);
}
@keyframes pop-in {
  from {
    transform: translateY(12px) scale(0.97);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
.msg-pop-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 13.5px;
  color: var(--primary);
  margin-bottom: 8px;
}
.msg-pop-head .close {
  margin-left: auto;
}
.msg-pop-body {
  font-size: 15px;
  line-height: 1.7;
  word-break: break-word;
  white-space: pre-wrap;
}
.msg-pop-body img {
  max-width: 100%;
  max-height: 50vh;
  border-radius: 10px;
  display: block;
}
.voice-hint {
  color: var(--muted);
  margin: 0;
}
.msg-pop-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

/* 侧栏 */
.rail {
  position: sticky;
  top: 0;
  height: 100vh;
  width: 84px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border-top: none;
  border-bottom: none;
  border-left: none;
  padding: 14px 10px;
  gap: 8px;
  z-index: 40;
}
.rail-brand {
  text-align: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}
.rail-logo {
  width: 44px;
  height: 44px;
  margin: 0 auto 6px;
  border-radius: 14px;
  border: none;
  background: linear-gradient(135deg, #4f6ef7, #2f49b2);
  color: #fff;
  display: grid;
  place-items: center;
  flex: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.rail-nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}
.rail-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 4px 8px;
  border-radius: var(--radius-sm);
  color: var(--muted);
  text-decoration: none;
  font-size: 11px;
  font-weight: 600;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
.rail-item:hover {
  background: var(--field);
  color: var(--text);
}
.rail-item.on {
  background: var(--primary-soft);
  color: var(--primary);
}
.rail-foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 主列 */
.main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 24px 0;
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
}
/* 大板路由：顶栏解除限宽，班级名与账号区随内容区铺满对齐 */
.topbar.wide {
  max-width: none;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.top-left h1 {
  margin: 0;
  font-size: 18px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cls-switch {
  padding: 5px 9px;
  font-size: 12.5px;
  width: auto;
}
.top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.topbtn {
  flex: none;
}
/* 桌面端深浅色/退出在侧栏底部，顶栏图标按钮仅手机端（侧栏隐藏时）出现。
 * 撤销历史同理：桌面端走侧栏底部那个按钮，顶栏这个自动被这条规则一并隐藏。 */
@media (min-width: 861px) {
  .gbtn.icon.topbtn {
    display: none;
  }
}
.whoami {
  font-size: 12.5px;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.whoami i {
  font-style: normal;
  font-size: 10.5px;
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-soft);
  padding: 2px 7px;
  border-radius: 999px;
}
.content {
  flex: 1;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 14px 24px 40px;
  transition: opacity 0.15s;
}
/* 大板路由解除限宽：展示页铺满剩余宽度（自适应缩放的布局前提） */
.content.wide {
  max-width: none;
}
.content.switching {
  opacity: 0.4;
  pointer-events: none;
}

/* 手机底部导航 */
.mobilenav {
  display: none;
}

@media (max-width: 860px) {
  .rail {
    display: none;
  }
  .mobilenav {
    display: flex;
    position: fixed;
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    width: min(420px, calc(100vw - 20px));
    justify-content: space-around;
    padding: 6px;
    z-index: 50;
  }
  .mobile-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 14px;
    border-radius: 12px;
    color: var(--muted);
    text-decoration: none;
    font-size: 10.5px;
    font-weight: 600;
    transition: background 0.15s, color 0.15s;
  }
  .mobile-item.on {
    background: var(--primary-soft);
    color: var(--primary);
  }
  .topbar {
    padding: 12px 16px 0;
  }
  /* 窄屏顶栏：账号信息藏进「关于」页，把空间还给班级名（长名不再截断） */
  .whoami {
    display: none;
  }
  /* 班级名优先完整显示，班级切换下拉收窄 */
  .topbar h1 {
    flex: none;
    max-width: 38vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cls-switch {
    max-width: 118px;
    padding-left: 6px;
    padding-right: 22px;
    font-size: 13px;
  }
  .top-right .topbtn {
    padding: 8px 9px;
  }
  .top-right {
    gap: 6px;
  }
  /* 顶栏收纳：撤销/关于/深浅色/退出 隐藏，只留「⋯」（底部动作面板） */
  .gbtn.icon.topbtn.topbtn-fold {
    display: none;
  }
  .content {
    padding: 12px 16px calc(84px + env(safe-area-inset-bottom));
  }
}
/* ---------- 手机端「⋯」锚定菜单（iOS 风，按钮下方弹出） ---------- */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  /* iOS 菜单：背景不变暗，点击空白处即关闭 */
  background: transparent;
}
.top-menu {
  position: fixed;
  width: min(250px, 78vw);
  padding: 5px;
  border-radius: 16px;
  transform-origin: top right;
  animation: menu-in 0.18s var(--ease-spring);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.22), var(--glass-inset);
}
@keyframes menu-in {
  from {
    transform: scale(0.9);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 12px 10px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 14.5px;
  color: var(--text);
  cursor: pointer;
  border-radius: 11px;
  text-align: left;
}
.menu-item:active {
  background: var(--field);
}
.menu-item .mi-label {
  flex: 1;
  font-weight: 500;
}
.menu-item .mi-badge {
  font-size: 11.5px;
  font-weight: 700;
  background: var(--primary-soft);
  color: var(--primary);
  padding: 2px 9px;
  border-radius: 999px;
  font-variant-numeric: tabular-nums;
}
.menu-item .mi-state {
  font-size: 12px;
  color: var(--muted);
}
.menu-item.danger {
  color: var(--absent);
}
.menu-sep {
  height: 1px;
  background: var(--line-soft);
  margin: 3px 10px;
}

.offline-overlay {
  position: fixed;
  inset: 0;
  z-index: 115;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 20px;
  pointer-events: none;
}
.offline-pop {
  pointer-events: auto;
  animation: pop-in var(--dur-med) var(--ease-spring);
}

/* 桌面设置弹层 */
.desk-overlay {
  position: fixed;
  inset: 0;
  z-index: 118;
  display: flex;
  align-items: flex-end;
  justify-content: flex-start;
  padding: 16px;
  pointer-events: auto;
}
.desk-pop {
  position: fixed;
  left: 96px;
  bottom: 20px;
  width: min(300px, 92vw);
  padding: 14px;
  animation: pop-in 0.2s ease;
}
.desk-pop-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 700;
  font-size: 13.5px;
  color: var(--primary);
  margin-bottom: 10px;
}
.desk-pop-title .close {
  margin-left: auto;
}
.desk-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 0;
}
.desk-row > span {
  display: flex;
  flex-direction: column;
  font-size: 13.5px;
  font-weight: 600;
}
.desk-row small {
  font-weight: 400;
  font-size: 11px;
  color: var(--muted);
}
.desk-keys {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
  font-size: 11px;
  line-height: 1.6;
  color: var(--muted);
}
</style>
