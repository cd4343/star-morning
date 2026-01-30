import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '../../components/Layout';
import { Header } from '../../components/Header';
import api from '../../services/api';

interface PunishmentSettings {
  enabled: boolean;
  mildName: string;
  mildRate: number;
  mildMin: number;
  mildMax: number;
  moderateName: string;
  moderateRate: number;
  moderateMin: number;
  moderateMax: number;
  severeName: string;
  severeRate: number;
  severeExtra: number;
  severeMax: number;
  customName: string;
  customMin: number;
  customMax: number;
  allowNegative: boolean;
  negativeLimit: number;
  notifyChild: boolean;
  requireReason: boolean;
}

const ParentPunishment = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<PunishmentSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const res = await api.get('/parent/punishment-settings');
      setSettings(res.data);
    } catch (error) {
      console.error('加载设置失败:', error);
      setMessage('加载设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    
    setSaving(true);
    setMessage('');
    
    try {
      await api.put('/parent/punishment-settings', settings);
      setMessage('✅ 设置已保存');
      setTimeout(() => {
        setMessage('');
        navigate('/parent/dashboard');
      }, 1500);
    } catch (error) {
      console.error('保存设置失败:', error);
      setMessage('❌ 保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const confirmed = window.confirm('确定要恢复默认设置吗？');
    if (!confirmed) return;
    
    setSettings({
      enabled: false,
      mildName: '轻度警告',
      mildRate: 0.3,
      mildMin: 2,
      mildMax: 10,
      moderateName: '中度惩罚',
      moderateRate: 0.5,
      moderateMin: 5,
      moderateMax: 20,
      severeName: '严重惩罚',
      severeRate: 1.0,
      severeExtra: 5,
      severeMax: 50,
      customName: '自定义扣除',
      customMin: 1,
      customMax: 100,
      allowNegative: true,
      negativeLimit: -10,
      notifyChild: true,
      requireReason: true
    });
    setMessage('已恢复默认设置，请点击保存生效');
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p>加载中...</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={{ padding: '20px' }}>
        <p>无法加载设置</p>
        <button onClick={loadSettings}>重试</button>
      </div>
    );
  }

  return (
    <Layout>
      <Header title="惩罚设置" />
      
      <div className="p-4 space-y-6 overflow-y-auto flex-1 pb-10" style={{ maxHeight: 'calc(100vh - 60px)' }}>
      
      <div style={{ 
        backgroundColor: '#fff3cd', 
        padding: '15px', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #ffeeba'
      }}>
        <strong>⚠️ 使用提示：</strong>
        <ul style={{ margin: '10px 0', paddingLeft: '20px' }}>
          <li>惩罚功能用于处理严重超时或态度极差的情况</li>
          <li>建议正向激励为主，惩罚为辅</li>
          <li>惩罚前请与孩子沟通原因</li>
          <li>首次违规可先警告，再次才执行惩罚</li>
        </ul>
      </div>

      {message && (
        <div style={{ 
          padding: '10px', 
          marginBottom: '20px',
          backgroundColor: message.includes('✅') ? '#d4edda' : '#f8d7da',
          color: message.includes('✅') ? '#155724' : '#721c24',
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          {message}
        </div>
      )}

      <div style={{ marginBottom: '30px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '16px', fontWeight: 'bold' }}>
          <input 
            type="checkbox" 
            checked={settings.enabled}
            onChange={(e) => setSettings({...settings, enabled: e.target.checked})}
            style={{ width: '20px', height: '20px' }}
          />
          启用惩罚功能
        </label>
      </div>

      <div style={{ 
        opacity: settings.enabled ? 1 : 0.5, 
        pointerEvents: settings.enabled ? 'auto' : 'none' 
      }}>
        
        {/* 轻度警告 */}
        <div style={{ 
          backgroundColor: '#fff9e6', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '20px',
          border: '2px solid #ffeb3b'
        }}>
          <h3 style={{ color: '#f57c00', marginTop: 0 }}>🟡 {settings.mildName}</h3>
          <p style={{ color: '#666', marginBottom: '15px' }}>适用于：态度一般、轻微马虎</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>扣除比例（%）</label>
              <input 
                type="number" 
                value={settings.mildRate * 100}
                onChange={(e) => setSettings({...settings, mildRate: parseFloat(e.target.value) / 100})}
                min="0" max="100" step="5"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>最少扣除（金币）</label>
              <input 
                type="number" 
                value={settings.mildMin}
                onChange={(e) => setSettings({...settings, mildMin: parseInt(e.target.value)})}
                min="1" max="50"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>最多扣除（金币）</label>
              <input 
                type="number" 
                value={settings.mildMax}
                onChange={(e) => setSettings({...settings, mildMax: parseInt(e.target.value)})}
                min="1" max="100"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
          </div>
          
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff', borderRadius: '6px' }}>
            <strong>示例：</strong>10金币任务 → 扣 {Math.max(settings.mildMin, Math.min(settings.mildMax, Math.round(10 * settings.mildRate)))} 金币
          </div>
        </div>

        {/* 中度惩罚 */}
        <div style={{ 
          backgroundColor: '#fff0e6', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '20px',
          border: '2px solid #ff9800'
        }}>
          <h3 style={{ color: '#e65100', marginTop: 0 }}>🟠 {settings.moderateName}</h3>
          <p style={{ color: '#666', marginBottom: '15px' }}>适用于：态度较差、轻微超时</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>扣除比例（%）</label>
              <input 
                type="number" 
                value={settings.moderateRate * 100}
                onChange={(e) => setSettings({...settings, moderateRate: parseFloat(e.target.value) / 100})}
                min="0" max="100" step="5"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>最少扣除（金币）</label>
              <input 
                type="number" 
                value={settings.moderateMin}
                onChange={(e) => setSettings({...settings, moderateMin: parseInt(e.target.value)})}
                min="1" max="50"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>最多扣除（金币）</label>
              <input 
                type="number" 
                value={settings.moderateMax}
                onChange={(e) => setSettings({...settings, moderateMax: parseInt(e.target.value)})}
                min="1" max="100"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
          </div>
          
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff', borderRadius: '6px' }}>
            <strong>示例：</strong>20金币任务 → 扣 {Math.max(settings.moderateMin, Math.min(settings.moderateMax, Math.round(20 * settings.moderateRate)))} 金币
          </div>
        </div>

        {/* 严重惩罚 */}
        <div style={{ 
          backgroundColor: '#ffe6e6', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '20px',
          border: '2px solid #f44336'
        }}>
          <h3 style={{ color: '#c62828', marginTop: 0 }}>🔴 {settings.severeName}</h3>
          <p style={{ color: '#666', marginBottom: '15px' }}>适用于：态度极差、严重超时</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>扣除比例（%）</label>
              <input 
                type="number" 
                value={settings.severeRate * 100}
                onChange={(e) => setSettings({...settings, severeRate: parseFloat(e.target.value) / 100})}
                min="0" max="100" step="10"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>额外扣除（金币）</label>
              <input 
                type="number" 
                value={settings.severeExtra}
                onChange={(e) => setSettings({...settings, severeExtra: parseInt(e.target.value)})}
                min="0" max="50"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>最多扣除（金币）</label>
              <input 
                type="number" 
                value={settings.severeMax}
                onChange={(e) => setSettings({...settings, severeMax: parseInt(e.target.value)})}
                min="1" max="200"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
          </div>
          
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff', borderRadius: '6px' }}>
            <strong>示例：</strong>20金币任务 → 扣 {Math.min(settings.severeMax, Math.round(20 * settings.severeRate) + settings.severeExtra)} 金币
          </div>
        </div>

        {/* 自定义扣除 */}
        <div style={{ 
          backgroundColor: '#f3e5f5', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '20px',
          border: '2px solid #9c27b0'
        }}>
          <h3 style={{ color: '#7b1fa2', marginTop: 0 }}>🟣 {settings.customName ?? '自定义扣除'}</h3>
          <p style={{ color: '#666', marginBottom: '15px' }}>适用于：需要按具体金额扣除的情况，审核时手动输入扣除金币数</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>显示名称</label>
              <input 
                type="text" 
                value={settings.customName ?? '自定义扣除'}
                onChange={(e) => setSettings({...settings, customName: e.target.value})}
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>最小扣除（金币）</label>
              <input 
                type="number" 
                value={settings.customMin ?? 1}
                onChange={(e) => setSettings({...settings, customMin: parseInt(e.target.value) || 1})}
                min="0" max="999"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>最大扣除（金币）</label>
              <input 
                type="number" 
                value={settings.customMax ?? 100}
                onChange={(e) => setSettings({...settings, customMax: parseInt(e.target.value) || 100})}
                min="1" max="999"
                style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
            </div>
          </div>
          <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#fff', borderRadius: '6px' }}>
            <strong>说明：</strong>审核时选择「自定义」后，输入扣除金额（{settings.customMin ?? 1}～{settings.customMax ?? 100} 金币）
          </div>
        </div>

        {/* 保护设置 */}
        <div style={{ 
          backgroundColor: '#e3f2fd', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '20px',
          border: '2px solid #2196f3'
        }}>
          <h3 style={{ color: '#1976d2', marginTop: 0 }}>🛡️ 保护设置</h3>
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input 
                type="checkbox" 
                checked={settings.allowNegative}
                onChange={(e) => setSettings({...settings, allowNegative: e.target.checked})}
                style={{ width: '18px', height: '18px' }}
              />
              <span>允许金币为负数（可还债）</span>
            </label>
          </div>
          
          {settings.allowNegative && (
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>金币最低限制</label>
              <input 
                type="number" 
                value={settings.negativeLimit}
                onChange={(e) => setSettings({...settings, negativeLimit: parseInt(e.target.value)})}
                max="-1" step="5"
                style={{ width: '200px', padding: '8px', borderRadius: '6px', border: '1px solid #ddd' }}
              />
              <span style={{ marginLeft: '10px', color: '#666' }}>金币</span>
              <p style={{ color: '#666', fontSize: '14px', marginTop: '5px' }}>
                金币不会低于此数值，建议设置为 -10 到 -50 之间
              </p>
            </div>
          )}
        </div>

        {/* 通知设置 */}
        <div style={{ 
          backgroundColor: '#f1f8e9', 
          padding: '20px', 
          borderRadius: '12px', 
          marginBottom: '20px',
          border: '2px solid #8bc34a'
        }}>
          <h3 style={{ color: '#558b2f', marginTop: 0 }}>📢 通知设置</h3>
          
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input 
                type="checkbox" 
                checked={settings.notifyChild}
                onChange={(e) => setSettings({...settings, notifyChild: e.target.checked})}
                style={{ width: '18px', height: '18px' }}
              />
              <span>扣金币时通知孩子</span>
            </label>
            <p style={{ color: '#666', fontSize: '14px', marginTop: '5px', marginLeft: '28px' }}>
              建议开启，让孩子了解扣金币的原因
            </p>
          </div>
          
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input 
                type="checkbox" 
                checked={settings.requireReason}
                onChange={(e) => setSettings({...settings, requireReason: e.target.checked})}
                style={{ width: '18px', height: '18px' }}
              />
              <span>扣金币时必须填写原因</span>
            </label>
            <p style={{ color: '#666', fontSize: '14px', marginTop: '5px', marginLeft: '28px' }}>
              建议开启，确保惩罚有理有据
            </p>
          </div>
        </div>

      </div>

        <div className="flex gap-3 mt-6">
          <button 
            onClick={() => navigate('/parent/dashboard')}
            className="flex-1 py-3 bg-gray-100 font-bold text-gray-600 rounded-xl hover:bg-gray-200"
          >
            ← 返回
          </button>
          
          <button 
            onClick={handleSave} 
            disabled={saving}
            className={`flex-1 py-3 font-bold text-white rounded-xl ${
              saving 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-green-500 hover:bg-green-600'
            }`}
          >
            {saving ? '保存中...' : '💾 保存设置'}
          </button>
          
          <button 
            onClick={handleReset}
            className="px-4 py-3 bg-gray-400 font-bold text-white rounded-xl hover:bg-gray-500"
          >
            🔄 默认
          </button>
        </div>
      </div>
    </Layout>
  );
};

export default ParentPunishment;


