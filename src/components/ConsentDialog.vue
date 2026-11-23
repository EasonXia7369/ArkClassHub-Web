<script setup lang="ts">
/**
 * 首次访问同意弹窗（大厂 App 式）：全屏、遮罩不可点关、
 * 要点摘要 + 新标签看全文、勾选后才能继续。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import BrandLogo from '@/components/BrandLogo.vue'
import Icon from '@/components/Icon.vue'

withDefaults(
  defineProps<{
    /** 提交中（禁用按钮） */
    busy?: boolean
    /** 提交失败提示 */
    error?: string
    /** 「不同意」按钮文案：教师是退出，家长是返回入口 */
    declineText?: string
  }>(),
  { busy: false, error: '', declineText: '不同意并退出' },
)

const emit = defineEmits<{ agree: []; decline: [] }>()

const checked = ref(false)

// 锁定背景滚动（弹窗自身可滚），关闭时还原
const prevOverflow = ref('')
onMounted(() => {
  prevOverflow.value = document.body.style.overflow
  document.body.style.overflow = 'hidden'
})
onBeforeUnmount(() => {
  document.body.style.overflow = prevOverflow.value
})

const points = [
  {
    icon: 'users',
    title: '我们收集哪些信息',
    body: '姓名、学号、班级，以及考勤、作业、考试成绩等教学管理记录。不收集完整身份证号、人脸、指纹或地理位置。',
  },
  {
    icon: 'lock',
    title: '敏感信息如何保护',
    body: '身份证后六位只保存不可逆的加密校验值——包括管理员在内的任何人都无法查看或还原，也不会进入二维码或 AI 服务。',
  },
  {
    icon: 'info',
    title: '未成年人信息',
    body: '学生均为未成年人，家长完成孩子绑定即视为监护人同意；信息仅用于教学管理，家长只能看到自己孩子的数据。',
  },
  {
    icon: 'sparkles',
    title: 'AI 与第三方',
    body: 'AI 功能由教师手动触发，统计类数据默认脱敏。唯一例外是「成绩单智能导入」，教师确认后可发送成绩单原文。',
  },
]
</script>

<template>
  <Teleport to="body">
    <div class="consent-backdrop">
      <div class="consent-box" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <header class="consent-head">
          <BrandLogo :size="48" />
          <div>
            <h2 id="consent-title">服务协议与隐私政策</h2>
            <p class="consent-sub">方舟班级中心 · Ark Class Hub</p>
          </div>
        </header>

        <p class="consent-lead">
          欢迎使用方舟班级中心。开始使用前，请阅读并同意以下条款。要点如下，完整内容见两份文件：
        </p>

        <ul class="consent-points">
          <li v-for="p in points" :key="p.title">
            <span class="point-icon"><Icon :name="p.icon" :size="15" /></span>
            <div>
              <b>{{ p.title }}</b>
              <p>{{ p.body }}</p>
            </div>
          </li>
        </ul>

        <p class="consent-links">
          查看全文：
          <a href="/terms" target="_blank" rel="noopener">《服务协议》</a>
          <a href="/privacy" target="_blank" rel="noopener">《隐私政策》</a>
        </p>

        <label class="consent-check">
          <input v-model="checked" type="checkbox" />
          <span>我已阅读并同意《服务协议》与《隐私政策》</span>
        </label>

        <p v-if="error" class="consent-err">{{ error }}</p>

        <div class="consent-acts">
          <button class="gbtn" @click="emit('decline')">{{ declineText }}</button>
          <button class="gbtn primary" :disabled="!checked || busy" @click="emit('agree')">
            {{ busy ? '提交中…' : '同意并继续' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.consent-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200; /* 高于普通弹层（90）与 toast */
  background: rgba(6, 10, 22, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: grid;
  place-items: center;
  padding: 16px;
  overflow-y: auto;
}
.consent-box {
  width: min(560px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: var(--panel-strong);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 24px 24px 20px;
  animation: consent-in 0.3s var(--ease-spring);
}
@keyframes consent-in {
  from {
    transform: translateY(16px) scale(0.97);
    opacity: 0;
  }
}
.consent-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.consent-head h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.consent-sub {
  margin: 3px 0 0;
  font-size: 11.5px;
  color: var(--faint);
  letter-spacing: 0.04em;
}
.consent-lead {
  margin: 0 0 14px;
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--muted);
}
.consent-points {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.consent-points li {
  display: flex;
  gap: 10px;
  background: var(--field);
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  padding: 11px 13px;
}
.point-icon {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: var(--primary-soft);
  color: var(--primary);
  display: grid;
  place-items: center;
  margin-top: 1px;
}
.consent-points b {
  font-size: 13px;
  display: block;
  margin-bottom: 3px;
}
.consent-points p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--muted);
}
.consent-links {
  margin: 0 0 14px;
  font-size: 13px;
  color: var(--muted);
}
.consent-links a {
  color: var(--primary);
  text-decoration: none;
  font-weight: 600;
  margin-left: 2px;
}
.consent-links a:hover {
  text-decoration: underline;
}
.consent-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--field);
  border: 1px solid var(--line-soft);
}
.consent-check input {
  margin: 3px 0 0;
  width: 15px;
  height: 15px;
  flex: none;
  accent-color: var(--primary);
  cursor: pointer;
}
.consent-err {
  margin: 10px 0 0;
  font-size: 12.5px;
  color: var(--absent);
}
.consent-acts {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}
.consent-acts .gbtn {
  flex: 1;
  justify-content: center;
}

/* 手机端：收紧内边距，按钮上下排更易点 */
@media (max-width: 560px) {
  .consent-box {
    padding: 18px 16px 16px;
    max-height: calc(100vh - 24px);
  }
  .consent-head h2 {
    font-size: 16.5px;
  }
  .consent-points li {
    padding: 10px 11px;
  }
  .consent-acts {
    flex-direction: column-reverse;
  }
  .consent-acts .gbtn {
    width: 100%;
    padding: 11px;
  }
}
</style>