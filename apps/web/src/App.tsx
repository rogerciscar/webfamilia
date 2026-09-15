import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  fetchDashboard,
  fetchSession,
  forget,
  login,
  startMock,
  unlock,
  type Dashboard,
  type SessionStatus,
} from "./api";

type Tab = "avisos" | "faltes" | "notes" | "missatges" | "activitats" | "conducta";

const TABS: { id: Tab; label: string }[] = [
  { id: "avisos", label: "Avisos" },
  { id: "faltes", label: "Faltes" },
  { id: "notes", label: "Notes" },
  { id: "missatges", label: "Missatges" },
  { id: "activitats", label: "Activitats" },
  { id: "conducta", label: "Conducta" },
];

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchSession();
        if (cancelled) return;
        setSession(status);
        if (status.authenticated && status.dashboard) {
          setDashboard(status.dashboard);
        } else if (status.hasStoredCredentials && status.vaultMode === "device") {
          setError(status.error ?? null);
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
      const res = await forget();
      setSession(res.session);
      setDashboard(null);
      setPassword("");
      setMasterPassword("");
      setUnlockPassword("");
      setShowLive(true);
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

  if (booting) {
    return (
      <main className="gate">
        <div className="gate-inner">
          <h1 className="brand">
            Pont<em>.</em>
          </h1>
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
          <h1 className="brand">
            Pont<em>.</em>
          </h1>
          <p className="lede">
            Una capa clara sobre Web Família: el mateix compte oficial, menys fricció,
            millor lectura al mòbil i a l'escriptori.
          </p>
          <div className="gate-actions">
            <button type="button" className="secondary" disabled={busy} onClick={onMock}>
              Provar amb dades d'exemple
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
                contrasenya mestra per entrar sense tornar a posar el NIF.
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
                <button type="submit" disabled={busy}>
                  Entrar
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={onForget}>
                  Oblidar aquest dispositiu
                </button>
              </div>
            </form>
          )}

          {hasDeviceVault && !needsMaster && (
            <div className="panel">
              <p className="hint">
                Hi ha un compte desat ({session?.username}). Si l'auto-entrada ha fallat,
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
                Recordar en aquest dispositiu (no cal tornar a escriure NIF/contrasenya)
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
                Per defecte les credencials es desen xifrades amb una clau local del
                dispositiu. Només viuen al teu ordinador. Ús personal. No afiliat a la GVA.
              </p>
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
        <div>
          <h1>Pont.</h1>
          <p>
            {student ? student.name : "Sense alumne"}
            {student?.course ? ` · ${student.course}` : ""}
          </p>
          <p className={`status-dot ${dashboard.source}`}>
            <i aria-hidden="true" />
            {dashboard.source === "mock" ? "Mode exemple" : "Sessió en viu"} ·{" "}
            {new Date(dashboard.capturedAt).toLocaleString("ca-ES")}
          </p>
        </div>
        <div className="gate-actions">
          <button type="button" className="ghost" disabled={busy} onClick={refresh}>
            Actualitzar
          </button>
          {session?.hasStoredCredentials && (
            <button type="button" className="ghost" disabled={busy} onClick={onForget}>
              Oblidar login
            </button>
          )}
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
              {s.name}
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === "avisos" && (
        <Section title="Avisos" count={dashboard.notices.length}>
          {dashboard.notices.length === 0 && <Empty />}
          <div className="list">
            {dashboard.notices.map((n, i) => (
              <article className="item" key={n.id} style={{ animationDelay: `${i * 40}ms` }}>
                <strong>{n.title}</strong>
                <div className="meta">
                  {n.date && <span>{n.date}</span>}
                  {n.author && <span>{n.author}</span>}
                  {n.unread && <span className="pill warn">Nou</span>}
                </div>
                <p>{n.body}</p>
              </article>
            ))}
          </div>
        </Section>
      )}
      {tab === "faltes" && (
        <Section title="Faltes i retards" count={dashboard.absences.length}>
          {dashboard.absences.length === 0 && <Empty />}
          <div className="list">
            {dashboard.absences.map((a, i) => (
              <article className="item" key={a.id} style={{ animationDelay: `${i * 40}ms` }}>
                <strong>{a.subject || a.kind}</strong>
                <div className="meta">
                  <span>{a.date}</span>
                  <span className={`pill ${a.kind === "retard" ? "warn" : "danger"}`}>
                    {a.kind}
                  </span>
                  {a.justified && <span className="pill ok">justificada</span>}
                </div>
                {a.comment && <p>{a.comment}</p>}
              </article>
            ))}
          </div>
        </Section>
      )}
      {tab === "notes" && (
        <Section title="Notes" count={dashboard.grades.length}>
          {dashboard.grades.length === 0 && <Empty />}
          <div className="list">
            {dashboard.grades.map((g, i) => (
              <article className="item" key={g.id} style={{ animationDelay: `${i * 40}ms` }}>
                <strong>{g.subject}</strong>
                <div className="meta">
                  {g.evaluation && <span>{g.evaluation}</span>}
                  <span className="pill ok">{g.value}</span>
                </div>
                {g.comment && <p>{g.comment}</p>}
              </article>
            ))}
          </div>
        </Section>
      )}
      {tab === "missatges" && (
        <Section title="Missatges" count={dashboard.messages.length}>
          {dashboard.messages.length === 0 && <Empty />}
          <div className="list">
            {dashboard.messages.map((m, i) => (
              <article className="item" key={m.id} style={{ animationDelay: `${i * 40}ms` }}>
                <strong>{m.subject}</strong>
                <div className="meta">
                  <span>{m.from}</span>
                  {m.date && <span>{m.date}</span>}
                  {m.unread && <span className="pill warn">Nou</span>}
                </div>
                {m.preview && <p>{m.preview}</p>}
              </article>
            ))}
          </div>
        </Section>
      )}
      {tab === "activitats" && (
        <Section title="Activitats" count={dashboard.activities.length}>
          {dashboard.activities.length === 0 && <Empty />}
          <div className="list">
            {dashboard.activities.map((a, i) => (
              <article className="item" key={a.id} style={{ animationDelay: `${i * 40}ms` }}>
                <strong>{a.title}</strong>
                <div className="meta">
                  {a.date && <span>{a.date}</span>}
                  {a.place && <span>{a.place}</span>}
                </div>
                {a.description && <p>{a.description}</p>}
              </article>
            ))}
          </div>
        </Section>
      )}
      {tab === "conducta" && (
        <Section title="Conducta" count={dashboard.behaviors.length}>
          {dashboard.behaviors.length === 0 && <Empty />}
          <div className="list">
            {dashboard.behaviors.map((b, i) => (
              <article className="item" key={b.id} style={{ animationDelay: `${i * 40}ms` }}>
                <strong>{b.description}</strong>
                <div className="meta">
                  {b.date && <span>{b.date}</span>}
                  {b.subject && <span>{b.subject}</span>}
                  {b.kind && <span className="pill">{b.kind}</span>}
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}
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
        <span>{count} ítems</span>
      </div>
      {children}
    </section>
  );
}

function Empty() {
  return (
    <p className="empty">
      Encara no hi ha dades parsejades aquí. En mode en viu, el pont captura l'HTML
      oficial i n'extreu taules; si el centre usa una plantilla rara, es pot afinar el parser.
    </p>
  );
}
