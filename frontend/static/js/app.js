// 状态管理
const state = {
    view: 'onboarding-splash',
    data: window.INITIAL_DATA, // 从 data.js 加载
    activeTab: 'tasks',
    selectedDate: null,
    showTaskModal: null,
    showDepositModal: false,
    selectedAchievement: null,
    depositAmount: ''
};

// --- 工具函数 ---
function escapeHtml(text) {
    if (!text) return text;
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderIcons() {
    lucide.createIcons();
}

// --- 业务逻辑 Actions ---

const actions = {
    navigate: (view) => {
        state.view = view;
        render();
    },
    
    setTab: (tab) => {
        state.activeTab = tab;
        render();
    },

    openTaskModal: (taskId) => {
        state.showTaskModal = state.data.tasks.find(t => t.id === taskId);
        render();
    },

    closeTaskModal: () => {
        state.showTaskModal = null;
        render();
    },

    completeTask: () => {
        const task = state.showTaskModal;
        if (!task) return;

        // 更新状态
        const newTasks = state.data.tasks.map(t => t.id === task.id ? { ...t, status: 'completed' } : t);
        const newCoins = state.data.child.coins + task.coins;
        const newXp = state.data.child.xp + task.xp;
        
        // 简单的升级逻辑检查
        let newLevel = state.data.child.level;
        let newMaxXp = state.data.child.maxXp;
        let newPrivilegePoints = state.data.child.privilegePoints;
        
        if (newXp >= state.data.child.maxXp) {
            newLevel += 1;
            newMaxXp = Math.floor(newMaxXp * 1.2);
            newPrivilegePoints += 1;
            alert(`🎉 恭喜升级到 Lv.${newLevel}! 获得 1 个特权点！`);
        }

        state.data = {
            ...state.data,
            tasks: newTasks,
            child: {
                ...state.data.child,
                coins: newCoins,
                xp: newXp,
                level: newLevel,
                maxXp: newMaxXp,
                privilegePoints: newPrivilegePoints
            }
        };
        state.showTaskModal = null;
        render();
    },

    setDepositAmount: (amount) => {
        state.depositAmount = amount;
        render(); // 重新渲染以更新输入框值
    },

    deposit: () => {
        const amount = parseInt(state.depositAmount);
        if (isNaN(amount) || amount <= 0) return alert("请输入有效金额");
        if (amount > state.data.child.coins) return alert("余额不足");

        state.data.child.coins -= amount;
        state.data.wishes.saving.current += amount;
        state.depositAmount = '';
        state.showDepositModal = false;
        render();
    },

    redeemItem: (itemId) => {
        const item = state.data.wishes.shop.find(s => s.id === itemId);
        if (!item) return;
        
        if (state.data.child.coins < item.cost) return alert("行动币不足");
        if (item.stock <= 0) return alert("库存不足");
        
        if (confirm(`确定消耗 ${item.cost} 币兑换 ${item.title} 吗？`)) {
            item.stock--;
            state.data.child.coins -= item.cost;
            render();
        }
    },

    redeemPrivilege: (privId) => {
        const priv = state.data.privileges.find(p => p.id === privId);
        if (state.data.child.privilegePoints < priv.cost) return alert("特权点不足");
        
        if (confirm(`确定消耗 ${priv.cost} 特权点兑换 "${priv.title}" 吗？`)) {
            state.data.child.privilegePoints -= priv.cost;
            alert("兑换成功！请去找爸爸妈妈行使你的特权吧！");
            render();
        }
    },

    toggleDepositModal: (show) => {
        state.showDepositModal = show;
        if (!show) state.depositAmount = '';
        render();
    },

    setSelectedAchievement: (achId) => {
        state.selectedAchievement = achId ? state.data.achievements.find(a => a.id === achId) : null;
        render();
    },

    setSelectedDate: (dateStr) => {
        state.selectedDate = dateStr;
        render();
    },

    approveTask: (reviewId) => {
        state.data.pendingReviews = state.data.pendingReviews.filter(r => r.id !== reviewId);
        alert("已通过审核，奖励已发放给孩子（模拟）");
        render();
    }
};

// 暴露给全局以便 HTML onclick 调用
window.actions = actions; 

// --- 渲染逻辑 ---

function render() {
    const app = document.getElementById('app');
    let html = '';

    // 路由分发
    switch(state.view) {
        case 'onboarding-splash':
            html = renderSplash();
            break;
        case 'onboarding-register':
            html = renderRegister();
            break;
        case 'onboarding-family':
            html = renderFamilySetup();
            break;
        case 'select-user':
            html = renderSelectUser();
            break;
        case 'child-home':
            html = renderChildHome();
            break;
        case 'child-privileges':
            html = renderChildPrivileges();
            break;
        case 'parent-home':
            html = renderParentHome();
            break;
        case 'parent-tasks':
            html = renderParentTasks();
            break;
        default:
            html = '<div>404 Not Found</div>';
    }

    // 渲染弹窗
    html += renderModals();

    app.innerHTML = html;
    
    // 特殊处理：如果有 active input，由于 innerHTML 会重置焦点，
    // 在真实原生开发中应使用细粒度 DOM 更新。这里为简化，如果是输入框更新，
    // 可以尝试恢复焦点（略过，作为原型接受每次重绘）。
    
    renderIcons();
}

// --- 组件模板 ---

const components = {
    Header: (title, onBack, rightElem = '') => `
        <div class="header">
            <div class="flex items-center">
                ${onBack ? `<button onclick="${onBack}" class="mr-2"><i data-lucide="chevron-left"></i></button>` : ''}
                <h1 class="header__title">${title}</h1>
            </div>
            <div>${rightElem}</div>
        </div>
    `,
    
    Button: (text, onClick, variant='primary', size='md', disabled=false, className='') => `
        <button 
            onclick="${onClick}" 
            class="btn btn--${variant} btn--${size} ${className}"
            ${disabled ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}
        >
            ${text}
        </button>
    `,

    Card: (content, onClick = null, className = '') => `
        <div 
            class="card ${onClick ? 'card--interactive' : ''} ${className}" 
            ${onClick ? `onclick="${onClick}"` : ''}
        >
            ${content}
        </div>
    `,

    TabBar: (activeTab) => `
        <div class="tab-bar">
            <button onclick="actions.setTab('tasks')" class="tab-item ${activeTab === 'tasks' ? 'tab-item--active' : ''}">
                <i data-lucide="home"></i>
                <span class="tab-item__label">任务</span>
            </button>
            <button onclick="actions.setTab('wishes')" class="tab-item ${activeTab === 'wishes' ? 'tab-item--active' : ''}">
                <i data-lucide="gift"></i>
                <span class="tab-item__label">心愿</span>
            </button>
            <button onclick="actions.setTab('me')" class="tab-item ${activeTab === 'me' ? 'tab-item--active' : ''}">
                <i data-lucide="user"></i>
                <span class="tab-item__label">我的</span>
            </button>
        </div>
    `
};

// --- 视图模板 ---

function renderSplash() {
    return `
        <div class="h-full flex flex-col items-center justify-center p-4 onboarding-bg text-center">
            <div class="text-6xl mb-4">🌟</div>
            <h1 class="text-2xl font-bold mb-2 text-white">星辰早晨</h1>
            <p class="text-white/80 mb-6">让成长充满乐趣与成就感</p>
            ${components.Button('首次使用', "actions.navigate('onboarding-register')", 'secondary', 'lg')}
            <p class="mt-4 text-sm text-white/60">已有账户？立即登录</p>
        </div>
    `;
}

function renderRegister() {
    return `
        ${components.Header('首次使用', "actions.navigate('onboarding-splash')")}
        <div class="p-4 flex flex-col h-full">
            <h2 class="text-2xl font-bold mb-6 text-center">创建家庭账户</h2>
            <div class="flex-1 gap-4 flex-col flex">
                <input class="input-field" placeholder="家长邮箱/手机号">
                <input class="input-field" type="password" placeholder="设置密码">
                <input class="input-field" type="password" placeholder="确认密码">
            </div>
            ${components.Button('注册', "actions.navigate('onboarding-family')", 'primary', 'lg')}
        </div>
    `;
}

function renderFamilySetup() {
    return `
        ${components.Header('步骤 2/2', "actions.navigate('onboarding-register')")}
        <div class="p-4 flex flex-col h-full">
            <h2 class="text-2xl font-bold mb-6 text-center">设置您的家庭</h2>
            <div class="flex-1 gap-4 flex-col flex">
                <div>
                    <label class="font-bold ml-1">家庭名称</label>
                    <input class="input-field mt-2" value="快乐星球的家">
                </div>
                <div>
                    <label class="font-bold ml-1">孩子昵称</label>
                    <input class="input-field mt-2" value="小明">
                </div>
            </div>
            ${components.Button('完成并进入', "actions.navigate('select-user')", 'primary', 'lg')}
        </div>
    `;
}

function renderSelectUser() {
    return `
        <div class="p-4 flex flex-col items-center justify-center h-full">
            <h1 class="text-2xl font-bold mb-6">请选择使用者</h1>
            <div class="w-full gap-4 flex-col flex">
                ${components.Card(`
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-2xl">👨</div>
                        <div>
                            <div class="font-bold">爸爸/妈妈</div>
                            <div class="text-xs text-muted">家长端 (管理模式)</div>
                        </div>
                    </div>
                `, "actions.navigate('parent-home')")}
                
                ${components.Card(`
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-2xl">👧</div>
                        <div>
                            <div class="font-bold">${state.data.child.name}</div>
                            <div class="text-xs text-muted">孩子端 (Lv.${state.data.child.level})</div>
                        </div>
                    </div>
                `, "actions.navigate('child-home')")}
            </div>
        </div>
    `;
}

function renderChildHome() {
    const xpPercent = (state.data.child.xp / state.data.child.maxXp) * 100;
    
    let contentHtml = '';
    if (state.activeTab === 'tasks') {
        const completedCount = state.data.tasks.filter(t => t.status === 'completed').length;
        contentHtml = `
            <div class="p-4">
                <div class="bg-white rounded-lg p-4 mb-4 shadow-sm">
                    <div class="flex justify-between items-center mb-2">
                        <h2 class="font-bold">2025年 10月</h2>
                        <span class="text-xs text-muted">今日</span>
                    </div>
                    <div class="flex justify-between text-center text-xs text-muted">
                        ${[12,13,14,15,16,17,18].map(day => `
                            <div onclick="actions.setSelectedDate('2025-10-${day}')" class="${day===14 ? 'bg-gray-800 text-white rounded-md p-1' : ''} cursor-pointer">
                                ${day}
                                ${state.data.history[`2025-10-${day}`] && day!==14 ? '<div class="w-1 h-1 bg-yellow-400 rounded-full mx-auto"></div>' : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <h2 class="font-bold text-lg mb-2">✅ 今日待办 (${completedCount}/${state.data.tasks.length})</h2>
                <div class="flex flex-col gap-2">
                    ${state.data.tasks.map(task => components.Card(`
                        <div class="flex justify-between items-center">
                            <div class="${task.status === 'completed' ? 'opacity-50' : ''}">
                                <div class="font-bold ${task.status === 'completed' ? 'line-through' : ''}">${task.title}</div>
                                <div class="text-xs text-muted flex gap-2 mt-1">
                                    <span>⏰ ${task.duration}分</span>
                                    <span class="text-yellow-600">💰 +${task.coins}</span>
                                    <span class="text-purple-600">⭐ +${task.xp}</span>
                                </div>
                            </div>
                            ${task.status === 'pending' 
                                ? components.Button('开始', `actions.openTaskModal('${task.id}')`, 'primary', 'sm')
                                : '<div class="text-green-600 font-bold text-sm"><i data-lucide="check" class="w-4 h-4 inline"></i> 完成</div>'
                            }
                        </div>
                    `, null, task.status==='completed' ? 'border-l-4 border-green-500' : 'border-l-4 border-blue-500')).join('')}
                </div>
            </div>
        `;
    } else if (state.activeTab === 'wishes') {
        const savingPercent = Math.round((state.data.wishes.saving.current / state.data.wishes.saving.target) * 100);
        contentHtml = `
            <div class="p-4">
                <div class="bg-gray-800 text-white rounded-xl p-4 mb-4 relative overflow-hidden">
                    <div class="relative z-10">
                        <div class="flex justify-between mb-2">
                            <h2 class="font-bold text-lg">${state.data.wishes.saving.icon} ${state.data.wishes.saving.title}</h2>
                            <span class="text-2xl font-bold text-green-400">${savingPercent}%</span>
                        </div>
                        <div class="progress-track mb-2">
                            <div class="progress-fill" style="width: ${savingPercent}%"></div>
                        </div>
                        <div class="flex justify-between text-xs text-gray-400 mb-4">
                            <span>已存: ${state.data.wishes.saving.current}</span>
                            <span>目标: ${state.data.wishes.saving.target}</span>
                        </div>
                        ${components.Button('<i data-lucide="wallet" class="mr-2"></i> 存入金币', "actions.toggleDepositModal(true)", 'accent', 'md')}
                    </div>
                </div>

                <h2 class="font-bold text-lg mb-2">🛍️ 心愿商店</h2>
                <div class="flex flex-wrap gap-2">
                    ${state.data.wishes.shop.map(item => components.Card(`
                        <div class="text-center">
                            <div class="text-3xl mb-1">${item.icon}</div>
                            <div class="font-bold text-sm">${item.title}</div>
                            <div class="text-yellow-600 font-bold">💰 ${item.cost}</div>
                            <div class="text-xs text-muted">库存: ${item.stock}</div>
                        </div>
                    `, `actions.redeemItem('${item.id}')`, 'w-[48%]')).join('')}
                </div>
            </div>
        `;
    } else if (state.activeTab === 'me') {
        contentHtml = `
            <div class="p-4">
                ${components.Card(`
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 bg-purple-500 text-white rounded-full flex items-center justify-center"><i data-lucide="crown"></i></div>
                            <div>
                                <div class="font-bold text-purple-900">特权中心</div>
                                <div class="text-xs text-purple-600">点数: ${state.data.child.privilegePoints}</div>
                            </div>
                        </div>
                        <i data-lucide="chevron-right" class="text-purple-500"></i>
                    </div>
                `, "actions.navigate('child-privileges')", 'bg-purple-50 mb-4')}

                <div class="flex justify-between items-end mb-2">
                    <h2 class="font-bold">🏅 成就殿堂</h2>
                </div>
                <div class="flex flex-wrap gap-2">
                    ${state.data.achievements.map(ach => `
                        <div onclick="actions.setSelectedAchievement('${ach.id}')" class="w-[31%] aspect-square rounded-xl flex flex-col items-center justify-center p-2 cursor-pointer ${ach.unlocked ? 'bg-white border border-yellow-100' : 'bg-gray-100 opacity-60 grayscale'}">
                            <div class="text-2xl mb-1">${ach.icon}</div>
                            <div class="text-[10px] font-bold text-center">${ach.title}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    return `
        <div class="bg-white p-4 pb-2 border-b">
            <div class="flex justify-between items-end mb-2">
                <div class="flex items-center gap-2" onclick="actions.navigate('select-user')">
                    <div class="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center text-lg">👧</div>
                    <div>
                        <div class="font-bold">${state.data.child.name}</div>
                        <div class="text-xs text-blue-600 bg-blue-50 px-2 rounded-full">Lv.${state.data.child.level}</div>
                    </div>
                </div>
                <div class="font-black text-yellow-500 text-xl flex items-center">
                    <span class="w-5 h-5 bg-yellow-400 text-white rounded-full text-xs flex items-center justify-center mr-1">¥</span>
                    ${state.data.child.coins}
                </div>
            </div>
            <div class="progress-track h-3">
                <div class="progress-fill" style="width: ${xpPercent}%"></div>
            </div>
        </div>

        <div class="scroll-area">
            ${contentHtml}
        </div>
        ${components.TabBar(state.activeTab)}
    `;
}

function renderChildPrivileges() {
    return `
        ${components.Header('特权中心', "actions.navigate('child-home')")}
        <div class="p-4 scroll-area bg-purple-50">
            <div class="text-center py-6">
                <div class="text-sm text-muted uppercase font-bold">可用点数</div>
                <div class="text-4xl font-black text-purple-600 mt-2">${state.data.child.privilegePoints}</div>
            </div>
            <div class="flex flex-col gap-3">
                ${state.data.privileges.map(priv => components.Card(`
                    <div class="flex justify-between items-center">
                        <div>
                            <div class="font-bold">${priv.title}</div>
                            <div class="text-xs text-muted">${priv.desc}</div>
                        </div>
                        ${components.Button(`${priv.cost} 点`, `actions.redeemPrivilege('${priv.id}')`, state.data.child.privilegePoints >= priv.cost ? 'primary' : 'ghost', 'sm', state.data.child.privilegePoints < priv.cost)}
                    </div>
                `)).join('')}
            </div>
        </div>
    `;
}

function renderParentHome() {
    return `
        ${components.Header('家长模式', null, `<button onclick="actions.navigate('select-user')" class="text-xs font-bold text-blue-600">切换</button>`)}
        <div class="p-4 scroll-area">
            <div class="flex gap-2 mb-4 text-center">
                ${['本周任务|35', '完成率|86%', '准时率|72%'].map(item => {
                    const [label, val] = item.split('|');
                    return components.Card(`
                        <div class="text-xs text-muted mb-1">${label}</div>
                        <div class="font-black text-gray-800 text-xl">${val}</div>
                    `, null, 'flex-1 py-4');
                }).join('')}
            </div>

            <h2 class="font-bold text-red-600 mb-2 flex items-center gap-2">
                <i data-lucide="lock" class="w-4 h-4"></i> 待审核任务
            </h2>
            ${state.data.pendingReviews.length > 0 ? state.data.pendingReviews.map(r => components.Card(`
                <div class="flex justify-between items-start">
                    <div>
                        <div class="font-bold">${r.title}</div>
                        <div class="text-xs text-muted mt-1">${r.childName} | 耗时: ${r.time}</div>
                    </div>
                    <div class="flex gap-2">
                        <button class="text-red-600 font-bold text-xs bg-red-100 p-2 rounded">打回</button>
                        <button onclick="actions.approveTask('${r.id}')" class="text-white font-bold text-xs bg-green-500 p-2 rounded">通过</button>
                    </div>
                </div>
            `, null, 'bg-red-50 mb-2')).join('') : '<div class="text-center py-8 text-muted border-2 border-dashed rounded-xl mb-4">暂无待审核任务</div>'}

            <div class="grid grid-cols-2 gap-3 pt-4">
                ${components.Button('<div class="flex flex-col items-center gap-2"><i data-lucide="clipboard-list" class="w-6 h-6"></i>任务管理</div>', "actions.navigate('parent-tasks')", 'secondary', 'lg', false, 'h-24')}
                ${components.Button('<div class="flex flex-col items-center gap-2"><i data-lucide="gift" class="w-6 h-6"></i>心愿管理</div>', "", 'secondary', 'lg', false, 'h-24')}
                ${components.Button('<div class="flex flex-col items-center gap-2"><i data-lucide="users" class="w-6 h-6"></i>家庭管理</div>', "", 'secondary', 'lg', false, 'h-24')}
                ${components.Button('<div class="flex flex-col items-center gap-2"><i data-lucide="crown" class="w-6 h-6"></i>特权设置</div>', "", 'secondary', 'lg', false, 'h-24')}
            </div>
        </div>
    `;
}

function renderParentTasks() {
    return `
        ${components.Header('任务管理', "actions.navigate('parent-home')", '<i data-lucide="plus" class="text-blue-600"></i>')}
        <div class="p-4 scroll-area">
            ${state.data.tasks.map(task => components.Card(`
                <div class="flex justify-between items-center">
                    <div>
                        <div class="font-bold">${task.title}</div>
                        <div class="text-xs text-muted">${task.category} | ${task.coins}币 | ${task.duration}分</div>
                    </div>
                    <div class="flex gap-2 text-sm text-gray-400">
                        <button>编辑</button>
                        <button>删除</button>
                    </div>
                </div>
            `, null, 'mb-2')).join('')}
        </div>
    `;
}

// --- 弹窗渲染 ---

function renderModals() {
    let html = '';

    // 任务详情弹窗
    if (state.showTaskModal) {
        html += `
            <div class="modal-overlay">
                <div class="modal-content p-6 text-center">
                    <div class="text-6xl mb-4">⏱️</div>
                    <h2 class="text-xl font-bold mb-2">${state.showTaskModal.title}</h2>
                    <p class="text-muted mb-6">预计耗时: ${state.showTaskModal.duration}分钟</p>
                    <div class="bg-blue-50 p-4 rounded-xl mb-6 flex justify-around">
                        <div>
                            <div class="text-xs text-muted uppercase">奖励金币</div>
                            <div class="text-xl font-black text-yellow-600">+${state.showTaskModal.coins}</div>
                        </div>
                        <div>
                            <div class="text-xs text-muted uppercase">奖励经验</div>
                            <div class="text-xl font-black text-purple-600">+${state.showTaskModal.xp}</div>
                        </div>
                    </div>
                    ${components.Button('完成任务', 'actions.completeTask()', 'primary', 'lg')}
                    <button onclick="actions.closeTaskModal()" class="mt-4 text-muted text-sm">取消</button>
                </div>
            </div>
        `;
    }

    // 存钱弹窗
    if (state.showDepositModal) {
        html += `
            <div class="modal-overlay">
                <div class="modal-content p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="font-bold text-lg">存入储蓄罐</h3>
                        <button onclick="actions.toggleDepositModal(false)"><i data-lucide="x"></i></button>
                    </div>
                    <p class="text-muted text-sm mb-2">当前余额: <span class="font-bold text-yellow-600">${state.data.child.coins}</span></p>
                    <input 
                        type="number" 
                        value="${state.depositAmount}"
                        oninput="actions.setDepositAmount(this.value)"
                        class="input-field text-3xl font-bold text-center mb-4"
                        placeholder="0"
                    >
                    <div class="flex gap-2 mb-4">
                        ${[10, 50, 100].map(amt => `
                            <button onclick="actions.setDepositAmount('${amt}')" class="flex-1 bg-gray-100 py-2 rounded font-bold text-muted text-xs">+${amt}</button>
                        `).join('')}
                    </div>
                    ${components.Button('确认存入', 'actions.deposit()', 'primary', 'lg')}
                </div>
            </div>
        `;
    }

    // 成就弹窗
    if (state.selectedAchievement) {
        const ach = state.selectedAchievement;
        html += `
            <div class="modal-overlay">
                <div class="modal-content p-6 text-center">
                    <div class="flex justify-end"><button onclick="actions.setSelectedAchievement(null)"><i data-lucide="x"></i></button></div>
                    <div class="text-6xl mb-4 ${!ach.unlocked ? 'grayscale opacity-50' : ''}">${ach.icon}</div>
                    <h2 class="text-xl font-bold mb-2">${ach.title}</h2>
                    <p class="bg-gray-50 p-3 rounded-lg inline-block text-sm text-muted mb-4">${ach.desc}</p>
                    <div>
                        ${ach.unlocked 
                            ? `<span class="text-xs text-green-600 font-bold bg-green-50 py-1 px-3 rounded-full">获得于: ${ach.date}</span>`
                            : `<span class="text-xs text-muted">加油！继续努力！</span>`
                        }
                    </div>
                </div>
            </div>
        `;
    }

    // 日历复盘 (BottomSheet 模拟)
    if (state.selectedDate) {
        const history = state.data.history[state.selectedDate];
        html += `
            <div class="modal-overlay" style="align-items: flex-end;">
                <div class="bg-white w-full rounded-t-2xl p-4 animation-slide-up">
                    <div class="flex justify-between items-center mb-4 border-b pb-2">
                        <h3 class="font-bold">${state.selectedDate.slice(5)} 复盘</h3>
                        <button onclick="actions.setSelectedDate(null)"><i data-lucide="x"></i></button>
                    </div>
                    ${history ? `
                        <div class="bg-blue-50 p-4 rounded-xl flex items-center justify-between mb-4">
                            <span class="text-blue-800 font-bold">当日总收益</span>
                            <span class="text-2xl font-black text-yellow-600">+${history.coins} 💰</span>
                        </div>
                        <div class="flex flex-col gap-2">
                            ${history.tasks.map(t => `
                                <div class="flex justify-between p-3 bg-gray-50 rounded-lg">
                                    <span>${t.title}</span>
                                    <span class="text-green-600 font-bold">+${t.coins}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="text-center py-8 text-muted">这一天没有记录哦</div>'}
                </div>
            </div>
        `;
    }

    return html;
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    render();
});
