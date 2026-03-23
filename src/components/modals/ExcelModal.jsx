import React, { useEffect, useState } from "react";
import { norm } from "../../utils/id";

const CLOSING_TYPES = ["20日締め", "月末締め"];
const OUTPUT_TYPES = ["請求書＋明細書", "請求書兼明細書", "リストのみ", "出力しない"];
const BILLING_TYPES = ["人工", "現場単位"];

export function ExcelModal({
  open,
  monthLabel,
  billingTargets,
  projects,
  onUpdateBillingTarget,
  onAddBillingTarget,
  onMergeBillingTargets,
  onDetachFromGroup,
  onExport,
  onClose,
  onSurfaceClick,
}) {
  const [tab, setTab] = useState("list");
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [expandedGroupIds, setExpandedGroupIds] = useState(new Set());
  const [mergeTargetId, setMergeTargetId] = useState(null);
  const [mergeSourceIds, setMergeSourceIds] = useState(new Set());
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingNameVal, setEditingNameVal] = useState("");
  const [settingsTargetId, setSettingsTargetId] = useState(null);

  useEffect(() => {
    if (!open) return;
    document.body.style.zoom = '1';
    return () => { document.body.style.zoom = ''; };
  }, [open]);

  if (!open) return null;

  const allTargets = (billingTargets || []);

  // 親（groupIdがnull）と子（groupIdがある）を分類
  const parents = allTargets.filter((t) => !t.groupId);
  const childrenOf = (parentId) => allTargets.filter((t) => t.groupId === parentId);

  // 一括チェック（親のみ対象）
  function checkAll() {
    setCheckedIds(new Set(parents.map((t) => t.id)));
  }
  function checkClosing(type) {
    setCheckedIds(new Set(parents.filter((t) => t.closingType === type).map((t) => t.id)));
  }
  function toggleCheck(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleExpand(id) {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 設定タブ：子を除いた親のみ
  const settingsTargets = parents;
  const settingsTarget = settingsTargets.find((t) => t.id === settingsTargetId) ?? null;

  // 統合タブ：親のみを統合先候補に
  // 統合先を選んだ時、その子をチェック済みで表示
  function onSelectMergeTarget(id) {
    setMergeTargetId(id);
    const children = childrenOf(id);
    setMergeSourceIds(new Set(children.map((c) => c.id)));
  }

  // 統合実行：チェックありは統合先のグループに追加、チェックなしは分離
  async function executeMerge() {
    if (!mergeTargetId) return;
    const children = childrenOf(mergeTargetId);

    // 現在の子でチェックが外れたものは分離
    for (const c of children) {
      if (!mergeSourceIds.has(c.id)) {
        await onDetachFromGroup(c.id);
      }
    }

    // チェックされたもの（既存の子以外）はグループに追加
    const existingChildIds = new Set(children.map((c) => c.id));
    const newSources = Array.from(mergeSourceIds).filter((id) => !existingChildIds.has(id));
    if (newSources.length > 0) {
      await onMergeBillingTargets(mergeTargetId, newSources);
    }

    setMergeTargetId(null);
    setMergeSourceIds(new Set());
  }

  // 統合元候補：親のうち統合先以外 ＋ 統合先の子（分離用）
  const mergeSourceCandidates = mergeTargetId
    ? [
        ...childrenOf(mergeTargetId), // 既存の子（チェック済みで表示、外すと分離）
        ...parents.filter((t) => t.id !== mergeTargetId && !t.groupId), // 他の親
      ]
    : [];

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <button className="btn" onClick={onClose} style={{ whiteSpace: "nowrap" }}>
            ← 戻る
          </button>
          <div className="modalTitle">Excel出力 {monthLabel}</div>
          <div style={{ width: 72 }} />
        </div>

        <div className="modalBody" onClick={onSurfaceClick}>
          {/* タブ */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setTab("list")} disabled={tab === "list"}>請求先</button>
            <button className="btn" onClick={() => setTab("settings")} disabled={tab === "settings"}>設定</button>
            <button className="btn" onClick={() => setTab("merge")} disabled={tab === "merge"}>グループ</button>
          </div>

          {/* ===== 請求先タブ ===== */}
          {tab === "list" && (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <button className="btn" onClick={checkAll}>一括</button>
                <button className="btn" onClick={() => checkClosing("20日締め")}>20日締め</button>
                <button className="btn" onClick={() => checkClosing("月末締め")}>月末締め</button>
              </div>

              <div className="eventList">
                {parents.map((t) => {
                  const children = childrenOf(t.id);
                  const hasChildren = children.length > 0;
                  const isExpanded = expandedGroupIds.has(t.id);
                  // 現場名と請求先名が違う場合は（現場名）を表示
                  const linkedProject = t.projectId
                    ? (projects || []).find((p) => p.id === t.projectId)
                    : null;
                  const projectName = linkedProject?.name ?? null;
                  const displayName = projectName && projectName !== t.name
                    ? `${t.name}（${projectName}）`
                    : t.name;

                  return (
                    <div key={t.id}>
                      {/* 親行 */}
                      <div className="eventRow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={checkedIds.has(t.id)}
                          onChange={() => toggleCheck(t.id)}
                          style={{ flexShrink: 0 }}
                        />
                        {editingNameId === t.id ? (
                          <input
                            className="input"
                            style={{ flex: 1 }}
                            value={editingNameVal}
                            onChange={(e) => setEditingNameVal(e.target.value)}
                            onBlur={() => {
                              const n = norm(editingNameVal);
                              if (n) onUpdateBillingTarget(t.id, { name: n });
                              setEditingNameId(null);
                            }}
                            autoFocus
                          />
                        ) : (
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {displayName}
                            </div>
                            <div style={{ fontSize: 12, color: "rgba(0,0,0,.55)" }}>
                              {t.closingType}・{t.outputType}・{t.billingType}
                              {t.groupByManager ? "・担当者別" : ""}
                            </div>
                          </div>
                        )}
                        <button
                          className="btn"
                          style={{ flexShrink: 0, fontSize: 12, padding: "6px 10px" }}
                          onClick={() => { setEditingNameId(t.id); setEditingNameVal(t.name); }}
                        >
                          名称変更
                        </button>
                        {hasChildren && (
                          <button
                            className="btn"
                            style={{ flexShrink: 0, fontSize: 14, padding: "6px 10px", fontWeight: 900 }}
                            onClick={() => toggleExpand(t.id)}
                          >
                            {isExpanded ? "－" : "＋"}
                          </button>
                        )}
                      </div>

                      {/* 子行（展開時） */}
                      {hasChildren && isExpanded && (
                        <div style={{ marginLeft: 24, marginTop: 4, display: "grid", gap: 4 }}>
                          {children.map((c) => (
                            <div key={c.id} className="eventRow" style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,.03)" }}>
                              <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14 }}>
                                {c.name}
                              </div>
                              {editingNameId === c.id ? (
                                <input
                                  className="input"
                                  style={{ flex: 1 }}
                                  value={editingNameVal}
                                  onChange={(e) => setEditingNameVal(e.target.value)}
                                  onBlur={() => {
                                    const n = norm(editingNameVal);
                                    if (n) onUpdateBillingTarget(c.id, { name: n });
                                    setEditingNameId(null);
                                  }}
                                  autoFocus
                                />
                              ) : (
                                <button
                                  className="btn"
                                  style={{ flexShrink: 0, fontSize: 12, padding: "4px 8px" }}
                                  onClick={() => { setEditingNameId(c.id); setEditingNameVal(c.name); }}
                                >
                                  名称変更
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 14 }}>
                <button className="btn" onClick={() => onAddBillingTarget()}>
                  ＋ 請求先を追加
                </button>
              </div>
            </>
          )}

          {/* ===== 設定タブ ===== */}
          {tab === "settings" && (
            <>
              <div className="field" style={{ marginBottom: 14 }}>
                <div className="label">設定する請求先</div>
                <div className="chips" style={{ gridTemplateColumns: "repeat(3, 1fr)", maxHeight: 120 }}>
                  {settingsTargets.map((t) => (
                    <button
                      key={t.id}
                      className={`chip ${settingsTargetId === t.id ? "active" : ""}`}
                      onClick={() => setSettingsTargetId(t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              {settingsTarget && (
                <div className="form">
                  <div className="field">
                    <div className="label">単価（空欄可）</div>
                    <input
                      className="input"
                      type="number"
                      value={settingsTarget.unitPrice ?? ""}
                      placeholder="例：15000"
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        onUpdateBillingTarget(settingsTarget.id, { unitPrice: v });
                      }}
                    />
                  </div>
                  <div className="field">
                    <div className="label">締め日</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {CLOSING_TYPES.map((ct) => (
                        <button key={ct} className={`btn ${settingsTarget.closingType === ct ? "primary" : ""}`}
                          onClick={() => onUpdateBillingTarget(settingsTarget.id, { closingType: ct })}>
                          {ct}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <div className="label">出力方式</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {OUTPUT_TYPES.map((ot) => (
                        <button key={ot} className={`btn ${settingsTarget.outputType === ot ? "primary" : ""}`}
                          onClick={() => onUpdateBillingTarget(settingsTarget.id, { outputType: ot })}>
                          {ot}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <div className="label">請求方式</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {BILLING_TYPES.map((bt) => (
                        <button key={bt} className={`btn ${settingsTarget.billingType === bt ? "primary" : ""}`}
                          onClick={() => onUpdateBillingTarget(settingsTarget.id, { billingType: bt })}>
                          {bt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <div className="label">担当者ごとにまとめる</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className={`btn ${settingsTarget.groupByManager ? "primary" : ""}`}
                        onClick={() => onUpdateBillingTarget(settingsTarget.id, { groupByManager: true })}>ON</button>
                      <button className={`btn ${!settingsTarget.groupByManager ? "primary" : ""}`}
                        onClick={() => onUpdateBillingTarget(settingsTarget.id, { groupByManager: false })}>OFF</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ===== グループタブ ===== */}
          {tab === "merge" && (
            <>
              <div style={{ color: "rgba(0,0,0,.65)", fontSize: 13, marginBottom: 12 }}>
                グループ親を選んで、まとめる請求先にチェックを入れてください。既存のチェックを外して実行すると分離されます。
              </div>

              <div className="field" style={{ marginBottom: 14 }}>
                <div className="label">グループ親</div>
                <div className="chips" style={{ gridTemplateColumns: "repeat(3, 1fr)", maxHeight: 120 }}>
                  {parents.map((t) => (
                    <button
                      key={t.id}
                      className={`chip ${mergeTargetId === t.id ? "active" : ""}`}
                      onClick={() => onSelectMergeTarget(t.id)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              {mergeTargetId && (
                <div className="field" style={{ marginBottom: 14 }}>
                  <div className="label">グループに含める請求先</div>
                  <div style={{ color: "rgba(0,0,0,.55)", fontSize: 12, marginBottom: 8 }}>
                    ※チェックあり＝グループに含む　チェックなし＝グループから外す
                  </div>
                  <div className="eventList">
                    {mergeSourceCandidates.map((t) => {
                      const isExistingChild = t.groupId === mergeTargetId;
                      return (
                        <div key={t.id} className="eventRow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={mergeSourceIds.has(t.id)}
                            onChange={() => {
                              setMergeSourceIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(t.id)) next.delete(t.id);
                                else next.add(t.id);
                                return next;
                              });
                            }}
                          />
                          <span style={{ flex: 1 }}>{t.name}</span>
                          {isExistingChild && (
                            <span style={{ fontSize: 11, color: "rgba(0,0,0,.45)" }}>グループ中</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className="btn primary"
                    style={{ marginTop: 12 }}
                    onClick={executeMerge}
                  >
                    実行
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modalFooter">
          <button
            className="btn primary"
            disabled={checkedIds.size === 0}
            onClick={() => onExport(Array.from(checkedIds))}
          >
            Excel出力（{checkedIds.size}件）
          </button>
        </div>
      </div>
    </div>
  );
}
