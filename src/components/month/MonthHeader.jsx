import React from "react";

export function MonthHeader({
  session,
  authBusy,
  appError,
  clearError,
  openMenuKey,
  toggleMenu,
  closeMenu,
  openMaster,
  exportXlsxForCurrentMonth,
  handleLogout,
  monthLabel,
  year,
  monthIndex0,
  setMonthCursor,
}) {
  return (
    <header className="header">
      <div className="headerTopRow">
        <h1 className="title">予定表</h1>

        <div className="monthHeaderMenu">
          <button className="dots" onClick={(e) => (e.stopPropagation(), toggleMenu("monthMenu"))}>
            …
          </button>
          {openMenuKey === "monthMenu" && (
            <div className="menu" onClick={(e) => e.stopPropagation()}>
              <button className="menuBtn" onClick={() => (openMaster("genba"), closeMenu())}>
                マスタ
              </button>
              <button className="menuBtn" onClick={() => (exportXlsxForCurrentMonth(), closeMenu())}>
                Excel出力
              </button>

              <div className="sep" />

              <div style={{ padding: "8px 10px", fontSize: 12, color: "rgba(0,0,0,.70)" }}>ログイン中: {session?.user?.email || "（不明）"}</div>
              <button
                className="menuBtn"
                disabled={authBusy}
                onClick={async () => {
                  closeMenu();
                  await handleLogout();
                }}
              >
                ログアウト
              </button>
            </div>
          )}
        </div>
      </div>

      {appError ? (
        <div className="appErrorBar" role="alert">
          <div style={{ minWidth: 0 }}>
            <div className="appErrorMsg">{appError.message}</div>
            {appError.detail ? <div className="appErrorDetail">{appError.detail}</div> : null}
          </div>
          <button className="btn" onClick={clearError} style={{ flex: "0 0 auto" }}>
            閉じる
          </button>
        </div>
      ) : null}

      <div className="monthBar">
        <button className="btn" onClick={() => setMonthCursor(new Date(year, monthIndex0 - 1, 1))}>
          ← 前月
        </button>

        <div className="monthLabel">{monthLabel}</div>

        <button className="btn" onClick={() => setMonthCursor(new Date(year, monthIndex0 + 1, 1))}>
          翌月 →
        </button>
      </div>
    </header>
  );
}

