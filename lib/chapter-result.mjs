// 章节结果模型（照 Samueli924 的 ChapterResult：SUCCESS / ERROR / PENDING / NOT_OPEN）。
// 只做判定，不改变行为；控制器用它记录每一步的结局，便于事后统计和回补。

/** @returns {'success'|'pending'|'error'|'not-open'} */
export function chapterOutcome({decision, result, check, scene, before}) {
  const action = decision?.action || '';
  const chapterChanged = Boolean(before?.chapter?.id && scene?.chapter?.id && before.chapter.id !== scene.chapter.id);

  // 明确不是"未开放"：平台如果提示未开始/未开放，页面文本会有这些词
  const text = String(scene?.bodySnippet || '');
  if (/尚未开放|未开始|未到开放时间|尚未开始/.test(text)) return 'not-open';

  if (action === 'mark_deferred') return 'pending';
  if (action === 'ask_operator') return check?.ok === false ? 'error' : 'pending';

  if (check?.ok) return 'success';
  if (chapterChanged) return 'success';

  // 动作执行了但没验证通过
  if (result && result.ok === false) return 'error';
  return 'pending';
}

/** 章节结果是否值得重新排队（Pending 才重试）。 */
export function shouldRetry(outcome, attempts, limit = 1) {
  return outcome === 'pending' && attempts < limit;
}
