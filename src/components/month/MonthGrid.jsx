import React from "react";
import { TbdRow } from "./TbdRow";

export function MonthGrid({ weeks, openWeek, openDay, monthCellEvents, sameDay, todayYmd, weekdayClass, eventLabel }) {
  return (
    <section className="calendarCard">
      <div className="dowRow">
        <div className="dowCell" />
        {["月", "火", "水", "木", "金", "土", "日"].map((x) => (
          <div key={x} className="dowCell">
            {x}
          </div>
        ))}
      </div>

      <div className="grid">
        {weeks.map((wk) => {
          return (
            <React.Fragment key={`wk-${wk.mondayYmd}`}>
              <button className="weekCell" onClick={() => openWeek(wk.mondayYmd)} title="週間予定">
                <span>週</span>
              </button>

              {wk.row.map((cell) => {
                if (cell.type === "blank") return <div key={cell.key} className="cell blank" />;

                const key = cell.ymd;
                const { top, rest } = monthCellEvents(key);
                const isToday = sameDay(key, todayYmd);
                const wcls = weekdayClass(cell);

                return (
                  <button
                    key={cell.key}
                    className={`cell date ${wcls} ${isToday ? "today" : ""} ${cell.inMonth ? "" : "outside"}`}
                    onClick={() => openDay(key)}
                    title={key}
                  >
                    <div className="dayNum">{cell.date.getDate()}</div>
                    <div className="miniList">
                      {top.map((e) => (
                        <div key={e.id} className="miniItem" style={{ color: e.color ?? "#111" }}>
                          {eventLabel(e)}
                        </div>
                      ))}
                      {rest > 0 ? <div className="more">+{rest}件</div> : null}
                    </div>
                  </button>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>

      {/* 未定行もカード内に配置 */}
      <TbdRow openDay={openDay} monthCellEvents={monthCellEvents} eventLabel={eventLabel} />
    </section>
  );
}

