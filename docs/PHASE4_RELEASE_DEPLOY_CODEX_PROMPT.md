# Polar Schedule — Phase 4：正式发布、PWA、多端使用与生产仓库接入

> **给 Codex 的完整执行指令** · 执行基线：Phase 3 v0.3.0 · 目标：可公开访问的静态应用，个人数据始终私有 · 优先级：**自主完成，尽量不要打断用户**

## 0. 最重要的执行授权与边界

用户现在明确要求：**开始 Phase 4，尽可能由 Codex 独立完成，用户没有时间反复配合调试。**

你是此阶段的主要开发、测试与发布执行者。完成前请自行查阅代码、历史报告、官方文档和错误日志，自行实施、运行和修复；普通技术实现选择不必询问用户。**不要只提出建议或生成空壳 workflow。**

在满足下述条件时，你已获授权：

- 自行创建开发分支、提交代码、完善文档、修改公开前端的构建与 Pages 工作流；
- 使用机器上**现有、已授权的 GitHub 登录方式**（如 `gh`、Git Credential Manager）对**唯一公开前端仓库** `Polar0216/polar-schedule` 进行安全的非破坏性发布；
- 在完成全部必要质量门禁且确认远端 Git 历史安全之后，将本项目已验收的完整代码整合进该公开仓库默认分支并触发 GitHub Pages 部署，主动监测部署结果，发现问题自行修复；
- 为测试目的只读/写**指定测试私有仓库** `Polar0216/polar-schedule-data-test`，且沿用 Phase 3 的凭据使用约束；能用 Mock 完成的场景先用 Mock。

**严格禁止：**

- force push、覆盖或抹除远端已有提交、`git reset --hard`/危险 `clean`、未经核对的历史重写；
- 擅自读取/写入/初始化正式私有数据仓库 `Polar0216/polar-schedule-data` 中的个人日程；正式数据的第一次写入必须由用户在应用里查看摘要并明确确认；
- 将任何 PAT、生产数据、`.env` 秘密、个人导出的 JSON、浏览器 IndexedDB 内容加入公开源码、构建产物、Pages 产物、CI 日志或截图；
- 用测试数据覆盖用户原来 `http://127.0.0.1:4173/` 的浏览器数据库；
- 将**测试 PAT**用于前端代码仓库的推送/Pages 管理，或误用在正式数据仓库上；
- 新增必须运行的自建服务器、Cloudflare Worker、付费平台、生产数据库服务；
- 为了「让自动化通过」删除重要断言或跳过核心测试。

若发布动作确实受到登录、GitHub 权限或网页端所有者确认限制，**先完成所有能做的编码、Mock、本地验收和准备好安全分支/可供合并的提交**，最后集中报告 **至多几项**真正需要用户执行的授权/设置步骤；不能因此停掉整个开发阶段。

## 1. 首先检查项目现状和既有成果

本地项目（以实际存在的路径为准，先确认）：

`C:\Users\34201\Desktop\polar_schedule`

当前应从 Phase 3 完整代码（`feature/phase3-github-sync`）继续，而非从只含规格的老 `main` 开始。检查 `git status`、`git branch`、`git remote -v`、`git log`、package scripts、Pages 当前状态及已存在的未提交修改。保护未知改动；发现本机/远端状态与文档不符时先调查并在报告记录差异。

先阅读并遵循：

- `AGENTS.md`（如存在）
- `docs/PRODUCT_SPEC.md`
- `docs/PHASE3_REPORT.md`
- `docs/PHASE3_SYNC_DESIGN.md`
- `docs/PHASE3_FINAL_ACCEPTANCE.md`
- `README.md`
- `src/sync/`、`src/storage/database.ts`、现有 `scripts/build-sw.mjs`、Vite 配置、现有 e2e 用例及 `package.json`

已知 Phase 3 基线（应验证，不得反向假设）：

- 应用 v0.3.0；React + TypeScript + Vite + FullCalendar + Dexie；Dexie 版本 4，领域 JSON schemaVersion 3。
- `169/169` 单元/集成、`71/71` 浏览器 Mock、两项 `npm audit` 通过；实际 GitHub Contents API 曾成功测试空仓库初始化与文件读写、SHA 竞争。
- Phase 3 GitHub API 客户端限制为**指定测试私有仓库**，正式模式不可用。
- 有会话凭据模式和明确 opt-in 的「记住此设备」模式；尚无可用的 PBKDF2/AES-GCM 口令加密模式。
- Phase 3 没有使用真实 PAT 登录日常浏览器，也没有把用户数据导入测试仓库。

**不要重做已完成的同步引擎、独立执行完成、数据迁移、日期弹窗或日历 UI。** 本阶段以部署、多端、生产模式安全接入为主。

## 2. 确定的 GitHub 资源（仅允许这些目标）

