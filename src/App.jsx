import React, { useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import * as XLSX from "xlsx";
import { db, seedIfNeeded, COLOR_PALETTE } from "./db";
import { supabase } from "./supabase";

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fromYmd(ymd) {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}
function addDaysYmd(ymd, delta) {
  const d = fromYmd(ymd);
  d.setDate(d.getDate() + delta);
  return toYmd(d);
}
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function norm(s) {
  return (s ?? "").trim();
}
function sameDay(a, b) {
  return a && b && a === b;
}

// ID正規化（Supabase/Dexie/フォーム混在の型ズレ潰し）
function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}
function toInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}
function uniqNumArray(arr) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const n = toInt(v);
    if (n === null) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

// 「休み」「応援」の優先順位（表示用）
function pinRank(genbaName) {
  if (genbaName === "休み") return 0;
  if (genbaName === "応援") return 1;
  return 2;
}

// people_count NOT NULL 対策（DBは0で保存、UIはnullとして扱う）
function toDbPeopleCount(appCount) {
  if (appCount === null || appCount === undefined) return 0;
  const n = Number(appCount);
  if (!Number.isFinite(n)) return 0;
  return clamp(n, 0, 99);
}
function fromDbPeopleCount(dbCount) {
  const n = Number(dbCount);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

// 月曜始まりの 6週(42セル)カレンダー
function buildMonthGrid(year, monthIndex0, opts = {}) {
  const fillOutside = Boolean(opts.fillOutside);

  const first = new Date(year, monthIndex0, 1);
  const firstDow = first.getDay(); // 0(日)1(月)...
  const offset = (firstDow + 6) % 7; // 月=0 ... 日=6

  const gridStart = new Date(year, monthIndex0, 1 - offset);

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);

    const inMonth = date.getFullYear() === year && date.getMonth() === monthIndex0;
    if (!inMonth && !fillOutside) {
      cells.push({ type: "blank", key: `b-${year}-${monthIndex0}-${i}` });
    } else {
      cells.push({
        type: "date",
        date,
        ymd: toYmd(date),
        key: toYmd(date),
        inMonth,
      });
    }
  }

  return { cells, gridStart };
}

function mondayOfYmd(ymd) {
  const d = fromYmd(ymd);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toYmd(monday);
}

// Excelのシート名制約
function sanitizeSheetName(name) {
  const n = String(name ?? "").trim() || "（無名）";
  const cleaned = n.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 31) || "（無名）";
}
function uniqueSheetName(desired, usedSet) {
  let base = sanitizeSheetName(desired);
  let name = base;
  let i = 2;
  while (usedSet.has(name)) {
    const suffix = `(${i})`;
    name = (base.slice(0, Math.max(0, 31 - suffix.length)) + suffix).slice(0, 31);
    i++;
  }
  usedSet.add(name);
  return name;
}

/** Supabase row -> App shape（camelCaseに正規化） */
function normalizeProjectRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    name: r.name,
    createdAt: r.created_at ?? r.createdAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}
function normalizeTaskRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    name: r.name,
    createdAt: r.created_at ?? r.createdAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}
function normalizePeopleRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    name: r.name,
    createdAt: r.created_at ?? r.createdAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}
function normalizeEventRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    date: r.date ?? null,
    bucket: r.bucket ?? null,
    projectId: toIntOrNull(r.project_id ?? r.projectId ?? null),
    taskId: toIntOrNull(r.task_id ?? r.taskId ?? null),
    note: r.note ?? null,
    peopleCount: fromDbPeopleCount(r.people_count ?? r.peopleCount ?? null),
    peopleIds: uniqNumArray(r.people_ids ?? r.peopleIds ?? []),
    color: r.color ?? null,
    order: r.order ?? 0,
    createdAt: r.created_at ?? r.createdAt ?? null,
    updatedAt: r.updated_at ?? r.updatedAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

// ============================================================
// Auth（共有アカウント前提）
// ============================================================

const AuthCtx = createContext(null);
function useAuth() {
  return useContext(AuthCtx);
}

function AuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let unsub = null;

    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setReady(true);

      const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
        setSession(s ?? null);
      });
      unsub = sub?.subscription;
    })();

    return () => {
      try {
        unsub?.unsubscribe?.();
      } catch {}
    };
  }, []);

  const signIn = async () => {
    setErr("");
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      setSession(data.session ?? null);
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await supabase.auth.signOut();
      setSession(null);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return <div style={{ padding: 16, fontFamily: "sans-serif" }}>読み込み中…</div>;
  }

  if (!session) {
    return (
      <div style={{ padding: 16, fontFamily: "sans-serif", maxWidth: 420 }}>
        <h3 style={{ margin: "0 0 12px" }}>共有アカウントでログイン</h3>

        <div style={{ display: "grid", gap: 8 }}>
          <input
            placeholder="メール"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              placeholder="パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              style={{ padding: 10, borderRadius: 8, border: "1px solid #ccc", flex: 1 }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #ccc",
                background: "#fff",
                cursor: "pointer",
                userSelect: "none",
              }}
              aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}
            >
              {showPw ? "🙈" : "👁"}
            </button>
          </div>

          <button onClick={signIn} disabled={busy || !email || !password} style={{ padding: 10, borderRadius: 8 }}>
            {busy ? "ログイン中…" : "ログイン"}
          </button>

          {err ? <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{err}</div> : null}

          <div style={{ fontSize: 12, color: "#666" }}>※ RLS が authenticated のため、ログインしないとデータは読めません。</div>
        </div>
      </div>
    );
  }

  return (
    <AuthCtx.Provider value={{ session, signOut, authBusy: busy }}>
      {children}
    </AuthCtx.Provider>
  );
}

export default function App() {
  // ✅ useAuth() を App（AuthGate外）で呼ばない
  return (
    <AuthGate>
      <AppInner />
    </AuthGate>
  );
}

