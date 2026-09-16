const KEY = "pont.remember.v1";

export type RememberedLogin = {
  username: string;
  password: string;
  remember: boolean;
};

export function loadRememberedLogin(): RememberedLogin | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as RememberedLogin;
    if (!data?.username || !data?.password) return null;
    return {
      username: String(data.username),
      password: String(data.password),
      remember: data.remember !== false,
    };
  } catch {
    return null;
  }
}

export function saveRememberedLogin(data: RememberedLogin) {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      username: data.username,
      password: data.password,
      remember: true,
    }),
  );
}

export function clearRememberedLogin() {
  localStorage.removeItem(KEY);
}
