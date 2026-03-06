function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromYmd(ymd) {
  const [y, m, d] = String(ymd).split("-").map((x) => parseInt(x, 10));
  return new Date(y, m - 1, d);
}

export function addDaysYmd(ymd, delta) {
  const d = fromYmd(ymd);
  d.setDate(d.getDate() + delta);
  return toYmd(d);
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function sameDay(a, b) {
  return a && b && a === b;
}

// 月曜始まりの 6週(42セル)カレンダー
export function buildMonthGrid(year, monthIndex0, opts = {}) {
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

export function mondayOfYmd(ymd) {
  const d = fromYmd(ymd);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toYmd(monday);
}

export function ymdToMonthLabel(year, monthIndex0) {
  return `${year}年${monthIndex0 + 1}月`;
}

export function padMonthForFile(year, monthIndex0) {
  return `${year}-${pad2(monthIndex0 + 1)}`;
}

