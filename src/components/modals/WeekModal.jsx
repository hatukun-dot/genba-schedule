import React from "react";
import { fromYmd } from "../../utils/date";
import { isHolidayDate } from "../../utils/holiday";

export function WeekModal({
  open,
  weekStartYmd,
  weekDays,
  eventsByKey,
  stableEventSort,
  eventLabel,
  peopleLine,
  closeWeekToMonth,
  prevWeek,
  nextWeek,
  closeWeek,
  openDay,
  onSurfaceClick,
  weekBodyRef,
}) {
  if (!open || !weekStartYmd) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <button className="btn" onClick={closeWeekToMonth}>
            ← 月へ
          </button>
          <div className="modalTitle">{weekStartYmd} 週</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={prevWeek}>
              ←
            </button>
            <button className="btn" onClick={nextWeek}>
              →
            </button>
          </div>
        </div>

        <div className="modalBody" ref={weekBodyRef} onClick={onSurfaceClick}>
          <div className="eventList">
            {weekDays.map(({ wd, ymd }) => {
              const list = (eventsByKey[ymd] || []).slice().sort(stableEventSort);
              const d = fromYmd(ymd);
              const dow = d.getDay();
              const isHoliday = isHolidayDate(d);
              const isSun = dow === 0 || isHoliday;
              const isSat = dow === 6;

              const HEAD_GAP = 1;
              const ITEM_GAP = 2;

              return (
                <div key={ymd} className={`eventRow weekRow ${isSun ? "sun" : isSat ? "sat" : ""}`} style={{ paddingTop: 12 }}>
                  <div className="eventMain weekHead" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span className="weekHeadText">
                      {wd} {ymd}
                    </span>

                    <button
                      className="btn"
                      onClick={() => {
                        closeWeek();
                        openDay(ymd, { fromWeekStartYmd: weekStartYmd });
                      }}
                    >
                      開く
                    </button>
                  </div>

                  {list.length === 0 ? (
                    <div className="eventSub weekBody" style={{ marginTop: HEAD_GAP }}>
                      予定なし
                    </div>
                  ) : (
                    <div className="eventList weekBody" style={{ marginTop: HEAD_GAP }}>
                      {list.map((e, i) => (
                        <div
                          key={e.id}
                          style={{
                            borderTop: i === 0 ? "none" : "1px solid rgba(0,0,0,.08)",
                            paddingTop: i === 0 ? 0 : ITEM_GAP,
                            marginTop: i === 0 ? 0 : ITEM_GAP,
                          }}
                        >
                          <div style={{ color: e.color ?? "#111", fontWeight: 800 }}>{eventLabel(e)}</div>
                          <div style={{ marginTop: 4, marginLeft: 12, color: "rgba(0,0,0,.60)", fontSize: 13 }}>{peopleLine(e)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

