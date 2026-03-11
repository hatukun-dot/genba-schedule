import React, { useEffect } from "react";
import { norm } from "../../utils/id";

export function MasterModal({
  open,
  masterTab,
  setMasterTab,
  projectsActive,
  tasksActive,
  peopleActiveSorted,
  deletedProjects,
  deletedTasks,
  deletedPeople,
  openMenuKey,
  toggleMenu,
  startEdit,
  deleteMaster,
  restoreProject,
  restoreTask,
  restorePerson,
  newGenbaName,
  setNewGenbaName,
  newTaskName,
  setNewTaskName,
  newPersonName,
  setNewPersonName,
  editKind,
  editId,
  editName,
  setEditName,
  addMaster,
  saveMasterEdit,
  closeMaster,
  closeMenu,
  onSurfaceClick,
  masterBodyRef,
  masterEditAnchorRef,
}) {
  
  useEffect(() => {
    if (!open) return;
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');

    window.history.pushState(null, null);

    const handlePopState = () => {
      if (viewport) viewport.setAttribute('content', 'width=1280');
      closeMaster();
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (viewport) viewport.setAttribute('content', 'width=1280');
    };
  }, [open]);
  
  if (!open) return null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <button className="btn" onClick={closeMaster}>
            ← 戻る
          </button>
          <div className="modalTitle">マスタ管理</div>
          <div style={{ width: 72 }} />
        </div>

        <div className="modalBody" ref={masterBodyRef} onClick={onSurfaceClick}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setMasterTab("genba")} disabled={masterTab === "genba"}>
              現場
            </button>
            <button className="btn" onClick={() => setMasterTab("task")} disabled={masterTab === "task"}>
              作業
            </button>
            <button className="btn" onClick={() => setMasterTab("people")} disabled={masterTab === "people"}>
              人員
            </button>
          </div>

          <div className="eventList">
            {(masterTab === "genba" ? projectsActive : masterTab === "task" ? tasksActive : peopleActiveSorted).map((row) => {
              const mk = `master-${masterTab}-${row.id}`;
              return (
                <div key={row.id} className="eventRow">
                  <div className="eventMain">{row.name}</div>

                  <div className="eventActions">
                    <button className="dots" onClick={(e) => (e.stopPropagation(), toggleMenu(mk))}>
                      …
                    </button>

                    {openMenuKey === mk && (
                      <div className="menu" onClick={(e) => e.stopPropagation()}>
                        <button className="menuBtn" onClick={() => startEdit(masterTab, row)}>
                          編集
                        </button>
                        <button className="menuBtn" onClick={() => (deleteMaster(masterTab, row.id), closeMenu())}>
                          削除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {masterTab === "genba" && deletedProjects.length > 0 && (
            <>
              <div style={{ height: 14 }} />
              <div className="sectionTitle" style={{ margin: 0 }}>
                削除済み
              </div>
              <div className="eventList" style={{ marginTop: 10 }}>
                {deletedProjects.map((p) => {
                  const mk = `master-deleted-genba-${p.id}`;
                  return (
                    <div key={p.id} className="eventRow">
                      <div className="eventMain">{p.name}（削除済み）</div>
                      <div className="eventActions">
                        <button className="dots" onClick={(e) => (e.stopPropagation(), toggleMenu(mk))}>
                          …
                        </button>
                        {openMenuKey === mk && (
                          <div className="menu" onClick={(e) => e.stopPropagation()}>
                            <button className="menuBtn" onClick={() => (restoreProject(p.id), closeMenu())}>
                              復元
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {masterTab === "task" && deletedTasks.length > 0 && (
            <>
              <div style={{ height: 14 }} />
              <div className="sectionTitle" style={{ margin: 0 }}>
                削除済み
              </div>
              <div className="eventList" style={{ marginTop: 10 }}>
                {deletedTasks.map((t) => {
                  const mk = `master-deleted-task-${t.id}`;
                  return (
                    <div key={t.id} className="eventRow">
                      <div className="eventMain">{t.name}（削除済み）</div>
                      <div className="eventActions">
                        <button className="dots" onClick={(e) => (e.stopPropagation(), toggleMenu(mk))}>
                          …
                        </button>
                        {openMenuKey === mk && (
                          <div className="menu" onClick={(e) => e.stopPropagation()}>
                            <button className="menuBtn" onClick={() => (restoreTask(t.id), closeMenu())}>
                              復元
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {masterTab === "people" && deletedPeople.length > 0 && (
            <>
              <div style={{ height: 14 }} />
              <div className="sectionTitle" style={{ margin: 0 }}>
                削除済み
              </div>
              <div className="eventList" style={{ marginTop: 10 }}>
                {deletedPeople.map((p) => {
                  const mk = `master-deleted-people-${p.id}`;
                  return (
                    <div key={p.id} className="eventRow">
                      <div className="eventMain">{p.name}（削除済み）</div>
                      <div className="eventActions">
                        <button className="dots" onClick={(e) => (e.stopPropagation(), toggleMenu(mk))}>
                          …
                        </button>
                        {openMenuKey === mk && (
                          <div className="menu" onClick={(e) => e.stopPropagation()}>
                            <button className="menuBtn" onClick={() => (restorePerson(p.id), closeMenu())}>
                              復元
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div style={{ height: 16 }} />

          <div className="form">
            {masterTab === "genba" && (
              <div className="field">
                <div className="label">現場を追加</div>
                <div className="addPersonRow">
                  <input className="input" value={newGenbaName} onChange={(e) => setNewGenbaName(e.target.value)} placeholder="例：新しい現場名" />
                  <button className="btn" onClick={() => addMaster("genba")}>
                    追加
                  </button>
                </div>
              </div>
            )}

            {masterTab === "task" && (
              <div className="field">
                <div className="label">作業を追加</div>
                <div className="addPersonRow">
                  <input className="input" value={newTaskName} onChange={(e) => setNewTaskName(e.target.value)} placeholder="例：新しい作業名" />
                  <button className="btn" onClick={() => addMaster("task")}>
                    追加
                  </button>
                </div>
              </div>
            )}

            {masterTab === "people" && (
              <div className="field">
                <div className="label">人員を追加</div>
                <div className="addPersonRow">
                  <input className="input" value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder="例：田中" />
                  <button className="btn" onClick={() => addMaster("people")}>
                    追加
                  </button>
                </div>
              </div>
            )}

            <div ref={masterEditAnchorRef} style={{ height: 1 }} />

            <div className="field">
              <div className="label">名前を編集</div>
              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="一覧の「…→編集」で選んでから変更" />
              <button className="btn primary" disabled={!editKind || !editId || !norm(editName)} onClick={saveMasterEdit}>
                保存
              </button>
            </div>
          </div>
        </div>

        <div className="modalFooter">
          <button className="btn primary" onClick={closeMaster}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

