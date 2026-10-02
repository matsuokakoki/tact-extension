import { clearGoogleTokens, getGoogleToken, parseGoogleRedirect, GOOGLE_SCOPES } from '../features/googleIdentity';
const redirect = 'https://example.chromiumapp.org/google';
const clientId = 'personal.apps.googleusercontent.com';
let cache: Record<string, any>;
let optedIn: boolean;
let loginHint: string | undefined;
let launch: jest.Mock;
function callbackUrl(state: string): string {
    return redirect + '#' + new URLSearchParams({ state, access_token: 'secret-token', expires_in: '3600', token_type: 'Bearer', scope: GOOGLE_SCOPES.join(' ') });
}
beforeEach(() => {
    cache = {}; optedIn = true; loginHint = undefined;
    (global as any).crypto = require('crypto').webcrypto;
    launch = jest.fn((options, done) => done(callbackUrl(new URL(options.url).searchParams.get('state')!)));
    (global as any).chrome = {
        runtime: { getManifest: () => ({ oauth2: { client_id: clientId } }) },
        identity: { getRedirectURL: () => redirect, launchWebAuthFlow: launch },
        storage: {
            local: { get: (_key: string, done: any) => done({ userAuthenticatedExplicitly: optedIn, tactGoogleLoginHint: loginHint }) },
            session: {
                get: (_key: string, done: any) => done({ ...cache }),
                set: (data: any, done: any) => { Object.assign(cache, data); done(); },
                remove: (key: string, done: any) => { delete cache[key]; done(); },
            },
        },
    };
});
test('Chrome and Edge use the same flow without getAuthToken, session cache survives worker restart', async () => {
    expect(await getGoogleToken(true)).toBe('secret-token');
    expect(launch.mock.calls[0][0].interactive).toBe(true);
    const url = new URL(launch.mock.calls[0][0].url);
    expect(url.searchParams.get('client_id')).toBe(clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(redirect);
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(await getGoogleToken()).toBe('secret-token');
    expect(launch).toHaveBeenCalledTimes(1);
    jest.resetModules();
    expect(await require('../features/googleIdentity').getGoogleToken()).toBe('secret-token');
    expect(launch).toHaveBeenCalledTimes(1);
});
test('expired cache renews without showing a login window', async () => {
    cache.tactGoogleOAuth = { token: 'old', expiresAt: Date.now(), clientId };
    expect(await getGoogleToken()).toBe('secret-token');
    expect(launch.mock.calls[0][0]).toMatchObject({ interactive: false, timeoutMsForNonInteractive: 10000 });
    expect(new URL(launch.mock.calls[0][0].url).searchParams.get('prompt')).toBe('none');
});
test('no background authentication before user opt-in', async () => {
    optedIn = false;
    await expect(getGoogleToken()).rejects.toThrow();
    expect(launch).not.toHaveBeenCalled();
});
test('silent error leaves manual login available', async () => {
    launch.mockImplementationOnce((_options, done) => done(redirect + '#error=login_required&state=bad'));
    await expect(getGoogleToken()).rejects.toThrow();
    expect(await getGoogleToken(true)).toBe('secret-token');
});
test('parallel sync requests share one authentication', async () => {
    expect(await Promise.all([getGoogleToken(), getGoogleToken(), getGoogleToken()])).toEqual(['secret-token', 'secret-token', 'secret-token']);
    expect(launch).toHaveBeenCalledTimes(1);
});
test('logout clears cached token and prevents pending login from repopulating it', async () => {
    await getGoogleToken(true);
    await clearGoogleTokens();
    expect(cache).toEqual({});
    let finish: any;
    launch.mockImplementationOnce((_options, done) => { finish = done; });
    const auth = getGoogleToken(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    const state = new URL(launch.mock.calls[1][0].url).searchParams.get('state')!;
    await clearGoogleTokens();
    finish(callbackUrl(state));
    await expect(auth).rejects.toThrow('ログアウト');
    expect(cache).toEqual({});
});
test('cache from another client cannot be reused', async () => {
    cache.tactGoogleOAuth = { token: 'old', expiresAt: Date.now() + 999999, clientId: 'other' };
    expect(await getGoogleToken()).toBe('secret-token');
    expect(launch).toHaveBeenCalledTimes(1);
});
test('rejects forged redirect, state, missing scopes and expired or non-bearer tokens', () => {
    const valid = callbackUrl('state');
    expect(parseGoogleRedirect(valid, redirect, 'state').token).toBe('secret-token');
    for (const invalid of [valid.replace('example.chromiumapp.org', 'evil.example'), valid.replace('/google#', '/wrong#'), valid.replace('state=state', 'state=other'), valid.replace('expires_in=3600', 'expires_in=10'), valid.replace('token_type=Bearer', 'token_type=MAC'), valid.replace(/scope=.*/, 'scope=openid')]) {
        expect(() => parseGoogleRedirect(invalid, redirect, 'state')).toThrow();
    }
});
test('missing personal client fails without an OAuth window', async () => {
    (chrome.runtime.getManifest as any) = () => ({});
    await expect(getGoogleToken(true)).rejects.toThrow('初期設定');
    expect(launch).not.toHaveBeenCalled();
});

test('silent renewal stays on the previously selected Google account', async () => {
    loginHint = 'selected@example.com';
    await getGoogleToken();
    expect(new URL(launch.mock.calls[0][0].url).searchParams.get('login_hint')).toBe(loginHint);
});
test('API failure discards no credentials into persistent storage and allows retry', async () => {
    launch.mockImplementationOnce((_options, done) => {
        (chrome.runtime as any).lastError = { message: 'OAuth cancelled' };
        done(undefined);
        delete (chrome.runtime as any).lastError;
    });
    await expect(getGoogleToken(true)).rejects.toThrow('cancelled');
    expect(cache).toEqual({});
    expect(await getGoogleToken(true)).toBe('secret-token');
});
