import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Award, BarChart3, Camera, CheckCircle2, ChevronDown, ChevronUp, Compass, Edit3, Globe, HardDrive, Heart, MapPin, Mic, Plus, Search, Sparkles, Trash2, Volume2, X } from 'lucide-react';
import { Header } from '../../components/Header';
import { Button } from '../../components/Button';
import api from '../../services/api';
import { getDateLocale, t } from '../../i18n';
import { useToast } from '../../components/Toast';
import { ExplorePlace, ExploreCheckin, ExploreMedium, ExploreTimelineMonth, ExploreFeedSettings, ExploreStats, ExploreVisitedPlace, EXPLORE_CATEGORIES, EXPLORE_CATEGORY_ICONS } from '../../types/explore';

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

// P1b：去过的地点清单只显示日期（无时间），更简洁
const formatDay = (value: string) => new Date(value).toLocaleDateString(getDateLocale(), {
  month: 'numeric',
  day: 'numeric'
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
  // 探索地图一期：打卡位置核对开关（单次定位，不追踪）
  const [geoVerify, setGeoVerify] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [poiUnconfigured, setPoiUnconfigured] = useState(false);
  // 探索改版③：回忆时间线
  const [timeline, setTimeline] = useState<ExploreTimelineMonth[] | null>(null);
  // 探索二期：发现推送设置 + 观察统计
  const [feedSettings, setFeedSettings] = useState<ExploreFeedSettings | null>(null);
  const [feedCity, setFeedCity] = useState('');
  const [feedLimit, setFeedLimit] = useState(3);
  const [savingFeed, setSavingFeed] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [addingSource, setAddingSource] = useState(false);
  // Batch3 官方源增强：示例来源 + 选中提示
  const [sourceSuggestions, setSourceSuggestions] = useState<{ label: string; urlTemplate: string; note: string }[]>([]);
  const [sourceHint, setSourceHint] = useState('');
  const [pushUrl, setPushUrl] = useState('');
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);
  const FEED_INP = 'w-full rounded-xl border border-slate-200 px-2.5 py-2 text-xs font-bold outline-none focus:border-rose-300 bg-white';
  const EMPTY_PUSH_FORM = { title: '', summary: '', imageUrl: '', sourceUrl: '', city: '', venue: '', district: '', feedCategory: '', ageMin: '', ageMax: '', activityStart: '', activityEnd: '', signupDeadline: '', price: '', bookingMethod: '', officialUrl: '', recommendReason: '', notes: '', verifyStatus: '未核验', recommendScore: '', validFrom: '', validUntil: '' };
  const [pushForm, setPushForm] = useState(EMPTY_PUSH_FORM);
  const [pushing, setPushing] = useState(false);
  // 探索三期：立即生成今日推荐
  const [generatingNow, setGeneratingNow] = useState(false);
  const [stats, setStats] = useState<ExploreStats | null>(null);
  // P1b：观察统计按孩子筛选（''=全家）+ 孩子列表（孩子选择器）
  const [statsChildId, setStatsChildId] = useState<string>('');
  const [statsChildren, setStatsChildren] = useState<{ id: string; name: string }[]>([]);

  const activePlaces = useMemo(() => places.filter(place => place.status !== 'archived'), [places]);
  const pendingCheckins = useMemo(() => checkins.filter(item => !item.parentConfirmed).length, [checkins]);
  // P1b：去过的地点按规范类型归类罗列（按 EXPLORE_CATEGORIES 顺序，仅显示有数据的类型）
  const visitedByCategory = useMemo(() => {
    const groups: Record<string, ExploreVisitedPlace[]> = {};
    (stats?.visitedPlaces || []).forEach(vp => {
      const cat = (EXPLORE_CATEGORIES as readonly string[]).includes(vp.category) ? vp.category : '其他';
      (groups[cat] ||= []).push(vp);
    });
    return (EXPLORE_CATEGORIES as readonly string[])
      .filter(c => groups[c]?.length)
      .map(c => ({ category: c, places: groups[c] }));
  }, [stats]);
  const quotaPercent = quota && quota.totalBytes > 0 ? Math.round((quota.usedBytes / quota.totalBytes) * 100) : 0;

  const [geocoding, setGeocoding] = useState(false);
  // 地图定位：给"未定位"的地点批量补坐标（尽力而为，失败不影响其它）
  const handleGeocodeMissing = async () => {
    setGeocoding(true);
    try {
      const res = await api.post('/parent/explore/geocode-missing');
      if (res.data?.configured === false) { toast.warning('未配置高德 Web 服务 Key，无法补坐标'); return; }
      const filled = res.data?.filled || 0;
      const remaining = res.data?.remaining || 0;
      toast.success(`已补上 ${filled} 个坐标${remaining ? `，还剩 ${remaining} 个没搜到（可完善地址后再试）` : '，未定位的都搞定了 🎉'}`);
      await loadData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '补坐标失败，请稍后再试');
    } finally {
      setGeocoding(false);
    }
  };

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

  // 探索二期：发现推送设置（城市/条数/关注源/待审核）
  const loadFeedSettings = async () => {
    try {
      const res = await api.get('/parent/explore/feed-settings');
      setFeedSettings(res.data);
      setFeedCity(res.data?.exploreCity || '');
      setFeedLimit(res.data?.exploreFeedDailyLimit || 3);
    } catch { /* 静默：设置区其余部分仍可用 */ }
  };

  useEffect(() => {
    if (tab === 'settings') {
      api.get('/parent/explore/quota').then(res => setQuota(res.data)).catch(() => {});
      api.get('/parent/explore/settings').then(res => {
        setRequirePhoto(!!res.data?.exploreRequirePhoto);
        setGeoVerify(!!res.data?.exploreGeoVerify);
      }).catch(() => {});
      loadFeedSettings();
      if (sourceSuggestions.length === 0) {
        api.get('/parent/explore/feed-sources/suggestions')
          .then(res => setSourceSuggestions(res.data?.suggestions || []))
          .catch(() => {});
      }
      // P1b：加载孩子列表用于"观察统计"孩子选择器（只拉一次）
      if (statsChildren.length === 0) {
        api.get('/auth/members')
          .then(res => setStatsChildren((res.data || []).filter((m: any) => m.role === 'child')))
          .catch(() => {});
      }
    }
    if (tab === 'memories' && timeline === null) {
      api.get('/parent/explore/timeline').then(res => setTimeline(res.data || [])).catch(() => toast.error('回忆加载失败'));
    }
  }, [tab]);

  // P1b：观察统计——进入设置页或切换孩子时按孩子拉取（''=全家）
  useEffect(() => {
    if (tab !== 'settings') return;
    api.get('/parent/explore/stats', statsChildId ? { params: { childId: statsChildId } } : undefined)
      .then(res => setStats(res.data))
      .catch(() => {});
  }, [tab, statsChildId]);

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
        // B2-2 修复：剥离 codecs 参数（audio/webm;codecs=opus → audio/webm），后端按基础 MIME 校验
        const blob = new Blob(replyChunks.current, { type: (recorder.mimeType || mimeType).split(';')[0] });
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

  // 探索地图一期：打卡位置核对开关
  const toggleGeoVerify = async () => {
    const next = !geoVerify;
    setSavingSettings(true);
    try {
      await api.put('/parent/explore/settings', { exploreGeoVerify: next ? 1 : 0 });
      setGeoVerify(next);
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    } finally {
      setSavingSettings(false);
    }
  };

  // 探索二期：保存城市/每日条数
  const saveFeedSettings = async () => {
    setSavingFeed(true);
    try {
      await api.put('/parent/explore/feed-settings', { exploreCity: feedCity, exploreFeedDailyLimit: feedLimit });
      toast.success(t('explore.feedSettingsSaved'));
      await loadFeedSettings();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    } finally {
      setSavingFeed(false);
    }
  };

  // 探索三期：立即生成今日推荐（后端幂等，只补足当日缺口，可重复点）
  const generateFeedNow = async () => {
    setGeneratingNow(true);
    try {
      const res = await api.post('/parent/explore/feed/generate-now');
      toast.success(t('explore.generateNowSuccess', { count: res.data?.insertedCount ?? 0 }));
      await loadFeedSettings();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    } finally {
      setGeneratingNow(false);
    }
  };

  // 探索二期：关注源增删（软删）
  const addFeedSource = async () => {
    if (!sourceUrl.trim()) return;
    setAddingSource(true);
    try {
      await api.post('/parent/explore/feed-sources', { url: sourceUrl.trim(), label: sourceLabel.trim() });
      toast.success(t('explore.feedSourceAdded'));
      setSourceUrl('');
      setSourceLabel('');
      await loadFeedSettings();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    } finally {
      setAddingSource(false);
    }
  };

  const removeFeedSource = async (id: string) => {
    try {
      await api.delete(`/parent/explore/feed-sources/${id}`);
      toast.success(t('explore.feedSourceDeleted'));
      await loadFeedSettings();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    }
  };

  // 探索二期：待审核条目通过/忽略
  const reviewFeedItem = async (id: string, action: 'approve' | 'reject') => {
    try {
      await api.post(`/parent/explore/feed/${id}/${action}`);
      toast.success(action === 'approve' ? t('explore.feedApproved') : t('explore.feedRejected'));
      setFeedSettings(prev => prev ? { ...prev, pendingReview: prev.pendingReview.filter(item => item.id !== id) } : prev);
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    }
  };

  // 探索二期：粘贴链接生成推荐预览（og 标签）
  const previewPushLink = async () => {
    if (!pushUrl.trim()) return;
    setPushPreviewLoading(true);
    try {
      const res = await api.post('/parent/explore/feed/push-link', { url: pushUrl.trim() });
      setPushForm(prev => ({
        ...prev,
        title: res.data?.title || prev.title,
        summary: res.data?.summary || prev.summary,
        imageUrl: res.data?.imageUrl || '',
        sourceUrl: res.data?.sourceUrl || pushUrl.trim(),
        officialUrl: prev.officialUrl || res.data?.sourceUrl || pushUrl.trim()
      }));
    } catch (e: any) {
      toast.warning(e.response?.data?.message || t('toast.operateFailed'));
      setPushForm(prev => ({ ...prev, sourceUrl: pushUrl.trim() }));
    } finally {
      setPushPreviewLoading(false);
    }
  };

  // 探索二期：推送家长推荐卡（孩子端置顶展示）
  const pushFeedCard = async () => {
    if (!pushForm.title.trim()) {
      toast.warning(t('explore.feedPushTitlePlaceholder'));
      return;
    }
    setPushing(true);
    try {
      await api.post('/parent/explore/feed/push', pushForm);
      toast.success(t('explore.feedPushSuccess'));
      setPushUrl('');
      setPushForm(EMPTY_PUSH_FORM);
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    } finally {
      setPushing(false);
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

            {/* 探索地图一期：打卡位置核对开关 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-black text-slate-900 flex items-center gap-2">
                  <MapPin size={18} className="text-sky-500" />
                  {t('explore.geoVerifyTitle')}
                </div>
                <p className="mt-1 text-xs font-bold text-slate-500 leading-relaxed">{t('explore.geoVerifyDesc')}</p>
              </div>
              <button
                type="button"
                onClick={toggleGeoVerify}
                disabled={savingSettings}
                aria-pressed={geoVerify}
                className={`relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50 ${geoVerify ? 'bg-emerald-500' : 'bg-slate-200'}`}
              >
                <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${geoVerify ? 'left-7' : 'left-1'}`} />
              </button>
            </div>

            {/* 探索二期：发现推送设置 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <Sparkles size={18} className="text-violet-500" />
                {t('explore.feedSettingsTitle')}
              </div>
              <p className="text-xs font-bold text-slate-500 leading-relaxed">{t('explore.feedSettingsDesc')}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="mb-1 text-xs font-black text-slate-500">{t('explore.feedCityLabel')}</div>
                  <input
                    value={feedCity}
                    onChange={event => setFeedCity(event.target.value)}
                    placeholder={t('explore.feedCityPlaceholder')}
                    className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-violet-400"
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-black text-slate-500">{t('explore.feedDailyLimitLabel')}</div>
                  <select
                    value={feedLimit}
                    onChange={event => setFeedLimit(Number(event.target.value))}
                    className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-violet-400"
                  >
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <Button fullWidth onClick={saveFeedSettings} loading={savingFeed} className="bg-violet-600 hover:bg-violet-700">
                {t('explore.feedSaveSettings')}
              </Button>
              <Button fullWidth onClick={generateFeedNow} loading={generatingNow} className="bg-slate-900 hover:bg-slate-800">
                {t('explore.generateNow')}
              </Button>
              {feedSettings && feedSettings.poiEnabled === false && (
                <div className="rounded-2xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs font-bold text-amber-700 leading-relaxed">
                  {t('explore.poiKeyMissing')}
                </div>
              )}
            </div>

            {/* 探索二期：关注源列表（增删） */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <Globe size={18} className="text-sky-500" />
                {t('explore.feedSourcesTitle')}
              </div>
              <p className="text-xs font-bold text-slate-500 leading-relaxed">{t('explore.feedSourcesDesc')}</p>
              {sourceSuggestions.length > 0 && (
                <div className="rounded-2xl bg-sky-50/70 border border-sky-100 px-3 py-2 space-y-1.5">
                  <div className="text-[11px] font-black text-sky-700">{t('explore.feedSourceSeedTitle')}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {sourceSuggestions.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        title={s.note}
                        onClick={() => { if (s.urlTemplate) setSourceUrl(s.urlTemplate); setSourceLabel(s.label); setSourceHint(s.note); }}
                        className="min-h-[36px] rounded-full bg-white border border-sky-200 px-3 py-1 text-xs font-bold text-sky-700"
                      >
                        + {s.label}
                      </button>
                    ))}
                  </div>
                  {sourceHint && <div className="text-[11px] font-bold text-sky-600 leading-relaxed">💡 {sourceHint}</div>}
                  <div className="text-[11px] font-bold text-slate-400 leading-relaxed">{t('explore.feedSourceSeedHint')}</div>
                </div>
              )}
              {feedSettings && feedSettings.sources.length === 0 && (
                <div className="rounded-2xl bg-slate-50 px-3 py-3 text-xs font-bold text-slate-400">{t('explore.feedSourcesEmpty')}</div>
              )}
              {feedSettings?.sources.map(source => (
                <div key={source.id} className="flex items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    {source.label && <div className="text-sm font-black text-slate-700 truncate">{source.label}</div>}
                    <div className="text-xs font-bold text-slate-400 truncate">{source.url}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFeedSource(source.id)}
                    className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-red-500"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <input
                value={sourceUrl}
                onChange={event => setSourceUrl(event.target.value)}
                placeholder={t('explore.feedSourceUrlPlaceholder')}
                className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400"
              />
              <input
                value={sourceLabel}
                onChange={event => setSourceLabel(event.target.value)}
                placeholder={t('explore.feedSourceLabelPlaceholder')}
                className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-sky-400"
              />
              <Button fullWidth onClick={addFeedSource} loading={addingSource} disabled={!sourceUrl.trim()} className="bg-sky-600 hover:bg-sky-700">
                {t('explore.feedSourceAdd')}
              </Button>
            </div>

            {/* 探索二期：待审核队列（关注源抓取结果） */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <CheckCircle2 size={18} className="text-amber-500" />
                {t('explore.feedPendingTitle')}{feedSettings && feedSettings.pendingReview.length > 0 ? `（${feedSettings.pendingReview.length}）` : ''}
              </div>
              {!feedSettings || feedSettings.pendingReview.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 px-3 py-3 text-xs font-bold text-slate-400">{t('explore.feedPendingEmpty')}</div>
              ) : feedSettings.pendingReview.map(item => (
                <div key={item.id} className="rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-2">
                  <div className="text-sm font-black text-slate-800 leading-snug">{item.title}</div>
                  {item.sourceUrl && (
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="block text-xs font-bold text-sky-600 truncate">
                      {t('explore.feedViewSource')}：{item.sourceUrl}
                    </a>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => reviewFeedItem(item.id, 'reject')}
                      className="min-h-[44px] rounded-2xl bg-white border border-slate-200 text-slate-500 text-sm font-black"
                    >
                      {t('explore.feedReject')}
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewFeedItem(item.id, 'approve')}
                      className="min-h-[44px] rounded-2xl bg-emerald-500 text-white text-sm font-black"
                    >
                      {t('explore.feedApprove')}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* 探索二期：推荐给孩子（粘贴链接预览或手填） */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <Heart size={18} className="text-rose-500" />
                {t('explore.feedPushTitle')}
              </div>
              <p className="text-xs font-bold text-slate-500 leading-relaxed">{t('explore.feedPushDesc')}</p>
              <div className="grid grid-cols-[1fr_6rem] gap-2">
                <input
                  value={pushUrl}
                  onChange={event => setPushUrl(event.target.value)}
                  placeholder={t('explore.feedPushLinkPlaceholder')}
                  className="rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-rose-300"
                />
                <button
                  type="button"
                  onClick={previewPushLink}
                  disabled={pushPreviewLoading || !pushUrl.trim()}
                  className="min-h-[44px] rounded-2xl bg-slate-900 text-white text-xs font-black disabled:opacity-40"
                >
                  {pushPreviewLoading ? t('common.loading') : t('explore.feedPushPreview')}
                </button>
              </div>
              {pushForm.imageUrl && (
                <img src={pushForm.imageUrl} alt={pushForm.title} className="w-full h-32 rounded-2xl object-cover border border-slate-100" />
              )}
              <input
                value={pushForm.title}
                onChange={event => setPushForm(prev => ({ ...prev, title: event.target.value }))}
                placeholder={t('explore.feedPushTitlePlaceholder')}
                className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-rose-300"
              />
              <input
                value={pushForm.summary}
                onChange={event => setPushForm(prev => ({ ...prev, summary: event.target.value }))}
                placeholder={t('explore.feedPushSummaryPlaceholder')}
                className="w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm font-bold outline-none focus:border-rose-300"
              />
              {/* 探索发现 v2：结构化活动字段（都可选，填了孩子端更清楚，且能按年龄/有效期/城市筛） */}
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-3 space-y-2">
                <div className="text-[11px] font-black text-slate-400">活动详情（可选）</div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={pushForm.city} onChange={e => setPushForm(p => ({ ...p, city: e.target.value }))} placeholder="城市" className={FEED_INP} />
                  <input value={pushForm.district} onChange={e => setPushForm(p => ({ ...p, district: e.target.value }))} placeholder="区域" className={FEED_INP} />
                </div>
                <input value={pushForm.venue} onChange={e => setPushForm(p => ({ ...p, venue: e.target.value }))} placeholder="场馆" className={FEED_INP} />
                <div className="grid grid-cols-2 gap-2">
                  <select value={pushForm.feedCategory} onChange={e => setPushForm(p => ({ ...p, feedCategory: e.target.value }))} className={FEED_INP}>
                    <option value="">分类</option>
                    <option value="文博">文博</option><option value="科普">科普</option><option value="美术">美术</option>
                    <option value="阅读">阅读</option><option value="非遗">非遗</option><option value="户外">户外</option>
                  </select>
                  <select value={pushForm.verifyStatus} onChange={e => setPushForm(p => ({ ...p, verifyStatus: e.target.value }))} className={FEED_INP}>
                    <option value="未核验">未核验</option><option value="已核验">已核验</option><option value="售罄">售罄</option><option value="待放票">待放票</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" min={0} max={18} value={pushForm.ageMin} onChange={e => setPushForm(p => ({ ...p, ageMin: e.target.value }))} placeholder="适龄最小(岁)" className={FEED_INP} />
                  <input type="number" min={0} max={18} value={pushForm.ageMax} onChange={e => setPushForm(p => ({ ...p, ageMax: e.target.value }))} placeholder="适龄最大(岁)" className={FEED_INP} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><div className="text-[10px] font-bold text-slate-400 mb-0.5">活动开始</div><input type="date" value={pushForm.activityStart} onChange={e => setPushForm(p => ({ ...p, activityStart: e.target.value }))} className={FEED_INP} /></div>
                  <div><div className="text-[10px] font-bold text-slate-400 mb-0.5">活动结束</div><input type="date" value={pushForm.activityEnd} onChange={e => setPushForm(p => ({ ...p, activityEnd: e.target.value }))} className={FEED_INP} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><div className="text-[10px] font-bold text-slate-400 mb-0.5">报名截止</div><input type="date" value={pushForm.signupDeadline} onChange={e => setPushForm(p => ({ ...p, signupDeadline: e.target.value }))} className={FEED_INP} /></div>
                  <div><div className="text-[10px] font-bold text-slate-400 mb-0.5">费用</div><input value={pushForm.price} onChange={e => setPushForm(p => ({ ...p, price: e.target.value }))} placeholder="免费 / ¥30" className={FEED_INP} /></div>
                </div>
                <input value={pushForm.bookingMethod} onChange={e => setPushForm(p => ({ ...p, bookingMethod: e.target.value }))} placeholder="预约方式（如 小程序预约 / 电话）" className={FEED_INP} />
                <input value={pushForm.officialUrl} onChange={e => setPushForm(p => ({ ...p, officialUrl: e.target.value }))} placeholder="官方链接 http(s)://" className={FEED_INP} />
                <input value={pushForm.recommendReason} onChange={e => setPushForm(p => ({ ...p, recommendReason: e.target.value }))} placeholder="推荐理由" className={FEED_INP} />
                <input value={pushForm.notes} onChange={e => setPushForm(p => ({ ...p, notes: e.target.value }))} placeholder="注意事项" className={FEED_INP} />
                <div className="grid grid-cols-2 gap-2">
                  <div><div className="text-[10px] font-bold text-rose-400 mb-0.5">推送生效日 ★</div><input type="date" value={pushForm.validFrom} onChange={e => setPushForm(p => ({ ...p, validFrom: e.target.value }))} className={FEED_INP} /></div>
                  <div><div className="text-[10px] font-bold text-rose-400 mb-0.5">下架日（过期自动下架）</div><input type="date" value={pushForm.validUntil} onChange={e => setPushForm(p => ({ ...p, validUntil: e.target.value }))} className={FEED_INP} /></div>
                </div>
                <div className="grid grid-cols-2 gap-2 items-center">
                  <div className="text-[11px] font-bold text-slate-500">推荐分（1–5）</div>
                  <input type="number" min={1} max={5} value={pushForm.recommendScore} onChange={e => setPushForm(p => ({ ...p, recommendScore: e.target.value }))} placeholder="1-5" className={FEED_INP} />
                </div>
              </div>
              <Button fullWidth onClick={pushFeedCard} loading={pushing} disabled={!pushForm.title.trim()} className="bg-rose-500 hover:bg-rose-600">
                {t('explore.feedPushConfirm')}
              </Button>
            </div>

            {/* 探索二期：观察统计 */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <BarChart3 size={18} className="text-teal-500" />
                {t('explore.statsTitle')}
              </div>
              {/* P1b：观察统计——孩子选择器（''=全家） */}
              {statsChildren.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-500">{t('explore.statsChildFilter')}</span>
                  <button
                    onClick={() => setStatsChildId('')}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${statsChildId === '' ? 'bg-teal-500 text-white shadow' : 'bg-white border border-slate-200 text-slate-500'}`}
                  >
                    {t('explore.statsChildAll')}
                  </button>
                  {statsChildren.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setStatsChildId(c.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${statsChildId === c.id ? 'bg-teal-500 text-white shadow' : 'bg-white border border-slate-200 text-slate-500'}`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {stats ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <StatCard label={t('explore.statsMonthCheckins')} value={String(stats.monthCheckinCount)} />
                    <StatCard label={t('explore.statsLitPlaces')} value={String(stats.visitedPlaceCount)} />
                    <StatCard label={t('explore.statsMonthWanted')} value={String(stats.monthWantedCount)} />
                    <StatCard
                      label={t('explore.statsTopCategory')}
                      value={stats.categoryDistribution[0] ? stats.categoryDistribution[0].category : t('explore.statsNone')}
                    />
                  </div>
                  {stats.categoryDistribution.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {stats.categoryDistribution.map(item => (
                        <span key={item.category} className="rounded-full bg-teal-50 border border-teal-100 px-3 py-1 text-xs font-black text-teal-700">
                          {item.category} × {item.count}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* P1b：去过的地方清单（按类型归类——名称 / 次数 / 最近日期） */}
                  <div className="pt-1">
                    <div className="text-xs font-black text-slate-500 mb-2">{t('explore.statsVisitedTitle')}</div>
                    {visitedByCategory.length === 0 ? (
                      <div className="rounded-2xl bg-slate-50 border border-dashed border-slate-200 p-4 text-center text-xs font-bold text-slate-400">
                        {t('explore.statsVisitedEmpty')}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {visitedByCategory.map(group => (
                          <div key={group.category}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-base">{EXPLORE_CATEGORY_ICONS[group.category] || '📍'}</span>
                              <span className="text-xs font-black text-slate-700">{group.category}</span>
                              <span className="text-[11px] font-bold text-slate-400">· {group.places.length}</span>
                            </div>
                            <div className="space-y-1.5">
                              {group.places.map(p => (
                                <div key={p.placeId} className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2">
                                  <span className="text-xs font-black text-slate-800 truncate">{p.title}</span>
                                  <span className="shrink-0 text-[11px] font-bold text-slate-500">
                                    {t('explore.statsVisitedCount', { count: p.checkinCount })} · {formatDay(p.lastVisitedAt)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs font-bold text-slate-400">{t('common.loading')}</div>
              )}
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

            {/* 地图定位：给"未定位"的地点批量补坐标（孩子地图上才看得到） */}
            <div className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm space-y-3">
              <div className="font-black text-slate-900 flex items-center gap-2">
                <MapPin size={18} className="text-sky-500" />
                {t('explore.geocodeTitle')}
              </div>
              <p className="text-xs font-bold text-slate-500 leading-relaxed">{t('explore.geocodeDesc')}</p>
              <Button fullWidth loading={geocoding} onClick={handleGeocodeMissing} className="bg-sky-600 hover:bg-sky-700">
                {t('explore.geocodeButton')}
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

// 探索二期：观察统计数字卡
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3 py-3 text-center">
      <div className="text-xl font-black text-slate-900 leading-tight">{value}</div>
      <div className="mt-1 text-[11px] font-bold text-slate-500">{label}</div>
    </div>
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
