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
  isCopy,
}) {
  
  useEffect(() => {
    // 履歴やズームの操作は一切不要
    // 何も書かないか、useEffect自体を消してもOKです
  }, [open]);

  if (!open) return null;

  const selectedCount = buildSelectedYmdsForConfirm().length;

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <button className="btn" onClick={closeMultiAdd}>
            ← 戻る
          </button>
          <div className="modalTitle">{isCopy ? "複数日にコピー" : "複数日に追加"}</div>
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
            {[
           { id: "range", label: "範囲選択" },
           { id: "multi", label: "複数選択" },
           { id: "weekday", label: "曜日選択" },
           ].map((m) => {
           const isSel = multiMode === m.id;
           return (
           <button
           key={m.id}
           className="btn"
           onClick={() => setMultiMode(m.id)}
           style={{
           background: isSel ? "rgba(0,0,0,.85)" : "rgba(0,0,0,.05)",
           color: isSel ? "#fff" : "rgba(0,0,0,.50)",
           border: "none",
           fontWeight: isSel ? "800" : "500",
           }}
           >
           {m.label}
           </button>
           );
           })}
          </div>

          {multiMode === "range" && <div style={{ color: "rgba(0,0,0,.65)", fontSize: 13, marginBottom: 10 }}>開始日→終了日をタップ（※土日除外は固定）</div>}
          {multiMode === "multi" && <div style={{ color: "rgba(0,0,0,.65)", fontSize: 13, marginBottom: 10 }}>日付をタップして追加/解除</div>}
          {multiMode === "weekday" && (
           <div style={{ display: "flex", justifyContent: "space-between", gap: 4, marginBottom: 15, padding: "0 2px" }}>
           {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
           const on = weekdaySelected.has(dow);
           return (
           <button
           key={dow}
           onClick={() => {
           setWeekdaySelected((prev) => {
              const next = new Set(prev);
              if (on) next.delete(dow); else next.add(dow);
              return next;
             });
             }}
           style={{
            width: 42, height: 42, borderRadius: 10, border: "1px solid",
            borderColor: on ? "rgba(0,0,0,.85)" : "rgba(0,0,0,.10)",
            background: on ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.90)",
            color: on ? "#fff" : "rgba(0,0,0,.60)",
            fontSize: 13, fontWeight: "800", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
           }}
           >
           {weekdayLabelJP(dow).replace("曜日", "")}
           </button>
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
             {isCopy ? "コピー" : "追加"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

