"use client";

/**
 * DicomViewer — lightweight DICOM image viewer using dcmjs + canvas.
 *
 * Accepts a `blob` containing raw DICOM bytes, extracts pixel data via dcmjs,
 * applies default window/level from the DICOM tags, and renders to a <canvas>.
 *
 * Supports:
 *  - Grayscale (monochrome1 / monochrome2) images
 *  - RGB / YBR_FULL colour images
 *  - Multi-frame DICOM with prev/next navigation
 *  - Automatic fit-to-container scaling
 *
 * No external viewer library needed — just dcmjs (MIT) for DICOM parsing.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  blob: Blob;
}

/* ── dcmjs lazy import ─────────────────────────────────────────────────────────
 * dcmjs is ~11MB. It is loaded via a dynamic import() so the bundler emits it as
 * its own chunk (shared with lib/dicom-tag-parser.ts), fetched only when a DICOM
 * image is actually rendered rather than landing in the Messages chunk.
 */

interface DcmjsModule {
  data: {
    DicomMessage: {
      readFile(
        buffer: ArrayBuffer,
        options?: Record<string, unknown>
      ): { dict: Record<string, DcmElement> };
    };
  };
}

let _dcmjs: DcmjsModule | null = null;

async function loadDcmjs(): Promise<DcmjsModule> {
  if (!_dcmjs) {
    const mod = await import("dcmjs");
    _dcmjs = ((mod as { default?: DcmjsModule }).default ?? mod) as unknown as DcmjsModule;
  }
  return _dcmjs;
}

