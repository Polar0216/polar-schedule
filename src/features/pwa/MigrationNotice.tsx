import { useState } from 'react';
import { useStore } from '../../app/Store';
const preference = `polar-schedule:${import.meta.env.BASE_URL}:migration-guide`;
export function MigrationNotice({ onOpen }: { onOpen: () => void }) {
  const { data } = useStore();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(preference) === 'dismissed'; } catch { return false; } });
  if (hidden || import.meta.env.BASE_URL !== '/polar-schedule/' || data.tasks.length || data.scheduleBlocks.length || data.lists.length > 1) return null;
  return <aside className="migration-notice" aria-label="首次迁移提示"><div><strong>从本机迁移到这里？</strong>
    <p>本站与旧 127.0.0.1:4173 的存储独立，初次空白是正常的。请先在旧站导出完整 JSON，再到这里预览导入；旧站数据继续保留。</p></div>
    <div><button className="text-link" onClick={onOpen}>迁移与导入</button><button className="text-link" onClick={() => { setHidden(true); try { localStorage.setItem(preference, 'dismissed'); } catch { /* This is a non-secret UI preference only. */ } }}>知道了</button></div></aside>;
}
