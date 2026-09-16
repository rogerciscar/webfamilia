import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Props = {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
  busy?: boolean;
};

const OUT = 512;

/** Square carnet cropper: pan + zoom, then export JPEG. */
export function PhotoCropper({ file, onCancel, onConfirm, busy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [view, setView] = useState(280);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const side = Math.min(img.width, img.height);
      const fit = side / Math.max(img.width, img.height);
      setZoom(Math.max(1, 1 / fit));
      setOffset({ x: 0, y: 0 });
      setReady(true);
    };
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
      imgRef.current = null;
    };
  }, [file]);

  useEffect(() => {
    const onResize = () => setView(Math.min(320, Math.floor(window.innerWidth * 0.72)));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = view;
    canvas.height = view;
    ctx.fillStyle = "#0f2f2c";
    ctx.fillRect(0, 0, view, view);
    const scale = (Math.max(img.width, img.height) / Math.min(img.width, img.height)) * zoom;
    const drawW = (img.width / Math.max(img.width, img.height)) * view * scale;
    const drawH = (img.height / Math.max(img.width, img.height)) * view * scale;
    const dx = (view - drawW) / 2 + offset.x;
    const dy = (view - drawH) / 2 + offset.y;
    ctx.drawImage(img, dx, dy, drawW, drawH);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, view - 2, view - 2);
  }, [ready, zoom, offset, view]);

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  function exportCrop() {
    const img = imgRef.current;
    if (!img) return;
    const out = document.createElement("canvas");
    out.width = OUT;
    out.height = OUT;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    const scale = (Math.max(img.width, img.height) / Math.min(img.width, img.height)) * zoom;
    const drawW = (img.width / Math.max(img.width, img.height)) * OUT * scale;
    const drawH = (img.height / Math.max(img.width, img.height)) * OUT * scale;
    const ratio = OUT / view;
    const dx = (OUT - drawW) / 2 + offset.x * ratio;
    const dy = (OUT - drawH) / 2 + offset.y * ratio;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, dx, dy, drawW, drawH);
    out.toBlob(
      (blob) => {
        if (blob) onConfirm(blob);
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <div className="crop-overlay" role="dialog" aria-modal="true" aria-label="Enquadrar foto">
      <div className="crop-panel">
        <h2>Enquadra la foto</h2>
        <p className="hint">Arrossega per moure · zoom per ajustar el carnet</p>
        <canvas
          ref={canvasRef}
          className="crop-canvas"
          style={{ width: view, height: view, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <label className="crop-zoom">
          Zoom
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <div className="gate-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>
            Cancel·lar
          </button>
          <button type="button" disabled={busy || !ready} onClick={exportCrop}>
            Desar
          </button>
        </div>
      </div>
    </div>
  );
}