| 角色 | 仓库 | 可见性 | 允许的操作 |
|---|---|---|---|
| 公开前端 | `Polar0216/polar-schedule` | 必须 Public | 检查、非破坏性推送、Actions、Pages 部署 |
| 私有测试数据 | `Polar0216/polar-schedule-data-test` | 必须 Private | 使用既有测试凭据做安全可重复测试（不得覆盖未知记录） |
| 私有正式数据 | `Polar0216/polar-schedule-data` | 必须 Private | 本阶段仅实现可用的生产连接能力及必要的**非秘密**元数据检查；不得在用户未确认前写个人数据 |

预计公开入口：`https://polar0216.github.io/polar-schedule/`。

**注意：预计 URL 并不等于实际部署成功。** 必须通过 Pages 设置、工作流、HTTP、资源加载和浏览器功能验证，以 GitHub 返回的实际 URL 为准。

发布前确认 `polar-schedule` 的准确 owner、仓库名、权限与 default branch。公开仓库可能是空库或存在初始文件；安全处理已有历史，不得盲目 `git push -f` 或无视不相关提交。

## 3. P0：GitHub Pages 真正可部署

使用 GitHub 官方支持的**GitHub Actions 构建并发布 Pages artifact**，优先 `npm ci`、`npm run typecheck`、`npm run test`、`npm run build`，上传 `dist/`，部署到 `github-pages` 环境；固定/检查 action 的兼容版本与所需权限（至少 `contents: read`、`pages: write`、`id-token: write`）。尽量让普通 PR 只验证、不发布，让默认分支安全触发部署，同时支持手动 rerun。

必要功能：

1. 对仓库子路径正确设置 Vite `base` 为 `/polar-schedule/`（或根据已验证站点实际路径生成），**不破坏 localhost、`npm run dev` 和原 4173 preview 使用**。
2. 核实 JS、CSS、SVG、图标、manifest、service worker、动态导入模块全部使用正确的发布子路径，禁止线上资源指向 `localhost`、硬编码 `/assets` 或出现 404。
3. 配置 Pages source 为 `GitHub Actions`；如果可以通过现有登录凭据和安全权限完成就自己完成，无法授权时将「Settings → Pages → Build and deployment → Source → GitHub Actions」作为**单个剩余用户动作**列出。
4. 根据远端 Git 状态决定安全发布路径：可以非破坏性整合则自行操作；如果需要人工审核或遇到未授权远端改动，准备明确的发布分支/PR 并说明阻碍，不得覆盖历史。
5. 正式部署后主动检查 Actions 结论、Pages `html_url`、页面 HTTP 状态、Console、资源网络请求与主页面截图；工作流失败应先自行查看日志并修复。不得将「构建通过」写成「网站已上线」。
6. 页面不打包任何 GitHub PAT、仓库数据文件、用户备份或隐藏凭据。保持严格 CSP，依据真实 Pages 运行约束做必要适配，不能用 `unsafe-eval` 等粗暴绕过安全限制。

可以参考最新官方文档：
- https://vite.dev/guide/static-deploy
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/rest/pages/pages

## 4. P0：正式私有仓库安全接入（不需要用户反复参与）

在 Phase 3 **已有**三方合并、SHA、断网队列、共同祖先和冲突 UI 基础上，把原先硬编码测试仓库改为**固定 allowlist**：

- 测试环境：`Polar0216/polar-schedule-data-test`
- 正式环境：`Polar0216/polar-schedule-data`

不开放任意 owner/repo 输入，不允许目录遍历或跨仓库 API 请求；继续核实 GitHub API 官方 origin、`full_name`、`private=true`、`default_branch=main`、受控 `data/polar-schedule.json` 路径。若正式仓库 default branch 与预期不同，谨慎停止并提示，不擅自改写。

### 凭据与模式

- 每种环境仅接受其有权限的细粒度 PAT，由**用户在网页端直接输入**，绝不打包或由 CI 注入。
- 「测试」和「正式」在 UI 上必须清楚区分，明确显示当前 repo；**禁止由测试自动切换正式**。
- 切换仓库或更换 PAT 时先停止并发同步，断开当前同步会话、核对待同步变更、保留本地数据/备份，并提示用户将建立**新的远端绑定**；严禁沿用测试仓库的 base/SHA 或将本地未同步变更偷偷上传到另一仓库。
- 首次连接执行本地/远端双端摘要预览，空远端不得默认覆盖非空本地；空本地也不能默认覆盖非空远端；需要用户明确选择归属并确认。
- 若远端已有数据，执行与 Phase 3 相同的格式和完整性校验，未经确认不写入。首次正式上传 personal data 必须是用户主动在 app 内确认的行为。
- 解绑只移除必要连接凭据与会话，不删除用户任务/本地备份；原账号绑定状态记录不要造成混库。
- 保留 Phase 3 的三方合并与删除/修改冲突保护，**不得用最后写入覆盖替代**。
- 不扩大授权权限，正式 fine-grained PAT 仅需 `polar-schedule-data` 的 `Contents: Read and write`。

