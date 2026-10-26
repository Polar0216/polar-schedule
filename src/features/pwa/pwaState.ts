import { useSyncExternalStore } from 'react';

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
interface PwaView { ready: boolean; updateReady: boolean; canInstall: boolean; installed: boolean; checking: boolean; message: string }
let state: PwaView = { ready: false, updateReady: false, canInstall: false, installed: false, checking: false, message: '' };
let registration: ServiceWorkerRegistration | undefined;
let installPrompt: InstallPrompt | undefined;
const listeners = new Set<() => void>();
function update(patch: Partial<PwaView>) { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function usePwa() { return useSyncExternalStore(subscribe, () => state); }
export async function checkForUpdate() {
  update({ checking: true, message: '' });
  try { await registration?.update(); update({ message: registration?.waiting ? '新版已下载，请先保存草稿，再关闭本站所有标签后重开。' : '更新检查已完成；若有新版下载，会在准备好后提示。' }); }
  catch { update({ message: '暂时无法检查更新，请联网后重试。本地日程保留。' }); }
  finally { update({ checking: false }); }
}
export async function installApp() {
  const prompt = installPrompt; if (!prompt) return;
  installPrompt = undefined; update({ canInstall: false });
  try { await prompt.prompt(); const choice = await prompt.userChoice; update({ message: choice.outcome === 'accepted' ? '浏览器已接受安装请求，请按系统界面完成。' : '已取消安装，仍可直接使用网页。' }); }
  catch { update({ message: '请通过浏览器菜单安装，或继续使用网页。' }); }
}
export function startPwa() {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event as InstallPrompt; update({ canInstall: true }); });
  window.addEventListener('appinstalled', () => { installPrompt = undefined; update({ installed: true, canInstall: false, message: '浏览器报告安装完成。' }); });
  update({ installed: window.matchMedia('(display-mode: standalone)').matches });
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = async () => {
    try {
      registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: 'none' });
      const ready = () => update({ ready: Boolean(navigator.serviceWorker.controller) });
      navigator.serviceWorker.addEventListener('controllerchange', ready); ready();
      const watch = () => {
        if (registration?.waiting && navigator.serviceWorker.controller) update({ updateReady: true });
        registration?.installing?.addEventListener('statechange', (event) => {
          const worker = event.target as ServiceWorker;
          if (worker.state === 'installed' && navigator.serviceWorker.controller) update({ updateReady: true });
          if (worker.state === 'redundant' && !navigator.serviceWorker.controller) window.dispatchEvent(new Event('offline-cache-failed'));
        });
      };
      registration.addEventListener('updatefound', watch); watch();
    } catch { update({ message: '离线页面准备失败，请联网重试；本地编辑仍可保存。' }); window.dispatchEvent(new Event('offline-cache-failed')); }
  };
  if (document.readyState === 'complete') void register(); else window.addEventListener('load', () => { void register(); }, { once: true });
}
