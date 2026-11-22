<script setup lang="ts">
import { computed, ref } from 'vue'
import { get, post, put } from '@/api'
import { useClassStore } from '@/stores/class'
import { pinyinInitial, initialOf } from '@/utils/pinyin'
import QRCode from 'qrcode'
import Icon from '@/components/Icon.vue'

const store = useClassStore()

const newName = ref('')
const error = ref('')
const toastMsg = ref('')
const q = ref('')
const editId = ref<number | null>(null)
const editName = ref('')

const list = computed(() =>
  store.students.filter((s) => !q.value.trim() || s.name.includes(q.value.trim())),
)
const inactive = computed(() => store.students.filter((s) => !s.active))

function toast(msg: string) {
  toastMsg.value = msg
  setTimeout(() => (toastMsg.value = ''), 2200)
}

async function refresh() {
  const detail = await get<{ students: any[] }>(`/api/classes/${store.current!.id}`)
  store.students = detail.students
}

async function add() {
  error.value = ''
  if (!newName.value.trim()) return
  try {
    const res = await post<{ student: { id: number } }>(
      `/api/classes/${store.current!.id}/students`,
      { name: newName.value.trim(), pinyin_initial: pinyinInitial(newName.value) },
    )
    const sid = res.student.id
    await refresh()
    newName.value = ''
    toast(`已添加（学号 ${sid}）`)
  } catch (e: any) {
    error.value = e.message
  }
}

function startEdit(s: any) {
  editId.value = s.id
  editName.value = s.name
}

async function saveEdit() {
  if (editId.value === null) return
  await put(`/api/classes/${store.current!.id}/students/${editId.value}`, {
    name: editName.value.trim(),
  })
  editId.value = null
  await refresh()
}

async function setActive(s: any, active: boolean) {
  await put(`/api/classes/${store.current!.id}/students/${s.id}`, { active })
  await refresh()
}

/* ---------- 家长绑定码/二维码（家长凭 学号+绑定码 绑定孩子） ---------- */

/** 生成/重置单个学生的绑定码（重置不撤销已绑定家长）。 */
async function genBindCode(s: any) {
  try {
    const res = await post<{ bind_code: string }>(
      `/api/classes/${store.current!.id}/students/${s.id}/bind-code`,
      {},
    )
    await refresh()
    toast(`已生成 ${s.name} 的绑定码：${res.bind_code}`)
  } catch (e: any) {
    error.value = e.message
  }
}

/** 批量：给全部无码在读学生生成绑定码。 */
const bulkCodeBusy = ref(false)
async function genBindCodesBulk() {
  if (bulkCodeBusy.value) return
  bulkCodeBusy.value = true
  try {
    const res = await post<{ generated: number }>(
      `/api/classes/${store.current!.id}/students/bind-codes/bulk`,
      {},
    )
    await refresh()
    toast(`已为 ${res.generated} 名学生生成绑定码`)
  } catch (e: any) {
    error.value = e.message
  } finally {
    bulkCodeBusy.value = false
  }
}

/** 解绑：撤销该学生的全部家长令牌（已绑定设备立即失效）。 */
async function unbindStudent(s: any) {
  if (!confirm(`解除 ${s.name} 的全部家长绑定？已绑定的手机将立即失效，家长需重新绑定。`)) return
  try {
    await post(`/api/classes/${store.current!.id}/students/${s.id}/unbind`, {})
    await refresh()
    toast(`已解除 ${s.name} 的家长绑定`)
  } catch (e: any) {
    error.value = e.message
  }
}

/** 绑定二维码弹层：链接 = 家长视图 + 学号 + 绑定码，扫码自动完成绑定。 */
const showBindQr = ref<any>(null)
const bindQrData = ref('')
const bindLink = ref('')

let cachedParentKey = ''

async function openBindQr(s: any) {
  if (!s.bind_code) {
    toast('该学生还没有绑定码，先生成')
    return
  }
  const pkey = cachedParentKey || (await (async () => {
    const detail = await get<any>(`/api/classes/${store.current!.id}`)
    cachedParentKey = detail.class?.parent_key ?? ''
    return cachedParentKey
  })())
  if (!pkey) {
    toast('请先在「班级设置」生成家长链接')
    return
  }
  showBindQr.value = s
  // 二维码链接固定用生产域名（桌面端/本地环境 location.origin 是 ark://app / localhost，手机扫不出）
  const origin = 'https://ach.macrostar.top'
  bindLink.value = `${origin}/parent/${pkey}?no=${encodeURIComponent(s.student_no ?? '')}&bc=${s.bind_code}`
  bindQrData.value = await QRCode.toDataURL(bindLink.value, { width: 320, margin: 2 })
}

