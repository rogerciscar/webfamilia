import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  adminScrape,
  fetchDashboard,
  fetchSession,
  forget,
  login,
  logout,
  startMock,
  unlock,
  type Dashboard,
  type MenuExtraction,
  type ScheduleSlot,
  type SessionStatus,
} from "./api";
import {
  clearRememberedLogin,
  loadRememberedLogin,
  saveRememberedLogin,
} from "./remember";

type Tab = "avisos" | "menus" | "faltes" | "notes" | "missatges" | "activitats" | "horaris";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "avisos", label: "Avisos", icon: "◎" },
  { id: "menus", label: "Menús", icon: "◉" },
  { id: "faltes", label: "Faltes", icon: "◷" },
  { id: "notes", label: "Notes", icon: "✎" },
  { id: "missatges", label: "Msgs", icon: "✉" },
  { id: "activitats", label: "Acts", icon: "⚑" },
  { id: "horaris", label: "Horari", icon: "▦" },
];

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
  const [tab, setTab] = useState<Tab>("avisos");
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
    const savedName = session?.username || username;
    return (
      <main className="gate">
        <div className="gate-inner">
          <Brand />
          <p className="lede">Web Família, més clara al mòbil.</p>
          {showUnlock ? (
            <form className="panel" onSubmit={onUnlock}>
              <p className="hint">
                Compte <strong>{savedName}</strong>
              </p>
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
            <span className="icon" aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === "avisos" && (
        <Section title="Avisos" count={notices.length}>
          {notices.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
          {notices.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Títol</th>
                    <th scope="col">Alumne</th>
                    <th scope="col">PDF</th>
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
                      <td className="cell-soft">{n.studentName || "—"}</td>
                      <td>
                        {(n.attachments?.length ?? 0) > 0 ? (
                          n.attachments!.map((a) => (
                            <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">
                              {a.filename}
                            </a>
                          ))
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
      {tab === "menus" && (
        <Section title="Menús menjador" count={menus.length}>
          {menus.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
          {menus.length > 0 && (
            <div className="table-stack">
              {menus.map((menu) => (
                <div className="day-block" key={menu.sourceFile + (menu.attachmentId || "") + (menu.studentId || "")}>
                  <h3>
                    Menú {menu.month}/{menu.year}
                    {menu.centerName ? ` · ${menu.centerName}` : ""}
                    {menu.studentName ? ` · ${menu.studentName.split(" ")[0]}` : ""}
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
      {tab === "faltes" && (
        <Section title="Faltes i retards" count={absences.length}>
          {absences.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
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
      {tab === "notes" && (
        <Section
          title="Notes i assignatures"
          count={grades.length + (subjects.length)}
        >
          {grades.length === 0 && subjects.length === 0 && (
            <Empty diagnostics={dashboard.diagnostics} />
          )}
          <div className="table-stack">
            {grades.length > 0 && (
              <div className="day-block">
                <h3>Qualificacions</h3>
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
              </div>
            )}
            {(subjects.length) > 0 && (
              <div className="day-block">
                <h3>Assignatures</h3>
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
                      {(subjects).map((s) => (
                        <tr key={s.id}>
                          <td className="cell-main">{s.subject}</td>
                          <td className="cell-soft">{s.teacher || "—"}</td>
                          <td className="cell-soft">{s.attention || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Section>
      )}
      {tab === "missatges" && (
        <Section title="Missatges" count={messages.length}>
          {messages.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
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
      {tab === "activitats" && (
        <Section title="Activitats" count={activities.length}>
          {activities.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
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
      {tab === "horaris" && (
        <Section title="Horaris" count={schedule.length}>
          {!(schedule.length) && <Empty diagnostics={dashboard.diagnostics} />}
          {(schedule.length) > 0 && (
            <div className="table-stack">
              {groupScheduleByDay(schedule).map(([day, slots]) => (
                <div className="day-block" key={day}>
                  <h3>{day}</h3>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">Hora</th>
                          <th scope="col">Àrea</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slots.map((h) => (
                          <tr key={h.id}>
                            <th className="time" scope="row">
                              <strong>{h.start || "—"}</strong>
                              {h.end ? <span> – {h.end}</span> : null}
                            </th>
                            <td className="cell-main">{h.subject}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
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
          {showAdmin ? "Amagar admin" : "Admin · Rescanejar estructura"}
        </button>
        {session?.hasStoredCredentials && (
          <button type="button" className="ghost" disabled={busy} onClick={onForget}>
            Oblidar login
          </button>
        )}
        {showAdmin && (
          <p className="hint">Torna a demanar les dades a Web Família amb la sessió actual.</p>
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
    if (menu.attachmentId && notices.some((n) => n.attachments?.some((a) => a.id === menu.attachmentId))) {
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

function groupScheduleByDay(slots: ScheduleSlot[]) {
  const order: string[] = [];
  const map = new Map<string, ScheduleSlot[]>();
  for (const slot of slots) {
    const day = slot.day || "Horari";
    if (!map.has(day)) {
      map.set(day, []);
      order.push(day);
    }
    map.get(day)!.push(slot);
  }
  return order.map((day) => [day, map.get(day)!] as const);
}

function Empty({ diagnostics }: { diagnostics?: Dashboard["diagnostics"] }) {
  return (
    <div className="empty">
      <p>Encara no hi ha dades parsejades aquí.</p>
      {diagnostics?.note && <p>{diagnostics.note}</p>}
      {diagnostics?.pages?.length ? (
        <p className="hint">
          Pàgines:{" "}
          {diagnostics.pages
            .slice(0, 8)
            .map((p) => p.key)
            .join(" · ")}
        </p>
      ) : null}
      {diagnostics?.scrapeErrors?.length ? (
        <p className="hint">Errors: {diagnostics.scrapeErrors.slice(0, 3).join(" · ")}</p>
      ) : null}
      <p className="hint">Usa el botó Admin · Rescanejar per tornar a capturar.</p>
    </div>
  );
}
