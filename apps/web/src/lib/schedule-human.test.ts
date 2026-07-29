import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileCronExpr,
  describeHumanSchedule,
  inferHumanFromCron,
  parseTimeOfDay,
} from "./schedule-human";

describe("schedule-human", () => {
  it("parses HH:MM", () => {
    assert.deepEqual(parseTimeOfDay("9:05"), { hour: 9, minute: 5 });
    assert.deepEqual(parseTimeOfDay("18:30"), { hour: 18, minute: 30 });
    assert.equal(parseTimeOfDay("25:00"), null);
  });

  it("compiles daily / weekly / interval crons", () => {
    assert.deepEqual(
      compileCronExpr({ recurrence: "daily", timeOfDay: "09:00" }),
      { ok: true, cronExpr: "0 9 * * *" },
    );
    assert.deepEqual(
      compileCronExpr({ recurrence: "weekly", timeOfDay: "18:30", weekday: 5 }),
      { ok: true, cronExpr: "30 18 * * 5" },
    );
    assert.deepEqual(
      compileCronExpr({
        recurrence: "interval_hours",
        timeOfDay: "09:30",
        intervalHours: 5,
      }),
      { ok: true, cronExpr: "30 9/5 * * *" },
    );
  });

  it("describes schedules for humans", () => {
    assert.equal(
      describeHumanSchedule({
        recurrence: "daily",
        timeOfDay: "09:00",
        timezone: "Europe/Moscow",
      }),
      "Every day at 09:00 (Europe/Moscow)",
    );
    assert.equal(
      describeHumanSchedule({
        recurrence: "weekly",
        timeOfDay: "18:00",
        timezone: "UTC",
        weekday: 5,
      }),
      "Every Friday at 18:00 (UTC)",
    );
    assert.equal(
      describeHumanSchedule({
        recurrence: "interval_hours",
        timeOfDay: "09:00",
        timezone: "UTC",
        intervalHours: 5,
      }),
      "Every 5 hours from 09:00 (UTC)",
    );
  });

  it("infers human fields from cron", () => {
    assert.deepEqual(inferHumanFromCron("0 9 * * *"), {
      recurrence: "daily",
      timeOfDay: "09:00",
      weekday: null,
      intervalHours: null,
    });
    assert.deepEqual(inferHumanFromCron("30 18 * * 5"), {
      recurrence: "weekly",
      timeOfDay: "18:30",
      weekday: 5,
      intervalHours: null,
    });
    assert.deepEqual(inferHumanFromCron("30 9/5 * * *"), {
      recurrence: "interval_hours",
      timeOfDay: "09:30",
      weekday: null,
      intervalHours: 5,
    });
  });
});
