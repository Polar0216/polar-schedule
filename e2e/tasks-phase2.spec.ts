import { expect, test, type Page } from '@playwright/test';
import type { List, ScheduleBlock, Tag, Task } from '../src/domain/schema';

type Stored = { lists: List[]; tasks: Task[]; scheduleBlocks: ScheduleBlock[]; tags: Tag[] };
async function stored(page: Page): Promise<Stored> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('polar-schedule'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const tx = db.transaction(['lists', 'tasks', 'scheduleBlocks', 'tags'], 'readonly');
      const read = (name: string) => new Promise<unknown[]>((resolve, reject) => {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result as unknown[]); request.onerror = () => reject(request.error);
      });
      const [lists, tasks, scheduleBlocks, tags] = await Promise.all(['lists', 'tasks', 'scheduleBlocks', 'tags'].map(read));
      return { lists, tasks, scheduleBlocks, tags } as Stored;
    } finally { db.close(); }
  });
}
async function createTag(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: '标签管理', exact: true });
  await dialog.getByLabel('标签名称').fill(title); await dialog.getByRole('button', { name: '创建标签', exact: true }).click();
  await expect(dialog.getByRole('button', { name: `编辑标签 ${title}`, exact: true })).toBeVisible();
}
async function beginTask(page: Page, title: string, description: string, dueDate: string, listTitle?: string) {
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByText('描述与任务属性', { exact: true }).click();
  await page.getByLabel('任务标题', { exact: true }).fill(title); await page.getByLabel('任务描述', { exact: true }).fill(description);
  await page.getByLabel('截止日期', { exact: true }).fill(dueDate);
  if (listTitle) await page.getByLabel('所属清单', { exact: true }).selectOption({ label: listTitle });
  await page.locator('.task-detail-group').filter({ has: page.locator('summary', { hasText: /^标签/ }) }).locator('summary').click();
}
async function addSubtask(page: Page, title: string) {
  const details = page.locator('.task-detail-group').filter({ has: page.locator('summary', { hasText: /^子任务/ }) });
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await page.getByLabel('新子任务', { exact: true }).fill(title); await page.getByRole('button', { name: '添加子任务', exact: true }).click();
}
async function saveAndReturn(page: Page, expectedTasks: number) {
  await page.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks.length).toBe(expectedTasks);
  await page.getByRole('button', { name: '返回待办', exact: true }).click();
}
test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(new Date('2026-10-19T09:00:00+08:00')); await page.goto('/'); });