interface DcmElement {
  vr: string;
  Value?: unknown[];
  InlineBinary?: string;
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

/** Read a single numeric tag value, or return the fallback. */
function tagNum(dict: Record<string, DcmElement>, tag: string, fallback: number): number {
  const el = dict[tag];
  if (!el?.Value?.length) return fallback;
  const v = Number(el.Value[0]);
  return Number.isFinite(v) ? v : fallback;
}

/** Read a single string tag value. */
function tagStr(dict: Record<string, DcmElement>, tag: string): string {
  const el = dict[tag];
  if (!el?.Value?.length) return "";
  return String(el.Value[0] ?? "");
}

/**
 * Extract raw pixel bytes from the PixelData element.
 * dcmjs stores pixel data in Value[0] as an ArrayBuffer, typed array, or
 * occasionally as InlineBinary (base64).
 */
function getPixelBytes(dict: Record<string, DcmElement>): Uint8Array | null {
  const pd = dict["7FE00010"]; // PixelData
  if (!pd) return null;

  if (pd.Value?.length) {
    const v = pd.Value[0];
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (v instanceof Uint8Array) return v;
    if (v instanceof Int16Array || v instanceof Uint16Array)
      return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (ArrayBuffer.isView(v))
      return new Uint8Array(
        (v as { buffer: ArrayBuffer; byteOffset: number; byteLength: number }).buffer,
        (v as { byteOffset: number }).byteOffset,
        (v as { byteLength: number }).byteLength
      );
  }

  if (pd.InlineBinary) {
    const bin = atob(pd.InlineBinary);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  return null;
}

interface DicomImage {
  rows: number;
  cols: number;
  frames: number;
  bitsAllocated: number;
  bitsStored: number;
  highBit: number;
  pixelRepresentation: number;
  samplesPerPixel: number;
  photometric: string;
  windowCenter: number;
  windowWidth: number;
  rescaleSlope: number;
  rescaleIntercept: number;
  pixelBytes: Uint8Array;
}

function parseDicom(buffer: ArrayBuffer, dcmjs: DcmjsModule): DicomImage {
  const dataset = dcmjs.data.DicomMessage.readFile(buffer);
  const d = dataset.dict;

  const rows = tagNum(d, "00280010", 0);
  const cols = tagNum(d, "00280011", 0);
  if (rows === 0 || cols === 0) throw new Error("Invalid DICOM: missing image dimensions.");

  const bitsAllocated = tagNum(d, "00280100", 16);
  const bitsStored = tagNum(d, "00280101", bitsAllocated);
  const highBit = tagNum(d, "00280102", bitsStored - 1);
  const pixelRepresentation = tagNum(d, "00280103", 0); // 0=unsigned, 1=signed
  const samplesPerPixel = tagNum(d, "00280002", 1);
  const frames = tagNum(d, "00280008", 1);

  const photometric = tagStr(d, "00280004").toUpperCase() || "MONOCHROME2";

  const rescaleSlope = tagNum(d, "00281053", 1);
  const rescaleIntercept = tagNum(d, "00281052", 0);

  // Window center/width — may be array; take first value
  let windowCenter = 0;
  let windowWidth = 0;
  const wcEl = d["00281050"];
  const wwEl = d["00281051"];
  if (wcEl?.Value?.length) windowCenter = Number(wcEl.Value[0]);
  if (wwEl?.Value?.length) windowWidth = Number(wwEl.Value[0]);

  const pixelBytes = getPixelBytes(d);
  if (!pixelBytes) throw new Error("Invalid DICOM: no pixel data found.");

  // Auto-compute window if not specified
  if (windowWidth <= 0) {
    const maxVal = (1 << bitsStored) - 1;
    windowCenter = maxVal / 2;
    windowWidth = maxVal;
  }

  return {
    rows,
    cols,
    frames,
    bitsAllocated,
    bitsStored,
    highBit,
    pixelRepresentation,
    samplesPerPixel,
    photometric,
    windowCenter,
    windowWidth,
    rescaleSlope,
    rescaleIntercept,
    pixelBytes,
  };
}

/**
 * Render a single frame of a DICOM image to an ImageData.
 */
function renderFrame(img: DicomImage, frameIdx: number): ImageData {
  const { rows, cols, bitsAllocated, pixelRepresentation, samplesPerPixel } = img;
  const { photometric, windowCenter, windowWidth, rescaleSlope, rescaleIntercept } = img;

  const framePixelCount = rows * cols * samplesPerPixel;
  const bytesPerSample = bitsAllocated / 8;
  const frameByteOffset = frameIdx * framePixelCount * bytesPerSample;

  const imageData = new ImageData(cols, rows);
  const rgba = imageData.data;

  const isColor = samplesPerPixel >= 3;

  if (isColor) {
    // RGB or YBR_FULL
    for (let i = 0; i < rows * cols; i++) {
      const srcOff = frameByteOffset + i * 3;
      let r = img.pixelBytes[srcOff];
      let g = img.pixelBytes[srcOff + 1];
      let b = img.pixelBytes[srcOff + 2];

      if (photometric.startsWith("YBR")) {
        // YBR_FULL → RGB conversion
        const y = r;
        const cb = g;
        const cr = b;
        r = Math.max(0, Math.min(255, y + 1.402 * (cr - 128)));
        g = Math.max(0, Math.min(255, y - 0.3441 * (cb - 128) - 0.7141 * (cr - 128)));
        b = Math.max(0, Math.min(255, y + 1.772 * (cb - 128)));
      }

      const dstOff = i * 4;
      rgba[dstOff] = r;
      rgba[dstOff + 1] = g;
      rgba[dstOff + 2] = b;
      rgba[dstOff + 3] = 255;
    }
  } else {
    // Grayscale (MONOCHROME1 or MONOCHROME2)
    const isMono1 = photometric === "MONOCHROME1";
    const wLow = windowCenter - windowWidth / 2;
    const wHigh = windowCenter + windowWidth / 2;

    for (let i = 0; i < rows * cols; i++) {
      let rawVal: number;
      const off = frameByteOffset + i * bytesPerSample;

      if (bitsAllocated === 8) {
        rawVal = img.pixelBytes[off];
      } else {
        // 16-bit — little-endian
        rawVal = img.pixelBytes[off] | (img.pixelBytes[off + 1] << 8);
        if (pixelRepresentation === 1 && rawVal > 32767) {
          rawVal = rawVal - 65536;
        }
      }

      const hu = rawVal * rescaleSlope + rescaleIntercept;

      // Apply window/level
      let grey: number;
      if (hu <= wLow) {
        grey = 0;
      } else if (hu >= wHigh) {
        grey = 255;
      } else {
        grey = ((hu - wLow) / windowWidth) * 255;
      }

      if (isMono1) grey = 255 - grey;

      const dstOff = i * 4;
      rgba[dstOff] = grey;
      rgba[dstOff + 1] = grey;
      rgba[dstOff + 2] = grey;
      rgba[dstOff + 3] = 255;
    }
  }

  return imageData;
}

/* ── React Component ─────────────────────────────────────────────────────────── */

export function DicomViewer({ blob }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<DicomImage | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [frameCount, setFrameCount] = useState(1);

  /** Draw the current frame, scaled to fit the container. */
  const drawFrame = useCallback((img: DicomImage, frame: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const imageData = renderFrame(img, frame);

    // Scale to fit container while preserving aspect ratio
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;
    const scale = Math.min(containerW / img.cols, containerH / img.rows, 1);
    const drawW = Math.round(img.cols * scale);
    const drawH = Math.round(img.rows * scale);

    canvas.width = containerW;
    canvas.height = containerH;

    // Clear and center the image
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, containerW, containerH);

    // Draw to an offscreen canvas at native resolution, then scale
    const offscreen = document.createElement("canvas");
    offscreen.width = img.cols;
    offscreen.height = img.rows;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return;
    offCtx.putImageData(imageData, 0, 0);

    const offsetX = Math.round((containerW - drawW) / 2);
    const offsetY = Math.round((containerH - drawH) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(offscreen, offsetX, offsetY, drawW, drawH);
  }, []);

  /* Parse the DICOM blob on mount / blob change */
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const buffer = await blob.arrayBuffer();
        const dcmjs = await loadDcmjs();
        if (!mounted) return;

        const img = parseDicom(buffer, dcmjs);
        imageRef.current = img;
        setFrameCount(img.frames);
        setFrameIdx(0);
        setStatus("ready");

        // Draw first frame after state settles
        requestAnimationFrame(() => {
          if (mounted) drawFrame(img, 0);
        });
      } catch (e) {
        if (!mounted) return;
        setErrorMsg(e instanceof Error ? e.message : "Failed to parse DICOM image.");
        setStatus("error");
      }
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    setErrorMsg(null);
    init();

    return () => {
      mounted = false;
    };
  }, [blob, drawFrame]);

  /* Re-draw when frame changes */
  useEffect(() => {
    if (status === "ready" && imageRef.current) {
      drawFrame(imageRef.current, frameIdx);
    }
  }, [frameIdx, status, drawFrame]);

  /* Re-draw on container resize */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (imageRef.current && status === "ready") {
        drawFrame(imageRef.current, frameIdx);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [status, frameIdx, drawFrame]);

  return (
    <div className="flex flex-col h-full min-h-[300px]">
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      {frameCount > 1 && status === "ready" && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-gray-50 dark:bg-gray-800/60 shrink-0">
          <button
            onClick={() => setFrameIdx((p) => Math.max(0, p - 1))}
            disabled={frameIdx === 0}
            title="Previous frame"
            className="p-1 rounded border border-border text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-xs text-gray-600 dark:text-gray-400 tabular-nums">
            Frame {frameIdx + 1} / {frameCount}
          </span>

          <button
            onClick={() => setFrameIdx((p) => Math.min(frameCount - 1, p + 1))}
            disabled={frameIdx >= frameCount - 1}
            title="Next frame"
            className="p-1 rounded border border-border text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Canvas area ──────────────────────────────────────────────────────── */}
      <div ref={containerRef} className="relative flex-1 bg-black overflow-hidden">
        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-sm text-red-400">
            <AlertCircle className="w-6 h-6 shrink-0" />
            <span className="text-center">{errorMsg ?? "Failed to load DICOM image."}</span>
          </div>
        )}

        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
            Loading DICOM image…
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ visibility: status === "ready" ? "visible" : "hidden" }}
        />
      </div>
    </div>
  );
}
