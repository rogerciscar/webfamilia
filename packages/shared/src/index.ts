export type Student = {
  id: string;
  name: string;
  course?: string;
  center?: string;
  nia?: string;
  group?: string;
  enrollmentYear?: string;
  tutorName?: string;
};

export type AttachmentKind =
  | "menu_menjador"
  | "menu_especial"
  | "aviso_doc"
  | "other";

export type Attachment = {
  id: string;
  filename: string;
  sourceUrl: string;
  sha256: string;
  bytes: number;
  kind: AttachmentKind;
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
  detailHref?: string;
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
};

export type MenuNutrition = {
  kcal?: number;
  hc?: number;
  p?: number;
  l?: number;
};

export type MenuDay = {
  date: string;
  dayOfMonth: number;
  weekday: string;
  courses: string[];
  saladCode?: string;
  dessert?: string;
  nutrition?: MenuNutrition;
};

export type MenuVariant = {
  name: string;
  salads?: Record<string, string>;
  notes?: string[];
  days: MenuDay[];
};

export type MenuExtraction = {
  sourceFile: string;
  centerName?: string;
  provider?: string;
  year: number;
  month: number;
  variants: MenuVariant[];
  attachmentId?: string;
  studentId?: string;
  studentName?: string;
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
  subjects: Subject[];
  schedule: ScheduleSlot[];
  attachments: Attachment[];
  menus: MenuExtraction[];
  source: "mock" | "live";
  capturedAt: string;
  diagnostics?: {
    pages: CaptureInfo[];
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
  allowMock?: boolean;
  scrapeReady?: boolean;
  wfConnected?: boolean;
  storage?: {
    backend: "postgres" | "file" | "none";
    persistent: boolean;
    hasVaultSecret: boolean;
  };
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
