import JapaneseHolidays from "japanese-holidays";
import { fromYmd } from "./date";

export function isHolidayDate(date) {
  if (!date) return false;
  try {
    return JapaneseHolidays.isHoliday(date);
  } catch {
    return false;
  }
}

export function isHolidayYmd(ymd) {
  try {
    const d = fromYmd(ymd);
    return isHolidayDate(d);
  } catch {
    return false;
  }
}

