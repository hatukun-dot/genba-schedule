import React from "react";
import { TbdRow } from "./TbdRow";
import { isHolidayDate } from "../../utils/holiday";

export function MonthGrid({ weeks, openDay, monthCellEvents, sameDay, todayYmd, weekdayClass, eventLabel, monthPeopleSummary }) {
  return (
    <section className="calendarCard">
      <div className="dowRow">
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
                    <div className="dayNum">
                     {/* 左側：日付と祝日名 */}
                     <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                     <span>{cell.date.getDate()}</span>
                     {/* 判定を Boolean ではなく関数そのものの戻り値（名前）に変更 */}
                     {isHolidayDate(cell.date) && typeof isHolidayDate(cell.date) === 'string' && (
                     <span style={{ fontSize: '9px', fontWeight: '400', color: '#b00020', whiteSpace: 'nowrap' }}>
                     {isHolidayDate(cell.date)}
                     </span>
                     )}
                     </div>

                     {/* 右側：他〇件（自動的に右へ行くように CSS で調整します） */}
                     {rest > 0 && (
                     <div className="more">
                     他{rest}件
                     </div>
                     )}
                     </div>

                    <div className="miniList">
                      {top.map((e) => {
                        const main = eventLabel(e);
                        const people = monthPeopleSummary ? monthPeopleSummary(e) : "";
                        const line = people ? `${main}${people}` : main;
                        return (
                          <div key={e.id} className="miniItem" style={{ color: e.color ?? "#111" }}>
                            {line}
                          </div>
                        );
                      })}
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