### 「记住此设备」的真实安全边界

这是无需后端的静态前端：Phase 3 的可信模式会在浏览器保存可用凭据，**不能声称加密或绝对安全**。非常重要的事实：`https://polar0216.github.io/polar-schedule/` 与同账户 `https://polar0216.github.io/其他项目/` 是**同一 origin**，不能依靠路径把 IndexedDB 或 localStorage 中的凭据与其他 GitHub Pages 应用安全隔离。因此：

- 明确在持久记住凭据前说明同源脚本/浏览器扩展/本机被控的风险；默认不静默开启持久模式。
- 显示仅选单仓库、随时可撤销的 PAT 建议，支持会话模式和断开/清除。
- 检查 CSP 和外部 JS 依赖；不把 secret 注入 Actions 或构建。
- 可将**可选的口令加密凭据仓库**作为安全增强实施（使用 Web Crypto、标准 KDF + AEAD、锁定/解锁、正确说明口令丢失风险），但它不能被描述为自动无感登录，也**不得因为该增强拖延主线正式发布**。若不做，记录延期及风险，不能假称已完成。

## 5. P0：localhost 迁移到 Pages 不丢日程

浏览器 IndexedDB 按 **origin** 隔离。`http://127.0.0.1:4173` 与 `https://polar0216.github.io` 是不同 origin，绝对不能假设新站点自动有旧站数据。

提供清晰、不高打扰的首次使用指引：

1. 旧网站先执行**完整 JSON 导出**到电脑，确认备份文件存在；
2. 新 Pages 网站首次打开是独立的本地库，用户可从 JSON 导入，或从已同步的正式远端明确接收；
3. 若此前的数据仅在测试仓库，不能因为发布就自动复制到正式仓库。用户需要确认选择正式数据源，迁移采取**预览 → 本地快照 → 明确确认 → 导入/同步**；
4. 不把旧 localhost 上的数据“清空后重新开始”，保留旧浏览器及其数据供回退；
5. 旧 JSON v1/v2/v3 导入继续正确，Dexie v4 和远端包装校验继续正确，浏览器实际导入测试使用**隔离虚构数据**。

用户没有精力多次参与，故所有可预置的迁移检查/说明/失败保护由你完成；只把**正式凭据输入、最终数据源确认**作为必须用户本人做的步骤。

## 6. P0/P1：PWA 安装、离线与更新

在现有离线静态资源缓存基础上完成真正可安装 PWA：

- 完整 manifest：name/short_name、图标（192/512，必要时 maskable）、theme/background、display、start_url、scope；路径必须限定 `/polar-schedule/`。
- Service worker 注册和缓存 scope 严格限制在本项目子路径；缓存 key 命名空间化；不能拦截同 origin 的其他 GitHub Pages 项目；不得删除它们的缓存。
- 预缓存本站静态资源以支持**首次联网访问后**离线启动；不要缓存带 `Authorization` 的 GitHub API、私有响应、用户数据或令牌；与浏览器本地 IDB 存储配合离线编辑。
- 使用稳定、可追溯版本的缓存更新策略，避免新旧资源混搭、无限旧缓存、打开页面时强制刷新造成未保存草稿丢失。新版更新提示可用，但不要做复杂通知中心。
- 移动端安装体验：iPhone/iPad 添加到主屏幕、Android 可安装入口、桌面安装支持；只在 API 支持时显示安装交互，非支持环境给简明说明，不假造安装成功。
- iOS/Safari 或浏览器未实测的特性，要明确标记为待用户设备最终验证。

注意：用户不要求推送通知、后台定时同步，也不能因为有 service worker 就声称关闭网页后仍会可靠地持续上传；恢复打开/联网后再同步即可。

可参考：https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable

## 7. 端到端体验与质量门禁

先利用 Mock 仿真不同设备/浏览器来源及所有关键失败，再发布；之后对真正公开 Pages 站点做**不带真实令牌、不上传个人数据**的在线 smoke test。

至少覆盖：

