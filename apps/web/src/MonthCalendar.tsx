import { useMemo, useState, type FormEvent } from "react";
import type { Activity, ScheduleSlot } from "./api";
import {
  activityEvents,
  buildMonthGrid,
  customEventsForMonth,
  formatEventTime,
  monthLabelCa,
  pad2,
  todayIsoLocal,
  weekdayHeaders,
  weekdayNameFromIso,
  type CalendarEvent,
} from "./calendar";

type Props = {
  activities: Activity[];
  schedule: ScheduleSlot[];
  studentId?: string | null;
  studentName?: string;
  busy?: boolean;
  onAddCustom: (input: {
    day: string;
    dateIso: string;
    start: string;
    end: string;
    subject: string;
  }) => Promise<void>;
  onDeleteCustom: (slotId: string, label?: string) => Promise<void>;
};

export function MonthCalendar({
  activities,
  schedule,
  studentId,
  busy,
  onAddCustom,
  onDeleteCustom,
}: Props) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m0: now.getMonth() });
  const [selected, setSelected] = useState<string>(() => todayIsoLocal());
  const [form, setForm] = useState({ subject: "", start: "17:00", end: "18:00" });
  const today = todayIsoLocal();

  const events = useMemo(() => {
    const acts = activityEvents(activities).filter((e) => {
      const [yy, mm] = e.dateIso.split("-").map(Number);
      return yy === cursor.y && mm === cursor.m0 + 1;
    });
    const customs = customEventsForMonth(schedule, cursor.y, cursor.m0);
    return [...acts, ...customs];
  }, [activities, schedule, cursor.y, cursor.m0]);

  const cells = useMemo(
    () => buildMonthGrid(cursor.y, cursor.m0, events, today),
    [cursor.y, cursor.m0, events, today],
  );

  const dayEvents = useMemo(
    () => events.filter((e) => e.dateIso === selected),
    [events, selected],
  );

  function shiftMonth(delta: number) {
    setCursor((c) => {
      const d = new Date(c.y, c.m0 + delta, 1);
      const y = d.getFullYear();
      const m0 = d.getMonth();
      const prefix = `${y}-${pad2(m0 + 1)}`;
      const t = todayIsoLocal();
      setSelected(t.startsWith(prefix) ? t : `${prefix}-01`);
      return { y, m0 };
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!studentId || !form.subject.trim()) return;
    await onAddCustom({
      day: weekdayNameFromIso(selected),
      dateIso: selected,
      start: form.start,
      end: form.end,
      subject: form.subject.trim(),
    });
    setForm((f) => ({ ...f, subject: "" }));
  }

  return (
    <div className="cal">
      <div className="cal-toolbar">
        <button type="button" className="ghost cal-nav" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
          ‹
        </button>
        <h3 className="cal-title">{monthLabelCa(cursor.y, cursor.m0)}</h3>
        <button type="button" className="ghost cal-nav" onClick={() => shiftMonth(1)} aria-label="Mes següent">
          ›
        </button>
        <button
          type="button"
          className="ghost cal-today"
          onClick={() => {
            const n = new Date();
            setCursor({ y: n.getFullYear(), m0: n.getMonth() });
            setSelected(todayIsoLocal());
          }}
        >
          Avui
        </button>
      </div>
      <div className="cal-legend" aria-hidden="true">
        <span className="cal-leg cal-leg-act">Activitat puntual</span>
        <span className="cal-leg cal-leg-own">Pròpia · inici–fi</span>
      </div>
      <div className="cal-grid" role="grid" aria-label={monthLabelCa(cursor.y, cursor.m0)}>
        {weekdayHeaders().map((h) => (
          <div key={h} className="cal-dow" role="columnheader">
            {h}
          </div>
        ))}
        {cells.map((cell) => {
          const hasAct = cell.events.some((e) => e.kind === "activity");
          const hasOwn = cell.events.some((e) => e.kind === "custom");
          const cls = [
            "cal-cell",
            cell.inMonth ? "" : "out",
            cell.isToday ? "today" : "",
            cell.dateIso === selected ? "selected" : "",
            cell.events.length ? "has-events" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={cell.dateIso + (cell.inMonth ? "" : "-o")}
              type="button"
              className={cls}
              role="gridcell"
              aria-selected={cell.dateIso === selected}
              aria-label={`${cell.dateIso}${cell.events.length ? `, ${cell.events.length} esdeveniments` : ""}`}
              onClick={() => setSelected(cell.dateIso)}
            >
              <span className="cal-daynum">{cell.day}</span>
              <span className="cal-dots">
                {hasAct ? <i className="dot act" /> : null}
                {hasOwn ? <i className="dot own" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cal-daypanel">
        <h4 className="cal-daytitle">
          {selected}
          <span className="cal-dayweek"> · {weekdayNameFromIso(selected)}</span>
        </h4>
        {dayEvents.length === 0 ? (
          <p className="hint">Cap activitat aquest dia.</p>
        ) : (
          <ul className="cal-eventlist">
            {dayEvents.map((e) => (
              <DayEventRow key={e.id} event={e} busy={busy} onDelete={onDeleteCustom} />
            ))}
          </ul>
        )}
        <form className="cal-add" onSubmit={(ev) => void submit(ev)}>
          <p className="hint">Afegir activitat pròpia (amb hora d’inici i fi)</p>
          <div className="cal-add-row">
            <input
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="Nom"
              required
              aria-label="Nom de l'activitat"
              disabled={!studentId || busy}
            />
            <input
              type="time"
              value={form.start}
              onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
              required
              aria-label="Inici"
              disabled={!studentId || busy}
            />
            <input
              type="time"
              value={form.end}
              onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
              required
              aria-label="Fi"
              disabled={!studentId || busy}
            />
            <button type="submit" disabled={!studentId || busy} title="Afegir">
              +
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DayEventRow({
  event,
  busy,
  onDelete,
}: {
  event: CalendarEvent;
  busy?: boolean;
  onDelete: (slotId: string, label?: string) => Promise<void>;
}) {
  if (event.kind === "activity") {
    return (
      <li className="cal-event cal-event-act">
        <span className="cal-event-kind">Puntual</span>
        <strong>{event.title}</strong>
        {event.place ? <span className="cal-event-meta">{event.place}</span> : null}
        {event.description ? <p className="cal-event-desc">{event.description}</p> : null}
      </li>
    );
  }
  const time = formatEventTime(event);
  return (
    <li className="cal-event cal-event-own">
      <span className="cal-event-kind">Pròpia</span>
      {time ? <span className="cal-event-time">{time}</span> : null}
      <strong>{event.title}</strong>
      <button
        type="button"
        className="ghost cal-event-del"
        disabled={busy}
        aria-label={`Esborrar ${event.title}`}
        onClick={() => void onDelete(event.slotId, event.title)}
      >
        Esborrar
      </button>
    </li>
  );
}
