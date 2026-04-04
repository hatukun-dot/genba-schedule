import React, { useEffect, useRef, useState } from "react";

export function AttachmentViewer({ files, initialIndex, onClose }) {
  const [index, setIndex] = useState(initialIndex ?? 0);
  const touchStartX = useRef(null);

  useEffect(() => {
    setIndex(initialIndex ?? 0);
  }, [initialIndex, files]);

  const current = files[index];
  const imageFiles = files.filter((f) => f.fileType === "image");
  const currentImageIndex = current?.fileType === "image" ? imageFiles.indexOf(current) : -1;

  function goPrev() {
    setIndex((i) => Math.max(0, i - 1));
  }
  function goNext() {
    setIndex((i) => Math.min(files.length - 1, i + 1));
  }

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  if (!files || files.length === 0 || !current) return null;

  return (
    <div className="viewerOverlay" onClick={onClose}>
      <div
        className="viewerContent"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button className="viewerClose" onClick={onClose}>✕</button>

        {index > 0 && (
          <button className="viewerNav viewerPrev" onClick={goPrev}>‹</button>
        )}
        {index < files.length - 1 && (
          <button className="viewerNav viewerNext" onClick={goNext}>›</button>
        )}

        {current.fileType === "image" ? (
          <img
            key={current.id ?? current.storagePath}
            src={current.url}
            alt={current.fileName}
            className="viewerImage"
          />
        ) : (
          <div className="viewerPdfArea">
            <div className="viewerPdfIcon">📄</div>
            <div className="viewerPdfName">{current.fileName}</div>
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="btn primary"
              onClick={(e) => e.stopPropagation()}
            >
              PDFを開く
            </a>
          </div>
        )}

        <div className="viewerBottom">
          <div className="viewerFileName">{current.fileName}</div>
          {imageFiles.length > 1 && currentImageIndex >= 0 && (
            <div className="viewerDots">
              {imageFiles.map((f, i) => (
                <span
                  key={f.id ?? i}
                  className={`viewerDot${i === currentImageIndex ? " active" : ""}`}
                  onClick={() => setIndex(files.indexOf(f))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
