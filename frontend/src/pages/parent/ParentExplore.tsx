import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, CheckCircle2, Compass, Edit3, MapPin, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import api from '../../services/api';
import { useToast } from '../../components/Toast';

type ExplorePlace = {
  id?: string;
  title: string;
  category: string;
  city?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  source?: string;
  externalId?: string;
  summary?: string;
  whyGo?: string;
  observeTips?: string;
  questionPrompts?: string;
  tags?: string;
  status?: string;
  checkinCount?: number;
};

type ExploreCheckin = {
  id: string;
  placeTitle: string;
  placeCategory: string;
  childName: string;
  mood: string;
  note?: string;
  checkedInAt: string;
  parentConfirmed?: number;
  mediaCount?: number;
};

const categories = ['博物馆', '自然', '公园', '城市', '活动', '旅行', '运动体验', '公益体验', '其他'];
const statusOptions = [
  { label: '计划去', value: 'planned' },
  { label: '想去', value: 'wishlist' },
  { label: '已去过', value: 'visited' }
];

const emptyForm: ExplorePlace = {
  title: '',
  category: '博物馆',
  city: '',
  address: '',
  summary: '',
  whyGo: '',
  observeTips: '',
  questionPrompts: '',
  tags: '',
  status: 'planned',
  source: 'manual'
};

const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

