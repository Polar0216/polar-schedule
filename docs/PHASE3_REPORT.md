# Polar Schedule Phase 3 验收报告

日期：2026-10-23 · 应用 v0.3.0 · 分支 `feature/phase3-github-sync`

## 1. 本阶段范围与结论

**通过：169项单元/集成测试、71项真实浏览器 Mock 流程、构建与两项安全审计全部通过；指定私有测试仓库的真实 Contents API 初始化/创建/更新/读取/冲突/错误与数据完整性联调通过。** 口令加密为明确延期的可选项，用户日常浏览器、真实手机与正式仓库的边界见第7节。

以 [PHASE3_GITHUB_SYNC_PROMPT_TEST_PAT.md](PHASE3_GITHUB_SYNC_PROMPT_TEST_PAT.md) 为完整要求，已阅读产品规格、Phase 2.2.1 报告、README 与 AGENTS。开始时位于完整分支 `codex/phase2-2-1-simplify-overlap` 的 `253f7dc`，其功能提交为 `cd694b3`；只有用户提供的本阶段提示词未跟踪。安全创建新分支，未从 main 重建。

实现纯前端、离线优先的指定私有测试仓库同步：严格 API 边界、首次预览、三方合并、冲突处理、持久共同祖先、SHA 提交、未知结果核实、可信设备授权、跨标签保护和轻量状态。保留原有日历/清单/任务/每段完成、重复例外、日期颜色选择器、备份与撤销。未发布网站、推送远端、合并 main、访问正式数据仓库，也未清空或导入个人浏览器数据。

## 2. 实现内容与主要文件

| 内容 | 主要文件与行为 |
|---|---|
| 固定 API 边界 | `src/sync/githubClient.ts`；只允许官方 origin、精确私有测试仓库、main、受控文件路径；拒绝重定向，验证仓库身份/private/default branch，区分文件 404 与仓库/分支不可访问 |
| 远端协议 | `snapshotCodec.ts`；格式标识/version1 包装领域 v3，稳定排序、UTF-8/base64、严格实体与引用验证、1 MiB 上限；普通 v1/v2/v3 JSON 导入行为不变 |
| 真正三方合并 | `merge.ts`；base/local/remote 按稳定 ID 与存在/墓碑状态比较；不同记录合并、相同更改去重、同 ID 竞争与删除/修改暂停；不按时间/revision选胜者 |
| 持久同步与队列 | `syncEngine.ts`、`types.ts`；base/SHA/时间、首次与冲突两端预览、上传候选及起始 local；本地相对 base 的差异在重开后重建待同步队列，3 秒防抖、10 秒焦点/联网节流 |
| 失败与并发 | `syncState.ts`；Web Locks + IDB 事务续期租约；迟到状态不能复活暂停/清凭据；409/422/未知 PUT 最多三次，先回读核实；401停止、限流/5xx展示重试时间 |
| 本地原子确认 | `src/storage/database.ts`；上传确认后再事务读取最新 local，合并期间编辑、验证、必要备份，才更新共同 base；失败不推进或清队列 |
| 授权 | `credentialVault.ts`；用户主动勾选才保存专用凭据，未勾选仅会话内存，授权代号隔离跨标签清除/更换；不进入普通 Store、导出或同步快照 |
| UI | `src/features/sync/`、App、SettingsDialog、main；同一设置分组、顶部可点轻量状态、首次双方摘要、两端导出、冲突选择、自动/立即/断开，正式模式不可用 |
| 安全与样式 | `index.html` CSP；`src/styles.css` 区分文本输入和单选/复选控件；设置分组只滚动中间内容区，保持标题、圆角、焦点和 Esc |
| 自动验收 | `src/sync/*.test.ts`、`e2e/sync-phase3.spec.ts`、`scripts/verify-mocks.mjs`、`source-digest.mjs`、`test-github-live.mjs`；实网脚本仅在完整 Mock 与当前源码指纹匹配后读取秘密文件 |

共享设置是时间粒度、起止显示小时、周起始和默认安排长度。主题、视图、时区、侧栏、密度、隐藏清单和旧背景显隐字段保持设备本地。完整协议、状态机、删除/冲突语义与恢复见 [PHASE3_SYNC_DESIGN.md](PHASE3_SYNC_DESIGN.md)。

## 3. 兼容、数据保护与安全检查

