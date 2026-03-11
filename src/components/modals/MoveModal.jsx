import React, { useEffect } from "react";

export function MoveModal({
  open,
  moveMonthLabel,
  moveYear,
  moveMonthIndex0,
  moveGridCells,
  setMoveCursor,
  moveEventToTbdInstant,
  moveEventToYmdInstant,
  closeMoveModal,
  onSurfaceClick,
}) {
  
  useEffect(() => {
    if (!open) return;
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');

    window.history.pushState({ modal: "move" }, "");

    const handlePopState = () => {
      // 戻るボタン：倍率は「そのまま」で、このモーダルだけ閉じる
      closeMoveModal();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // UIボタンで閉じた場合：履歴を消すが、倍率は変えない
      if (window.history.state?.modal === "move") {
        window.history.back();
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <button className="btn" onClick={closeMoveModal}>
            ← 戻る
          </button>
          <div className="modalTitle">移動先を選択</div>
          <div style={{ width: 72 }} />
        </div>

        <div className="modalBody" onClick={onSurfaceClick}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button className="btn" onClick={() => setMoveCursor(new Date(moveYear, moveMonthIndex0 - 1, 1))}>
              ←
            </button>
            <div style={{ fontWeight: 800 }}>{moveMonthLabel}</div>
            <button className="btn" onClick={() => setMoveCursor(new Date(moveYear, moveMonthIndex0 + 1, 1))}>
              →
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10, justifyContent: "flex-end" }}>
            <button className="btn" onClick={moveEventToTbdInstant}>
              未定へ移動
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 6,
              padding: 8,
              border: "1px solid rgba(0,0,0,.10)",
              borderRadius: 12,
              background: "rgba(255,255,255,.70)",
            }}
          >
            {["月", "火", "水", "木", "金", "土", "日"].map((x) => (
              <div key={`mh-${x}`} style={{ textAlign: "center", fontWeight: 800, fontSize: 12, color: "rgba(0,0,0,.70)" }}>
                {x}
              </div>
            ))}

            {moveGridCells.map((cell) => {
              if (cell.type === "blank") return <div key={cell.key} style={{ height: 36 }} />;

              const ymd = cell.ymd;
              const dow = cell.date.getDay();
              const isSat = dow === 6;
              const isSun = dow === 0;

              return (
                <button
                  key={cell.key}
                  className="btn"
                  onClick={() => moveEventToYmdInstant(ymd)}
                  style={{
                    height: 36,
                    padding: 0,
                    fontWeight: 800,
                    borderRadius: 10,
                    border: "1px solid rgba(0,0,0,.12)",
                    background: isSun ? "var(--sun)" : isSat ? "var(--sat)" : "rgba(255,255,255,.85)",
                    color: isSun ? "#b00020" : isSat ? "#0b57d0" : "#111",
                  }}
                  title={ymd}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 10, color: "rgba(0,0,0,.65)", fontSize: 13 }}>日付をタップした瞬間に移動します</div>
        </div>

        <div className="modalFooter">
          <button className="btn" onClick={closeMoveModal}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

