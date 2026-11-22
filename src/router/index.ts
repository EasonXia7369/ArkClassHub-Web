import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { getToken } from '@/api'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/board' },
    {
      path: '/activate',
      name: 'activate',
      component: () => import('@/views/Activate.vue'),
      meta: { public: true },
    },
    {
      // 法律文档（公开）
      path: '/terms',
      name: 'terms',
      component: () => import('@/views/TermsView.vue'),
      meta: { public: true },
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/views/PrivacyView.vue'),
      meta: { public: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
      meta: { public: true },
    },
    {
      // 关于页：登录后在壳内展示（品牌/版本/热同步状态/后端健康/开源许可，无敏感数据）
      path: '/about',
      name: 'about',
      component: () => import('@/views/AboutView.vue'),
    },
    {
      // 家长入口页：输 6 位班级码进入班级视图
      path: '/parent',
      name: 'parent-gate',
      component: () => import('@/views/ParentGate.vue'),
      meta: { public: true },
    },
    {
      // 家长视图（脱敏）：凭链接或班级码进入，学号绑定孩子
      path: '/parent/:key',
      name: 'parent',
      component: () => import('@/views/ParentView.vue'),
      meta: { public: true },
    },
    {
      // 一体机入口：学生密码解锁 → 进入大板（学生身份）
      path: '/kiosk',
      name: 'kiosk',
      component: () => import('@/views/KioskGate.vue'),
      meta: { public: true },
    },
    {
      // 大板：班主任首页 / 教室一体机大屏（同一页面两种角色）
      path: '/board',
      name: 'board',
      component: () => import('@/views/BoardView.vue'),
    },
    {
      path: '/attendance',
      name: 'attendance',
      component: () => import('@/views/AttendanceView.vue'),
    },
    {
      path: '/homework',
      name: 'homework',
      component: () => import('@/views/HomeworkView.vue'),
    },
    {
      // 考试成绩板块（教师全权；家长凭学号绑定后在家长视图查看自己孩子）
      path: '/exams',
      name: 'exams',
      component: () => import('@/views/ExamsView.vue'),
    },
    {
      path: '/messages',
      name: 'messages',
      component: () => import('@/views/MessagesView.vue'),
    },
    {
      path: '/manage',
      name: 'manage',
      component: () => import('@/views/ManageView.vue'),
    },
    {
      // 旧地址与未知路径兜底
      path: '/admin',
      redirect: '/manage',
    },
    { path: '/:pathMatch(.*)*', redirect: '/board' },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  if (!getToken()) return { name: 'login' }
  const auth = useAuthStore()
  if (!auth.checked) await auth.fetchMe()
  if (!auth.user) return { name: 'login' }
  // 学生（一体机）只能看大板、出勤登记、作业登记
  if (auth.user.role === 'student' && to.name === 'manage') return { name: 'board' }
  return true
})
