import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { db, seedIfNeeded, COLOR_PALETTE } from "./db";
import { AuthGate, useAuth } from "./components/auth/AuthGate";
import { MasterModal } from "./components/modals/MasterModal";
import { ExcelModal } from "./components/modals/ExcelModal";
import { DayModal } from "./components/modals/DayModal";
import { MoveModal } from "./components/modals/MoveModal";
import { MultiAddModal } from "./components/modals/MultiAddModal";
import { MonthHeader } from "./components/month/MonthHeader";
import { MonthGrid } from "./components/month/MonthGrid";
import { addDaysYmd, buildMonthGrid, clamp, fromYmd, mondayOfYmd, sameDay, toYmd, ymdToMonthLabel, padMonthForFile } from "./utils/date";
import { norm, toIntOrNull, uniqNumArray } from "./utils/id";
import { uniqueSheetName } from "./utils/excel";
import { normalizeEventRow, normalizeBillingTargetRow, normalizeManagerRow, normalizePeopleRow, normalizeProjectRow, normalizeTaskRow, toDbPeopleCount } from "./utils/normalize";
import * as api from "./services/api";
import { isHolidayDate } from "./utils/holiday";

// 「休み」「応援」の優先順位（表示用）
function pinRank(genbaName) {
  if (genbaName === "休み") return 0;
  if (genbaName === "応援") return 1;
  return 2;
}
// ============================================================

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
  const monthLabel = ymdToMonthLabel(year, monthIndex0);

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
  const [managersAll, setManagersAll] = useState([]); // 担当者（削除済み含む）
  const [billingTargets, setBillingTargets] = useState([]); // 請求先

  // --- Excel出力モーダル ---
  const [isExcelOpen, setIsExcelOpen] = useState(false);

  // ★人員累計使用回数（personId -> count） Dexieに残す（無ければ空）
  const [peopleUsageMap, setPeopleUsageMap] = useState({});

  // ★担当者累計使用回数（"projectId:managerId" -> count） Dexieに残す
  const [managerUsageMap, setManagerUsageMap] = useState({});

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
  const [newManagerName, setNewManagerName] = useState("");
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
  const [copySourceEvent, setCopySourceEvent] = useState(null);
  const [peopleCount, setPeopleCount] = useState(null);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [peopleCountManual, setPeopleCountManual] = useState(false);
  const [color, setColor] = useState(null);
  const [editingEventId, setEditingEventId] = useState(null);
  const [selectedManagerId, setSelectedManagerId] = useState(null);

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
    setCopySourceEvent(null);
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
  const selectedEventsDisplay = useMemo(() => sortEventsForDisplay(selectedEvents), [selectedEvents, projects, tasks, peopleAll]);

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

    const { error } = await api.updateEventById({
      id: moveEventId,
      patch: { date: ymd, bucket: null, updated_at: new Date().toISOString() },
    });

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

    const { error } = await api.updateEventById({
      id: moveEventId,
      patch: { date: "3000-01-01", bucket: "TBD", updated_at: new Date().toISOString() },
    });

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
    setSelectedManagerId(null);

    setNewGenbaName("");
    setNewTaskName("");
    setNewPersonName("");
    setNewManagerName("");
    setNewPersonInline("");
    setEditKind(null);
    setEditId(null);
    setEditName("");

    // データ（共有端末の残像対策）
    setProjects([]);
    setTasks([]);
    setPeopleAll([]);
    setManagersAll([]);
    setBillingTargets([]);
    setIsExcelOpen(false);
    setEventsByKey({});
    setTaskUsageMap({});
    setProjectUsageMap({});
    setPeopleUsageMap({});
    setManagerUsageMap({});

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
      await reloadManagerUsage();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      await reloadProjectUsage();
      await reloadPeopleUsage();
      await reloadManagerUsage();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  async function reloadMasters() {
    const [pRes, tRes, peRes, mgRes, btRes] = await Promise.all([
      api.fetchProjects(), api.fetchTasks(), api.fetchPeople(), api.fetchManagers(), api.fetchBillingTargets()
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
    if (mgRes.error) {
      console.error("managers load error", mgRes.error);
      pushError("担当者の読み込みに失敗しました", mgRes.error?.message || String(mgRes.error));
      return;
    }

    const p = (pRes.data || []).map(normalizeProjectRow);
    const t = (tRes.data || []).map(normalizeTaskRow);
    const peAll = (peRes.data || []).map(normalizePeopleRow);
    const mgAll = (mgRes.data || []).map(normalizeManagerRow);
    const btAll = (btRes.data || []).map(normalizeBillingTargetRow);

    p.sort((a, b) => {
      const ra = pinRank(a.name);
      const rb = pinRank(b.name);
      if (ra !== rb) return ra - rb;
      return (a.name || "").localeCompare(b.name || "", "ja");
    });

    setProjects(p);
    setTasks(t);
    setPeopleAll(peAll);
    setManagersAll(mgAll);

    // 請求先：未登録の現場は自動で請求先として追加
    const existingProjectIds = new Set(btAll.map((b) => b.projectId));
    const missing = p.filter((proj) => !proj.deletedAt && !existingProjectIds.has(proj.id));
    if (missing.length > 0) {
      const now = new Date().toISOString();
      await Promise.all(missing.map((proj) => api.createBillingTarget({ name: proj.name, projectId: proj.id, createdAt: now })));
      const { data: btRefresh } = await api.fetchBillingTargets();
      setBillingTargets((btRefresh || []).map(normalizeBillingTargetRow));
    } else {
      setBillingTargets(btAll);
    }
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
    const { data, error } = await api.fetchProjectUsageRows();
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

  async function reloadManagerUsage() {
    if (!db.managerUsage) {
      setManagerUsageMap({});
      return;
    }
    const rows = await db.managerUsage.toArray();
    const map = {};
    for (const r of rows) {
      map[`${r.projectId}:${r.managerId}`] = r.count ?? 0;
    }
    setManagerUsageMap(map);
  }

  async function bumpManagerUsage(projectId, managerId) {
    if (!db.managerUsage) return;
    if (!projectId || !managerId) return;

    const key = [projectId, managerId];
    const now = new Date().toISOString();

    const hit = await db.managerUsage.get(key);
    if (!hit) {
      await db.managerUsage.put({ projectId, managerId, count: 1, updatedAt: now });
      setManagerUsageMap((prev) => ({ ...prev, [`${projectId}:${managerId}`]: 1 }));
      return;
    }
    const next = (hit.count ?? 0) + 1;
    await db.managerUsage.put({ ...hit, count: next, updatedAt: now });
    setManagerUsageMap((prev) => ({ ...prev, [`${projectId}:${managerId}`]: next }));
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
      const { data: tbdData, error: tbdErr } = await api.fetchEventsTbd();

      if (tbdErr) {
        console.error("events load TBD error", tbdErr);
        pushError("未定の予定の取得に失敗しました", tbdErr?.message || String(tbdErr));
      } else {
        for (const r of tbdData || []) wanted.push(normalizeEventRow(r));
      }
    }

    const { data: rangeData, error: rangeErr } = await api.fetchEventsRange({ startYmd: minStart, endYmdExclusive: maxEndExclusive });

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

  function monthPeopleSummary(e) {
    // 1. 名前リストを作成
    const names = (e.peopleIds || []).map(id => peopleNameById(id)).filter(Boolean);
    if (names.length === 0) return "";

    // 2. IDではなく名前で判定（IDはDB依存でずれるため）
    const projectName = genbaNameById(e.projectId).replace("（削除済み）", "");
    const isSpecial = projectName === "休み" || projectName === "応援";

    // 3. 判定ロジック
    if (isSpecial) {
      // 休み・応援なら何人でも全員表示
      return ` ${names.join("、")}`;
    }

    if (names.length <= 2) {
      // 通常現場で2人以下なら名前
      return ` ${names.join("、")}`;
    }

    // それ以外（3人以上）は人数
    return ` ${names.length}名`;
  }

  function weekdayClass(cell) {
    if (cell.type !== "date") return "";
    const dow = cell.date.getDay();
    const isHoliday = isHolidayDate(cell.date);

    // 1. 祝日を最優先 (赤)
    if (isHoliday) return "holiday";

    // 2. 日曜 (赤)
    if (dow === 0) return "sun";

    // 3. 土曜 (青)
    if (dow === 6) return "sat";

    // 4. 火曜・木曜 (グレー) ★ここを追加
    if (dow === 2) return "tue";
    if (dow === 4) return "thu";

    return "";
  }

  function sortEventsForDisplay(list) {
    const src = (list || []).slice();
    src.sort((a, b) => {
      const ga = genbaNameById(a.projectId);
      const gb = genbaNameById(b.projectId);
      const ra = pinRank(ga.replace("（削除済み）", ""));
      const rb = pinRank(gb.replace("（削除済み）", ""));
      if (ra !== rb) return ra - rb;
      return stableEventSort(a, b);
    });
    return src;
  }

  function monthCellEvents(key) {
    const list = sortEventsForDisplay(eventsByKey[key] || []);
    const top = list.slice(0, 6);
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

  // スマホの戻るボタンでモーダルを閉じる
  // refで常に最新のstate/関数を参照することでクロージャ問題を回避
  const modalRef = useRef({});
  modalRef.current = {
    isDayOpen, isWeekOpen, isMasterOpen, isMoveOpen, isMultiAddOpen,
    closeDay, closeWeek, closeMaster, closeMoveModal, closeMultiAdd,
  };

  // モーダルが開いた時に履歴を1つ積む（開いた時のみ、閉じる時は何もしない）
  useEffect(() => { if (isDayOpen)      history.pushState({ modal: "day" }, "");    }, [isDayOpen]);
  useEffect(() => { if (isWeekOpen)     history.pushState({ modal: "week" }, "");   }, [isWeekOpen]);
  useEffect(() => { if (isMasterOpen)   history.pushState({ modal: "master" }, ""); }, [isMasterOpen]);
  useEffect(() => { if (isMoveOpen)     history.pushState({ modal: "move" }, "");   }, [isMoveOpen]);
  useEffect(() => { if (isMultiAddOpen) history.pushState({ modal: "multi" }, "");  }, [isMultiAddOpen]);

  // popstate（戻るボタン）で最前面のモーダルを1つ閉じる（マウント時に1回だけ登録）
  useEffect(() => {
    const handlePop = () => {
      const { isDayOpen, isWeekOpen, isMasterOpen, isMoveOpen, isMultiAddOpen,
              closeDay, closeWeek, closeMaster, closeMoveModal, closeMultiAdd } = modalRef.current;

      // Move/MultiAddはDayModalの上に乗っているのでviewportはそのまま
      if (isMoveOpen)     { closeMoveModal(); return; }
      if (isMultiAddOpen) { closeMultiAdd();  return; }

      // DayModal/WeekModal/MasterModalを閉じる時はズーム解除
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) viewport.setAttribute('content', 'width=1280, initial-scale=1.0');
      requestAnimationFrame(() => {
        if (viewport) viewport.setAttribute('content', 'width=1280');
      });

      if (isDayOpen)    { closeDay();    return; }
      if (isWeekOpen)   { closeWeek();   return; }
      if (isMasterOpen) { closeMaster(); return; }
    };

    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  // ============================================================
  // スワイプで月・日を切り替える
  // ============================================================
  const swipeRef = useRef(null);

  function handleTouchStart(e) {
    swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function handleTouchEnd(e) {
    if (!swipeRef.current) return;
    const dx = e.changedTouches[0].clientX - swipeRef.current.x;
    const dy = e.changedTouches[0].clientY - swipeRef.current.y;
    swipeRef.current = null;

    // 縦スクロールが主体の場合は無視
    if (Math.abs(dy) > Math.abs(dx)) return;
    // 横移動が50px未満は無視
    if (Math.abs(dx) < 50) return;

    if (isDayOpen) {
      // 日付画面：左スワイプ=次の日、右スワイプ=前の日
      if (dx < 0) goNextDay();
      else goPrevDay();
    } else if (!isWeekOpen && !isMasterOpen && !isMoveOpen && !isMultiAddOpen) {
      // 月画面：左スワイプ=次の月、右スワイプ=前の月
      if (dx < 0) setMonthCursor(new Date(year, monthIndex0 + 1, 1));
      else setMonthCursor(new Date(year, monthIndex0 - 1, 1));
    }
  }

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
      const { error } = await api.restoreProjectById(hitDeleted.id);
      if (error) {
        console.error("restore project error", error);
        pushError("現場の復元に失敗しました", error?.message || String(error));
        return hitDeleted.id;
      }
      await reloadMasters();
      return hitDeleted.id;
    }

    const createdAt = new Date().toISOString();
    const { data, error } = await api.createProject({ name, createdAt });

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
      const { error } = await api.restoreTaskById(hitDeleted.id);
      if (error) {
        console.error("restore task error", error);
        pushError("作業の復元に失敗しました", error?.message || String(error));
        return hitDeleted.id;
      }
      await reloadMasters();
      return hitDeleted.id;
    }

    const createdAt = new Date().toISOString();
    const { data, error } = await api.createTask({ name, createdAt });

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
    setSelectedManagerId(null);
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
        manager_id: selectedManagerId,
        order: maxOrder + 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };

      const clean = { ...row };
      // 事故防止：idは絶対に送らない
      delete clean.id;
      delete clean.ID;

      const { error } = await api.insertEvent(clean);
      if (error) {
        console.error("addEvent error", error);
        pushError("予定の追加に失敗しました", error?.message || String(error));
        return;
      }

      if (pid && tid) await bumpTaskUsage(pid, tid);
      await bumpPeopleUsage(selectedPeopleIds, 1);
      if (pid && selectedManagerId) await bumpManagerUsage(pid, selectedManagerId);

      resetForm();
      setReloadTick((x) => x + 1);
    });
  }

  async function addEventToMultipleDays() {
  await guard(async () => {
    clearError();

    // ★バグ修正：stateに直代入してたのを廃止（ここで編集状態は解除）
    setEditingEventId(null);

    // コピー元がない時だけ、通常の入力チェック(canSave)を行う
    if (!copySourceEvent && !canSave) return;
    
    const ymds = buildSelectedYmdsForConfirm();
    if (ymds.length === 0) return;

    // コピー元があればそこから取得、なければ現在の入力から取得
    const pid = copySourceEvent ? copySourceEvent.project_id : await ensureProjectId();
    if (!pid) {
      pushError("現場（project）の作成/取得に失敗しました", "SupabaseのRLS/権限/接続を確認してください。");
      return;
    }
    const tid = copySourceEvent ? copySourceEvent.task_id : await ensureTaskIdOrNull();
    const now = new Date().toISOString();

    // 人員の使用頻度更新（コピー時は元のデータの人員IDを使用）
    const targetPeopleIds = copySourceEvent ? copySourceEvent.people_ids : selectedPeopleIds;
    await bumpPeopleUsage(targetPeopleIds, ymds.length);

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
        // copySourceEvent があればその内容、なければ現在の入力 state の値を使う
        note: (copySourceEvent ? (copySourceEvent.note || "") : note).trim() || null,
        people_count: copySourceEvent ? copySourceEvent.people_count : toDbPeopleCount(peopleCount),
        people_ids: copySourceEvent ? copySourceEvent.people_ids : uniqNumArray(selectedPeopleIds),
        color: copySourceEvent ? copySourceEvent.color : color,
        manager_id: copySourceEvent ? (copySourceEvent.manager_id ?? null) : selectedManagerId,
        order: maxOrder + 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };

      const clean = { ...row };
      delete clean.id;
      delete clean.ID;

      const { error } = await api.insertEvent(clean);
      if (error) {
        console.error("addEventToMultipleDays insert error", ymd, error);
        pushError(`複数日追加に失敗しました（${ymd}）`, error?.message || String(error));
        return;
      }

      if (pid && tid) await bumpTaskUsage(pid, tid);
      const targetManagerId = copySourceEvent ? (copySourceEvent.manager_id ?? null) : selectedManagerId;
      if (pid && targetManagerId) await bumpManagerUsage(pid, targetManagerId);
    }

    setIsMultiAddOpen(false);
    resetForm();
    setCopySourceEvent(null); // ★ここでもコピー状態をクリア
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
      const { error } = await api.updateEventById({
        id: editingEventId,
        patch: {
          project_id: pid,
          task_id: tid,
          note: note.trim() || null,
          people_count: toDbPeopleCount(peopleCount),
          people_ids: uniqNumArray(selectedPeopleIds),
          color: color,
          manager_id: selectedManagerId,
          updated_at: now,
        },
      });

      if (error) {
        console.error("saveEditEvent error", error);
        pushError("保存に失敗しました", error?.message || String(error));
        return;
      }

      if (pid && tid) await bumpTaskUsage(pid, tid);
      await bumpPeopleUsage(selectedPeopleIds, 1);
      if (pid && selectedManagerId) await bumpManagerUsage(pid, selectedManagerId);

      resetForm();
      setReloadTick((x) => x + 1);
    });
  }

  async function softDeleteEvent(id) {
    await guard(async () => {
      clearError();

      const now = new Date().toISOString();
      const { error } = await api.softDeleteEventById({ id, nowIso: now });
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

      const { error } = await api.swapEventOrder({ idA: a.id, orderA: aOrder, idB: b.id, orderB: bOrder, nowIso: now });
      if (error) {
        console.error("swapOrder error", error);
        pushError("並び替えに失敗しました", error?.message || String(error));
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
    setSelectedManagerId(e.managerId ?? null);

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
      const { data, error } = await api.createPerson({ name, createdAt });

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
            const { error } = await api.restoreProjectById(hitDeleted.id);
            if (error) throw error;
          } else {
            const { error } = await api.createProject({ name, createdAt });
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
            const { error } = await api.restoreTaskById(hitDeleted.id);
            if (error) throw error;
          } else {
            const { error } = await api.createTask({ name, createdAt });
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
          const { error } = await api.createPerson({ name, createdAt });
          if (error) throw error;
          setNewPersonName("");
          await reloadMasters();
        } catch (e) {
          console.error(e);
          pushError("人員の追加に失敗しました", e?.message || String(e));
        }
        return;
      }
      if (kind === "manager") {
        const name = norm(newManagerName);
        if (!name) return;
        try {
          const hitDeleted = managersAll.find((m) => m.name === name && m.deletedAt);
          if (hitDeleted) {
            const { error } = await api.restoreManagerById(hitDeleted.id);
            if (error) throw error;
          } else {
            const { error } = await api.createManager({ name, createdAt });
            if (error) throw error;
          }
          setNewManagerName("");
          await reloadMasters();
        } catch (e) {
          console.error(e);
          pushError("担当者の追加に失敗しました", e?.message || String(e));
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
          const { error } = await api.updateProjectName({ id: editId, name });
          if (error) throw error;
        }
        if (editKind === "task") {
          const { error } = await api.updateTaskName({ id: editId, name });
          if (error) throw error;
        }
        if (editKind === "people") {
          const { error } = await api.updatePersonName({ id: editId, name });
          if (error) throw error;
        }
        if (editKind === "manager") {
          const { error } = await api.updateManagerName({ id: editId, name });
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
          const { error } = await api.softDeletePersonById({ id, nowIso: now });
          if (error) throw error;
          setSelectedPeopleIds((prev) => prev.filter((x) => x !== id));
          await reloadMasters();
          setReloadTick((x) => x + 1);
          return;
        }

        if (kind === "genba") {
          const { error } = await api.softDeleteProjectById({ id, nowIso: now });
          if (error) throw error;
          await reloadMasters();
          setReloadTick((x) => x + 1);
          return;
        }

        if (kind === "task") {
          const { error } = await api.softDeleteTaskById({ id, nowIso: now });
          if (error) throw error;
          await reloadMasters();
          setReloadTick((x) => x + 1);
          return;
        }
        if (kind === "manager") {
          const { error } = await api.softDeleteManagerById({ id, nowIso: now });
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

      const { error } = await api.restorePersonById(id);
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

      const { error } = await api.restoreProjectById(id);
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

      const { error } = await api.restoreTaskById(id);
      if (error) {
        console.error(error);
        pushError("復元に失敗しました", error?.message || String(error));
        return;
      }
      await reloadMasters();
      setReloadTick((x) => x + 1);
    });
  }

  async function restoreManager(id) {
    await guard(async () => {
      clearError();

      const { error } = await api.restoreManagerById(id);
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
  const managersActive = useMemo(() => (managersAll || []).filter((m) => !m.deletedAt), [managersAll]);
  const deletedManagers = useMemo(() => (managersAll || []).filter((m) => m.deletedAt), [managersAll]);

  // ============================================================
  // 請求先管理
  // ============================================================
  async function updateBillingTarget(id, patch) {
    const dbPatch = {};
    if ("name" in patch) dbPatch.name = patch.name;
    if ("closingType" in patch) dbPatch.closing_type = patch.closingType;
    if ("outputType" in patch) dbPatch.output_type = patch.outputType;
    if ("billingType" in patch) dbPatch.billing_type = patch.billingType;
    if ("groupByManager" in patch) dbPatch.group_by_manager = patch.groupByManager;
    if ("unitPrice" in patch) dbPatch.unit_price = patch.unitPrice;

    const { error } = await api.updateBillingTarget({ id, patch: dbPatch });
    if (error) {
      pushError("請求先の更新に失敗しました", error?.message || String(error));
      return;
    }
    setBillingTargets((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  }

  async function addBillingTarget() {
    const name = `新しい請求先${billingTargets.length + 1}`;
    const now = new Date().toISOString();
    const { data, error } = await api.createBillingTarget({ name, projectId: null, createdAt: now });
    if (error) {
      pushError("請求先の追加に失敗しました", error?.message || String(error));
      return;
    }
    if (data) setBillingTargets((prev) => [...prev, normalizeBillingTargetRow(data)]);
  }

  async function mergeBillingTargets(targetId, sourceIds) {
    const now = new Date().toISOString();
    await Promise.all(sourceIds.map((id) => api.softDeleteBillingTargetById({ id, nowIso: now })));
    setBillingTargets((prev) => prev.filter((t) => !sourceIds.includes(t.id)));
  }

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

  // ★担当者（現場ごとの使用頻度順、同数は名前順）
  const managersActiveSorted = useMemo(() => {
    const list = (managersAll || []).filter((m) => m.deletedAt === null || m.deletedAt === undefined);
    return list.slice().sort((a, b) => {
      const ka = currentProjectId ? `${currentProjectId}:${a.id}` : null;
      const kb = currentProjectId ? `${currentProjectId}:${b.id}` : null;
      const ca = ka ? (managerUsageMap[ka] ?? 0) : 0;
      const cb = kb ? (managerUsageMap[kb] ?? 0) : 0;
      if (ca !== cb) return cb - ca;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""), "ja");
    });
  }, [managersAll, managerUsageMap, currentProjectId]);

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

    const { data, error } = await api.fetchEventsForExport({ startYmd, endYmdExclusive: endYmd });

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

    const fileName = `${padMonthForFile(year, monthIndex0)}_予定.xlsx`;
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

  const selectedDayDowLabel = useMemo(() => {
    if (!selectedKey || selectedKey === "TBD") return "";
    try {
      const d = fromYmd(selectedKey);
      return weekdayLabelJP(d.getDay());
    } catch {
      return "";
    }
  }, [selectedKey]);

  return (
    <div className="app" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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

      <MonthHeader
        session={session}
        authBusy={authBusy}
        appError={appError}
        clearError={clearError}
        openMenuKey={openMenuKey}
        toggleMenu={toggleMenu}
        closeMenu={closeMenu}
        openMaster={openMaster}
        openExcelModal={() => setIsExcelOpen(true)}
        handleLogout={handleLogout}
        monthLabel={monthLabel}
        year={year}
        monthIndex0={monthIndex0}
        setMonthCursor={setMonthCursor}
      />

      <main className="main">
        <MonthGrid
          weeks={weeks}
          openWeek={openWeek}
          openDay={openDay}
          monthCellEvents={monthCellEvents}
          sameDay={sameDay}
          todayYmd={todayYmd}
          weekdayClass={weekdayClass}
          eventLabel={eventLabel}
          monthPeopleSummary={monthPeopleSummary}
        />
      </main>

      <MasterModal
        open={isMasterOpen}
        masterTab={masterTab}
        setMasterTab={setMasterTab}
        projectsActive={projectsActive}
        tasksActive={tasksActive}
        peopleActiveSorted={peopleActiveSorted}
        deletedProjects={deletedProjects}
        deletedTasks={deletedTasks}
        deletedPeople={deletedPeople}
        openMenuKey={openMenuKey}
        toggleMenu={toggleMenu}
        startEdit={startEdit}
        deleteMaster={deleteMaster}
        restoreProject={restoreProject}
        restoreTask={restoreTask}
        restorePerson={restorePerson}
        managersActive={managersActive}
        deletedManagers={deletedManagers}
        newManagerName={newManagerName}
        setNewManagerName={setNewManagerName}
        restoreManager={restoreManager}
        newGenbaName={newGenbaName}
        setNewGenbaName={setNewGenbaName}
        newTaskName={newTaskName}
        setNewTaskName={setNewTaskName}
        newPersonName={newPersonName}
        setNewPersonName={setNewPersonName}
        editKind={editKind}
        editId={editId}
        editName={editName}
        setEditName={setEditName}
        addMaster={addMaster}
        saveMasterEdit={saveMasterEdit}
        closeMaster={closeMaster}
        closeMenu={closeMenu}
        onSurfaceClick={onSurfaceClick}
        masterBodyRef={masterBodyRef}
        masterEditAnchorRef={masterEditAnchorRef}
      />

      <DayModal
        open={isDayOpen}
        selectedKey={selectedKey}
        openMenuKey={openMenuKey}
        canSave={canSave}
        editingEventId={editingEventId}
        selectedEvents={selectedEvents}
        selectedEventsDisplay={selectedEventsDisplay}
        selectedDayDowLabel={selectedDayDowLabel}
        projectInput={projectInput}
        taskInput={taskInput}
        note={note}
        peopleCount={peopleCount}
        peopleActiveSorted={peopleActiveSorted}
        selectedPeopleIds={selectedPeopleIds}
        newPersonInline={newPersonInline}
        managersActiveSorted={managersActiveSorted}
        selectedManagerId={selectedManagerId}
        setSelectedManagerId={setSelectedManagerId}
        projectSuggestions={projectSuggestions}
        taskSuggestions={taskSuggestions}
        currentProjectId={currentProjectId}
        taskUsageMap={taskUsageMap}
        COLOR_PALETTE={COLOR_PALETTE}
        color={color}
        dayBodyRef={dayBodyRef}
        onSurfaceClick={onSurfaceClick}
        toggleMenu={toggleMenu}
        closeMenu={closeMenu}
        setMonthCursor={setMonthCursor}
        closeDay={closeDay}
        goPrevDay={goPrevDay}
        goNextDay={goNextDay}
        eventLabel={eventLabel}
        peopleLine={peopleLine}
        beginEditEvent={beginEditEvent}
        openMoveModal={openMoveModal}
        softDeleteEvent={softDeleteEvent}
        swapOrder={swapOrder}
        setProjectInput={setProjectInput}
        setTaskInput={setTaskInput}
        setNote={setNote}
        setPeopleCount={setPeopleCount}
        setPeopleCountManual={setPeopleCountManual}
        setSelectedPeopleIds={setSelectedPeopleIds}
        setNewPersonInline={setNewPersonInline}
        addPersonInline={addPersonInline}
        setColor={setColor}
        resetForm={resetForm}
        openMultiAdd={openMultiAdd}
        addEvent={addEvent}
        saveEditEvent={saveEditEvent}
        onStartCopy={(ev) => {
        setCopySourceEvent(ev); // ステップ1で作ったstateに予定をセット
        setMultiMode("multi");
        setIsMultiAddOpen(true); // 複数日選択モーダルを開く
        }}
      />

      <MoveModal
        open={isMoveOpen}
        moveMonthLabel={moveMonthLabel}
        moveYear={moveYear}
        moveMonthIndex0={moveMonthIndex0}
        moveGridCells={moveGridCells}
        setMoveCursor={setMoveCursor}
        moveEventToTbdInstant={moveEventToTbdInstant}
        moveEventToYmdInstant={moveEventToYmdInstant}
        closeMoveModal={closeMoveModal}
        onSurfaceClick={onSurfaceClick}
      />

      <ExcelModal
        open={isExcelOpen}
        monthLabel={monthLabel}
        billingTargets={billingTargets}
        onUpdateBillingTarget={updateBillingTarget}
        onAddBillingTarget={addBillingTarget}
        onMergeBillingTargets={mergeBillingTargets}
        onExport={(ids) => {
          // TODO: Excel生成ロジック（Excelファイル確認後に実装）
          console.log("export", ids);
        }}
        onClose={() => setIsExcelOpen(false)}
        onSurfaceClick={onSurfaceClick}
      />

      <MultiAddModal
        open={isMultiAddOpen}
        multiYear={multiYear}
        multiMonthIndex0={multiMonthIndex0}
        multiMonthLabel={multiMonthLabel}
        setMultiCursor={setMultiCursor}
        multiMode={multiMode}
        setMultiMode={setMultiMode}
        weekdaySelected={weekdaySelected}
        setWeekdaySelected={setWeekdaySelected}
        weekdayLabelJP={weekdayLabelJP}
        multiGridCells={multiGridCells}
        isSelectedInMultiModal={isSelectedInMultiModal}
        onPickDayInMultiModal={onPickDayInMultiModal}
        buildSelectedYmdsForConfirm={buildSelectedYmdsForConfirm}
        canSave={canSave || !!copySourceEvent}
        isCopy={!!copySourceEvent}
        closeMultiAdd={closeMultiAdd}
        addEventToMultipleDays={addEventToMultipleDays}
        onSurfaceClick={onSurfaceClick}
      />
    </div>
  );
}