import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  adminScrape,
  fetchDashboard,
  fetchSession,
  forget,
  login,
  logout,
  removeCustomSlot,
  saveCustomSlot,
  startMock,
  unlock,
  type Dashboard,
  type MenuExtraction,
  type SessionStatus,
} from "./api";
import {
  clearRememberedLogin,
  loadRememberedLogin,
  saveRememberedLogin,
} from "./remember";

type Tab =
  | "agenda"
  | "assistencies"
  | "activitats"
  | "comunicacions"
  | "qualificacions"
  | "assignatures"
  | "menus"
  | "horari";

const TABS: { id: Tab; label: string }[] = [
  { id: "agenda", label: "Agenda" },
  { id: "assistencies", label: "Assist." },
  { id: "activitats", label: "Activ." },
  { id: "comunicacions", label: "Comun." },
  { id: "qualificacions", label: "Notes" },
  { id: "assignatures", label: "Assign." },
  { id: "menus", label: "Menús" },
  { id: "horari", label: "Horari" },
];

const WEEK_DAYS = ["Dilluns", "Dimarts", "Dimecres", "Dijous", "Divendres"] as const;

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

export default function App() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>("agenda");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [changeUser, setChangeUser] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [structureJson, setStructureJson] = useState<string | null>(null);
  const [scheduleDay, setScheduleDay] = useState<string>("Dilluns");
  const [slotForm, setSlotForm] = useState({ subject: "", start: "18:00", end: "19:00" });

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
          setDashboard(status.dashboard);
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
      setSession(res.session);
      setDashboard(res.dashboard);
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
      setSession(res.session);
      setDashboard(res.dashboard);
      setChangeUser(false);
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
      setSession(res.session);
      setDashboard(res.dashboard);
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
      setStructureJson(null);
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
      setStructureJson(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en tancar sessió");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setDashboard(await fetchDashboard(true));
      setSession(await fetchSession());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en refrescar");
    } finally {
      setBusy(false);
    }
  }

  async function onAdminScrape() {
    setBusy(true);
    setError(null);
    try {
      const res = await adminScrape();
      setDashboard(res.dashboard);
      setSession(res.session);
      setStructureJson(JSON.stringify({ structure: res.structure, captures: res.captures }, null, 2));
      setShowAdmin(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de scrape admin");
    } finally {
      setBusy(false);
    }
  }

  if (booting) {
    return (
      <main className="gate">
        <div className="gate-inner">
          <Brand />
          <p className="lede">Obrint sessió desada…</p>
        </div>
      </main>
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
        </div>
      </main>
    );
  }

  const student =
    dashboard.students.find((s) => s.id === studentId) ?? dashboard.student ?? null;

  const sid = student?.id;
  const notices = forStudent(dashboard.notices, sid);
  const absences = forStudent(dashboard.absences, sid);
  const grades = forStudent(dashboard.grades, sid);
  const messages = forStudent(dashboard.messages, sid);
  const activities = forStudent(dashboard.activities, sid);
  const subjects = forStudent(dashboard.subjects ?? [], sid);
  const schedule = forStudent(dashboard.schedule ?? [], sid);
  const attachments = forStudent(dashboard.attachments ?? [], sid);
  const menus = forStudentMenus(dashboard.menus ?? [], sid, attachments, notices);
  const scrapeInfo = dashboard.diagnostics?.scrapedStudents?.find((s) => s.id === sid);
  const daySlots = schedule
    .filter((s) => normalizeDay(s.day) === scheduleDay)
    .slice()
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""));

  async function onAddSlot() {
    if (!sid || !slotForm.subject.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await saveCustomSlot({
        day: scheduleDay,
        start: slotForm.start,
        end: slotForm.end,
        subject: slotForm.subject.trim(),
        studentId: sid,
        studentName: student?.name,
      });
      setDashboard(res.dashboard);
      setSlotForm((f) => ({ ...f, subject: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'ha pogut afegir");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSlot(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await removeCustomSlot(id);
      setDashboard(res.dashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'ha pogut esborrar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <img src="/webfamilia-logo.png" alt="" width={44} height={44} />
          <div>
            <h1>WebFamilia</h1>
            <p>
              {student ? student.name : "Sense alumne"}
              {student?.group || student?.course
                ? ` · ${student.group || student.course}`
                : ""}
              {student?.center ? ` · ${student.center}` : ""}
            </p>
            <p className="hint" style={{ margin: 0 }}>
              {student?.tutorName ? `Tutor/a: ${student.tutorName}` : "Tutor/a: —"}
              {student?.nia ? ` · NIA ${student.nia}` : ""}
            </p>
            <p className={`status-dot ${dashboard.source}`}>
              <i aria-hidden="true" />
              {dashboard.source === "mock" ? "Exemple" : "En viu"} ·{" "}
              {new Date(dashboard.capturedAt).toLocaleString("ca-ES")}
              {scrapeInfo
                ? ` · ${scrapeInfo.notices} avisos · ${scrapeInfo.schedule} hores · ${scrapeInfo.absences ?? 0} faltes`
                : ""}
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost" disabled={busy} onClick={refresh}>
            Act.
          </button>
          <button
            type="button"
            className="ghost"
            disabled={busy || dashboard.source !== "live"}
            onClick={onAdminScrape}
            title="Rescanejar estructura"
          >
            Admin
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={onLogout}>
            Sortir
          </button>
        </div>
      </header>
      {dashboard.students.length > 1 && (
        <div className="students" role="tablist" aria-label="Alumnes">
          {dashboard.students.map((s) => {
            const info = dashboard.diagnostics?.scrapedStudents?.find((x) => x.id === s.id);
            return (
            <button
              key={s.id}
              type="button"
              className={s.id === student?.id ? "active" : ""}
              onClick={() => setStudentId(s.id)}
            >
              {s.name.split(" ")[0]}
              {info ? ` · ${info.notices}` : ""}
            </button>
            );
          })}
        </div>
      )}
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
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Avís</th>
                    <th scope="col">Documents</th>
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
                                <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
                                  {a.filename}
                                </a>
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
              <table className="data-table">
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
              <table className="data-table">
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
              <table className="data-table">
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
              <table className="data-table">
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
              <table className="data-table">
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
                        <a href={`/api/attachments/${menu.attachmentId}`} target="_blank" rel="noreferrer">
                          PDF
                        </a>
                      </>
                    ) : null}
                  </p>
                  {(menu.variants[0]?.days ?? []).length > 0 && (
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">Data</th>
                            <th scope="col">Dia</th>
                            <th scope="col">Plats</th>
                            <th scope="col">A</th>
                            <th scope="col">Postre</th>
                            <th scope="col">Kcal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {menu.variants[0].days.slice(0, 31).map((d) => (
                            <tr key={d.date}>
                              <td className="time">{d.date}</td>
                              <td className="cell-soft">{d.weekday}</td>
                              <td className="cell-main">{d.courses.join(" · ") || "—"}</td>
                              <td>{d.saladCode || "—"}</td>
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
          )}
        </Section>
      )}
      {tab === "horari" && (
        <Section title="Horari" count={daySlots.length}>
          <div className="students" role="tablist" aria-label="Dies">
            {WEEK_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                className={scheduleDay === d ? "active" : ""}
                onClick={() => setScheduleDay(d)}
              >
                {d.slice(0, 3)}
              </button>
            ))}
          </div>
          {daySlots.length === 0 && <Empty message="Cap classe aquest dia." />}
          {daySlots.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Hora</th>
                    <th scope="col">Activitat</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {daySlots.map((h) => (
                    <tr key={h.id}>
                      <th className="time" scope="row">
                        <strong>{h.start || "—"}</strong>
                        {h.end ? <span> – {h.end}</span> : null}
                      </th>
                      <td className="cell-main">
                        {h.subject}
                        {h.custom ? <span className="pill ok"> Propi</span> : null}
                      </td>
                      <td>
                        {h.custom ? (
                          <button
                            type="button"
                            className="ghost"
                            disabled={busy}
                            onClick={() => void onDeleteSlot(h.id)}
                          >
                            Esborrar
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <form
            className="panel"
            style={{ marginTop: "1rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              void onAddSlot();
            }}
          >
            <p className="hint">Afegeix un bloc propi ({scheduleDay})</p>
            <label>
              Nom
              <input
                value={slotForm.subject}
                onChange={(e) => setSlotForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="Piscina"
                required
              />
            </label>
            <div className="row two">
              <label>
                Inici
                <input
                  type="time"
                  value={slotForm.start}
                  onChange={(e) => setSlotForm((f) => ({ ...f, start: e.target.value }))}
                  required
                />
              </label>
              <label>
                Fi
                <input
                  type="time"
                  value={slotForm.end}
                  onChange={(e) => setSlotForm((f) => ({ ...f, end: e.target.value }))}
                  required
                />
              </label>
            </div>
            <button type="submit" disabled={busy || !sid}>
              Afegir
            </button>
          </form>
        </Section>
      )}
      <div className="admin-panel">
        <button
          type="button"
          className="ghost"
          disabled={busy || dashboard.source !== "live"}
          onClick={() => {
            setShowAdmin((v) => !v);
            if (!structureJson && dashboard.source === "live") void onAdminScrape();
          }}
        >
          {showAdmin ? "Amagar admin" : "Admin · Rescanejar"}
        </button>
        {session?.hasStoredCredentials && (
          <button type="button" className="ghost" disabled={busy} onClick={onForget}>
            Oblidar login
          </button>
        )}
        {showAdmin && (dashboard.diagnostics?.scrapedStudents?.length ?? 0) > 0 && (
          <p className="hint">
            {dashboard.diagnostics!.scrapedStudents!
              .map((s) => `${s.name.split(" ")[0]}: ${s.notices} avisos, ${s.schedule} hores`)
              .join(" · ")}
          </p>
        )}
        {showAdmin && structureJson && <pre>{structureJson}</pre>}
      </div>
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
  attachments: { id: string; studentId?: string }[],
  notices: { studentId?: string; attachments?: { id: string }[] }[],
) {
  if (!sid) return menus;
  return menus.filter((menu) => {
    if (menu.studentId) return menu.studentId === sid;
    if (menu.attachmentId && attachments.some((a) => a.id === menu.attachmentId)) return true;
    if (
      menu.attachmentId &&
      notices.some((n) => n.attachments?.some((a) => a.id === menu.attachmentId))
    ) {
      return true;
    }
    return false;
  });
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

function normalizeDay(day: string) {
  const d = day.trim().toLowerCase();
  if (d.startsWith("dil")) return "Dilluns";
  if (d.startsWith("dima") || d.startsWith("mart")) return "Dimarts";
  if (d.startsWith("dime") || d.startsWith("mier") || d.startsWith("mié")) return "Dimecres";
  if (d.startsWith("dij") || d.startsWith("jue")) return "Dijous";
  if (d.startsWith("div") || d.startsWith("vie")) return "Divendres";
  return day;
}
