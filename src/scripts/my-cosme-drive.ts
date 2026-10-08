/** マイコスメのGoogleドライブ同期（5-4の案B）。
 * Google Identity Services のトークン（ブラウザの中だけで受け取る）で、利用者本人のGoogleドライブの「アプリ専用フォルダ」（drive.appdata）に
 * my-cosme.json を1つ置く。求める権限は drive.appdata だけで、メール・氏名（openid・email・profile）は求めないので、OsoroCosmeは利用者が誰かも知らない。
 * アプリ専用フォルダは、利用者のドライブの一覧には出ず、このサイトからしか読み書きできない（ほかのファイルは見えない）。
 * トークンは1時間で切れ、更新用の鍵はブラウザに持たないので、同期は利用者がボタンを押したときに行う。 */
import { load, save, merge, same, sanitize, type MyCosmeData } from "./my-cosme-store";

const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE_NAME = "my-cosme.json";
/** この端末で一度つないだことがあるか（次からは同意の画面を省いて、選んだアカウントでそのまま同期する）。中身は "1" だけ */
const CONNECTED_KEY = "osorocosme.mycosme.drive";

interface TokenResponse { access_token?: string; expires_in?: number; error?: string }
interface TokenClient { requestAccessToken(o?: { prompt?: string }): void }
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
    };
  }
}

let token = "";
let tokenUntil = 0;
let gisLoading: Promise<void> | undefined;

function loadGis(): Promise<void> {
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = undefined;
      reject(new Error("Googleのログイン部品を読み込めませんでした"));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

export function isConnected(): boolean {
  try {
    return localStorage.getItem(CONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}
function setConnected(on: boolean) {
  try {
    if (on) localStorage.setItem(CONNECTED_KEY, "1");
    else localStorage.removeItem(CONNECTED_KEY);
  } catch {
    /* 保存できない端末では、毎回同意の画面を出すだけ */
  }
}
export function hasToken(): boolean {
  return !!token && Date.now() < tokenUntil;
}

/** トークンを受け取る。ボタンを押した処理の中から呼ぶ（ポップアップが止められないように） */
async function getToken(clientId: string): Promise<string> {
  if (hasToken()) return token;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error === "access_denied" ? "Googleドライブへの保存が許可されませんでした" : "Googleにつなげませんでした"));
        token = r.access_token;
        tokenUntil = Date.now() + ((r.expires_in || 3600) - 60) * 1000;
        resolve(token);
      },
      error_callback: (e) => reject(new Error(e.type === "popup_closed" ? "Googleの画面が閉じられました" : "Googleの画面を開けませんでした（ポップアップを許可してください）")),
    });
    client.requestAccessToken({ prompt: isConnected() ? "" : "consent" });
  });
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(`https://www.googleapis.com${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (r.status === 401) {
    token = "";
    throw new Error("Googleの接続が切れました。もう一度「同期する」を押してください");
  }
  if (!r.ok) throw new Error(`Googleドライブとのやりとりに失敗しました（${r.status}）`);
  return r;
}

async function findFile(): Promise<string | undefined> {
  const q = encodeURIComponent(`name='${FILE_NAME}'`);
  const r = await api(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=10`);
  const j = (await r.json()) as { files?: { id: string }[] };
  return j.files?.[0]?.id;
}

async function upload(d: MyCosmeData, fileId?: string): Promise<void> {
  const body = JSON.stringify(d);
  if (fileId) {
    await api(`/upload/drive/v3/files/${fileId}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
    return;
  }
  const boundary = `oc${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name: FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  await api(`/upload/drive/v3/files?uploadType=multipart`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: multipart });
}

let fileIdCache: string | undefined;

/** ドライブの一覧と、この端末の一覧を合わせて、両方に書く。戻り値は合わせたあとの件数 */
export async function sync(clientId: string): Promise<number> {
  await getToken(clientId);
  setConnected(true);
  const id = (fileIdCache ??= await findFile());
  let remote: MyCosmeData | null = null;
  if (id) remote = sanitize(await (await api(`/drive/v3/files/${id}?alt=media`)).json().catch(() => null));
  const local = load();
  const merged = remote ? merge(local, remote) : local;
  if (!same(merged, local)) save(merged);
  if (!remote || !same(merged, remote)) await upload(merged, id);
  if (!id) fileIdCache = await findFile();
  return Object.keys(merged.items).length;
}

/** このページで一覧を変えたとき、つないでいる間（トークンが有効な間）だけ、ドライブにも書く */
export async function pushIfConnected(): Promise<boolean> {
  if (!hasToken()) return false;
  const id = (fileIdCache ??= await findFile());
  await upload(load(), id);
  if (!id) fileIdCache = await findFile();
  return true;
}

/** つなぐのをやめる。eraseRemote ならドライブのファイルも消す。この端末の一覧は残す */
export async function disconnect(clientId: string, eraseRemote: boolean): Promise<void> {
  if (eraseRemote) {
    await getToken(clientId);
    const id = fileIdCache ?? (await findFile());
    if (id) await api(`/drive/v3/files/${id}`, { method: "DELETE" });
  }
  if (token && window.google) window.google.accounts.oauth2.revoke(token);
  token = "";
  tokenUntil = 0;
  fileIdCache = undefined;
  setConnected(false);
}
