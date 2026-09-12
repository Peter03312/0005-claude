import { describe, expect, it } from 'vitest';
import {
  computeSplice,
  longestSuffixPrefixOverlap,
  MIN_OVERLAP,
  parseRoll,
  type SpliceSuccess,
} from './splice';

const codes = (prefix: string, from: number, to: number): string[] => {
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`${prefix}${String(i).padStart(6, '0')}`);
  }
  return out;
};

describe('parseRoll：帧码格式与卷内重复', () => {
  it('接受合法帧码并保持走片顺序', () => {
    const result = parseRoll('AB123456\nCD654321', 'left');
    expect(result).toEqual({ ok: true, frames: ['AB123456', 'CD654321'] });
  });

  it('读取时去除行首尾空白', () => {
    const result = parseRoll('  AB123456 \t\n\tCD654321  ', 'left');
    expect(result).toEqual({ ok: true, frames: ['AB123456', 'CD654321'] });
  });

  it('不改写内容：小写字母判为格式非法而非自动转大写', () => {
    const result = parseRoll('AB123456\nab123456', 'right');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'format', side: 'right', line: 2, content: 'ab123456' },
    });
  });

  it.each([
    ['A123456', '只有一个字母'],
    ['ABC123456', '三个字母'],
    ['AB12345', '只有五位数字'],
    ['AB1234567', '七位数字'],
    ['AB12345A', '数字位混入字母'],
    ['123456AB', '字母数字顺序颠倒'],
    ['AB 123456', '中间含空格'],
  ])('拒绝非法格式 %s（%s）并定位行号', (bad) => {
    const result = parseRoll(`AB123456\n${bad}\nCD654321`, 'left');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'format', side: 'left', line: 2, content: bad },
    });
  });

  it('拒绝中间空白行，但容忍文本末尾的换行符', () => {
    expect(parseRoll('AB123456\n\nCD654321', 'left')).toEqual({
      ok: false,
      error: { kind: 'format', side: 'left', line: 2, content: '' },
    });
    expect(parseRoll('AB123456\nCD654321\n', 'left')).toEqual({
      ok: true,
      frames: ['AB123456', 'CD654321'],
    });
    expect(parseRoll('AB123456\r\nCD654321\r\n', 'left')).toEqual({
      ok: true,
      frames: ['AB123456', 'CD654321'],
    });
  });

  it('同一卷内重复帧码被定位到两处行号', () => {
    const result = parseRoll('AB123456\nCD654321\nAB123456', 'right');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'duplicate', side: 'right', code: 'AB123456', firstLine: 1, secondLine: 3 },
    });
  });

  it('空文本解析为空卷，仅含换行的文本视为一个空白行', () => {
    expect(parseRoll('', 'left')).toEqual({ ok: true, frames: [] });
    expect(parseRoll('\n', 'right')).toEqual({
      ok: false,
      error: { kind: 'format', side: 'right', line: 1, content: '' },
    });
  });
});

describe('longestSuffixPrefixOverlap：最长完全相同重叠', () => {
  it('无重叠时返回 0', () => {
    expect(longestSuffixPrefixOverlap(codes('AB', 1, 4), codes('CD', 1, 4))).toBe(0);
  });

  it('找到后缀与前缀的完全相同连续段', () => {
    const left = [...codes('AB', 1, 4), ...codes('CD', 1, 3)];
    const right = [...codes('CD', 1, 3), ...codes('EF', 1, 2)];
    expect(longestSuffixPrefixOverlap(left, right)).toBe(3);
  });

  it('多个可行长度只采用最长者', () => {
    // 周期序列：k=4 与 k=2 同时可行，必须取 4
    const left = ['XX000009', 'AB000001', 'AB000002', 'AB000001', 'AB000002'];
    const right = ['AB000001', 'AB000002', 'AB000001', 'AB000002', 'YY000001'];
    expect(longestSuffixPrefixOverlap(left, right)).toBe(4);
  });

  it('右卷完全包含于左卷尾部时返回右卷全长', () => {
    const left = codes('AB', 1, 5);
    const right = codes('AB', 3, 5);
    expect(longestSuffixPrefixOverlap(left, right)).toBe(3);
  });

  it('左卷仅是右卷中间的子串时不算重叠', () => {
    const left = codes('AB', 3, 5);
    const right = codes('AB', 1, 7);
    expect(longestSuffixPrefixOverlap(left, right)).toBe(0);
  });

  it('两卷完全相同时重叠为全长', () => {
    const roll = codes('AB', 1, 6);
    expect(longestSuffixPrefixOverlap(roll, [...roll])).toBe(6);
  });
});

