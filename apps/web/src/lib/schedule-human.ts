/** Human-friendly schedule settings ↔ cron for the worker. */

export type ScheduleRecurrence = "daily" | "weekly" | "interval_hours";

export type HumanScheduleInput = {
  recurrence: ScheduleRecurrence;
  timeOfDay: string; // HH:MM
  timezone?: string;
  weekday?: number | null; // 0=Sun … 6=Sat (cron)
  intervalHours?: number | null;
};

export type ParsedTimeOfDay = { hour: number; minute: number };

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function parseTimeOfDay(raw: string): ParsedTimeOfDay | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return null;
  }
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

export function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? `day ${weekday}`;
}

export function compileCronExpr(input: HumanScheduleInput):
  | { ok: true; cronExpr: string }
  | { ok: false; error: string } {
  const time = parseTimeOfDay(input.timeOfDay);
  if (!time) {
    return { ok: false, error: "Start time must be HH:MM (24-hour)." };
  }

  if (input.recurrence === "daily") {
    return { ok: true, cronExpr: `${time.minute} ${time.hour} * * *` };
  }

  if (input.recurrence === "weekly") {
    const weekday = input.weekday;
    if (weekday == null || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, error: "Pick a weekday for weekly schedules." };
    }
    return { ok: true, cronExpr: `${time.minute} ${time.hour} * * ${weekday}` };
  }

  if (input.recurrence === "interval_hours") {
    const hours = input.intervalHours;
    if (hours == null || !Number.isInteger(hours) || hours < 1 || hours > 24) {
      return { ok: false, error: "Interval must be an integer from 1 to 24 hours." };
    }
    // Explicit hour list — node-cron rejects "9/5" (needs range like 9-23/5).
    // Align to start hour, then every N hours within the same day (09:30 / 5h → 9,14,19).
    const hourList: number[] = [];
    for (let hour = time.hour; hour < 24; hour += hours) {
      hourList.push(hour);
    }
    return {
      ok: true,
      cronExpr: `${time.minute} ${hourList.join(",")} * * *`,
    };
  }

  return { ok: false, error: "Unknown recurrence type." };
}

/** Best-effort reverse of compileCronExpr for upgrading legacy cron-only rows. */
export function inferHumanFromCron(cronExpr: string): HumanScheduleInput | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  const [minuteRaw, hourRaw, day, month, dow] = parts;
  if (day !== "*" || month !== "*") {
    return null;
  }
  const minute = Number(minuteRaw);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  const intervalMatch = /^(\d{1,2})\/(\d{1,2})$/.exec(hourRaw);
  if (intervalMatch && dow === "*") {
    const hour = Number(intervalMatch[1]);
    const intervalHours = Number(intervalMatch[2]);
    if (
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23 ||
      !Number.isInteger(intervalHours) ||
      intervalHours < 1 ||
      intervalHours > 24
    ) {
      return null;
    }
    return {
      recurrence: "interval_hours",
      timeOfDay: formatTimeOfDay(hour, minute),
      weekday: null,
      intervalHours,
    };
  }

  // Comma hour list from compileCronExpr interval_hours (e.g. "9,14,19")
  if (dow === "*" && /^\d{1,2}(,\d{1,2})+$/.test(hourRaw)) {
    const hours = hourRaw.split(",").map((part) => Number(part));
    if (
      hours.length >= 2 &&
      hours.every((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    ) {
      const step = hours[1]! - hours[0]!;
      const isRegular =
        step >= 1 &&
        hours.every((hour, index) => hour === hours[0]! + index * step);
      if (isRegular) {
        return {
          recurrence: "interval_hours",
          timeOfDay: formatTimeOfDay(hours[0]!, minute),
          weekday: null,
          intervalHours: step,
        };
      }
    }
  }

  const hour = Number(hourRaw);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  const timeOfDay = formatTimeOfDay(hour, minute);

  if (dow === "*") {
    return { recurrence: "daily", timeOfDay, weekday: null, intervalHours: null };
  }

  const weekday = Number(dow);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return null;
  }
  return {
    recurrence: "weekly",
    timeOfDay,
    weekday,
    intervalHours: null,
  };
}

export function describeHumanSchedule(input: {
  recurrence: string;
  timeOfDay: string;
  timezone: string;
  weekday?: number | null;
  intervalHours?: number | null;
}): string {
  const zone = input.timezone.trim() || "UTC";
  const time = input.timeOfDay.trim() || "09:00";

  if (input.recurrence === "daily") {
    return `Every day at ${time} (${zone})`;
  }
  if (input.recurrence === "weekly") {
    const day =
      input.weekday != null && input.weekday >= 0 && input.weekday <= 6
        ? weekdayLabel(input.weekday)
        : "weekday";
    return `Every ${day} at ${time} (${zone})`;
  }
  if (input.recurrence === "interval_hours") {
    const n = input.intervalHours ?? 1;
    return `Every ${n} hour${n === 1 ? "" : "s"} from ${time} (${zone})`;
  }
  return `${time} (${zone})`;
}

export function validateHumanSchedule(
  input: HumanScheduleInput,
): { ok: true } | { ok: false; error: string } {
  const compiled = compileCronExpr(input);
  if (!compiled.ok) {
    return compiled;
  }
  const zone = input.timezone?.trim() || "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
  } catch {
    return { ok: false, error: "Timezone must be a valid IANA name (e.g. Europe/Moscow)." };
  }
  return { ok: true };
}

export function humanFieldsMatchCron(
  cronExpr: string,
  human: HumanScheduleInput,
): boolean {
  const compiled = compileCronExpr(human);
  return compiled.ok && compiled.cronExpr === cronExpr.trim();
}
