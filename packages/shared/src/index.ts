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

export type CaptureInfo = {
  key: string;
  bytes: number;
  title?: string;
  links?: number;
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
  diagnostics?: {
    pages: CaptureInfo[];
    navLinks: { href: string; text: string }[];
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
};

export type LoginRequest = {
  username: string;
  password: string;
  remember?: boolean;
  protectWithMaster?: boolean;
  masterPassword?: string;
  idioma?: "V" | "C";
};

export type UnlockRequest = {
  masterPassword?: string;
};
