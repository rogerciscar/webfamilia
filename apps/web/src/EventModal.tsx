import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { CustomEventKind, ScheduleSlot } from "./api";
import {
  addMonthsIso,
  orderWeekdays,
  resolveEventKind,
  slotWeekdays,
  weekdaysCa,
  weekdayNameFromIso,
} from "./calendar";

export type EventDraft = {
  id?: string;
  eventKind: CustomEventKind;
  subject: string;
  day: string;
  days: string[];
  dateIso: string;
  dateFrom: string;
  dateTo: string;
  start: string;
  end: string;
  place: string;
  notes: string;
};

type Props = {
  open: boolean;
  busy?: boolean;
  draft: EventDraft;
  onClose: () => void;
  onSave: (draft: EventDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
};

export function emptyDraft(selectedIso: string): EventDraft {
  const day = weekdayNameFromIso(selectedIso);
  return {
    eventKind: "puntual",
    subject: "",
    day,
    days: [day],
    dateIso: selectedIso,
    dateFrom: selectedIso,
    dateTo: addMonthsIso(selectedIso, 3),
    start: "17:00",
    end: "18:00",
    place: "",
    notes: "",
  };
}

export function draftFromSlot(slot: ScheduleSlot, fallbackIso: string): EventDraft {
  const kind = resolveEventKind(slot);
  const days = slotWeekdays(slot);
  const day = days[0] || slot.day || weekdayNameFromIso(slot.dateIso || fallbackIso);
  return {
    id: slot.id,
    eventKind: kind,
    subject: slot.subject,
    day,
    days: days.length ? days : [day],
    dateIso: slot.dateIso || fallbackIso,
    dateFrom: slot.dateFrom || slot.dateIso || fallbackIso,
    dateTo: slot.dateTo || addMonthsIso(slot.dateFrom || fallbackIso, 3),
    start: slot.start || "17:00",
    end: slot.end || "18:00",
    place: slot.place || "",
    notes: slot.notes || "",
  };
}

export function EventModal({ open, busy, draft: initial, onClose, onSave, onDelete }: Props) {
  const titleId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    setError(null);
    const t = window.setTimeout(() => firstRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  function toggleDay(day: string) {
    setDraft((d) => {
      const has = d.days.some((x) => x === day);
      const next = orderWeekdays(has ? d.days.filter((x) => x !== day) : [...d.days, day]);
      return { ...d, days: next, day: next[0] || day };
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.subject.trim()) {
      setError("Cal un nom.");
      return;
    }
    if (draft.eventKind === "setmanal") {
      const days = orderWeekdays(draft.days);
      if (!days.length) {
        setError("Tria almenys un dia de la setmana.");
        return;
      }
      if (!draft.dateFrom || !draft.dateTo) {
        setError("Cal data d'inici i de fi.");
        return;
      }
      if (draft.dateFrom > draft.dateTo) {
        setError("La data d'inici ha de ser anterior a la de fi.");
        return;
      }
      if (!draft.start || !draft.end) {
        setError("Cal hora d'inici i de fi.");
        return;
      }
    }
    setError(null);
    const days = orderWeekdays(draft.days);
    try {
      await onSave({
        ...draft,
        subject: draft.subject.trim(),
        place: draft.place.trim(),
        notes: draft.notes.trim(),
        days,
        day:
          draft.eventKind === "puntual"
            ? weekdayNameFromIso(draft.dateIso)
            : days[0] || draft.day,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'ha pogut desar");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h3 id={titleId}>{draft.id ? "Editar activitat" : "Nova activitat"}</h3>
          <button type="button" className="ghost modal-x" onClick={onClose} disabled={busy} aria-label="Tancar">
            ×
          </button>
        </header>
        <form className="modal-body" onSubmit={(e) => void submit(e)}>
          <div className="seg" role="radiogroup" aria-label="Tipus">
            <button
              type="button"
              role="radio"
              aria-checked={draft.eventKind === "puntual"}
              className={draft.eventKind === "puntual" ? "active" : ""}
              onClick={() => setDraft((d) => ({ ...d, eventKind: "puntual" }))}
            >
              Puntual · un dia
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={draft.eventKind === "setmanal"}
              className={draft.eventKind === "setmanal" ? "active" : ""}
              onClick={() =>
                setDraft((d) => {
                  const days = orderWeekdays(d.days.length ? d.days : [d.day || weekdayNameFromIso(d.dateIso)]);
                  return {
                    ...d,
                    eventKind: "setmanal",
                    days,
                    day: days[0] || weekdayNameFromIso(d.dateIso),
                  };
                })
              }
            >
              Període · dies + horari
            </button>
          </div>
          <label>
            Nom
            <input
              ref={firstRef}
              value={draft.subject}
              onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
              required
              disabled={busy}
              placeholder="Ex. Vesprades de setembre"
            />
          </label>
          {draft.eventKind === "puntual" ? (
            <>
              <label>
                Data
                <input
                  type="date"
                  value={draft.dateIso}
                  onChange={(e) => setDraft((d) => ({ ...d, dateIso: e.target.value }))}
                  required
                  disabled={busy}
                />
              </label>
              <div className="modal-row2">
                <label>
                  Inici <span className="opt">(opc.)</span>
                  <input
                    type="time"
                    value={draft.start}
                    onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                    disabled={busy}
                  />
                </label>
                <label>
                  Fi <span className="opt">(opc.)</span>
                  <input
                    type="time"
                    value={draft.end}
                    onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                    disabled={busy}
                  />
                </label>
              </div>
              <label>
                Lloc <span className="opt">(opc.)</span>
                <input
                  value={draft.place}
                  onChange={(e) => setDraft((d) => ({ ...d, place: e.target.value }))}
                  disabled={busy}
                  placeholder="Pavelló, aula…"
                />
              </label>
            </>
          ) : (
            <>
              <fieldset className="day-chips-fieldset">
                <legend>Dies de la setmana</legend>
                <div className="day-chips" role="group" aria-label="Dies de la setmana">
                  {weekdaysCa().map((w) => {
                    const active = draft.days.includes(w);
                    return (
                      <button
                        key={w}
                        type="button"
                        className={active ? "day-chip active" : "day-chip"}
                        aria-pressed={active}
                        disabled={busy}
                        onClick={() => toggleDay(w)}
                      >
                        {w.slice(0, 2)}
                      </button>
                    );
                  })}
                </div>
                <p className="day-chips-hint">Ex. Dl–Dj per vesprades de setembre</p>
              </fieldset>
              <div className="modal-row2">
                <label>
                  Hora inici
                  <input
                    type="time"
                    value={draft.start}
                    onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
                    required
                    disabled={busy}
                  />
                </label>
                <label>
                  Hora fi
                  <input
                    type="time"
                    value={draft.end}
                    onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                    required
                    disabled={busy}
                  />
                </label>
              </div>
              <div className="modal-row2">
                <label>
                  Des de
                  <input
                    type="date"
                    value={draft.dateFrom}
                    onChange={(e) => setDraft((d) => ({ ...d, dateFrom: e.target.value }))}
                    required
                    disabled={busy}
                  />
                </label>
                <label>
                  Fins a
                  <input
                    type="date"
                    value={draft.dateTo}
                    onChange={(e) => setDraft((d) => ({ ...d, dateTo: e.target.value }))}
                    required
                    disabled={busy}
                  />
                </label>
              </div>
            </>
          )}
          <label>
            Notes <span className="opt">(opc.)</span>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              disabled={busy}
              rows={2}
              placeholder="Detall breu"
            />
          </label>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            {draft.id && onDelete ? (
              <button
                type="button"
                className="ghost danger-text"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                Esborrar
              </button>
            ) : (
              <span />
            )}
            <div className="modal-actions-right">
              <button type="button" className="ghost" disabled={busy} onClick={onClose}>
                Cancel·lar
              </button>
              <button type="submit" disabled={busy}>
                {draft.id ? "Desar" : "Afegir"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