describe('computeSplice：接卷判据', () => {
  const leftText = codes('AB', 1, 6).join('\n');
  const rightText = [...codes('AB', 4, 6), ...codes('CD', 1, 2)].join('\n');

  it('两侧皆空时为空闲态', () => {
    expect(computeSplice('', '')).toEqual({ status: 'idle' });
  });

  it('成功接卷：重叠帧只保留一份，接缝与剔除数量正确', () => {
    const outcome = computeSplice(leftText, rightText);
    expect(outcome.status).toBe('ok');
    const ok = outcome as SpliceSuccess;
    expect(ok.overlap).toBe(3);
    expect(ok.removedCount).toBe(3);
    expect(ok.finalFrames).toEqual([...codes('AB', 1, 6), ...codes('CD', 1, 2)]);
    expect(ok.seamBefore).toBe('AB000006');
    expect(ok.seamAfter).toBe('CD000001');
  });

  it('对位数据：右卷前缀与左卷后缀逐行对齐并标记重叠区', () => {
    const ok = computeSplice(leftText, rightText) as SpliceSuccess;
    // 总行数 = 左卷 6 行 + 右卷 2 个非重叠行
    expect(ok.alignment).toHaveLength(8);
    const overlapRows = ok.alignment.filter((r) => r.isOverlap);
    expect(overlapRows).toHaveLength(3);
    expect(overlapRows.map((r) => [r.leftIndex, r.rightIndex])).toEqual([
      [3, 0],
      [4, 1],
      [5, 2],
    ]);
    // 重叠行左右帧码完全一致
    for (const row of overlapRows) {
      expect(ok.leftFrames[row.leftIndex!]).toBe(ok.rightFrames[row.rightIndex!]);
    }
    // 左卷独有的前 3 行右栏为空，右卷独有的后 2 行左栏为空
    expect(ok.alignment[0].rightIndex).toBeNull();
    expect(ok.alignment[7].leftIndex).toBeNull();
  });

  it('右卷被完全吸收时接缝右侧为空', () => {
    const outcome = computeSplice(codes('AB', 1, 5).join('\n'), codes('AB', 3, 5).join('\n'));
    expect(outcome.status).toBe('ok');
    const ok = outcome as SpliceSuccess;
    expect(ok.finalFrames).toEqual(codes('AB', 1, 5));
    expect(ok.seamBefore).toBe('AB000005');
    expect(ok.seamAfter).toBeNull();
    expect(ok.removedCount).toBe(3);
  });

  it('最长重叠不足三帧时报错并给出实际重叠长度', () => {
    const right = [...codes('AB', 5, 6), ...codes('CD', 1, 3)].join('\n');
    const outcome = computeSplice(leftText, right);
    expect(outcome).toEqual({
      status: 'error',
      error: { kind: 'insufficient', overlap: 2, needed: MIN_OVERLAP },
    });
  });

  it('完全无重叠时报 insufficient 且 overlap 为 0', () => {
    const outcome = computeSplice(codes('AB', 1, 4).join('\n'), codes('CD', 1, 4).join('\n'));
    expect(outcome).toEqual({
      status: 'error',
      error: { kind: 'insufficient', overlap: 0, needed: MIN_OVERLAP },
    });
  });

  it('仅将右卷倒序后才能相接时给出 reversed 原因', () => {
    // 右卷尾部的 AB000005/AB000004/AB000003 倒序后可与左卷后缀相接
    const right = [...codes('CD', 1, 2), 'AB000005', 'AB000004', 'AB000003'].join('\n');
    const outcome = computeSplice(codes('AB', 1, 5).join('\n'), right);
    expect(outcome).toEqual({ status: 'error', error: { kind: 'reversed', overlap: 3 } });
  });

  it('正向重叠不足三帧且倒序也不足时仍报 insufficient', () => {
    const right = [...codes('CD', 1, 2), 'AB000005', 'AB000004'].join('\n');
    const outcome = computeSplice(codes('AB', 1, 5).join('\n'), right);
    expect(outcome).toEqual({
      status: 'error',
      error: { kind: 'insufficient', overlap: 0, needed: MIN_OVERLAP },
    });
  });

  it('格式非法与卷内重复优先于重叠计算被定位', () => {
    expect(computeSplice('AB123456\nxx000000', rightText)).toEqual({
      status: 'error',
      error: { kind: 'format', side: 'left', line: 2, content: 'xx000000' },
    });
    expect(computeSplice(leftText, 'AB000004\nAB000005\nAB000004')).toEqual({
      status: 'error',
      error: { kind: 'duplicate', side: 'right', code: 'AB000004', firstLine: 1, secondLine: 3 },
    });
  });

  it('采用最长完全相同段，剔除数量随之确定', () => {
    // 左卷后缀与右卷前缀有 4 帧完全相同；第 5 帧不同，重叠不能再延长
    const left = ['XX000009', 'AB000001', 'AB000002', 'AB000003', 'AB000004'];
    const right = ['AB000001', 'AB000002', 'AB000003', 'AB000004', 'YY000001'];
    const ok = computeSplice(left.join('\n'), right.join('\n')) as SpliceSuccess;
    expect(ok.status).toBe('ok');
    expect(ok.overlap).toBe(4);
    expect(ok.removedCount).toBe(4);
    expect(ok.finalFrames).toEqual([...left, 'YY000001']);
    expect(ok.seamBefore).toBe('AB000004');
    expect(ok.seamAfter).toBe('YY000001');
  });
});
