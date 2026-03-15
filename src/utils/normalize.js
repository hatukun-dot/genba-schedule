import { uniqNumArray, toIntOrNull } from "./id";
import { clamp } from "./date";

// people_count NOT NULL 対策（DBは0で保存、UIはnullとして扱う）
export function toDbPeopleCount(appCount) {
  if (appCount === null || appCount === undefined) return 0;
  const n = Number(appCount);
  if (!Number.isFinite(n)) return 0;
  return clamp(n, 0, 99);
}

export function fromDbPeopleCount(dbCount) {
  const n = Number(dbCount);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

/** Supabase row -> App shape（camelCaseに正規化） */
export function normalizeProjectRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    name: r.name,
    createdAt: r.created_at ?? r.createdAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

export function normalizeTaskRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    name: r.name,
    createdAt: r.created_at ?? r.createdAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

export function normalizePeopleRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    name: r.name,
    createdAt: r.created_at ?? r.createdAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

export function normalizeEventRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    date: r.date ?? null,
    bucket: r.bucket ?? null,
    projectId: toIntOrNull(r.project_id ?? r.projectId ?? null),
    taskId: toIntOrNull(r.task_id ?? r.taskId ?? null),
    managerId: toIntOrNull(r.manager_id ?? r.managerId ?? null),
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

export function normalizeManagerRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    name: r.name,
    createdAt: r.created_at ?? r.createdAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}

export function normalizeBillingTargetRow(r) {
  return {
    ...r,
    id: toIntOrNull(r.id),
    name: r.name,
    projectId: toIntOrNull(r.project_id ?? r.projectId ?? null),
    closingType: r.closing_type ?? r.closingType ?? '月末締め',
    outputType: r.output_type ?? r.outputType ?? 'リストのみ',
    billingType: r.billing_type ?? r.billingType ?? '人工',
    groupByManager: r.group_by_manager ?? r.groupByManager ?? false,
    unitPrice: r.unit_price ?? r.unitPrice ?? null,
    createdAt: r.created_at ?? r.createdAt ?? null,
    deletedAt: r.deleted_at ?? r.deletedAt ?? null,
  };
}
