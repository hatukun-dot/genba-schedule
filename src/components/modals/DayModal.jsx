import React, { useEffect } from "react"; // ← useEffect を追加
import { clamp, fromYmd, mondayOfYmd } from "../../utils/date";
import { norm, uniqNumArray } from "../../utils/id";

export function DayModal({
  open,
  selectedKey,
  openMenuKey,
  canSave,
  editingEventId,
  selectedEvents,
  selectedEventsDisplay,
  selectedDayDowLabel,
  projectInput,
  taskInput,
  note,
  peopleCount,
  peopleActiveSorted,
  selectedPeopleIds,
  newPersonInline,
  projectSuggestions,
  taskSuggestions,
  currentProjectId,
  taskUsageMap,
  COLOR_PALETTE,
  color,
  dayBodyRef,
  // handlers / setters
  onSurfaceClick,
  toggleMenu,
  closeMenu,
  setMonthCursor,
  closeDay,
  goPrevDay,
  goNextDay,
  eventLabel,
  peopleLine,
  beginEditEvent,
  openMoveModal,
  softDeleteEvent,
  swapOrder,
  setProjectInput,
  setTaskInput,
  setNote,
  setPeopleCount,
  setPeopleCountManual,
  setSelectedPeopleIds,
  setNewPersonInline,
  addPersonInline,
  setColor,
  resetForm,
  openMultiAdd,
  addEvent,
  saveEditEvent,
}) {

  useEffect(() => {
    if (!open) return;
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');

    // 現在のURLに「#modal」を付けて、戻るボタンの身代わりを作る
    window.history.pushState(null, "", "#modal");

    const handlePopState = (e) => {
      // 戻るボタンが押されたら、強制的に1280に戻して閉じる
      if (viewport) viewport.setAttribute('content', 'width=1280');
      closeDay();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      // UIボタン等で閉じられた時も1280に戻す
      if (viewport) viewport.setAttribute('content', 'width=1280');
      // もしURLに#modalが残っていたら、履歴を1つ戻してURLを綺麗にする
      if (window.location.hash === "#modal") {
        window.history.back();
      }
    };
  }, [open]);

  if (!open || !selectedKey) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              onClick={() => {
                const d = selectedKey !== "TBD" ? fromYmd(selectedKey) : new Date();
                setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
                closeDay();
              }}
            >
              ←月
            </button>
          </div>

          <div className="modalTitle">
            {selectedKey === "TBD" ? "未定" : `${selectedKey}${selectedDayDowLabel ? `（${selectedDayDowLabel}）` : ""}`}
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={goPrevDay} disabled={selectedKey === "TBD"}>
              ←
            </button>
            <button className="btn" onClick={goNextDay} disabled={selectedKey === "TBD"}>
              →
            </button>
          </div>
        </div>

        <div className="modalBody" ref={dayBodyRef} onClick={onSurfaceClick}>
          <h2 className="sectionTitle">その日の予定</h2>

          {selectedEventsDisplay.length === 0 ? (
            <div className="empty">この日の予定はまだありません</div>
          ) : (
            <div className="eventList">
              {selectedEventsDisplay.map((e, idx) => {
                const mk = `day-${e.id}`;
                return (
                  <div key={e.id} className="eventRow">
                    <div className="eventMain" style={{ color: e.color ?? "#111" }}>
                      {eventLabel(e)}
                    </div>
                    <div className="eventSub">{peopleLine(e)}</div>

                    <div className="eventActions">
                      <button className="dots" onClick={(ev) => (ev.stopPropagation(), toggleMenu(mk))}>
                        …
                      </button>

                      {openMenuKey === mk && (
                        <div className="menu" onClick={(ev) => ev.stopPropagation()}>
                          <button className="menuBtn" onClick={() => (beginEditEvent(e), closeMenu())}>
                            編集
                          </button>
                          <button className="menuBtn" onClick={() => (openMoveModal(e.id), closeMenu())}>
                            移動
                          </button>
                          <button className="menuBtn" onClick={() => (softDeleteEvent(e.id), closeMenu())}>
                            削除
                          </button>
                          <div className="sep" />
                          <button className="menuBtn" disabled={idx === 0} onClick={() => idx > 0 && (swapOrder(selectedEvents[idx - 1], e), closeMenu())}>
                            ↑
                          </button>
                          <button
                            className="menuBtn"
                                disabled={idx === selectedEventsDisplay.length - 1}
                                onClick={() => idx < selectedEventsDisplay.length - 1 && (swapOrder(e, selectedEventsDisplay[idx + 1]), closeMenu())}
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <h2 className="sectionTitle">{editingEventId ? "編集" : "追加"}</h2>

          <div className="form">
            <div className="field">
              <div className="label">現場（必須）</div>
              <input className="input" value={projectInput} onChange={(e) => setProjectInput(e.target.value)} placeholder="例：S湖西 / 休み / 応援" />
              <div className="chips chipsScroll">
                {projectSuggestions.map((p) => (
                  <button key={p.id} className={`chip ${norm(projectInput) === p.name ? "active" : ""}`} onClick={() => setProjectInput(p.name)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <div className="label">作業（任意）</div>
              <input className="input" value={taskInput} onChange={(e) => setTaskInput(e.target.value)} placeholder="空欄OK" />
              <div className="chips chipsScroll">
                {taskSuggestions.map((t) => (
                  <button
                    key={t.id}
                    className={`chip ${norm(taskInput) === t.name ? "active" : ""}`}
                    onClick={() => setTaskInput(t.name)}
                    title={currentProjectId ? `使用回数: ${taskUsageMap[`${currentProjectId}:${t.id}`] ?? 0}` : ""}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <div className="label">メモ（任意）</div>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：時間 / 住所など" />
            </div>

            <div className="field">
              <div className="label">人数（未入力OK）</div>
              <div className="counterRow">
                <button
                  className="btn"
                  onClick={() => {
                    if (peopleCount === null) return;
                    setPeopleCountManual(true);
                    setPeopleCount(clamp(peopleCount - 1, 0, 99));
                  }}
                >
                  -
                </button>
                <div className="counterValue">{peopleCount === null ? "未入力" : `${peopleCount}名`}</div>
                <button
                  className="btn"
                  onClick={() => {
                    setPeopleCountManual(true);
                    if (peopleCount === null) setPeopleCount(1);
                    else setPeopleCount(clamp(peopleCount + 1, 0, 99));
                  }}
                >
                  +
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setPeopleCount(null);
                    setPeopleCountManual(false);
                  }}
                >
                  未入力
                </button>
              </div>
            </div>

            <div className="field">
              <div className="label">人員</div>

              <div className="peopleBoxFixed">
                {peopleActiveSorted.map((p) => {
                  const checked = selectedPeopleIds.includes(p.id);
                  return (
                    <label key={p.id} className="personRowFixed">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSelectedPeopleIds((prev) => {
                            const next = on ? [...prev, p.id] : prev.filter((x) => x !== p.id);
                            return uniqNumArray(next);
                          });
                        }}
                      />
                      <span>{p.name}</span>
                    </label>
                  );
                })}
              </div>

              <div className="addPersonRow" style={{ marginTop: 10 }}>
                <input className="input" value={newPersonInline} onChange={(e) => setNewPersonInline(e.target.value)} placeholder="例：田中" />
                <button type="button" className="btn" onClick={addPersonInline}>
                  追加
                </button>
              </div>
            </div>

            <div className="field">
              <div className="label">予定の色（任意）</div>
              <div className="colorGrid">
                {COLOR_PALETTE.map((c) => {
                  const selected = (c.key ?? null) === (color ?? null);
                  return (
                    <button
                      key={String(c.key)}
                      type="button"
                      className={`colorDot ${selected ? "active" : ""}`}
                      style={{ background: c.key ?? "#111" }}
                      onClick={() => setColor(c.key ?? null)}
                      title={c.label}
                    />
                  );
                })}
              </div>
            </div>

            {editingEventId && (
              <div className="field">
                <button className="btn" onClick={resetForm}>
                  編集をやめる
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="modalFooter">
          {editingEventId ? (
            <button className="btn primary" disabled={!canSave} onClick={saveEditEvent}>
              保存
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "flex-end" }}>
              <button className="btn" disabled={!canSave} onClick={openMultiAdd}>
                複数日に追加
              </button>
              <button className="btn primary" disabled={!canSave} onClick={addEvent}>
                追加
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

