import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { Camera, CheckCircle2, Compass, FileText, List, MapPin, Mic, PauseCircle, Search, Send, Sparkles, Upload, X } from 'lucide-react';
import api from '../../services/api';
import { getDateLocale, t } from '../../i18n';
import { useToast } from '../../components/Toast';
import BottomSheet from '../../components/BottomSheet';
import Mascot from '../../components/Mascot';
import ExploreMap, { hasAmapKey } from '../../components/ExploreMap';
import { ExplorePlace, ExploreCheckin, ExploreMapPlace, ExploreMedium, ExploreFeedItem, EXPLORE_CATEGORIES, EXPLORE_MOODS, EXPLORE_CATEGORY_ICONS } from '../../types/explore';
import { compressImage } from '../../utils/imageCompress';



const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// 探索地图一期：单次打卡定位——拿不到就静默放弃，绝不阻塞打卡（P5：不追踪、不记录轨迹）
const getOneShotPosition = () => new Promise<{ latitude: number; longitude: number } | null>(resolve => {
  if (!('geolocation' in navigator)) return resolve(null);
  let settled = false;
  const finish = (value: { latitude: number; longitude: number } | null) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  const guard = window.setTimeout(() => finish(null), 6000);
  navigator.geolocation.getCurrentPosition(
    position => {
      window.clearTimeout(guard);
      finish({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    },
    () => {
      window.clearTimeout(guard);
      finish(null);
    },
    { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
  );
});

const formatDate = (value?: string) => {
  if (!value) return '还没有打卡';
  return new Date(value).toLocaleDateString(getDateLocale(), { month: 'numeric', day: 'numeric' });
};

export default function ChildExplore() {
  const { refresh } = useOutletContext<any>();
  const toast = useToast();
  const [places, setPlaces] = useState<ExplorePlace[]>([]);
  const [checkins, setCheckins] = useState<ExploreCheckin[]>([]);
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<ExplorePlace | null>(null);
  const [mood, setMood] = useState<string>(EXPLORE_MOODS[0]);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [audioDataUrl, setAudioDataUrl] = useState('');
  const [audioDuration, setAudioDuration] = useState(0);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const recordStartedAt = useRef(0);
  const chunks = useRef<Blob[]>([]);
  // 探索改版②：照片要求开关（家长设置，提交前前端引导）
  const [requirePhoto, setRequirePhoto] = useState(false);
  // 探索改版①：打卡媒体展开（含爸爸/妈妈的语音回应）
  const [checkinMedia, setCheckinMedia] = useState<Record<string, ExploreMedium[]>>({});
  const [loadingCheckinMedia, setLoadingCheckinMedia] = useState<Record<string, boolean>>({});
  // 探索地图一期：地图/列表切换（有 key 默认地图；偏好存 localStorage）
  // 探索二期：新增「发现」资讯流段（无 key 时地图段隐藏，发现/列表仍可用）
  // 探索三期：有 key 时列表不再是独立段，只作地图加载失败的自动兜底；
  // 旧偏好值 'list' 兼容保留——有 key 时视为「地图不可用时的展示」，按地图处理，不报错
  const [viewMode, setViewMode] = useState<'map' | 'feed' | 'list'>(() => {
    const saved = localStorage.getItem('explore.viewMode');
    if (saved === 'feed') return 'feed';
    if (saved === 'list' && !hasAmapKey()) return 'list';
    return hasAmapKey() ? 'map' : 'list';
  });
  // 探索三期：地图运行时加载失败（SDK reject / 初始化异常）→ 自动降级回原列表视图
  const [mapFailed, setMapFailed] = useState(false);
  // 探索二期：今日发现卡片流
  const [feedItems, setFeedItems] = useState<ExploreFeedItem[]>([]);
  const [feedLeaving, setFeedLeaving] = useState<Set<string>>(new Set());
  const [feedBusy, setFeedBusy] = useState<string | null>(null);
  const [mapPlaces, setMapPlaces] = useState<ExploreMapPlace[]>([]);
  const [mapSheetPlace, setMapSheetPlace] = useState<ExploreMapPlace | null>(null);
  const [showObserveTips, setShowObserveTips] = useState(false);
  // 探索地图一期：打卡位置核对开关（家长设置，单次定位）
  const [geoVerify, setGeoVerify] = useState(false);

  const visiblePlaces = useMemo(() => {
    if (category === 'all') return places;
    return places.filter(place => place.category === category);
  }, [places, category]);

  // 探索三期：还没定位的想去地点（地图上方胶囊托盘，点开与点标记相同的抽屉）
  const unlocatedWishlist = useMemo(
    () => mapPlaces.filter(place => place.status === 'wishlist' && (place.latitude == null || place.longitude == null)),
    [mapPlaces]
  );

  // 地图搜索：按名称过滤全家的探索地点（含无坐标的），选中即定位/打开抽屉，解决"加了地点找不到"
  const [mapSearch, setMapSearch] = useState('');
  const [focusPlace, setFocusPlace] = useState<ExploreMapPlace | null>(null);
  const mapSearchResults = useMemo(() => {
    const q = mapSearch.trim().toLowerCase();
    if (!q) return [] as ExploreMapPlace[];
    return mapPlaces.filter(place => (place.title || '').toLowerCase().includes(q)).slice(0, 8);
  }, [mapSearch, mapPlaces]);
  const openMapPlaceFromSearch = (place: ExploreMapPlace) => {
    setMapSearch('');
    if (place.latitude != null && place.longitude != null) setFocusPlace(place);
    setShowObserveTips(false);
    setMapSheetPlace(place);
  };

  // 地图"地点清单"：按分类分组全家地点，点一条即定位/打开（快速浏览"想去哪"）
  const [showPlaceList, setShowPlaceList] = useState(false);
  const placesByCategory = useMemo(() => {
    const groups: Record<string, ExploreMapPlace[]> = {};
    mapPlaces.forEach(place => {
      const cat = (EXPLORE_CATEGORIES as readonly string[]).includes(place.category) ? place.category : '其他';
      (groups[cat] ||= []).push(place);
    });
    return (EXPLORE_CATEGORIES as readonly string[])
      .filter(c => groups[c]?.length)
      .map(c => ({ category: c, items: groups[c] }));
  }, [mapPlaces]);

  const loadData = async () => {
    const [placeRes, checkinRes, mapRes] = await Promise.all([
      api.get('/child/explore/places'),
      api.get('/child/explore/checkins'),
      api.get('/child/explore/map-places')
    ]);
    setPlaces(placeRes.data || []);
    setCheckins(checkinRes.data || []);
    setMapPlaces(mapRes.data || []);
  };

  // 探索二期：发现卡片加载失败不打扰主流程（地图/列表照常可用）
  const loadFeed = () => api.get('/child/explore/feed')
    .then(res => setFeedItems(res.data || []))
    .catch(() => {});

  useEffect(() => {
    loadData().catch(() => toast.error('探索数据加载失败'));
    loadFeed();
    api.get('/child/explore/settings')
      .then(res => {
        setRequirePhoto(!!res.data?.exploreRequirePhoto);
        setGeoVerify(!!res.data?.exploreGeoVerify);
      })
      .catch(() => {});
  }, []);

  // B3-2: iOS Safari 兼容——自动检测支持的 MIME 类型
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

  const startRecording = async () => {
    try {
      // B3-2: 检测浏览器支持的录音格式
      const mimeType = getSupportedMimeType();
      if (!mimeType) {
        toast.warning('您的浏览器不支持录音功能，可以用文字或照片代替');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      chunks.current = [];
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        // B2-2 修复：剥离 codecs 参数（audio/webm;codecs=opus → audio/webm），后端按基础 MIME 校验
        const baseType = (recorder.mimeType || mimeType).split(';')[0];
        const blob = new Blob(chunks.current, { type: baseType });
        // 根据实际 MIME 类型选择文件扩展名
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        setAudioDataUrl(await fileToDataUrl(new File([blob], `explore-voice.${ext}`, { type: blob.type })));
        setAudioDuration(Math.max(1, Math.round((Date.now() - recordStartedAt.current) / 1000)));
      };
      mediaRecorder.current = recorder;
      recordStartedAt.current = Date.now();
      recorder.start();
      setRecording(true);
    } catch {
      toast.error('无法打开麦克风，请检查浏览器权限');
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
    setRecording(false);
  };

  // 探索改版①：展开/收起打卡媒体（孩子自己的照片语音 + 家长语音回应）
  const toggleCheckinMedia = async (checkinId: string) => {
    if (checkinMedia[checkinId]) {
      setCheckinMedia(prev => { const next = { ...prev }; delete next[checkinId]; return next; });
      return;
    }
    setLoadingCheckinMedia(prev => ({ ...prev, [checkinId]: true }));
    try {
      const res = await api.get(`/child/explore/checkins/${checkinId}/media`);
      setCheckinMedia(prev => ({ ...prev, [checkinId]: res.data || [] }));
    } catch {
      toast.error('照片和声音加载失败');
    } finally {
      setLoadingCheckinMedia(prev => ({ ...prev, [checkinId]: false }));
    }
  };

  // 探索地图一期：切换地图/发现/列表并记住偏好
  const switchViewMode = (mode: 'map' | 'feed' | 'list') => {
    if (mode === 'map') setMapFailed(false); // 再点「地图」段时重试加载，再失败会继续自动回列表
    setViewMode(mode);
    try { localStorage.setItem('explore.viewMode', mode); } catch { /* 隐私模式下存不了就算了 */ }
  };

  // 探索地图一期：地图抽屉里点「我到啦，打卡！」→ 复用现有打卡弹窗
  const openCheckinFromMap = () => {
    if (!mapSheetPlace) return;
    const fullPlace: ExplorePlace = places.find(place => place.id === mapSheetPlace.id) || mapSheetPlace;
    setMapSheetPlace(null);
    setSelected(fullPlace);
  };

  // 探索二期：发现卡「想去」→ 一律落地（有坐标上图，无坐标进待定位托盘），卡片消失
  const wantFeedItem = async (item: ExploreFeedItem) => {
    if (feedBusy) return;
    setFeedBusy(item.id);
    try {
      const res = await api.post(`/child/explore/feed/${item.id}/want`);
      toast.success(res.data?.located ? t('explore.feedWantSuccess') : t('explore.feedWantSaved'));
      setFeedItems(prev => prev.filter(card => card.id !== item.id));
      loadData().catch(() => {});
      loadFeed();
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    } finally {
      setFeedBusy(null);
    }
  };

  // 探索二期：发现卡「下次再说」→ 淡出后移除，不再出现
  const dismissFeedItem = async (item: ExploreFeedItem) => {
    if (feedBusy) return;
    setFeedBusy(item.id);
    try {
      await api.post(`/child/explore/feed/${item.id}/dismiss`);
      setFeedLeaving(prev => new Set(prev).add(item.id));
      window.setTimeout(() => {
        setFeedItems(prev => prev.filter(card => card.id !== item.id));
        setFeedLeaving(prev => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }, 300);
    } catch (e: any) {
      toast.error(e.response?.data?.message || t('toast.operateFailed'));
    } finally {
      setFeedBusy(null);
    }
  };

  const submitCheckin = async () => {
    if (!selected) return;
    // 探索改版②：家长开启照片要求时，提交前提醒先拍照（仅前端引导，后端不强制）
    if (requirePhoto && photos.length === 0) {
      toast.warning(t('explore.requirePhotoHint'));
      return;
    }
    // B2-4: 仅心情为必填，文字/照片/语音为可选补充
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { placeId: selected.id, mood, note };
      // 探索地图一期：家长开启位置核对时，打卡瞬间取一次坐标；失败/拒绝静默继续
      if (geoVerify) {
        const position = await getOneShotPosition();
        if (position) {
          payload.latitude = position.latitude;
          payload.longitude = position.longitude;
        }
      }
      const res = await api.post('/child/explore/checkins', payload);
      const checkinId = res.data.id;
      for (const photo of photos.slice(0, 3)) {
        await api.post(`/child/explore/checkins/${checkinId}/media`, {
          type: 'image',
          dataUrl: await fileToDataUrl(photo)
        });
      }
      if (audioDataUrl) {
        await api.post(`/child/explore/checkins/${checkinId}/media`, {
          type: 'audio',
          dataUrl: audioDataUrl,
          durationSeconds: audioDuration
        });
      }
      toast.success('探索打卡已保存');
      setSelected(null);
      setNote('');
      setPhotos([]);
      setAudioDataUrl('');
      setAudioDuration(0);
      await loadData();
      refresh?.();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '打卡保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={viewMode === 'map' && !mapFailed ? 'h-full flex flex-col gap-3 p-4 pb-2' : 'p-4 space-y-4 pb-8'}>
      <div className="flex rounded-2xl bg-white border border-slate-200 p-1 shadow-sm">
        {hasAmapKey() && (
          <button
            type="button"
            onClick={() => switchViewMode('map')}
            className={`flex-1 min-h-[44px] rounded-xl text-sm font-black transition-all ${viewMode === 'map' ? 'bg-slate-900 text-white shadow' : 'text-slate-500'}`}
          >
            {t('explore.viewMap')}
          </button>
        )}
        <button
          type="button"
          onClick={() => switchViewMode('feed')}
          className={`relative flex-1 min-h-[44px] rounded-xl text-sm font-black transition-all ${viewMode === 'feed' ? 'bg-slate-900 text-white shadow' : 'text-slate-500'}`}
        >
          {t('explore.viewFeed')}
          {feedItems.length > 0 && viewMode !== 'feed' && (
            <span className="absolute top-0.5 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center">
              {feedItems.length}
            </span>
          )}
        </button>
        {!hasAmapKey() && (
          <button
            type="button"
            onClick={() => switchViewMode('list')}
            className={`flex-1 min-h-[44px] rounded-xl text-sm font-black transition-all ${viewMode === 'list' ? 'bg-slate-900 text-white shadow' : 'text-slate-500'}`}
          >
            {t('explore.viewList')}
          </button>
        )}
      </div>

      {viewMode === 'map' && !mapFailed ? (
      <>
        {/* 地图搜索框 + 分类清单入口：按名称找 / 按分类浏览全家地点，选中即定位或打开抽屉 */}
        <div className="flex items-stretch gap-2 shrink-0">
          <div className="relative flex-1">
          <div className="flex items-center gap-2 rounded-2xl bg-white border border-slate-200 px-3 shadow-sm">
            <Search size={16} className="text-slate-400 shrink-0" />
            <input
              value={mapSearch}
              onChange={e => setMapSearch(e.target.value)}
              placeholder={t('explore.mapSearchPlaceholder')}
              className="flex-1 min-h-[44px] bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400"
            />
            {mapSearch && (
              <button type="button" onClick={() => setMapSearch('')} className="shrink-0 p-1 text-slate-400" aria-label="clear">
                <X size={16} />
              </button>
            )}
          </div>
          {mapSearch.trim() && (
            <div className="absolute inset-x-0 top-full mt-1 z-20 max-h-64 overflow-y-auto rounded-2xl bg-white border border-slate-200 shadow-lg">
              {mapSearchResults.length === 0 ? (
                <div className="px-4 py-3 text-xs font-bold text-slate-400">{t('explore.mapSearchNoResult')}</div>
              ) : mapSearchResults.map(place => {
                const located = place.latitude != null && place.longitude != null;
                return (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => openMapPlaceFromSearch(place)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left border-b border-slate-50 last:border-0 active:bg-slate-50"
                  >
                    <span className="text-base shrink-0">{EXPLORE_CATEGORY_ICONS[place.category] || '📍'}</span>
                    <span className="flex-1 text-sm font-black text-slate-800 truncate">{place.title}</span>
                    <span className={`shrink-0 text-[10px] font-black ${located ? 'text-emerald-600' : 'text-sky-600'}`}>
                      {located ? t('explore.mapSearchLocated') : t('explore.mapSearchUnlocated')}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          </div>
          <button
            type="button"
            onClick={() => setShowPlaceList(true)}
            className="shrink-0 min-w-[48px] min-h-[44px] rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-600 active:scale-[0.97] transition-all"
            aria-label={t('explore.placeListTitle')}
          >
            <List size={18} />
          </button>
        </div>
        {/* 探索三期：待定位的想去托盘（点胶囊开与点标记相同的抽屉） */}
        {unlocatedWishlist.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {unlocatedWishlist.map(place => (
              <button
                key={place.id}
                type="button"
                onClick={() => {
                  setShowObserveTips(false);
                  setMapSheetPlace(place);
                }}
                className="shrink-0 min-h-[44px] rounded-full bg-white border border-sky-200 px-4 text-sm font-black text-sky-700 shadow-sm active:scale-[0.98] transition-all"
              >
                🎈 {place.title}
              </button>
            ))}
          </div>
        )}
        <ExploreMap
          places={mapPlaces}
          focusPlace={focusPlace}
          onPlaceClick={place => {
            setShowObserveTips(false);
            setMapSheetPlace(place);
          }}
          onLoadError={() => setMapFailed(true)}
          className="h-[62dvh] min-h-[340px]"
        />
      </>
      ) : viewMode === 'feed' ? (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900">{t('explore.feedTitle')}</h3>
          {feedItems.length > 0 && (
            <span className="text-xs font-bold text-slate-400">{t('explore.feedCount', { count: feedItems.length })}</span>
          )}
        </div>
        {feedItems.length === 0 ? (
          <div className="rounded-3xl bg-white border border-dashed border-slate-200 p-8 text-center text-sm font-bold text-slate-500 leading-relaxed">
            <Mascot variant="sleep" size={80} className="mx-auto mb-3" />
            {t('explore.feedEmpty')}
          </div>
        ) : feedItems.map(item => (
          <div
            key={item.id}
            className={`rounded-3xl border p-4 shadow-sm transition-all duration-300 ${
              feedLeaving.has(item.id) ? 'opacity-0 scale-95' : 'opacity-100'
            } ${item.type === 'parent' ? 'bg-rose-50 border-rose-200' : item.type === 'festival' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}
          >
            {item.type === 'parent' && (
              <div className="mb-2 inline-flex rounded-full bg-rose-500 text-white px-3 py-1 text-xs font-black">
                {t('explore.feedParentBadge')}
              </div>
            )}
            {item.type === 'festival' && (
              <div className="mb-2 inline-flex rounded-full bg-amber-400 text-white px-3 py-1 text-xs font-black">
                {t('explore.feedFestivalBadge')}
              </div>
            )}
            {item.imageUrl && (
              <img
                src={item.imageUrl}
                alt={item.title}
                loading="lazy"
                onError={event => event.currentTarget.classList.add('hidden')}
                className="w-full h-36 rounded-2xl object-cover border border-slate-100"
              />
            )}
            <div className="mt-2 flex items-start justify-between gap-2">
              <div className="font-black text-slate-900 text-lg leading-snug">{item.title}</div>
              {item.category && (
                <span className="shrink-0 rounded-full bg-sky-50 text-sky-700 px-2 py-1 text-[11px] font-black">
                  {EXPLORE_CATEGORY_ICONS[item.category] || '📍'} {item.category}
                </span>
              )}
            </div>
            {item.summary && <p className="mt-1 text-sm text-slate-600 leading-relaxed line-clamp-3">{item.summary}</p>}
            {/* 探索发现 v2：结构化信息 */}
            {(item.ageMin != null || item.ageMax != null || item.price || item.signupDeadline || item.venue) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(item.ageMin != null || item.ageMax != null) && (
                  <span className="rounded-full bg-sky-50 text-sky-700 px-2 py-0.5 text-[11px] font-black">👦 {item.ageMin ?? ''}{item.ageMin != null && item.ageMax != null ? '–' : ''}{item.ageMax ?? ''} 岁</span>
                )}
                {item.price && <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-black">💰 {item.price}</span>}
                {item.signupDeadline && <span className="rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[11px] font-black">⏰ {item.signupDeadline} 截止</span>}
                {item.venue && <span className="rounded-full bg-slate-50 text-slate-600 px-2 py-0.5 text-[11px] font-black">📍 {item.venue}</span>}
              </div>
            )}
            {item.recommendReason && <p className="mt-1.5 text-xs font-bold text-rose-500 leading-relaxed">💡 {item.recommendReason}</p>}
            {item.notes && <p className="mt-1 text-[11px] font-bold text-slate-400 leading-relaxed">注意：{item.notes}</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => dismissFeedItem(item)}
                disabled={feedBusy === item.id}
                className="min-h-[44px] rounded-2xl bg-white border border-slate-200 text-slate-500 text-sm font-black disabled:opacity-50"
              >
                {t('explore.feedDismiss')}
              </button>
              <button
                type="button"
                onClick={() => wantFeedItem(item)}
                disabled={feedBusy === item.id}
                className="min-h-[44px] rounded-2xl bg-emerald-500 text-white text-sm font-black shadow-md shadow-emerald-100 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {t('explore.feedWant')}
              </button>
            </div>
          </div>
        ))}
      </section>
      ) : (
      <>
      {viewMode === 'map' && mapFailed && (
        <p className="text-center text-xs font-bold text-slate-400">{t('explore.mapFallbackHint')}</p>
      )}
      <section className="rounded-[1.75rem] bg-gradient-to-br from-emerald-400 via-sky-400 to-indigo-500 text-white p-5 shadow-lg shadow-sky-100">
        <div className="flex items-center gap-2 text-sm font-black opacity-95">
          <Compass size={18} />
          家庭探索站
        </div>
        <h2 className="mt-3 text-2xl font-black leading-tight">读万卷书，也走进真实世界</h2>
        <p className="mt-2 text-sm font-bold text-white/85">看地点、做记录、留下声音和照片，成就会记录你的每一次出发。</p>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {['all', ...EXPLORE_CATEGORIES].map(item => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-black border transition-all ${
              category === item ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            {item === 'all' ? '全部' : `${EXPLORE_CATEGORY_ICONS[item] || '📍'} ${item}`}
          </button>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-slate-900">想去的地方</h3>
          <span className="text-xs font-bold text-slate-400">{visiblePlaces.length} 个地点</span>
        </div>
        {visiblePlaces.length === 0 ? (
          <div className="rounded-3xl bg-white border border-dashed border-slate-200 p-8 text-center text-slate-500 text-sm font-bold">
            家长还没有添加这个分类的探索地点。
          </div>
        ) : visiblePlaces.map(place => (
          <button
            key={place.id}
            type="button"
            onClick={() => setSelected(place)}
            className="w-full text-left rounded-3xl bg-white border border-slate-100 p-4 shadow-sm active:scale-[0.99] transition-all"
          >
            <div className="flex gap-3">
              <div className="w-12 h-12 rounded-2xl bg-sky-50 flex items-center justify-center text-2xl">
                {EXPLORE_CATEGORY_ICONS[place.category] || '📍'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-black text-slate-900 text-lg truncate">{place.title}</div>
                  <span className="shrink-0 rounded-full bg-emerald-50 text-emerald-700 px-2 py-1 text-[11px] font-black">
                    {place.status === 'visited' ? '去过' : '可打卡'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs font-bold text-slate-500">
                  <MapPin size={13} />
                  <span className="truncate">{place.address || place.city || place.category}</span>
                </div>
                {place.whyGo && (
                  <p className="text-xs text-slate-500 line-clamp-1 mt-1">✨ {place.whyGo}</p>
                )}
                {place.summary && <p className="mt-2 text-sm text-slate-600 leading-relaxed line-clamp-2">{place.summary}</p>}
                <div className="mt-3 flex items-center gap-3 text-xs font-bold text-slate-400">
                  <span>打卡 {place.checkinCount || 0} 次</span>
                  <span>最近 {formatDate(place.lastCheckedInAt)}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-black text-slate-900">我的探索记录</h3>
        {checkins.slice(0, 5).map(item => (
          <div key={item.id} className="rounded-3xl bg-white border border-slate-100 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-black text-slate-900">{item.placeTitle}</div>
                <div className="mt-1 text-xs font-bold text-slate-400">{formatDate(item.checkedInAt)} · {item.mood}</div>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-black ${item.parentConfirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {item.parentConfirmed ? '已确认' : '待确认'}
              </span>
            </div>
            {item.note && <p className="mt-3 text-sm text-slate-600 leading-relaxed">{item.note}</p>}
            {/* 探索改版①：家长确认时留下的文字反馈 */}
            {!!item.parentConfirmed && item.parentNote && (
              <div className="mt-3 rounded-2xl bg-rose-50 border border-rose-100 px-3 py-2 text-sm font-bold text-rose-600 leading-relaxed">
                {t('explore.parentSaid')}：{item.parentNote}
              </div>
            )}
            {/* 探索改版①：打卡媒体（含爸爸/妈妈的语音回应卡片） */}
            {(item.mediaCount || 0) > 0 && (
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => toggleCheckinMedia(item.id)}
                  className="text-xs font-black text-sky-600"
                >
                  {loadingCheckinMedia[item.id]
                    ? t('common.loading')
                    : checkinMedia[item.id]
                      ? t('explore.mediaToggleClose')
                      : (item.parentVoiceCount ? t('explore.parentReplyHint') : t('explore.mediaToggleOpen'))}
                </button>
                {checkinMedia[item.id] && (
                  <div className="space-y-2">
                    {checkinMedia[item.id].filter(m => m.type === 'image').length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {checkinMedia[item.id].filter(m => m.type === 'image').map(m => (
                          <img key={m.id} src={m.filePath} alt="探索照片" className="w-16 h-16 rounded-xl object-cover border border-slate-100" />
                        ))}
                      </div>
                    )}
                    {checkinMedia[item.id].filter(m => m.type === 'audio').map(m => (
                      m.senderRole === 'parent' ? (
                        <div key={m.id} className="rounded-2xl bg-rose-50 border border-rose-100 p-3">
                          <div className="text-sm font-black text-rose-600">{t('explore.parentReplyCard')}</div>
                          <audio src={m.filePath} controls preload="none" className="mt-2 h-8 w-full" />
                        </div>
                      ) : (
                        <div key={m.id} className="flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2">
                          <Mic size={14} className="text-slate-500 shrink-0" />
                          <audio src={m.filePath} controls preload="none" className="h-8 min-w-0 flex-1" />
                        </div>
                      )
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </section>
      </>
      )}

      <BottomSheet
        isOpen={showPlaceList}
        onClose={() => setShowPlaceList(false)}
        title={t('explore.placeListTitle')}
      >
        {placesByCategory.length === 0 ? (
          <div className="py-8 text-center text-sm font-bold text-slate-400">{t('explore.placeListEmpty')}</div>
        ) : (
          <div className="space-y-4 pb-2">
            {placesByCategory.map(group => (
              <div key={group.category}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-base">{EXPLORE_CATEGORY_ICONS[group.category] || '📍'}</span>
                  <span className="text-sm font-black text-slate-800">{group.category}</span>
                  <span className="text-xs font-bold text-slate-400">· {group.items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {group.items.map(place => {
                    const located = place.latitude != null && place.longitude != null;
                    const visited = place.status === 'visited';
                    return (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() => { setShowPlaceList(false); openMapPlaceFromSearch(place); }}
                        className="flex w-full items-center gap-2 rounded-2xl bg-slate-50 border border-slate-100 px-3 py-2.5 text-left active:bg-slate-100"
                      >
                        <span className="flex-1 text-sm font-black text-slate-800 truncate">{place.title}</span>
                        {visited ? (
                          <span className="shrink-0 text-[10px] font-black text-emerald-600">{t('explore.visitedTimes', { count: place.checkinCount || 0 })}</span>
                        ) : (
                          <span className={`shrink-0 text-[10px] font-black ${located ? 'text-sky-600' : 'text-amber-600'}`}>
                            {located ? t('explore.mapSearchLocated') : t('explore.mapSearchUnlocated')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={!!mapSheetPlace}
        onClose={() => setMapSheetPlace(null)}
        title={mapSheetPlace?.title || ''}
        footer={mapSheetPlace ? (
          <button
            type="button"
            onClick={openCheckinFromMap}
            className="w-full min-h-[52px] rounded-2xl bg-emerald-500 text-white text-lg font-black shadow-lg shadow-emerald-100 active:scale-[0.99] transition-all"
          >
            {t('explore.checkinCta')}
          </button>
        ) : undefined}
      >
        {mapSheetPlace && (
          <div className="space-y-3 pb-1">
            {/* 探索三期：来源发现卡的配图（加载失败时隐藏） */}
            {mapSheetPlace.imageUrl && (
              <img
                src={mapSheetPlace.imageUrl}
                alt={mapSheetPlace.title}
                loading="lazy"
                onError={event => event.currentTarget.classList.add('hidden')}
                className="w-full h-40 rounded-2xl object-cover border border-slate-100"
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-black text-sky-700">
                {EXPLORE_CATEGORY_ICONS[mapSheetPlace.category] || '📍'} {mapSheetPlace.category}
              </span>
              {mapSheetPlace.status === 'visited' && (
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                  🟢 {t('explore.visitedTimes', { count: mapSheetPlace.checkinCount || 0 })}
                </span>
              )}
            </div>
            {/* 探索三期：无坐标地点提示家长帮忙定位（打卡按钮保持可用） */}
            {(mapSheetPlace.latitude == null || mapSheetPlace.longitude == null) && (
              <div className="rounded-2xl bg-amber-50 border border-amber-100 px-3 py-2 text-sm font-bold text-amber-700 leading-relaxed">
                {t('explore.unlocatedSheetHint')}
              </div>
            )}
            {mapSheetPlace.summary && (
              <p className="text-sm font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">{mapSheetPlace.summary}</p>
            )}
            {mapSheetPlace.whyGo && (
              <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3">
                <div className="text-sm font-black text-sky-700">✨ {t('explore.whyGoTitle')}</div>
                <p className="mt-1 text-sm font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">{mapSheetPlace.whyGo}</p>
              </div>
            )}
            {mapSheetPlace.observeTips && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowObserveTips(prev => !prev)}
                  className="w-full min-h-[44px] rounded-2xl bg-slate-50 border border-slate-100 px-3 text-left text-sm font-black text-slate-600"
                >
                  {showObserveTips ? t('explore.observeTipsClose') : t('explore.observeTipsOpen')}
                </button>
                {showObserveTips && (
                  <p className="mt-2 px-1 text-sm font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">{mapSheetPlace.observeTips}</p>
                )}
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {selected && createPortal(
        <div className="absolute inset-0 z-[80] bg-slate-950/55 backdrop-blur-sm flex items-end">
          <div className="w-full max-h-[88%] overflow-y-auto rounded-t-[2rem] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black text-sky-600">{selected.category}</div>
                <h3 className="mt-1 text-2xl font-black text-slate-900">{selected.title}</h3>
                <p className="mt-1 text-sm font-bold text-slate-500">{selected.address || selected.city || '家长添加的探索地点'}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="rounded-full bg-slate-100 p-2 text-slate-500">
                <X size={20} />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {selected.whyGo && <InfoBlock icon={<Sparkles size={18} />} title="为什么值得去" text={selected.whyGo} />}
              {selected.observeTips && <InfoBlock icon={<Compass size={18} />} title="可以观察什么" text={selected.observeTips} />}
              {selected.questionPrompts && <InfoBlock icon={<FileText size={18} />} title="可以想一想" text={selected.questionPrompts} />}
            </div>

            <div className="mt-5 rounded-3xl bg-slate-50 border border-slate-100 p-4 space-y-4">
              <h4 className="font-black text-slate-900 flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-500" />
                记录这次探索
              </h4>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                {EXPLORE_MOODS.map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMood(item)}
                    className={`shrink-0 rounded-full px-3 py-2 text-xs font-black border ${mood === item ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-500 border-slate-200'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <textarea
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder="写一句今天看到、想到或勇敢尝试的事..."
                className="w-full min-h-[92px] rounded-2xl border border-slate-200 bg-white p-3 text-sm font-bold outline-none focus:border-sky-400"
              />
              <label className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-sky-200 bg-sky-50 py-3 text-sm font-black text-sky-700">
                <Upload size={18} />
                选择照片，最多 3 张
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async event => {
                    const rawFiles = Array.from(event.target.files || []).slice(0, 3);
                    // B3-1: 移动端图片压缩 + EXIF 清除
                    const compressed = await Promise.all(rawFiles.map(f => compressImage(f)));
                    setPhotos(compressed);
                  }}
                />
              </label>
              {photos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {photos.map((photo, idx) => (
                    <div key={idx} className="relative shrink-0">
                      <img src={URL.createObjectURL(photo)} alt={`照片${idx + 1}`} className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
                      <button type="button" onClick={() => setPhotos(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-black">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={recording ? stopRecording : startRecording}
                  className={`rounded-2xl py-3 font-black flex items-center justify-center gap-2 ${recording ? 'bg-red-50 text-red-600' : 'bg-white border border-slate-200 text-slate-700'}`}
                >
                  {recording ? <PauseCircle size={18} /> : <Mic size={18} />}
                  {recording ? '停止录音' : '语音留言'}
                </button>
                <button
                  type="button"
                  onClick={submitCheckin}
                  disabled={saving}
                  className="rounded-2xl py-3 font-black flex items-center justify-center gap-2 bg-slate-900 text-white disabled:opacity-50"
                >
                  <Send size={18} />
                  {saving ? '保存中' : '提交打卡'}
                </button>
              </div>
              {audioDataUrl && (
                <div className="flex items-center justify-between rounded-2xl bg-white border border-slate-100 px-3 py-2 text-sm font-bold text-slate-600">
                  <span className="flex items-center gap-2">
                    <audio src={audioDataUrl} className="h-8 w-32" controls preload="none" />
                  </span>
                  <button type="button" onClick={() => setAudioDataUrl('')} className="text-red-500 text-xs font-black">删除</button>
                </div>
              )}
              <div className="flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-100 p-3 text-xs font-bold text-amber-700 leading-relaxed">
                <Camera size={16} className="mt-0.5 shrink-0" />
                照片和语音只用于家庭记录，家长确认后会帮助点亮探索成就。
              </div>
            </div>
          </div>
        </div>,
        (typeof document !== 'undefined' ? (document.querySelector('[data-app-frame="true"], [data-child-app-frame="true"]') as HTMLElement | null) : null) || document.body
      )}
    </div>
  );
}

function InfoBlock({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3">
      <div className="flex items-center gap-2 text-sm font-black text-sky-700">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-sm font-bold text-slate-600 leading-relaxed whitespace-pre-wrap">{text}</p>
    </div>
  );
}
