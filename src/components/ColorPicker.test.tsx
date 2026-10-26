import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from './ColorPicker';

describe('统一颜色选择器', () => {
  it('圆角HEX入口打开自控弹层，选择预设只在确认时提交', () => {
    const changed = vi.fn(); render(<ColorPicker label="标签颜色" value="#7774d5" onChange={changed} />);
    expect(document.querySelector('input[type="color"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '选择标签颜色' }));
    expect(screen.getByRole('dialog', { name: '选择标签颜色' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '颜色 #43a58a' }));
    expect(changed).not.toHaveBeenCalled(); expect(screen.getByLabelText('标签颜色 HEX')).toHaveValue('#43a58a');
    fireEvent.click(screen.getByRole('button', { name: '确认颜色' }));
    expect(changed).toHaveBeenCalledExactlyOnceWith('#43a58a'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('无效HEX提示并禁止确认，修正后接受非预设颜色', () => {
    const changed = vi.fn(); render(<ColorPicker label="日程颜色" value="#4b91c3" onChange={changed} />);
    fireEvent.click(screen.getByRole('button', { name: '选择日程颜色' }));
    fireEvent.change(screen.getByLabelText('日程颜色 HEX'), { target: { value: '#xyz' } });
    expect(screen.getByRole('alert')).toHaveTextContent('#RRGGBB'); expect(screen.getByRole('button', { name: '确认颜色' })).toBeDisabled();
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('日程颜色 HEX'), { target: { value: '#1A2B3C' } });
    fireEvent.click(screen.getByRole('button', { name: '确认颜色' })); expect(changed).toHaveBeenCalledExactlyOnceWith('#1a2b3c');
  });
  it('取消和Esc均丢弃颜色草稿，不提交父表单并恢复入口焦点', () => {
    const changed = vi.fn(); const submit = vi.fn();
    render(<form onSubmit={(e) => { e.preventDefault(); submit(); }}><ColorPicker label="清单颜色" value="#abcdef" onChange={changed} /><button>保存父表单</button></form>);
    const trigger = screen.getByRole('button', { name: '选择清单颜色' }); fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText('清单颜色 HEX'), { target: { value: '#123456' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(changed).not.toHaveBeenCalled(); expect(trigger).toHaveFocus();
    fireEvent.click(trigger); expect(screen.getByLabelText('清单颜色 HEX')).toHaveValue('#abcdef');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(trigger).toHaveFocus(); expect(submit).not.toHaveBeenCalled();
  });
  it('自定义色板键盘改变色相，HEX内Enter仅确认颜色，不提交父表单', () => {
    const changed = vi.fn(); const submit = vi.fn();
    render(<form onSubmit={(e) => { e.preventDefault(); submit(); }}><ColorPicker label="标签颜色" value="#7774d5" onChange={changed} /><button>保存</button></form>);
    fireEvent.click(screen.getByRole('button', { name: '选择标签颜色' }));
    const hue = screen.getByRole('slider', { name: 'Hue' }); fireEvent.keyDown(hue, { key: 'ArrowRight', keyCode: 39 });
    expect(screen.getByLabelText('标签颜色 HEX')).not.toHaveValue('#7774d5'); expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('标签颜色 HEX'), { target: { value: '#654321' } });
    fireEvent.keyDown(screen.getByLabelText('标签颜色 HEX'), { key: 'Enter' });
    expect(changed).toHaveBeenCalledExactlyOnceWith('#654321'); expect(submit).not.toHaveBeenCalled();
  });
});
