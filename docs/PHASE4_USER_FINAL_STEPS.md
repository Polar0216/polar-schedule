# Phase 4 最简使用指南

正式入口：[Polar Schedule](https://polar0216.github.io/polar-schedule/)。GitHub Actions 与 Pages 已配置并成功部署，无须再手动设置 GitHub 发布权限。[完整验收记录](PHASE4_REPORT.md)。

1. **先备份旧站。** 原浏览器打开原 `http://127.0.0.1:4173/` → 设置与数据 → 导出完整 JSON，确认下载文件存在。保留旧站及其浏览器数据。
2. **确认资料来源。** 新站初次空白正常：可主动导入刚才的 JSON，查看摘要后确认；若正式私有仓库已有正确资料，可在首次同步预览中选择接收远端。不要用空内容覆盖已有资料。
3. **本人授权正式同步。** GitHub 中生成仅 `Polar0216/polar-schedule-data`、Contents 读写权限的 fine-grained PAT。在新站设置 → GitHub 同步，明确切换“正式”，输入该 PAT，核对本地/远端摘要并确认所需方向。默认会话模式；“记住此设备”会保存可用凭据，同账户 Pages 项目同源，请先读风险说明。
4. **可选安装。** 首次联网等离线就绪。iPhone 用 Safari 分享 → 添加到主屏幕；Android/桌面用浏览器安装入口。更新时先保存，再关闭应用旧窗口后重新打开。

确认正式资料正常并完成备份后，可撤销临时测试 PAT。Codex 没有替你使用正式 PAT、接收或上传正式日程；真实 iPhone 安装/触摸/系统存储回收仍需本人设备验证。

遇到问题先导出备份，不清站点数据。[部署、更新、回退与恢复操作](PHASE4_DEPLOY_AND_RECOVERY.md)。
