<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  AlarmClock,
  Bell,
  BellOff,
  Calendar,
  CalendarOff,
  ChartColumn,
  Check,
  ChevronLeft,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Download,
  Image as ImageIcon,
  Info,
  LayoutDashboard,
  Lock,
  LogOut,
  MessageCircle,
  Mic,
  Monitor,
  Moon,
  Play,
  Plus,
  Quote,
  Send,
  Settings,
  Sparkles,
  Sun,
  TriangleAlert,
  Undo2,
  Upload,
  UserCog,
  Users,
  UserX,
  X,
} from 'lucide-vue-next'

/**
 * 全站图标：统一走 lucide-vue-next（shadcn-vue 原生图标包），不自绘。
 * 语义名保持旧名不变（调用点无需改动），1.7px 描边延续原视觉风格。
 * LOGO 不在此（BrandLogo.vue 独立绘制）。
 */
const MAP: Record<string, Component> = {
  board: LayoutDashboard,
  attendance: ClipboardCheck,
  homework: ClipboardList,
  exam: ChartColumn,
  chat: MessageCircle,
  manage: UserCog,
  settings: Settings,
  users: Users,
  calendar: Calendar,
  clock: Clock,
  download: Download,
  upload: Upload,
  lock: Lock,
  monitor: Monitor,
  plus: Plus,
  x: X,
  check: Check,
  chevronLeft: ChevronLeft,
  sun: Sun,
  moon: Moon,
  bell: Bell,
  bellOff: BellOff,
  play: Play,
  mic: Mic,
  image: ImageIcon,
  info: Info,
  quote: Quote,
  send: Send,
  sparkles: Sparkles,
  logout: LogOut,
  undo: Undo2,
  /* ---------- 考勤状态（原 ✓⭕□×△ 符号换成矢量图标） ----------
   * 语义与配色对应 --present/--leave/--late/--absent/--violate */
  statusPresent: CircleCheck,
  statusLeave: CalendarOff,
  statusLate: AlarmClock,
  statusAbsent: UserX,
  statusViolate: TriangleAlert,
}

const props = defineProps<{ name: string; size?: number }>()

const icon = computed(() => MAP[props.name] ?? Check)
</script>

<template>
  <component :is="icon" :size="size ?? 18" :stroke-width="1.7" />
</template>
