import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Award, Camera, CheckCircle2, ChevronDown, ChevronUp, Compass, Edit3, HardDrive, MapPin, Mic, Plus, Search, Sparkles, Trash2, Volume2, X } from 'lucide-react';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import api from '../../services/api';
import { getDateLocale, t } from '../../i18n';
import { useToast } from '../../components/Toast';
import { ExplorePlace, ExploreCheckin, ExploreMedium, ExploreTimelineMonth, EXPLORE_CATEGORIES } from '../../types/explore';

const categories = EXPLORE_CATEGORIES;
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

const formatDate = (value: string) => new Date(value).toLocaleString(getDateLocale(), {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

// 探索改版①：快捷回应短语（点击填入反馈输入框，可再编辑）
const QUICK_REPLY_KEYS = ['explore.quickReply1', 'explore.quickReply2', 'explore.quickReply3', 'explore.quickReply4'];

const formatMonth = (month: string) => {
  const [year, monthIndex] = month.split('-');
  return new Date(Number(year), Number(monthIndex) - 1, 1).toLocaleDateString(getDateLocale(), { year: 'numeric', month: 'long' });
};

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

// B3-2 同款：iOS Safari 兼容——自动检测支持的录音 MIME 类型
const getSupportedMimeType = (): string | null => {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
};

export default function ParentExplore() {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<'places' | 'search' | 'checkins' | 'settings' | 'memories'>('places');
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedMedia, setExpandedMedia] = useState<Record<string, ExploreMedium[]>>({}); // B4-06: 展开的媒体
  const [loadingMedia, setLoadingMedia] = useState<Record<string, boolean>>({});
  // 探索改版①：家长语音回应（按打卡 id 暂存，随确认上传）
  const [voiceReplies, setVoiceReplies] = useState<Record<string, { dataUrl: string; duration: number }>>({});
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const replyRecorder = useRef<MediaRecorder | null>(null);
  const replyChunks = useRef<Blob[]>([]);
  const replyStartedAt = useRef(0);
  const replyDiscarded = useRef(false);
  // 探索改版②：设置面板
  const [quota, setQuota] = useState<{ usedBytes: number; totalBytes: number } | null>(null);
  const [requirePhoto, setRequirePhoto] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [poiUnconfigured, setPoiUnconfigured] = useState(false);
  // 探索改版③：回忆时间线
  const [timeline, setTimeline] = useState<ExploreTimelineMonth[] | null>(null);

  const activePlaces = useMemo(() => places.filter(place => place.status !== 'archived'), [places]);
  const pendingCheckins = useMemo(() => checkins.filter(item => !item.parentConfirmed).length, [checkins]);
  const quotaPercent = quota && quota.totalBytes > 0 ? Math.round((quota.usedBytes / quota.totalBytes) * 100) : 0;

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

  useEffect(() => {
    if (tab === 'settings') {
      api.get('/parent/explore/quota').then(res => setQuota(res.data)).catch(() => {});
      api.get('/parent/explore/settings').then(res => setRequirePhoto(!!res.data?.exploreRequirePhoto)).catch(() => {});
    }
    if (tab === 'memories' && timeline === null) {
      api.get('/parent/explore/timeline').then(res => setTimeline(res.data || [])).catch(() => toast.error('回忆加载失败'));
    }
  }, [tab]);

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
      if (e.response?.data?.configured === false) setPoiUnconfigured(true);
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
      const reply = voiceReplies[item.id];
      if (reply) {
        try {
          await api.post(`/parent/explore/checkins/${item.id}/reply-voice`, { dataUrl: reply.dataUrl, durationSeconds: reply.duration });
          setVoiceReplies(prev => { const next = { ...prev }; delete next[item.id]; return next; });
        } catch (err: any) {
          toast.warning(err.response?.data?.message || t('explore.voiceReplyFailed'));
        }
      }
      toast.success('探索记录已确认');
      await loadData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '确认失败');
    }
  };

  const batchConfirm = async () => {
    if (selectedIds.size === 0) return;
    try {
      await api.post('/parent/explore/checkins/batch-confirm', { checkinIds: Array.from(selectedIds) });
      toast.success(`已确认 ${selectedIds.size} 条探索记录`);
      setSelectedIds(new Set());
      await loadData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '批量确认失败');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // B4-06: 加载/展开打卡媒体
  const toggleMedia = async (checkinId: string) => {
    if (expandedMedia[checkinId]) {
      setExpandedMedia(prev => { const next = { ...prev }; delete next[checkinId]; return next; });
      return;
    }
    setLoadingMedia(prev => ({ ...prev, [checkinId]: true }));
    try {
      const res = await api.get(`/parent/explore/checkins/${checkinId}/media`);
      setExpandedMedia(prev => ({ ...prev, [checkinId]: res.data || [] }));
    } catch {
      toast.error('媒体加载失败');
    } finally {
      setLoadingMedia(prev => ({ ...prev, [checkinId]: false }));
    }
  };

  // 探索改版①：按住录音回应（兼容处理与 ChildExplore 一致）
  const startReplyRecording = async (checkinId: string) => {
    if (recordingFor) return;
    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      toast.warning(t('explore.recordUnsupported'));
      return;
    }
    replyDiscarded.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (replyDiscarded.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      replyChunks.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) replyChunks.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(replyChunks.current, { type: recorder.mimeType || mimeType });
        const duration = Math.max(1, Math.round((Date.now() - replyStartedAt.current) / 1000));
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          if (dataUrl) setVoiceReplies(prev => ({ ...prev, [checkinId]: { dataUrl, duration } }));
        };
        reader.readAsDataURL(blob);
      };
      replyRecorder.current = recorder;
      replyStartedAt.current = Date.now();
      recorder.start();
      setRecordingFor(checkinId);
    } catch {
      toast.error(t('explore.micDenied'));
    }
  };

  const stopReplyRecording = () => {
    // 若 getUserMedia 仍在等待授权，标记丢弃，授权后直接释放麦克风
    replyDiscarded.current = true;
    if (replyRecorder.current && replyRecorder.current.state !== 'inactive') {
      replyRecorder.current.stop();
    }
    setRecordingFor(null);
  };

  const removeVoiceReply = (checkinId: string) => {
    setVoiceReplies(prev => { const next = { ...prev }; delete next[checkinId]; return next; });
  };

  // 探索改版②：照片要求开关
  const toggleRequirePhoto = async () => {
    const next = !requirePhoto;
    setSavingSettings(true);
    try {
      await api.put('/parent/explore/settings', { exploreRequirePhoto: next ? 1 : 0 });
      setRequirePhoto(next);
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-8 max-w-md mx-auto">
      <Header title="家庭探索" showBack onBack={() => navigate('/parent/dashboard')} />
      <div className="p-4 space-y-4">
        <section className="rounded-[1.75rem] bg-gradient-to-br from-slate-900 via-teal-700 to-sky-500 text-white p-5 shadow-lg shadow-sky-100">
          <div className="flex items-center gap-2 text-sm font-black text-white/85">
            <Compass size={18} />
            读万卷书，行万里路
          </div>
          <h2 className="mt-3 text-2xl font-black">给孩子准备真实世界的任务地图</h2>
        </section>

        <div className="grid grid-cols-5 gap-1 rounded-2xl bg-white p-1.5 shadow-sm border border-slate-100">
          <TabButton label="地点" active={tab === 'places'} onClick={() => setTab('places')} />
          <TabButton label="搜索" active={tab === 'search'} onClick={() => setTab('search')} />
          <TabButton label={`待确认${pendingCheckins ? ` ${pendingCheckins}` : ''}`} active={tab === 'checkins'} onClick={() => setTab('checkins')} />
          <TabButton label={t('explore.tabSettings')} active={tab === 'settings'} onClick={() => setTab('settings')} />
          <TabButton label={t('explore.tabMemories')} active={tab === 'memories'} onClick={() => setTab('memories')} />
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
            {poiUnconfigured && (
              <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-xs font-bold text-amber-700 leading-relaxed">
                {t('explore.poiNotConfigured')}
              </div>
            )}
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
            ) : (
              <>
                {checkins.filter(item => !item.parentConfirmed).length > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={batchConfirm}
                      disabled={selectedIds.size === 0}
                      className="w-full rounded-2xl bg-emerald-500 py-3 text-sm font-black text-white flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <CheckCircle2 size={18} />
                      批量确认（已选 {selectedIds.size} 项）
                    </button>
                  </div>
                )}
                {checkins.map(item => (
                  <div key={item.id} className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        {!item.parentConfirmed && (
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleSelect(item.id)}
                            className="mt-1 h-5 w-5 rounded border-slate-300 text-emerald-500 accent-emerald-500"
                          />
                        )}
                        <div>
                          <div className="font-black text-slate-900">{item.placeTitle}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">{item.childName} · {formatDate(item.checkedInAt)} · {item.mood}</div>
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-black ${item.parentConfirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {item.parentConfirmed ? '已确认' : '待确认'}
                      </span>
                    </div>
                    {item.note && <p className="mt-3 text-sm text-slate-600 leading-relaxed">{item.note}</p>}
                    {/* B4-06: 媒体预览区域 */}
                    <div className="mt-3 space-y-2">
                      <button
                        type="button"
                        onClick={() => toggleMedia(item.id)}
                        className="flex items-center gap-1 text-xs font-bold text-sky-600 hover:text-sky-700"
                      >
                        {loadingMedia[item.id] ? '加载中...' : (
                          <>
                            {expandedMedia[item.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            照片/语音 {item.mediaCount || 0} 条
                          </>
                        )}
                      </button>
                      {expandedMedia[item.id] && (
                        <div className="space-y-2">
                          {expandedMedia[item.id].filter((m: ExploreMedium) => m.type === 'image').length > 0 && (
                            <div className="flex gap-2 flex-wrap">
                              {expandedMedia[item.id].filter((m: ExploreMedium) => m.type === 'image').map((m: ExploreMedium) => (
                                <a key={m.id} href={m.filePath} target="_blank" rel="noopener noreferrer">
                                  <img src={m.filePath} alt="探索照片" className="w-20 h-20 rounded-xl object-cover border border-slate-100 hover:opacity-80 transition-opacity" />
                                </a>
                              ))}
                            </div>
                          )}
                          {expandedMedia[item.id].filter((m: ExploreMedium) => m.type === 'audio').map((m: ExploreMedium) => (
                            <div key={m.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                              <Volume2 size={16} className="text-slate-500" />
                              <audio src={m.filePath} controls preload="none" className="h-8 flex-1" />
                              {m.durationSeconds && <span className="text-xs font-bold text-slate-400">{m.durationSeconds}s</span>}
                            </div>
                          ))}
                          {expandedMedia[item.id].length === 0 && <div className="text-xs text-slate-400">暂无媒体</div>}
                        </div>
                      )}
                    </div>
                    {!item.parentConfirmed && !selectedIds.has(item.id) && (
                      <div className="mt-3 space-y-2">
                        {/* 探索改版①a：快捷回应短语 */}
                        <div className="flex gap-2 flex-wrap">
                          {QUICK_REPLY_KEYS.map(key => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => setConfirmNote(prev => ({ ...prev, [item.id]: t(key) }))}
                              className="rounded-full bg-sky-50 border border-sky-100 px-3 py-2 text-xs font-black text-sky-700"
                            >
                              {t(key)}
                            </button>
                          ))}
                        </div>
                        <input
                          value={confirmNote[item.id] || ''}
                          onChange={event => setConfirmNote(prev => ({ ...prev, [item.id]: event.target.value }))}
                          placeholder="给孩子一句确认反馈，可不填"
                          className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-emerald-400"
                        />
                        {/* 探索改版①b：按住录音回应，录完可试听可删除，随确认一起上传 */}
                        {voiceReplies[item.id] ? (
                          <div className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
                            <Volume2 size={16} className="text-slate-500 shrink-0" />
                            <audio src={voiceReplies[item.id].dataUrl} controls preload="none" className="h-8 min-w-0 flex-1" />
                            <span className="shrink-0 text-xs font-bold text-slate-400">{voiceReplies[item.id].duration}s</span>
                            <button type="button" onClick={() => removeVoiceReply(item.id)} className="shrink-0 text-xs font-black text-red-500">
                              {t('common.delete')}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onPointerDown={() => startReplyRecording(item.id)}
                            onPointerUp={stopReplyRecording}
                            onPointerLeave={() => { if (recordingFor === item.id) stopReplyRecording(); }}
                            onContextMenu={event => event.preventDefault()}
                            className={`w-full rounded-2xl py-3 text-sm font-black flex items-center justify-center gap-2 select-none touch-none ${recordingFor === item.id ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-white border border-slate-200 text-slate-600'}`}
                          >
                            <Mic size={16} />
                            {recordingFor === item.id ? t('explore.releaseToFinish') : t('explore.holdToRecord')}
                          </button>
                        )}
                        <button type="button" onClick={() => confirmCheckin(item)} className="w-full rounded-2xl bg-emerald-500 py-3 text-sm font-black text-white flex items-center justify-center gap-2">
                          <CheckCircle2 size={18} />
                          确认这次探索
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </section>
        )}

        {tab === 'settings' && (
          <section className="space-y-3">
            {/* 探索改版②：配额可视化 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <HardDrive size={18} className="text-sky-500" />
                {t('explore.quotaTitle')}
              </div>
              {quota ? (
                <>
                  <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${quotaPercent >= 95 ? 'bg-red-500' : quotaPercent >= 80 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, quotaPercent)}%` }}
                    />
                  </div>
                  <div className="text-xs font-bold text-slate-500">
                    {t('explore.quotaUsed', { used: formatBytes(quota.usedBytes), total: formatBytes(quota.totalBytes), percent: quotaPercent })}
                  </div>
                </>
              ) : (
                <div className="text-xs font-bold text-slate-400">{t('common.loading')}</div>
              )}
            </div>

            {/* 探索改版②：照片要求开关 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-black text-slate-900 flex items-center gap-2">
                  <Camera size={18} className="text-emerald-500" />
                  {t('explore.requirePhotoTitle')}
                </div>
                <p className="mt-1 text-xs font-bold text-slate-500 leading-relaxed">{t('explore.requirePhotoDesc')}</p>
              </div>
              <button
                type="button"
                onClick={toggleRequirePhoto}
                disabled={savingSettings}
                aria-pressed={requirePhoto}
                className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${requirePhoto ? 'bg-emerald-500' : 'bg-slate-200'}`}
              >
                <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${requirePhoto ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* 探索改版②：探索成就入口 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <Award size={18} className="text-amber-500" />
                {t('explore.achievementsTitle')}
              </div>
              <p className="text-xs font-bold text-slate-500 leading-relaxed">{t('explore.achievementsDesc')}</p>
              <Button fullWidth onClick={() => navigate('/parent/achievements')} className="bg-slate-900 hover:bg-slate-800">
                {t('explore.manageAchievements')}
              </Button>
            </div>
          </section>
        )}

        {tab === 'memories' && (
          <section className="space-y-3">
            {timeline === null ? (
              <div className="rounded-3xl bg-white border border-slate-100 p-8 text-center text-sm font-bold text-slate-400">
                {t('common.loading')}
              </div>
            ) : timeline.length === 0 ? (
              <div className="rounded-3xl bg-white border border-dashed border-slate-200 p-8 text-center text-sm font-bold text-slate-500 leading-relaxed">
                {t('explore.memoriesEmpty')}
              </div>
            ) : timeline.map(group => (
              <div key={group.month} className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-black text-slate-900 text-lg">{formatMonth(group.month)}</div>
                  <span className="shrink-0 rounded-full bg-sky-50 px-2 py-1 text-xs font-black text-sky-700">
                    {t('explore.monthPlaces', { count: group.newPlaceCount })}
                  </span>
                </div>
                <div className="space-y-3">
                  {group.checkins.map(ck => (
                    <div key={ck.id} className="rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-black text-slate-900">{ck.placeTitle}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">
                            {ck.childName} · {formatDate(ck.checkedInAt)}{ck.mood ? ` · ${ck.mood}` : ''}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs font-black text-slate-400">{ck.placeCategory}</span>
                      </div>
                      {ck.note && <p className="text-sm text-slate-600 leading-relaxed">{ck.note}</p>}
                      {ck.media.filter(m => m.type === 'image').length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {ck.media.filter(m => m.type === 'image').map(m => (
                            <a key={m.id} href={m.filePath} target="_blank" rel="noopener noreferrer">
                              <img src={m.filePath} alt="探索照片" className="aspect-square w-full rounded-xl object-cover border border-slate-100" />
                            </a>
                          ))}
                        </div>
                      )}
                      {ck.media.filter(m => m.type === 'audio').map(m => (
                        <div key={m.id} className={`rounded-xl px-3 py-2 ${m.senderRole === 'parent' ? 'bg-rose-50 border border-rose-100' : 'bg-white border border-slate-100'}`}>
                          {m.senderRole === 'parent' && (
                            <div className="mb-1 text-xs font-black text-rose-600">{t('explore.parentReplyCard')}</div>
                          )}
                          <div className="flex items-center gap-2">
                            <Volume2 size={14} className="text-slate-500 shrink-0" />
                            <audio src={m.filePath} controls preload="none" className="h-8 min-w-0 flex-1" />
                          </div>
                        </div>
                      ))}
                      {ck.parentNote && (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs font-bold text-emerald-700">
                          {t('explore.parentSaid')}：{ck.parentNote}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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
      className={`rounded-xl py-2.5 text-xs font-black transition-all ${active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500'}`}
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