- Dexie v3→v4 只增加 syncStates / credentials / syncLeases 三个空表；原生 IndexedDB 30→40。领域 schemaVersion 仍为 3，冻结旧验证器与旧升级管线未改动；原 ID/revision/时间戳、完成段、系列/例外、标签、墓碑、主题、备份与撤销不改写。
- 原生 v3 增量升级集成用例使用有完成/未完成段、背景系列、例外、子任务、标签、墓碑、旧备份与撤销的真实 IndexedDB 数据库。浏览器原生升级及历史丰富 v3 fixture 回归继续执行，不使用“清库重新建样例”冒充升级。
- 本地变更先提交原 Repository 事务；断网/授权失效仍可编辑。接收远端变更前自动保存 kind=sync 快照；失败回滚，断开不删除领域数据、共同祖先或旧备份。
- 普通 JSON 与原始恢复导出白名单排除凭据/同步状态；远端包装也不含备份、撤销、缓存、日志或设备凭据。密码框提交即清空，令牌不进入 React 展示状态；错误采用固定文本，不反射远端正文。
- 所有常规浏览器验收使用隔离 profile 与假令牌；额外视觉 QA 也使用隔离虚构冲突种子，未读取个人数据。没有把外部临时测试 PAT 放入浏览器。
- 静态令牌模式扫描覆盖 src / scripts / e2e / docs / README / package / HTML，匹配文件数为 0。实网进程中的实际秘密精确字节扫描覆盖 src / dist / docs，结果通过；从不输出令牌内容。

## 4. Mock / 本地自动化结果

独立依赖升级提交前，原有 114 项单元/组件测试、59 项浏览器测试全部通过。Vitest 从 3 系升级至兼容 Node 24/Vite 7 的 4.1.12，未运行 audit fix --force。

最终完整门禁于 2026-10-23 22:22（Asia/Shanghai）完成，以下为实际执行结果：

| 检查 | 结果 |
|---|---|
| `npm install` | 已执行成功，180 packages，0 vulnerabilities |
| `npm run typecheck` | 通过 |
| `npm run test` | 169/169 通过，19 文件（原114 + 新增55） |
| `npm run build` | 通过，7个离线静态资源；无凭据注入构建环境 |
| `npm run test:e2e` | 71/71 通过（原59 + 新增12），最终完整运行4.9分钟 |
| `npm audit --omit=dev` | 通过，0条 |
| `npm audit` | 通过，0条，先前3条开发链告警已消除 |
| `git diff --check` | 通过 |
| 额外隔离视觉 QA | 6/6 DOM 布局检查通过，390/768/1440px × 浅/深 |

新增 Mock 覆盖：四种首次连接组合及零自动写入；显式远端接收前备份；可信模式关闭进程重开、会话模式不落盘与跨标签清凭据；离线三条连续保存和重开后单批上传；两隔离设备不同任务合并、同任务/删除冲突、相同编辑和新 ID 并集；引用完整性、ID 碰撞、墓碑重建；多标签锁；上传期间新增编辑；PUT 已提交但响应丢失的核实；409重读合并与连续竞争有上限；本地确认事务失败后恢复；公开仓库误连、损坏格式/版本/关联、超限、网络及401/403/404/409/422/429/500安全降级；导出无凭据；UI多尺寸、主题、焦点和Esc。

真实 API 的 401/409/422 不能替代上述全部 Mock 故障矩阵；两者分开验收。

调试中实际发现并修复：浏览器原生 fetch 绑定、设置 scrollIntoView 带动外框、单选按钮继承文本框全宽。最后保持单个 :not 选择器列表的原有优先级，避免隐藏文件输入被撑大。旧颜色用例保留完整操作，在确认前等待最终可见色值；SHA竞争测试按 ID 查记录，避免把稳定排序后的随机新任务当作原任务。没有删除不相关用例。沙箱 Vitest 临时目录 EPERM 曾使测试未能启动，使用正常本机权限后通过，不将该次未执行记为测试成功。

最终机器结果：[mock-results.json](evidence/phase3/mock-results.json)，六条命令 exitCode 均为0、passed=true，源码指纹 `38d7eebb903b8ab82e0f146774ed2d275e95a83f6949bebea72068051e71ce96`。实网读取令牌前再次核对该指纹，禁止旧门禁用于新源码。

## 5. 真实 GitHub API 联调

**通过。** 完整 Mock 门禁结束后，单独执行 `npm run test:github:live`，exitCode=0。执行时间：2026-10-23 22:23:01—22:23:17（Asia/Shanghai）。仅在此 Node 进程中读取已授权的项目外临时PAT，不通过CLI参数、环境变量、浏览器或构建传递。

目标：`Polar0216/polar-schedule-data-test`，先验证精确 full_name、private=true、default_branch=main；根Contents返回404且仓库size=0后，才初始化空库。

本次写入仅两个归属明确的文件，成功写入3次：

- 初始化标识：`.polar-schedule-test-init.json`（没有任何真实日程信息）。
- 唯一虚构测试快照：`data/phase3-e2e/run-20261023142301168.json`（创建后带SHA更新一次）。

