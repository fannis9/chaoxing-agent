// 智慧树（zhihuishu.com）适配器 —— 目前是**只读探针**。
// 没有账号实测过，所以标记 experimental：控制器在非 dry-run 模式下会拒绝动作，只采集信号。
// 等拿到真实页面后，补 pageKind 的路径规则、readTasks 的选择器，再把 experimental 去掉。

export const zhihuishu = {
  id: 'zhihuishu',
  name: '智慧树',
  hosts: ['zhihuishu.com'],
  experimental: true,

  match(url) {
    try {
      const host = new URL(url).hostname;
      return host === 'zhihuishu.com' || host.endsWith('.zhihuishu.com');
    } catch {
      return false;
    }
  },

  // 只做保守判断：确定不了的交给 unknown → 规则会让模型看
  pageKind(url) {
    try {
      const path = new URL(url).pathname;
      if (/login|passport/i.test(path)) return 'verify';
      if (/studyspace|study\/|video/i.test(path)) return 'chapter';
      if (/course|mooc/i.test(path)) return 'catalog';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  },

  chapterId(url) {
    try {
      const params = new URL(url).searchParams;
      return params.get('chapterId') || params.get('chapterid') || params.get('recruitId') || '';
    } catch {
      return '';
    }
  },

  taskAction(type) {
    const map = {video: 'play_video', document: 'play_document', quiz: 'answer_quiz', homework: 'answer_quiz'};
    return map[String(type || '')] || null;
  },

  isStudyPage(url) {
    return this.pageKind(url) === 'chapter';
  },

  isEntryPage(url) {
    return this.pageKind(url) === 'catalog';
  },

  // 页面内：智慧树的任务列表还没实测过，先返回空让探针保持只读，
  // 这样 dry-run 能看清页面类型/播放器，但不会误判“没有任务”去跳过章节。
  readTasks() {
    return {tasks: [], defaults: null, containerDepth: null, nextAvailable: null};
  },
};
