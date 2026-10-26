# Phase 3 同步设计（v0.3.0）

依据：[本阶段完整要求](PHASE3_GITHUB_SYNC_PROMPT_TEST_PAT.md)。从完整 Phase 2.2.1 基线 `253f7dc` 开发；保留日历、普通并列重叠、各执行段完成状态、日期/颜色弹层与本地工作流。

## 模块与持久化

- `src/sync/githubClient.ts`：唯一 API 适配层，固定官方 origin、精确私有测试仓库、main 与受控路径；请求拒绝重定向、不使用 cookie、不缓存。先验证精确 full_name / private / default_branch，文件 404 后重新验证仓库，非空库还验证 main 存在，才将其视作缺少文件。
- `snapshotCodec.ts`：严格版本/关联验证、UTF-8/base64、稳定序列化、1 MiB 上限及设备设置拆分。
- `merge.ts`：稳定 ID、墓碑与共同祖先的纯函数三方比较。重复系列存于 scheduleBlocks，例外与标签独立参与合并；子任务属于整个 Task 记录。
- `syncEngine.ts`：拉取、确认、合并、SHA 写入、提交核实、队列与状态。`syncState.ts`：浏览器 Web Locks，及不支持时的 IndexedDB 事务租约（60 秒、每 15 秒续期）。
- `credentialVault.ts`：独立凭据表/会话内存，使用授权代号隔离重新授权与跨标签清除。`features/sync/`：独立 Provider、顶部轻量状态和唯一设置中的同步分组。

Dexie 结构从 v3 升到 v4（原生 IndexedDB 从 30 升到 40），只新增 `syncStates`、`credentials`、`syncLeases`，没有升级函数改写旧表。旧实体、metadata、备份、撤销及其时间戳保持原样；无需为只增空表再复制一份全库。旧 v1→v2→v3 迁移及冻结验证器保留，普通领域 JSON 仍是 schemaVersion=3。恢复导出显式白名单仍排除三个新表。

同步状态按 `[environment,owner,repo,branch,path]` 唯一绑定。持久保存共同 base、已确认 SHA、成功时间、首次/冲突两端预览、待核实的上传候选及上传前 local，不保存 PAT。Phase 3 仅启用 `Polar0216/polar-schedule-data-test`，正式模式不提供连接或探测通路。应用文件是 `data/polar-schedule.json`；独立真实测试只写初始化标识与 `data/phase3-e2e/run-*.json`。

## 远端格式与共享设置

```json
{
  "format": "polar-schedule-snapshot",
  "formatVersion": 1,
  "data": {
    "schemaVersion": 3,
    "lists": [],
    "tasks": [],
    "scheduleBlocks": [],
    "tags": [],
    "exceptions": [],
    "tombstones": [],
    "settings": {
      "slotMinutes": 30,
      "startHour": 0,
      "endHour": 24,
      "weekStartsOn": 1,
      "defaultDurationMinutes": 60
    },
    "updatedAt": "2026-10-23T01:00:00.000Z"
  }
}
```

以上是字段示意，实际合法数据必须包含既有固定 ID 收集箱，不接受空 lists。实体使用原始 schema，保留 ID/revision、创建/更新时间、UTC instant、IANA、旧 display 字段、子任务、标签引用和独立执行完成状态。远端仅接收此包装协议，普通旧 JSON 继续走现有 v1/v2/v3 导入入口，不能把不明文件自动当作可同步快照。

共享五项日历领域设置；theme、defaultView、timeZone、hiddenListIds、sidebarCollapsed、tasksCollapsed、density、showBackground 保持本机。下载后用当前设备设置合成，过滤已经不存在的隐藏清单引用。根 updatedAt 从实体与墓碑时间确定，设备 UI 保存不会产生远端提交；共享设置本身按值比较。对象键和顶层实体/墓碑顺序稳定，内嵌数组保持领域顺序。完整 UTF-8 文件超过 1 MiB 就拒绝写入，允许导出完整 JSON，不截断也不自动分片。

## 首次确认与合并

没有 base 或远端文件消失时，始终持久化预览并停止自动写入。四种本地/远端空与非空组合都不自动覆盖。预览展示目标、两端实体数和变更条目数。初次可明确采用整份本地或远端；远端采用前要求导出预览两端，接收本地变更时另作原子本地备份。没有共同祖先时不假装能推断谁删除了谁。

有 base 时，每个实体 ID 比较 base/local/remote：

| 变化 | 处理 |
|---|---|
| 仅一端变化 | 接受该端 |
| 两端完整记录一致 | 接受一次 |
| 两端不同 ID 变化/新建 | 自动并集 |
| 同 ID 两端不同变化/新建碰撞 | 暂停并保留两端 |
| 删除与修改、墓碑与重建竞争 | 同样暂停，不用时间或 revision 选胜者 |

