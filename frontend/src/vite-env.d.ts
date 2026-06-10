/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 高德地图 JS API Key（探索模块地图视图；未配置时自动降级为列表模式） */
  readonly VITE_AMAP_JS_KEY?: string;
  /** 高德 JS API 配套安全密钥（JS API 2.0 需与 Key 搭配使用） */
  readonly VITE_AMAP_SECURITY_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