1. `npm ci`、`npm run typecheck`、`npm run test`、`npm run build`、`npm run test:e2e`、`npm audit`、`npm audit --omit=dev`，并复核原 Phase 3 169/71 基线；记录真实通过数，不硬编码旧数量。
2. 127.0.0.1 根路径和 `/polar-schedule/` 子路径构建/预览，所有静态资源、动态包和 SW 请求无 404。
3. PWA manifest/installability（以浏览器支持范围为准）、ServiceWorker 注册、缓存版本更新及下线旧静态资源；断网后重新打开并编辑、再联网同步。
4. 同一 mock 客户端分别连接测试/正式配置，身份校验拒绝 Public、错误 owner/repo、错误分支、错仓库 PAT。**测试不能碰真实正式仓库。**
5. 未连接时不会自动上传；首次空远端和非空本地不会自动覆盖；测试环境绑定信息不能透传到正式环境。
6. 双设备模拟：A 离线新建、B 在线修改不同任务、同步后不丢；同一任务冲突暂停；撤销/删除墓碑不复活；未知 PUT 状态回读确认。
7. 公开站点首次启动本地库空是正常的；旧 origin 数据通过用户主动 JSON 导入时独立存在；没有任何跨 origin 偷读。
8. 14xx/390px 手机与平板、浅色/深色；日周月视图、日期预览、每次安排完成、编辑弹窗、滚动及圆角不回退。
9. CSP 无需禁用即可访问官方 GitHub API；构建物、日志、图像、报告不存在敏感 token / 用户个人数据。
10. GitHub Pages 部署工作流真实成功，线上首页返回成功状态、能执行 JS 并渲染应用、离线注册路径正确。若没有发布权限，使用 local/proxy 上的等效子路径测试并在报告写明**未上线**。

对于未复现或无法验证的 Edge/iOS 实机特性诚实记录，不把 Mock、截图或 `curl 200` 单独当成真实手机端已验收。

## 8. 建议执行顺序（不要反复找用户确认）

1. **检查**：工作区、Phase 3 完整性、仓库配置和权限，创建 `feature/phase4-release-pages-pwa` 安全分支。
2. **质量前置**：运行旧基线，修好现有环境回归；保护真实浏览器和所有私有数据。
3. **构建部署**：子路径资源、GitHub Actions Pages workflow、纯公开构建检查。
4. **正式模式**：严格 allowlist、明确绑定隔离、首次确认和原同步机制复用。
5. **PWA**：manifest、图标、SW 作用域、缓存更新、离线恢复。
6. **迁移 UX**：从旧 4173 迁移的明确引导，JSON/远端接收流程的安全验收。
7. **回归**：Mock 多设备+离线+冲突+旧视图、TypeScript+构建+安全扫描、截图视觉检查。
8. **公开发布**：有权限时安全整合完整当前代码至公开仓库并部署 GitHub Pages；自行检查线上工作流和网站。
9. **报告**：完成文档，提供实际 Pages URL、已完成/受阻项、少量真实人工步骤；绝不声称用户凭据/手机测试已完成。

普通错误应自行查找官方文档、重现问题、迭代修正并再次执行对应门禁。不要仅因网络偶发、Actions 配置、Git 权限提示、路径 404 就要求用户逐步配合；只有**确实需要 GitHub 账号授权/确认**时才集中列到最终说明。

## 9. 交付物（必须写入项目）

- `docs/PHASE4_REPORT.md`：实做内容、真实执行命令/测试数字、仓库/分支/提交、发布 URL 与当前线上状态、E2E/视觉结果、未实现/未验证边界、安全审计与凭据风险、是否需要用户动作。
- `docs/PHASE4_DEPLOY_AND_RECOVERY.md`：Pages 配置、Actions 工作流、部署/回滚操作、PWA 更新故障、旧 localhost 到线上迁移、JSON 导出/恢复、不清库原则。
- `docs/PHASE4_USER_FINAL_STEPS.md`：**最简用户操作指南**。如果已上线，用户原则上只需要：旧网站导出备份、在新网站输入自己生成的仅正式仓库 PAT、首次同步确认、手机可选添加到主屏幕、测试 PAT 最后再撤销。若权限导致发布受阻，把权限动作写得明确且尽量合并。
- 完整可运行源代码、构建工作流、PWA 资源、必要测试和截图；`README.md`、`PRODUCT_SPEC.md` 按新行为补充，不删除历史报告和证据。

最终向用户汇报时请只给一个简洁状态摘要：

- **是否真实已上线？** 用实际验证后的 URL 与 Actions 结论回答；
- **数据是否安全？** 是否误动正式数据仓库，旧浏览器数据是否保持；
- **用户还需要做什么？** 最多列出真正无法由 Codex 完成的几项，别让用户重复操作；
- **还缺哪些验证？** 例如真正的生产 PAT 登录和 iPhone 安装；
- **如何回退？** 指向一份能照着操作的文档。

## 10. 正式验收标准与停止线

Phase 4 只有在**生产静态站点部署完成且可访问**时才能标为“已发布”；只有实际使用正式 PAT 且真实用户确认首次绑定后才可称为“正式数据已同步”；仅有 Mock、测试仓库或本地预览时，应相应标为“代码完成 / 待授权发布 / 真实生产数据待用户确认”。

请立刻执行；尽可能完整、自主完成，不需要每个步骤等待用户回复。仅在触及上述安全与权限边界时暂停对应外部动作，而不是暂停整个 Phase 4。
