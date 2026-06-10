import React from 'react';

interface IntroModalProps {
  onClose: () => void;
}

/**
 * 应用介绍弹窗组件
 * 用于登录/注册页面展示应用功能说明
 */
export const IntroModal: React.FC<IntroModalProps> = ({ onClose }) => (
  <div
    className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="bg-white rounded-3xl max-w-sm w-full flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300"
      style={{ maxHeight: '85vh' }}
      onClick={e => e.stopPropagation()}
    >
      {/* 顶部固定栏 */}
      <div className="p-4 flex justify-end items-center border-b border-gray-50">
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* 可滚动内容区 */}
      <div className="flex-1 overflow-y-auto p-6 pt-2 custom-scrollbar">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4 animate-bounce duration-1000">🌟</div>
          <h2 className="text-2xl font-black text-gray-800">星辰早晨</h2>
          <div className="h-1 w-12 bg-blue-500 mx-auto mt-2 rounded-full"></div>
          <p className="text-xs text-gray-400 mt-2 uppercase tracking-widest font-bold">家庭成长激励系统</p>
        </div>

        <div className="space-y-6 text-sm text-gray-600">
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-5 border border-blue-100">
            <div className="font-bold text-blue-700 mb-2 flex items-center gap-2">
              <span className="text-lg">💡</span> 这是什么？
            </div>
            <p className="leading-relaxed">一个帮助孩子养成好习惯的家庭任务管理应用。家长设置任务和奖励，孩子完成任务获得金币和成就！</p>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-5 border border-green-100">
            <div className="font-bold text-green-700 mb-3 flex items-center gap-2">
              <span className="text-lg">✨</span> 主要功能
            </div>
            <ul className="space-y-2 ml-1">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                <span>任务管理：设置每日/每周任务</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                <span>金币奖励：完成任务获得金币 💰</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                <span>经验等级：积累经验升级成长 ⭐</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                <span>心愿商店：用金币兑换奖励</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                <span>冷静能量站：心情不好时去那里找回平静</span>
              </li>
            </ul>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-fuchsia-50 rounded-2xl p-5 border border-purple-100">
            <div className="font-bold text-purple-700 mb-2 flex items-center gap-2">
              <span className="text-lg">⭐</span> 经验等级系统
            </div>
            <p className="leading-relaxed mb-3">完成任务不仅能获得金币，还能获得经验值！</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/60 p-2 rounded-lg text-[11px]">升级自动解锁</div>
              <div className="bg-white/60 p-2 rounded-lg text-[11px]">每100经验得特权点</div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-5 border border-orange-100">
            <div className="font-bold text-orange-700 mb-3 flex items-center gap-2">
              <span className="text-lg">👨‍👩‍👧</span> 使用步骤
            </div>
            <div className="space-y-3">
              {[
                '家长注册并创建家庭',
                '添加孩子信息',
                '设置任务与商品',
                '孩子完成任务并提交',
                '家长审核并发放奖励'
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-orange-200 text-orange-700 flex items-center justify-center text-xs font-bold">{i+1}</div>
                  <div className="text-gray-700">{step}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 底部固定操作 */}
      <div className="p-6 border-t border-gray-50 bg-gray-50/50">
        <button
          onClick={onClose}
          className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl font-black shadow-lg shadow-blue-100 active:scale-95 transition-transform"
        >
          开启成长之旅
        </button>
      </div>
    </div>
  </div>
);

export default IntroModal;

