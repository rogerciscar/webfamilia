type Props = {
  url: string;
  title?: string;
  onClose: () => void;
};

/** In-app PDF viewer so mobile back/close returns to the app. */
export function PdfViewer({ url, title, onClose }: Props) {
  return (
    <div className="pdf-overlay" role="dialog" aria-modal="true" aria-label={title || "Document PDF"}>
      <div className="pdf-panel">
        <div className="pdf-toolbar">
          <strong>{title || "Document"}</strong>
          <button type="button" className="ghost" onClick={onClose}>
            Tancar
          </button>
        </div>
        <iframe className="pdf-frame" title={title || "PDF"} src={url} />
      </div>
    </div>
  );
}
