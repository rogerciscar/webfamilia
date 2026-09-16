const KEY = "pont.remember.v1";

export type RememberedLogin = {
  username: string;
  /** Optional; prefer empty — password should be typed each browser unless user opts in */
  password?: string;
  remember: boolean;
};

export function loadRememberedLogin(): RememberedLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as RememberedLogin;
    if (!data?.username) return null;
    return {
      username: String(data.username),
      password: data.password ? String(data.password) : undefined,
      remember: data.remember !== false,
    };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(data: {
  username: string;
  password?: string;
  keepPassword?: boolean;
}) {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      username: data.username,
      password: data.keepPassword ? data.password || "" : "",
      remember: true,
    }),
  );
}

export function clearRememberedLogin() {
  localStorage.removeItem(KEY);
}
