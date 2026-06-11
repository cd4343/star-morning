import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { ExploreMapPlace } from '../types/explore';

declare global {
  interface Window {
    AMap: any;
    _AMapSecurityConfig: any;
  }
}

const AMAP_JS_KEY = (import.meta.env.VITE_AMAP_JS_KEY || '').trim();
const AMAP_SECURITY_CODE = (import.meta.env.VITE_AMAP_SECURITY_CODE || '').trim();

export const hasAmapKey = () => AMAP_JS_KEY.length > 0;

// 高德 JS SDK 动态加载：script 只注入一次，promise 全局缓存
let amapLoader: Promise<any> | null = null;

const loadAmap = (): Promise<any> => {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoader) return amapLoader;
  if (!hasAmapKey()) return Promise.reject(new Error('VITE_AMAP_JS_KEY 未配置'));
  if (AMAP_SECURITY_CODE) {
    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
  }
  amapLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(AMAP_JS_KEY)}`;
    script.async = true;
    script.onload = () => (window.AMap ? resolve(window.AMap) : reject(new Error('高德地图加载失败')));
    script.onerror = () => {
      amapLoader = null; // 网络失败后允许下次进入时重试
      reject(new Error('高德地图加载失败'));
    };
    document.head.appendChild(script);
  });
  return amapLoader;
};

// 标记徽章：visited→绿色（显示打卡次数），wishlist/planned→蓝色；44px 触控区域内放 32px 圆点
const markerContent = (place: ExploreMapPlace) => {
  const visited = place.status === 'visited';
  const color = visited ? '#10b981' : '#0ea5e9';
  const inner = visited
    ? `<span style="color:#fff;font-size:13px;font-weight:800;line-height:1;">${Math.min(99, place.checkinCount || 0)}</span>`
    : '<span style="display:block;width:10px;height:10px;border-radius:9999px;background:#fff;"></span>';
  return `
    <div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
      <div style="width:32px;height:32px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;">${inner}</div>
    </div>`;
};

type ExploreMapProps = {
  places: ExploreMapPlace[];
  onPlaceClick: (place: ExploreMapPlace) => void;
  /** 探索三期：SDK 加载 reject 或初始化异常时通知父组件做列表兜底 */
  onLoadError?: () => void;
  className?: string;
};

export default function ExploreMap({ places, onPlaceClick, onLoadError, className = '' }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const centeredRef = useRef(false);
  const onPlaceClickRef = useRef(onPlaceClick);
  onPlaceClickRef.current = onPlaceClick;
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;
  const [mapReady, setMapReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const locatedPlaces = useMemo(
    () => places.filter(place => place.latitude != null && place.longitude != null),
    [places]
  );

  // 初始化地图（仅一次），组件卸载时销毁实例
  useEffect(() => {
    if (!hasAmapKey()) return;
    let cancelled = false;
    loadAmap()
      .then(AMap => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mapRef.current = new AMap.Map(containerRef.current, { zoom: 12, resizeEnable: true });
        setMapReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          onLoadErrorRef.current?.();
        }
      });
    return () => {
      cancelled = true;
      markersRef.current = [];
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  // 同步标记；中心点取有坐标地点的均值（仅首次，不打断孩子拖动后的视野）
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !window.AMap) return;
    map.remove(markersRef.current);
    markersRef.current = locatedPlaces.map(place => {
      const marker = new window.AMap.Marker({
        position: [Number(place.longitude), Number(place.latitude)],
        content: markerContent(place),
        offset: new window.AMap.Pixel(-22, -22),
        title: place.title
      });
      marker.on('click', () => onPlaceClickRef.current(place));
      return marker;
    });
    if (markersRef.current.length > 0) map.add(markersRef.current);
    if (!centeredRef.current && locatedPlaces.length > 0) {
      const avgLng = locatedPlaces.reduce((sum, place) => sum + Number(place.longitude), 0) / locatedPlaces.length;
      const avgLat = locatedPlaces.reduce((sum, place) => sum + Number(place.latitude), 0) / locatedPlaces.length;
      map.setZoomAndCenter(12, [avgLng, avgLat]);
      centeredRef.current = true;
    }
  }, [mapReady, locatedPlaces]);

  // 无 key 或加载失败：降级提示卡，不报错
  if (!hasAmapKey() || failed) {
    return (
      <div className={`flex items-center justify-center rounded-3xl bg-sky-50 border border-dashed border-sky-200 p-6 ${className}`}>
        <div className="text-center">
          <div className="text-3xl">🗺️</div>
          <p className="mt-2 text-sm font-black text-slate-600">{t('explore.mapNotConfigured')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative min-h-[340px] overflow-hidden rounded-3xl border border-slate-100 bg-sky-50 ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {mapReady && locatedPlaces.length === 0 && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 rounded-2xl bg-white/95 px-4 py-3 text-center text-xs font-black text-slate-500 shadow">
          {t('explore.mapNoMarkers')}
        </div>
      )}
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center text-sm font-black text-slate-400">
          {t('explore.mapLoading')}
        </div>
      )}
    </div>
  );
}