async function copyBindLink() {
  try {
    await navigator.clipboard.writeText(bindLink.value)
    toast('绑定链接已复制')
  } catch {
    toast('复制失败，请手动选择')
  }
}

/* ---------- 学号（家长凭学号在共享链接里绑定孩子） ---------- */
const noDraft = ref<Record<number, string>>({})

function noOf(s: any): string {
  return noDraft.value[s.id] ?? s.student_no ?? ''
}

function onNoChange(s: any, ev: Event) {
  const val = (ev.target as HTMLInputElement).value
  noDraft.value[s.id] = val
  saveNo(s)
}

async function saveNo(s: any) {
  const val = (noDraft.value[s.id] ?? s.student_no ?? '').trim()
  if (val === (s.student_no ?? '').trim()) return
  try {
    await put(`/api/classes/${store.current!.id}/students/${s.id}`, {
      student_no: val || null,
    })
    await refresh()
    delete noDraft.value[s.id]
    toast(val ? `已保存 ${s.name} 的学号 ${val}` : `已清空 ${s.name} 的学号`)
  } catch (e: any) {
    error.value = e.message
    noDraft.value[s.id] = s.student_no ?? '' // 失败还原输入框
  }
}

/** 批量学号弹窗：纯学号按名单顺序；「学号 姓名」两列按姓名对号入座 */
const showNos = ref(false)
const nosText = ref('')
const nosParsed = ref<Array<{ stu: any; no: string }> | null>(null)
const nosNote = ref('')
const nosImporting = ref(false)

function parseNos() {
  const rows = nosText.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const actives = store.students.filter((s) => s.active)
  const result: Array<{ stu: any; no: string }> = []
  const errors: string[] = []
  const byName = new Map(actives.map((s) => [s.name, s]))
  const usedNo = new Set<string>()
  // 任一行带两列 → 整篇按姓名匹配；否则纯学号按顺序
  const namedMode = rows.some((l) => l.split(/[\t,，\s]+/).filter(Boolean).length >= 2)
  let orderIdx = 0
  for (const line of rows) {
    const parts = line.split(/[\t,，\s]+/).map((x) => x.trim()).filter(Boolean)
    if (!parts.length) continue
    let stu: any
    let no: string
    if (namedMode) {
      const namePart = parts.find((p) => /^[\u4e00-\u9fa5a-zA-Z·]{2,4}$/.test(p))
      no = parts.find((p) => p !== namePart) ?? ''
      stu = namePart ? byName.get(namePart) : null
      if (!stu || !no) {
        errors.push(line)
        continue
      }
    } else {
      no = parts[0]
      stu = actives[orderIdx++]
      if (!stu) {
        errors.push(`${line}（超出名单人数）`)
        continue
      }
    }
    if (usedNo.has(no)) {
      errors.push(`${no}（重复）`)
      continue
    }
    usedNo.add(no)
    result.push({ stu, no })
  }
  nosParsed.value = result
  nosNote.value = errors.length
    ? `已忽略 ${errors.length} 行：${errors.slice(0, 3).join('；')}${errors.length > 3 ? '…' : ''}`
    : namedMode
      ? ''
      : `按名单顺序填入前 ${result.length} 人`
}

async function confirmNos() {
  if (!nosParsed.value?.length) return
  nosImporting.value = true
  error.value = ''
  const count = nosParsed.value.length
  try {
    await post(`/api/classes/${store.current!.id}/students/numbers`, {
      nos: nosParsed.value.map((r) => ({ id: r.stu.id, student_no: r.no })),
    })
    await refresh()
    showNos.value = false
    nosText.value = ''
    nosParsed.value = null
    toast(`已保存 ${count} 个学号`)
  } catch (e: any) {
    error.value = e.message
  } finally {
    nosImporting.value = false
  }
}

/* ---------- 批量导入 ---------- */
const showImport = ref(false)
const importMode = ref<'paste' | 'file'>('paste')
const pasteText = ref('')
const parsedNames = ref<string[]>([])
const parseNote = ref('')
const importing = ref(false)
const importResult = ref<{ added: number; skipped: string[] } | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/** 单行 → 姓名：去掉 "1." "3、" "12:" "5 " 等序号前缀与表格列，取最后一个非空段 */
function lineToName(line: string): string {
  let t = line.trim()
  if (!t) return ''
  t = t.replace(/^\s*\d+\s*[.、:：)\）\-—\t]+\s*/, '') // 序号前缀
  const parts = t.split(/[\t,，]+/).map((x) => x.trim()).filter(Boolean)
  // 有制表符/逗号分列时取最后一个像姓名的段（Excel 常见：学号\t姓名）
  for (let i = parts.length - 1; i >= 0; i--) {
    if (/^[\u4e00-\u9fa5a-zA-Z·]{2,4}$/.test(parts[i])) return parts[i]
  }
  return parts.length ? parts[parts.length - 1] : ''
}

