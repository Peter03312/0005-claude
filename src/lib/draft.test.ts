import { describe, expect, it } from 'vitest';
import {
  decodeDraft,
  DRAFT_STORAGE_KEY,
  encodeDraft,
  loadDraft,
  removeDraft,
  saveDraft,
  type DraftStorage,
} from './draft';

const sample = { leftText: 'AB000001\nAB000002', rightText: 'AB000002\nCD000001', savedAt: 1726000000000 };

function memoryStorage(initial: Record<string, string> = {}): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('encodeDraft / decodeDraft：草稿编解码', () => {
  it('往返后完整保留左右文本与保存时间', () => {
    expect(decodeDraft(encodeDraft(sample))).toEqual(sample);
  });

  it('保留多行文本中的换行与首尾空白，不做任何改写', () => {
    const draft = { leftText: '  AB000001 \n\nAB000002\n', rightText: '\tCD000001\r\n', savedAt: 1 };
    expect(decodeDraft(encodeDraft(draft))).toEqual(draft);
  });

  it('编码结果包含版本号，便于未来结构演进', () => {
    const parsed = JSON.parse(encodeDraft(sample)) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
  });

  it('容忍未知多余字段（向前兼容），但不影响必需字段校验', () => {
    const raw = JSON.stringify({ ...sample, version: 1, futureField: { nested: true } });
    expect(decodeDraft(raw)).toEqual(sample);
  });
});

describe('decodeDraft：拒绝损坏或类型不符的数据', () => {
  it.each([
    ['非 JSON 文本', 'not-a-draft{{{'],
    ['空字符串', ''],
    ['JSON null', 'null'],
    ['JSON 数组', '[]'],
    ['JSON 数字', '42'],
    ['JSON 字符串', '"draft"'],
  ])('拒绝%s', (_label, raw) => {
    expect(decodeDraft(raw)).toBeNull();
  });

  it.each([
    ['缺少 version', { leftText: '', rightText: '', savedAt: 1 }],
    ['version 不符', { version: 2, leftText: '', rightText: '', savedAt: 1 }],
    ['version 类型不符', { version: '1', leftText: '', rightText: '', savedAt: 1 }],
    ['缺少 leftText', { version: 1, rightText: '', savedAt: 1 }],
    ['缺少 rightText', { version: 1, leftText: '', savedAt: 1 }],
    ['缺少 savedAt', { version: 1, leftText: '', rightText: '' }],
    ['leftText 不是字符串', { version: 1, leftText: 42, rightText: '', savedAt: 1 }],
    ['rightText 是数组', { version: 1, leftText: '', rightText: ['AB000001'], savedAt: 1 }],
    ['savedAt 是字符串', { version: 1, leftText: '', rightText: '', savedAt: '2026-09-12' }],
    ['savedAt 是 null', { version: 1, leftText: '', rightText: '', savedAt: null }],
    ['savedAt 是布尔值', { version: 1, leftText: '', rightText: '', savedAt: true }],
  ])('拒绝字段类型不符：%s', (_label, obj) => {
    expect(decodeDraft(JSON.stringify(obj))).toBeNull();
  });

  it.each([
    ['超过 Date 上限', 8.64e15 + 1],
    ['低于 Date 下限', -8.64e15 - 1],
    ['极大的有限数字', 1e17],
    ['极小的负有限数字', -1e17],
  ])('拒绝超出可格式化时间范围的 savedAt（%s）', (_label, savedAt) => {
    const raw = JSON.stringify({ version: 1, leftText: '', rightText: '', savedAt });
    expect(decodeDraft(raw)).toBeNull();
  });

  it('Date 毫秒边界上的 savedAt 仍可还原（边界内不算损坏）', () => {
    const raw = JSON.stringify({ version: 1, leftText: '', rightText: '', savedAt: 8.64e15 });
    expect(decodeDraft(raw)).toEqual({ leftText: '', rightText: '', savedAt: 8.64e15 });
  });
});

describe('loadDraft：读取草稿', () => {
  it('没有草稿时返回 none', () => {
    expect(loadDraft(memoryStorage())).toEqual({ kind: 'none' });
  });

  it('草稿完好时返回 ok 并还原内容', () => {
    const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: encodeDraft(sample) });
    expect(loadDraft(storage)).toEqual({ kind: 'ok', draft: sample });
  });

  it('内容损坏时返回 invalid 而不是抛错', () => {
    const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: '{"version":1,"leftText":' });
    expect(loadDraft(storage)).toEqual({ kind: 'invalid' });
  });

  it('字段类型不符时返回 invalid', () => {
    const storage = memoryStorage({
      [DRAFT_STORAGE_KEY]: JSON.stringify({ version: 1, leftText: '', rightText: '', savedAt: '昨天' }),
    });
    expect(loadDraft(storage)).toEqual({ kind: 'invalid' });
  });

  it('savedAt 超出可格式化时间范围时返回 invalid 而不是恢复出无效日期', () => {
    const storage = memoryStorage({
      [DRAFT_STORAGE_KEY]: JSON.stringify({ version: 1, leftText: 'AB000001', rightText: '', savedAt: 1e17 }),
    });
    expect(loadDraft(storage)).toEqual({ kind: 'invalid' });
  });

  it('存储抛错时返回 unavailable', () => {
    const storage: DraftStorage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadDraft(storage)).toEqual({ kind: 'unavailable' });
  });
});

describe('saveDraft / removeDraft：写入与清除', () => {
  it('写入编码后的草稿并可被 loadDraft 读回', () => {
    const storage = memoryStorage();
    expect(saveDraft(storage, sample)).toBe(true);
    expect(loadDraft(storage)).toEqual({ kind: 'ok', draft: sample });
  });

  it('两侧皆空时不留草稿（移除已有键）', () => {
    const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: encodeDraft(sample) });
    expect(saveDraft(storage, { leftText: '', rightText: '', savedAt: Date.now() })).toBe(true);
    expect(storage.data.has(DRAFT_STORAGE_KEY)).toBe(false);
  });

  it('存储不可用时静默失败并返回 false', () => {
    const storage: DraftStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    };
    expect(saveDraft(storage, sample)).toBe(false);
    expect(removeDraft(storage)).toBe(false);
  });

  it('removeDraft 移除成功时返回 true', () => {
    const storage = memoryStorage({ [DRAFT_STORAGE_KEY]: encodeDraft(sample) });
    expect(removeDraft(storage)).toBe(true);
    expect(loadDraft(storage)).toEqual({ kind: 'none' });
  });

  it('removeDraft 在无草稿时也返回 true', () => {
    expect(removeDraft(memoryStorage())).toBe(true);
  });
});
