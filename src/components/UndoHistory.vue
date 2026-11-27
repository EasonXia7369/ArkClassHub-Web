<script setup lang="ts">
/**
 * 撤销历史面板：列出最近做过的操作，可以从栈顶往下连续回退。
 *
 * 为什么是「撤销到某条」而不是「撤那一条」：
 * 撤销靠的是「把旧值写回」，后面的操作依赖前面的状态；跳过中间那条直接撤更早的，
 * 会让中间那条的旧值变成错的。所以点中间某条 = 连同它上面的都撤掉，按钮上直接写清步数。
 */
import { computed } from 'vue'
import { useUndo } from '@/composables/useUndo'
import Icon from '@/components/Icon.vue'
import { useEscClose } from '@/composables/useEscClose'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const undo = useUndo()
const isOpen = computed(() => props.open)
useEscClose(isOpen, () => emit('close'))

const KIND_META: Record<string, { label: string; color: string }> = {
  attendance: { label: '考勤', color: 'var(--leave)' },
  homework: { label: '作业', color: 'var(--primary)' },
  exam: { label: '考试', color: 'var(--violate)' },
  other: { label: '其他', color: 'var(--muted)' },
}

/** 该条之上还有几步（含自己 = 需要撤几步） */
const stepsFor = (id: number) => {
  const list = undo.history.value
  const idx = list.findIndex((x) => x.id === id)
  return idx + 1
}

async function undoTo(id: number) {
  const n = stepsFor(id)
  const msg =
    n === 1
      ? '撤销这一步？'
      : `恢复这一步需要先撤销它上面 ${n - 1} 步（共 ${n} 步），继续？`
  if (!confirm(msg)) return
  const okDone = await undo.undoTo(id)
  if (okDone && !undo.history.value.length) emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="undo-overlay" @click.self="emit('close')">
      <div class="undo-panel glass-strong">
        <div class="undo-panel-head">
          <Icon name="undo" :size="16" />
          <b>撤销历史</b>
          <span class="undo-count">{{ undo.depth.value }} 步</span>
          <button class="gbtn icon close" title="关闭" @click="emit('close')">
            <Icon name="x" :size="14" />
          </button>
        </div>

        <p v-if="undo.error.value" class="undo-panel-err">{{ undo.error.value }}</p>

        <p v-if="!undo.history.value.length" class="undo-panel-empty">
          还没有可撤销的操作。改过的考勤、作业名单会记在这里（刷新页面后清空）。
        </p>

        <div v-else class="undo-list">
          <button
            v-for="(item, i) in undo.history.value"
            :key="item.id"
            class="undo-row"
            :disabled="undo.busy.value"
            @click="undoTo(item.id)"
          >
            <span
              class="undo-kind"
              :style="{ color: KIND_META[item.kind ?? 'other'].color }"
            >{{ KIND_META[item.kind ?? 'other'].label }}</span>
            <span class="undo-label">{{ item.label }}</span>
            <span class="undo-time">{{ undo.relTime(item.at) }}</span>
            <span class="undo-act">
              {{ i === 0 ? '撤销' : `撤销 ${i + 1} 步` }}
            </span>
          </button>
        </div>

        <p class="undo-panel-foot">
          撤销 = 把数据写回当时的样子。要撤较早的一步，它之后的操作会一起回退；闲置 30 分钟后历史自动清空。
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.undo-overlay {
  position: fixed;
  inset: 0;
  z-index: 118;
  background: rgba(6, 10, 22, 0.32);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow-y: auto;
}
.undo-panel {
  width: min(460px, 94vw);
  max-height: min(72vh, 620px);
  margin: auto;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  padding: 14px 16px;
  animation: pop-in var(--dur-med) var(--ease-spring);
}
.undo-panel-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  color: var(--primary);
  flex: none;
}
.undo-count {
  font-size: 11px;
  color: var(--muted);
  background: var(--field);
  padding: 2px 8px;
  border-radius: 999px;
}
.undo-panel-head .close {
  margin-left: auto;
}
.undo-panel-err {
  color: var(--absent);
  font-size: 12px;
  margin: 8px 0 0;
  flex: none;
}
.undo-panel-empty {
  color: var(--faint);
  font-size: 12.5px;
  line-height: 1.7;
  margin: 14px 0;
}
.undo-list {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  margin: 10px -4px 0;
  padding: 0 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.undo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 10px;
  border: 1px solid var(--line-soft);
  background: var(--field);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.12s;
}
.undo-row:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--primary-soft);
}
.undo-row:disabled {
  opacity: 0.6;
  cursor: default;
}
.undo-kind {
  flex: none;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--panel-strong);
}
.undo-label {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.undo-time {
  flex: none;
  font-size: 11px;
  color: var(--faint);
}
.undo-act {
  flex: none;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--primary);
}
.undo-panel-foot {
  flex: none;
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--faint);
}
@media (max-width: 700px) {
  .undo-panel {
    width: 100%;
    max-height: calc(100dvh - 20px);
    margin: 0;
  }
}
</style>
