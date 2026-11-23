import { defineStore } from 'pinia'
import { get, post, setToken } from '@/api'
import type { ConsentState } from '@/utils/consent'
import { CONSENT_VERSION } from '@/utils/consent'

export interface AuthUser {
  userId: number
  role: 'teacher' | 'admin' | 'student'
  name: string
  /** student 会话绑定的班级 */
  classId?: number
  /** 所属学校：admin 未挂 = 平台超管；admin 非空 = 校管理员；教师 = 所属学校 */
  schoolId?: number | null
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as AuthUser | null,
    /** 协议同意状态；学生（一体机）不适用 → null */
    consent: null as ConsentState | null,
    checked: false,
  }),
  getters: {
    /** 教师/管理员是否必须先补同意最新版协议 */
    needsConsent: (s) => !!s.user && s.user.role !== 'student' && !s.consent?.agreed,
  },
  actions: {
    async fetchMe() {
      try {
        const { user, consent } = await get<{ user: AuthUser; consent?: ConsentState | null }>(
          '/api/auth/me',
        )
        this.user = user
        this.consent = consent ?? null
      } catch {
        this.user = null
        this.consent = null
        setToken('')
      } finally {
        this.checked = true
      }
    },
    async login(name: string, password: string) {
      const res = await post<{ token: string; user: AuthUser; consent?: ConsentState | null }>(
        '/api/auth/login',
        { name, password },
      )
      setToken(res.token)
      this.user = res.user
      this.consent = res.consent ?? null
    },
    async activate(code: string, name: string, password: string) {
      const res = await post<{ token: string; user: AuthUser; consent?: ConsentState | null }>(
        '/api/auth/activate',
        { code, name, password },
      )
      setToken(res.token)
      this.user = res.user
      this.consent = res.consent ?? null
    },
    /** 同意当前版本协议（成功后本地状态立即同步） */
    async agreeConsent() {
      const res = await post<{ consent: ConsentState }>('/api/auth/consent', {
        version: CONSENT_VERSION,
      })
      this.consent = res.consent
    },
    logout() {
      post('/api/auth/logout').catch(() => {})
      setToken('')
      this.user = null
      this.consent = null
    },
  },
})