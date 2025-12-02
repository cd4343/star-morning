// 初始数据 - 模拟数据库
const INITIAL_DATA = {
    family: { name: "快乐星球的家" },
    parent: { id: 'p1', name: '爸爸/妈妈', role: 'parent' },
    child: { 
      id: 'c1', name: '小明', role: 'child', 
      coins: 285, xp: 1250, level: 5, maxXp: 2000, privilegePoints: 2 
    },
    tasks: [
      { id: 't1', title: '整理床铺', coins: 20, xp: 20, duration: 5, category: '劳动', status: 'completed' },
      { id: 't2', title: '完成数学练习', coins: 50, xp: 50, duration: 30, category: '学习', status: 'pending' },
      { id: 't3', title: '练琴', coins: 40, xp: 40, duration: 45, category: '兴趣', status: 'pending' },
    ],
    wishes: {
      saving: { id: 'w_save', title: 'Switch游戏机', target: 3000, current: 450, icon: '🎮' },
      shop: [
        { id: 's1', title: '冰淇淋', cost: 20, stock: 5, icon: '🍦' },
        { id: 's2', title: '看电视30分', cost: 30, stock: 99, icon: '📺' },
      ],
      lottery: { tickets: 3 }
    },
    privileges: [
      { id: 'pr1', title: '电影选择权', cost: 1, desc: '周末电影之夜我做主' },
      { id: 'pr2', title: '晚餐点菜权', cost: 1, desc: '决定今晚吃什么' },
      { id: 'pr3', title: '免做家务卡', cost: 2, desc: '抵消一次家务任务' },
      { id: 'pr4', title: '晚睡30分钟', cost: 3, desc: '周末可以晚睡一会' },
    ],
    achievements: [
      { id: 'a1', title: '初来乍到', desc: '完成第1个任务', icon: '🌱', unlocked: true, date: '2023-10-01' },
      { id: 'a2', title: '持之以恒', desc: '连续7天完成任务', icon: '🌟', unlocked: true, date: '2023-10-08' },
      { id: 'a3', title: '早起的鸟儿', desc: '累计10次在9点前完成任务', icon: '☀️', unlocked: false, date: null },
      { id: 'a4', title: '劳动小能手', desc: '累计完成20个劳动任务', icon: '🧹', unlocked: false, date: null },
      { id: 'a5', title: '学习标兵', desc: '累计完成20个学习任务', icon: '📚', unlocked: true, date: '2023-10-15' },
      { id: 'a6', title: '小小储蓄家', desc: '首次存入金币', icon: '💰', unlocked: false, date: null },
    ],
    history: {
      '2025-10-12': { coins: 70, tasks: [{title: '整理床铺', coins: 20}, {title: '数学作业', coins: 50}] },
      '2025-10-13': { coins: 40, tasks: [{title: '练琴', coins: 40}] },
    },
    pendingReviews: [
      { id: 'r1', taskId: 't_old_1', title: '完成英语阅读', childName: '小明', time: '25分钟', proof: '已上传录音' }
    ]
  };
  
  // 导出数据
  window.INITIAL_DATA = INITIAL_DATA;
