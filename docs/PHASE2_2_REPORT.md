# Polar Schedule Phase 2.2 验收报告

日期：2026-10-20 · 版本：v0.2.2 · 分支：`feature/phase2-2-ux-polish`

## 1. 范围与验收结论

本次以 [修订版完整要求](PHASE2_2_UX_POLISH_PROMPT_REVISED.md) 为准，并读取 [Phase 2.1 报告](PHASE2_1_REPORT.md)、规格、Phase 2.1 指令及 [用户实测原文](phase2.1实测/问题.txt) 和全部 8 张原图。没有从仅有规格的 main 重建项目。

基线是完整 Phase 2.1 v0.2.1：`feature/phase2-1-ux-rework` 的 `ca3a548`，功能提交 `867bbf5`。开始时工作区无已修改文件，仅有未跟踪的本次修订要求；过程中新增的用户实测资料原样保留。本阶段继续使用 Dexie v3 / JSON schemaVersion 3。

**Phase 2.2 功能开发与本地验收通过：113/113 单元/组件、44/44 浏览器流程、严格类型检查和生产构建通过。** 已执行真实 Chromium 鼠标、键盘、触屏模拟、滚轮及拖拉，并实际查看截图。开发依赖审计仍有第 7 节的未通过项；用户原浏览器和真实手机仍待第 9 节复验，不把隔离环境结果扩大为这些环境已验证。

## 2. 用户反馈对应改动与证据

截图均位于 `docs/evidence/phase2_2/`；以下链接相对本报告。修改前在独立 4192 的旧版构建重现问题，修改后用隔离测试数据操作。前后数据规模不同，属于场景对照，不是同数据逐像素比较。用户原始图仍在 `docs/phase2.1实测/`。

