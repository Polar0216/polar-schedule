import { useEffect, useId, useRef, useState } from 'react';
import { DayPicker } from '@daypicker/react';
import { zhCN } from '@daypicker/react/locale';
import { CalendarDays, X } from 'lucide-react';
import { isDateOnly, localDate } from '../domain/dates';
import { resolveDateEntry } from '../domain/navigation';
import '@daypicker/react/style.css';
import './date-time-picker.css';

interface Props {
  label: string; value: string; onChange: (value: string) => void;
  dateOnly?: boolean; required?: boolean; timeZone?: string;
}

// Values remain wall-clock strings. Only the owning form converts them to an
// instant, so choosing a date cannot silently normalize a DST gap or change zone.
export function DateTimePicker({ label, value, onChange, dateOnly = false, required = true, timeZone }: Props) {
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="date-time-field">
    <label htmlFor={inputId}>{label}</label>
    <div className="date-time-input">
      <input id={inputId} aria-label={label} value={value} required={required}
        placeholder={dateOnly ? 'YYYY-MM-DD' : 'YYYY-MM-DDTHH:mm'}
        onClick={() => setOpen(true)} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); setOpen(true); } }} />
      <button ref={trigger} type="button" aria-label={`选择${label}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(true)}><CalendarDays size={19} /></button>
    </div>
    {open && <DateTimePopup key={value} label={label} value={value} dateOnly={dateOnly} timeZone={timeZone}
      onClose={() => { setOpen(false); trigger.current?.focus(); }} onConfirm={(next) => { onChange(next); setOpen(false); trigger.current?.focus(); }} />}
  </div>;
}

export function DateTimePopup({ label, value, dateOnly, timeZone, onClose, onConfirm, manualInput = false, allowMonth = false, confirmLabel }: Required<Pick<Props, 'label' | 'value' | 'dateOnly'>> & {
  timeZone?: string; onClose: () => void; onConfirm: (value: string) => void;
  manualInput?: boolean; allowMonth?: boolean; confirmLabel?: string;
}) {
  const initialDate = isDateOnly(value.slice(0, 10)) ? value.slice(0, 10) : localDate();
  const [date, setDate] = useState(new Date(`${initialDate}T12:00:00`));
  const [month, setMonth] = useState(date);
  const [dateText, setDateText] = useState(initialDate);
  const [validation, setValidation] = useState<string | null>(null);
  const [hour, setHour] = useState(/^\d{2}:\d{2}$/.test(value.slice(11)) ? value.slice(11, 13) : '09');
  const [minute, setMinute] = useState(/^\d{2}:\d{2}$/.test(value.slice(11)) ? value.slice(14, 16) : '00');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const selected = `${localDate(date)}${dateOnly ? '' : `T${hour}:${minute.padStart(2, '0')}`}`;
  const validMinute = /^\d{1,2}$/.test(minute) && Number(minute) <= 59;
  const dismiss = () => { ref.current?.close(); onClose(); };
  const confirmSelection = () => {
    try {
      const next = manualInput ? `${resolveDateEntry(dateText, allowMonth)}${dateOnly ? '' : `T${hour}:${minute.padStart(2, '0')}`}` : selected;
      ref.current?.close(); onConfirm(next);
    } catch (error) { setValidation(error instanceof Error ? error.message : '日期无效'); }
  };
  return <dialog ref={ref} className="date-picker-popup" aria-labelledby={titleId}
    onClick={(e) => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) dismiss(); } }}
    onKeyDown={(e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) { e.preventDefault(); if (manualInput && e.target.dataset.dateEntry) confirmSelection(); } }}
    onCancel={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(); }}>
    <header><h3 id={titleId}>选择{label}</h3><button type="button" className="icon-button" aria-label="关闭日期选择器" onClick={dismiss}><X size={18} /></button></header>
    <div className="date-picker-content">
      {manualInput && <label className="date-picker-entry">{allowMonth ? '日期或月份' : '日期'}<input aria-label={`${label}输入`} data-date-entry="true" value={dateText}
        placeholder={allowMonth ? 'YYYY-MM-DD / YYYY-MM' : 'YYYY-MM-DD'} onChange={(e) => {
          setDateText(e.target.value); setValidation(null);
          try { const next = new Date(`${resolveDateEntry(e.target.value, allowMonth)}T12:00:00`); setDate(next); setMonth(next); } catch { /* Keep incomplete typing; validate explicitly on confirmation. */ }
        }} /></label>}
      <DayPicker mode="single" required selected={date} onSelect={(next) => { setDate(next); setDateText(localDate(next)); setValidation(null); }} month={month} onMonthChange={setMonth}
        locale={zhCN} captionLayout="dropdown" navLayout="after" showOutsideDays autoFocus
        startMonth={new Date(Math.min(1900, date.getFullYear() - 100), 0)}
        endMonth={new Date(Math.max(2100, date.getFullYear() + 100), 11)}
        labels={{ labelNext: () => '下个月', labelPrevious: () => '上个月', labelMonthDropdown: () => '选择月份', labelYearDropdown: () => '选择年份' }} />
      {!dateOnly && <section className="time-picker" aria-label="24 小时时间选择">
        <label>小时<select aria-label={`${label}小时`} value={hour} onChange={(e) => setHour(e.target.value)}>
          {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((h) => <option key={h}>{h}</option>)}</select></label>
        <span aria-hidden="true">:</span>
        <label>分钟<select aria-label={`${label}分钟`} value={minute.padStart(2, '0')} onChange={(e) => setMinute(e.target.value)}>
          {[...new Set([...Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0')), minute.padStart(2, '0')])].sort().map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>精确分钟<input aria-label={`${label}精确分钟`} type="number" min={0} max={59} step={1} value={minute}
          onChange={(e) => setMinute(e.target.value)} /></label>
      </section>}
      <p className="field-help">{manualInput ? '只定位日历，不修改安排' : dateOnly ? '按日期保存' : `${timeZone ?? '浏览器时区'} · 24 小时制`} · <output>{selected.replace('T', ' ')}</output></p>
      {validation && <p className="validation-error" role="alert">{validation}</p>}
      <footer><button type="button" className="button secondary" onClick={() => { const today = new Date(); setDate(today); setMonth(today); setDateText(localDate(today)); setValidation(null); }}>今天</button>
        <button type="button" className="button secondary" onClick={dismiss}>取消</button>
        <button type="button" className="button primary" disabled={!validMinute && !dateOnly} onClick={confirmSelection}>{confirmLabel ?? `确认${label}`}</button></footer>
    </div>
  </dialog>;
}
