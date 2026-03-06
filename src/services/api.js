import { supabase } from "../supabase";

// ========== Masters ==========
export async function fetchProjects() {
  return await supabase.from("projects").select("*");
}

export async function fetchTasks() {
  return await supabase.from("tasks").select("*").order("name", { ascending: true });
}

export async function fetchPeople() {
  return await supabase.from("people").select("*").order("name", { ascending: true });
}

export async function restoreProjectById(id) {
  return await supabase.from("projects").update({ deleted_at: null }).eq("id", id);
}

export async function restoreTaskById(id) {
  return await supabase.from("tasks").update({ deleted_at: null }).eq("id", id);
}

export async function restorePersonById(id) {
  return await supabase.from("people").update({ deleted_at: null }).eq("id", id);
}

export async function createProject({ name, createdAt }) {
  return await supabase.from("projects").insert([{ name, created_at: createdAt, deleted_at: null }]).select("*").single();
}

export async function createTask({ name, createdAt }) {
  return await supabase.from("tasks").insert([{ name, created_at: createdAt, deleted_at: null }]).select("*").single();
}

export async function createPerson({ name, createdAt }) {
  return await supabase.from("people").insert([{ name, created_at: createdAt, deleted_at: null }]).select("*").single();
}

export async function updateProjectName({ id, name }) {
  return await supabase.from("projects").update({ name }).eq("id", id);
}

export async function updateTaskName({ id, name }) {
  return await supabase.from("tasks").update({ name }).eq("id", id);
}

export async function updatePersonName({ id, name }) {
  return await supabase.from("people").update({ name }).eq("id", id);
}

export async function softDeleteProjectById({ id, nowIso }) {
  return await supabase.from("projects").update({ deleted_at: nowIso }).eq("id", id);
}

export async function softDeleteTaskById({ id, nowIso }) {
  return await supabase.from("tasks").update({ deleted_at: nowIso }).eq("id", id);
}

export async function softDeletePersonById({ id, nowIso }) {
  return await supabase.from("people").update({ deleted_at: nowIso }).eq("id", id);
}

// ========== Events ==========
export async function fetchEventsTbd() {
  return await supabase.from("events").select("*").eq("bucket", "TBD").is("deleted_at", null);
}

export async function fetchEventsRange({ startYmd, endYmdExclusive }) {
  return await supabase.from("events").select("*").gte("date", startYmd).lt("date", endYmdExclusive).is("deleted_at", null);
}

export async function fetchEventsForExport({ startYmd, endYmdExclusive }) {
  return await supabase.from("events").select("*").gte("date", startYmd).lt("date", endYmdExclusive).is("deleted_at", null);
}

export async function insertEvent(row) {
  return await supabase.from("events").insert([row]);
}

export async function updateEventById({ id, patch }) {
  return await supabase.from("events").update(patch).eq("id", id);
}

export async function softDeleteEventById({ id, nowIso }) {
  return await supabase.from("events").update({ deleted_at: nowIso, updated_at: nowIso }).eq("id", id);
}

export async function swapEventOrder({ idA, orderA, idB, orderB, nowIso }) {
  const r1 = await supabase.from("events").update({ order: orderB, updated_at: nowIso }).eq("id", idA);
  if (r1.error) return { error: r1.error };
  const r2 = await supabase.from("events").update({ order: orderA, updated_at: nowIso }).eq("id", idB);
  if (r2.error) return { error: r2.error };
  return { error: null };
}

export async function fetchProjectUsageRows() {
  return await supabase.from("events").select("project_id, deleted_at");
}

