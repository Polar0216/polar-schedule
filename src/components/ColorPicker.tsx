import { useEffect, useId, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Check, ChevronDown, X } from 'lucide-react';
import './color-picker.css';

export const COLOR_PRESETS = ['#7774d5', '#4b91c3', '#43a58a', '#d9954e', '#d27793', '#8c79b1', '#698491', '#c76b60'];
const validHex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);

export function ColorPicker({ label, value, onChange, disabled = false, presets = COLOR_PRESETS }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean; presets?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  return <div className="color-picker-field">
    <span className="color-picker-label" id={labelId}>{label}</span>
    <button ref={trigger} type="button" className="color-picker-trigger" aria-label={`选择${label}`} aria-describedby={labelId}
      aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => setOpen(true)}>
      <span className="color-picker-swatch" style={{ backgroundColor: value }} aria-hidden="true" /><code>{value.toUpperCase()}</code><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && trigger.current && <ColorPopup label={label} value={value} anchor={trigger.current} presets={presets} onConfirm={onChange}
      onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }} />}
  </div>;
}

function ColorPopup({ label, value, anchor, onConfirm, onClose, presets }: {
  label: string; value: string; anchor: HTMLElement; onConfirm: (value: string) => void; onClose: () => void; presets: readonly string[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);
  const [draft, setDraft] = useState(validHex(value) ? value.toLowerCase() : COLOR_PRESETS[0]);
  const [hex, setHex] = useState(value);
  const titleId = useId(); const inputId = useId(); const helpId = useId();
  const valid = validHex(hex);
  const select = (color: string) => { setDraft(color.toLowerCase()); setHex(color.toLowerCase()); };
  const close = () => { ref.current?.close(); onClose(); };
  const confirm = () => { if (valid) { ref.current?.close(); onConfirm(hex.toLowerCase()); onClose(); } };
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const position = () => {
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth; const height = viewport?.height ?? window.innerHeight;
      const x = viewport?.offsetLeft ?? 0; const y = viewport?.offsetTop ?? 0; const gap = 12;
      dialog.style.width = `${Math.min(320, width - gap * 2)}px`;
      dialog.style.maxHeight = `${Math.max(120, height - gap * 2)}px`;
      const bounds = dialog.getBoundingClientRect(); const target = anchor.getBoundingClientRect();
      const left = Math.max(x + gap, Math.min(target.left, x + width - bounds.width - gap));
      const below = target.bottom + 8;
      const desiredTop = below + bounds.height <= y + height - gap ? below : target.top - bounds.height - 8;
      const top = Math.max(y + gap, Math.min(desiredTop, y + height - bounds.height - gap));
      dialog.style.left = `${left}px`; dialog.style.top = `${top}px`;
    };
    position();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(position) : undefined;
    observer?.observe(dialog);
    window.addEventListener('resize', position); window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer?.disconnect(); window.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('resize', position); window.visualViewport?.removeEventListener('scroll', position);
      dialog.close();
    };
  }, [anchor]);
  const outside = (x: number, y: number) => {
    const bounds = ref.current?.getBoundingClientRect();
    return Boolean(bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom));
  };
  return <dialog ref={ref} className="color-picker-popup" aria-labelledby={titleId}
    onCancel={(e) => { e.preventDefault(); e.stopPropagation(); close(); }}
    onKeyDown={(e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); e.stopPropagation(); confirm(); } }}
    onPointerDown={(e) => { e.stopPropagation(); backdropDown.current = outside(e.clientX, e.clientY); if (backdropDown.current) e.preventDefault(); }}
    onPointerUp={(e) => { e.stopPropagation(); if (backdropDown.current && outside(e.clientX, e.clientY)) close(); backdropDown.current = false; }}>
    <header className="color-picker-header"><h3 id={titleId}>选择{label}</h3><button type="button" className="icon-button" aria-label="关闭颜色选择器" onClick={close}><X size={18} /></button></header>
    <div className="color-picker-body">
      <div className="color-picker-preview"><span className="color-picker-swatch" style={{ backgroundColor: draft }} aria-hidden="true" /><span>当前选择<output>{draft.toUpperCase()}</output></span></div>
      <HexColorPicker color={draft} onChange={select} aria-label={`${label}自定义色板`} />
      <fieldset className="color-picker-presets"><legend>常用颜色</legend><div>{presets.map((color) => <button type="button" key={color} style={{ backgroundColor: color }}
        className="color-picker-preset" aria-label={`颜色 ${color}`} title={color.toUpperCase()} aria-pressed={draft.toLowerCase() === color.toLowerCase()}
        onClick={() => select(color)}>{draft.toLowerCase() === color.toLowerCase() && <Check size={16} aria-hidden="true" />}</button>)}</div></fieldset>
      <div className="color-picker-hex"><label htmlFor={inputId}>HEX 色值</label><input id={inputId} aria-label={`${label} HEX`} value={hex} maxLength={7} spellCheck={false} autoComplete="off"
        aria-invalid={!valid} aria-describedby={helpId} onChange={(e) => { setHex(e.target.value); if (validHex(e.target.value)) setDraft(e.target.value.toLowerCase()); }} />
        <p id={helpId} className={valid ? 'field-help' : 'color-picker-error'} role={valid ? undefined : 'alert'}>{valid ? '使用 #RRGGBB，确认后还需保存当前表单。' : '请输入有效的 #RRGGBB，例如 #7774D5。'}</p></div>
      <footer className="color-picker-actions"><button type="button" className="button secondary" onClick={close}>取消</button><button type="button" className="button primary" disabled={!valid} onClick={confirm}>确认颜色</button></footer>
    </div>
  </dialog>;
}