function parseNames(text: string): { names: string[]; note: string } {
  const lines = text.split(/\r?\n/)
  const names: string[] = []
  let dropped = 0
  const seen = new Set<string>()
  for (const line of lines) {
    const name = lineToName(line)
    if (!name) {
      if (line.trim()) dropped++
      continue
    }
    if (seen.has(name)) {
      dropped++
      continue
    }
    seen.add(name)
    names.push(name)
  }
  const note = dropped ? `已忽略 ${dropped} 行（空行/重复/无法识别）` : ''
  return { names, note }
}

function onPasteInput() {
  const { names, note } = parseNames(pasteText.value)
  parsedNames.value = names
  parseNote.value = note
}

async function onImportFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  parseNote.value = ''
  try {
    let text = ''
    if (/\.csv$|\.txt$/i.test(file.name)) {
      text = await file.text()
      // 去 BOM
      text = text.replace(/^\uFEFF/, '')
    } else {
      const ExcelJS = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await file.arrayBuffer())
      const ws = wb.worksheets[0]
      // 找“姓名”表头列；找不到则取中文姓名值最多的列
      let nameCol = 0
      ws.eachRow({ includeEmpty: false }, (row, rn) => {
        if (rn > 3) return
        row.eachCell({ includeEmpty: false }, (cell, col) => {
          if (typeof cell.value === 'string' && cell.value.includes('姓名')) nameCol = col
        })
      })
      const colCount: Record<number, number> = {}
      const colText: Record<number, number> = {}
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell, col) => {
          const v = String(cell.value ?? '').trim()
          if (/^[\u4e00-\u9fa5a-zA-Z·]{2,4}$/.test(v)) {
            colCount[col] = (colCount[col] ?? 0) + 1
            colText[col] = col
          }
        })
      })
      if (!nameCol) {
        const best = Object.entries(colCount).sort((a, b) => b[1] - a[1])[0]
        nameCol = best ? Number(best[0]) : 0
      }
      if (!nameCol) {
        parseNote.value = '表格里没找到姓名列'
        ;(e.target as HTMLInputElement).value = ''
        return
      }
      const lines: string[] = []
      ws.eachRow({ includeEmpty: false }, (row) => {
        const v = String(row.getCell(nameCol).value ?? '').trim()
        if (v && v !== '姓名') lines.push(v)
      })
      text = lines.join('\n')
    }
    pasteText.value = text
    importMode.value = 'paste'
    onPasteInput()
  } catch (err: any) {
    parseNote.value = '文件解析失败：' + (err.message ?? '未知错误')
  } finally {
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function confirmImport() {
  if (!parsedNames.value.length) return
  importing.value = true
  error.value = ''
  try {
    const res = await post<{ added: number; skipped: string[] }>(
      `/api/classes/${store.current!.id}/students/bulk`,
      {
        students: parsedNames.value.map((n) => ({ name: n, pinyin_initial: pinyinInitial(n) })),
      },
    )
    await refresh()
    showImport.value = false
    pasteText.value = ''
    parsedNames.value = []
    importResult.value = { added: res.added, skipped: res.skipped }
    if (res.skipped.length) {
      toast(`导入完成：新增 ${res.added} 人，跳过重复 ${res.skipped.length} 人`)
    } else {
      toast(`导入完成：新增 ${res.added} 人`)
    }
  } catch (e: any) {
    error.value = e.message
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="glass pad">
    <div class="addrow">
      <input
        v-model="newName"
        class="ginput"
        style="flex: 1"
        placeholder="输入姓名添加学生，如：李小明"
        maxlength="20"
        @keyup.enter="add"
      />
      <button class="gbtn" :disabled="bulkCodeBusy" @click="genBindCodesBulk">
        <Icon name="lock" :size="15" /> {{ bulkCodeBusy ? '生成中…' : '批量生成绑定码' }}
      </button>
      <button class="gbtn" @click="showNos = true; nosText = ''; nosParsed = null; nosNote = ''">
        <Icon name="users" :size="15" /> 批量填学号
      </button>
      <button class="gbtn" @click="showImport = true; parsedNames = []; pasteText = ''; importResult = null">
        <Icon name="upload" :size="15" /> 批量导入
      </button>
      <button class="gbtn primary" @click="add">添加</button>
    </div>
    <p v-if="error" class="err" style="margin: 8px 0 0">{{ error }}</p>
    <div class="searchrow">
      <input v-model="q" class="ginput" style="flex: 1" type="search" placeholder="搜名单" />
      <span class="foot-note">在册 {{ store.students.filter((s) => s.active).length }} 人 · 停用 {{ inactive.length }} 人</span>
    </div>
    <p v-if="importResult" class="ok-text" style="margin: 8px 2px 0">
      上次导入：新增 {{ importResult.added }} 人<template v-if="importResult.skipped.length">，跳过重复：{{ importResult.skipped.join('、') }}</template>
    </p>
  </div>

  <div class="glass pad" style="margin-top: 12px">
    <div class="roster">
      <div v-for="s in list" :key="s.id" class="stu-row" :class="{ off: !s.active }">
        <span class="seq num">{{ s.seq }}</span>
        <template v-if="editId === s.id">
          <input v-model="editName" class="ginput" style="flex: 1" maxlength="20" @keyup.enter="saveEdit" />
          <button class="gbtn primary" @click="saveEdit">保存</button>
          <button class="gbtn" @click="editId = null">取消</button>
        </template>
        <template v-else>
          <span class="stu-name">{{ s.name }}</span>
          <input
            class="ginput no-input"
            :value="noOf(s)"
            placeholder="学号（选填）"
            maxlength="32"
            @change="onNoChange(s, $event)"
            @keyup.enter="($event.target as HTMLInputElement).blur()"
          />
          <input
            class="ginput code-input"
            :value="s.bind_code ?? ''"
            placeholder="绑定码"
            readonly
            @click="genBindCode(s)"
            :title="s.bind_code ? '点击重新生成' : '点击生成绑定码'"
          />
          <span class="stu-initial">{{ initialOf(s) }}</span>
          <span v-if="!s.active" class="off-badge">已停用</span>
          <button class="gmini" @click="openBindQr(s)">二维码</button>
          <button v-if="s.bind_code" class="gmini danger" @click="unbindStudent(s)">解绑</button>
          <button class="gmini" @click="startEdit(s)">改名</button>
          <button v-if="s.active" class="gmini danger" @click="setActive(s, false)">停用</button>
          <button v-else class="gmini" @click="setActive(s, true)">恢复</button>
        </template>
      </div>
    </div>
    <p class="foot-note" style="margin: 10px 2px 0">
      学号给家长在「家长视图」链接里绑定孩子用（格式不限、班内唯一）；停用不是删除：历史考勤与作业记录保留，名单里不再显示；转学/退班用停用。
    </p>
  </div>

  <!-- 批量导入弹窗 -->
  <Teleport to="body">
    <div v-if="showImport" class="gbackdrop" @click.self="showImport = false">
      <div class="gpop" style="width: min(560px, 94vw)">
        <h3 class="sec-title">批量导入名单</h3>

        <div class="mode-row">
          <button class="gmini" :class="{ on: importMode === 'paste' }" @click="importMode = 'paste'">
            粘贴文本
          </button>
          <button class="gmini" :class="{ on: importMode === 'file' }" @click="importMode = 'file'; fileInput?.click()">
            Excel / CSV 文件
          </button>
          <input ref="fileInput" type="file" accept=".xlsx,.csv,.txt" hidden @change="onImportFile" />
        </div>

        <p v-if="importMode === 'paste'" class="foot-note" style="margin: 8px 0 6px">
          每行一个姓名（支持直接从 Excel 复制粘贴，自动忽略序号和学号列）。
        </p>
        <textarea
          v-if="importMode === 'paste'"
          v-model="pasteText"
          class="gtextarea"
          style="width: 100%; min-height: 160px"
          placeholder="例如：&#10;1. 张三&#10;2. 李四&#10;王五"
          @input="onPasteInput"
        ></textarea>

        <p v-if="parseNote" class="foot-note" style="margin: 6px 0 0">{{ parseNote }}</p>

        <div v-if="parsedNames.length" class="preview">
          <span class="foot-note">识别到 <b>{{ parsedNames.length }}</b> 个姓名：</span>
          <div class="name-chips">
            <span v-for="n in parsedNames" :key="n" class="name-chip">{{ n }}</span>
          </div>
        </div>

        <div class="import-acts">
          <button class="gbtn" @click="showImport = false">取消</button>
          <button
            class="gbtn primary"
            :disabled="importing || !parsedNames.length"
            @click="confirmImport"
          >
            <Icon name="download" :size="15" />
            导入 {{ parsedNames.length || '' }} 人
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 批量填学号弹窗 -->
  <Teleport to="body">
    <div v-if="showNos" class="gbackdrop" @click.self="showNos = false">
      <div class="gpop" style="width: min(560px, 94vw)">
        <h3 class="sec-title">批量填学号</h3>
        <p class="foot-note" style="margin: 8px 0 6px">
          每行一个学号（按名单顺序填入）；也支持「学号 姓名」两列，按姓名对号入座。学号格式不限，家长用它绑定孩子。
        </p>
        <textarea
          v-model="nosText"
          class="gtextarea"
          style="width: 100%; min-height: 160px"
          placeholder="例如：&#10;20250101&#10;20250102&#10;&#10;或：&#10;20250101 张三&#10;20250102 李四"
          @input="parseNos"
        ></textarea>
        <p v-if="nosNote" class="foot-note" style="margin: 6px 0 0">{{ nosNote }}</p>
        <div v-if="nosParsed?.length" class="preview">
          <span class="foot-note">将保存 <b>{{ nosParsed.length }}</b> 个学号：</span>
          <div class="name-chips">
            <span v-for="r in nosParsed" :key="r.stu.id" class="name-chip">{{ r.stu.name }} → {{ r.no }}</span>
          </div>
        </div>
        <div class="import-acts">
          <button class="gbtn" @click="showNos = false">取消</button>
          <button class="gbtn primary" :disabled="nosImporting || !nosParsed?.length" @click="confirmNos">
            保存{{ nosParsed?.length || '' }} 个学号
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 家长绑定二维码弹层：扫码 = 家长视图 + 学号 + 绑定码 自动绑定 -->
  <Teleport to="body">
    <div v-if="showBindQr" class="gbackdrop" @click.self="showBindQr = null">
      <div class="gpop" style="text-align: center">
        <h3 class="sec-title">{{ showBindQr.name }} · 家长绑定二维码</h3>
        <p class="foot-note" style="margin: 0 0 10px">
          家长微信/浏览器扫码 → 自动填入学号与绑定码 → 完成绑定。截图或打印后发给对应家长。
        </p>
        <img v-if="bindQrData" :src="bindQrData" alt="家长绑定二维码" style="width: min(280px, 72vw); border-radius: 12px" />
        <div class="bind-code-banner num">{{ showBindQr.bind_code }}</div>
        <p class="foot-note num">学号 {{ showBindQr.student_no || '—' }} · 绑定码 {{ showBindQr.bind_code }}</p>
        <div class="head-row" style="justify-content: center; flex-wrap: wrap; margin-top: 10px">
          <button class="gbtn" @click="copyBindLink">复制绑定链接</button>
          <button class="gmini" @click="genBindCode(showBindQr)">重置绑定码</button>
          <button class="gmini danger" @click="unbindStudent(showBindQr)">解绑全部设备</button>
          <button class="gbtn primary" @click="showBindQr = null">完成</button>
        </div>
      </div>
    </div>
  </Teleport>

  <div v-if="toastMsg" class="gtoast">{{ toastMsg }}</div>
</template>

<style scoped>
.pad {
  padding: 16px 18px;
}
.addrow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.addrow .gbtn {
  flex: none;
}
.searchrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.roster {
  display: flex;
  flex-direction: column;
}
.stu-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  padding: 7px 4px;
  border-bottom: 1px solid var(--line-soft);
}
.stu-row.off .stu-name {
  color: var(--faint);
  text-decoration: line-through;
}
.seq {
  width: 26px;
  color: var(--faint);
  font-size: 12px;
  flex: none;
}
.stu-name {
  font-size: 13.5px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
}
.stu-initial {
  color: var(--faint);
  font-size: 11.5px;
  width: 24px;
  text-align: center;
  flex: none;
}
.no-input {
  width: 130px;
  padding: 4px 8px;
  font-size: 12.5px;
  flex: none;
}
.code-input {
  width: 88px;
  padding: 4px 6px;
  font-size: 12.5px;
  flex: none;
  text-align: center;
  letter-spacing: 0.06em;
  cursor: pointer;
}
.bind-code-banner {
  display: inline-block;
  margin: 10px auto 0;
  padding: 6px 18px;
  border-radius: 10px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.18em;
}
.off-badge {
  font-size: 10.5px;
  color: var(--faint);
  background: var(--field);
  padding: 2px 8px;
  border-radius: 999px;
}
.mode-row {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}
.preview {
  margin-top: 12px;
}
.name-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  max-height: 140px;
  overflow-y: auto;
}
.name-chip {
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 12.5px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
}
.import-acts {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
