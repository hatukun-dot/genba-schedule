import React, { useEffect } from "react";

export function MultiAddModal({
  open,
  multiYear,
  multiMonthIndex0,
  multiMonthLabel,
  setMultiCursor,
  multiMode,
  setMultiMode,
  weekdaySelected,
  setWeekdaySelected,
  weekdayLabelJP,
  multiGridCells,
  isSelectedInMultiModal,
  onPickDayInMultiModal,
  buildSelectedYmdsForConfirm,
  canSave,
  closeMultiAdd,
  addEventToMultipleDays,
  onSurfaceClick,
}) {
  
  useEffect(() => {
    if (open) {
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) {
        viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
      }

      window.history.pushState({ modal: "multi" }, "", window.location.href);

      const handlePopState = () => {
        // 戻るボタンで閉じるときも1280に戻す
        if (viewport) viewport.setAttribute('content', 'width=1280');
        closeMultiAdd(); // ← 名前を修正
      };

      window.addEventListener("popstate", handlePopState);

      return () => {
        window.removeEventListener("popstate", handlePopState);
        if (viewport) {
          viewport.setAttribute('content', 'width=1280');
        }
      };
    }
  }, [open, closeMultiAdd]);

  if (!open) return null;

  const selectedCount = buildSelectedYmdsForConfirm().length;

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <button className="btn" onClick={closeMultiAdd}>
            ← 戻る
          </button>
          <div className="modalTitle">複数日に追加</div>
          <div style={{ width: 72 }} />
        </div>

        <div className="modalBody" onClick={onSurfaceClick}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button className="btn" onClick={() => setMultiCursor(new Date(multiYear, multiMonthIndex0 - 1, 1))}>
              ←
            </button>
            <div style={{ fontWeight: 800 }}>{multiMonthLabel}</div>
            <button className="btn" onClick={() => setMultiCursor(new Date(multiYear, multiMonthIndex0 + 1, 1))}>
              →
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <button className="btn" disabled={multiMode === "range"} onClick={() => setMultiMode("range")}>
              範囲選択
            </button>
            <button className="btn" disabled={multiMode === "multi"} onClick={() => setMultiMode("multi")}>
              複数選択
            </button>
            <button className="btn" disabled={multiMode === "weekday"} onClick={() => setMultiMode("weekday")}>
              曜日選択
            </button>
          </div>

          {multiMode === "range" && <div style={{ color: "rgba(0,0,0,.65)", fontSize: 13, marginBottom: 10 }}>開始日→終了日をタップ（※土日除外は固定）</div>}
          {multiMode === "multi" && <div style={{ color: "rgba(0,0,0,.65)", fontSize: 13, marginBottom: 10 }}>日付をタップして追加/解除</div>}
          {multiMode === "weekday" && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                const on = weekdaySelected.has(dow);
                return (
                  <label key={dow} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setWeekdaySelected((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(dow);
                          else next.delete(dow);
                          return next;
                        });
                      }}
                    />
                    <span>{weekdayLabelJP(dow)}</span>
                  </label>
                );
              })}
            </div>
          )}

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
              <div key={`h-${x}`} style={{ textAlign: "center", fontWeight: 800, fontSize: 12, color: "rgba(0,0,0,.70)" }}>
                {x}
              </div>
            ))}

            {multiGridCells.map((cell) => {
              if (cell.type === "blank") return <div key={cell.key} style={{ height: 36 }} />;

              const ymd = cell.ymd;
              const isSel = isSelectedInMultiModal(ymd);

              const dow = cell.date.getDay();
              const isSat = dow === 6;
              const isSun = dow === 0;

              const disabledTap = multiMode === "weekday";

              return (
                <button
                  key={cell.key}
                  className="btn"
                  disabled={disabledTap}
                  onClick={() => onPickDayInMultiModal(ymd)}
                  style={{
                    height: 36,
                    padding: 0,
                    fontWeight: 800,
                    borderRadius: 10,
                    border: isSel ? "2px solid rgba(0,0,0,.60)" : "1px solid rgba(0,0,0,.12)",
                    background: isSel ? "rgba(0,0,0,.07)" : isSun ? "var(--sun)" : isSat ? "var(--sat)" : "rgba(255,255,255,.85)",
                    opacity: disabledTap ? 0.6 : 1,
                    color: isSun ? "#b00020" : isSat ? "#0b57d0" : "#111",
                  }}
                  title={ymd}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 10, color: "rgba(0,0,0,.65)", fontSize: 13 }}>選択日数: {selectedCount}日</div>
        </div>

        <div className="modalFooter">
          <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "flex-end" }}>
            <button className="btn" onClick={closeMultiAdd}>
              キャンセル
            </button>
            <button className="btn primary" disabled={!canSave || selectedCount === 0} onClick={addEventToMultipleDays}>
              追加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

