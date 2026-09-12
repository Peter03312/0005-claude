import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  computeSplice,
  MIN_OVERLAP,
  type SpliceError,
  type SpliceSuccess,
} from './lib/splice';
import {
  loadDraft,
  removeDraft,
  saveDraft,
  type DraftLoadOutcome,
  type DraftStorage,
} from './lib/draft';

const SIDE_LABEL = { left: '左卷', right: '右卷' } as const;

function describeError(error: SpliceError): string {
  switch (error.kind) {
    case 'format': {
      const shown = error.content.trim() === '' ? '（空白行）' : `「${error.content.trim()}」`;
      return `${SIDE_LABEL[error.side]}第 ${error.line} 行格式非法：${shown}。每行必须是两个大写字母后接六位数字（例如 AB123456）。`;
    }
    case 'duplicate':
      return `${SIDE_LABEL[error.side]}出现重复帧码 ${error.code}（第 ${error.firstLine} 行与第 ${error.secondLine} 行），同一卷内不允许重复。`;
    case 'insufficient':
      return error.overlap === 0
        ? '左卷尾部与右卷首部没有任何完全相同的连续帧，无法确认接缝。'
        : `两卷最长完全相同重叠为 ${error.overlap} 帧，不足接卷所需的 ${error.needed} 帧，无法确认唯一接缝。`;
    case 'reversed':
      return `仅将右卷倒序后才能与左卷尾部相接（倒序重叠 ${error.overlap} 帧）。请确认右卷是否按走片顺序逐行记录。`;
  }
}