export default function ParentExplore() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<'places' | 'search' | 'checkins'>('places');
  const [places, setPlaces] = useState<ExplorePlace[]>([]);
  const [checkins, setCheckins] = useState<ExploreCheckin[]>([]);
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const [results, setResults] = useState<ExplorePlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<ExplorePlace | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ExplorePlace>(emptyForm);
  const [confirmNote, setConfirmNote] = useState<Record<string, string>>({});

  const activePlaces = useMemo(() => places.filter(place => place.status !== 'archived'), [places]);
  const pendingCheckins = useMemo(() => checkins.filter(item => !item.parentConfirmed).length, [checkins]);

  const loadData = async () => {
    const [placeRes, checkinRes] = await Promise.all([
      api.get('/parent/explore/places'),
      api.get('/parent/explore/checkins')
    ]);
    setPlaces(placeRes.data || []);
    setCheckins(checkinRes.data || []);
  };

  useEffect(() => {
    loadData().catch(() => toast.error('探索数据加载失败'));
  }, []);

  const runSearch = async () => {
    if (!query.trim()) {
      toast.warning('请输入地点、景点或活动名称');
      return;
    }
    setSearching(true);
    try {
      const res = await api.get('/parent/explore/search', { params: { keywords: query, city } });
      setResults(res.data?.places || []);
      if (!res.data?.places?.length) toast.info('没有搜到合适结果，可以手动添加');
    } catch (e: any) {
      toast.warning(e.response?.data?.message || '搜索暂不可用，可先手动添加');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const openForm = (place?: ExplorePlace) => {
    setEditing(place || null);
    setForm(place ? { ...emptyForm, ...place } : emptyForm);
    setShowForm(true);
    setTab('places');
  };

  const addSearchResult = (place: ExplorePlace) => {
    setEditing(null);
    setForm({ ...emptyForm, ...place, status: 'planned' });
    setShowForm(true);
    setTab('places');
  };

  const savePlace = async () => {
    if (!form.title.trim()) {
      toast.warning('请填写地点名称');
      return;
    }
    try {
      if (editing?.id) {
        await api.put(`/parent/explore/places/${editing.id}`, form);
        toast.success('探索地点已更新');
      } else {
        await api.post('/parent/explore/places', form);
        toast.success('探索地点已加入');
      }
      setEditing(null);
      setForm(emptyForm);
      setShowForm(false);
      await loadData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '保存失败');
    }
  };

  const deletePlace = async (place: ExplorePlace) => {
    if (!place.id) return;
    try {
      await api.delete(`/parent/explore/places/${place.id}`);
      toast.success(place.checkinCount ? '已有记录，地点已归档' : '地点已删除');
      await loadData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '删除失败');
    }
  };

  const confirmCheckin = async (item: ExploreCheckin) => {
    try {
      await api.post(`/parent/explore/checkins/${item.id}/confirm`, { parentNote: confirmNote[item.id] || '' });
      toast.success('探索记录已确认');
      await loadData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '确认失败');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <Header title="家庭探索" showBack onBack={() => navigate('/parent/dashboard')} />
      <div className="p-4 space-y-4">
        <section className="rounded-[1.75rem] bg-gradient-to-br from-slate-900 via-teal-700 to-sky-500 text-white p-5 shadow-lg shadow-sky-100">
          <div className="flex items-center gap-2 text-sm font-black text-white/85">
            <Compass size={18} />
            读万卷书，行万里路
          </div>
          <h2 className="mt-3 text-2xl font-black">给孩子准备真实世界的任务地图</h2>
          <p className="mt-2 text-sm font-bold text-white/80 leading-relaxed">
            家长添加地点，孩子查看内容并自行打卡。这里不发金币，主要点亮探索成就和家庭记忆。
          </p>
        </section>

        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white p-2 shadow-sm border border-slate-100">
          <TabButton label={`地点 ${activePlaces.length}`} active={tab === 'places'} onClick={() => setTab('places')} />
          <TabButton label="搜索导入" active={tab === 'search'} onClick={() => setTab('search')} />
          <TabButton label={`待确认 ${pendingCheckins}`} active={tab === 'checkins'} onClick={() => setTab('checkins')} />
        </div>

        {tab === 'search' && (
          <section className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-lg font-black text-slate-900">
              <Search size={20} className="text-sky-500" />
              找一个可以去的地方
            </div>
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="博物馆、公园、科技馆..." className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
              <input value={city} onChange={event => setCity(event.target.value)} placeholder="城市" className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
            </div>
            <Button fullWidth onClick={runSearch} loading={searching} className="bg-sky-600 hover:bg-sky-700">
              搜索地点
            </Button>
            <button type="button" onClick={() => openForm()} className="w-full rounded-2xl border-2 border-dashed border-slate-200 py-3 text-sm font-black text-slate-600">
              手动添加探索地点
            </button>
            <div className="space-y-3">
              {results.map((place, index) => (
                <div key={`${place.externalId || place.title}-${index}`} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-900">{place.title}</div>
                      <div className="mt-1 text-xs font-bold text-slate-500">{place.category} · {place.address || place.city}</div>
                    </div>
                    <button type="button" onClick={() => addSearchResult(place)} className="shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-black text-white">
                      加入
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'places' && (
          <section className="space-y-4">
            <button type="button" onClick={() => openForm()} className="w-full rounded-3xl bg-white border-2 border-dashed border-sky-200 p-4 text-sky-700 font-black flex items-center justify-center gap-2">
              <Plus size={18} />
              新建探索地点
            </button>

            {showForm && (
              <PlaceForm form={form} setForm={setForm} onSave={savePlace} onCancel={() => { setEditing(null); setForm(emptyForm); setShowForm(false); }} />
            )}

            <div className="space-y-3">
              {activePlaces.map(place => (
                <div key={place.id} className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
                  <div className="flex gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-teal-50 flex items-center justify-center text-2xl">
                      <MapPin className="text-teal-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-black text-slate-900 text-lg">{place.title}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">{place.category} · {place.status === 'visited' ? '已去过' : place.status === 'wishlist' ? '想去' : '计划去'}</div>
                        </div>
                        <span className="rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-sky-700">{place.checkinCount || 0} 次</span>
                      </div>
                      {place.summary && <p className="mt-2 text-sm text-slate-600 leading-relaxed">{place.summary}</p>}
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => openForm(place)} className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-600 flex items-center gap-1">
                          <Edit3 size={14} /> 编辑
                        </button>
                        <button type="button" onClick={() => deletePlace(place)} className="rounded-full bg-red-50 px-3 py-2 text-xs font-black text-red-600 flex items-center gap-1">
                          {place.checkinCount ? <Archive size={14} /> : <Trash2 size={14} />}
                          {place.checkinCount ? '归档' : '删除'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'checkins' && (
          <section className="space-y-3">
            {checkins.length === 0 ? (
              <div className="rounded-3xl bg-white border border-dashed border-slate-200 p-8 text-center text-sm font-bold text-slate-500">
                还没有孩子提交探索打卡。
              </div>
            ) : checkins.map(item => (
              <div key={item.id} className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-black text-slate-900">{item.placeTitle}</div>
                    <div className="mt-1 text-xs font-bold text-slate-500">{item.childName} · {formatDate(item.checkedInAt)} · {item.mood}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-black ${item.parentConfirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {item.parentConfirmed ? '已确认' : '待确认'}
                  </span>
                </div>
                {item.note && <p className="mt-3 text-sm text-slate-600 leading-relaxed">{item.note}</p>}
                <div className="mt-3 text-xs font-bold text-slate-400">照片/语音 {item.mediaCount || 0} 条</div>
                {!item.parentConfirmed && (
                  <div className="mt-3 space-y-2">
                    <input
                      value={confirmNote[item.id] || ''}
                      onChange={event => setConfirmNote(prev => ({ ...prev, [item.id]: event.target.value }))}
                      placeholder="给孩子一句确认反馈，可不填"
                      className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                    />
                    <button type="button" onClick={() => confirmCheckin(item)} className="w-full rounded-2xl bg-emerald-500 py-3 text-sm font-black text-white flex items-center justify-center gap-2">
                      <CheckCircle2 size={18} />
                      确认这次探索
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl py-2 text-sm font-black transition-all ${active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500'}`}
    >
      {label}
    </button>
  );
}

function PlaceForm({
  form,
  setForm,
  onSave,
  onCancel
}: {
  form: ExplorePlace;
  setForm: React.Dispatch<React.SetStateAction<ExplorePlace>>;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (key: keyof ExplorePlace, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  return (
    <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-black text-slate-900 flex items-center gap-2">
          <Sparkles size={18} className="text-sky-500" />
          探索地点内容
        </div>
        <button type="button" onClick={onCancel} className="rounded-full bg-slate-100 p-1.5 text-slate-500">
          <X size={16} />
        </button>
      </div>
      <input value={form.title} onChange={event => update('title', event.target.value)} placeholder="地点名称" className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
      <div className="grid grid-cols-2 gap-2">
        <select value={form.category} onChange={event => update('category', event.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400">
          {categories.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={form.status} onChange={event => update('status', event.target.value)} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400">
          {statusOptions.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <input value={form.city || ''} onChange={event => update('city', event.target.value)} placeholder="城市，可选" className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
      <input value={form.address || ''} onChange={event => update('address', event.target.value)} placeholder="地址，可选" className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
      <textarea value={form.summary || ''} onChange={event => update('summary', event.target.value)} placeholder="给孩子看的简短介绍" className="w-full min-h-[72px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
      <textarea value={form.whyGo || ''} onChange={event => update('whyGo', event.target.value)} placeholder="为什么值得去" className="w-full min-h-[72px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
      <textarea value={form.observeTips || ''} onChange={event => update('observeTips', event.target.value)} placeholder="观察提示：让孩子重点看什么" className="w-full min-h-[72px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
      <textarea value={form.questionPrompts || ''} onChange={event => update('questionPrompts', event.target.value)} placeholder="问题引导：回来可以聊什么" className="w-full min-h-[72px] rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400" />
      <Button fullWidth onClick={onSave} className="bg-emerald-500 hover:bg-emerald-600">
        保存地点
      </Button>
    </div>
  );
}
