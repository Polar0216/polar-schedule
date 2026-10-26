# Polar Schedule — Phase 2.1 验收报告

日期：2026-10-20（Asia/Shanghai） · 应用版本：0.2.1

## 1. 范围与验收结论

**Phase 2.1 核心交互开发与本地自动化验收通过：100/100 单元/组件、29/29 浏览器流程、严格类型检查及生产构建通过。** 用户原浏览器和真实手机仍待第 9 节亲自复验；开发依赖安全审计有第 7 节明确未通过项，不将其写为通过。

本阶段按 [Phase 2.1 提示词](PHASE2_1_UX_REWORK_PROMPT.md) 和 [用户实测文字](phase2实测/感受.txt) 执行。已逐张查看用户提供的 7 张截图；用户实测优先于 Phase 2 报告中笼统的自动化通过结论。未开展 Phase 3。

核心结果：点击任务日历块直接编辑本次安排；同一任务多个时间段分别完成；短背景与长前景并存仍有可发现入口；窄列用 +N 完整清单；统一迷你日期时间选择器；任务详情按主操作与折叠属性组织。Task、task 型 ScheduleBlock 和独立 event 的数据分层保留。

## 2. 实测问题与实际修复

| 用户反馈 | 修复与行为 |
| --- | --- |
| 点击任务时间块只打开父任务长表单 | App 统一交给安排编辑器。显示标题、清单、第几段、本次起止和完成/撤销；可删除本段，另有父任务入口。有未保存改时则明确显示“保存并查看完整任务”，成功保存后再进入 |
| 两次安排共用完成状态 | task 块持久化 executionStatus/completedAt；父任务与每段状态互不改写。详情显示 1/2 等计数，逐段勾选；日历 □/✓ 仅取本次状态 |
| 小背景被长前景盖住 | 原生背景层不接收指针；在实际时间旁独立标记栏提供 ▧ +N项，日期头也可查看背景。完整列表可点开短背景编辑，背景不抢前景拖动/拉伸 |
| 事件多、周列窄 | 普通前景并列；常规列最多直接堆叠 3 条，窄周列 1 条。+N 面板完整显示全部项目的标题、时间和入口，不修改真实时间、不禁止重叠 |
| 表单密、多层滚动 | 父任务首屏为标题、整个任务状态、截止日期、保存/安排和执行段；描述/属性、标签、子任务折叠保留。移除 FullCalendar 标题区/全天区多余滚动，保留时间轴及独立侧栏正常滚动 |
| 只能改原生日期数字 | React DayPicker 月历 + 原生 modal dialog，统一紫色与深浅主题；月/年导航、今天、24 小时、5 分钟选项及精确分钟，确认/取消/Esc 与焦点恢复。全天、截止、重复结束只选日期，保留键盘精确输入 |

新建日历安排提供“新建日程 / 安排已有任务”分段按钮。后者选择现有 Task，不新建重复 Task；切换路径/所选任务保留时间草稿。重复 event 的“仅本次 / 整个系列”语义保持。

修复时通过浏览器发现并纠正了两个真实问题：日期弹层 Esc 后焦点未回入口；时间标记的 mousedown 冒泡使 FullCalendar 同时打开空白创建表单。现在关闭原生弹层后恢复焦点，标记阻止实际鼠标/触摸按下事件冒泡，并断言只出现一个详情弹层。精确分钟按 Enter 不会隐式提交外层安排表单。

## 3. 主要文件与设计

| 文件 | 作用 |
| --- | --- |
| src/app/App.tsx | 日历块统一编辑路由、父任务入口、不同安排的弹层实例隔离 |
| src/features/calendar/ScheduleEditor.tsx、block-form.css | 创建路径、本次直接改时/打卡/删除、第几段、父任务导航与保存反馈 |
| src/components/DateTimePicker.tsx、date-time-picker.css | 共用月历/时间弹层、键盘输入、时区提示、确认与焦点 |
| src/features/calendar/Calendar.tsx、calendar-ux.css | 背景指针穿透、独立范围标记、窄列/密集 +N、完成符号、滚动层修复 |
| src/features/tasks/Tasks.tsx、tasks.css | 主操作前置、逐段完成数/列表、高级折叠、保存与安排共享表单校验 |
| src/domain/schema.ts、legacyV1.ts、legacyV2.ts | 当前 v3 严格契约、冻结旧格式、纯迁移及关系验证 |
| src/storage/database.ts | 正式 Dexie v3 升级、原始备份、独立完成 API、改时保留状态、事务撤销 |
| src/storage/phase2-1-storage.test.ts、Tasks.phase2_1.test.tsx、DateTimePicker.test.tsx、BlockDialog.test.tsx | 新增 16 项迁移/状态/组件回归 |
| e2e/migration-phase2-1.spec.ts、overlap-phase2_1.spec.ts、unified-phase2-1.spec.ts | 新增 11 组真实浏览器流程 |
| README.md、docs/PRODUCT_SPEC.md 第 16 节 | 使用方式、v3 恢复、父/本次完成区分及版本化规格补充 |

