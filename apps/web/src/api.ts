export type Student = {
  id: string;
  name: string;
  course?: string;
  center?: string;
  nia?: string;
  group?: string;
  enrollmentYear?: string;
  tutorName?: string;
  photoUrl?: string;
  hasPhoto?: boolean;
};

export type Attachment = {
  id: string;
  filename: string;
  sourceUrl: string;
  sha256: string;
  bytes: number;
  kind: string;
  noticeId?: string;
  studentId?: string;
};

export type Notice = {
  id: string;
  title: string;
  body: string;
  date?: string;
  dateIso?: string;
  author?: string;
  unread?: boolean;
  studentId?: string;
  studentName?: string;
  hasDetail?: boolean;
  attachments?: Attachment[];
};

export type Absence = {
  id: string;
  date: string;
  dateIso?: string;
  subject?: string;
  kind: "falta" | "retard" | "desconegut";
  justified?: boolean;
  comment?: string;
  studentId?: string;
  studentName?: string;
};

export type Grade = {
  id: string;
  subject: string;
  evaluation?: string;
  value: string;
  comment?: string;
  studentId?: string;
  studentName?: string;
};

export type Message = {
  id: string;
  subject: string;
  from: string;
  date?: string;
  preview?: string;
  unread?: boolean;
  studentId?: string;
  studentName?: string;
};

export type Activity = {
  id: string;
  title: string;
  date?: string;
  dateIso?: string;
  place?: string;
  description?: string;
  studentId?: string;
  studentName?: string;
};

export type Behavior = {
  id: string;
  date?: string;
  subject?: string;
  description: string;
  kind?: string;
  studentId?: string;
  studentName?: string;
};

export type Subject = {
  id: string;
  subject: string;
  teacher?: string;
  attention?: string;
  studentId?: string;
  studentName?: string;
};

export type ScheduleSlot = {
  id: string;
  day: string;
  start?: string;
  end?: string;
  subject: string;
  studentId?: string;
  studentName?: string;
  custom?: boolean;
};

export type MenuDay = {
  date: string;
  dayOfMonth: number;
  weekday: string;
  courses: string[];
  saladCode?: string;
  dessert?: string;
  nutrition?: { kcal?: number; hc?: number; p?: number; l?: number };
};

export type MenuExtraction = {
  sourceFile: string;
  centerName?: string;
  provider?: string;
  year: number;
  month: number;
  variants: { name: string; days: MenuDay[]; salads?: Record<string, string>; notes?: string[] }[];
  attachmentId?: string;
  studentId?: string;
  studentName?: string;
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
  subjects: Subject[];
  schedule: ScheduleSlot[];
  attachments?: Attachment[];
  menus?: MenuExtraction[];
  source: "mock" | "live";
  capturedAt: string;
  diagnostics?: {
    pages: { key: string; bytes: number; title?: string; links?: number }[];
    navLinks: { href: string; text: string }[];
    scrapeErrors?: string[];
    scrapedStudents?: {
      id: string;
      name: string;
      notices: number;
      schedule: number;
      subjects: number;
      absences?: number;
      menus?: number;
      tutorName?: string;
      group?: string;
    }[];
    note?: string;
  };
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
  allowMock?: boolean;
  scrapeReady?: boolean;
  wfConnected?: boolean;
  version?: string;
  scrape?: {
    envConfigured: boolean;
    running: boolean;
    lastAt?: string;
    lastError?: string;
    attachments?: number;
    menus?: number;
    notices?: number;
  };
  storage?: {
    backend: "postgres" | "file" | "none";
    persistent: boolean;
    hasVaultSecret: boolean;
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Error ${res.status}: resposta no JSON del servidor`);
  }
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

export function unlock(opts?: { masterPassword?: string; password?: string }) {
  return request<{ dashboard: Dashboard; session: SessionStatus }>("/api/session/unlock", {
    method: "POST",
    body: JSON.stringify(opts ?? {}),
  });
}

export function forget() {
  return request<{ session: SessionStatus }>("/api/session/forget", {
    method: "POST",
    body: "{}",
  });
}

export function logout() {
  return request<{ session: SessionStatus }>("/api/session/logout", {
    method: "POST",
    body: "{}",
  });
}

export function fetchDashboard(refresh = false) {
  return request<Dashboard>(`/api/dashboard${refresh ? "?refresh=1" : ""}`);
}

export function saveCustomSlot(body: {
  id?: string;
  day: string;
  start?: string;
  end?: string;
  subject: string;
  studentId?: string;
  studentName?: string;
}) {
  return request<{ slot: ScheduleSlot; dashboard: Dashboard }>("/api/schedule/custom", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function removeCustomSlot(id: string) {
  return request<{ dashboard: Dashboard }>(`/api/schedule/custom/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function adminScrape() {
  return request<{
    dashboard: Dashboard;
    structure: unknown;
    captures: Record<string, unknown>;
    session: SessionStatus;
  }>("/api/admin/scrape", { method: "POST", body: "{}" });
}

export function fetchStructure() {
  return request<{ structure: unknown; captures: Record<string, unknown> }>(
    "/api/admin/structure",
  );
}

export async function uploadStudentPhoto(studentId: string, file: Blob, filename = "carnet.jpg") {
  const body = new FormData();
  const typed =
    typeof File !== "undefined"
      ? new File([file], filename, { type: file.type || "image/jpeg" })
      : file;
  body.append("file", typed, filename);
  const res = await fetch(`/api/students/${encodeURIComponent(studentId)}/photo`, {
    method: "POST",
    credentials: "include",
    body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `Error ${res.status}`);
  }
  return data as {
    ok: true;
    dashboard: Dashboard;
    photo?: { studentId: string; bytes: number; mime: string; backend: string };
  };
}

export async function removeStudentPhoto(studentId: string) {
  return request<{ dashboard: Dashboard }>(
    `/api/students/${encodeURIComponent(studentId)}/photo`,
    { method: "DELETE", body: "{}" },
  );
}
