<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { API_BASE } from '@/api'
import { desktopBridge, type ArkWebSyncState } from '@/utils/platform'
import BrandLogo from '@/components/BrandLogo.vue'

/** 当前前端构建指纹（与热同步的版本对比口径一致）：入口 JS 文件名里的哈希 */
function frontHash(): string | null {
  const src = (document.querySelector('script[type="module"][src]') as HTMLScriptElement | null)?.src ?? ''
  return (src.match(/assets\/(index-[A-Za-z0-9_-]+)/) || [])[1] || null
}

const front = ref(frontHash())
const buildAt = ref('')
try {
  buildAt.value = new Date(__BUILD_AT__).toLocaleString('zh-CN', { hour12: false })
} catch {
  buildAt.value = ''
}

/** 桌面壳版本（1.0.3+ 壳提供）；浏览器端为 null */
const shellVersion = ref<string | null>(null)
/** 前端热同步状态（桌面端） */
const sync = ref<ArkWebSyncState | null>(null)
/** 后端健康状态 */
const api = ref<{ ok: boolean; latency: number } | null>(null)

onMounted(async () => {
  try {
    shellVersion.value = (await desktopBridge?.version?.()) ?? null
    sync.value = (await desktopBridge?.webSyncState?.()) ?? null
  } catch {
    /* 旧壳/浏览器无此桥接 */
  }
  const t0 = performance.now()
  try {
    const res = await fetch(`${API_BASE}/api/health?t=${Date.now()}`, { cache: 'no-store' })
    await res.json()
    api.value = { ok: res.ok, latency: Math.round(performance.now() - t0) }
  } catch {
    api.value = { ok: false, latency: Math.round(performance.now() - t0) }
  }
})
</script>

<template>
  <div class="about">
    <div class="glass card">
      <div class="brand">
        <div class="logo-row">
          <BrandLogo :size="40" />
          <div>
            <div class="cn">方舟班级中心</div>
            <div class="en">ARK CLASS HUB</div>
          </div>
        </div>
        <p class="intro">面向学校班级的轻量事务平台：出勤、作业、值日、消息与公告，一间教室的全部日常。</p>
      </div>

      <div class="sec">
        <h3>版本信息</h3>
        <div class="kv">
          <span class="k">前端构建</span>
          <span class="v"><b class="num">{{ front ?? 'dev' }}</b><span v-if="buildAt" class="muted"> · 构建于 {{ buildAt }}</span></span>
        </div>
        <div class="kv">
          <span class="k">运行环境</span>
          <span class="v">
            <template v-if="desktopBridge">{{ shellVersion ? `桌面端 v${shellVersion}` : '桌面端' }}</template>
            <template v-else>网页版（浏览器 / PWA）</template>
          </span>
        </div>
        <div v-if="desktopBridge && sync" class="kv">
          <span class="k">前端热同步</span>
          <span class="v">
            <template v-if="sync.disabled">已禁用（web-sync-off）</template>
            <template v-else>
              {{ sync.source === 'live' ? '已同步线上最新' : '内置版本' }}
              <span class="muted"> · {{ sync.hash ? sync.hash.replace(/^index-/, '').replace(/\.js$/, '') : '—' }}</span>
              <span v-if="sync.lastCheck" class="muted"> · 检查于 {{ new Date(sync.lastCheck).toLocaleTimeString('zh-CN', { hour12: false }) }}</span>
            </template>
          </span>
        </div>
        <div class="kv">
          <span class="k">后端服务</span>
          <span class="v">
            <template v-if="api === null">检测中…</template>
            <template v-else-if="api.ok">在线<span class="muted"> · 延迟 {{ api.latency }} ms</span></template>
            <template v-else>无法连接</template>
          </span>
        </div>
      </div>

      <div class="sec">
        <h3>开源与许可</h3>
        <p class="line">本项目以 <b>GPL-3.0</b> 协议开源：</p>
        <div class="links">
          <a href="https://github.com/EasonXia7369/ArkClassHub-Web" target="_blank" rel="noopener">ArkClassHub-Web</a>
          <a href="https://github.com/EasonXia7369/ArkClassHub-Server" target="_blank" rel="noopener">ArkClassHub-Server</a>
          <a href="https://github.com/EasonXia7369/ArkClassHub-Desktop" target="_blank" rel="noopener">ArkClassHub-Desktop</a>
        </div>
      </div>

      <div class="sec">
        <h3>版权信息</h3>
        <p class="line">© 2024-2026 MacroSTAR Studio All rights reserved.</p>
        <div class="links">
          <a href="https://macrostar.top/" target="_blank" rel="noopener">宏维星智智慧科技官网</a>
        <router-link to="/terms">服务协议</router-link>
          <router-link to="/privacy">隐私政策</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about {
  display: grid;
  place-items: center;
  padding: 12px 0 4px;
}
.card {
  width: min(560px, 94vw);
  padding: 26px 28px 22px;
}
.brand .logo-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.cn {
  font-size: 17px;
  font-weight: 600;
  color: var(--text);
}
.en {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.32em;
  color: var(--faint);
  margin-top: 2px;
}
.intro {
  margin: 14px 0 0;
  font-size: 13.5px;
  color: var(--muted);
  line-height: 1.8;
}
.sec {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}
.sec h3 {
  margin: 0 0 10px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
}
.kv {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 4px 0;
  font-size: 13px;
}
.k {
  flex: none;
  width: 88px;
  color: var(--muted);
}
.v {
  color: var(--text);
  word-break: break-all;
}
.muted {
  color: var(--faint);
  font-size: 12px;
}
.num {
  font-variant-numeric: tabular-nums;
}
.line {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--muted);
}
.links {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 13px;
}
.links a {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
}
.links a:hover {
  text-decoration: underline;
}
</style>
