# Phase 4 验收报告

日期：2026-10-26（Asia/Shanghai）；版本：v0.4.0。

## 当前结论

**Phase 4 正式静态版本已真实发布并通过验收。** 入口：[Polar Schedule](https://polar0216.github.io/polar-schedule/)。[实际 Actions](https://github.com/Polar0216/polar-schedule/actions/runs/40279584186) 的 validate / deploy 均 success；HTTPS 首页与资源成功，真实浏览器三尺寸/浅深主题、PWA 条件与离线重开编辑通过。

**正式个人数据尚未同步，真实 iPhone 尚未验收。** Codex 没有读取正式仓库内容或替用户确认首次个人数据绑定。

## 范围与主要实现

- 从 Phase 3 完整分支 `feature/phase3-github-sync` 的 `0919894` 继续；开发分支 `feature/phase4-release-pages-pwa`。初始无 remote；公开目标确认为空的 Public `Polar0216/polar-schedule`，默认 main，现有 Git Credential Manager 有管理员/推送权限。未使用测试 PAT。
- 正式/测试固定 allowlist、身份/分支/路径校验、绑定停止与隔离、换 PAT 重新首次预览：`src/sync/{types,githubClient,syncEngine}.ts`、`src/features/sync/`。保留三方合并、冲突、删除墓碑与未知 PUT 回读机制。
- `public/manifest.webmanifest`、192/512/maskable/Apple 图标；`scripts/build-sw.mjs` 内容版本、作用域隔离、静态白名单与 Authorization 绕过；`src/features/pwa/` 安装、更新及 origin 迁移引导。
- `build:pages` 与原根路径构建并存，`.github/workflows/pages.yml` 全部质量检查后只上传静态 `dist-pages/`，PR 不部署。
- `e2e/{production,pages}-phase4.spec.ts`、`src/sync/production.test.ts` 新增绑定、错 PAT、首次四种空/非空组合、双设备、迁移、PWA 更新/离线与响应式测试；原用例未删除。
- 公开筛查脚本与 `.qa` 隔离发布副本保留本机历史；用户反馈原图不进入公开 Git 历史。

## 基线修复

首次 audit 发现 Zod 的高危资源耗尽公告 [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。升级至 4.6.7，适配快照结构 `.shape`；冻结 v1/v2 与现有 schema 规则不改。独立提交 `30a05bb`。

旧浏览器重启测试使用当日视图，而夹具固定 10 月 19 日，运行到 26 日会误判；补上重启后的固定浏览器时钟，保留数据持久化断言。完整基线 169 单元与 71 浏览器用例保留。本阶段 Dexie 仍 v4、JSON 仍 v3。

## 测试、截图与部署记录

最终本机完整门禁（2026-10-26 14:18–14:22，Asia/Shanghai，`CI=true` 严格模式）：

| 命令 | 结果 |
| --- | --- |
| `npm ci` | 通过，先处理测试进程占用 esbuild 的一次 EPERM 后成功重装 |
| `npm run typecheck` | 通过 |
| `npm run test` | 20 文件、178/178 通过（保留原 169，新增 9） |
| `npm run build` | 通过，根路径 dist |
| `npm run build:pages` | 通过，子路径 dist-pages |
| `npm run check:public` | 两种构建、manifest/图标、静态范围、秘密模式扫描通过 |
| `npm run test:e2e` | 79/79 通过（保留原 71，新增 8） |
| `npm run test:e2e:pages` | 7/7 通过 |
| `npm audit` / `npm audit --omit=dev` | 均 0 vulnerabilities |

串行门禁 `npm run verify:mocks` 全部 exitCode=0，源指纹 `61af522f173d79cf63485d69e7310a5baceb66ec55a38e6e55bcf4c0e27ab9a1`；记录 `evidence/phase4/mock-results.json`。Chromium CDP 安装条件 `installabilityErrors=[]`；证据 `pwa-local-installability.json`。这是浏览器安装条件验证，不是用户已安装。

截图在 `evidence/phase4/`：1440/768/390 浅深色正式预览、Pages 首次迁移页、各尺寸安装说明；均为隔离虚构数据。已查看桌面、平板、手机截图的边界与圆角。历史回归截图另存 `evidence/phase4/regression/`，不覆盖 Phase 1–3 证据。

### 首次云端发现并修复的问题

[首次 Actions 运行](https://github.com/Polar0216/polar-schedule/actions/runs/40277518804) 的 178 单元、79 根路径浏览器用例、两项审计与两种构建均通过，但 Pages 套件启动时报 4173 占用，部署被正确跳过。实际根因是 `defineConfig(base, overrides)` 会拼接 `webServer`，使子路径套件有两个根路径服务器；本机允许复用时掩盖了重复，CI 严格模式会拒绝。

修复为 `defineConfig({ ...base, ... })`，确保恰好一个根预览与一个子路径预览；预览直接启动 Node/Vite 并声明优雅关闭。独立 4284 端口严格 CI 模式连续两次启动/关闭与安装条件测试通过。最终完整门禁 `CI=true` 复验（禁止复用服务器）178/79/7 全部通过。原用例和断言全部保留，安装截图另加强整个说明区域进入视口的检查。

## 真实部署、Git 与线上验收

| 项目 | 已执行结果 |
| --- | --- |
| 唯一公开仓库 | [Polar0216/polar-schedule](https://github.com/Polar0216/polar-schedule)，Public，默认 main |
| Pages 配置 | 现有 Git Credential Manager 授权；创建 Pages 返回 201，GET 返回 200；build_type=workflow |
| 本机开发分支 | `feature/phase4-release-pages-pwa`，保留 Phase 3 完整历史 |
| 本机实现提交 | `588af1e`（Phase 4），`739454b`（严格 CI 修复）；安全依赖修复 `30a05bb` |
| 公开实际部署代码 | `655d54d07e048bec337a63d22e425453515387bd`，标签 `v0.4.0` |
| 真实云端结果 | 20 文件 / 178 单元、79 根路径浏览器、7 子路径浏览器全部通过；两项 audit 均 0；配置、artifact、deploy 均 success |
| 实际 URL / HTTP | `https://polar0216.github.io/polar-schedule/`，HTML 200，JS/CSS/SVG/图标/manifest/SW 成功加载，无 404 |
| 线上构建版本 | `0.4.0-76b06b22fb9549cf`，base `/polar-schedule/` |
| 真实浏览器检查 | 1440 / 768 / 390px，浅深主题、日周月切换、日期预览→日视图、安装说明均通过；页面不横向溢出，Console/pageerror 均 0 |
| 真实离线检查 | 首次联网缓存后断网刷新、关页重开、新建保存，再联网刷新，虚构任务仍在 |
| 安装条件 / SW | 三尺寸 Chromium CDP installabilityErrors 均为空；scope/脚本限定本站子路径，HTTPS 安全上下文 |
| 数据访问 | 线上 smoke 使用隔离上下文，拦截所有 GitHub 数据 API，实际请求数 0；未输入真实 PAT |

线上检查时间：2026-10-26 14:30 起（Asia/Shanghai）；Node HTTP 再次校验和实际日志提取结果见 `evidence/phase4/deployment.json`，完整浏览器结果见 `online-results.json`。9 张 `online-*.png` 均已逐张查看，桌面/平板/手机主题与圆角边界正常。安装条件通过仅代表该 Chromium 支持范围，不等于 iOS 系统安装完成。

首发 550 个公开文件先经过秘密模式与原始反馈筛查；大包网络重置后改为 codex 暂存分支小批量正常推送，最终 Git 树与审核快照完全一致才创建 main，并将 GitHub 自动选择的暂存默认分支设回 main。暂存脚本一次空索引读取错误被完整性校验阻止创建 main，修正后继续追加，未覆盖历史。公开与本机历史有意分开；没有把含原始个人反馈的本机历史推送。后续文档/合成截图追加提交不改变上述已部署代码，且不会重复触发部署。

## 数据保护与公开范围

没有访问正式私有仓库内容，没有向其上传或初始化，没有读取本阶段测试 PAT，没有触碰日常浏览器 IndexedDB。所有浏览器验收使用隔离上下文/测试目录，跨 origin 迁移使用虚构 JSON。普通 JSON 和远端快照不含凭据。

原本机历史含 17 个用户反馈文本/原图文件，可能展示私人安排。为避免将历史个人材料公开，保留本机完整历史与原文件，向已核实的空 Public 仓库发布经过筛查的完整工程初始快照；不强推、不覆盖现有远端历史。合成夹具/报告/历史测试证据保留；公开文档中指向本机原反馈的链接可能不可用。

额外在进程内存比较现有发布凭据与首发 550 个源码文件及 14 个静态构建文件，均未发现凭据；只输出脱敏检查结论 `evidence/phase4/public-safety.json`。发布凭据不写入源文件、报告、截图、Git 提交或 CI。构建保留严格 CSP，无 unsafe-eval，无外部 JS CDN。测试 PAT 没有用于前端仓库或正式库。

## 未实现、未验证与风险

- 真实生产 PAT 登录、首次个人数据确认与真实生产同步：**未执行，留给用户在应用内操作**。
- 真实 iPhone/iPad Safari 安装、触摸长按与长期系统存储回收：**未验证**。Chromium 自动化与安装条件检查不等于实机验收。
- 可选 PBKDF2/AES-GCM 口令加密凭据：**延期**。记住设备会保存可用 PAT，已明确同 origin Pages 项目可读同源存储及扩展/XSS 风险；默认关闭。
- 页面关闭后持续后台同步不作保证；依赖重新打开/联网。首次离线启动需要先联网缓存。
- Zod 上游存在两条 Rollup 注释位置提示，构建可正常完成；不影响审计结果。

## 用户操作、回退与下一阶段

无剩余 GitHub 发布授权或 Pages 配置步骤。仅用户本人需要先导出旧站 JSON、选择资料来源、输入正式单仓库 PAT 并确认首次同步，手机可选安装；正式资料与备份核对后再撤销临时测试 PAT。[最简指南](PHASE4_USER_FINAL_STEPS.md)、[迁移/回退/恢复](PHASE4_DEPLOY_AND_RECOVERY.md)。下一阶段建议先完成正式来源核对、两台真实设备及 iOS 验收，再评估可选加密凭据和性能优化；不扩大当前授权范围。
