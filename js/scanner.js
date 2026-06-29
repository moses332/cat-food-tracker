// Camera barcode scanning. Tries the browser-native BarcodeDetector first
// (fast; Android Chrome), and falls back to the ZXing library for browsers
// without it (notably iOS Safari). Both paths call onResult(code) once and
// then stop. A scan is always cancellable via stopScan().

const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

let activeStop = null;

export async function startScan(videoEl, onResult, onError) {
  stopScan();
  videoEl.setAttribute('playsinline', 'true');
  videoEl.muted = true;

  if ('BarcodeDetector' in window) {
    return startNative(videoEl, onResult, onError);
  }
  return startZXing(videoEl, onResult, onError);
}

export function stopScan() {
  if (activeStop) {
    const s = activeStop;
    activeStop = null;
    try { s(); } catch { /* ignore */ }
  }
}

// ── Native BarcodeDetector ───────────────────────────────────────────────────
async function startNative(videoEl, onResult, onError) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    onError?.(err);
    return;
  }

  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});

  let detector;
  try {
    detector = new window.BarcodeDetector({ formats: PRODUCT_FORMATS });
  } catch {
    detector = new window.BarcodeDetector(); // some builds reject the formats list
  }

  let raf = null;
  let stopped = false;
  const stopAll = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    stream.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  };
  activeStop = stopAll;

  const tick = async () => {
    if (stopped) return;
    try {
      const codes = await detector.detect(videoEl);
      if (codes && codes.length) {
        const value = codes[0].rawValue;
        stopScan();
        onResult(value);
        return;
      }
    } catch { /* transient decode error — keep scanning */ }
    raf = requestAnimationFrame(tick);
  };
  tick();
  return stopAll;
}

// ── ZXing fallback (lazy-loaded from CDN) ────────────────────────────────────
async function startZXing(videoEl, onResult, onError) {
  try {
    const { BrowserMultiFormatReader } = await import('https://esm.sh/@zxing/browser@0.1.5');
    const reader = new BrowserMultiFormatReader();
    const controls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } } },
      videoEl,
      (result) => {
        if (result) {
          stopScan();
          onResult(result.getText());
        }
      }
    );
    activeStop = () => { try { controls.stop(); } catch { /* ignore */ } };
    return activeStop;
  } catch (err) {
    onError?.(err);
  }
}
