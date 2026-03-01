import Dexie from "dexie";

export const DB_NAME = "genba_schedule";
export const db = new Dexie(DB_NAME);

// v10（初期）
db.version(10).stores({
  meta: "&key",
  projects: "++id,&name,createdAt",
  tasks: "++id,&name,createdAt",
  people: "++id,&name,createdAt",
  events: "++id,date,bucket,projectId,taskId,order,deletedAt,createdAt",
});

// v11：people に deletedAt 追加
db.version(11)
  .stores({
    meta: "&key",
    projects: "++id,&name,createdAt",
    tasks: "++id,&name,createdAt",
    people: "++id,&name,createdAt,deletedAt",
    events: "++id,date,bucket,projectId,taskId,order,deletedAt,createdAt",
  })
  .upgrade(async (tx) => {
    await tx.table("people").toCollection().modify((p) => {
      if (p.deletedAt === undefined) p.deletedAt = null;
    });
  });

// v12：taskUsage 追加
db.version(12)
  .stores({
    meta: "&key",
    projects: "++id,&name,createdAt",
    tasks: "++id,&name,createdAt",
    people: "++id,&name,createdAt,deletedAt",
    events: "++id,date,bucket,projectId,taskId,order,deletedAt,createdAt",
    taskUsage: "[projectId+taskId],projectId,taskId,count,updatedAt",
  })
  .upgrade(async () => {
    // 初期化不要
  });

// v13：projects/tasks に deletedAt 追加 + peopleUsage 追加（人員の累計選択回数）
db.version(13)
  .stores({
    meta: "&key",
    projects: "++id,&name,createdAt,deletedAt",
    tasks: "++id,&name,createdAt,deletedAt",
    people: "++id,&name,createdAt,deletedAt",
    events: "++id,date,bucket,projectId,taskId,order,deletedAt,createdAt",
    taskUsage: "[projectId+taskId],projectId,taskId,count,updatedAt",
    peopleUsage: "&personId,count,updatedAt",
  })
  .upgrade(async (tx) => {
    await tx.table("projects").toCollection().modify((p) => {
      if (p.deletedAt === undefined) p.deletedAt = null;
    });
    await tx.table("tasks").toCollection().modify((t) => {
      if (t.deletedAt === undefined) t.deletedAt = null;
    });
    await tx.table("people").toCollection().modify((p) => {
      if (p.deletedAt === undefined) p.deletedAt = null;
    });
  });

// 現場
export const INITIAL_PROJECTS = [
  "休み",
  "応援",
  "S湖西",
  "S豊橋東",
  "S明海",
  "K湖西",
  "K豊橋東",
  "K明海",
  "ダイワ",
  "岩村建設",
  "一幸建設",
  "イズマ",
  "ヤノクリーン",
  "三五寮",
  "中部",
  "河合大",
];

// 作業
export const INITIAL_TASKS = [
  "日常",
  "切粉",
  "利材",
  "リフォーム",
  "既設住宅",
  "既設アパート",
  "鷺ノ宮団地",
  "有玉台団地",
  "冨吉団地",
  "作責立会",
  "緑化",
  "アパート草刈",
  "解体",
];

export const COLOR_PALETTE = [
  { key: null, label: "黒(既定)" },
  { key: "#e53935", label: "赤" },
  { key: "#1e88e5", label: "青" },
  { key: "#43a047", label: "緑" },
  { key: "#fb8c00", label: "オレンジ" },
  { key: "#8e24aa", label: "紫" },
  { key: "#546e7a", label: "グレー" },
  { key: "#283593", label: "濃紺" },
  { key: "#6d4c41", label: "茶" },
  { key: "#00897b", label: "ティール" },
];

function nowIso() {
  return new Date().toISOString();
}

// 初回限定ではなく「不足分補充」
// ※ v13 以降を前提に、追加データには deletedAt:null を付与します
export async function seedIfNeeded() {
  await db.transaction("rw", db.meta, db.projects, db.tasks, async () => {
    const createdAt = nowIso();

    const existingProjects = await db.projects.toArray();
    const existingProjectNames = new Set(existingProjects.map((p) => p.name));

    const existingTasks = await db.tasks.toArray();
    const existingTaskNames = new Set(existingTasks.map((t) => t.name));

    const toAddProjects = INITIAL_PROJECTS
      .filter((name) => !existingProjectNames.has(name))
      .map((name) => ({ name, createdAt, deletedAt: null }));

    const toAddTasks = INITIAL_TASKS
      .filter((name) => !existingTaskNames.has(name))
      .map((name) => ({ name, createdAt, deletedAt: null }));

    if (toAddProjects.length) await db.projects.bulkPut(toAddProjects);
    if (toAddTasks.length) await db.tasks.bulkPut(toAddTasks);

    await db.meta.put({ key: "seeded", value: true });
  });
}