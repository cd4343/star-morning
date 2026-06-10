/**
 * 图片压缩工具 — 移动端适配
 * 
 * 核心功能：
 * 1. Canvas 重绘压缩，自动降低质量直到满足大小限制
 * 2. EXIF 数据清除（Canvas 重绘不保留 EXIF，隐私安全）
 * 3. 尺寸缩放，大图限制到 maxWidth/maxHeight
 * 
 * 浏览器兼容：Chrome 51+, Safari 11+, Firefox 52+（Canvas toBlob）
 */

interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  maxSizeBytes?: number;
}

const DEFAULT_OPTIONS: Required<CompressOptions> = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 0.8,
  maxSizeBytes: 2 * 1024 * 1024, // 2MB
};

export async function compressImage(
  file: File,
  options: CompressOptions = {}
): Promise<File> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;

      // 缩放到 maxWidth/maxHeight
      if (width > opts.maxWidth) {
        height = Math.round((height * opts.maxWidth) / width);
        width = opts.maxWidth;
      }
      if (height > opts.maxHeight) {
        width = Math.round((width * opts.maxHeight) / height);
        height = opts.maxHeight;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d')!;
      // EXIF 方向校正 — 现代浏览器会自动处理 EXIF orientation
      // Canvas 重绘后不保留 EXIF，隐私安全
      ctx.drawImage(img, 0, 0, width, height);

      // 释放 object URL
      URL.revokeObjectURL(img.src);

      // 尝试压缩到目标大小
      compressToSize(canvas, file.name, opts.quality, opts.maxSizeBytes, resolve);
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      // 压缩失败时返回原始文件
      resolve(file);
    };

    img.src = URL.createObjectURL(file);
  });
}

function compressToSize(
  canvas: HTMLCanvasElement,
  fileName: string,
  quality: number,
  maxSizeBytes: number,
  resolve: (file: File) => void,
  attempt = 0
) {
  // 最多尝试 6 次（quality 从 0.8 降到 0.3）
  if (attempt > 6) {
    // 最终兜底：直接输出当前质量
    canvas.toBlob(
      (blob) => resolve(new File([blob!], fileName, { type: 'image/jpeg' })),
      'image/jpeg',
      quality
    );
    return;
  }

  canvas.toBlob(
    (blob) => {
      if (!blob) {
        // blob 为空时返回原始文件信息的兜底
        canvas.toBlob(
          (fallbackBlob) => resolve(new File([fallbackBlob!], fileName, { type: 'image/jpeg' })),
          'image/jpeg',
          0.5
        );
        return;
      }

      if (blob.size <= maxSizeBytes) {
        // 大小达标
        resolve(new File([blob], fileName, { type: 'image/jpeg' }));
      } else {
        // 继续降低质量
        compressToSize(
          canvas,
          fileName,
          Math.max(quality - 0.1, 0.2),
          maxSizeBytes,
          resolve,
          attempt + 1
        );
      }
    },
    'image/jpeg',
    quality
  );
}
