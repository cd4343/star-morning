import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Camera, CheckCircle2, Compass, FileText, MapPin, Mic, PauseCircle, Send, Sparkles, Upload, X } from 'lucide-react';
import api from '../../services/api';
import { getDateLocale, t } from '../../i18n';
import { useToast } from '../../components/Toast';
import { ExplorePlace, ExploreCheckin, ExploreMedium, EXPLORE_CATEGORIES, EXPLORE_MOODS, EXPLORE_CATEGORY_ICONS } from '../../types/explore';
import { compressImage } from '../../utils/imageCompress';



const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = reject;
  reader.readAsDataURL(file);
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

  const visiblePlaces = useMemo(() => {
    if (category === 'all') return places;
    return places.filter(place => place.category === category);
  }, [places, category]);

  const loadData = async () => {
    const [placeRes, checkinRes] = await Promise.all([
      api.get('/child/explore/places'),
      api.get('/child/explore/checkins')
    ]);
    setPlaces(placeRes.data || []);
    setCheckins(checkinRes.data || []);
  };

  useEffect(() => {
    loadData().catch(() => toast.error('探索数据加载失败'));
    api.get('/child/explore/settings')
      .then(res => setRequirePhoto(!!res.data?.exploreRequirePhoto))
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
        const blob = new Blob(chunks.current, { type: recorder.mimeType || mimeType });
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
      const res = await api.post('/child/explore/checkins', {
        placeId: selected.id,
        mood,
        note
      });
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
    <div className="p-4 space-y-4 pb-8">
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

      {selected && (
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
        </div>
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
