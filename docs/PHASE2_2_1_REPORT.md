# Polar Schedule Phase 2.2.1 补充修复验收报告

日期：2026-10-20 · 应用版本：v0.2.3（Phase 2.2.1 修复版）

## 1. 范围与结论

本次只完成用户指定的两项修复：取消背景分级并简化重叠布局，修复日程弹窗的圆角与滚动结构。不增加展示模式或其他功能，不进入 Phase 3。

从完整 Phase 2.2 分支 `feature/phase2-2-ux-polish` 的 `3d8a817`（功能提交 `f939324`）安全创建 `codex/phase2-2-1-simplify-overlap`；开始时工作区干净。已阅读 [上一阶段报告](PHASE2_2_REPORT.md)、现有代码、测试与 v3 模型。

**功能修复与本地自动化验收通过：114/114 单元/组件、59/59 浏览器流程、类型检查和生产构建通过。** 已真实操作鼠标、键盘、滚轮、拖动与拉伸并查看截图。生产依赖审计 0 条；开发链仍有 3 条已知告警，审计不记为全部通过。个人浏览器及真实手机仍有第 7 节的未验证边界。

## 2. 重叠布局：删除而不是再叠加分层

主要修改：`src/features/calendar/Calendar.tsx`、`calendar.css`、`calendar-ux.css`、`calendarPresentation.ts`、`ScheduleEditor.tsx`、`src/features/settings/SettingsDialog.tsx`。

- 所有展开的任务块、独立日程、旧背景记录和重复实例统一映射为 `display: block`、`editable: true`。日/周继续 `slotEventOverlap: false`，采用 FullCalendar 标准并列，移除 `eventMaxStack` 自定义容量上限；时间、冲突及真实数据不被调整。
- 删除 `isBackground` 展示分支、`TimeMarker` / `MarkerTarget` / `buildTimeMarkers`、portal 标记层、专用 rail、动态列宽状态、`readableStack`、chooser、背景日期头和密集 `+N项` 按钮、背景专属列表及对应 CSS。Calendar.tsx 本次净减少 124 行，不保留隐藏的旧分层入口。
- 移除新建/编辑的“日历呈现方式”选择和对应表单 state，移除设置的“显示背景安排”开关。已有 `display` / `showBackground` 仍兼容存取，不能再使日程隐藏或分级。
- 保留普通“本段安排”完整列表、显示时段外安排、重复系列管理、当天预览及月视图原生更多。它们展示完整标题、时间并进入原有编辑路由；没有重建复杂悬浮栏。
- 每次执行仍读取既有 `executionStatus`。保留 `✓ 已完成` 和轻量底色/实线，去掉虚线边框；另一执行段及父任务状态独立。

大量重叠时所有卡片直接并列；窄列允许标题截断，完整信息由日期预览/本段列表或日视图查看。没有承诺 390px 周列中的多个完整标题仍同时可读。

## 3. 弹窗实际根因与修复

修改前用独立浏览器收集 [真实 DOM/计算样式记录](evidence/phase2_2_1/dialog-before-dom.json)：

- 外层原生 dialog 的 `overflowY=auto`，`clientHeight=710`、`scrollHeight=1233`；滚动时外框 `scrollTop` 从 0 到 523。
- header 仅为 `position: sticky`，自身圆角为 0；form 和保存区为普通静态内容，保存区初始 y=1192.5，处在 760px 窗口之外。手机同样由整个 dialog 滚动，694px 内容高度承载 1292px。
- 已确认的问题是**外框兼任滚动容器、头部靠 sticky、保存区随内容滚动**。滚动条与内部绘制都抵达外框边缘，缺少一致的独立内容裁切边界；单纯把 radius 再设一遍不能解决结构问题。

旧 headless Chromium 截图中外角原本仍能看到 16px 圆角，**没有完整复现用户原系统滚动条下的直角外观**。因此不把上述记录描述为已证明某个具体操作系统的绘制缺陷；本次针对已证实的滚动结构与边界问题修复，并通过新截图/真实滚动验证。

修复文件：`src/components/Controls.tsx`、`src/styles.css`、`src/features/calendar/ScheduleEditor.tsx` / `block-form.css`、`src/features/settings/settings.css`、日期/颜色选择器 CSS。

- 通用 Dialog 为圆角 flex 外框、非 sticky 固定 header、独立 `.dialog-content`。只在对应 dialog 外框裁切，不增加 body/html 的全局 overflow 隐藏。
- 日程 form 分成 `.schedule-editor-scroll` 和固定 `.schedule-editor-footer`；创建路径/编辑范围与 header 保留在滚动区之外。外框 scrollTop 保持 0，wheel 只改变中间字段区，标题和保存区坐标保持不变。
- 设置适配新内容包裹层，保持其分组导航固定、原 settings-body 独立滚动；清单等通用弹窗保留各自表单操作。
- 日期/颜色弹层外框与内部内容分开滚动，继续使用 native modal 顶层。即使父表单裁切也不会截掉子弹窗；Esc 只关闭当前子弹层、焦点返回触发按钮，父表单未保存草稿不变。

