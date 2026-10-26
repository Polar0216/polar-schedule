import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialData } from '../domain/schema';
import { StoreProvider, useStore } from './Store';

const mocked = vi.hoisted(() => ({
  repository: {
    initialize: vi.fn(), snapshot: vi.fn(), latestUndo: vi.fn(),
    db: { dataTables: [{ name: 'lists' }], undo: { name: 'undo' },
      transaction: vi.fn((_mode: string, _tables: unknown[], query: () => Promise<unknown>) => query()) },
  },
}));

vi.mock('../storage/database', () => ({ repository: mocked.repository, readRecoveryData: vi.fn() }));
vi.mock('dexie', () => ({
  // Exercise Store's actual initial query without creating/opening the default
  // user database. Later mutation refreshes are independently fault-injected.
  liveQuery: (query: () => Promise<unknown>) => ({
    subscribe: (observer: { next: (value: unknown) => void; error: (error: unknown) => void }) => {
      let active = true;
      void Promise.resolve().then(query).then((value) => { if (active) observer.next(value); }, (error: unknown) => { if (active) observer.error(error); });
      return { unsubscribe: () => { active = false; } };
    },
  }),
}));

function SaveProbe({ operation }: { operation: () => Promise<string> }) {
  const store = useStore();
  const [result, setResult] = useState('pending');
  return <>
    <button onClick={() => void store.run(operation, '保存成功').then((id) => setResult(id ?? 'undefined'))}>提交</button>
    <span data-testid="result">{result}</span><span data-testid="saving">{String(store.saving)}</span>
    {store.error && <p role="alert">{store.error}</p>}{store.notice && <p role="status">{store.notice}</p>}
  </>;
}

beforeEach(() => {
  mocked.repository.initialize.mockReset().mockResolvedValue(undefined);
  mocked.repository.snapshot.mockReset().mockResolvedValue(initialData());
  mocked.repository.latestUndo.mockReset().mockResolvedValue(null);
  mocked.repository.db.transaction.mockClear();
});

describe('Store提交结果与随后界面刷新明确分开', () => {
  it.each(['snapshot', 'latestUndo'] as const)('写入已提交但%s读取失败，仍返回真实ID，提示已提交且不引导重复提交', async (read) => {
    const operation = vi.fn().mockResolvedValue('committed-block-id');
    render(<StoreProvider><SaveProbe operation={operation} /></StoreProvider>);
    await screen.findByRole('button', { name: '提交' });
    mocked.repository[read].mockRejectedValueOnce(new Error('模拟提交后读取失败'));
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('committed-block-id'));
    expect(screen.getByRole('alert')).toHaveTextContent('操作已提交');
    expect(screen.getByRole('alert')).toHaveTextContent('模拟提交后读取失败');
    expect(screen.getByRole('alert')).toHaveTextContent('避免重复提交');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByTestId('saving')).toHaveTextContent('false');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('真正写入失败返回undefined、显示保存错误并结束saving，且不尝试读取新状态', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('模拟磁盘写入失败'));
    render(<StoreProvider><SaveProbe operation={operation} /></StoreProvider>);
    await screen.findByRole('button', { name: '提交' });
    const reads = mocked.repository.snapshot.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('undefined'));
    expect(screen.getByRole('alert')).toHaveTextContent('模拟磁盘写入失败');
    expect(screen.getByRole('alert')).not.toHaveTextContent('操作已提交');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByTestId('saving')).toHaveTextContent('false');
    expect(mocked.repository.snapshot).toHaveBeenCalledTimes(reads);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
