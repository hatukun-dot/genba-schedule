import React, { useState } from "react";
import { norm } from "../../utils/id";

const CLOSING_TYPES = ["20日締め", "月末締め"];
const OUTPUT_TYPES = ["請求書＋明細書", "請求書兼明細書", "リストのみ", "出力しない"];
const BILLING_TYPES = ["人工", "現場単位"];

export function ExcelModal({
  open,
  monthLabel,
  billingTargets,
  onUpdateBillingTarget,
  onAddBillingTarget,
  onMergeBillingTargets,
  onExport,
  onClose,
  onSurfaceClick,
}) {
  const [tab, setTab] = useState("list"); // "list" | "settings" | "merge"
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [mergeTargetId, setMergeTargetId] = useState(null);
  const [mergeSourceIds, setMergeSourceIds] = useState(new Set());
  const [editingNameId, setEditingNameId] = useState(null);
  const [editingNameVal, setEditingNameVal] = useState("");
  const [settingsTargetId, setSettingsTargetId] = useState(null);

  if (!open) return null;

  const activeTargets = (billingTargets || []);

  // 一括チェック
  function checkAll() {
    setCheckedIds(new Set(activeTargets.map((t) => t.id)));
  }
  function checkClosing(type) {
    setCheckedIds(new Set(activeTargets.filter((t) => t.closingType === type).map((t) => t.id)));
  }
  function toggleCheck(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 設定中のターゲット
  const settingsTarget = activeTargets.find((t) => t.id === settingsTargetId) ?? null;

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <button className="btn" onClick={onClose}>
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
            <button className="btn" onClick={() => setTab("merge")} disabled={tab === "merge"}>統合</button>
          </div>

          {/* ===== 請求先タブ ===== */}
          {tab === "list" && (
            <>
              {/* 一括選択ボタン */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <button className="btn" onClick={checkAll}>一括</button>
                <button className="btn" onClick={() => checkClosing("20日締め")}>20日締め</button>
                <button className="btn" onClick={() => checkClosing("月末締め")}>月末締め</button>
              </div>

              {/* 請求先リスト */}
              <div className="eventList">
                {activeTargets.map((t) => (
                  <div key={t.id} className="eventRow" style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                          {t.name}
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
                      onClick={() => {
                        setEditingNameId(t.id);
                        setEditingNameVal(t.name);
                      }}
                    >
                      名称変更
                    </button>
                  </div>
                ))}
              </div>

              {/* 請求先追加 */}
              <div style={{ marginTop: 14 }}>
                <button
                  className="btn"
                  onClick={() => onAddBillingTarget()}
                >
                  ＋ 請求先を追加
                </button>
              </div>
            </>
          )}

          {/* ===== 設定タブ ===== */}
          {tab === "settings" && (
            <>
              {/* 請求先選択 */}
              <div className="field" style={{ marginBottom: 14 }}>
                <div className="label">設定する請求先</div>
                <div className="chips" style={{ gridTemplateColumns: "repeat(2, 1fr)", maxHeight: 120 }}>
                  {activeTargets.map((t) => (
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
                  {/* 単価 */}
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

                  {/* 締め日 */}
                  <div className="field">
                    <div className="label">締め日</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {CLOSING_TYPES.map((ct) => (
                        <button
                          key={ct}
                          className={`btn ${settingsTarget.closingType === ct ? "primary" : ""}`}
                          onClick={() => onUpdateBillingTarget(settingsTarget.id, { closingType: ct })}
                        >
                          {ct}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 出力方式 */}
                  <div className="field">
                    <div className="label">出力方式</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {OUTPUT_TYPES.map((ot) => (
                        <button
                          key={ot}
                          className={`btn ${settingsTarget.outputType === ot ? "primary" : ""}`}
                          onClick={() => onUpdateBillingTarget(settingsTarget.id, { outputType: ot })}
                        >
                          {ot}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 請求方式 */}
                  <div className="field">
                    <div className="label">請求方式</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {BILLING_TYPES.map((bt) => (
                        <button
                          key={bt}
                          className={`btn ${settingsTarget.billingType === bt ? "primary" : ""}`}
                          onClick={() => onUpdateBillingTarget(settingsTarget.id, { billingType: bt })}
                        >
                          {bt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 担当者ごとにまとめる */}
                  <div className="field">
                    <div className="label">担当者ごとにまとめる</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className={`btn ${settingsTarget.groupByManager ? "primary" : ""}`}
                        onClick={() => onUpdateBillingTarget(settingsTarget.id, { groupByManager: true })}
                      >
                        ON
                      </button>
                      <button
                        className={`btn ${!settingsTarget.groupByManager ? "primary" : ""}`}
                        onClick={() => onUpdateBillingTarget(settingsTarget.id, { groupByManager: false })}
                      >
                        OFF
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ===== 統合タブ ===== */}
          {tab === "merge" && (
            <>
              <div style={{ color: "rgba(0,0,0,.65)", fontSize: 13, marginBottom: 12 }}>
                統合先を選んで、統合する請求先にチェックを入れてください
              </div>

              {/* 統合先選択 */}
              <div className="field" style={{ marginBottom: 14 }}>
                <div className="label">統合先</div>
                <div className="chips" style={{ gridTemplateColumns: "repeat(2, 1fr)", maxHeight: 120 }}>
                  {activeTargets.map((t) => (
                    <button
                      key={t.id}
                      className={`chip ${mergeTargetId === t.id ? "active" : ""}`}
                      onClick={() => {
                        setMergeTargetId(t.id);
                        setMergeSourceIds(new Set());
                      }}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 統合元選択 */}
              {mergeTargetId && (
                <div className="field" style={{ marginBottom: 14 }}>
                  <div className="label">統合する請求先（チェック）</div>
                  <div className="eventList">
                    {activeTargets.filter((t) => t.id !== mergeTargetId).map((t) => (
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
                        <span>{t.name}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    className="btn primary"
                    style={{ marginTop: 12 }}
                    disabled={mergeSourceIds.size === 0}
                    onClick={() => {
                      onMergeBillingTargets(mergeTargetId, Array.from(mergeSourceIds));
                      setMergeTargetId(null);
                      setMergeSourceIds(new Set());
                    }}
                  >
                    統合実行
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* フッター：出力ボタン */}
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
