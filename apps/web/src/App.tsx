import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  fetchSession,
  forget,
  login,
  logout,
  removeCustomSlot,
  saveCustomSlot,
  startMock,
  unlock,
  uploadStudentPhoto,
  type Dashboard,
  type MenuExtraction,
  type SessionStatus,
} from "./api";
import {
  clearRememberedLogin,
  loadRememberedLogin,
  saveRememberedLogin,
} from "./remember";
import { PhotoCropper } from "./PhotoCropper";
import { PdfViewer } from "./PdfViewer";
import { InstallAppButton } from "./InstallAppButton";
import { MonthCalendar } from "./MonthCalendar";
import {
  menuSlotsForDay,
  normalizeDay,
  saladLabel,
} from "./menu-schedule";
import {
  addDaysIso,
  mondayOfWeek,
  parseIso,
  resolveEventKind,
  todayIsoLocal,
  weekLabelCa,
} from "./calendar";

type Tab =
  | "agenda"
  | "assistencies"
  | "activitats"
  | "comunicacions"
  | "qualificacions"
  | "assignatures"
  | "menus"
  | "horari"
  | "calendari";

const TABS: { id: Tab; label: string }[] = [
  { id: "horari", label: "Horari" },
  { id: "calendari", label: "Cal." },
  { id: "assignatures", label: "Assign." },
  { id: "agenda", label: "Agenda" },
  { id: "assistencies", label: "Assist." },
  { id: "activitats", label: "Activ." },
  { id: "comunicacions", label: "Comun." },
  { id: "qualificacions", label: "Notes" },
  { id: "menus", label: "Menús" },
];

const WEEK_DAYS = ["Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres"] as const;
const APP_VERSION = "0.3.10";

function todayWeekday(): (typeof WEEK_DAYS)[number] {
  const idx = new Date().getDay();
  if (idx >= 1 && idx <= 5) return WEEK_DAYS[idx - 1]!;
  return "Dilluns";
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "topbar-brand" : "brand-lockup"}>
      <img src="/webfamilia-logo.png" alt="" width={compact ? 44 : 72} height={compact ? 44 : 72} />
      {compact ? (
        <div>
          <h1>WebFamilia</h1>
        </div>
      ) : (
        <h1 className="brand">
          WebFamilia<em>.</em>
        </h1>
      )}
    </div>
  );
}

