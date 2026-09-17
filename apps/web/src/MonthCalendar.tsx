import { useMemo, useState } from "react";
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
import {
  draftFromSlot,
  emptyDraft,
  EventModal,
  type EventDraft,
} from "./EventModal";

type Props = {
  activities: Activity[];
  schedule: ScheduleSlot[];
  studentId?: string | null;
  busy?: boolean;
  onSaveCustom: (draft: EventDraft) => Promise<void>;
  onDeleteCustom: (slotId: string, label?: string) => Promise<boolean | void>;
};

export function MonthCalendar({
  activities,
  schedule,
  studentId,
  busy,
  onSaveCustom,
  onDeleteCustom,
}: Props) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m0: now.getMonth() });
  const [selected, setSelected] = useState<string>(() => todayIsoLocal());
  const [modalDraft, setModalDraft] = useState<EventDraft | null>(null);
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

  function openCreate() {
    setModalDraft(emptyDraft(selected));
  }

  function openEdit(ev: Extract<CalendarEvent, { slotId: string }>) {
    setModalDraft(draftFromSlot(ev.slot, selected));
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
        <span className="cal-leg cal-leg-escola">Escola</span>
        <span className="cal-leg cal-leg-puntual">Puntual</span>
        <span className="cal-leg cal-leg-own">Setmanal</span>
      </div>
      <div className="cal-grid" role="grid" aria-label={monthLabelCa(cursor.y, cursor.m0)}>
        {weekdayHeaders().map((h) => (
          <div key={h} className="cal-dow" role="columnheader">
            {h}
          </div>
        ))}
        {cells.map((cell) => {
          const hasEscola = cell.events.some((e) => e.kind === "escola");
          const hasPuntual = cell.events.some((e) => e.kind === "puntual");
          const hasSetmanal = cell.events.some((e) => e.kind === "setmanal");
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
                {hasEscola ? <i className="dot escola" /> : null}
                {hasPuntual ? <i className="dot puntual" /> : null}
                {hasSetmanal ? <i className="dot own" /> : null}
              </span>
            </button>
          );
        })}
      </div>
      <div className="cal-daypanel">
        <div className="cal-dayhead">
          <h4 className="cal-daytitle">
            {selected}
            <span className="cal-dayweek"> · {weekdayNameFromIso(selected)}</span>
          </h4>
          <button
            type="button"
            className="cal-add-btn"
            disabled={!studentId || busy}
            onClick={openCreate}
          >
            + Afegir
          </button>
        </div>
        {dayEvents.length === 0 ? (
          <p className="hint">Cap activitat aquest dia.</p>
        ) : (
          <ul className="cal-eventlist">
            {dayEvents.map((e) => (
              <DayEventRow
                key={e.id}
                event={e}
                busy={busy}
                onEdit={openEdit}
                onDelete={onDeleteCustom}
              />
            ))}
          </ul>
        )}
      </div>
      <EventModal
        open={Boolean(modalDraft)}
        busy={busy}
        draft={modalDraft || emptyDraft(selected)}
        onClose={() => setModalDraft(null)}
        onSave={async (d) => {
          await onSaveCustom(d);
          setModalDraft(null);
        }}
        onDelete={
          modalDraft?.id
            ? async () => {
                const deleted = await onDeleteCustom(modalDraft.id!, modalDraft.subject);
                if (deleted !== false) setModalDraft(null);
              }
            : undefined
        }
      />
    </div>
  );
}

function DayEventRow({
  event,
  busy,
  onEdit,
  onDelete,
}: {
  event: CalendarEvent;
  busy?: boolean;
  onEdit: (ev: Extract<CalendarEvent, { slotId: string }>) => void;
  onDelete: (slotId: string, label?: string) => Promise<boolean | void>;
}) {
  if (event.kind === "escola") {
    return (
      <li className="cal-event cal-event-escola">
        <span className="cal-event-kind">Escola</span>
        <div className="cal-event-main">
          <strong>{event.title}</strong>
          {event.place ? <span className="cal-event-meta">{event.place}</span> : null}
          {event.description ? <p className="cal-event-desc">{event.description}</p> : null}
        </div>
      </li>
    );
  }
  const time = formatEventTime(event.start, event.end);
  const kindLabel = event.kind === "puntual" ? "Puntual" : "Setmanal";
  return (
    <li className={`cal-event cal-event-${event.kind}`}>
      <span className="cal-event-kind">{kindLabel}</span>
      <div className="cal-event-main">
        {time ? <span className="cal-event-time">{time}</span> : null}
        <strong>{event.title}</strong>
        {event.place ? <span className="cal-event-meta">{event.place}</span> : null}
        {event.kind === "setmanal" && (event.slot.dateFrom || event.slot.dateTo) ? (
          <span className="cal-event-meta">
            {event.slot.dateFrom || "…"} → {event.slot.dateTo || "…"}
          </span>
        ) : null}
      </div>
      <div className="cal-event-actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => onEdit(event)}>
          Editar
        </button>
        <button
          type="button"
          className="ghost"
          disabled={busy}
          aria-label={`Esborrar ${event.title}`}
          onClick={() => void onDelete(event.slotId, event.title)}
        >
          Esborrar
        </button>
      </div>
    </li>
  );
}