| 原问题 | 本次改动与真实检查 | 视觉证据 |
| --- | --- | --- |
| 标签/日程是生硬方块，打开系统 RGB 面板 | 清单、标签、日程全部复用 ColorPicker；预设、真实鼠标/触屏色板、方向键、HEX、取消、保存刷新均验证 | [旧标签入口](evidence/phase2_2/before-tag-color-light.png)、[新标签弹层](evidence/phase2_2/color-tag-light.png)、[日程底部避碰](evidence/phase2_2/color-event-light-bottom.png)、[390px 深色](evidence/phase2_2/color-event-mobile-dark.png) |
| 完成后看不出变化 | 原逐段状态增加 `✓ 已完成`、区分背景和描边；月/日/周复用同一语义；完成一段不改其他段/父任务，离线和跨页保留 | [月浅色](evidence/phase2_2/month-background-completion-light.png)、[月深色](evidence/phase2_2/month-background-completion-dark.png)、[周浅色](evidence/phase2_2/regression-completion-week-light.png)、[周深色](evidence/phase2_2/regression-completion-week-dark.png)、[手机日视图](evidence/phase2_2/after-layout-390-dark.png) |
| 重叠太挤，短块难点、背景消失 | 按真实列宽限制并列容量、短块优先、完整列表查看/编辑；背景保留独立入口，不捕获前景拖拉；密集 +N 放日期头，避免压住时间 | [周密集浅色](evidence/phase2_2/weekly-dense-layout-light.png)、[周密集深色](evidence/phase2_2/weekly-dense-layout-dark.png)、[完整列表](evidence/phase2_2/weekly-dense-summary-light.png)、[日五条并列](evidence/phase2_2/daily-five-overlap-dark.png) |
| 背景在月视图消失，左侧残缺弧线/括号 | 月视图统一投影为普通可点条目，取消时间轴背景层；移除窄边装饰，保留合理标题截断及原生更多入口；全部类型、显隐、例外取消验证 | [旧月视图](evidence/phase2_2/before-month-light.png)、[新月视图](evidence/phase2_2/month-background-completion-light.png) |
| 点击日期只新建，无法细看当天 | 月日期数字/周日期头打开独立预览；全天优先、跨夜交集、完整标题、颜色/状态/重复语义；条目复用现有编辑路由；空白仍新建且只开一窗 | [日期预览](evidence/phase2_2/day-preview-month-light.png)、[跳转目标日视图](evidence/phase2_2/day-preview-target.png)、[手机长列表](evidence/phase2_2/day-preview-mobile-dark.png) |
| 逐月按箭头太慢 | 顶部跳转复用 DayPicker；日/周支持 YYYY-MM-DD，月另支持 YYYY-MM；闰日、跨年周、周日起始、非法日期、纽约 DST 日期无偏移验证 | [跳转月历](evidence/phase2_2/jump-calendar-light.png)、[手机深色](evidence/phase2_2/jump-mobile-dark.png) |
| 月视图滚轮失效 | 有限高度的月内容 scroller 允许自然纵向滚动；5/6 行、低窗口、等效缩放、侧栏收起、预览内部滚轮验证；更多列表固定标题、内部滚动，18 条仍可到末项；滚轮不改月份 | [六行低窗口](evidence/phase2_2/month-six-rows-low-height.png)、[手机更多列表](evidence/phase2_2/month-more-mobile-dark.png) |
| 三个设置入口 | 逐一核查旧侧栏按钮均调用同一全局设置；只保留顶栏一处，清单管理菜单/显隐/归档仍在，底部显示保存状态 | [旧三个入口](evidence/phase2_2/before-settings-entrypoints-light.png)、[新整体](evidence/phase2_2/after-layout-1440-light.png) |
| 设置横向滚动、内容拥挤 | 外观/日历与时间轴/清单与显示/数据备份与恢复四分组，标题与分组固定、内容单区滚动；分组同步键盘焦点；修复隐藏文件控件宽度根因 | [旧低高度](evidence/phase2_2/before-settings-lowheight-light.png)、[新桌面](evidence/phase2_2/after-settings-1440-light.png)、[768 深色](evidence/phase2_2/after-settings-768-dark.png)、[390 深色](evidence/phase2_2/after-settings-390-dark.png) |
| 日历只有左上角圆，其他控件不统一 | 外层 card 四角统一裁切，主卡/弹窗 16px、输入与主要按钮 10px；手机沿用相同变量；日期筛选复用现有控件 | [整体四角](evidence/phase2_2/after-layout-1440-light.png)、[768 布局](evidence/phase2_2/after-layout-768-dark.png)、[手机](evidence/phase2_2/after-layout-390-light.png) |

## 3. 颜色组件与依赖决策

主要文件：`src/components/ColorPicker.tsx`、`color-picker.css`、`ColorPicker.test.tsx`；接入 `Lists.tsx`、`TagsDialog.tsx`、`ScheduleEditor.tsx`。源码无作为交互入口的原生 `input[type=color]`。

触发按钮显示圆角色点与 HEX；自控原生 dialog 顶层弹层提供当前预览、8 个预设、色相/饱和度亮度和 `#RRGGBB`。非法 HEX 有提示且不能确认；颜色先保留在浮层草稿，确认后仅进入父表单草稿，保存父表单才写库。旧色值不批量规范化；新确认色值保存为兼容的六位 HEX，不改清单/标签/日程语义。

