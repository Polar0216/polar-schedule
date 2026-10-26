import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DateTimePicker, DateTimePopup } from './DateTimePicker';

describe('统一日期时间选择器', () => {
  it('月历切换到下一月并精确选择分钟，确认后才提交墙上时间', () => {
    const change = vi.fn();
    render(<DateTimePicker label="开始时间" value="2026-10-31T23:55" onChange={change} timeZone="Asia/Shanghai" />);
    fireEvent.click(screen.getByLabelText('选择开始时间'));
    const picker = screen.getByRole('dialog', { name: '选择开始时间' });
    fireEvent.click(within(picker).getByLabelText('下个月'));
    const day = picker.querySelector<HTMLButtonElement>('[data-day="2026-11-01"] button');
    expect(day).not.toBeNull(); fireEvent.click(day!);
    fireEvent.change(within(picker).getByLabelText('开始时间小时'), { target: { value: '00' } });
    fireEvent.change(within(picker).getByLabelText('开始时间精确分钟'), { target: { value: '7' } });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(within(picker).getByText('确认开始时间'));
    expect(change).toHaveBeenCalledWith('2026-11-01T00:07');
  });
  it('取消不提交，日期模式不显示时间控件，键盘输入保留', () => {
    const change = vi.fn();
    render(<DateTimePicker label="开始日期" value="2026-12-31" dateOnly onChange={change} />);
    fireEvent.click(screen.getByLabelText('选择开始日期'));
    expect(screen.queryByLabelText('24 小时时间选择')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('取消')); expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2027-01-01' } });
    expect(change).toHaveBeenCalledWith('2027-01-01');
  });
  it('导航复用月历，非法键盘日期不关闭，合法闰日可按Enter确认', () => {
    const confirm = vi.fn();
    render(<DateTimePopup label="跳转日期" value="2026-10-20" dateOnly manualInput onClose={vi.fn()} onConfirm={confirm} confirmLabel="跳转" />);
    fireEvent.change(screen.getByLabelText('跳转日期输入'), { target: { value: '2027-02-29' } });
    fireEvent.click(screen.getByText('跳转'));
    expect(screen.getByRole('alert')).toHaveTextContent('有效日期'); expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('跳转日期输入'), { target: { value: '2028-02-29' } });
    fireEvent.keyDown(screen.getByLabelText('跳转日期输入'), { key: 'Enter' });
    expect(confirm).toHaveBeenCalledWith('2028-02-29');
  });
  it('月跳转的年月键盘输入确认不会自动改为另一天或提交父表单', () => {
    const confirm = vi.fn();
    render(<DateTimePopup label="跳转日期" value="2026-10-20" dateOnly manualInput allowMonth onClose={vi.fn()} onConfirm={confirm} confirmLabel="跳转" />);
    fireEvent.change(screen.getByLabelText('跳转日期输入'), { target: { value: '2027-12' } });
    expect(confirm).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('跳转'));
    expect(confirm).toHaveBeenCalledWith('2027-12-01');
  });
});
