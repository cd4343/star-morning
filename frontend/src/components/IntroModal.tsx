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
    className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" 
    onClick={onClose}
  >
    <div 
      className="bg-white rounded-2xl max-w-sm w-full p-6 max-h-[80vh] overflow-y-auto" 
      onClick={e => e.stopPropagation()}
    >
      <div className="text-center mb-6">
        <div className="text-5xl mb-3">🌟</div>
        <h2 className="text-xl font-bold text-gray-800">星辰早晨</h2>
        <p className="text-sm text-gray-500">家庭成长激励系统</p>
      </div>
      
      <div className="space-y-4 text-sm text-gray-600">
        <div className="bg-blue-50 rounded-xl p-4">
          <div className="font-bold text-blue-700 mb-2">💡 这是什么？</div>
          <p>一个帮助孩子养成好习惯的家庭任务管理应用。家长设置任务和奖励，孩子完成任务获得金币和成就！</p>
        </div>
        
        <div className="bg-green-50 rounded-xl p-4">
          <div className="font-bold text-green-700 mb-2">✨ 主要功能</div>
          <ul className="space-y-1 ml-4 list-disc">
            <li>任务管理：设置每日/每周任务</li>
            <li>金币奖励：完成任务获得金币 💰</li>
            <li>经验等级：积累经验升级成长 ⭐</li>
            <li>心愿商店：用金币兑换奖励</li>
            <li>成就系统：解锁各种成就勋章</li>
            <li>抽奖玩法：金币参与趣味抽奖</li>
          </ul>
        </div>
        
        <div className="bg-purple-50 rounded-xl p-4">
          <div className="font-bold text-purple-700 mb-2">⭐ 经验等级系统</div>
          <p className="text-sm mb-2">完成任务不仅能获得金币，还能获得经验值！</p>
          <ul className="space-y-1 ml-4 list-disc text-sm">
            <li>每完成一个任务获得对应经验</li>
            <li>经验积累到一定值会自动升级</li>
            <li>每100经验还能获得1个特权点</li>
            <li>特权点可以兑换特殊奖励</li>
          </ul>
        </div>
        
        <div className="bg-orange-50 rounded-xl p-4">
          <div className="font-bold text-orange-700 mb-2">👨‍👩‍👧 如何使用？</div>
          <ol className="space-y-1 ml-4 list-decimal">
            <li>家长注册账号并创建家庭</li>
            <li>添加孩子信息</li>
            <li>设置任务、奖励、商品</li>
            <li>孩子完成任务后提交审核</li>
            <li>家长审核通过后发放奖励</li>
          </ol>
        </div>
      </div>
      
      <button 
        onClick={onClose}
        className="w-full mt-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-bold"
      >
        知道了
      </button>
    </div>
  </div>
);

export default IntroModal;

