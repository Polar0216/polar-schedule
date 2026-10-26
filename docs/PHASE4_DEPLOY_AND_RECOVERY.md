# Phase 4 部署、迁移与恢复

版本 v0.4.0；本说明日期 2026-10-26。实际上线证据与提交见 [验收报告](PHASE4_REPORT.md)。

已发布站点：[https://polar0216.github.io/polar-schedule/](https://polar0216.github.io/polar-schedule/)。已验证代码为公开仓库 `655d54d07e048bec337a63d22e425453515387bd`，标签 `v0.4.0`；[成功 Actions](https://github.com/Polar0216/polar-schedule/actions/runs/40279584186)。后续仅文档/截图提交不改变已部署应用。

## 部署配置

- 唯一公开前端仓库：`Polar0216/polar-schedule`，默认分支 main。
- Pages 使用 GitHub Actions source，工作流 `.github/workflows/pages.yml`。
- Node 24 + `npm ci`，类型、单元、完整浏览器测试、两项 audit、根路径和子路径构建全部通过后上传 `dist-pages/`，部署到 github-pages 环境。
- `npm run build` 保留原 `http://127.0.0.1:4173/` 使用方式；`npm run build:pages` 生成 `/polar-schedule/` 资源、manifest 与 SW。不能将根路径 dist 当作项目子路径产物上传。
- PR 只验证；main 代码更新与 workflow_dispatch 运行验证和部署。仅 docs/README 的提交不重复部署；必要时在 Actions 手动运行。
- 前端只含公开应用静态文件，不从 CI 注入 PAT，不发布 IDB、导出 JSON、秘密文件或私人反馈原图。

本地验收：

```powershell
npm ci
npx playwright install chromium
npm run verify:mocks
```

本机完整开发历史含原始用户反馈，**不要把本机所有历史直接推送为公开仓库**。首次空仓库发布使用 `scripts/prepare-public-release.mjs`，要求当前质量门禁匹配并筛除原反馈材料，再在隔离目录建立公开历史；本机历史和原图保留。此次首次大包经网络重置，改为 codex 暂存分支的小批量正常推送，最终核对完整树与审核快照一致后才创建 main；这是同一公开快照的传输拆分。后续公开改动基于已存在的公开 main 正常提交，不强推。脚本不会自动推送。

## 首次迁移

1. 用原来的浏览器打开原来的 4173 地址，设置与数据 → 数据备份与恢复 → 导出完整 JSON；确认文件已经下载，并另存一份。
2. 新站点是不同 origin，首次看到空库正常。不要清除旧站数据。使用新站的 JSON 导入入口，查看摘要，继续时先自动保留本地快照，再明确确认替换。
3. 如果正式远端已有正确内容，可直接在新站连接正式模式，检查本地/远端摘要，明确选择接收远端。不要用空本地覆盖非空远端。
4. 如果资料只在测试仓库，先自行导出核验，再在正式模式建立新绑定；应用不会自动复制测试数据到正式库。
5. 核对清单、任务、执行段、系列和例外。旧 v1/v2 JSON 继续支持；当前导出为 v3，DB 仍为 v4。

不要同时导入两份来源不明的数据并直接确认同步；先下载两端预览 JSON，确定哪份是所需版本。完整替换导入不是合并导入。

## 正式私有同步

在正式数据仓库 `Polar0216/polar-schedule-data` 生成仅该仓库的 fine-grained PAT，Contents: Read and write；用户本人在应用输入。无需给前端公开仓库或其他数据仓库权限。

设置 → GitHub 同步 → 选择正式 → 阅读新绑定提示 → 输入 PAT → 检查预览。初次明确确认前不上传或替换。错误 owner、Public、分支非 main、错仓库 PAT 会停止；不自动修改仓库设置。

会话模式默认不持久保存 PAT。记住设备会保存可用凭据，尚无口令加密：同账户其他 GitHub Pages 项目同源，可以访问同源存储；恶意脚本、扩展或受控设备也是风险。路径不构成存储安全隔离。只在可信设备选择，随时断开/清除并在 GitHub 撤销 PAT。普通备份不含凭据。

切换测试/正式或换 PAT 时会停止当前会话，保留本地领域数据/备份，建立新的首次预览，不继承旧 base/SHA。断开不会清日程。

## PWA 与离线更新

- 首次联网打开并等“离线页面已就绪”，才具备离线启动条件。
- iPhone/iPad：Safari 分享 → 添加到主屏幕。Android/桌面使用浏览器安装入口；只在原生 API 可用时出现应用内安装按钮。系统提示和 iOS 实机须用户最终验证。
- SW 仅控制 `/polar-schedule/`；缓存只含应用静态资源，不缓存带 Authorization 的请求或 GitHub 私有响应。缓存名包含作用域与内容指纹，不清理其他项目缓存。
- 新版准备好后提示更新，不强制刷新。先保存表单并确认本机保存完成，再关闭该应用所有旧标签/窗口，联网重新打开；旧客户端全部结束后新版激活并清理本站旧缓存。
- 离线可编辑本地内容。关闭网页后不保证持续同步，重新打开/恢复联网后才继续。

更新异常先联网保存并导出 JSON，关闭所有该站旧窗口，重新打开检查。若仍有旧缓存，可通过浏览器开发者工具仅注销**本站路径的 SW**并仅清理其静态 Cache Storage 后重载；**不要执行 Clear site data、删除 IndexedDB、清浏览器全部数据**。同源其他项目不应受影响。

## 回退与恢复

1. 优先导出当前完整 JSON 与必要的冲突两端快照，保留旧 localhost 原浏览器。
2. 后续代码回退在公开仓库基于当前 main 执行针对问题功能提交的 `git revert <commit>`，正常推送触发同样质量门禁与 Pages 部署。不 reset hard，不 force push。首发前没有已部署的旧 Pages 版本；不要任意撤销首次上传中的证据/初始化提交。跨多个变更先检查差异和数据库兼容。
3. 确认 Actions deploy 成功后，保存草稿并关闭所有旧应用窗口，重新打开确认版本/缓存更新。报告中的部署 commit 可作为已验收参考。
4. 数据恢复通过应用导入入口查看摘要并确认；最近一次导入前/同步前快照可下载。不能把静态版本回退当作个人数据恢复。
5. Dexie v4/JSON v3 在本阶段未升级；若未来回退版本不支持已有数据库，应使用支持当前模型的构建和 JSON 恢复，不通过清库降级。

Pages 暂时不可用时，可在本机当前完整源码运行 `npm run build`，然后 `npm run preview -- --port 4173 --strictPort`，继续使用原浏览器的 4173 数据。若原数据有缺失，从已下载 JSON 经过预览确认恢复；不把新站空库导入旧站覆盖资料。

参考：[GitHub 自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Vite 静态部署](https://vite.dev/guide/static-deploy)、[MDN PWA 安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)。
