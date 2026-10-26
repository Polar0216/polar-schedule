import { checkForUpdate, installApp, usePwa } from './pwaState';

export function PwaSettings() {
  const pwa = usePwa();
  return <section data-settings-section="pwa" tabIndex={-1}><h3>安装、离线与更新</h3>
    <p className="field-help">{pwa.ready ? '离线页面已就绪。首次联网访问并缓存后，可离线重新打开。' : '首次访问需要联网准备离线页面。开发模式不提供缓存。'}数据保存到当前浏览器来源的 IndexedDB。</p>
    <div className="sync-actions">{pwa.canInstall && <button className="button" onClick={() => void installApp()}>安装 Polar Schedule</button>}
      <button className="button" disabled={pwa.checking || import.meta.env.DEV} onClick={() => void checkForUpdate()}>检查应用更新</button></div>
    <p className="field-help">{pwa.installed ? '当前处于独立应用模式，或浏览器已报告安装完成。' : 'iPhone/iPad：用 Safari 打开后，分享 → 添加到主屏幕。Android/桌面：使用浏览器的安装菜单；出现安装按钮时也可直接点击。'}</p>
    {(pwa.updateReady || pwa.message) && <p className="backup-note" role="status">{pwa.updateReady ? '新版已下载。请先保存草稿，再关闭本站所有标签后重新打开；不会强制刷新当前页面。' : pwa.message}</p>}
    <p className="field-help">关闭网页后不承诺后台同步；重新打开、联网后继续。更新不需要清除站点数据，回退前先导出 JSON。</p>
  </section>;
}
