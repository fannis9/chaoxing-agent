// 真实页面快照（2026-11-22 从学习通抓取），用于回归测试。
// 每个场景只保留决策需要关注的字段。

const base = {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=640997473&courseId=221383804&clazzid=150237907&cpi=494709678&enc=test&mooc2=1',
  pageKind: 'chapter',
  requiresUser: false,
  blocked: false,
  popup: null,
  player: null,
  progress: null,
  emptyContent: false,
  nextAvailable: true,
  defaults: {knowledgeid: 1, courseId: 2, clazzId: 3},
};

export const scenes = {
  // 视频任务点，播放器已就绪且在播（真实：chapter 640997473）
  videoPlaying: {
    ...base,
    chapter: {id: '640997473', name: '莫尔法'},
    tasks: [{index: 0, id: '166219011931711', mid: '6451654964161662190117378', signature: 'videojs',
      type: 'videojs', required: true, state: 'pending', token: ''}],
    player: {present: true, paused: false, currentTime: 132, duration: 276, readyState: 4, rate: 1, videojs: true},
    allTasksDone: false,
  },

  // 视频任务点，已经播到结尾附近（平台需要时间上报完成）
  videoNearEnd: {
    ...base,
    chapter: {id: '640997540', name: '滴定'},
    tasks: [{index: 0, id: '1663040725530933', mid: 'mid-near', signature: 'videojs',
      type: 'videojs', required: true, state: 'pending', token: ''}],
    player: {present: true, paused: true, currentTime: 284, duration: 286, readyState: 4, rate: 1, videojs: true},
    allTasksDone: false,
  },

  // 视频任务点，播放器没加载（readyState=0，duration=null）
  videoNotLoaded: {
    ...base,
    chapter: {id: '640997473', name: '莫尔法'},
    tasks: [{index: 0, id: '166219011931711', mid: '6451654964161662190117378', signature: 'videojs',
      type: 'videojs', required: true, state: 'pending', token: ''}],
    player: {present: true, paused: true, currentTime: 2841, duration: null, readyState: 0, rate: 1, videojs: true},
    allTasksDone: false,
  },

  // 外链任务点，已完成（真实：chapter 1075563148，点击后平台标记 ans-job-finished）
  hyperlinkDone: {
    ...base,
    chapter: {id: '1075563148', name: '王琎：用会通中西的文化雄心'},
    tasks: [{index: 0, id: '1762677421608612', mid: '7049563536991762677420938', signature: 'hyperlink',
      type: 'hyperlink', required: true, state: 'done', token: 'ee23a4129f31e2a144fb5d0a52bb174d',
      href: 'http://www.globalpeople.com.cn/channel/2/97073.html'}],
    allTasksDone: false,
  },

  // 拓展资料（job 缺失、jobid 为空），平台不计进度（真实：chapter 557263090）
  optionalVideo: {
    ...base,
    chapter: {id: '557263090', name: '知识拓展：金鱼喂食过多会撑死的吗？'},
    tasks: [{index: 0, id: '', mid: '', signature: 'videojs', type: 'videojs', required: false,
      state: 'pending', token: ''}],
    player: {present: true, paused: true, currentTime: 0, duration: 350, readyState: 4, rate: 1, videojs: true},
    allTasksDone: false,
  },

  // 空章：平台显示“暂无内容”（真实：chapter 640996920 / 558645863）
  emptyChapter: {
    ...base,
    chapter: {id: '640996920', name: '章节详情'},
    tasks: [],
    emptyContent: true,
    allTasksDone: false,
  },

  // 章节测验（.TiMu）：语法来自 OCS 的选择器，尚未遇到真实测验章
  chapterTest: {
    ...base,
    chapter: {id: '999999999', name: '章节测验'},
    tasks: [{index: 0, id: '1660000000000001', mid: 'mid-test', signature: 'chapterTest',
      type: 'chapterTest', required: true, state: 'pending', token: ''}],
    allTasksDone: false,
  },

  // 未实现的签名（带音频 PPT）：应交给模型，而不是猜
  pptWithAudio: {
    ...base,
    chapter: {id: '888888888', name: '课件'},
    tasks: [{index: 0, id: '1660000000000002', mid: 'mid-ppt', signature: 'pptWithAudio',
      type: 'pptWithAudio', required: true, state: 'pending', token: ''}],
    allTasksDone: false,
  },

  // 视频弹题（页面内的临时测验）
  videoPopup: {
    ...base,
    chapter: {id: '640997473', name: '莫尔法'},
    tasks: [{index: 0, id: '166219011931711', mid: 'mid-video', signature: 'videojs',
      type: 'videojs', required: true, state: 'pending', token: ''}],
    popup: {present: true, text: '下列哪个是电子？', options: ['质子', '电子']},
    allTasksDone: false,
  },
};