新增精确锁定的 `react-colorful@5.8.1`：[官方项目](https://github.com/omgovich/react-colorful)、[MIT 许可](https://github.com/omgovich/react-colorful/blob/master/LICENSE)。它无新增运行依赖，React/ReactDOM 为 peer，使用小型 HexColorPicker，不引入 UI 框架。上游标称核心约 3KB gzip 是选型参考；本次整包变化还包含导航/预览等功能，不把全部增长归因于此包。锁文件除项目版本和该包外没有批量升级。

可访问性：入口名称、展开状态、预设选中状态、HEX 错误、确认/取消、Esc、点外部与焦点恢复；库内滑块支持鼠标、触屏与方向键。真实 Chromium 操作覆盖这些路径；没有宣称已经用所有读屏软件或真实手机认证。浮层基于锚点/visualViewport/ResizeObserver 调整位置，长表单底部向上避让，超低窗口内部滚动，不截断底部操作。

## 4. 日历、导航与设置实现

- `src/features/calendar/Calendar.tsx`：复用 occurrence 展开、visibleBlocks 显隐规则和现有 onBlock 编辑入口；月视图只改派生的 display，不改存储，不额外复制事件。原生 dayMaxEvents 与更多列表保留全量可见条目。背景开关控制日/周时间轴；月及当天预览仍列出背景安排。
- `calendarPresentation.ts`：列宽容量和本地自然日交集。预览使用当天 `[00:00, 次日00:00)` 与原时间范围求交，排他结束日不多算一天；全天优先，再按开始/结束/稳定 ID 排序，跨日标明语义。`查看完整日视图 →` 复用 FullCalendar changeView 并更新主标题。
- `calendar-ux.css` / `src/styles.css`：月条目简化、完成状态、摘要、四角、单独滚动区域。周/日密集 +N 移到日期头，同一天多段冲突合并为去重的完整入口；背景时间标记保留独立 rail，并计入卡片可用宽度，窄周改用日期头入口以免遮挡前景。月 5/6 行按实际月份显示，内容不足时不制造假滚动；长内容在日历内部自然滚动。原生更多弹层约束在日历可见区内，标题固定、内容收缩滚动，避免 18 条时被外框裁掉。
- `src/domain/navigation.ts`、`src/components/DateTimePicker.tsx`、`src/app/App.tsx`：扩展既有 DayPicker 弹层，校验日期文本后以日期字符串 gotoDate，不以 UTC 午夜转换；周定位沿用用户 weekStartsOn。保留所有起止时分、精确分钟、全天/截止日期和重复结束日期能力。
- `Tasks.tsx`：两个截止日期搜索入口也复用日期组件。新增文本输入校验，非法或未输入完整的日期暂不参与筛选且明确提示，纠正后恢复正常，避免字符串比较误筛空结果。
- `SettingsDialog.tsx` / `settings.css`：唯一全局入口、四分组、键盘焦点、真正可收缩/换行的内容布局。横溢根因并非滚动条本身：通用输入样式覆盖 sr-only，使隐藏 file input 变成 100% 宽并溢出；以 `input.sr-only` 恢复真实 1px/零 padding/零 border，不只靠 overflow 隐藏。修复前新版实测 clientWidth 598 / scrollWidth 620，控件右边界 1041 超过 dialog 1020；修复后 6 种主题宽度条件均验证无横溢出。
- 另一个横溢来自收起的右侧待办栏：零宽网格列仍有自身内边距和绝对定位的 sr-only 内容；缩放等效 CSS 视口 1252px 时页面宽 1274px。给折叠栏明确定位边界并清内边距/边框、允许收缩，恢复展开时仍沿用正常布局，不在 body 上隐藏问题。

既有任务直拖、逐段完成模型、父任务属性折叠、重复系列/例外、时间编辑与后台数据操作均保留，没有另建打卡模型或日期控件。

## 5. 数据保护与兼容

`src/domain/schema.ts`、冻结的 v1/v2 校验器、`src/storage/` 和领域时区转换没有修改。Dexie 仍 version(3)，JSON 仍 3（原生 IndexedDB 版本数字 30 是 Dexie 的版本编码）。本阶段没有 v4、新字段、自动覆盖导入、清库或重建库。

所有写入测试、v2 迁移和故障注入都在 Playwright 独立上下文/测试用户目录或 fake-indexeddb 的独立库中进行，没有读写用户日常浏览器的真实数据库。前后截图来自隔离数据；不将测试库升级成功等同于已验证用户个人库。

新增保留测试按原生 IDB 全表比较：仅浏览月投影、日期预览、跳日、切视图、开关设置时，ID、revision、createdAt/updatedAt、UTC 范围、背景 display、标签/例外、元数据和既有备份逐行不变。完成/撤销只修改目标 task 时间块；另一天的块和父 Task 不变。跨标签页、离线刷新、v3 导出与确认后的替换恢复保留这些记录及旧备份。原有 v1/v2→v3 正式升级、失败回滚、原始备份和 JSON 兼容测试继续保留。

## 6. 实际测试与视觉检查

环境：Windows · Node.js 24.13.0 · npm 11.6.2 · Playwright 1.64.1 / Chromium。覆盖 Asia/Shanghai 和 America/New_York，1440/768/390px，浅/深主题；触屏为浏览器模拟。

| 命令/检查 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 已通过（严格 TS） |
| `npm run test` | 已通过，16 文件，113/113，0 失败/0 跳过，40.62 秒 |
| `npm run build` | 已通过，2435 模块；7 个离线资源，SW `61117eab2f4aad26`；主 JS 225.48KB / gzip 69.01KB，最大 calendar 块 265.00KB / gzip 77.42KB，CSS 59.24KB / gzip 11.40KB |
| `npm run test:e2e` | **44/44 通过，0 失败/0 跳过，2.3 分钟**；保留原 29 流程，新增 15 流程，使用上述最终构建 |
| 独立颜色 E2E（4191） | 3/3 通过，真实鼠标色板/方向键/触屏、草稿/取消/保存、边界 |
| 独立日期跳转 E2E（4173） | 4/4 通过，闰日/跨年周/非法值/手机/DST |
| 独立日历新旧 E2E（4190） | 16/16 通过，1.8 分钟；缩放截图同步视口后另复验 1/1 通过，含空预览、18 条更多末项及真实拖动/拉伸 |
| 独立数据与设置 E2E（4192） | 3/3 通过，16.0 秒；含原生库全表比较、跨页离线、JSON、6 种尺寸主题滚轮/键盘/溢出 |
| `npm audit --omit=dev --json` | 已执行，0 条生产告警，退出 0 |
| `npm audit --json` | 已执行，3 条开发链告警，退出 1，**未通过**，见第 7 节 |
| `git diff --check`、文档链接及旧截图完整性 | 已通过；README/本报告本地链接存在，原 29 张已跟踪历史证据保持原字节，重新生成的 8 张恢复为基线；本次副本放新目录 |
| ESLint | 项目未配置，未执行，不记为通过 |

新增单元/组件 13 项：颜色 4、导航输入 3、既有日期弹层补 2、日历交集/列宽 3、截止筛选非法输入 1。新增浏览器 15 组：颜色 3、日历 5、跳转 4、数据保留/设置 3。旧 29 组全部保留，没有 skip；与 UI 变化相关的原生色值输入、周列容量断言按新交互调整，仍验证完整条目可编辑、可见卡片几何及真实拖拉，不以删除场景换取通过。

发现与修复经过：设置严格溢出断言确实先失败，定位隐藏文件控件后修正；截图检查确实发现密集摘要盖住短块时间，移到日期头并增加几何不相交断言。18 条月更多列表实测无法滚动并被裁切，补充内部滚动、滚到末项和弹层边界断言。CSS body.zoom 会把整页 100vw 直接撑出视口，不能当作浏览器缩放，验证改用同步 Playwright 视口的 CDP CSS 视口/像素倍率等效 115% 场景；该场景又定位折叠侧栏 22px 真实溢出并修复，未用隐藏 body 掩盖。这些用例最终全部通过，无遗留测试失败。

已实际逐张查看颜色、月视图、周/日重叠、日期预览/跳转、设置/布局截图，与用户 8 张原图和旧版 6 张截图对照，检查标题、完成标识、截断、弹层边界和四角。截图保存不替代鼠标点击、wheel 使 scrollTop 增长、键盘、拖动/拉伸等断言。历史 `docs/evidence/` 已跟踪的 29 张截图已与基线逐字节复核；新的执行完成/快捷编辑副本单独保存在本次目录，不用新版覆盖旧报告证据。

## 7. 未通过、未验证与风险

- 本次范围内的功能开发和隔离环境自动化验收已完成，无遗留失败测试或半实现功能；完整实机验收仍有下列未验证边界。
- **安全审计未通过**：现有 Vitest 3.2.7 开发链 `vitest` / `@vitest/mocker` / `tinypool` 共 3 条包级告警（1 moderate、2 critical），与 Phase 2.1 同链路。涉及 [mocker 文件读取](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)、[tinypool 原型污染](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3) 和 [run options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr)。生产审计 0；没有运行 audit fix --force 或擅自大版本替换测试栈，建议独立升级验收。
- **尚未亲自验证的环境**：用户原 Edge/浏览器配置和个人数据库、真实 iPhone/iPad Safari、真实触控长按拖动/软键盘、辅助技术读屏、系统回收和长期使用。390px/hasTouch 模拟通过不代表这些实机已验证。
- 范围外功能：自动重复 Task、同步、统计、服务器和 Phase 3 未开展。日/周背景范围仍通过表单编辑，不原生拖拉；月视图只改变展示。保留既有重复展开上限、浏览器时区显示、完全替换导入等边界，见 README。
- 用户原先“右侧拖不进去”的浏览器环境根因未在其个人配置中复现；隔离 Chromium 的日/周/月拖入、生命周期重挂与失败回滚有回归，仍建议按第 9 节在原浏览器复验。

## 8. Git 与交付文件

当前分支 `feature/phase2-2-ux-polish`，从 `ca3a548` 安全继续，未 reset/clean/rebase/stash；没有推送、合并主分支、发布网站或 GitHub 同步。

| 提交 | 内容 |
| --- | --- |
| `867bbf5` / `ca3a548` | Phase 2.1 完整功能 / 验收基线 |
| `f939324` | Phase 2.2 实现、13 项新增单元/组件、15 组新浏览器验证、截图、修订要求和用户原始资料 |
| 本报告提交 | 阶段结果及已知边界；自身哈希见 git log，避免自引用 |

README 已更新版本、操作方法及本报告链接；PRODUCT_SPEC 追加 Phase 2.2 补充章节，不删除历史约束。没有把报告放在项目根目录。

## 9. 启动与 5–10 分钟手动验收

```powershell
cd C:\Users\34201\Desktop\polar_schedule
npm install
npm run build
npm run preview -- --port 4173 --strictPort
```

打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)，Ctrl+C 停止。开发用 npm run dev（默认 5173）。同一浏览器固定同一来源；不要把换端口的新库当作数据丢失。