function Entrance({
  version,
  label,
}: {
  version?: string;
  label: string;
}) {
  return (
    <main className="entrance" aria-busy="true" aria-live="polite">
      <div className="entrance-stage">
        <div className="entrance-orb" aria-hidden="true" />
        <div className="entrance-orb entrance-orb-2" aria-hidden="true" />
        <div className="entrance-card">
          <div className="entrance-logo-3d">
            <img src="/webfamilia-logo.png" alt="" width={96} height={96} />
          </div>
          <h1 className="brand entrance-title">
            WebFamilia<em>.</em>
          </h1>
          <p className="lede entrance-lede">{label}</p>
          <span className="version-badge">v{version || APP_VERSION}</span>
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>("horari");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changeUser, setChangeUser] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [scheduleDay, setScheduleDay] = useState<string>(() => todayWeekday());
  const [weekMonday, setWeekMonday] = useState(() => mondayOfWeek(todayIsoLocal()));
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [pdfView, setPdfView] = useState<{ url: string; title: string } | null>(null);
  const [photoTick, setPhotoTick] = useState(0);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function revealApp(dash: Dashboard, nextSession?: SessionStatus) {
    setEntering(true);
    setDashboard(dash);
    if (nextSession) setSession(nextSession);
    window.setTimeout(() => setEntering(false), 1100);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remembered = loadRememberedLogin();
        if (remembered) {
          setUsername(remembered.username);
          setRemember(true);
        }
        const status = await fetchSession();
        if (cancelled) return;
        setSession(status);
        if (status.authenticated && status.dashboard) {
          revealApp(status.dashboard, status);
          return;
        }
        if (status.username && !remembered) setUsername(status.username);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error de sessió");
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dashboard?.students?.length) return;
    setStudentId((prev) =>
      prev && dashboard.students.some((s) => s.id === prev)
        ? prev
        : dashboard.student?.id ?? dashboard.students[0].id,
    );
  }, [dashboard]);

  async function onMock() {
    setBusy(true);
    setError(null);
    try {
      const res = await startMock();
      revealApp(res.dashboard, res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login({
        username,
        password,
        remember,
        protectWithMaster: false,
        idioma: "V",
      });
      if (remember) saveRememberedLogin({ username, keepPassword: false });
      else clearRememberedLogin();
      setChangeUser(false);
      revealApp(res.dashboard, res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de login");
    } finally {
      setBusy(false);
    }
  }

  async function doUnlock(opts?: { master?: string; password?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await unlock({
        masterPassword: opts?.master,
        password: opts?.password,
      });
      revealApp(res.dashboard, res.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'ha pogut desbloquejar");
    } finally {
      setBusy(false);
    }
  }

  async function onUnlock(e: FormEvent) {
    e.preventDefault();
    if (session?.vaultMode === "master") {
      await doUnlock({ master: unlockPassword });
      return;
    }
    await doUnlock({ password: unlockPassword });
  }

  async function onForget() {
    setBusy(true);
    setError(null);
    try {
      clearRememberedLogin();
      const res = await forget();
      setSession(res.session);
      setDashboard(null);
      setPassword("");
      setUnlockPassword("");
      setChangeUser(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'han pogut oblidar");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    setBusy(true);
    try {
      const res = await logout();
      setSession(res.session);
      setDashboard(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en tancar sessió");
    } finally {
      setBusy(false);
    }
  }

  async function onPickPhoto(file: File | null) {
    if (!file || !studentId) return;
    setCropFile(file);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function onConfirmCrop(blob: Blob) {
    if (!studentId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadStudentPhoto(studentId, blob, "carnet.jpg");
      const dash = res.dashboard;
      const students = dash.students.map((s) =>
        s.id === studentId
          ? {
              ...s,
              hasPhoto: true,
              photoUrl: `/api/students/${encodeURIComponent(studentId)}/photo`,
            }
          : s,
      );
      setDashboard({
        ...dash,
        students,
        student: students.find((s) => s.id === dash.student?.id) ?? students[0] ?? dash.student,
      });
      setPhotoTick(Date.now());
      setCropFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'ha pogut pujar la foto");
    } finally {
      setBusy(false);
    }
  }

  function openPdf(url: string, title: string) {
    setPdfView({ url, title });
  }

  if (booting || entering) {
    return (
      <Entrance
        version={session?.version || APP_VERSION}
        label={
          entering
            ? "Entrant…"
            : session?.scrape?.running
              ? "Scrapejant Web Família…"
              : "Obrint sessió desada…"
        }
      />
    );
  }

  if (!dashboard) {
    const hasSaved = Boolean(session?.hasStoredCredentials);
    const showUnlock = hasSaved && !changeUser;
    const allowMock = session?.allowMock === true;
    return (
      <main className="gate">
        <div className="gate-inner">
          <Brand />
          <p className="lede">Web Família, més clara al mòbil.</p>
          {showUnlock ? (
            <form className="panel" onSubmit={onUnlock}>
              <p className="hint">Compte desat en aquest dispositiu</p>
              <label>
                {session?.vaultMode === "master" ? "Contrasenya mestra" : "Contrasenya"}
                <input
                  type="password"
                  autoComplete="current-password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  required
                  minLength={session?.vaultMode === "master" ? 8 : 1}
                  autoFocus
                />
              </label>
              <button type="submit" disabled={busy}>
                Entrar
              </button>
              <div className="gate-actions">
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    setChangeUser(true);
                    setUnlockPassword("");
                    setError(null);
                  }}
                >
                  Un altre usuari
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={onForget}>
                  Oblidar
                </button>
              </div>
            </form>
          ) : (
            <form className="panel" onSubmit={onLogin}>
              <label>
                Usuari (NIF/NIE)
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                />
              </label>
              <label>
                Contrasenya
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Recordar usuari
              </label>
              <button type="submit" disabled={busy}>
                Entrar
              </button>
              <div className="gate-actions">
                {hasSaved && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      setChangeUser(false);
                      setPassword("");
                      setError(null);
                    }}
                  >
                    Tornar
                  </button>
                )}
                {allowMock && (
                  <button type="button" className="secondary" disabled={busy} onClick={onMock}>
                    Provar exemple
                  </button>
                )}
              </div>
            </form>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="hint version-line">
            v{session?.version || APP_VERSION}
            {session?.scrape?.envConfigured
              ? session.scrape.running
                ? " · scrapejant…"
                : session.scrape.lastAt
                  ? ` · darrera captura ${new Date(session.scrape.lastAt).toLocaleString("ca-ES")}`
                  : " · scrape d'arrencada actiu"
              : " · configura WF_USER/WF_PASS al servidor"}
          </p>
        </div>
      </main>
    );
  }

  const student =
    dashboard.students.find((s) => s.id === studentId) ?? dashboard.student ?? null;

  const sid = student?.id;
  const attachmentsAll = dashboard.attachments ?? [];
  const baseNotices = forStudent(dashboard.notices, sid);
  const menus = forStudentMenus(dashboard.menus ?? [], sid, attachmentsAll, baseNotices);
  const dayIndex = Math.max(0, WEEK_DAYS.indexOf(scheduleDay as (typeof WEEK_DAYS)[number]));
  const scheduleDateIso = addDaysIso(weekMonday, dayIndex);
  const menuLunchDinner = menuSlotsForDay(menus, scheduleDay, sid);
  const baseSchedule = forStudent(dashboard.schedule ?? [], sid);
  const daySlots = [
    ...baseSchedule.filter((s) => {
      const kind = s.custom ? resolveEventKind(s) : null;
      if (kind === "puntual" || s.dateIso) return s.dateIso === scheduleDateIso;
      if (normalizeDay(s.day) !== scheduleDay) return false;
      if (kind === "setmanal" && (s.dateFrom || s.dateTo)) {
        if (s.dateFrom && scheduleDateIso < s.dateFrom) return false;
        if (s.dateTo && scheduleDateIso > s.dateTo) return false;
      }
      return true;
    }),
    ...menuLunchDinner,
  ]
    .slice()
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  const notices = forStudent(dashboard.notices, sid).sort((a, b) =>
    (a.dateIso || a.date || "").localeCompare(b.dateIso || b.date || ""),
  );
  const absences = forStudent(dashboard.absences, sid);
  const grades = forStudent(dashboard.grades, sid);
  const messages = forStudent(dashboard.messages, sid);
  const activities = forStudent(dashboard.activities, sid);
  const subjects = forStudent(dashboard.subjects ?? [], sid);

  function shiftHorariWeek(delta: number) {
    setWeekMonday((m) => addDaysIso(m, delta * 7));
  }

  function goHorariToday() {
    const t = todayIsoLocal();
    setWeekMonday(mondayOfWeek(t));
    setScheduleDay(todayWeekday());
  }

  async function onSaveCalendarDraft(draft: {
    id?: string;
    eventKind: "puntual" | "setmanal";
    subject: string;
    day: string;
    dateIso: string;
    dateFrom: string;
    dateTo: string;
    start: string;
    end: string;
    place: string;
    notes: string;
  }) {
    if (!sid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveCustomSlot({
        id: draft.id,
        eventKind: draft.eventKind,
        subject: draft.subject,
        day: draft.day,
        studentId: sid,
        studentName: student?.name,
        start: draft.start || undefined,
        end: draft.end || undefined,
        place: draft.place || undefined,
        notes: draft.notes || undefined,
        ...(draft.eventKind === "puntual"
          ? { dateIso: draft.dateIso }
          : { dateFrom: draft.dateFrom, dateTo: draft.dateTo }),
      });
      setDashboard(res.dashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'ha pogut desar");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSlot(id: string, label?: string) {
    const ok = window.confirm(
      label ? `Vols esborrar «${label}»?` : "Vols esborrar aquest bloc?",
    );
    if (!ok) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await removeCustomSlot(id);
      setDashboard(res.dashboard);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'ha pogut esborrar");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`app-shell ${entering ? "app-shell-enter" : ""}`}>
      {cropFile && (
        <PhotoCropper
          file={cropFile}
          busy={busy}
          onCancel={() => setCropFile(null)}
          onConfirm={(blob) => void onConfirmCrop(blob)}
        />
      )}
      {pdfView && (
        <PdfViewer
          url={pdfView.url}
          title={pdfView.title}
          onClose={() => setPdfView(null)}
        />
      )}
      <div className="sticky-chrome">
      <header className="topbar">
        <div className="topbar-main">
          <div className="avatar-wrap">
            <button
              type="button"
              className="avatar-btn"
              disabled={busy || !student}
              onClick={() => photoInputRef.current?.click()}
              title="Foto de carnet des de la galeria"
              aria-label="Pujar foto de carnet"
            >
              {student?.photoUrl || student?.hasPhoto ? (
                <img
                  src={`${student.photoUrl || `/api/students/${student.id}/photo`}?t=${photoTick || dashboard.capturedAt}`}
                  alt=""
                  className="avatar-img"
                />
              ) : (
                <span className="avatar-fallback">{(student?.name || "?").slice(0, 1)}</span>
              )}
            </button>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => void onPickPhoto(e.target.files?.[0] ?? null)}
          />
          <div className="topbar-text">
            <div className="topbar-title-row">
              <h1>WebFamilia</h1>
              <span className="version-badge quiet">v{session?.version || APP_VERSION}</span>
              <InstallAppButton />
              <button type="button" className="ghost topbar-exit" disabled={busy} onClick={onLogout}>
                Sortir
              </button>
            </div>
            <p className="student-line">
              {student ? student.name : "Sense alumne"}
              {student?.group || student?.course
                ? ` · ${student.group || student.course}`
                : ""}
            </p>
            {student?.tutorName ? (
              <p className="tutor-line">Tutora · {student.tutorName}</p>
            ) : null}
          </div>
        </div>
      </header>
      {dashboard.students.length > 1 && (
        <div className="students" role="tablist" aria-label="Alumnes">
          {dashboard.students.map((s) => {
            const photoSrc =
              s.photoUrl || s.hasPhoto
                ? `${s.photoUrl || `/api/students/${s.id}/photo`}?t=${photoTick || dashboard.capturedAt}`
                : null;
            return (
            <button
              key={s.id}
              type="button"
              className={s.id === student?.id ? "active" : ""}
              onClick={() => setStudentId(s.id)}
            >
              {photoSrc ? (
                <img src={photoSrc} alt="" className="chip-avatar" />
              ) : (
                <span className="chip-avatar-fallback">{s.name.slice(0, 1)}</span>
              )}
              {s.name.split(" ")[0]}
            </button>
            );
          })}
        </div>
      )}
      </div>
      <nav className="tabs" aria-label="Seccions">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <nav className="tabbar" aria-label="Seccions mòbil">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === "agenda" && (
        <Section title="Agenda" count={notices.length}>
          {notices.length === 0 && <Empty />}
          {notices.length > 0 && (
            <div className="table-scroll">
              <table className="data-table dense">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Avís</th>
                    <th scope="col">Docs</th>
                  </tr>
                </thead>
                <tbody>
                  {notices.map((n) => (
                    <tr key={`${n.studentId || ""}-${n.id}`}>
                      <td className="time">{n.dateIso || n.date || "—"}</td>
                      <td className="cell-main">
                        {n.title}
                        {n.unread ? <span className="pill warn"> Nou</span> : null}
                      </td>
                      <td>
                        {(n.attachments?.length ?? 0) > 0
                          ? n.attachments!.map((a) => (
                              <div key={a.id}>
                                <button
                                  type="button"
                                  className="linkish"
                                  onClick={() => openPdf(`/api/attachments/${a.id}`, a.filename)}
                                >
                                  {a.filename}
                                </button>
                              </div>
                            ))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      {tab === "assistencies" && (
        <Section title="Assistències" count={absences.length}>
          {absences.length === 0 && <Empty />}
          {absences.length > 0 && (
            <div className="table-scroll">
              <table className="data-table dense">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Tipus</th>
                    <th scope="col">Assignatura</th>
                    <th scope="col">Justificada</th>
                  </tr>
                </thead>
                <tbody>
                  {absences.map((a) => (
                    <tr key={a.id}>
                      <td className="time">{a.date}</td>
                      <td>
                        <span className={`pill ${a.kind === "retard" ? "warn" : "danger"}`}>
                          {a.kind}
                        </span>
                      </td>
                      <td className="cell-main">{a.subject || "—"}</td>
                      <td className="cell-soft">{a.justified ? "Sí" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      {tab === "activitats" && (
        <Section title="Activitats" count={activities.length}>
          {activities.length === 0 && <Empty />}
          {activities.length > 0 && (
            <div className="table-scroll">
              <table className="data-table dense">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Activitat</th>
                    <th scope="col">Lloc</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a) => (
                    <tr key={a.id}>
                      <td className="time">{a.date || "—"}</td>
                      <td className="cell-main">{a.title}</td>
                      <td className="cell-soft">{a.place || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      {tab === "comunicacions" && (
        <Section title="Comunicacions" count={messages.length}>
          {messages.length === 0 && <Empty />}
          {messages.length > 0 && (
            <div className="table-scroll">
              <table className="data-table dense">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">De</th>
                    <th scope="col">Assumpte</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id}>
                      <td className="time">{m.date || "—"}</td>
                      <td className="cell-soft">{m.from}</td>
                      <td className="cell-main">{m.subject}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      {tab === "qualificacions" && (
        <Section title="Qualificacions" count={grades.length}>
          {grades.length === 0 && <Empty />}
          {grades.length > 0 && (
            <div className="table-scroll">
              <table className="data-table dense">
                <thead>
                  <tr>
                    <th scope="col">Àrea</th>
                    <th scope="col">Avaluació</th>
                    <th scope="col">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {grades.map((g) => (
                    <tr key={g.id}>
                      <td className="cell-main">{g.subject}</td>
                      <td className="cell-soft">{g.evaluation || "—"}</td>
                      <td><span className="pill ok">{g.value}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      {tab === "assignatures" && (
        <Section title="Assignatures" count={subjects.length}>
          {subjects.length === 0 && <Empty />}
          {subjects.length > 0 && (
            <div className="table-scroll">
              <table className="data-table dense">
                <thead>
                  <tr>
                    <th scope="col">Àrea</th>
                    <th scope="col">Professor/a</th>
                    <th scope="col">Atenció</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-main">{s.subject}</td>
                      <td className="cell-soft">{s.teacher || "—"}</td>
                      <td className="cell-soft">{s.attention || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      {tab === "menus" && (
        <Section title="Menús" count={menus.length}>
          {menus.length === 0 && <Empty />}
          {menus.length > 0 && (
            <div className="table-stack">
              {menus.map((menu) => (
                <div className="day-block" key={menu.sourceFile + (menu.attachmentId || "") + (menu.studentId || "")}>
                  <h3>
                    Menú {menu.month}/{menu.year}
                    {menu.centerName ? ` · ${menu.centerName}` : ""}
                  </h3>
                  <p className="hint">
                    {menu.sourceFile}
                    {menu.attachmentId ? (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="linkish"
                          onClick={() =>
                            openPdf(`/api/attachments/${menu.attachmentId}`, menu.sourceFile)
                          }
                        >
                          PDF
                        </button>
                      </>
                    ) : null}
                  </p>
                  {menu.variants.map((variant) => (
                    <div key={variant.name} className="menu-variant">
                      <h4 className="menu-variant-title">
                        {/nits|complementari|sopar|cena/i.test(variant.name)
                          ? `${variant.name} · 20:00–20:30`
                          : `${variant.name} · 12:45–13:15`}
                      </h4>
                      {(variant.days ?? []).length === 0 ? (
                        <Empty message="Sense dies en aquesta proposta." />
                      ) : (
                        <div className="table-scroll">
                          <table className="data-table dense">
                            <thead>
                              <tr>
                                <th scope="col">Data</th>
                                <th scope="col">Dia</th>
                                <th scope="col">Plats</th>
                                <th scope="col">Amanida</th>
                                <th scope="col">Postre</th>
                                <th scope="col">Kcal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {variant.days.slice(0, 31).map((d) => (
                                <tr key={`${variant.name}-${d.date}`}>
                                  <td className="time">{d.date.slice(5)}</td>
                                  <td className="cell-soft">{(d.weekday || "").slice(0, 3)}</td>
                                  <td className="cell-main" title={d.courses.join(" · ")}>
                                    {d.courses.join(" · ") || "—"}
                                  </td>
                                  <td className="cell-soft" title={d.saladCode || undefined}>
                                    {saladLabel(d.saladCode, variant.salads) || "—"}
                                  </td>
                                  <td className="cell-soft">{d.dessert || "—"}</td>
                                  <td className="time">{d.nutrition?.kcal ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
      {tab === "horari" && (
        <Section title="Horari" count={daySlots.length}>
          <div className="horari-weekbar">
            <button
              type="button"
              className="ghost cal-nav"
              aria-label="Setmana anterior"
              onClick={() => shiftHorariWeek(-1)}
            >
              ‹
            </button>
            <div className="horari-weeklabel">
              <strong>{weekLabelCa(weekMonday)}</strong>
              <span>{scheduleDateIso}</span>
            </div>
            <button
              type="button"
              className="ghost cal-nav"
              aria-label="Setmana següent"
              onClick={() => shiftHorariWeek(1)}
            >
              ›
            </button>
            <button type="button" className="ghost cal-today" onClick={goHorariToday}>
              Avui
            </button>
          </div>
          <div className="students horari-days" role="tablist" aria-label="Dies">
            {WEEK_DAYS.map((d, i) => {
              const dateIso = addDaysIso(weekMonday, i);
              const dayNum = parseIso(dateIso)?.d;
              return (
                <button
                  key={d}
                  type="button"
                  className={scheduleDay === d ? "active" : ""}
                  onClick={() => setScheduleDay(d)}
                >
                  <span className="horari-dayname">{d.slice(0, 3)}</span>
                  <span className="horari-daynum">{dayNum}</span>
                </button>
              );
            })}
          </div>
          {daySlots.length === 0 && <Empty message="Cap classe aquest dia." />}
          {daySlots.length > 0 && (
            <div className="horari-list">
              {daySlots.map((h) => {
                const menuKind = "menuKind" in h ? (h as { menuKind?: string }).menuKind : undefined;
                const rowClass = h.custom
                  ? "horari-row slot-custom"
                  : menuKind === "lunch"
                    ? "horari-row slot-menu-lunch"
                    : menuKind === "dinner"
                      ? "horari-row slot-menu-dinner"
                      : "horari-row";
                return (
                  <div key={h.id} className={rowClass}>
                    <span className="horari-time">
                      {h.start || "—"}
                      {h.end ? `–${h.end}` : ""}
                    </span>
                    <span className="horari-subject" title={h.subject}>
                      {h.subject}
                    </span>
                    {h.custom ? (
                      <button
                        type="button"
                        className="ghost horari-del"
                        disabled={busy}
                        aria-label={`Esborrar ${h.subject}`}
                        title="Esborrar"
                        onClick={() => void onDeleteSlot(h.id, h.subject)}
                      >
                        Esborrar
                      </button>
                    ) : (
                      <span className="horari-del-spacer" aria-hidden="true" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="hint">
            Les activitats pròpies (puntuals o setmanals) s’afegeixen i s’editen des de{" "}
            <button type="button" className="linkish" onClick={() => setTab("calendari")}>
              Calendari
            </button>
            .
          </p>
        </Section>
      )}
      {tab === "calendari" && (
        <Section title="Calendari" count={activities.length}>
          <MonthCalendar
            activities={activities}
            schedule={forStudent(dashboard.schedule ?? [], sid)}
            studentId={sid}
            busy={busy}
            onSaveCustom={onSaveCalendarDraft}
            onDeleteCustom={onDeleteSlot}
          />
        </Section>
      )}
    </div>
  );
}

function forStudent<T extends { studentId?: string }>(items: T[], sid?: string | null) {
  if (!sid) return items;
  return items.filter((i) => i.studentId === sid);
}

function forStudentMenus(
  menus: MenuExtraction[],
  sid: string | null | undefined,
  attachments: { id: string; studentId?: string; kind?: string }[],
  notices: { studentId?: string; attachments?: { id: string }[] }[],
) {
  if (!sid) return menus;
  const own = menus.filter((m) => !m.studentId || m.studentId === sid);
  const ownAttIds = new Set(own.map((m) => m.attachmentId).filter(Boolean));
  const shared = menus.filter((menu) => {
    if (!menu.studentId || menu.studentId === sid) return false;
    if (menu.attachmentId && ownAttIds.has(menu.attachmentId)) return false;
    // Menú menjador del centre: visible per a tots els germans
    const att = attachments.find((a) => a.id === menu.attachmentId);
    if (att?.kind === "menu_menjador" || att?.kind === "menu_especial") return true;
    if (/men[uú]|menjador|comedor/i.test(menu.sourceFile || "")) return true;
    if (menu.attachmentId && notices.some((n) => n.attachments?.some((a) => a.id === menu.attachmentId))) {
      return true;
    }
    return false;
  });
  return [...own, ...shared];
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ message }: { message?: string }) {
  return (
    <div className="empty">
      <p>{message || "No hi ha dades."}</p>
    </div>
  );
}
