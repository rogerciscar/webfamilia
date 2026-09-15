export type Student = {
  id: string;
  name: string;
  course?: string;
  center?: string;
};

export type Notice = {
  id: string;
  title: string;
  body: string;
  date?: string;
  author?: string;
  unread?: boolean;
};

export type Absence = {
  id: string;
  date: string;
  subject?: string;
  kind: "falta" | "retard" | "desconegut";
  justified?: boolean;
  comment?: string;
};

export type Grade = {
  id: string;
  subject: string;
  evaluation?: string;
  value: string;
  comment?: string;
};

export type Message = {
  id: string;
  subject: string;
  from: string;
  date?: string;
  preview?: string;
  unread?: boolean;
};

export type Activity = {
  id: string;
  title: string;
  date?: string;
  place?: string;
  description?: string;
};

export type Behavior = {
  id: string;
  date?: string;
  subject?: string;
  description: string;
  kind?: string;
};

export type Dashboard = {
  student: Student | null;
  students: Student[];
  notices: Notice[];
  absences: Absence[];
  grades: Grade[];
  messages: Message[];
  activities: Activity[];
  behaviors: Behavior[];
  source: "mock" | "live";
  capturedAt: string;
};

export type SessionStatus = {
  authenticated: boolean;
  mode: "mock" | "live";
  username?: string;
  hasStoredCredentials: boolean;
  vaultMode?: "device" | "master";
  lastLoginAt?: string;
  error?: string;
  dashboard?: Dashboard;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Error ${res.status}`);
  }
  return data as T;
}

export function fetchSession() {
  return request<SessionStatus>("/api/session");
}

export function startMock() {
  return request<{ dashboard: Dashboard; session: SessionStatus }>("/api/session/mock", {
    method: "POST",
    body: "{}",
  });
}

export function login(body: {
  username: string;
  password: string;
  remember?: boolean;
  protectWithMaster?: boolean;
  masterPassword?: string;
  idioma?: "V" | "C";
}) {
  return request<{ dashboard: Dashboard; session: SessionStatus }>("/api/session/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function unlock(masterPassword?: string) {
  return request<{ dashboard: Dashboard; session: SessionStatus }>("/api/session/unlock", {
    method: "POST",
    body: JSON.stringify({ masterPassword }),
  });
}

export function forget() {
  return request<{ session: SessionStatus }>("/api/session/forget", {
    method: "POST",
    body: "{}",
  });
}

export function fetchDashboard() {
  return request<Dashboard>("/api/dashboard");
}
