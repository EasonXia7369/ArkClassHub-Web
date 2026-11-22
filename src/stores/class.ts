import { defineStore } from 'pinia'
import { ref } from 'vue'
import { get } from '@/api'
import { useAuthStore } from '@/stores/auth'

export interface Student {
  id: number
  name: string
  seq: number
  pinyin_initial: string
  student_no?: string | null
  /** 身份证后六位是否已录入（布尔回执；明文/哈希永不回传前端） */
  has_id_tail?: number | boolean | null
  active: number
}

export interface TeacherInfo {
  id: number
  name: string
  role: string
  is_owner: number
}

export interface ClassInfo {
  id: number
  name: string
  grade: string
  teacher_name: string
  student_pass_hash: string | null
  subjects: string[]
  legacy_sync_code?: string | null
  /** 每日寄语来源配置（JSON 字符串：{ source: 'builtin' } 或 { source: 'hitokoto', cats, max_length }） */
  quote_config?: string | null
}

export const useClassStore = defineStore('class', () => {
  const classes = ref<ClassInfo[]>([])
  const current = ref<ClassInfo | null>(null)
  const students = ref<Student[]>([])
  const teachers = ref<TeacherInfo[]>([])
  const loaded = ref(false)

  async function loadClasses() {
    const auth = useAuthStore()
    // 学生（一体机）只能访问自己绑定的班级详情
    if (auth.user?.role === 'student' && auth.user.classId) {
      await switchTo(auth.user.classId)
      loaded.value = true
      return
    }
    const res = await get<{ classes: ClassInfo[] }>('/api/classes')
    classes.value = res.classes
    if (!current.value && res.classes.length) await switchTo(res.classes[0].id)
    loaded.value = true
  }

  async function switchTo(id: number) {
    current.value = classes.value.find((c) => c.id === id) ?? null
    if (current.value) {
      const res = await get<{ class: ClassInfo; students: Student[]; teachers?: TeacherInfo[] }>(`/api/classes/${id}`)
      students.value = res.students
      teachers.value = res.teachers ?? []
      current.value = { ...current.value, subjects: res.class.subjects }
    }
  }

  function reset() {
    classes.value = []
    current.value = null
    students.value = []
    teachers.value = []
    loaded.value = false
  }

  return { classes, current, students, teachers, loaded, loadClasses, switchTo, reset }
})
