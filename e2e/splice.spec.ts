import { expect, test, type Page } from '@playwright/test';

const codes = (prefix: string, from: number, to: number): string[] => {
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`${prefix}${String(i).padStart(6, '0')}`);
  }
  return out;
};

const LEFT = codes('AB', 1, 6); // AB000001 … AB000006
const RIGHT = [...codes('AB', 4, 6), ...codes('CD', 1, 2)]; // 重叠 3 帧 + 2 新帧

async function paste(page: Page, side: 'left' | 'right', lines: string[]) {
  await page.getByTestId(`${side}-input`).fill(lines.join('\n'));
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('粘贴两卷后自动给出对位高亮、最终序列、接缝与剔除数量', async ({ page }) => {
  await paste(page, 'left', LEFT);
  await paste(page, 'right', RIGHT);

  // 逐行对位：3 行重叠高亮
  const overlapRows = page.locator('[data-testid="alignment-row"][data-overlap="true"]');
  await expect(overlapRows).toHaveCount(3);
  await expect(overlapRows.first()).toContainText('AB000004');
  await expect(overlapRows.last()).toContainText('AB000006');
  // 总行数 = 左卷 6 行 + 右卷 2 个非重叠行
  await expect(page.getByTestId('alignment-row')).toHaveCount(8);

  // 最终帧序列：重叠帧只保留一份
  const finalFrames = page.getByTestId('final-frame');
  await expect(finalFrames).toHaveCount(8);
  await expect(finalFrames.first()).toHaveText('AB000001');
  await expect(finalFrames.last()).toHaveText('CD000002');
  await expect(page.locator('[data-testid="final-frame"][data-segment="overlap"]')).toHaveCount(3);

  // 接缝两侧帧码与剔除数量
  await expect(page.getByTestId('seam-before')).toHaveText('AB000006');
  await expect(page.getByTestId('seam-after')).toHaveText('CD000001');
  await expect(page.getByTestId('removed-count')).toHaveText('3');
  await expect(page.getByTestId('seam-marker')).toHaveCount(1);
});

test('行格式非法：定位原因且不产生结果，修正后立即得到唯一新接缝', async ({ page }) => {
  await paste(page, 'left', LEFT);
  await paste(page, 'right', ['ab000004', ...codes('AB', 5, 6), ...codes('CD', 1, 2)]);

  const errorPanel = page.getByTestId('error-panel');
  await expect(errorPanel).toBeVisible();
  await expect(page.getByTestId('error-message')).toContainText('右卷第 1 行格式非法');
  await expect(page.getByTestId('error-message')).toContainText('ab000004');
  // 不产生任何接卷结果
  await expect(page.getByTestId('result-panel')).toHaveCount(0);
  await expect(page.getByTestId('alignment-panel')).toHaveCount(0);

  // 修正输入后立即得到唯一新接缝
  await paste(page, 'right', RIGHT);
  await expect(errorPanel).toHaveCount(0);
  await expect(page.getByTestId('result-panel')).toBeVisible();
  await expect(page.getByTestId('seam-before')).toHaveText('AB000006');
  await expect(page.getByTestId('seam-after')).toHaveText('CD000001');
  await expect(page.getByTestId('removed-count')).toHaveText('3');
});

test('单卷内重复帧码：报告帧码与两处行号，且不产生结果', async ({ page }) => {
  await paste(page, 'left', LEFT);
  await paste(page, 'right', [...codes('AB', 4, 6), 'AB000004', ...codes('CD', 1, 2)]);

  await expect(page.getByTestId('error-message')).toContainText('右卷出现重复帧码 AB000004');
  await expect(page.getByTestId('error-message')).toContainText('第 1 行与第 4 行');
  await expect(page.getByTestId('result-panel')).toHaveCount(0);

  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('result-panel')).toBeVisible();
  await expect(page.getByTestId('removed-count')).toHaveText('3');
});

test('最长重叠不足三帧：报告实际重叠长度，且不产生结果', async ({ page }) => {
  await paste(page, 'left', LEFT);
  await paste(page, 'right', [...codes('AB', 5, 6), ...codes('CD', 1, 3)]);

  await expect(page.getByTestId('error-message')).toContainText('最长完全相同重叠为 2 帧');
  await expect(page.getByTestId('error-message')).toContainText('不足接卷所需的 3 帧');
  await expect(page.getByTestId('result-panel')).toHaveCount(0);

  // 补足重叠后立即可接
  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('result-panel')).toBeVisible();
});

test('仅将右卷倒序后才能相接：明确提示且不产生结果', async ({ page }) => {
  await paste(page, 'left', LEFT);
  // 右卷尾部倒序包含 AB000006/AB000005/AB000004：只有倒序后才能与左卷后缀相接
  await paste(page, 'right', [...codes('CD', 1, 2), 'AB000006', 'AB000005', 'AB000004']);

  await expect(page.getByTestId('error-message')).toContainText('仅将右卷倒序后才能与左卷尾部相接');
  await expect(page.getByTestId('result-panel')).toHaveCount(0);

  // 改回走片顺序后立即得到接缝
  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('result-panel')).toBeVisible();
  await expect(page.getByTestId('seam-before')).toHaveText('AB000006');
});

test('修改已成功的输入会立即重算，旧结果不会残留', async ({ page }) => {
  await paste(page, 'left', LEFT);
  await paste(page, 'right', RIGHT);
  await expect(page.getByTestId('removed-count')).toHaveText('3');

  // 换成一组全新的两卷：接缝与剔除数量立即更新
  const newLeft = codes('EF', 1, 5);
  const newRight = [...codes('EF', 2, 5), ...codes('GH', 1, 3)];
  await paste(page, 'left', newLeft);
  await paste(page, 'right', newRight);

  await expect(page.getByTestId('seam-before')).toHaveText('EF000005');
  await expect(page.getByTestId('seam-after')).toHaveText('GH000001');
  await expect(page.getByTestId('removed-count')).toHaveText('4');
  await expect(page.getByTestId('final-frame')).toHaveCount(8);

  // 制造非法输入：结果区立即消失，只保留错误定位
  await paste(page, 'right', ['EF00002', 'oops']);
  await expect(page.getByTestId('result-panel')).toHaveCount(0);
  await expect(page.getByTestId('error-message')).toContainText('右卷第 1 行格式非法');
});
