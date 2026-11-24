<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { get } from '@/api'

const RELATIONS = ['爸爸', '妈妈', '爷爷', '奶奶', '外公', '外婆', '其他']
const router = useRouter()
const code = ref('')
const rel = ref('妈妈')
const error = ref('')
const busy = ref(false)

async function enter() {
  const c = code.value.trim()
  if (!/^\d{6}$/.test(c) || busy.value) return
  error.value = ''
  busy.value = true
  try {
    const res = await get<{ key: string; class_name: string }>(
      `/api/parent-lookup-code?code=${encodeURIComponent(c)}`,
    )
    await router.push(`/parent/${res.key}?rel=${encodeURIComponent(rel.value)}`)
  } catch (e: any) {
    error.value = e.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="gate-page">
    <header class="head">
      <div class="logo-row">
        <svg width="44" height="44" viewBox="0 0 128 128">
          <defs>
            <linearGradient id="pgl" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#4f8dff" />
              <stop offset="1" stop-color="#2f49b2" />
            </linearGradient>
          </defs>
          <rect width="128" height="128" rx="30" fill="url(#pgl)" />
          <g fill="#fff">
            <path d="M30 74 L98 74 Q96 92 64 94 Q32 92 30 74 Z" opacity=".96" />
            <path d="M60 40 L72 30 V70 H60 Z" opacity=".55" />
          </g>
          <path d="M62 56 L70 64 L86 42" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <div>
          <div class="brand">方舟班级中心</div>
          <div class="brand-en">ARK CLASS HUB</div>
        </div>
      </div>
      <h1>家长入口</h1>
      <p class="sub">输入班主任提供的 6 位班级码，进入孩子的班级视图</p>
    </header>

    <section class="card">
      <div class="code-row">
        <input
          v-model="code"
          class="ginput code-input num"
          inputmode="numeric"
          placeholder="000000"
          maxlength="6"
          autofocus
          @keyup.enter="enter"
        />
        <button class="gbtn primary" :disabled="busy || !/^\d{6}$/.test(code.trim())" @click="enter">
          {{ busy ? '查询中…' : '进入' }}
        </button>
      </div>
      <div class="rel-row">
        <span class="rel-label">我的身份</span>
        <select v-model="rel" class="gselect rel-sel">
          <option v-for="r in RELATIONS" :key="r" :value="r">{{ r }}</option>
        </select>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
      <p class="foot-note">进入后输入孩子的身份证后六位即可绑定：查看 TA 的出勤、给老师留言。</p>
    </section>

    <footer class="foot">方舟班级中心 · Ark Class Hub</footer>
  </div>
</template>

<style scoped>
.gate-page {
  max-width: 480px;
  margin: 0 auto;
  padding: 56px 20px 64px;
}
.head {
  margin-bottom: 24px;
}
.logo-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.brand {
  font-size: 15px;
  font-weight: 600;
}
.brand-en {
  font-size: 10px;
  letter-spacing: 0.3em;
  color: var(--faint);
}
h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.sub {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 14px;
}
.card {
  background: var(--panel-strong);
  border: 1px solid rgba(0, 0, 0, 0.07);
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
}
.code-row {
  display: flex;
  gap: 10px;
}
.rel-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.rel-label {
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
  flex: none;
}
.rel-sel {
  flex: 1;
}
.code-input {
  flex: 1;
  min-width: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.35em;
  text-align: center;
  padding: 10px 8px 10px 20px;
}
.err {
  color: var(--absent);
  font-size: 12.5px;
  margin: 10px 0 0;
}
.foot-note {
  margin: 14px 0 0;
}
.foot {
  text-align: center;
  color: var(--faint);
  font-size: 12px;
  margin-top: 28px;
}
</style>