记录存在/墓碑/缺失一起构成比较状态；不把墓碑和对应实体分别合并。共享设置作为一条记录比较，避免把 startHour/endHour 拼成非法区间。合并后仍需完整 schema 和跨表验证，包括清单/任务/时间块/标签、唯一系列例外和跨实体 UUID。引用不成立时不能制造关联，提供明确的完整本地/远端选择；用户必须先导出两端，未选择时保持两端不变。用户选项再次提交时复核 local 指纹和 remote SHA，变化则刷新预览，旧选择不生效。

## 写入顺序、队列与异常

1. 所有用户编辑走原 Repository 事务，先提交本地；同步不阻塞编辑。
2. 当前 local 相对持久 base 的实体差异就是持久待同步队列。无独立易失操作列表，重开可重新计算删除与所有新增。设备设置变化不排队。
3. 自动触发防抖 3 秒，焦点/联网触发节流 10 秒；没有持续轮询。手动按钮受限流截止时间约束。401 暂停，必须重新授权。
4. 同浏览器同目标获得 Web Lock/事务租约。读取事务一致的 local 与新 remote，合并并校验。内容等于 remote 时不 PUT。
5. PUT 前持久化候选与起始 local；更新使用远端 SHA，创建不带 SHA。
6. 409/422 或网络结果不明先 GET 回读，最多三次总尝试，重读间退避 250/500 ms。如果 remote 已等于持久候选，按已提交处理，不重复 PUT。限流/5xx停止本批，显示服务器 Retry-After/Reset 或至少 30 秒后重试时间，等待手动或焦点/联网事件，不形成自动请求循环。
7. 仅已确认 PUT 或确认 remote 已等于候选后，事务内再读当前 local。以“上传前 local”为祖先合并期间新增编辑，原子应用有效结果并写 base/SHA/时间。若期间又出现冲突，保留当前本地和远端预览、不推进旧 base。新 local 若仍不同于上传候选，继续保持待同步。
8. 接收变更前存本地 `kind=sync` 备份，事务失败回滚。上传成功但本地确认失败时，保留 inflight，后续先核实远端再恢复。原有撤销不上传且不被迁移重写。

不把失败提示当作保存失败：本地保存和 GitHub 状态分开。401/403/404/409/422/429/5xx/超时/断网提供固定安全错误，不渲染服务端任意正文、请求头或异常堆栈。手动断开更换授权代号、清凭据、禁用同步；已经发出的 HTTP 可能已到服务器，但其结果不能再覆盖断开后的本地。断开不会删除领域数据或 base。

## 凭据与运行安全

可信设备模式按需求 §7A 实现，默认不勾选。用户自行输入并勾选时才存 `credentials` 专用表；不勾选仅留本进程内存，关闭后需要重新授权。PAT 从非受控密码 input ref 直接进入服务层，提交即清空输入，不进入 React 展示状态、URL、错误通知、日志或普通导出。持久凭据与 authorizationId 绑定；别的标签清除/更换授权后，旧会话值不能复活。

可信设备模式保存可用明文凭据，是方便性选择，不宣称加密或能防 XSS。本地扩展、同源恶意脚本和本机控制都可能读取或使用它。口令 PBKDF2/AES-GCM 模式为明确未实现的可选项，后续单独开发。只建议 fine-grained、单仓库 Contents 读写、短有效期，不扩大账户权限。

页面 CSP 限制脚本同源、连接为同源和官方 GitHub API（本机开发另有 localhost WebSocket），禁止 object 与表单外发；没有引入第三方运行脚本。React 按文本显示远端内容。Service Worker 只白名单缓存同源构建资源，GitHub 请求不拦截、不缓存。

外部临时测试 PAT 与上述用户浏览器流程严格分开：`scripts/test-github-live.mjs` 只有在当前源码 Mock 验收门禁匹配时，才在 Node 单次进程读项目外秘密文件，绝不写入 vault 或浏览器。日志仅包含受控路径、方法与状态；不会记录 header、响应正文、原始异常或令牌。测试通过精确目标/私有/main 验证后才初始化空仓库；使用虚构数据与唯一隔离路径，不写应用文件，不访问其他仓库。成功后保留少量明确归属测试文件供审阅，不批量清理或改变可见性。

## 备份与恢复

设置中随时导出普通完整 v3 JSON；首次/冲突预览提供两端普通 JSON 下载。接收远端前的本地快照保存到原 backups，可从既有最近备份下载入口获取，再经原导入预览与替换确认恢复。GitHub 历史作为补充，当前阶段不提供一键 Git 历史回滚。不要清除站点数据或删除凭据表以外的数据来解决授权问题。

## 验证边界

全部回归、Mock、实网结果见 [验收报告](PHASE3_REPORT.md)。真实 API 仅代表指定测试仓库通路与数据完整性，不代表正式仓库、个人日常浏览器或实际手机跨设备验收。

API 依据：[Contents API](https://docs.github.com/en/rest/repos/contents)、[浏览器 CORS](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests)、[限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。
