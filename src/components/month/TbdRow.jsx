import React from "react";

export function TbdRow({ openDay, monthCellEvents, eventLabel }) {
  const { top, rest } = monthCellEvents("TBD");

  return (
    <div className="tbdRow">
      <button className="tbdCell" onClick={() => openDay("TBD")}>
        <div className="tbdTitle">未定</div>
        <div className="miniList">
          {top.map((e) => (
            <div key={e.id} className="miniItem" style={{ color: e.color ?? "#111" }}>
              {eventLabel(e)}
            </div>
          ))}
          {rest > 0 ? <div className="more">+{rest}件</div> : null}
        </div>
      </button>
    </div>
  );
}

