import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  adminScrape,
  fetchDashboard,
  fetchSession,
  forget,
  login,
  startMock,
  unlock,
  type Dashboard,
  type ScheduleSlot,
  type SessionStatus,
} from "./api";
import {
  clearRememberedLogin,
  loadRememberedLogin,
  saveRememberedLogin,
} from "./remember";

type Tab = "avisos" | "faltes" | "notes" | "missatges" | "activitats" | "horaris";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "avisos", label: "Avisos", icon: "◎" },
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
  const [showLive, setShowLive] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [protectWithMaster, setProtectWithMaster] = useState(false);
  const [masterPassword, setMasterPassword] = useState("");
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
          setPassword(remembered.password);
          setRemember(true);
          setShowLive(true);
        }
        const status = await fetchSession();
        if (cancelled) return;
        setSession(status);
        if (status.authenticated && status.dashboard) {
          setDashboard(status.dashboard);
          return;
        }
        if (status.hasStoredCredentials && status.vaultMode === "device") {
          if (!status.authenticated && remembered) {
            try {
              const res = await login({
                username: remembered.username,
                password: remembered.password,
                remember: true,
                idioma: "V",
              });
              if (cancelled) return;
              setSession(res.session);
              setDashboard(res.dashboard);
              return;
            } catch (err) {
              if (!cancelled) {
                setError(err instanceof Error ? err.message : "No s'ha pogut restaurar la sessió");
              }
            }
          } else {
            setError(status.error ?? null);
          }
        } else if (remembered && !status.authenticated) {
          try {
            const res = await login({
              username: remembered.username,
              password: remembered.password,
              remember: true,
              idioma: "V",
            });
            if (cancelled) return;
            setSession(res.session);
            setDashboard(res.dashboard);
            return;
          } catch (err) {
            if (!cancelled) {
              setError(err instanceof Error ? err.message : "No s'ha pogut restaurar la sessió");
            }
          }
        }
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
    if (dashboard?.student) setStudentId(dashboard.student.id);
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
        protectWithMaster: remember && protectWithMaster,
        masterPassword: remember && protectWithMaster ? masterPassword : undefined,
        idioma: "V",
      });
      if (remember) saveRememberedLogin({ username, password, remember: true });
      else clearRememberedLogin();
      setSession(res.session);
      setDashboard(res.dashboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de login");
    } finally {
      setBusy(false);
    }
  }

  async function doUnlock(master?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await unlock(master);
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
    await doUnlock(unlockPassword || undefined);
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
      setMasterPassword("");
      setUnlockPassword("");
      setShowLive(true);
      setStructureJson(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No s'han pogut oblidar");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setDashboard(await fetchDashboard());
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
    const needsMaster = Boolean(
      session?.hasStoredCredentials && session.vaultMode === "master",
    );
    const hasDeviceVault = Boolean(
      session?.hasStoredCredentials && session.vaultMode === "device",
    );
    return (
      <main className="gate">
        <div className="gate-inner">
          <Brand />
          <p className="lede">
            La mateixa Web Família oficial, pensada per al mòbil: menys fricció i millor
            lectura.
          </p>
          <div className="gate-actions">
            <button type="button" className="secondary" disabled={busy} onClick={onMock}>
              Provar amb dades d&apos;exemple
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => setShowLive((v) => !v)}
            >
              {session?.hasStoredCredentials ? "Canviar d'usuari" : "Entrar amb el meu usuari"}
            </button>
          </div>
          {needsMaster && (
            <form className="panel" onSubmit={onUnlock}>
              <p className="hint">
                Credencials desades per <strong>{session?.username}</strong>. Introdueix la
                contrasenya mestra.
              </p>
              <label>
                Contrasenya mestra
                <input
                  type="password"
                  autoComplete="current-password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </label>
              <div className="gate-actions">
                <button type="submit" disabled={busy}>Entrar</button>
                <button type="button" className="ghost" disabled={busy} onClick={onForget}>
                  Oblidar aquest dispositiu
                </button>
              </div>
            </form>
          )}
          {hasDeviceVault && !needsMaster && (
            <div className="panel">
              <p className="hint">
                Hi ha un compte desat ({session?.username}). Si l&apos;auto-entrada ha fallat,
                pots reintentar o esborrar-lo.
              </p>
              <div className="gate-actions">
                <button type="button" disabled={busy} onClick={() => doUnlock()}>
                  Tornar a entrar
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={onForget}>
                  Oblidar aquest dispositiu
                </button>
              </div>
            </div>
          )}
          {showLive && (
            <form className="panel" onSubmit={onLogin}>
              <div className="row two">
                <label>
                  Usuari (NIF/NIE)
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>
                <label>
                  Contrasenya Web Família
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </label>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Recordar en aquest dispositiu
              </label>
              {remember && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={protectWithMaster}
                    onChange={(e) => setProtectWithMaster(e.target.checked)}
                  />
                  Protegir amb contrasenya mestra (opcional)
                </label>
              )}
              {remember && protectWithMaster && (
                <label>
                  Contrasenya mestra (mín. 8)
                  <input
                    type="password"
                    value={masterPassword}
                    onChange={(e) => setMasterPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={8}
                  />
                </label>
              )}
              <p className="hint">
                Es desa al navegador i, si hi ha <code>DATABASE_URL</code>, també al servidor.
              </p>
              {session?.storage && !session.storage.persistent && (
                <p className="error" role="status">
                  Aquest servidor encara no té Postgres. El recordatori del navegador sí
                  funcionarà.
                </p>
              )}
              <button type="submit" disabled={busy}>
                Connectar amb Web Família
              </button>
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
              {student?.tutorName ? ` · Tutor/a: ${student.tutorName}` : ""}
            </p>
            <p className={`status-dot ${dashboard.source}`}>
              <i aria-hidden="true" />
              {dashboard.source === "mock" ? "Exemple" : "En viu"} ·{" "}
              {new Date(dashboard.capturedAt).toLocaleString("ca-ES")}
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
        </div>
      </header>
      {dashboard.students.length > 1 && (
        <div className="students" role="tablist" aria-label="Alumnes">
          {dashboard.students.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === student?.id ? "active" : ""}
              onClick={() => setStudentId(s.id)}
            >
              {s.name.split(" ")[0]}
            </button>
          ))}
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
        <Section title="Avisos" count={dashboard.notices.length}>
          {dashboard.notices.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
          {dashboard.notices.length > 0 && (
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
                  {dashboard.notices.map((n) => (
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
          {(dashboard.menus?.length ?? 0) > 0 && (
            <div className="table-stack" style={{ marginTop: "1.25rem" }}>
              {dashboard.menus!.map((menu) => (
                <div className="day-block" key={menu.sourceFile + menu.attachmentId}>
                  <h3>
                    Menú {menu.month}/{menu.year}
                    {menu.centerName ? ` · ${menu.centerName}` : ""}
                  </h3>
                  <p className="hint">{menu.sourceFile}</p>
                  {(menu.variants[0]?.days ?? []).slice(0, 10).length > 0 && (
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
                          {menu.variants[0].days.slice(0, 14).map((d) => (
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
        <Section title="Faltes i retards" count={dashboard.absences.length}>
          {dashboard.absences.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
          {dashboard.absences.length > 0 && (
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
                  {dashboard.absences.map((a) => (
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
          count={dashboard.grades.length + (dashboard.subjects?.length ?? 0)}
        >
          {dashboard.grades.length === 0 && !(dashboard.subjects?.length) && (
            <Empty diagnostics={dashboard.diagnostics} />
          )}
          <div className="table-stack">
            {dashboard.grades.length > 0 && (
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
                      {dashboard.grades.map((g) => (
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
            {(dashboard.subjects?.length ?? 0) > 0 && (
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
                      {(dashboard.subjects ?? []).map((s) => (
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
        <Section title="Missatges" count={dashboard.messages.length}>
          {dashboard.messages.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
          {dashboard.messages.length > 0 && (
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
                  {dashboard.messages.map((m) => (
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
        <Section title="Activitats" count={dashboard.activities.length}>
          {dashboard.activities.length === 0 && <Empty diagnostics={dashboard.diagnostics} />}
          {dashboard.activities.length > 0 && (
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
                  {dashboard.activities.map((a) => (
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
        <Section title="Horaris" count={dashboard.schedule?.length ?? 0}>
          {!(dashboard.schedule?.length) && <Empty diagnostics={dashboard.diagnostics} />}
          {(dashboard.schedule?.length ?? 0) > 0 && (
            <div className="table-stack">
              {groupScheduleByDay(dashboard.schedule ?? []).map(([day, slots]) => (
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
          <p className="hint">
            Rescanejar torna a demanar les pàgines a Web Família amb la sessió actual,
            aplica els parsers d&apos;ara mateix i refresca el dashboard. El JSON és
            diagnòstic (no “aprèn” sol una estructura nova).
          </p>
        )}
        {showAdmin && structureJson && <pre>{structureJson}</pre>}
        {showAdmin && !structureJson && (
          <p className="hint">Prem Admin per capturar l&apos;estructura HTML en viu.</p>
        )}
      </div>
    </div>
  );
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
