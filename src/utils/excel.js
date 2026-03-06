// Excelのシート名制約
export function sanitizeSheetName(name) {
  const n = String(name ?? "").trim() || "（無名）";
  const cleaned = n.replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 31) || "（無名）";
}

export function uniqueSheetName(desired, usedSet) {
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

