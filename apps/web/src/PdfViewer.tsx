import { useEffect, useState } from "react";

type Props = {
  url: string;
  title?: string;
  onClose: () => void;
};

/** In-app PDF viewer — fetch with cookies so /api/attachments auth works on mobile. */
export function PdfViewer({ url, title, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setBlobUrl(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(res.status === 404 ? "PDF no trobat al servidor" : `Error ${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (alive) setBlobUrl(objectUrl);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "No s'ha pogut obrir el PDF");
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <div className="pdf-overlay" role="dialog" aria-modal="true" aria-label={title || "Document PDF"}>
      <div className="pdf-panel">
        <div className="pdf-toolbar">
          <strong>{title || "Document"}</strong>
          <div className="pdf-toolbar-actions">
            {blobUrl ? (
              <a className="ghost" href={blobUrl} download={title || "document.pdf"}>
                Descarregar
              </a>
            ) : null}
            <button type="button" className="ghost" onClick={onClose}>
              Tancar
            </button>
          </div>
        </div>
        {error ? (
          <p className="error pdf-error" role="alert">
            {error}
          </p>
        ) : blobUrl ? (
          <iframe className="pdf-frame" title={title || "PDF"} src={blobUrl} />
        ) : (
          <p className="hint pdf-loading">Carregant PDF…</p>
        )}
      </div>
    </div>
  );
}
