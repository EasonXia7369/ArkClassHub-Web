<div align="center">

# Ark Class Hub · Web

**方舟班级中心 · 前端** —— 面向学校 / 年级组的轻量班级事务平台

*[后端仓库 ArkClassHub-Server](https://github.com/EasonXia7369/ArkClassHub-Server) · 线上地址 [ach.macrostar.top](https://ach.macrostar.top)*

</div>

## 功能总览

| 板块 | 内容 |
|------|------|
| **大板** | 教室大屏首页：大时钟、每日寄语（可接「一言」接口）、作业通栏大卡（实时同步）、今日课程、出勤概况（含异常人名）、今日值日生、家长视图入口二维码 |
| **出勤** | 每日登记（早/中/晚 × 出勤/请假/迟到/旷课/违纪 + 备注）、月度统计（按天/按次双口径）、请假申请与审批、周报（Excel / 分享长图导出） |
| **作业** | 作业布置（学生与老师同权，按角色留痕）、**同一天同一科可分多项分别登记未交**、区间统计导出、历史作业回看 |
| **考试** | 矩阵式录分（支持 Excel 整列粘贴）、各科统计（均分/及格率/优秀率/分数段）、班级排名、**历次趋势分析**（全班一张图 + 每个学生各科与总分示意图）、**AI 考试总结 / AI 个人点评 / AI 智能导入成绩单** |
| **消息** | 班级群实时聊天（WebSocket）：文字、快捷短语、语音（60s）、图片；离线排队重发、浏览器通知 + 提示音、Web Push 关页也能收；家长留言为独立双群组 |
| **管理** | 名单管理（单个添加 + 批量导入 + 身份证后六位核验）、课程表（支持 [CSES v1](https://github.com/SmartTeachCN/CSES) 导入导出）、值日表、班级设置、账号管理（管理员）、邀请码、旧数据导入；多校 / 年级体系（学校管理与年级汇总） |
| **家长视图** | `/parent/:key` 或扫码 / 班级码进入：孩子成绩（含班级均分、校排名、**AI 点评**）、成绩趋势、作业与出勤；未绑定学号时为全班脱敏视图 |
| **一体机** | `/kiosk` 学生密码解锁 → 值日生身份进入大板登记，操作留痕为「学生」 |

**撤销**：作业未交、作业布置、考勤登记均可撤销。底部提示条一键回退，侧栏 / 顶栏另有「撤销历史」面板可翻看最近 30 步并回退到任意一步。

**PWA**：可安装到主屏幕，离线查看最近数据，消息实时推送。

## 技术与关键约定

- Vite + Vue 3 + TypeScript + Pinia + Vue Router
- VueUse（主题 / 定时 / 工具）、dayjs、pinyin-pro（名单拼音检索）、ExcelJS（懒加载导出）、js-yaml（CSES 互通）、qrcode（家长绑定码）
- 图标统一走 `lucide-vue-next`（`src/components/Icon.vue` 语义名映射，不自绘）
- MiSans 分片 webfont（按需加载）
- PWA：vite-plugin-pwa（预缓存应用、API NetworkFirst、字体 CacheFirst）
- 桌面端（Electron）复用本仓库构建产物，运行时探测 `window.ark` 走原生能力

### 几处容易踩的点

| 主题 | 说明 |
|---|---|
| **Esc 关弹层** | `src/composables/useEscClose.ts`，模块级栈：弹层叠加时一次只关最上面一层。`ConsentDialog` 刻意不接（强制同意不允许跳过） |
| **撤销** | `src/composables/useUndo.ts`，每个操作自带 `undo` 回调**走原接口写回**（不绕过服务端校验）。撤销较早一步会连带回退其后的操作 |
| **弹层滚动** | `.gbackdrop` 用 `flex + margin:auto + overflow-y:auto`，不能改回 `grid/place-items:center`——内容超视口时会顶到外面且滚不动 |
| **趋势图** | `TrendChart.vue` 用 `ResizeObserver` 让 viewBox 宽度等于容器实际像素；写死宽度再整体缩放会把手机上的轴标签压成几像素 |
| **xlsx 导入** | 必须按**列索引**取值（`row.cellCount` + `getCell(c)`）。`eachCell({includeEmpty:false})` 会让空白列收缩、后续列整体左移 |

## 页面结构

| 路径 | 页面 |
|---|---|
| `/board` `/attendance` `/homework` `/exams` `/messages` `/manage` | 主要板块（侧栏 / 手机底导航切换） |
| `/login` `/activate` | 登录 / 邀请码激活 |
| `/parent` `/parent/:key` | 家长入口 / 家长视图 |
| `/kiosk` | 一体机 |
| `/admin` | 平台管理（学校 / 年级 / 账号） |
| `/about` `/terms` `/privacy` | 关于 / 服务协议 / 隐私政策 |

## 本地开发

```bash
npm install
npm run dev        # Vite @ :5173，/api 代理到本地后端 :8787
npm run build      # 类型检查 + 构建（含 PWA 产物）
```

后端启动见[后端仓库](https://github.com/EasonXia7369/ArkClassHub-Server)（`wrangler dev` 跑在 :8787）。本地测试账号：

| 姓名 | 角色 | 密码 |
|------|------|------|
| admin | 管理员 | dev1234 |
| teacher | 班主任 | teach123 |

> 本地数据库的账号密码若丢失，可用引导码（`server/.dev.vars`）重新激活或直接重置本地 D1。

## 环境变量

| 变量 | 用途 |
|---|---|
| `VITE_API_BASE` | 生产环境 API 地址（当前 `https://arkapi.macrostar.top`）。开发留空走 vite 代理 |
| `VITE_PUBLIC_ORIGIN` | 生成家长链接 / 二维码时使用的站点地址。桌面端 `ark://` 与 localhost 会让扫码失效，故固定为生产域名 |

## 部署

push 到 `main` → GitHub Actions 自动构建并部署到 Cloudflare Pages（需仓库 Secret `CF_API_TOKEN`）。

## 相关仓库

- [ArkClassHub-Server](https://github.com/EasonXia7369/ArkClassHub-Server) — 后端 API（Cloudflare Workers + D1）
- [ArkClassHub-Desktop](https://github.com/EasonXia7369/ArkClassHub-Desktop) — Windows 桌面端（Electron 壳）
- [Ark-Class-Hub](https://github.com/EasonXia7369/Ark-Class-Hub) — 原型存档

## 协议

GPL-3.0
