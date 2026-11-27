<script setup lang="ts">
/**
 * 撤销提示条：底部浮起，显示「已保存 xx」+ 撤销按钮 + 关闭。
 * 只在有可撤销操作时出现——平时不占位、不干扰。
 */
import { useUndo } from '@/composables/useUndo'
import Icon from '@/components/Icon.vue'

const undo = useUndo()
</script>

<template>
  <Teleport to="body">
    <div v-if="undo.current.value" class="undo-bar">
      <span class="undo-text">
        <b>{{ undo.current.value.label }}</b>
        <template v-if="undo.depth.value > 1">（还可撤销 {{ undo.depth.value }} 步）</template>
      </span>
      <span v-if="undo.error.value" class="undo-err">{{ undo.error.value }}</span>
      <button class="undo-btn" :disabled="undo.busy.value" @click="undo.undo()">
        <Icon name="undo" :size="14" />
        {{ undo.busy.value ? '撤销中…' : '撤销' }}
      </button>
      <button class="undo-close" title="关闭" @click="undo.dismiss()">
        <Icon name="x" :size="13" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* top 位置在底导航之上；手机上避开安全区 */
.undo-bar {
  position: fixed;
  left: 50%;
  bottom: calc(86px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 119;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(560px, calc(100vw - 24px));
  padding: 9px 10px 9px 14px;
  border-radius: 999px;
  background: var(--panel-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  animation: undo-in 0.2s ease;
}
@media (min-width: 861px) {
  /* 桌面端底导航是侧栏，提示条可以更贴近底部 */
  .undo-bar {
    bottom: 28px;
  }
}
@keyframes undo-in {
  from {
    transform: translate(-50%, 10px);
    opacity: 0;
  }
  to {
    transform: translate(-50%, 0);
    opacity: 1;
  }
}
.undo-text {
  font-size: 12.5px;
  color: var(--muted);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.undo-text b {
  color: var(--text);
  font-weight: 600;
}
.undo-err {
  color: var(--absent);
  font-size: 11.5px;
  flex: none;
}
.undo-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid var(--primary);
  background: var(--primary-soft);
  color: var(--primary);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
.undo-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.undo-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--faint);
  cursor: pointer;
}
.undo-close:hover {
  color: var(--text);
}
</style>