## 4. 旧数据保护

Dexie 仍 `version(3)`，JSON `schemaVersion=3`；原生 IndexedDB version=30 为 Dexie 的编码。`src/storage/`、当前及冻结的 v1/v2 schema、日期/时区转换没有修改，没有迁移、清库、重建或批量改字段。

新建独立日程保存 `display=normal`；编辑旧 event 则继承原 `block.display`，拖动/拉伸同样保留旧属性。旧 JSON 的 `display=background` / `showBackground=false` 导入后，日/周/月全部正常显示。

新增兼容测试实际执行：旧 v3 JSON 导入 → 日/周/月显示 → 标题保存 → 拖动 1 小时 → 拉长 30 分钟 → 刷新；检查原 ID/display/颜色、其他块、父任务、清单、标签、例外、墓碑、设置和备份不被串改。v1/v2 升级及恢复、离线、跨页和撤销继续回归。

修改前后截图另用完全相同的 11 条安排；[after-observations](evidence/phase2_2_1/after-observations.json) 的 `recordEntitiesUnchanged`、`matchesBeforeInitialSnapshot`、`matchesBeforeFinalSnapshot` 均为 true。原始全表快照在同目录；显式主题切换仅改变对应 metadata，前后同条件比较包括全部表。所有操作仅在隔离测试上下文/测试库内进行，未读写个人日常浏览器数据库。

## 5. 截图与真实操作

新证据统一放在 `docs/evidence/phase2_2_1/`，以前阶段图片和报告不覆盖。已实际查看下面的前后图及宽度/主题矩阵，检查四角、滚动前后、截断与子弹层边界。

| 场景 | 修改前 | 修改后及检查 |
| --- | --- | --- |
| 长 08–23 + 短安排 + 旧背景 + 完成段 | [旧混合日视图](evidence/phase2_2_1/before-mixed-day-light.png) | [新混合日视图](evidence/phase2_2_1/after-mixed-day-light.png)：4 块直接并列，旧背景也可直接操作，完成无虚线 |
| 五条重叠/周布局 | [旧周浅色](evidence/phase2_2_1/before-overlap-week-light.png) | [新周浅色](evidence/phase2_2_1/after-overlap-week-light.png)、[新周深色](evidence/phase2_2_1/after-overlap-week-dark.png)、[五列日视图](evidence/phase2_2_1/after-five-overlap-day-light.png)：无旧标记/rail/容量收纳 |
| 长表单外框与保存区 | [旧底部](evidence/phase2_2_1/dialog-before-desktop-bottom.png) | [1440 顶部](evidence/phase2_2_1/dialog-after-1440-light-top.png)、[1440 底部](evidence/phase2_2_1/dialog-after-1440-light-bottom.png)：字段滚动、标题与保存位置固定 |
| 平板/手机深色四角 | [旧手机深色](evidence/phase2_2_1/dialog-before-mobile-dark.png) | [768 深色](evidence/phase2_2_1/dialog-after-768-dark-bottom.png)、[390 深色](evidence/phase2_2_1/dialog-after-390-dark-bottom.png)、[390×480](evidence/phase2_2_1/dialog-after-390-dark-low-bottom.png)：均已查看且无横向溢出 |
| 子弹层不被父框裁切 | [旧颜色弹层](evidence/phase2_2_1/dialog-before-color.png) | [日期顶层](evidence/phase2_2_1/dialog-date-top-layer-mobile-dark.png)、[颜色顶层](evidence/phase2_2_1/dialog-color-top-layer-mobile-dark.png)：真实输入/Esc/回焦/不提交父表单 |
| 旧背景关闭显示标志的 JSON | 原数据保留 background/false | [日](evidence/phase2_2_1/after-legacy-import-day.png)、[周](evidence/phase2_2_1/after-legacy-import-week.png)、[月](evidence/phase2_2_1/after-legacy-import-month.png)：均为普通条目，原生表深比较不变 |

另有 `after-day/week-{2,3,4}-{light,dark}.png`、390px 日/周截图及 8 种日程弹窗条件的 top/bottom 图。真实行为断言包含：并列几何不相交、elementFromPoint 命中、直接点击编辑、拖动/拉伸后的实际数据、wheel 引起内容 scrollTop 增长、固定头脚位置不变、modal 状态和焦点；不只检查 CSS 声明或保存截图。

## 6. 实际测试结果

环境：Windows · Node.js 24.13.0 · npm 11.6.2 · Playwright 1.64.1 / Chromium；Asia/Shanghai 与 America/New_York。

