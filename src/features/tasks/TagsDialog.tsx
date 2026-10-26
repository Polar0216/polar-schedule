import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../../app/Store';
import { ConfirmDialog, Dialog, IconButton } from '../../components/Controls';
import { ColorPicker } from '../../components/ColorPicker';
import type { Tag } from '../../domain/schema';

export function TagsDialog({ onClose }: { onClose: () => void }) {
  const { data, repo, run, saving } = useStore();
  const [editingId, setEditingId] = useState<string>();
  const [title, setTitle] = useState('');
  const [color, setColor] = useState('#7774d5');
  const [deleting, setDeleting] = useState<Tag>();
  const reset = () => { setEditingId(undefined); setTitle(''); setColor('#7774d5'); };
  return <>
    <Dialog title="标签管理" onClose={onClose}>
      <div className="dialog-body tag-manager">
        <p className="field-help">标签可跨清单使用，一个任务可以拥有多个标签。</p>
        <form className="form-stack" onSubmit={(e) => {
          e.preventDefault();
          void run(() => repo.saveTag({ title, color }, editingId), editingId ? '标签已更新' : '标签已创建').then((id) => { if (id) reset(); });
        }}>
          <label>标签名称<input aria-label="标签名称" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：考试、健身" /></label>
          <ColorPicker label="标签颜色" value={color} onChange={setColor} disabled={saving} />
          <div className="form-actions">{editingId && <button type="button" className="button secondary" onClick={reset}>取消编辑</button>}
            <button className="button primary" disabled={saving || !title.trim()}><Plus size={15} />{editingId ? '保存标签' : '创建标签'}</button></div>
        </form>
        <ul className="tag-manager-list" aria-label="已有标签">
          {[...data.tags].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map((tag) => <li key={tag.id}>
            <span className="tag-chip"><span className="list-dot" style={{ background: tag.color }} />{tag.title}</span>
            <span className="tag-actions"><IconButton label={`编辑标签 ${tag.title}`} onClick={() => { setEditingId(tag.id); setTitle(tag.title); setColor(tag.color); }}><Pencil size={15} /></IconButton>
              <IconButton label={`删除标签 ${tag.title}`} onClick={() => setDeleting(tag)}><Trash2 size={15} /></IconButton></span>
          </li>)}
        </ul>
        {data.tags.length === 0 && <p className="field-help">还没有标签，可在上方创建。</p>}
      </div>
    </Dialog>
    {deleting && <ConfirmDialog title="删除这个标签？" busy={saving} onClose={() => setDeleting(undefined)} onConfirm={() => {
      void run(async () => { await repo.deleteTag(deleting.id); return true; }, '标签已删除，任务已保留').then((ok) => {
        if (ok) { if (editingId === deleting.id) reset(); setDeleting(undefined); }
      });
    }}><p>删除「{deleting.title}」会解除所有任务上的此标签，任务与时间安排会保留。</p></ConfirmDialog>}
  </>;
}