| 实际操作 | HTTP结果 / 验证 |
|---|---|
| GET私有仓库身份 | 200，精确目标、私有、main验证通过 |
| GET空仓库根Contents | 404，结合仓库size=0安全解释为空库 |
| PUT首次初始化标识 | 201，形成main首次提交，无需用户手工README |
| GET唯一测试路径 | 404，私有仓库再次验证后确认缺少文件 |
| PUT创建虚构快照 | 201，返回有效blob SHA |
| GET读取创建结果 | 200，UTF-8与全内容指纹一致 |
| PUT带读取到的SHA更新 | 200，新SHA不同 |
| PUT过期SHA（模拟另一写者持有旧版本） | 409，后续回读确认未覆盖新内容 |
| PUT故意缺少content的请求 | 422，后续回读确认数据与SHA未变 |
| 使用无效占位凭据GET同一仓库 | 401，错误采用固定消息；没有向其他仓库测试权限 |
| 最终GET回读与codec往返 | 200，最终SHA及完整指纹一致 |
| 精确临时凭据扫描 | src / dist / docs无令牌字节，passed；进程结束前清除客户端引用 |

14次串行受控请求，未触发限流；没有网络重试风暴。含中文/emoji、ID/revision/时间戳、子任务、标签、独立完成和待完成段、背景旧值重复系列、例外及墓碑的虚构快照均通过严格codec与全内容一致性验证。

结果归档：[github-live-result.json](evidence/phase3/github-live-result.json)。测试文件保留供用户检查，只保留少量本次虚构资源，没有删除或清空仓库。没有写应用文件 `data/polar-schedule.json`，没有访问正式仓库、前端仓库或其他仓库。

**实网验证范围仅为该测试仓库API通路。** 429/5xx、丢失响应、两个隔离浏览器/多标签与完整冲突UI是在Mock中故障注入；没有把本次单进程过期SHA测试宣称为真实跨设备实网全量验收。

## 6. 浏览器操作与截图检查

107张新截图独立存于 [evidence/phase3/](evidence/phase3/)（16张同步/视觉QA + 91张历史回归新截图），历史证据未覆盖。已检查首次预览、成功、授权失效仍可本地编辑、冲突版本/选项和不同尺寸浅深主题；历史回归继续检查拖动/拉伸、背景旧值普通前景、日期/颜色弹窗和每段独立完成。

- [手机深色首次确认](evidence/phase3/preview-390-dark.png)
- [桌面深色冲突详情](evidence/phase3/conflict-detail-1440-dark.png)
- [手机浅色冲突详情](evidence/phase3/conflict-detail-390-light.png)
- [两隔离设备冲突操作](evidence/phase3/conflict-tablet-light.png)
- [实际 DOM 记录](evidence/phase3/visual-dom.json)

六种冲突布局：外框 scrollTop=0，四角同为16px，标题在外框内，中间内容区水平溢出=0。手机版本卡片纵排并各自滚动，选项文本横排；滚动不会带走固定标题。日期/颜色弹层沿用 native modal 顶层，键盘/Esc/焦点回归继续执行。截图和 DOM 证明隔离 Chromium 布局，未声称复现所有操作系统滚动条或真实 Safari 绘制。

## 7. 未完成与未验证边界

- **未完成（可选项）**：PBKDF2/AES-GCM 口令加密模式。本阶段交付主要要求的可信设备便捷模式，并明确其保存可用凭据、不能防同源恶意脚本/扩展/本机受控的风险；没有虚称加密。
- **未开展**：正式仓库/正式PAT、Pages部署、发布、GitHub历史一键回滚、分片/增量云端协议、任意仓库或Enterprise配置。
- **未验证**：用户日常浏览器中的真实授权与真实手机/平板Safari、多日使用/系统级存储回收、真实两设备全量端到端。实网 Node API 成功也不能替代这些事项。
- **已知限制**：整记录冲突需选择，不做细粒度字段拼接；首次无base时只能明确整端采用；远端文件上限1MiB；接收同步会保存本地快照，当前不额外自动清理，长期存储占用需关注。

## 8. 用户需要亲自完成的事项

只需按 [5–10分钟一次性界面验收](PHASE3_FINAL_ACCEPTANCE.md) 在原来源先导出备份，自己粘贴测试PAT、选择是否记住、确认首次数据归属并查看GitHub测试文件/提交。开发者不会预置临时PAT到日常浏览器。无需手动初始化仓库、调用API、改脚本或来回解决依赖问题。没有第二设备可先跳过实机双端验证，保留对应未验证标记。

## 9. Git 与下一阶段建议

- 开发分支：`feature/phase3-github-sync`，起点 `253f7dc`（功能基线 `cd694b3`）。
- 独立安全升级：`202b67b`，`chore: upgrade Vitest and resolve development advisories`，升级后原有完整回归通过。
- 本阶段实现提交：`0b2de14`，`feat: add safe private test-repository GitHub synchronization`（源码、测试、设计、一次性验收说明及去敏感证据）。本报告随后单独归档，可用 `git log --oneline -3` 查看报告提交。
- 未 push、merge、rebase、reset、clean 或发布。

下一步先完成用户的一次性真实界面验收，确认后再另行授权 Phase 4。可后续单独实现口令模式、同步备份保留策略与文件容量迁移；不自动开启正式仓库或发布流程。
