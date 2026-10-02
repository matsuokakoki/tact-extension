/** Shared desktop Chrome/Edge OAuth. Requires a Google Web application client. */
const CACHE_KEY = 'tactGoogleOAuth';
export const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
];
interface CachedToken { token: string; expiresAt: number; clientId: string; }
let pending: Promise<string> | undefined;
let generation = 0;
// The pinned Chrome type package predates storage.session (Chromium 102+).
interface SessionStorage {
    get(key: string, callback: (data: Record<string, any>) => void): void;
    set(data: Record<string, any>, callback: () => void): void;
    remove(key: string, callback: () => void): void;
}
const session = (): SessionStorage => (chrome.storage as typeof chrome.storage & { session: SessionStorage }).session;

function sessionGet(): Promise<CachedToken | undefined> {
    return new Promise((resolve, reject) => session().get(CACHE_KEY, data => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(data[CACHE_KEY]);
    }));
}
function sessionSet(value: CachedToken): Promise<void> {
    return new Promise((resolve, reject) => session().set({ [CACHE_KEY]: value }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
    }));
}
export function parseGoogleRedirect(url: string, redirect: string, state: string): { token: string; expiresIn: number } {
    const result = new URL(url), expected = new URL(redirect);
    if (result.origin !== expected.origin || result.pathname !== expected.pathname || result.search) throw new Error('認証の戻り先が不正です');
    const params = new URLSearchParams(result.hash.slice(1));
    if (params.get('state') !== state) throw new Error('認証のstateが一致しません');
    if (params.get('error')) throw new Error('Googleでの認証が必要です。手動でログインしてください。');
    const token = params.get('access_token');
    const expiresIn = Number(params.get('expires_in'));
    const scopes = (params.get('scope') || '').split(' ');
    if (!token || params.get('token_type')?.toLowerCase() !== 'bearer' || !Number.isFinite(expiresIn) || expiresIn <= 60 || !GOOGLE_SCOPES.every(scope => scopes.includes(scope))) {
        throw new Error('認証情報またはカレンダーの権限が不足しています');
    }
    return { token, expiresIn };
}
async function acquire(interactive: boolean): Promise<string> {
    const clientId = chrome.runtime.getManifest().oauth2?.client_id;
    if (!clientId) throw new Error('READMEのGoogleカレンダー初期設定を行ってください');
    const cached = await sessionGet();
    if (cached?.clientId === clientId && cached.expiresAt > Date.now() + 60000) return cached.token;
    // Never initiate even a hidden OAuth request until the user has opted in.
    const settings = await new Promise<any>(resolve => chrome.storage.local.get(['userAuthenticatedExplicitly', 'tactGoogleLoginHint'], resolve));
    if (!interactive) {
        if (!settings.userAuthenticatedExplicitly) throw new Error('Googleにログインしてください');
    }
    const startGeneration = generation;
    const redirect = chrome.identity.getRedirectURL('google');
    const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'token', scope: GOOGLE_SCOPES.join(' '), state, prompt: interactive ? 'select_account' : 'none', include_granted_scopes: 'true' }).toString();
    if (!interactive && typeof settings.tactGoogleLoginHint === 'string') auth.searchParams.set('login_hint', settings.tactGoogleLoginHint);
    const callbackUrl = await new Promise<string>((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url: auth.href, interactive, ...(!interactive ? { abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 10000 } : {}) }, url => {
            if (chrome.runtime.lastError || !url) reject(new Error(chrome.runtime.lastError?.message || 'Googleでの認証が必要です'));
            else resolve(url);
        });
    });
    const result = parseGoogleRedirect(callbackUrl, redirect, state);
    if (generation !== startGeneration) throw new Error('ログアウトにより認証を中止しました');
    // session is inaccessible to content scripts by default; never persist bearer tokens to local/sync.
    await sessionSet({ token: result.token, expiresAt: Date.now() + result.expiresIn * 1000, clientId });
    if (generation !== startGeneration) { await clearGoogleTokens(); throw new Error('認証を中止しました'); }
    return result.token;
}
export async function getGoogleToken(interactive = false): Promise<string> {
    if (pending) {
        try { return await pending; } catch (error) { if (!interactive) throw error; }
    }
    const operation = acquire(interactive);
    pending = operation;
    try { return await operation; } finally { if (pending === operation) pending = undefined; }
}
export function clearGoogleTokens(): Promise<void> {
    generation++;
    return new Promise((resolve, reject) => session().remove(CACHE_KEY, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
    }));
}
// Callback adapter keeps the existing calendar flows independent of browser-specific identity APIs.
export const googleIdentity = {
    getAuthToken(options: { interactive?: boolean; scopes?: string[] }, callback: (token?: string) => void): void {
        getGoogleToken(!!options.interactive).then(callback, () => callback(undefined));
    },
    removeCachedAuthToken(_options: { token: string }, callback: () => void): void {
        clearGoogleTokens().then(callback, callback);
    },
};
