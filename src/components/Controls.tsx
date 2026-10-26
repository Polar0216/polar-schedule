import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../app/Store';

export function IconButton({ label, onClick, children, className = '', disabled = false }: {
  label: string; onClick: () => void; children: ReactNode; className?: string; disabled?: boolean;
}) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label}
    onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Dialog({ title, children, onClose, wide = false }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { error, clearError } = useStore();
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el?.showModal();
    return () => { el?.close(); if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`dialog ${wide ? 'dialog-wide' : ''}`}
    onCancel={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}>
    <header className="dialog-header"><h2 id={titleId}>{title}</h2><IconButton label="关闭" onClick={onClose}><X size={19} /></IconButton></header>
    {error && <div className="dialog-error" role="alert">{error}<button type="button" onClick={clearError} aria-label="关闭错误提示">×</button></div>}
    <div className="dialog-content">{children}</div>
  </dialog>;
}

export function ConfirmDialog({ title, children, confirmLabel = '确认删除', onConfirm, onClose, busy = false }: {
  title: string; children: ReactNode; confirmLabel?: string; onConfirm: () => void; onClose: () => void; busy?: boolean;
}) {
  return <Dialog title={title} onClose={onClose}><div className="dialog-body"><div className="confirm-copy">{children}</div>
    <div className="form-actions"><button className="button secondary" onClick={onClose}>取消</button>
      <button className="button danger" onClick={onConfirm} disabled={busy}>{confirmLabel}</button></div></div></Dialog>;
}