function AlignmentView({ outcome }: { outcome: SpliceSuccess }) {
  return (
    <section className="panel" data-testid="alignment-panel">
      <h2>逐行对位</h2>
      <p className="panel-note">
        高亮行为两卷完全相同的重叠区，共 {outcome.overlap} 帧；右卷这些重复帧将在接卷时剔除。
      </p>
      <div className="alignment-scroll">
        <table className="alignment" data-testid="alignment-table">
          <thead>
            <tr>
              <th scope="col">左卷（先拍摄）</th>
              <th scope="col">右卷（后拍摄）</th>
            </tr>
          </thead>
          <tbody>
            {outcome.alignment.map((row, i) => (
              <tr
                key={i}
                className={row.isOverlap ? 'overlap' : undefined}
                data-testid="alignment-row"
                data-overlap={row.isOverlap}
              >
                <td>
                  {row.leftIndex !== null && (
                    <span className="frame-cell">
                      <span className="line-no">{row.leftIndex + 1}</span>
                      <code>{outcome.leftFrames[row.leftIndex]}</code>
                    </span>
                  )}
                </td>
                <td>
                  {row.rightIndex !== null && (
                    <span className="frame-cell">
                      <span className="line-no">{row.rightIndex + 1}</span>
                      <code>{outcome.rightFrames[row.rightIndex]}</code>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResultView({ outcome }: { outcome: SpliceSuccess }) {
  const leftCount = outcome.leftFrames.length;
  const seamPosition = leftCount; // 最终序列中接缝位于左卷末帧之后

  const items: ReactNode[] = [];
  outcome.finalFrames.forEach((code, i) => {
    if (i === seamPosition) {
      items.push(
        <li key="seam" className="seam-marker" data-testid="seam-marker" title="接缝位置">
          接缝
        </li>,
      );
    }
    const segment =
      i < leftCount - outcome.overlap ? 'left-only' : i < leftCount ? 'overlap' : 'right-only';
    items.push(
      <li key={i} className={`frame ${segment}`} data-testid="final-frame" data-segment={segment}>
        {code}
      </li>,
    );
  });
  if (seamPosition === outcome.finalFrames.length) {
    items.push(
      <li key="seam" className="seam-marker" data-testid="seam-marker" title="接缝位置">
        接缝
      </li>,
    );
  }

  return (
    <section className="panel result" data-testid="result-panel">
      <h2>接卷结果</h2>
      <dl className="result-meta">
        <div>
          <dt>接缝两侧帧码</dt>
          <dd>
            <code data-testid="seam-before">{outcome.seamBefore}</code>
            <span className="arrow">→</span>
            {outcome.seamAfter !== null ? (
              <code data-testid="seam-after">{outcome.seamAfter}</code>
            ) : (
              <span data-testid="seam-after">（右卷无新增帧）</span>
            )}
          </dd>
        </div>
        <div>
          <dt>剔除重复帧</dt>
          <dd>
            <strong data-testid="removed-count">{outcome.removedCount}</strong> 帧
          </dd>
        </div>
        <div>
          <dt>接卷后总帧数</dt>
          <dd>
            <strong data-testid="total-count">{outcome.finalFrames.length}</strong> 帧
          </dd>
        </div>
      </dl>
      <h3>最终帧序列</h3>
      <ol className="final-sequence" data-testid="final-sequence">
        {items}
      </ol>
      <p className="legend">
        <span className="frame left-only">左卷独有</span>
        <span className="frame overlap">重叠保留一份</span>
        <span className="frame right-only">右卷新增</span>
      </p>
    </section>
  );
}

/** 访问 localStorage；隐私模式等场景下取值本身可能抛错，此时视为不可用 */
function getStorage(): DraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function formatSavedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

export default function App() {
  // 首次渲染前读取草稿：只还原原始文本，接缝/对位/错误仍由下方 useMemo 即时重算
  const [initialLoad] = useState<DraftLoadOutcome>(() => {
    const storage = getStorage();
    return storage === null ? { kind: 'unavailable' } : loadDraft(storage);
  });
  const restoredDraft = initialLoad.kind === 'ok' ? initialLoad.draft : null;

  const [leftText, setLeftText] = useState(restoredDraft?.leftText ?? '');
  const [rightText, setRightText] = useState(restoredDraft?.rightText ?? '');
  const [restoredAt, setRestoredAt] = useState<number | null>(restoredDraft?.savedAt ?? null);
  const [draftProblem, setDraftProblem] = useState<'invalid' | 'unavailable' | null>(() => {
    if (initialLoad.kind === 'invalid') return 'invalid';
    if (initialLoad.kind === 'unavailable') return 'unavailable';
    return null;
  });

  // 文本变化后保存原始内容与更新时间；首次渲染（含恢复）不重复落盘
  const skipInitialSave = useRef(true);
  useEffect(() => {
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }
    const storage = getStorage();
    if (storage !== null) {
      saveDraft(storage, { leftText, rightText, savedAt: Date.now() });
    }
  }, [leftText, rightText]);

  // 结果完全由当前输入推导：任何非法输入都会立即替换掉旧的接卷结果
  const outcome = useMemo(() => computeSplice(leftText, rightText), [leftText, rightText]);

  const handleClearDraft = () => {
    setLeftText('');
    setRightText('');
    setRestoredAt(null);
    const storage = getStorage();
    if (storage !== null) removeDraft(storage);
  };

  return (
    <div className="app">
      <header>
        <h1>缩微胶片接卷核验台</h1>
        <p>
          分别粘贴左、右两卷按走片顺序记录的片边帧码（每行：两个大写字母 + 六位数字）。
          系统将自动寻找最长完全相同重叠段（≥ {MIN_OVERLAP} 帧）并给出唯一接缝。
        </p>
      </header>

      <section className="inputs">
        <label className="roll-input">
          <span className="roll-title">左卷（先拍摄）</span>
          <textarea
            data-testid="left-input"
            value={leftText}
            onChange={(e) => setLeftText(e.target.value)}
            placeholder={'AB123456\nAB123457\n…'}
            spellCheck={false}
            rows={10}
          />
        </label>
        <label className="roll-input">
          <span className="roll-title">右卷（后拍摄）</span>
          <textarea
            data-testid="right-input"
            value={rightText}
            onChange={(e) => setRightText(e.target.value)}
            placeholder={'AB123456\nAB123457\n…'}
            spellCheck={false}
            rows={10}
          />
        </label>
      </section>

      {(restoredAt !== null || draftProblem !== null) && (
        <div className="draft-bar">
          {restoredAt !== null && (
            <p className="draft-notice" data-testid="draft-restored">
              已恢复 {formatSavedAt(restoredAt)} 保存的草稿，结果已按当前内容重新计算。
              <button
                type="button"
                className="draft-action"
                data-testid="clear-draft"
                onClick={handleClearDraft}
              >
                清空草稿
              </button>
            </p>
          )}
          {draftProblem !== null && (
            <p className="draft-warning" data-testid="draft-problem" role="alert">
              {draftProblem === 'unavailable'
                ? '浏览器本地存储不可用，本次输入不会被保存为草稿。'
                : '检测到已损坏的草稿，已忽略；请直接粘贴帧码继续核验。'}
              <button
                type="button"
                className="draft-action"
                data-testid="draft-problem-dismiss"
                onClick={() => setDraftProblem(null)}
              >
                关闭
              </button>
            </p>
          )}
        </div>
      )}

      {outcome.status === 'idle' && (
        <p className="hint" data-testid="idle-hint">
          粘贴两侧帧码后，此处将自动完成核验。
        </p>
      )}

      {outcome.status === 'error' && (
        <section className="panel error" data-testid="error-panel" role="alert">
          <h2>无法接卷</h2>
          <p data-testid="error-message">{describeError(outcome.error)}</p>
        </section>
      )}

      {outcome.status === 'ok' && (
        <>
          <AlignmentView outcome={outcome} />
          <ResultView outcome={outcome} />
        </>
      )}
    </div>
  );
}