| 实际命令/检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，严格 TypeScript |
| `npm run test` | **114/114，16 文件，0 失败/0 跳过，13.35 秒** |
| `npm run build` | 通过，2435 模块；7 个离线资源，SW `cad5e399a61de044`；主 JS 218.02KB / gzip 66.72KB，CSS 57.77KB / gzip 11.11KB |
| `npm run test:e2e` | **59/59，0 失败/0 跳过，2.5 分钟**，使用上述最终构建 |
| `npm run test:e2e -- e2e/compatibility-phase2_2_1.spec.ts` | 截图显式滚动到旧记录后，定向复验 1/1 通过，3.6 秒；应用源码无改动 |
| 4190 日历新旧定向验证 | 20/20，1.2 分钟 |
| 4191 弹窗验证 | 10/10，11.3 秒；1440/768/390×浅深 6 条件、1440×480 浅/390×480 深、日期颜色顶层、清单父草稿 |
| 4192 兼容/数据/设置/迁移回归 | 10/10，23.2 秒；另完成同 11 块数据的 6 张 after 与全表比较 |
| `npm audit --omit=dev --json` | 0 条生产告警，退出 0 |
| `npm audit --json` | 3 条开发链告警（1 moderate、2 critical），退出 1，**未通过** |
| ESLint | 项目未配置，未执行，不记为通过 |
| 交付检查 | `git diff --check` 通过；29 个本地报告/README 链接存在；84 张历史截图与 `3d8a817` 逐字节一致；前后两组原生表快照深相等 |

原 44 组浏览器用例全部保留；新增 4 组并列/拖拉/预览、10 项弹窗条件、1 组旧 JSON 兼容，共 59。仅把已取消的背景模式/开关、marker、容量上限断言改为正式新语义：导入旧值后全部前景、无旧入口、保留字段；无关的任务拖入、失败回滚、删除撤销、重复系列、子任务标签、日期跳转、离线刷新、跨页和恢复断言均保留，没有 skip/only。原容量算法单测改为同时重叠旧值的预览完整性，新增旧背景保存字段组件回归，总数从 113 到 114。

## 7. 未完成项、风险与用户待验

- 本次范围内代码及隔离环境自动化验收已完成，无遗留失败测试。生产环境的系统原生滚动条、用户原 Edge 配置、真实手机 Safari/软键盘与辅助技术未验证；上述 Chromium 截图不代表所有实机已认证。
- 窄周列中 4/5 条直接并列时标题会很短，390px 尤其明显。这是本次“全普通并列”取舍，允许简洁截断；点日期预览、完整列表或切到日视图看全文，不重新引入分级栏。完成状态在完整日视图/预览仍清楚，极窄卡片依靠勾号识别。
- Vitest 3.2.7 开发链 `vitest/@vitest/mocker/tinypool` 的 3 条包级告警与上阶段一致；未增加依赖、未执行 audit fix --force。后续可独立升级测试栈验收，不能称全依赖审计通过。
- 建议用户在原浏览器原地址复验外框四角，尤其使用非悬浮系统滚动条时；无需清理 IndexedDB 或网站数据。真实个人库未被自动化访问，不能代替用户确认原有个人数据。

## 8. Git 与交付

修复分支：`codex/phase2-2-1-simplify-overlap`；基线 `3d8a817`，保持原 Phase 2.2 分支。没有 reset/clean/rebase/stash、远端推送、main 合并或发布操作。

| 提交 | 内容 |
| --- | --- |
| `f939324` / `3d8a817` | Phase 2.2 功能与验收基线 |
| `cd694b3` | 简化布局、弹窗结构、测试、规格与本次证据 |
| 本报告提交 | 实测结论、根因和边界；自身哈希见 git log，避免自引用 |

README 更新 v0.2.3 使用方法和本报告链接；PRODUCT_SPEC 追加第 18 节覆盖旧背景展示策略，历史报告和约束原样保留。schema/storage 未修改；历史证据、文档链接及 diff 已复核。

## 9. 简单启动与手动验收

```powershell
cd C:\Users\34201\Desktop\polar_schedule
npm install
npm run build
npm run preview -- --port 4173 --strictPort
```

打开 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)，Ctrl+C 停止。固定同一浏览器/地址/端口；先在原浏览器导出独立 JSON，联网关闭旧标签后重开新版即可，无需清库。

1. 用旧背景安排或旧备份，确认日/周/月都显示为普通条目，无显示模式/隐藏背景开关。长 08–23 与短 08:30–09:45 并排，分别点击、拖动、拉伸；任务段完成状态独立。
2. 加入更多重叠条目，确认无特殊分级栏；标题较短时从日期预览或本段列表编辑。月更多仍自然滚动。
3. 打开长重复日程编辑，在浅/深、不同窗口宽高滚动到底，确认四角、标题和保存区；打开日期/颜色，Esc 仅关子弹窗并返回焦点。
4. 保存刷新，再导出新备份。检查已有数据、标签、重复例外和完成记录仍在。

下一步建议：先完成原浏览器及真实手机滚动条复验，再独立处理开发依赖告警；本修复不启动 Phase 3。
