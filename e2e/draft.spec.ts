import { expect, test, type Page } from '@playwright/test';
import { DRAFT_STORAGE_KEY } from '../src/lib/draft';

const codes = (prefix: string, from: number, to: number): string[] => {
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`${prefix}${String(i).padStart(6, '0')}`);
  }
  return out;
};

const LEFT = codes('AB', 1, 6); // AB000001 … AB000006
const RIGHT = [...codes('AB', 4, 6), ...codes('CD', 1, 2)]; // 重叠 3 帧 + 2 新帧
const BAD_RIGHT = ['ab000004', ...codes('AB', 5, 6), ...codes('CD', 1, 2)]; // 首行小写非法

async function paste(page: Page, side: 'left' | 'right', lines: string[]) {
  await page.getByTestId(`${side}-input`).fill(lines.join('\n'));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('有效输入刷新后恢复草稿，并重新算出同一接缝', async ({ page }) => {
  await paste(page, 'left', LEFT);
  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('seam-before')).toHaveText('AB000006');
  await expect(page.getByTestId('seam-after')).toHaveText('CD000001');
  await expect(page.getByTestId('removed-count')).toHaveText('3');

  await page.reload();

  // 左右文本被还原，并提示已恢复及保存时间
  await expect(page.getByTestId('left-input')).toHaveValue(LEFT.join('\n'));
  await expect(page.getByTestId('right-input')).toHaveValue(RIGHT.join('\n'));
  await expect(page.getByTestId('draft-restored')).toBeVisible();
  await expect(page.getByTestId('draft-restored')).toContainText('已恢复');

  // 接缝、剔除数量与最终序列由恢复后的文本重新计算，结果一致
  await expect(page.getByTestId('seam-before')).toHaveText('AB000006');
  await expect(page.getByTestId('seam-after')).toHaveText('CD000001');
  await expect(page.getByTestId('removed-count')).toHaveText('3');
  await expect(page.getByTestId('final-frame')).toHaveCount(8);
  await expect(page.locator('[data-testid="alignment-row"][data-overlap="true"]')).toHaveCount(3);
});

test('非法输入刷新后仍显示重新计算的定位错误，而不是旧结果', async ({ page }) => {
  await paste(page, 'left', LEFT);
  await paste(page, 'right', BAD_RIGHT);
  await expect(page.getByTestId('error-message')).toContainText('右卷第 1 行格式非法');
  await expect(page.getByTestId('error-message')).toContainText('ab000004');

  await page.reload();

  // 草稿恢复的是原始文本；错误由既有解析流程重新定位
  await expect(page.getByTestId('right-input')).toHaveValue(BAD_RIGHT.join('\n'));
  await expect(page.getByTestId('draft-restored')).toBeVisible();
  await expect(page.getByTestId('error-message')).toContainText('右卷第 1 行格式非法');
  await expect(page.getByTestId('error-message')).toContainText('ab000004');
  await expect(page.getByTestId('result-panel')).toHaveCount(0);
  await expect(page.getByTestId('alignment-panel')).toHaveCount(0);

  // 修正后立即可接卷
  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('error-panel')).toHaveCount(0);
  await expect(page.getByTestId('seam-before')).toHaveText('AB000006');
});

test('损坏草稿被忽略并给出可关闭提示，不阻断正常核验', async ({ page }) => {
  // 在页面脚本运行前写入损坏的草稿
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, '{"version":1,"leftText":"AB000001",broken'),
    DRAFT_STORAGE_KEY,
  );
  await page.goto('/');

  // 可关闭的提示出现，但不显示任何来自草稿的旧接卷结果
  const warning = page.getByTestId('draft-problem');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('已损坏');
  await expect(page.getByTestId('result-panel')).toHaveCount(0);
  await expect(page.getByTestId('error-panel')).toHaveCount(0);
  await expect(page.getByTestId('idle-hint')).toBeVisible();

  // 提示可关闭
  await page.getByTestId('draft-problem-dismiss').click();
  await expect(warning).toHaveCount(0);

  // 当前页面粘贴与计算完全正常
  await paste(page, 'left', LEFT);
  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('seam-before')).toHaveText('AB000006');
  await expect(page.getByTestId('removed-count')).toHaveText('3');
});

test('字段类型不符的草稿同样被忽略，页面可正常使用', async ({ page }) => {
  await page.addInitScript(
    (key) =>
      window.localStorage.setItem(
        key,
        JSON.stringify({ version: 1, leftText: 123, rightText: null, savedAt: '昨天' }),
      ),
    DRAFT_STORAGE_KEY,
  );
  await page.goto('/');

  await expect(page.getByTestId('draft-problem')).toBeVisible();
  await expect(page.getByTestId('left-input')).toHaveValue('');
  await expect(page.getByTestId('result-panel')).toHaveCount(0);

  await paste(page, 'left', LEFT);
  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('seam-after')).toHaveText('CD000001');
});

test('清空草稿后输入、提示与结果一起归零，再次刷新保持空白，随后可建立新草稿', async ({ page }) => {
  await paste(page, 'left', LEFT);
  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('removed-count')).toHaveText('3');

  await page.reload();
  await expect(page.getByTestId('draft-restored')).toBeVisible();

  // 清空草稿：输入、提示和当前计算结果一起归零
  await page.getByTestId('clear-draft').click();
  await expect(page.getByTestId('left-input')).toHaveValue('');
  await expect(page.getByTestId('right-input')).toHaveValue('');
  await expect(page.getByTestId('draft-restored')).toHaveCount(0);
  await expect(page.getByTestId('result-panel')).toHaveCount(0);
  await expect(page.getByTestId('alignment-panel')).toHaveCount(0);
  await expect(page.getByTestId('idle-hint')).toBeVisible();

  // 再次刷新后保持空白，不再恢复
  await page.reload();
  await expect(page.getByTestId('left-input')).toHaveValue('');
  await expect(page.getByTestId('right-input')).toHaveValue('');
  await expect(page.getByTestId('draft-restored')).toHaveCount(0);
  await expect(page.getByTestId('idle-hint')).toBeVisible();

  // 随后输入仍可建立新草稿
  await paste(page, 'left', LEFT);
  await paste(page, 'right', RIGHT);
  await page.reload();
  await expect(page.getByTestId('draft-restored')).toBeVisible();
  await expect(page.getByTestId('seam-before')).toHaveText('AB000006');
});
