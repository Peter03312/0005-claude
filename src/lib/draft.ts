/**
 * 核验台工作草稿的浏览器本地持久化。
 *
 * 只保存左右两卷的原始输入文本与保存时间；接缝、对位、错误等计算结果
 * 一律不写入草稿，恢复时重新经过既有解析与最长重叠流程得出。
 *
 * 任何异常（存储不可用、内容损坏、字段类型不符）都只会让草稿被忽略，
 * 不影响页面正常的粘贴与计算。
 */

export const DRAFT_STORAGE_KEY = 'microfilm-splice-verifier:draft';
const DRAFT_VERSION = 1;

export interface SpliceDraft {
  /** 左卷原始输入文本 */
  leftText: string;
  /** 右卷原始输入文本 */
  rightText: string;
  /** 保存时间（Unix 毫秒） */
  savedAt: number;
}

/** 存储接口的最小子集，便于测试与降级 */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type DraftLoadOutcome =
  | { kind: 'none' }
  | { kind: 'ok'; draft: SpliceDraft }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

/** 序列化为带版本号的 JSON 字符串 */
export function encodeDraft(draft: SpliceDraft): string {
  return JSON.stringify({
    version: DRAFT_VERSION,
    leftText: draft.leftText,
    rightText: draft.rightText,
    savedAt: draft.savedAt,
  });
}

/**
 * 校验并还原草稿。结构、版本或任一字段类型不符时返回 null，
 * 绝不尝试修补或部分采纳损坏数据。
 */
export function decodeDraft(raw: string): SpliceDraft | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (record.version !== DRAFT_VERSION) return null;
  if (typeof record.leftText !== 'string') return null;
  if (typeof record.rightText !== 'string') return null;
  if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) return null;
  return { leftText: record.leftText, rightText: record.rightText, savedAt: record.savedAt };
}

/** 读取草稿；存储抛错视为不可用，内容损坏视为 invalid */
export function loadDraft(storage: DraftStorage): DraftLoadOutcome {
  let raw: string | null;
  try {
    raw = storage.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw === null) return { kind: 'none' };
  const draft = decodeDraft(raw);
  return draft === null ? { kind: 'invalid' } : { kind: 'ok', draft };
}

/**
 * 保存草稿；两侧皆空时改为移除草稿（空白不值得恢复）。
 * 存储不可用时静默失败，返回是否写入成功。
 */
export function saveDraft(storage: DraftStorage, draft: SpliceDraft): boolean {
  try {
    if (draft.leftText === '' && draft.rightText === '') {
      storage.removeItem(DRAFT_STORAGE_KEY);
    } else {
      storage.setItem(DRAFT_STORAGE_KEY, encodeDraft(draft));
    }
    return true;
  } catch {
    return false;
  }
}

/** 移除草稿；存储不可用时静默忽略 */
export function removeDraft(storage: DraftStorage): void {
  try {
    storage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // 忽略：清空失败不阻断页面使用
  }
}
