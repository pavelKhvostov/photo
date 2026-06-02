/**
 * lib/filters.ts — плёночные фильтры на canvas (клиентская обработка).
 * SPECIFICATION §5, §8.2.
 *
 * Инварианты:
 * - Только пиксельная обработка (getImageData/putImageData). Нет ML/распознавания лиц.
 * - Нет зарубежных библиотек.
 * - Ресайз длинной стороны до 2048 px ДО обработки (минимизация данных §5).
 * - Если итоговый Blob > 12 МБ — понижаем качество (§9 п.11).
 * - Зерно: Math.random (достаточно для клиента, не криптография).
 */

import type { CameraStyle } from './types'

const MAX_LONG_SIDE = 2048
const MAX_BLOB_BYTES = 12 * 1024 * 1024 // 12 МБ
const JPEG_QUALITY_DEFAULT = 0.9
const JPEG_QUALITY_REDUCED = 0.75

// ---- Утилиты ресайза ----------------------------------------------------

function createResizedCanvas(
  src: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
  srcW: number,
  srcH: number,
): HTMLCanvasElement {
  let w = srcW
  let h = srcH

  const longSide = Math.max(w, h)
  if (longSide > MAX_LONG_SIDE) {
    const scale = MAX_LONG_SIDE / longSide
    w = Math.round(w * scale)
    h = Math.round(h * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(src, 0, 0, w, h)
  return canvas
}

// ---- Пиксельная обработка -----------------------------------------------

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/** Применяет матрицу яркость/контраст к каналу (linear). */
function applyBrightnessContrast(v: number, brightness: number, contrast: number): number {
  // contrast: 1.0 = neutral, >1 = more, <1 = less
  // brightness: 0 = neutral additive offset
  return clamp((v + brightness - 128) * contrast + 128)
}

/** film35 — тёплый плёночный. */
function applyFilm35(data: Uint8ClampedArray): void {
  const len = data.length
  for (let i = 0; i < len; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    // Повышаем контраст слегка
    r = applyBrightnessContrast(r, 0, 1.08)
    g = applyBrightnessContrast(g, 0, 1.05)
    b = applyBrightnessContrast(b, 0, 1.05)
    // Тёплый баланс: R+, B-
    r = clamp(r + 12)
    g = clamp(g + 3)
    b = clamp(b - 14)
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    // alpha unchanged
  }
}

/** vintage — выцветший, sepia, fade. */
function applyVintage(data: Uint8ClampedArray): void {
  const len = data.length
  for (let i = 0; i < len; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    // Пониженная насыщенность — частичный sepia
    const avg = 0.299 * r + 0.587 * g + 0.114 * b
    // Смешиваем с ч/б 40%
    r = clamp(r * 0.6 + avg * 0.4)
    g = clamp(g * 0.6 + avg * 0.4)
    b = clamp(b * 0.6 + avg * 0.4)
    // Sepia-сдвиг
    const sr = clamp(r * 0.393 + g * 0.769 + b * 0.189)
    const sg = clamp(r * 0.349 + g * 0.686 + b * 0.168)
    const sb = clamp(r * 0.272 + g * 0.534 + b * 0.131)
    // Fade: поднимаем тени (lift blacks)
    data[i] = clamp(sr * 0.85 + 40)
    data[i + 1] = clamp(sg * 0.85 + 30)
    data[i + 2] = clamp(sb * 0.85 + 20)
  }
}

/** bw — чёрно-белый с контрастом. */
function applyBW(data: Uint8ClampedArray): void {
  const len = data.length
  for (let i = 0; i < len; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    // Luma по стандарту BT.601
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    const contrast = applyBrightnessContrast(luma, 0, 1.15)
    data[i] = contrast
    data[i + 1] = contrast
    data[i + 2] = contrast
  }
}

/** summer — яркий, тёплый, насыщенный. */
function applySummer(data: Uint8ClampedArray): void {
  const len = data.length
  for (let i = 0; i < len; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    // Экспозиция+
    r = clamp(r * 1.08 + 8)
    g = clamp(g * 1.06 + 5)
    b = clamp(b * 1.02)
    // Насыщенность+: отдаляем от среднего
    const avg = (r + g + b) / 3
    r = clamp(avg + (r - avg) * 1.25)
    g = clamp(avg + (g - avg) * 1.2)
    b = clamp(avg + (b - avg) * 1.15)
    // Тёплый тон
    r = clamp(r + 10)
    b = clamp(b - 8)
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
}

// ---- Зерно --------------------------------------------------------------

function addGrain(data: Uint8ClampedArray, intensity: number): void {
  const len = data.length
  for (let i = 0; i < len; i += 4) {
    const grain = (Math.random() - 0.5) * intensity
    data[i] = clamp(data[i] + grain)
    data[i + 1] = clamp(data[i + 1] + grain)
    data[i + 2] = clamp(data[i + 2] + grain)
  }
}

// ---- Виньетка -----------------------------------------------------------

function addVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  const cx = w / 2
  const cy = h / 2
  const radius = Math.sqrt(cx * cx + cy * cy)
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.45, cx, cy, radius)
  gradient.addColorStop(0, `rgba(0,0,0,0)`)
  gradient.addColorStop(1, `rgba(0,0,0,${strength.toFixed(2)})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, w, h)
}

// ---- Главная функция ----------------------------------------------------

/**
 * applyFilter — применяет плёночный фильтр к видео-кадру или изображению.
 *
 * @param src       HTMLVideoElement (видоискатель) или HTMLCanvasElement
 * @param style     Стиль камеры из CameraStyle
 * @returns         Promise<Blob> JPEG с качеством ~0.9 (понижается если > 12 МБ)
 *
 * Порядок:
 * 1. Ресайз длинной стороны до 2048 px
 * 2. Пиксельный фильтр (getImageData / putImageData)
 * 3. Зерно
 * 4. Виньетка (радиальный градиент поверх)
 * 5. toBlob → проверка размера → при необходимости понижаем качество
 */
export async function applyFilter(
  src: HTMLVideoElement | HTMLCanvasElement,
  style: CameraStyle,
): Promise<Blob> {
  // Определяем размеры источника
  let srcW: number
  let srcH: number

  if (src instanceof HTMLVideoElement) {
    srcW = src.videoWidth || src.clientWidth
    srcH = src.videoHeight || src.clientHeight
  } else {
    srcW = src.width
    srcH = src.height
  }

  if (srcW === 0 || srcH === 0) {
    throw new Error('Источник кадра имеет нулевой размер.')
  }

  // Шаг 1: ресайз
  const canvas = createResizedCanvas(src, srcW, srcH)
  const w = canvas.width
  const h = canvas.height
  const ctx = canvas.getContext('2d')!

  // Шаг 2: пиксельный фильтр
  const imageData = ctx.getImageData(0, 0, w, h)
  const { data } = imageData

  switch (style) {
    case 'film35':
      applyFilm35(data)
      addGrain(data, 18)
      break
    case 'vintage':
      applyVintage(data)
      addGrain(data, 22)
      break
    case 'bw':
      applyBW(data)
      addGrain(data, 28)
      break
    case 'summer':
      applySummer(data)
      addGrain(data, 10)
      break
  }

  ctx.putImageData(imageData, 0, 0)

  // Шаг 3: виньетка поверх (рисуется поверх пиксельных данных)
  switch (style) {
    case 'film35':
      addVignette(ctx, w, h, 0.35)
      break
    case 'vintage':
      addVignette(ctx, w, h, 0.55)
      break
    case 'bw':
      addVignette(ctx, w, h, 0.45)
      break
    case 'summer':
      // Лёгкая виньетка для лета
      addVignette(ctx, w, h, 0.2)
      break
  }

  // Шаг 4: toBlob с проверкой размера
  const blob = await canvasToBlob(canvas, JPEG_QUALITY_DEFAULT)
  if (blob.size <= MAX_BLOB_BYTES) {
    return blob
  }
  // Понижаем качество (§9 п.11)
  return canvasToBlob(canvas, JPEG_QUALITY_REDUCED)
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Не удалось создать Blob из canvas.'))
        }
      },
      'image/jpeg',
      quality,
    )
  })
}

/**
 * Захватывает текущий кадр из видео в canvas без применения фильтра.
 * Используется для предпросмотра фильтра отдельным шагом.
 */
export function captureVideoFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth || video.clientWidth
  canvas.height = video.videoHeight || video.clientHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas
}
