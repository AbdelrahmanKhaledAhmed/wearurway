const TOKEN_KEY = "wearurway_admin_token";

export function getAdminToken(): string | null {
  try {
    return (
      sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY)
    );
  } catch {
    return null;
  }
}

export function setAdminToken(token: string, remember: boolean): void {
  try {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function clearAdminToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}
