/**
 * 缩微胶片接卷核验核心逻辑。
 *
 * 帧码规则：两个大写字母后接六位数字；读取时去除行首尾空白但不改写内容；
 * 同一卷内不允许重复。
 *
 * 接卷判据：左卷后缀与右卷前缀完全相同的最长连续段，长度至少为 MIN_OVERLAP；
 * 多个可行长度只取最长者；重叠帧在结果中只保留一份。
 */

export const FRAME_CODE_PATTERN = /^[A-Z]{2}\d{6}$/;
export const MIN_OVERLAP = 3;

export type RollSide = 'left' | 'right';

export type ParseError =
  | { kind: 'format'; side: RollSide; line: number; content: string }
  | { kind: 'duplicate'; side: RollSide; code: string; firstLine: number; secondLine: number };

export type ParseResult =
  | { ok: true; frames: string[] }
  | { ok: false; error: ParseError };

/**
 * 解析一卷的帧码文本。逐行 trim 后校验格式与卷内重复；
 * 文本末尾的单个换行视为最后一行的结束符，不产生空行。
 */
export function parseRoll(text: string, side: RollSide): ParseResult {
  const rawLines = text.split(/\r\n|\r|\n/);
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  const seen = new Map<string, number>();
  const frames: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = i + 1;
    const code = rawLines[i].trim();
    if (!FRAME_CODE_PATTERN.test(code)) {
      return { ok: false, error: { kind: 'format', side, line, content: rawLines[i] } };
    }
    const firstLine = seen.get(code);
    if (firstLine !== undefined) {
      return { ok: false, error: { kind: 'duplicate', side, code, firstLine, secondLine: line } };
    }
    seen.set(code, line);
    frames.push(code);
  }

  return { ok: true, frames };
}

/**
 * 左卷后缀与右卷前缀完全相同的最长连续段长度。
 * 从最长候选向短逐一比较，天然保证只采用最长者。
 */
export function longestSuffixPrefixOverlap(left: string[], right: string[]): number {
  const max = Math.min(left.length, right.length);
  for (let k = max; k >= 1; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      if (left[left.length - k + i] !== right[i]) {
        match = false;
        break;
      }
    }
    if (match) return k;
  }
  return 0;
}

export type SpliceError =
  | ParseError
  | { kind: 'insufficient'; overlap: number; needed: number }
  | { kind: 'reversed'; overlap: number };

export interface AlignmentRow {
  /** 该行对应的左卷帧下标（0 起），无则为 null */
  leftIndex: number | null;
  /** 该行对应的右卷帧下标（0 起），无则为 null */
  rightIndex: number | null;
  /** 左右同时存在即为重叠行 */
  isOverlap: boolean;
}

export interface SpliceSuccess {
  status: 'ok';
  /** 重叠长度（即被剔除的右卷重复前缀帧数） */
  overlap: number;
  /** 接卷后的最终帧序列（重叠帧只保留一份） */
  finalFrames: string[];
  /** 剔除的重复帧数量 */
  removedCount: number;
  /** 接缝靠左一卷的最后一帧 */
  seamBefore: string;
  /** 接缝靠右一卷贡献的第一帧；右卷被完全吸收时为 null */
  seamAfter: string | null;
  /** 双栏逐行对位数据 */
  alignment: AlignmentRow[];
  leftFrames: string[];
  rightFrames: string[];
}

export type SpliceOutcome =
  | { status: 'idle' }
  | { status: 'error'; error: SpliceError }
  | SpliceSuccess;

/**
 * 由两侧原始文本直接计算核验结果。
 * 任一校验失败即返回定位后的原因，绝不携带旧的接卷结果。
 */
export function computeSplice(leftText: string, rightText: string): SpliceOutcome {
  const leftParsed = parseRoll(leftText, 'left');
  if (!leftParsed.ok) return { status: 'error', error: leftParsed.error };

  const rightParsed = parseRoll(rightText, 'right');
  if (!rightParsed.ok) return { status: 'error', error: rightParsed.error };

  const left = leftParsed.frames;
  const right = rightParsed.frames;

  if (left.length === 0 && right.length === 0) {
    return { status: 'idle' };
  }

  const overlap = longestSuffixPrefixOverlap(left, right);

  if (overlap < MIN_OVERLAP) {
    const reversedOverlap = longestSuffixPrefixOverlap(left, [...right].reverse());
    if (reversedOverlap >= MIN_OVERLAP) {
      return { status: 'error', error: { kind: 'reversed', overlap: reversedOverlap } };
    }
    return { status: 'error', error: { kind: 'insufficient', overlap, needed: MIN_OVERLAP } };
  }

  const finalFrames = [...left, ...right.slice(overlap)];
  const offset = left.length - overlap;
  const totalRows = offset + right.length;
  const alignment: AlignmentRow[] = [];
  for (let row = 0; row < totalRows; row++) {
    const leftIndex = row < left.length ? row : null;
    const rightIdx = row - offset;
    const rightIndex = rightIdx >= 0 && rightIdx < right.length ? rightIdx : null;
    alignment.push({ leftIndex, rightIndex, isOverlap: leftIndex !== null && rightIndex !== null });
  }

  return {
    status: 'ok',
    overlap,
    finalFrames,
    removedCount: overlap,
    seamBefore: left[left.length - 1],
    seamAfter: overlap < right.length ? right[overlap] : null,
    alignment,
    leftFrames: left,
    rightFrames: right,
  };
}