function AppInner() {
  const { session, signOut, authBusy } = useAuth();

  // ============================================================
  // エラー表示統一（alert廃止）
  // ============================================================
  const [appError, setAppError] = useState(null);
  const pushError = (message, detail) => {
    const msg = message ? String(message) : "エラーが発生しました";
    const det = detail ? String(detail) : "";
    setAppError({ message: msg, detail: det, at: new Date().toISOString() });
  };
  const clearError = () => setAppError(null);

  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const year = monthCursor.getFullYear();
  const monthIndex0 = monthCursor.getMonth();
  const monthLabel = `${year}年${monthIndex0 + 1}月`;

  // ★月画面は月外も表示＆押せる
  const { cells: gridCells, gridStart } = useMemo(() => buildMonthGrid(year, monthIndex0, { fillOutside: true }), [
    year,
    monthIndex0,
  ]);

  // 6週×7日
  const weeks = useMemo(() => {
    const out = [];
    for (let w = 0; w < 6; w++) {
      const row = gridCells.slice(w * 7, w * 7 + 7);
      const monday = new Date(gridStart);
      monday.setDate(monday.getDate() + w * 7);
      out.push({ row, mondayYmd: toYmd(monday), w });
    }
    return out;
  }, [gridCells, gridStart]);

  const [projects, setProjects] = useState([]); // 現場（削除済み含む）
  const [tasks, setTasks] = useState([]); // 作業（削除済み含む）
  const [peopleAll, setPeopleAll] = useState([]); // 人員（削除済み含む）

  // ★人員累計使用回数（personId -> count） Dexieに残す（無ければ空）
  const [peopleUsageMap, setPeopleUsageMap] = useState({});

  // ★人員（表示順は「累計選択回数」降順、同数は名前順）
  const peopleActiveSorted = useMemo(() => {
    const list = (peopleAll || []).filter((p) => p.deletedAt === null || p.deletedAt === undefined);
    return list.slice().sort((a, b) => {
      const ca = peopleUsageMap[a.id] ?? 0;
      const cb = peopleUsageMap[b.id] ?? 0;
      if (ca !== cb) return cb - ca;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
    });
  }, [peopleAll, peopleUsageMap]);

  // ★現場/作業：アクティブのみ（候補に出す用）
  const projectsActive = useMemo(
    () => (projects || []).filter((p) => p.deletedAt === null || p.deletedAt === undefined),
    [projects]
  );
  const tasksActive = useMemo(() => (tasks || []).filter((t) => t.deletedAt === null || t.deletedAt === undefined), [
    tasks,
  ]);

  const deletedProjects = useMemo(() => (projects || []).filter((p) => p.deletedAt), [projects]);
  const deletedTasks = useMemo(() => (tasks || []).filter((t) => t.deletedAt), [tasks]);

  // Dexie側に残す（なければ空）
  const [taskUsageMap, setTaskUsageMap] = useState({});
  const [projectUsageMap, setProjectUsageMap] = useState({});

  const [eventsByKey, setEventsByKey] = useState({});
  const [reloadTick, setReloadTick] = useState(0);

  // --- 画面状態 ---
  const [isDayOpen, setIsDayOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null); // ymd or "TBD"
  const dayBodyRef = useRef(null);

  const [isWeekOpen, setIsWeekOpen] = useState(false);
  const [weekStartYmd, setWeekStartYmd] = useState(null);
  const weekBodyRef = useRef(null);

  const [returnWeekStart, setReturnWeekStart] = useState(null);

  // --- メニュー（…）は同時に1つだけ ---
  const [openMenuKey, setOpenMenuKey] = useState(null); // string|null
  function toggleMenu(key) {
    setOpenMenuKey((prev) => (prev === key ? null : key));
  }
  function closeMenu() {
    setOpenMenuKey(null);
  }

  // --- マスタ管理 ---
  const [isMasterOpen, setIsMasterOpen] = useState(false);
  const [masterTab, setMasterTab] = useState("genba"); // genba | task | people
  const [newGenbaName, setNewGenbaName] = useState("");
  const [newTaskName, setNewTaskName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonInline, setNewPersonInline] = useState("");
  const [editKind, setEditKind] = useState(null); // "genba"|"task"|"people"|null
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");

  const masterBodyRef = useRef(null);
  const masterEditAnchorRef = useRef(null);

  // --- 予定追加/編集フォーム ---
  const [projectInput, setProjectInput] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [note, setNote] = useState("");
  const [peopleCount, setPeopleCount] = useState(null);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [peopleCountManual, setPeopleCountManual] = useState(false);
  const [color, setColor] = useState(null);
  const [editingEventId, setEditingEventId] = useState(null);

  // --- 複数日に追加（モーダル） ---
  const [isMultiAddOpen, setIsMultiAddOpen] = useState(false);
  const [multiMode, setMultiMode] = useState("range"); // "range" | "multi" | "weekday"
  const [multiCursor, setMultiCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  // 3方式の「状態」を保持（切替しても消さない）
  const [rangeStartYmd, setRangeStartYmd] = useState(null);
  const [rangeEndYmd, setRangeEndYmd] = useState(null);
  const [multiSelectedYmds, setMultiSelectedYmds] = useState(() => new Set()); // 複数選択
  const [weekdaySelected, setWeekdaySelected] = useState(() => new Set()); // 曜日選択（0..6）

  const multiYear = multiCursor.getFullYear();
  const multiMonthIndex0 = multiCursor.getMonth();
  const multiMonthLabel = `${multiYear}年${multiMonthIndex0 + 1}月`;
  const { cells: multiGridCells } = useMemo(
    () => buildMonthGrid(multiYear, multiMonthIndex0), // ★モーダルは従来通り（月外はblank）
    [multiYear, multiMonthIndex0]
  );

  function openMultiAdd() {
    if (!selectedKey) return;

    const base = selectedKey !== "TBD" ? fromYmd(selectedKey) : new Date();
    setMultiCursor(new Date(base.getFullYear(), base.getMonth(), 1));

    // ★開いたときは初期化（仕様どおり）
    setMultiMode("multi");
    setRangeStartYmd(null);
    setRangeEndYmd(null);
    setMultiSelectedYmds(new Set());
    setWeekdaySelected(new Set());

    setIsMultiAddOpen(true);
    closeMenu();
  }

  function closeMultiAdd() {
    // ★キャンセル＝入力保持（フォームは触らない）
    setIsMultiAddOpen(false);
  }

  function ymdInMultiMonth(ymd) {
    const d = fromYmd(ymd);
    return d.getFullYear() === multiYear && d.getMonth() === multiMonthIndex0;
  }

  function isWeekendYmd(ymd) {
    const d = fromYmd(ymd);
    const dow = d.getDay(); // 0 Sun ... 6 Sat
    return dow === 0 || dow === 6;
  }

  function deriveRangeYmds() {
    // ★土日除外は常に固定
    if (!rangeStartYmd || !rangeEndYmd) return [];
    let a = rangeStartYmd;
    let b = rangeEndYmd;
    if (a > b) [a, b] = [b, a];

    const out = [];
    let cur = a;
    while (cur <= b) {
      if (ymdInMultiMonth(cur) && !isWeekendYmd(cur)) out.push(cur);
      cur = addDaysYmd(cur, 1);
    }
    return out;
  }

  function deriveWeekdayYmds() {
    if (weekdaySelected.size === 0) return [];
    const out = [];
    for (const cell of multiGridCells) {
      if (cell.type !== "date") continue;
      const dow = cell.date.getDay();
      if (weekdaySelected.has(dow)) out.push(cell.ymd);
    }
    return out;
  }

  function buildSelectedYmdsForConfirm() {
    // ★3方式を「合成」して最終出力
    const set = new Set();
    for (const y of multiSelectedYmds) if (ymdInMultiMonth(y)) set.add(y);
    for (const y of deriveRangeYmds()) set.add(y);
    for (const y of deriveWeekdayYmds()) set.add(y);
    return Array.from(set).sort();
  }

  // --- 予定移動（モーダル） ---
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [moveEventId, setMoveEventId] = useState(null);
  const [moveCursor, setMoveCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const moveYear = moveCursor.getFullYear();
  const moveMonthIndex0 = moveCursor.getMonth();
  const moveMonthLabel = `${moveYear}年${moveMonthIndex0 + 1}月`;
  const { cells: moveGridCells } = useMemo(
    () => buildMonthGrid(moveYear, moveMonthIndex0), // ★モーダルは従来通り（月外はblank）
    [moveYear, moveMonthIndex0]
  );

  // ============================================================
  // order安定化：order → createdAt → id
  // ============================================================
  function stableEventSort(a, b) {
    const ao = Number(a?.order ?? 0);
    const bo = Number(b?.order ?? 0);
    if (ao !== bo) return ao - bo;

    const ac = a?.createdAt ? Date.parse(a.createdAt) : NaN;
    const bc = b?.createdAt ? Date.parse(b.createdAt) : NaN;

    const aHas = Number.isFinite(ac);
    const bHas = Number.isFinite(bc);
    if (aHas && bHas && ac !== bc) return ac - bc;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;

    const ai = Number(a?.id ?? 0);
    const bi = Number(b?.id ?? 0);
    if (ai !== bi) return ai - bi;

    // 最終保険（同一判定回避）
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  }

  // 表示用：キー単位で常に安定ソートした配列を返す
  const selectedEvents = useMemo(() => {
    if (!selectedKey) return [];
    const list = (eventsByKey[selectedKey] || []).slice();
    list.sort(stableEventSort);
    return list;
  }, [eventsByKey, selectedKey]);

  function openMoveModal(eventId) {
    const e = (selectedEvents || []).find((x) => x.id === eventId);
    const base =
      e?.bucket === "TBD"
        ? new Date()
        : e?.date
        ? fromYmd(e.date)
        : selectedKey && selectedKey !== "TBD"
        ? fromYmd(selectedKey)
        : new Date();
    setMoveCursor(new Date(base.getFullYear(), base.getMonth(), 1));
    setMoveEventId(eventId);
    setIsMoveOpen(true);
    closeMenu();
  }

  function closeMoveModal() {
    setIsMoveOpen(false);
    setMoveEventId(null);
  }

  async function moveEventToYmdInstant(ymd) {
    if (!moveEventId) return;

    const { error } = await supabase
      .from("events")
      .update({
        date: ymd,
        bucket: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", moveEventId);

    if (error) {
      console.error("moveEventToYmdInstant error", error);
      pushError("移動に失敗しました", error?.message || String(error));
      return;
    }

    closeMoveModal();
    closeMenu();
    closeDay(); // 移動したので一旦閉じる（分かりやすさ優先）
    setReloadTick((x) => x + 1);
  }

  async function moveEventToTbdInstant() {
    if (!moveEventId) return;

    const { error } = await supabase
      .from("events")
      .update({
        date: "3000-01-01",
        bucket: "TBD",
        updated_at: new Date().toISOString(),
      })
      .eq("id", moveEventId);

    if (error) {
      console.error("moveEventToTbdInstant error", error);
      pushError("移動に失敗しました", error?.message || String(error));
      return;
    }

    closeMoveModal();
    closeMenu();
    closeDay();
    setReloadTick((x) => x + 1);
  }

  // ============================================================
  // ログアウト時 state 全クリア（Phase1-1）
  // ============================================================
  function resetAppState() {
    // UI
    setIsDayOpen(false);
    setSelectedKey(null);
    setIsWeekOpen(false);
    setWeekStartYmd(null);
    setReturnWeekStart(null);

    setIsMasterOpen(false);
    setMasterTab("genba");
    setOpenMenuKey(null);

    setIsMultiAddOpen(false);
    setMultiMode("range");
    setRangeStartYmd(null);
    setRangeEndYmd(null);
    setMultiSelectedYmds(new Set());
    setWeekdaySelected(new Set());

    setIsMoveOpen(false);
    setMoveEventId(null);

    // フォーム
    setProjectInput("");
    setTaskInput("");
    setNote("");
    setPeopleCount(null);
    setSelectedPeopleIds([]);
    setPeopleCountManual(false);
    setColor(null);
    setEditingEventId(null);

    setNewGenbaName("");
    setNewTaskName("");
    setNewPersonName("");
    setNewPersonInline("");
    setEditKind(null);
    setEditId(null);
    setEditName("");

    // データ（共有端末の残像対策）
    setProjects([]);
    setTasks([]);
    setPeopleAll([]);
    setEventsByKey({});
    setTaskUsageMap({});
    setProjectUsageMap({});
    setPeopleUsageMap({});

    // 画面位置
    try {
      dayBodyRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
      weekBodyRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
      masterBodyRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
    } catch {}

    clearError();

    // カーソルは当月へ
    const d = new Date();
    setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setReloadTick((x) => x + 1);
  }

  async function handleLogout() {
    // 共有運用：まず見た目を消す → signOut → 念のためもう一回
    resetAppState();
    try {
      await signOut();
    } catch (e) {
      console.error("signOut error", e);
      pushError("ログアウトに失敗しました", e?.message || String(e));
    } finally {
      resetAppState();
    }
  }

  // ============================================================
  // ===== 初期ロード（Supabase前提）=====
  // ============================================================

  useEffect(() => {
    (async () => {
      try {
        await seedIfNeeded();
      } catch {}

      await reloadMasters();
      await reloadTaskUsage();
      await reloadProjectUsage();
      await reloadPeopleUsage();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      await reloadProjectUsage();
      await reloadPeopleUsage();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  async function reloadMasters() {
    const [pRes, tRes, peRes] = await Promise.all([
      supabase.from("projects").select("*"),
      supabase.from("tasks").select("*").order("name", { ascending: true }),
      supabase.from("people").select("*").order("name", { ascending: true }),
    ]);

    if (pRes.error) {
      console.error("projects load error", pRes.error);
      pushError("現場の読み込みに失敗しました", pRes.error?.message || String(pRes.error));
      return;
    }
    if (tRes.error) {
      console.error("tasks load error", tRes.error);
      pushError("作業の読み込みに失敗しました", tRes.error?.message || String(tRes.error));
      return;
    }
    if (peRes.error) {
      console.error("people load error", peRes.error);
      pushError("人員の読み込みに失敗しました", peRes.error?.message || String(peRes.error));
      return;
    }

    const p = (pRes.data || []).map(normalizeProjectRow);
    const t = (tRes.data || []).map(normalizeTaskRow);
    const peAll = (peRes.data || []).map(normalizePeopleRow);

    p.sort((a, b) => {
      const ra = pinRank(a.name);
      const rb = pinRank(b.name);
      if (ra !== rb) return ra - rb;
      return (a.name || "").localeCompare(b.name || "", "ja");
    });

    setProjects(p);
    setTasks(t);
    setPeopleAll(peAll);
  }

  async function reloadTaskUsage() {
    if (!db.taskUsage) {
      setTaskUsageMap({});
      return;
    }
    const rows = await db.taskUsage.toArray();
    const map = {};
    for (const r of rows) {
      map[`${r.projectId}:${r.taskId}`] = r.count ?? 0;
    }
    setTaskUsageMap(map);
  }

  async function reloadProjectUsage() {
    const { data, error } = await supabase.from("events").select("project_id, deleted_at");
    if (error) {
      console.error("projectUsage load error", error);
      pushError("現場の使用回数の取得に失敗しました", error?.message || String(error));
      return;
    }

    const rows = data || [];
    const map = {};
    for (const e of rows) {
      if (e.deleted_at != null) continue;
      const pid = toIntOrNull(e.project_id);
      if (!pid) continue;
      map[pid] = (map[pid] ?? 0) + 1;
    }
    setProjectUsageMap(map);
  }

  async function reloadPeopleUsage() {
    if (!db.peopleUsage) {
      setPeopleUsageMap({});
      return;
    }
    const rows = await db.peopleUsage.toArray();
    const map = {};
    for (const r of rows) {
      map[r.personId] = r.count ?? 0;
    }
    setPeopleUsageMap(map);
  }

  async function bumpTaskUsage(projectId, taskId) {
    if (!db.taskUsage) return;
    if (!projectId || !taskId) return;

    const key = [projectId, taskId];
    const now = new Date().toISOString();

    const hit = await db.taskUsage.get(key);
    if (!hit) {
      await db.taskUsage.put({ projectId, taskId, count: 1, updatedAt: now });
      setTaskUsageMap((prev) => ({ ...prev, [`${projectId}:${taskId}`]: 1 }));
      return;
    }
    const next = (hit.count ?? 0) + 1;
    await db.taskUsage.put({ ...hit, count: next, updatedAt: now });
    setTaskUsageMap((prev) => ({ ...prev, [`${projectId}:${taskId}`]: next }));
  }

  async function bumpPeopleUsage(personIds, times = 1) {
    if (!db.peopleUsage) return;
    const ids = uniqNumArray(personIds);
    if (ids.length === 0) return;

    const now = new Date().toISOString();

    await db.transaction("rw", db.peopleUsage, async () => {
      for (const personId of ids) {
        const hit = await db.peopleUsage.get(personId);
        const cur = hit?.count ?? 0;
        const next = cur + times;
        await db.peopleUsage.put({ personId, count: next, updatedAt: now });
      }
    });

    setPeopleUsageMap((prev) => {
      const next = { ...prev };
      for (const personId of ids) {
        next[personId] = (next[personId] ?? 0) + times;
      }
      return next;
    });
  }

  // ============================================================
  // ===== events load（Supabase）=====
  // ============================================================

  async function loadEventsForRanges(ranges, { includeTbd = true } = {}) {
    if (!ranges || ranges.length === 0) return;

    const minStart = ranges.reduce((m, r) => (m < r.startYmd ? m : r.startYmd), ranges[0].startYmd);
    const maxEndExclusive = ranges.reduce((m, r) => (m > r.endYmdExclusive ? m : r.endYmdExclusive), ranges[0].endYmdExclusive);

    const wanted = [];

    if (includeTbd) {
      const { data: tbdData, error: tbdErr } = await supabase.from("events").select("*").eq("bucket", "TBD").is("deleted_at", null);

      if (tbdErr) {
        console.error("events load TBD error", tbdErr);
        pushError("未定の予定の取得に失敗しました", tbdErr?.message || String(tbdErr));
      } else {
        for (const r of tbdData || []) wanted.push(normalizeEventRow(r));
      }
    }

    const { data: rangeData, error: rangeErr } = await supabase
      .from("events")
      .select("*")
      .gte("date", minStart)
      .lt("date", maxEndExclusive)
      .is("deleted_at", null);

    if (rangeErr) {
      console.error("events load range error", rangeErr);
      pushError("予定の取得に失敗しました", rangeErr?.message || String(rangeErr));
      return;
    }
    for (const r of rangeData || []) wanted.push(normalizeEventRow(r));

    const seen = new Set();
    const deduped = [];
    for (const e of wanted) {
      const k = String(e.id);
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(e);
    }

    // ✅ 安定ソート（order → createdAt → id）
    deduped.sort(stableEventSort);

    const map = {};
    for (const e of deduped) {
      const key = e.bucket === "TBD" ? "TBD" : e.date;
      if (!map[key]) map[key] = [];
      map[key].push(e);
    }

    // 念のためキーごとにも安定化
    for (const k of Object.keys(map)) {
      map[k].sort(stableEventSort);
    }

    setEventsByKey(map);
  }

  useEffect(() => {
    (async () => {
      const monthStartYmd = toYmd(gridStart);
      const monthEndYmdExclusive = addDaysYmd(monthStartYmd, 42);

      const ranges = [{ startYmd: monthStartYmd, endYmdExclusive: monthEndYmdExclusive }];

      if (isWeekOpen && weekStartYmd) {
        ranges.push({
          startYmd: weekStartYmd,
          endYmdExclusive: addDaysYmd(weekStartYmd, 7),
        });
      }

      if (isDayOpen && selectedKey && selectedKey !== "TBD") {
        const start = addDaysYmd(selectedKey, -3);
        const endEx = addDaysYmd(selectedKey, 4);
        ranges.push({ startYmd: start, endYmdExclusive: endEx });
      }

      await loadEventsForRanges(ranges, { includeTbd: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, monthIndex0, gridStart?.getTime?.() ?? 0, isWeekOpen, weekStartYmd, isDayOpen, selectedKey, reloadTick]);

  // ============================================================
  // ===== 表示用ヘルパー（既存ロジック維持）=====
  // ============================================================

  function genbaNameById(id) {
    const nid = toIntOrNull(id);
    const hit = projects.find((x) => x.id === nid);
    if (!hit) return "??";
    if (hit.deletedAt) return `${hit.name}（削除済み）`;
    return hit.name ?? "??";
  }
  function taskNameById(id) {
    if (id === null || id === undefined) return "";
    const nid = toIntOrNull(id);
    const hit = tasks.find((x) => x.id === nid);
    if (!hit) return "";
    if (hit.deletedAt) return `${hit.name}（削除済み）`;
    return hit.name ?? "";
  }
  function peopleNameById(id) {
    const nid = toIntOrNull(id);
    const hit = peopleAll.find((p) => p.id === nid);
    if (!hit) return "（不明）";
    if (hit.deletedAt) return `${hit.name}（削除済み）`;
    return hit.name;
  }

  function eventLabel(e) {
    const g = genbaNameById(e.projectId);
    const t = taskNameById(e.taskId);
    const n = e.note ? String(e.note).trim() : "";
    const base = t ? `${g} ${t}` : `${g}`;
    return n ? `${base} ${n}` : base;
  }

  function peopleLine(e) {
    const names = (e.peopleIds || []).map((id) => peopleNameById(id)).filter(Boolean) || [];
    const count = e.peopleCount;
    const countText = count === null || count === undefined ? "未入力" : `${count}名`;
    if (names.length > 0) return `人員: ${countText}（${names.join(", ")}）`;
    return `人員: ${countText}`;
  }

  function weekdayClass(cell) {
    if (cell.type !== "date") return "";
    const dow = cell.date.getDay();
    if (dow === 0) return "sun";
    if (dow === 6) return "sat";
    return "";
  }

  function monthCellEvents(key) {
    const list = (eventsByKey[key] || []).slice();

    // 既存の pinRank を優先しつつ、同順位内は安定化
    list.sort((a, b) => {
      const ga = genbaNameById(a.projectId);
      const gb = genbaNameById(b.projectId);
      const ra = pinRank(ga.replace("（削除済み）", ""));
      const rb = pinRank(gb.replace("（削除済み）", ""));
      if (ra !== rb) return ra - rb;
      return stableEventSort(a, b);
    });

    const top = list.slice(0, 3);
    const rest = list.length - top.length;
    return { top, rest };
  }

  // People チェックと人数の半連動（nullの時だけ追従）
  useEffect(() => {
    const min = selectedPeopleIds.length;

    if (!peopleCountManual) {
      setPeopleCount(min === 0 ? null : min);
    } else {
      setPeopleCount((prev) => {
        const cur = Number(prev ?? 0);
        return cur < min ? min : cur;
      });
    }
  }, [selectedPeopleIds, peopleCountManual]);

  // ============================================================
  // ===== ここから「書き込み」もSupabaseに統一 =====
  // ============================================================

  // 運用事故防止：insert多重実行（多重クリック/二重発火）を抑止（維持）
  const inFlightRef = useRef(false);
  const guard = async (fn) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await fn();
    } finally {
      inFlightRef.current = false;
    }
  };

  async function ensureProjectId() {
    const name = norm(projectInput);
    if (!name) return null;

    const hitActive = projectsActive.find((p) => p.name === name);
    if (hitActive) return hitActive.id;

    const hitDeleted = projects.find((p) => p.name === name && p.deletedAt);
    if (hitDeleted) {
      const { error } = await supabase.from("projects").update({ deleted_at: null }).eq("id", hitDeleted.id);
      if (error) {
        console.error("restore project error", error);
        pushError("現場の復元に失敗しました", error?.message || String(error));
        return hitDeleted.id;
      }
      await reloadMasters();
      return hitDeleted.id;
    }

    const createdAt = new Date().toISOString();
    const { data, error } = await supabase.from("projects").insert([{ name, created_at: createdAt, deleted_at: null }]).select("*").single();

    if (error) {
      console.error("create project error", error);
      pushError("現場の作成に失敗しました", error?.message || String(error));
      return null;
    }

    await reloadMasters();
    return toIntOrNull(data?.id ?? null);
  }

  async function ensureTaskIdOrNull() {
    const name = norm(taskInput);
    if (!name) return null;

    const hitActive = tasksActive.find((t) => t.name === name);
    if (hitActive) return hitActive.id;

    const hitDeleted = tasks.find((t) => t.name === name && t.deletedAt);
    if (hitDeleted) {
      const { error } = await supabase.from("tasks").update({ deleted_at: null }).eq("id", hitDeleted.id);
      if (error) {
        console.error("restore task error", error);
        pushError("作業の復元に失敗しました", error?.message || String(error));
        return hitDeleted.id;
      }
      await reloadMasters();
      return hitDeleted.id;
    }

    const createdAt = new Date().toISOString();
    const { data, error } = await supabase.from("tasks").insert([{ name, created_at: createdAt, deleted_at: null }]).select("*").single();

    if (error) {
      console.error("create task error", error);
      pushError("作業の作成に失敗しました", error?.message || String(error));
      return null;
    }

    await reloadMasters();
    return toIntOrNull(data?.id ?? null);
  }

  function resetForm() {
    setProjectInput("");
    setTaskInput("");
    setNote("");
    setPeopleCount(null);
    setSelectedPeopleIds([]);
    setPeopleCountManual(false);
    setColor(null);
    setEditingEventId(null);
    closeMenu();
    dayBodyRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  function closeDay() {
    setIsDayOpen(false);
    setSelectedKey(null);
    resetForm();
  }

  function openDay(key, opts = {}) {
    setSelectedKey(key);
    setIsDayOpen(true);
    closeMenu();

    if (opts.fromWeekStartYmd) setReturnWeekStart(opts.fromWeekStartYmd);
    else setReturnWeekStart(null);

    setTimeout(() => {
      dayBodyRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
    }, 0);
  }

  const canSave = Boolean(norm(projectInput));

  async function addEvent() {
    await guard(async () => {
      clearError();

      if (!selectedKey) return;
      if (!canSave) return;

      const pid = await ensureProjectId();
      if (!pid) {
        pushError("現場（project）の作成/取得に失敗しました", "SupabaseのRLS/権限/接続を確認してください。");
        return;
      }
      const tid = await ensureTaskIdOrNull();

      const keyEvents = (eventsByKey[selectedKey] || []).slice().sort(stableEventSort);
      const maxOrder = keyEvents.reduce((m, e) => Math.max(m, Number(e.order ?? 0)), -1);

      const now = new Date().toISOString();
      const row = {
        date: selectedKey === "TBD" ? "3000-01-01" : selectedKey,
        bucket: selectedKey === "TBD" ? "TBD" : null,
        project_id: pid,
        task_id: tid,
        note: note.trim() || null,
        people_count: toDbPeopleCount(peopleCount),
        people_ids: uniqNumArray(selectedPeopleIds),
        color: color,
        order: maxOrder + 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };

      const clean = { ...row };
      // 事故防止：idは絶対に送らない
      delete clean.id;
      delete clean.ID;

      const { error } = await supabase.from("events").insert([clean]);
      if (error) {
        console.error("addEvent error", error);
        pushError("予定の追加に失敗しました", error?.message || String(error));
        return;
      }

      if (pid && tid) await bumpTaskUsage(pid, tid);
      await bumpPeopleUsage(selectedPeopleIds, 1);

      resetForm();
      setReloadTick((x) => x + 1);
    });
  }

  async function addEventToMultipleDays() {
    await guard(async () => {
      clearError();

      // ★バグ修正：stateに直代入してたのを廃止（ここで編集状態は解除）
      setEditingEventId(null);

      if (!canSave) return;
      const ymds = buildSelectedYmdsForConfirm();
      if (ymds.length === 0) return;

      const pid = await ensureProjectId();
      if (!pid) {
        pushError("現場（project）の作成/取得に失敗しました", "SupabaseのRLS/権限/接続を確認してください。");
        return;
      }
      const tid = await ensureTaskIdOrNull();
      const now = new Date().toISOString();

      await bumpPeopleUsage(selectedPeopleIds, ymds.length);

      // まとめてinsertするとorder計算がズレるので、現状仕様どおり1日ずつ
      for (const ymd of ymds) {
        const dayList = (eventsByKey[ymd] || [])
          .filter((e) => e.deletedAt == null && e.bucket !== "TBD" && e.date === ymd)
          .slice()
          .sort(stableEventSort);

        const maxOrder = dayList.reduce((m, e) => Math.max(m, Number(e.order ?? 0)), -1);

        const row = {
          date: ymd,
          bucket: null,
          project_id: pid,
          task_id: tid,
          note: note.trim() || null,
          people_count: toDbPeopleCount(peopleCount),
          people_ids: uniqNumArray(selectedPeopleIds),
          color: color,
          order: maxOrder + 1,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };

        const clean = { ...row };
        delete clean.id;
        delete clean.ID;

        const { error } = await supabase.from("events").insert([clean]);
        if (error) {
          console.error("addEventToMultipleDays insert error", ymd, error);
          pushError(`複数日追加に失敗しました（${ymd}）`, error?.message || String(error));
          return;
        }

        if (pid && tid) await bumpTaskUsage(pid, tid);
      }

      setIsMultiAddOpen(false);
      resetForm();
      setReloadTick((x) => x + 1);
    });
  }

  async function saveEditEvent() {
    await guard(async () => {
      clearError();

      if (!selectedKey) return;
      if (!editingEventId) return;
      if (!canSave) return;

      const pid = await ensureProjectId();
      if (!pid) {
        pushError("現場（project）の作成/取得に失敗しました", "SupabaseのRLS/権限/接続を確認してください。");
        return;
      }
      const tid = await ensureTaskIdOrNull();

      const now = new Date().toISOString();
      const { error } = await supabase
        .from("events")
        .update({
          project_id: pid,
          task_id: tid,
          note: note.trim() || null,
          people_count: toDbPeopleCount(peopleCount),
          people_ids: uniqNumArray(selectedPeopleIds),
          color: color,
          updated_at: now,
        })
        .eq("id", editingEventId);

      if (error) {
        console.error("saveEditEvent error", error);
        pushError("保存に失敗しました", error?.message || String(error));
        return;
      }

      if (pid && tid) await bumpTaskUsage(pid, tid);
      await bumpPeopleUsage(selectedPeopleIds, 1);

      resetForm();
      setReloadTick((x) => x + 1);
    });
  }

  async function softDeleteEvent(id) {
    await guard(async () => {
      clearError();

      const now = new Date().toISOString();
      const { error } = await supabase.from("events").update({ deleted_at: now, updated_at: now }).eq("id", id);
      if (error) {
        console.error("softDeleteEvent error", error);
        pushError("削除に失敗しました", error?.message || String(error));
        return;
      }
      setReloadTick((x) => x + 1);
    });
  }

  async function swapOrder(a, b) {
    await guard(async () => {
      clearError();

      const aOrder = Number(a.order ?? 0);
      const bOrder = Number(b.order ?? 0);
      const now = new Date().toISOString();

      const r1 = await supabase.from("events").update({ order: bOrder, updated_at: now }).eq("id", a.id);
      if (r1.error) {
        console.error("swapOrder error(1)", r1.error);
        pushError("並び替えに失敗しました", r1.error?.message || String(r1.error));
        return;
      }
      const r2 = await supabase.from("events").update({ order: aOrder, updated_at: now }).eq("id", b.id);
      if (r2.error) {
        console.error("swapOrder error(2)", r2.error);
        pushError("並び替えに失敗しました", r2.error?.message || String(r2.error));
        return;
      }

      closeMenu();
      setReloadTick((x) => x + 1);
    });
  }

  function beginEditEvent(e) {
    const g = genbaNameById(e.projectId).replace("（削除済み）", "");
    const t = taskNameById(e.taskId).replace("（削除済み）", "");

    setEditingEventId(e.id);
    setProjectInput(g === "??" ? "" : g);
    setTaskInput(t ?? "");
    setNote(e.note ?? "");
    setPeopleCount(e.peopleCount ?? null);
    setSelectedPeopleIds(uniqNumArray(e.peopleIds));
    setPeopleCountManual(true);
    setColor(e.color ?? null);

    closeMenu();
    setTimeout(() => {
      dayBodyRef.current?.scrollTo?.({ top: 999999, behavior: "smooth" });
    }, 0);
  }

  function goPrevDay() {
    if (!selectedKey || selectedKey === "TBD") return;
    resetForm();
    openDay(addDaysYmd(selectedKey, -1), { fromWeekStartYmd: returnWeekStart });
  }
  function goNextDay() {
    if (!selectedKey || selectedKey === "TBD") return;
    resetForm();
    openDay(addDaysYmd(selectedKey, +1), { fromWeekStartYmd: returnWeekStart });
  }

  function openWeek(mondayYmd) {
    setWeekStartYmd(mondayYmd);
    setIsWeekOpen(true);
    closeMenu();
    setTimeout(() => {
      weekBodyRef.current?.scrollTo?.({ top: 0, behavior: "auto" });
    }, 0);
  }
  function closeWeek() {
    setIsWeekOpen(false);
    setWeekStartYmd(null);
    closeMenu();
  }
  function closeWeekToMonth() {
    if (weekStartYmd) {
      const d = fromYmd(weekStartYmd);
      setMonthCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    }
    closeWeek();
  }
  function prevWeek() {
    if (!weekStartYmd) return;
    openWeek(addDaysYmd(weekStartYmd, -7));
  }
  function nextWeek() {
    if (!weekStartYmd) return;
    openWeek(addDaysYmd(weekStartYmd, +7));
  }

  const weekDays = useMemo(() => {
    if (!weekStartYmd) return [];
    const labels = ["月", "火", "水", "木", "金", "土", "日"];
    return labels.map((wd, i) => {
      const ymd = addDaysYmd(weekStartYmd, i);
      return { wd, ymd };
    });
  }, [weekStartYmd]);

  function openMaster(tab) {
    setMasterTab(tab);
    setIsMasterOpen(true);
    setEditKind(null);
    setEditId(null);
    setEditName("");
    closeMenu();
  }
  function closeMaster() {
    setIsMasterOpen(false);
    setEditKind(null);
    setEditId(null);
    setEditName("");
    setNewGenbaName("");
    setNewTaskName("");
    setNewPersonName("");
    closeMenu();
  }
  function startEdit(kind, row) {
    setEditKind(kind);
    setEditId(row.id);
    setEditName(row.name);
    closeMenu();

    setTimeout(() => {
      if (masterEditAnchorRef.current?.scrollIntoView) {
        masterEditAnchorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (masterBodyRef.current?.scrollTo) {
        masterBodyRef.current.scrollTo({ top: 999999, behavior: "smooth" });
      }
    }, 0);
  }

  async function addPersonInline() {
    await guard(async () => {
      clearError();

      const name = norm(newPersonInline);
      if (!name) return;

      const createdAt = new Date().toISOString();
      const { data, error } = await supabase.from("people").insert([{ name, created_at: createdAt, deleted_at: null }]).select("*").single();

      if (error) {
        console.error("addPersonInline error", error);
        pushError("人員の追加に失敗しました", error?.message || String(error));
        return;
      }

      setNewPersonInline("");
      await reloadMasters();

      const id = toIntOrNull(data?.id);
      if (id != null) {
        setSelectedPeopleIds((prev) => uniqNumArray([...prev, id]));
      }
    });
  }

  async function addMaster(kind) {
    await guard(async () => {
      clearError();

      const createdAt = new Date().toISOString();

      if (kind === "genba") {
        const name = norm(newGenbaName);
        if (!name) return;
        try {
          const hitDeleted = projects.find((p) => p.name === name && p.deletedAt);
          if (hitDeleted) {
            const { error } = await supabase.from("projects").update({ deleted_at: null }).eq("id", hitDeleted.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from("projects").insert([{ name, created_at: createdAt, deleted_at: null }]);
            if (error) throw error;
          }
          setNewGenbaName("");
          await reloadMasters();
        } catch (e) {
          console.error(e);
          pushError("現場の追加に失敗しました", e?.message || String(e));
        }
        return;
      }
      if (kind === "task") {
        const name = norm(newTaskName);
        if (!name) return;
        try {
          const hitDeleted = tasks.find((t) => t.name === name && t.deletedAt);
          if (hitDeleted) {
            const { error } = await supabase.from("tasks").update({ deleted_at: null }).eq("id", hitDeleted.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from("tasks").insert([{ name, created_at: createdAt, deleted_at: null }]);
            if (error) throw error;
          }
          setNewTaskName("");
          await reloadMasters();
        } catch (e) {
          console.error(e);
          pushError("作業の追加に失敗しました", e?.message || String(e));
        }
        return;
      }
      if (kind === "people") {
        const name = norm(newPersonName);
        if (!name) return;
        try {
          const { error } = await supabase.from("people").insert([{ name, created_at: createdAt, deleted_at: null }]);
          if (error) throw error;
          setNewPersonName("");
          await reloadMasters();
        } catch (e) {
          console.error(e);
          pushError("人員の追加に失敗しました", e?.message || String(e));
        }
      }
    });
  }

  async function saveMasterEdit() {
    await guard(async () => {
      clearError();

      const name = norm(editName);
      if (!editKind || !editId || !name) return;

      try {
        if (editKind === "genba") {
          const { error } = await supabase.from("projects").update({ name }).eq("id", editId);
          if (error) throw error;
        }
        if (editKind === "task") {
          const { error } = await supabase.from("tasks").update({ name }).eq("id", editId);
          if (error) throw error;
        }
        if (editKind === "people") {
          const { error } = await supabase.from("people").update({ name }).eq("id", editId);
          if (error) throw error;
        }

        setEditKind(null);
        setEditId(null);
        setEditName("");
        await reloadMasters();
        setReloadTick((x) => x + 1);
      } catch (e) {
        console.error(e);
        pushError("マスタ編集の保存に失敗しました", e?.message || String(e));
      }
    });
  }

  async function deleteMaster(kind, id) {
    await guard(async () => {
      clearError();

      const now = new Date().toISOString();

      try {
        if (kind === "people") {
          const { error } = await supabase.from("people").update({ deleted_at: now }).eq("id", id);
          if (error) throw error;
          setSelectedPeopleIds((prev) => prev.filter((x) => x !== id));
          await reloadMasters();
          setReloadTick((x) => x + 1);
          return;
        }

        if (kind === "genba") {
          const { error } = await supabase.from("projects").update({ deleted_at: now }).eq("id", id);
          if (error) throw error;
          await reloadMasters();
          setReloadTick((x) => x + 1);
          return;
        }

        if (kind === "task") {
          const { error } = await supabase.from("tasks").update({ deleted_at: now }).eq("id", id);
          if (error) throw error;
          await reloadMasters();
          setReloadTick((x) => x + 1);
          return;
        }
      } catch (e) {
        console.error(e);
        pushError("削除に失敗しました", e?.message || String(e));
      }
    });
  }

  async function restorePerson(id) {
    await guard(async () => {
      clearError();

      const { error } = await supabase.from("people").update({ deleted_at: null }).eq("id", id);
      if (error) {
        console.error(error);
        pushError("復元に失敗しました", error?.message || String(error));
        return;
      }
      await reloadMasters();
      setReloadTick((x) => x + 1);
    });
  }
  async function restoreProject(id) {
    await guard(async () => {
      clearError();

      const { error } = await supabase.from("projects").update({ deleted_at: null }).eq("id", id);
      if (error) {
        console.error(error);
        pushError("復元に失敗しました", error?.message || String(error));
        return;
      }
      await reloadMasters();
      setReloadTick((x) => x + 1);
    });
  }
  async function restoreTask(id) {
    await guard(async () => {
      clearError();

      const { error } = await supabase.from("tasks").update({ deleted_at: null }).eq("id", id);
      if (error) {
        console.error(error);
        pushError("復元に失敗しました", error?.message || String(error));
        return;
      }
      await reloadMasters();
      setReloadTick((x) => x + 1);
    });
  }

  const deletedPeople = useMemo(() => (peopleAll || []).filter((p) => p.deletedAt), [peopleAll]);

  const projectSuggestions = useMemo(() => {
    const q = norm(projectInput);

    let list = projectsActive.filter((p) => {
      if (!q) return true;
      return p.name.includes(q);
    });

    list = list.slice().sort((a, b) => {
      const ra = pinRank(a.name);
      const rb = pinRank(b.name);
      if (ra !== rb) return ra - rb;

      const ca = projectUsageMap[a.id] ?? 0;
      const cb = projectUsageMap[b.id] ?? 0;
      if (ca !== cb) return cb - ca;

      return a.name.localeCompare(b.name, "ja");
    });

    return list;
  }, [projectsActive, projectInput, projectUsageMap]);

  const currentProjectId = useMemo(() => {
    const name = norm(projectInput);
    if (!name) return null;
    return projectsActive.find((p) => p.name === name)?.id ?? null;
  }, [projectInput, projectsActive]);

  const taskSuggestions = useMemo(() => {
    const q = norm(taskInput);

    let list = tasksActive.filter((t) => {
      if (!q) return true;
      return t.name.includes(q);
    });

    if (currentProjectId) {
      list = list.slice().sort((a, b) => {
        const ka = `${currentProjectId}:${a.id}`;
        const kb = `${currentProjectId}:${b.id}`;
        const ca = taskUsageMap[ka] ?? 0;
        const cb = taskUsageMap[kb] ?? 0;
        if (ca !== cb) return cb - ca;
        return a.name.localeCompare(b.name, "ja");
      });
    } else {
      list = list.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
    }

    return list;
  }, [tasksActive, taskInput, currentProjectId, taskUsageMap]);

  function onSurfaceClick() {
    closeMenu();
  }

  async function exportXlsxForCurrentMonth() {
    clearError();

    const start = new Date(year, monthIndex0, 1);
    const end = new Date(year, monthIndex0 + 1, 1);
    const startYmd = toYmd(start);
    const endYmd = toYmd(end);

    const { data, error } = await supabase.from("events").select("*").gte("date", startYmd).lt("date", endYmd).is("deleted_at", null);

    if (error) {
      console.error("export events load error", error);
      pushError("エクスポートに失敗しました（events取得エラー）", error?.message || String(error));
      return;
    }

    const events = (data || [])
      .map(normalizeEventRow)
      .filter((e) => e.bucket !== "TBD" && e.date)
      .slice()
      .sort((a, b) => {
        if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
        return stableEventSort(a, b);
      });

    if (events.length === 0) {
      pushError("この月の予定がありません", "未定は出力しません。");
      return;
    }

    const pById = new Map((projects || []).map((p) => [p.id, p]));
    const tById = new Map((tasks || []).map((t) => [t.id, t]));
    const peById = new Map((peopleAll || []).map((p) => [p.id, p]));

    const getProjectName = (id) => {
      const p = pById.get(toIntOrNull(id));
      if (!p) return "??";
      const name = p.name ?? "??";
      return p.deletedAt ? `${name}（削除済み）` : name;
    };
    const getTaskName = (id) => {
      if (id === null || id === undefined) return "";
      const t = tById.get(toIntOrNull(id));
      if (!t) return "";
      const name = t.name ?? "";
      return t.deletedAt ? `${name}（削除済み）` : name;
    };
    const getPeopleName = (id) => {
      const hit = peById.get(toIntOrNull(id));
      if (!hit) return "（不明）";
      if (hit.deletedAt) return `${hit.name}（削除済み）`;
      return hit.name;
    };

    const byProject = new Map();
    for (const e of events) {
      const pid = e.projectId;
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid).push(e);
    }

    const wb = XLSX.utils.book_new();
    const usedSheetNames = new Set();

    const indexRows = [["現場", "件数", "延べ人数", "未入力件数"]];
    const projectIdsSorted = Array.from(byProject.keys()).sort((a, b) => getProjectName(a).localeCompare(getProjectName(b), "ja"));

    for (const pid of projectIdsSorted) {
      const list = (byProject.get(pid) || []).slice().sort((a, b) => {
        if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
        return stableEventSort(a, b);
      });

      const projectName = getProjectName(pid);

      const header = ["日付", "現場", "作業", "メモ", "人数", "人員"];
      const rows = [header];

      let sumPeople = 0;
      let nullCount = 0;

      for (const e of list) {
        const date = e.date ?? "";
        const task = getTaskName(e.taskId);
        const memo = e.note ? String(e.note).trim() : "";

        const pc = e.peopleCount;
        const pcCell = pc === null || pc === undefined ? "" : Number(pc);

        if (pc === null || pc === undefined) nullCount += 1;
        else sumPeople += Number(pc);

        const peopleNames = (e.peopleIds || []).map(getPeopleName).filter(Boolean).join(", ");

        rows.push([date, projectName, task, memo, pcCell, peopleNames]);
      }

      rows.push([]);
      rows.push(["件数合計", list.length]);
      rows.push(["延べ人数", sumPeople]);
      rows.push(["未入力件数", nullCount]);

      indexRows.push([projectName, list.length, sumPeople, nullCount]);

      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 24 }, { wch: 8 }, { wch: 40 }];

      const sheetName = uniqueSheetName(projectName, usedSheetNames);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    const indexWs = XLSX.utils.aoa_to_sheet(indexRows);
    indexWs["!cols"] = [{ wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];
    const indexName = uniqueSheetName("INDEX", usedSheetNames);
    XLSX.utils.book_append_sheet(wb, indexWs, indexName);

    const names = wb.SheetNames.slice();
    const idx = names.indexOf(indexName);
    if (idx > -1) {
      names.splice(idx, 1);
      names.unshift(indexName);
      wb.SheetNames = names;
    }

    const fileName = `${year}-${pad2(monthIndex0 + 1)}_予定.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  // 複数日モーダル内：日付クリック
  function onPickDayInMultiModal(ymd) {
    if (!ymdInMultiMonth(ymd)) return;

    if (multiMode === "range") {
      if (!rangeStartYmd || (rangeStartYmd && rangeEndYmd)) {
        setRangeStartYmd(ymd);
        setRangeEndYmd(null);
        return;
      }
      setRangeEndYmd(ymd);
      return;
    }

    if (multiMode === "multi") {
      setMultiSelectedYmds((prev) => {
        const next = new Set(prev);
        if (next.has(ymd)) next.delete(ymd);
        else next.add(ymd);
        return next;
      });
      return;
    }
  }

  function isSelectedInMultiModal(ymd) {
    return buildSelectedYmdsForConfirm().includes(ymd);
  }

  function weekdayLabelJP(dow) {
    return ["日", "月", "火", "水", "木", "金", "土"][dow];
  }

  return (
    <div className="app">
      <style>{`
          .cell.outside{
            opacity: .45;
          }
          .cell.outside .miniItem,
          .cell.outside .more{
            opacity: .75;
          }

          .peopleBoxFixed{
            box-sizing: border-box;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            column-gap: 12px;
            row-gap: 0px;
            grid-auto-rows: 32px;
            max-height: 168px;
            overflow-y: auto;
            border: 1px solid rgba(0,0,0,.10);
            border-radius: 10px;
            padding: 8px;
            background: rgba(255,255,255,.70);
          }

          .personRowFixed{
            box-sizing: border-box;
            height: 32px;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            padding: 0 2px;
          }

          .appErrorBar{
            margin-top: 10px;
            border: 1px solid rgba(176,0,32,.25);
            background: rgba(176,0,32,.08);
            border-radius: 12px;
            padding: 10px 12px;
            display: flex;
            gap: 10px;
            align-items: flex-start;
            justify-content: space-between;
          }
          .appErrorMsg{
            color: rgba(176,0,32,.95);
            font-weight: 800;
            line-height: 1.4;
            white-space: pre-wrap;
          }
          .appErrorDetail{
            color: rgba(176,0,32,.78);
            margin-top: 4px;
            font-size: 12px;
            white-space: pre-wrap;
          }
        `}</style>

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

                {/* ★ログイン情報/ログアウトをここに格納（月画面に常時表示しない） */}
                <div style={{ padding: "8px 10px", fontSize: 12, color: "rgba(0,0,0,.70)" }}>
                  ログイン中: {session?.user?.email || "（不明）"}
                </div>
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

      <main className="main">
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

          <div className="tbdRow">
            <button className="tbdCell" onClick={() => openDay("TBD")}>
              <div className="tbdTitle">未定</div>
              <div className="miniList">
                {monthCellEvents("TBD").top.map((e) => (
                  <div key={e.id} className="miniItem" style={{ color: e.color ?? "#111" }}>
                    {eventLabel(e)}
                  </div>
                ))}
                {monthCellEvents("TBD").rest > 0 ? <div className="more">+{monthCellEvents("TBD").rest}件</div> : null}
              </div>
            </button>
          </div>
        </section>
      </main>

      {/* 週モーダル */}
      {isWeekOpen && weekStartYmd && (
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
                  const isSun = dow === 0;
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
      )}

      {/* マスタ管理モーダル */}
      {isMasterOpen && (
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
      )}

      {/* 日詳細モーダル */}
      {isDayOpen && selectedKey && (
        <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div style={{ display: "flex", gap: 8 }}>
                {selectedKey !== "TBD" && (
                  <button
                    className="btn"
                    onClick={() => {
                      const wk = returnWeekStart ?? mondayOfYmd(selectedKey);
                      closeDay();
                      openWeek(wk);
                    }}
                  >
                    ←週
                  </button>
                )}

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

              <div className="modalTitle">{selectedKey === "TBD" ? "未定" : selectedKey}</div>

              {selectedKey !== "TBD" ? (
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn" onClick={goPrevDay}>
                    ←
                  </button>
                  <button className="btn" onClick={goNextDay}>
                    →
                  </button>
                </div>
              ) : (
                <div style={{ width: 72 }} />
              )}
            </div>

            <div className="modalBody" ref={dayBodyRef} onClick={onSurfaceClick}>
              <h2 className="sectionTitle">その日の予定</h2>

              {selectedEvents.length === 0 ? (
                <div className="empty">この日の予定はまだありません</div>
              ) : (
                <div className="eventList">
                  {selectedEvents.map((e, idx) => {
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
                                disabled={idx === selectedEvents.length - 1}
                                onClick={() => idx < selectedEvents.length - 1 && (swapOrder(e, selectedEvents[idx + 1]), closeMenu())}
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
      )}

      {/* ★予定を移動モーダル（タップ即移動） */}
      {isMoveOpen && (
        <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <button className="btn" onClick={closeMoveModal}>
                ← 戻る
              </button>
              <div className="modalTitle">移動先を選択</div>
              <div style={{ width: 72 }} />
            </div>

            <div className="modalBody" onClick={onSurfaceClick}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <button className="btn" onClick={() => setMoveCursor(new Date(moveYear, moveMonthIndex0 - 1, 1))}>
                  ←
                </button>
                <div style={{ fontWeight: 800 }}>{moveMonthLabel}</div>
                <button className="btn" onClick={() => setMoveCursor(new Date(moveYear, moveMonthIndex0 + 1, 1))}>
                  →
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10, justifyContent: "flex-end" }}>
                <button className="btn" onClick={moveEventToTbdInstant}>
                  未定へ移動
                </button>
              </div>

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
                  <div key={`mh-${x}`} style={{ textAlign: "center", fontWeight: 800, fontSize: 12, color: "rgba(0,0,0,.70)" }}>
                    {x}
                  </div>
                ))}

                {moveGridCells.map((cell) => {
                  if (cell.type === "blank") return <div key={cell.key} style={{ height: 36 }} />;

                  const ymd = cell.ymd;
                  const dow = cell.date.getDay();
                  const isSat = dow === 6;
                  const isSun = dow === 0;

                  return (
                    <button
                      key={cell.key}
                      className="btn"
                      onClick={() => moveEventToYmdInstant(ymd)}
                      style={{
                        height: 36,
                        padding: 0,
                        fontWeight: 800,
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,.12)",
                        background: isSun ? "var(--sun)" : isSat ? "var(--sat)" : "rgba(255,255,255,.85)",
                        color: isSun ? "#b00020" : isSat ? "#0b57d0" : "#111",
                      }}
                      title={ymd}
                    >
                      {cell.date.getDate()}
                    </button>
                  );
                })}
              </div>

              <div style={{ marginTop: 10, color: "rgba(0,0,0,.65)", fontSize: 13 }}>日付をタップした瞬間に移動します</div>
            </div>

            <div className="modalFooter">
              <button className="btn" onClick={closeMoveModal}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★複数日に追加モーダル */}
      {isMultiAddOpen && (
        <div className="overlay" role="dialog" aria-modal="true" onClick={onSurfaceClick}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <button className="btn" onClick={closeMultiAdd}>
                ← 戻る
              </button>
              <div className="modalTitle">複数日に追加</div>
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
                <button className="btn" disabled={multiMode === "range"} onClick={() => setMultiMode("range")}>
                  範囲選択
                </button>
                <button className="btn" disabled={multiMode === "multi"} onClick={() => setMultiMode("multi")}>
                  複数選択
                </button>
                <button className="btn" disabled={multiMode === "weekday"} onClick={() => setMultiMode("weekday")}>
                  曜日選択
                </button>
              </div>

              {multiMode === "range" && <div style={{ color: "rgba(0,0,0,.65)", fontSize: 13, marginBottom: 10 }}>開始日→終了日をタップ（※土日除外は固定）</div>}
              {multiMode === "multi" && <div style={{ color: "rgba(0,0,0,.65)", fontSize: 13, marginBottom: 10 }}>日付をタップして追加/解除</div>}
              {multiMode === "weekday" && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
                    const on = weekdaySelected.has(dow);
                    return (
                      <label key={dow} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setWeekdaySelected((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(dow);
                              else next.delete(dow);
                              return next;
                            });
                          }}
                        />
                        <span>{weekdayLabelJP(dow)}</span>
                      </label>
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

              <div style={{ marginTop: 10, color: "rgba(0,0,0,.65)", fontSize: 13 }}>選択日数: {buildSelectedYmdsForConfirm().length}日</div>
            </div>

            <div className="modalFooter">
              <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "flex-end" }}>
                <button className="btn" onClick={closeMultiAdd}>
                  キャンセル
                </button>
                <button className="btn primary" disabled={!canSave || buildSelectedYmdsForConfirm().length === 0} onClick={addEventToMultipleDays}>
                  追加
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}