1. 在原浏览器先导出独立 JSON。联网关闭同来源旧标签页，再重新打开新版同一 4173 地址；无需清除网站数据、IndexedDB 或缓存。确认旧清单/任务/课程/主题仍在。
2. 打开清单、标签和日程颜色，试预设、自定义拖色与 HEX；取消不变，确认后保存、刷新回显。切深色，在手机宽度和长日程表单底部再试。
3. 同一 Task 安排两次，只完成一段；在日/周/月看到“✓ 已完成”，另一段与父任务不变；点击该段撤销。检查日/周长 08–23、短 08:30–09:45 与五条重叠，点摘要看全量；背景与前景互换后可点、可拖拉前景。
4. 月视图确认背景/普通/全天/重复均出现；点击日期数字查看当天详情和跨日交集，点“查看完整日视图 →”。周日期头同样可用；点击空白仍新建，点击事件仍直接编辑。
5. 顶部输入 2028-02-29、月视图 2027-12，试非法日期和跨年周；降低窗口高度自然滚动 5/6 行月份，滚轮不跳月。打开右上唯一设置，使用四分组和滚轮找到备份，检查无横条；最后导出新备份。

## 10. 下一阶段建议

先完成原浏览器及真实手机复验，再单独升级开发测试依赖并回归。若后续需要周期任务，复用现有 task 时间块和每次状态另行设计，不重建完成模型。Phase 3 GitHub 同步须后续独立授权，本阶段未开始。