test('P2 子任务、标签编辑及跨清单搜索组合筛选在刷新后保留', async ({ page }) => {
  await page.getByRole('button', { name: '标签管理', exact: true }).click(); await createTag(page, '复习'); await createTag(page, '紧急');
  await page.getByRole('dialog', { name: '标签管理', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await beginTask(page, '完成报告', '光学实验复习资料', '2026-10-23');
  await page.getByLabel('任务标签 复习', { exact: true }).check(); await page.getByLabel('任务标签 紧急', { exact: true }).check();
  await addSubtask(page, '整理数据'); await addSubtask(page, '写结论');
  await page.getByLabel('完成子任务 整理数据', { exact: true }).check(); await page.getByRole('button', { name: '子任务上移 写结论', exact: true }).click();
  await page.getByLabel('子任务标题 2', { exact: true }).fill('检查数据'); await saveAndReturn(page, 1);
  let data = await stored(page);
  expect(data.tasks[0].subtasks.map((s) => [s.title, s.done, s.order])).toEqual([['写结论', false, 0], ['检查数据', true, 1]]);
  expect(data.tasks[0].status).toBe('todo'); expect(data.tasks[0].tagIds).toHaveLength(2); expect(data.scheduleBlocks).toHaveLength(0);

  await page.getByRole('button', { name: '新建清单', exact: true }).first().click();
  const listDialog = page.getByRole('dialog', { name: '新建清单', exact: true });
  await listDialog.getByLabel('清单名称').fill('旧课程'); await listDialog.getByRole('button', { name: '保存清单', exact: true }).click(); await expect(listDialog).not.toBeVisible();
  await beginTask(page, '归档课程资料', '光学实验复习资料', '2026-10-25', '旧课程');
  await page.getByLabel('任务标签 复习', { exact: true }).check(); await saveAndReturn(page, 2);
  await page.getByRole('button', { name: '管理清单 旧课程', exact: true }).click();
  const manageList = page.getByRole('dialog', { name: '管理清单', exact: true });
  await manageList.getByRole('button', { name: '归档清单', exact: true }).click(); await expect(manageList).not.toBeVisible();
  await page.getByLabel('搜索任务', { exact: true }).fill('复习'); await expect(page.getByTestId('task-card')).toHaveCount(1);
  await expect(page.locator('.search-summary')).toContainText('不含归档清单'); await page.getByRole('button', { name: '搜索筛选', exact: true }).click();
  await page.getByLabel('包含归档清单', { exact: true }).check(); await expect(page.getByTestId('task-card')).toHaveCount(2);
  await page.getByLabel('搜索任务状态', { exact: true }).selectOption('in_progress'); await expect(page.getByTestId('task-card')).toHaveCount(0);
  await page.getByLabel('搜索任务状态', { exact: true }).selectOption('todo'); await expect(page.getByTestId('task-card')).toHaveCount(2);
  data = await stored(page); const reviewTag = data.tags.find((tag) => tag.title === '复习')!;
  await page.getByLabel('筛选标签', { exact: true }).selectOption(reviewTag.id); await page.getByLabel('截止日期至', { exact: true }).fill('2026-10-23');
  await expect(page.getByTestId('task-card')).toHaveCount(1);
  const inbox = data.lists.find((list) => list.title === '收集箱')!;
  await page.getByLabel('搜索清单', { exact: true }).selectOption(inbox.id); await expect(page.getByTestId('task-card')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/phase2-tasks-search.png', fullPage: true });

  await page.getByRole('button', { name: '标签管理', exact: true }).click();
  const tags = page.getByRole('dialog', { name: '标签管理', exact: true });
  await tags.getByRole('button', { name: '编辑标签 复习', exact: true }).click(); await tags.getByLabel('标签名称').fill('期末复习');
  await tags.getByRole('button', { name: '选择标签颜色', exact: true }).click();
  const colorPicker = page.getByRole('dialog', { name: '选择标签颜色', exact: true });
  await colorPicker.getByLabel('标签颜色 HEX', { exact: true }).fill('#123456'); await colorPicker.getByRole('button', { name: '确认颜色', exact: true }).click();
  await tags.getByRole('button', { name: '保存标签', exact: true }).click(); await expect(tags.getByRole('button', { name: '编辑标签 期末复习', exact: true })).toBeVisible();
  await tags.getByRole('button', { name: '删除标签 紧急', exact: true }).click();
  await page.getByRole('dialog', { name: '删除这个标签？', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(tags.getByRole('button', { name: '删除标签 紧急', exact: true })).toHaveCount(0);
  await tags.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload(); data = await stored(page);
  expect(data.tags).toHaveLength(1); expect(data.tags[0]).toMatchObject({ id: reviewTag.id, title: '期末复习', color: '#123456' });
  expect(data.tasks.every((task) => task.tagIds.length === 1 && task.tagIds[0] === reviewTag.id)).toBe(true);
  expect(data.tasks.find((task) => task.title === '完成报告')!.subtasks).toHaveLength(2);
});

test('P2 误删任务后撤销恢复原 ID、子任务、标签和关联时间块', async ({ page }) => {
  await page.getByRole('button', { name: '标签管理', exact: true }).click(); await createTag(page, '实验');
  await page.getByRole('dialog', { name: '标签管理', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  await beginTask(page, '撤销恢复任务', '保留所有关联', '2026-10-23'); await page.getByLabel('任务标签 实验', { exact: true }).check(); await addSubtask(page, '核对测量');
  await saveAndReturn(page, 1);
  await page.getByRole('button', { name: '安排时间 撤销恢复任务', exact: true }).click();
  const block = page.getByRole('dialog', { name: '安排执行时间', exact: true });
  await block.getByLabel('开始时间', { exact: true }).fill('2026-10-21T19:00'); await block.getByLabel('结束时间', { exact: true }).fill('2026-10-21T20:00');
  await block.getByRole('button', { name: '保存安排', exact: true }).click(); await expect(block).not.toBeVisible();
  const before = await stored(page);
  await page.getByRole('button', { name: '撤销恢复任务', exact: true }).click(); await page.getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('dialog', { name: '删除这条任务？', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks.length).toBe(0); expect((await stored(page)).scheduleBlocks).toHaveLength(0);
  await page.getByRole('button', { name: '撤销删除', exact: true }).click(); await expect.poll(async () => (await stored(page)).tasks.length).toBe(1);
  const restored = await stored(page);
  expect(restored.tasks).toEqual(before.tasks.map((task) => ({ ...task, revision: task.revision + 1, updatedAt: expect.any(String) })));
  expect(restored.scheduleBlocks).toEqual(before.scheduleBlocks.map((entry) => ({ ...entry, revision: entry.revision + 1, updatedAt: expect.any(String) })));
  expect(restored.tags).toEqual(before.tags);
  await expect(page.getByRole('button', { name: '撤销恢复任务', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '待办', exact: true }).click();
  await page.getByRole('button', { name: '撤销恢复任务', exact: true }).click();
  await page.locator('.task-detail-group').filter({ has: page.locator('summary', { hasText: /^子任务/ }) }).locator('summary').click();
  await expect(page.getByLabel('子任务标题 1', { exact: true })).toHaveValue('核对测量');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/phase2-task-mobile.png', fullPage: true });
  await page.getByLabel('子任务标题 1', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/phase2-task-mobile-subtasks.png', fullPage: true });
});