保留 React/TS/Vite、FullCalendar 免费标准插件、Dexie/Zod。新增 `@daypicker/react@10.0.2` 及其必要日期依赖；评估依据为 [官方输入/原生弹层示例](https://daypicker.dev/guides/input-fields)，没有自写月历布局/键盘导航算法，也没有引入整套 UI 框架。领域 UTC/IANA 转换仍使用原有 Date/Intl。选择器保留墙上时间字符串，由表单执行 DST 往返校验，避免月历先把无效时刻改成另一个瞬间。

## 4. v2 → v3 数据保护与恢复

正式路径为 Dexie `version(3).upgrade`（原生 IndexedDB 20→30），JSON schemaVersion 2→3。

- v2 task 型块新增 `executionStatus: pending`，不根据父任务 done 推断历史执行；completed 时必须带 completedAt，pending 不带完成时间。独立 event 不添加状态字段。
- 保留清单、Task、块、标签、系列、单次例外、主题/时间轴设置、墓碑、全部 ID、revision 及原创建/更新时间。升级只补新字段，不把迁移伪装为用户编辑。
- 同一个版本事务先完整验证冻结 v2，再写原始 `before-schema-v3` 快照及新状态；原备份不删除。待撤销 payload 的 task 块也补 pending，避免升级后恢复旧结构。
- v1 先用冻结 v1 校验并形成合法 v2，再走 v3；分别保留 `before-schema-v2` 与 `before-schema-v3`。升级快照不参与最近 3 次导入快照轮换。
- 迁移失败整体回滚版本与表；启动错误页保留原始数据导出。旧损坏引用的失败保护仍有回归。没有通过清库、覆盖初始化或重新建用户库解决升级。
- saveBlock 在时间/拖动/拉伸更新省略执行字段时，读取事务中的最新本次状态和完成时间予以保留。`setBlockCompleted` 只改指定块，递增其 revision；同值调用不重复改该块。父 Task 保存不修改块。
- 删除、30 秒撤销、JSON v3 导出恢复、跨标签页与离线重开均覆盖新状态。v1/v2 JSON 先旧校验再迁移，非法引用拒绝且现有数据保持；替换导入仍有原有的快照与明确确认。

**没有清空你的日常 IndexedDB。** 所有植入旧库、替换导入、模拟故障及进程重启只用于隔离上下文/随机测试库。本次没有用浏览器工具读取或改写日常数据；真实个人库将在你用同一来源重新打开新版时执行上述升级。隔离样本通过不能冒充已逐条检查你的真实数据。

## 5. 实际执行的测试

Windows · Node.js 24.13.0 · npm 11.6.2 · Playwright 1.64.1 / Chromium；时区覆盖 Asia/Shanghai、America/New_York，布局含 1440/768/390px。

| 检查 | 实际结果 |
| --- | --- |
| npm run typecheck | 已通过，严格 TS 包含源码与测试 |
| npm run test | 已通过：13 文件、100/100；其中旧 84 项保留，新增 16 项；最后完整运行 11.54 秒 |
| npm run build | 已通过；7 个静态资源进入离线缓存，最大 JS 分块约 265 KB，主应用约 206 KB（gzip 约 62 KB） |
| npm run test:e2e | 最终完整运行 29/29 通过，约 1.7 分钟；旧 18 组保留，新增 11 组，无跳过 |
| npm audit --omit=dev | 已执行，生产依赖 0 条告警 |
| npm audit | 已执行，开发依赖链仍有 3 条告警，见第 7 节，不记为通过 |
| git diff --check | 已通过；交付文档 31 个本地链接均存在 |

新增单元/组件覆盖：v2 真实 Dexie 升级/撤销 payload/备份保留、坏引用事务回滚、独立状态与幂等 revision、改时/撤销/重开/JSON/双连接并发；任务分组/逐段计数/父任务独立完成、无效折叠子任务保存保护；跨月精确分钟、日期模式和取消。

新增浏览器验收内容：

1. Task A 周一 08–09 和周二 09–10；从第一块直接改时，第二块及唯一 Task 不变；创建路径切换保留时间。改时后保存并进入完整任务保留修改。
2. 逐段完成/分别撤销；父 Task 仍 todo；将父 Task done 后未完成段仍 pending，两个层级 UI 明确。跨标签页实时更新、离线刷新、导出 v3/导入恢复、关闭浏览器进程重开保留记录。
3. 普通长 08–23 + 短 08:30–09:45，在日/周视图做几何并列、elementFromPoint 可触达、实际点击/拖动/拉伸及深浅截图。
4. 短背景 + 长前景（08–23）、长背景 + 短前景，检查实际范围标记、完整编辑入口、背景 pointer-events:none，前景真鼠标移动/拉伸不被拦截。
5. 5 条重叠、390px 窄周列 + 背景，收纳数量与完整 5 项列表，中文标题与时间可见、点击编辑/键盘 Enter/Esc、无页面横向溢出。
6. 本次完成样式与父任务 done 独立，移动 1 小时、拉伸 30 分钟后保留 completedAt；另段完全不变。
7. 月历跨月、精确 07 分钟、输入 Enter 不提前保存、Esc 回焦点、非法结束时间提示、全天只日期、手机深色弹层边界。
8. 原生 v2 库升到 v3 保留标签/课程/例外/主题/备份、父 done 的旧安排仍 pending、刷新幂等；v1/v2 JSON 真替换恢复、坏 v2 导入不改当前数据。

旧测试未删除、禁用或放松断言。必要适配仅为：折叠高级字段前先执行真实展开操作；迁移预览版本改 3；旧样本 task 块补新必填 pending；v1 升级后备份数量增加一份。新鼠标辅助对超长块从视口内抓取，普通短块仍从主体上部抓取，保留精确移动/时长断言；手机切换回桌面后按实际行为恢复周视图再找第二天块。

## 6. 前后截图与可视证据

用户原始实测原样保留在 `docs/phase2实测/`；历史 Phase 2 证据保留原文件，不以新版截图覆盖旧验收历史。新图均来自隔离测试数据。

| 场景 | 修改前 | 修改后 |
| --- | --- | --- |
| 短背景被长块盖住 | [深色实测](<phase2实测/屏幕截图 2026-10-19 232129.png>)、[浅色实测](<phase2实测/屏幕截图 2026-10-19 232610.png>) | [周浅色](evidence/phase2_1-short-background-week-light.png)、[周深色](evidence/phase2_1-short-background-week-dark.png) |
| 普通长短块 | [原图](<phase2实测/屏幕截图 2026-10-19 222041.png>) | [日浅](evidence/phase2_1-normal-day-light.png)、[日深](evidence/phase2_1-normal-day-dark.png)、[周浅](evidence/phase2_1-normal-week-light.png)、[周深](evidence/phase2_1-normal-week-dark.png) |
| 长背景与短前景 | 原反馈同属混合重叠问题 | [日浅](evidence/phase2_1-long-background-day-light.png)、[日深](evidence/phase2_1-long-background-day-dark.png) |
| 密集重叠与手机入口 | [原多滚动条界面](<phase2实测/屏幕截图 2026-10-19 232414.png>) | [密集浅](evidence/phase2_1-dense-overlap-week-light.png)、[密集深](evidence/phase2_1-dense-overlap-week-dark.png)、[窄周浅](evidence/phase2_1-narrow-overlap-week-light.png)、[窄周深](evidence/phase2_1-narrow-overlap-week-dark.png) |
| 本次快速编辑 | [原父任务长表单](<phase2实测/屏幕截图 2026-10-19 232749.png>) | [本次快速编辑](evidence/phase2-1-quick-edit-light.png)、[任务浅](evidence/phase2-1-task-details-light.png)、[任务深](evidence/phase2-1-task-details-dark.png)、[390详情](evidence/phase2-1-task-details-mobile-dark.png) |
| 统一日期选择 | [原生数字控件](<phase2实测/屏幕截图 2026-10-19 232850.png>) | [精确时间浅色](evidence/phase2-1-picker-light.png)、[手机日期深色](evidence/phase2-1-picker-mobile-dark.png) |

已查看日/周浅深、背景互换、窄周、任务详情与选择器截图；几何/点击/真实拖拉另由断言验证，截图不代替交互。部分截图含短暂保存提示，不影响可操作区域。完整测试跟踪产物位于被 Git 忽略的 playwright-report/test-results，可用 `npx playwright show-report` 查看。

## 7. 未完成项、已知风险与未验证边界

- **未验证**：用户原浏览器原先“右侧无法拖入”的失败仍未在本机复现，不能声称已确证根因。当前隔离 Chromium 的右侧日/周拖入、重挂、失败回滚均有回归；仍需同浏览器、同 4173 地址复测。
- **未验证**：真实 iPhone/iPad Safari、系统软键盘、触摸长按、存储回收、长期大量数据。本次桌面移动宽度不是实机验收。
- **未实现/范围外**：周期性任务自动生成与逐次打卡、完整习惯追踪、“此后所有”系列编辑、单次取消的可视化逐项恢复。当前支持手动为同一任务安排多段并分别打卡。
- 背景仍通过详情编辑，FullCalendar 不原生拖拉背景；普通/task 前景可拖拉。窄列不保证所有标题同时铺在时间轴，但有可见 +N 完整入口。
- 同一标题/时间在多个页同时保留编辑草稿仍按保存顺序写入，暂无字段级冲突提示；本次完成字段已在事务中与范围编辑分开保留。远端同步/冲突处理属于尚未启动的 Phase 3。
- 替换 JSON 不是合并导入；一次读取/校验完整快照，未做极大规模压力验证。旧 Service Worker 页需关闭后再打开新版；禁止把清除网站数据作为更新步骤。
- 依赖审计的 **未通过项**：当前 Vitest 3.2.7 开发链 `vitest/@vitest/mocker/tinypool` 共 3 条告警（1 moderate、2 critical），生产依赖审计为 0。未用 `audit fix --force` 擅自跨大版本改测试栈；后续独立升级验证。没有宣称全依赖安全审计通过。

## 8. Git 分支与提交

开发分支：`feature/phase2-1-ux-rework`，直接从完整 Phase 2 分支 `feature/phase2-calendar-ux` 的 `249c8c3` 创建，包含 `7f957db` 完整实现；没有从规格 main 重建。

开始时只有用户提供的提示词/实测目录未跟踪，全部保留。未 push、merge、rebase、reset、clean、force push，也未修改其他项目或使用 PAT。

| 提交 | 内容 |
| --- | --- |
| 249c8c3 | Phase 2 完整交付基线 |
| 867bbf5 | feat: simplify schedule editing and track per-block completion；代码、迁移、测试、说明与证据 |
| 本报告提交 | 阶段验收结论与实际结果；自身哈希见 git log，避免自引用 |

## 9. 启动与用户亲自验收

```powershell
cd C:\Users\34201\Desktop\polar_schedule
npm install
npm run build
npm run preview -- --port 4173 --strictPort
```

打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)，Ctrl+C 停止。开发可用 `npm run dev`，默认 5173；它与 4173 数据来源不同，不要把空库误认成升级丢数据。

1. 原浏览器先导出独立 JSON；联网关闭同来源旧标签页，再重新打开新版同一地址。确认旧清单/任务/课程/主题存在，旧任务段为待执行。无需清除 IndexedDB 或网站缓存。
2. 在你的原失败浏览器，右侧同一任务拖到日/周两次；任务仍一条。点击日历第一块直接改时，检查第二块不变。
3. 完成第一段，第二段仍待执行、父任务仍待办；逐段撤销；再把整个任务完成，检查两层记录。刷新、关闭重开、导出备份。
4. 用原场景长 08–23 与短 08:30–09:45，普通/背景两种主次互换，深浅主题；点击 ▧/+N 查看完整标题和编辑。再试 4 条以上与手机入口。
5. 点起止输入框选跨月日期/07 分钟/跨日结束；Esc 取消；在真实手机检查软键盘、滚动和触摸可达。

## 10. 下一阶段建议

先完成第 9 节真实环境复验；若打卡是主要需求，下一小阶段设计“周期性 Task 的安排生成与逐次记录”，复用当前稳定块 ID/状态，同时补同记录多页草稿冲突提示与开发测试栈升级。GitHub 授权/同步需要另行授权，Phase 3 尚未开始。
