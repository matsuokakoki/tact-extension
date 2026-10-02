import { googleIdentity, clearGoogleTokens } from './features/googleIdentity';
import { prepareMaterial } from './features/chatgptTransfer';
import { syncReminders, reminderStore, reminderKey } from './features/calendar/reminders';
import { setStorageDirect } from "./features/storage";
import { createLogger } from "./utils/logger";
import { NEW_FILE_CHECK_ALARM_NAME, DEFAULT_NEW_FILE_CHECK_INTERVAL } from "./constant";
const logger = createLogger("background");

// カレンダー同期用のアラーム名
const CALENDAR_SYNC_ALARM_NAME = "calendarSyncAlarm";

// 通知を表示する関数
function showNotification(title: string, message: string) {
    chrome.notifications.create({
        type: "basic",
        iconUrl: "/img/icon128.png",
        title: title,
        message: message,
        priority: 1,
    });
}

// 初期化処理
function init() {
    logger.debug("Service Worker初期化");
    // アラームの設定
    setupCalendarSyncAlarm();
    setupNewFileCheckAlarm();
}

// 新着ファイルチェック用のアラームをセットアップ
async function setupNewFileCheckAlarm(): Promise<void> {
    return new Promise<void>((resolve) => {
        chrome.storage.local.get(["newFileCheckInterval"], (result) => {
            if (chrome.runtime.lastError) {
                logger.error("Failed to read newFileCheckInterval:", chrome.runtime.lastError.message);
                resolve();
                return;
            }
            const interval: number =
                typeof result.newFileCheckInterval === "number"
                    ? result.newFileCheckInterval
                    : DEFAULT_NEW_FILE_CHECK_INTERVAL;

            chrome.alarms.clear(NEW_FILE_CHECK_ALARM_NAME, () => {
                chrome.alarms.create(NEW_FILE_CHECK_ALARM_NAME, { periodInMinutes: interval });
                logger.debug(`新着ファイルチェックアラームをセット: ${interval}分間隔`);
                resolve();
            });
        });
    });
}

/**
 * 新着ファイルチェックを実行する。
 * TACTタブが開いていればそのタブに checkNewFiles メッセージを送信する。
 */
async function performNewFileCheck(): Promise<void> {
    try {
        const tactTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ url: "https://tact.ac.thers.ac.jp/*" }, (tabs) => resolve(tabs));
        });

        if (tactTabs.length === 0) {
            logger.debug("新着ファイルチェック: TACTタブが見つかりません。スキップします。");
            return;
        }

        const tab = tactTabs[0];
        if (!tab.id) return;

        chrome.tabs.sendMessage(tab.id, { action: "checkNewFiles" }, (response) => {
            if (chrome.runtime.lastError) {
                logger.warn("新着ファイルチェックメッセージ送信エラー:", chrome.runtime.lastError.message);
                return;
            }
            logger.debug("新着ファイルチェック完了:", response);
        });
    } catch (error) {
        logger.error("performNewFileCheck エラー:", error);
    }
}

// カレンダー同期用のアラームをセットアップ
async function setupCalendarSyncAlarm() {
    return new Promise<void>((resolve, reject) => {
        chrome.storage.local.get(
            ["calendarSyncInterval", "autoSyncEnabled", "userAuthenticatedExplicitly"],
            (result) => {
                if (chrome.runtime.lastError) {
                    logger.error("Failed to read sync settings:", chrome.runtime.lastError.message);
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                const autoSyncEnabled = result.autoSyncEnabled !== false; // デフォルトはtrue
                const isAuthenticated = !!result.userAuthenticatedExplicitly;

                // 既存のアラームをクリア
                chrome.alarms.clear(CALENDAR_SYNC_ALARM_NAME, () => {
                    if (autoSyncEnabled && isAuthenticated) {
                        // 自動同期が有効な場合のみアラームを作成
                        const interval = result.calendarSyncInterval || 240; // デフォルト240分
                        chrome.alarms.create(CALENDAR_SYNC_ALARM_NAME, {
                            periodInMinutes: interval,
                        });
                        logger.debug(`カレンダー同期アラームをセット: ${interval}分間隔`);
                    } else {
                        logger.debug(
                            `アラームをクリアしました (autoSync=${autoSyncEnabled}, authenticated=${isAuthenticated})`
                        );
                    }
                    resolve();
                });
            }
        );
    });
}

// Google Calendar sync background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // NUSSファイルをbackground経由でfetchし、base64エンコードして返す
    if (request.type === "FETCH_NUSS_FILE") {
        const { downloadUrl, filename } = request;

        // URLバリデーション: nuss.nagoya-u.ac.jp のみ許可
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(downloadUrl);
        } catch {
            sendResponse({ success: false, error: "Invalid URL format", filename });
            return true;
        }
        if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "nuss.nagoya-u.ac.jp") {
            sendResponse({ success: false, error: "URL not allowed", filename });
            return true;
        }

        fetch(downloadUrl)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.arrayBuffer();
            })
            .then((buffer) => {
                // base64変換: チャンク化でメモリ効率を改善
                const bytes = new Uint8Array(buffer);
                const CHUNK = 8192;
                let binary = "";
                for (let i = 0; i < bytes.length; i += CHUNK) {
                    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
                }
                const base64 = btoa(binary);
                sendResponse({ success: true, data: base64, filename });
            })
            .catch((error) => {
                sendResponse({ success: false, error: (error as Error).message, filename });
            });
        return true; // 非同期レスポンスのため
    }

    (async () => {
        try {
            switch (request.action) {
                case 'prepareMaterialInChatGPT': {
                    const trustedOrigin = sender.url && (sender.url.startsWith('https://tact.ac.thers.ac.jp/') || sender.url.startsWith(chrome.runtime.getURL('')));
                    if (!trustedOrigin) throw new Error('TACT資料画面から操作してください');
                    const result = await prepareMaterial(request.url, request.filename);
                    sendResponse({ success: true, ...result });
                    break;
                }

                case "openMaterials": {
                    if (sender.url && !sender.url.startsWith('https://tact.ac.thers.ac.jp/')) throw new Error('TACTページから開いてください');
                    const courses = (request.courses || []).filter((c: any) => typeof c.id === 'string' && typeof c.name === 'string')
                        .map((c: any) => ({ id: c.id, name: c.name }));
                    await setStorageDirect({ tactMaterialCourses: courses });
                    await new Promise<void>((resolve, reject) => chrome.tabs.create({ url: chrome.runtime.getURL('materials.html') + '?course=' + encodeURIComponent(request.courseId || '') }, () => {
                        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
                    }));
                    sendResponse({ success: true });
                    break;
                }
                case "setReminderCompletion": {
                    const item = request.item;
                    if (!item || typeof item.id !== 'string' || typeof request.checked !== 'boolean') throw new Error('チェック状態が不正です');
                    const type = request.itemType === 'quiz' ? 'quiz' : 'assignment';
                    // Durable completion remains even if authentication or DELETE fails.
                    await reminderStore.write(`tactCompletion:${reminderKey(type, item)}`, request.checked);
                    const settings = await new Promise<any>(resolve => chrome.storage.local.get(['userAuthenticatedExplicitly'], resolve));
                    if (!settings.userAuthenticatedExplicitly) { sendResponse({ success: true, skipped: true }); break; }
                    const token = await new Promise<string>((resolve, reject) => googleIdentity.getAuthToken({ interactive: false }, token => {
                        if (chrome.runtime.lastError || !token) reject(new Error('カレンダー削除には再ログインが必要です。次回取得時に再試行します。')); else resolve(token);
                    }));
                    const result = await syncToCalendar({ [type === 'assignment' ? 'assignments' : 'quizzes']: [{ ...item, hasFinished: request.checked }] }, token);
                    if (result.errors.length) throw new Error(result.errors[0].error);
                    sendResponse({ success: true, result });
                    break;
                }

                case "authenticateGoogle": {
                    logger.debug("[DEBUG] authenticateGoogle action received");
                    // Use incremental authentication with minimal required scopes
                    const requestedScopes = request.scopes || [
                        "https://www.googleapis.com/auth/calendar",
                        "https://www.googleapis.com/auth/userinfo.email",
                        "https://www.googleapis.com/auth/userinfo.profile",
                    ];
                    logger.debug("[DEBUG] Requested scopes:", requestedScopes);
                    const token = await authenticateGoogle();
                    logger.debug("[DEBUG] Authentication completed, token received:", !!token);
                    sendResponse({ success: true, token });
                    break;
                }
                case "syncToCalendar": {
                    const result = await syncToCalendar(request.data, request.token);
                    sendResponse({ success: true, result });
                    break;
                }
                case "getGoogleAccounts": {
                    logger.debug("[DEBUG] getGoogleAccounts action received");
                    const accounts = await getGoogleAccounts();
                    logger.debug("[DEBUG] Retrieved accounts:", accounts.length, "accounts");
                    sendResponse({ success: true, accounts });
                    break;
                }
                case "logout": {
                    logger.debug("🔧 [LOGOUT DEBUG] Logout action received");
                    try {
                        await logoutGoogle();
                        // 認証解除時は自動同期アラームも必ずクリア
                        await setupCalendarSyncAlarm();
                        logger.debug("🔧 [LOGOUT DEBUG] Logout completed successfully");

                        // Notify user of successful logout
                        showNotification(
                            "ログアウト完了",
                            "Googleアカウントからログアウトしました。再度同期するには再認証が必要です。"
                        );

                        sendResponse({ success: true, message: "Complete logout successful" });
                    } catch (error) {
                        logger.error("🔧 [LOGOUT DEBUG] Logout failed:", error);
                        sendResponse({ success: false, error: (error as Error).message });
                    }
                    break;
                }
                case "checkAutoSync": {
                    // 自動同期の条件を確認
                    const shouldSync = await shouldAutoSync();
                    sendResponse({ success: true, shouldSync });
                    break;
                }
                case "updateSyncInterval": {
                    // 同期間隔が変更されたらアラームも更新
                    await setupCalendarSyncAlarm();
                    sendResponse({ success: true });
                    break;
                }
                case "setAutoSyncEnabled": {
                    // 自動同期の有効/無効設定
                    const enabled = request.enabled;
                    await setStorageDirect({ autoSyncEnabled: enabled });
                    await setupCalendarSyncAlarm(); // アラームを更新
                    sendResponse({ success: true });
                    break;
                }
                case "updateNewFileCheckInterval": {
                    // 新着ファイルチェック間隔が変更されたらアラームも更新
                    await setupNewFileCheckAlarm();
                    sendResponse({ success: true });
                    break;
                }
                case "performCalendarSync": {
                    // コンテンツスクリプトからの自動同期要求をバックグラウンドで実行
                    const syncResult = await performCalendarSync();
                    sendResponse({ success: true, ...syncResult });
                    break;
                }
                default:
                    sendResponse({ success: false, error: "Unknown action" });
            }
        } catch (error: any) {
            logger.error("Background script error:", error);
            sendResponse({ success: false, error: error?.message || String(error) });
        }
    })();
    return true; // async response
});

// アラームイベントのリスナー
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === CALENDAR_SYNC_ALARM_NAME) {
        logger.debug("カレンダー同期アラームが発火しました");
        await performCalendarSync();
    } else if (alarm.name === NEW_FILE_CHECK_ALARM_NAME) {
        logger.debug("新着ファイルチェックアラームが発火しました");
        await performNewFileCheck();
    }
});

// 最後の同期から設定間隔以上経過しているかチェック
async function shouldAutoSync(): Promise<boolean> {
    return new Promise((resolve) => {
        chrome.storage.local.get(
            ["lastSyncTime", "calendarSyncInterval", "autoSyncEnabled", "userAuthenticatedExplicitly"],
            (result) => {
                if (chrome.runtime.lastError) {
                    logger.error("Failed to check auto sync settings:", chrome.runtime.lastError.message);
                    resolve(false);
                    return;
                }
                // 認証していない場合は絶対に同期しない
                if (!result.userAuthenticatedExplicitly) {
                    resolve(false);
                    return;
                }
                // 自動同期が無効化されている場合は同期しない
                const autoSyncEnabled = result.autoSyncEnabled !== false; // デフォルトはtrue
                if (!autoSyncEnabled) {
                    resolve(false);
                    return;
                }

                const lastSyncTime = result.lastSyncTime || 0;
                // デフォルト240分、ミリ秒に変換
                const interval = (result.calendarSyncInterval || 240) * 60 * 1000;
                const now = Date.now();

                // 最終同期時間 + 同期間隔 < 現在時刻 なら同期が必要
                const needsSync = lastSyncTime + interval < now;
                resolve(needsSync);
            }
        );
    });
}

// Google OAuth authentication with enhanced security
async function authenticateGoogle(): Promise<string> {
    if (!chrome.runtime.getManifest().oauth2?.client_id) {
        throw new Error('個人用Google OAuth設定が必要です。READMEの「Googleカレンダーの初期設定」に従ってください。資料取得とChatGPTへの添付は設定なしで使えます。');
    }
    logger.debug("[DEBUG] authenticateGoogle function started");

    // まず既存トークンを非対話的に取得し、有効なら再利用する
    const existingToken = await new Promise<string | null>((resolve) => {
        googleIdentity.getAuthToken({ interactive: false }, (token) => {
            if (chrome.runtime.lastError || !token) {
                resolve(null);
            } else {
                resolve(token);
            }
        });
    });

    if (existingToken) {
        try {
            await verifyTokenSecurity(existingToken);
            logger.debug("[DEBUG] Existing token is valid, reusing it");
            // 既存トークンが有効なのでそのまま返す（userAuthenticatedExplicitly は既に設定済みのはず）
            await setStorageDirect({ userAuthenticatedExplicitly: true });
            return existingToken;
        } catch {
            logger.debug("[DEBUG] Existing token is invalid, removing cached token and re-authenticating");
            await new Promise<void>((resolve) => {
                googleIdentity.removeCachedAuthToken({ token: existingToken }, () => resolve());
            });
        }
    }

    return new Promise((resolve, reject) => {
        logger.debug("[DEBUG] Starting getAuthToken...");
        googleIdentity.getAuthToken(
            {
                interactive: true,
                scopes: [
                    "https://www.googleapis.com/auth/calendar",
                    "https://www.googleapis.com/auth/userinfo.email",
                    "https://www.googleapis.com/auth/userinfo.profile",
                ],
            },
            (token) => {
                logger.debug("[DEBUG] getAuthToken callback executed");
                logger.debug("[DEBUG] Chrome runtime error:", chrome.runtime.lastError);
                logger.debug("[DEBUG] Token received:", !!token);

                if (chrome.runtime.lastError || !token) {
                    logger.debug("[DEBUG] Authentication failed:", chrome.runtime.lastError?.message);
                    reject(new Error(chrome.runtime.lastError?.message || "Googleの認証に失敗しました。手動でログインし直してください。"));
                } else {
                    logger.debug("[DEBUG] Token received, verifying security...");
                    // Verify token validity before returning
                    verifyTokenSecurity(token)
                        .then(() => {
                            logger.debug("[DEBUG] Token security verified");
                            // Mark that user has explicitly authenticated
                            setStorageDirect({ userAuthenticatedExplicitly: true })
                                .then(() => {
                                    logger.debug("[DEBUG] User authentication flag set");
                                    resolve(token);
                                })
                                .catch(() => {
                                    // ストレージ書き込み失敗でもトークンは有効なので返す
                                    resolve(token);
                                });
                        })
                        .catch((error) => {
                            logger.debug("[DEBUG] Token security verification failed:", error);
                            logger.debug("[DEBUG] Clearing authentication and retrying...");

                            // Clear the failed token and try fresh authentication
                            googleIdentity.removeCachedAuthToken({ token }, () => {
                                logger.debug("[DEBUG] Cached token cleared, attempting fresh authentication...");
                                // Recursive call for fresh authentication (only once to avoid infinite loop)
                                clearAuthenticationAndReauth().then(resolve).catch(reject);
                            });
                        });
                }
            }
        );
    });
}

// Verify token security and validity
async function verifyTokenSecurity(token: string): Promise<void> {
    logger.debug("🔧 [TOKEN DEBUG] Starting token security verification...");
    try {
        // Verify token by making a test API call
        const response = await fetch("https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=" + token);
        logger.debug("🔧 [TOKEN DEBUG] Token info response status:", response.status);

        if (!response.ok) {
            throw new Error("Token verification failed");
        }

        const tokenInfo = await response.json();
        logger.debug("🔧 [TOKEN DEBUG] Token info received:", {
            aud: tokenInfo.aud,
            scope: tokenInfo.scope,
            expires_in: tokenInfo.expires_in,
        });

        // Verify token audience (client_id) - read from manifest to avoid duplication
        const manifest = chrome.runtime.getManifest() as any;
        const expectedClientId = manifest.oauth2?.client_id;
        if (!expectedClientId || tokenInfo.aud !== expectedClientId) {
            logger.error("🔧 [TOKEN DEBUG] Client ID mismatch:", tokenInfo.aud, "vs expected:", expectedClientId);
            throw new Error("Token audience verification failed");
        }
        logger.debug("🔧 [TOKEN DEBUG] Client ID verification passed");

        // Verify required scopes are present
        const requiredScopes = [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
        ];

        const tokenScopes = tokenInfo.scope ? tokenInfo.scope.split(" ") : [];
        const missingScopes = requiredScopes.filter((scope) => !tokenScopes.includes(scope));
        logger.debug("🔧 [TOKEN DEBUG] Granted scopes:", tokenScopes);
        logger.debug("🔧 [TOKEN DEBUG] Missing scopes:", missingScopes);

        if (missingScopes.length > 0) {
            throw new Error("Required scopes not granted: " + missingScopes.join(", "));
        }
        logger.debug("🔧 [TOKEN DEBUG] Scope verification passed");

        // Verify token expiry
        const expiresIn = parseInt(tokenInfo.expires_in);
        logger.debug("🔧 [TOKEN DEBUG] Token expires in:", expiresIn, "seconds");
        if (expiresIn < 60)
            // Less than 1 minute remaining
            throw new Error("Token expires too soon");
        logger.debug("🔧 [TOKEN DEBUG] Token security verification completed successfully");
    } catch (error) {
        logger.error("🔧 [TOKEN DEBUG] Token verification error:", error);
        throw new Error("Token security verification failed");
    }
}

// Get user's Google accounts - only when explicitly requested
async function getGoogleAccounts(): Promise<any[]> {
    logger.debug("🔧 [AUTH DEBUG] getGoogleAccounts function started");
    return new Promise((resolve) => {
        // Check if user has explicitly authenticated
        chrome.storage.local.get(["userAuthenticatedExplicitly"], (result) => {
            logger.debug("🔧 [AUTH DEBUG] userAuthenticatedExplicitly flag:", result.userAuthenticatedExplicitly);

            if (!result.userAuthenticatedExplicitly) {
                logger.debug("🔧 [AUTH DEBUG] User has not explicitly authenticated, returning empty array");
                // User has not explicitly authenticated, return empty array
                resolve([]);
                return;
            }

            logger.debug("🔧 [AUTH DEBUG] User has explicitly authenticated, checking for existing tokens...");
            // Only check for existing tokens if user has explicitly authenticated
            googleIdentity.getAuthToken({ interactive: false }, async (token) => {
                logger.debug("🔧 [AUTH DEBUG] getAuthToken (non-interactive) callback executed");
                logger.debug("🔧 [AUTH DEBUG] Token exists:", !!token);
                logger.debug("🔧 [AUTH DEBUG] Chrome runtime error:", chrome.runtime.lastError);

                const tryFetchUserInfo = async (tokenToUse: string) => {
                    try {
                        logger.debug("[DEBUG] Verifying token security...");
                        // Verify token before use
                        await verifyTokenSecurity(tokenToUse);
                        logger.debug("[DEBUG] Token security verified, fetching user info...");

                        // Use secure endpoint with proper validation
                        const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                            headers: {
                                Authorization: `Bearer ${tokenToUse}`,
                                Accept: "application/json",
                                "Cache-Control": "no-cache",
                            },
                        });

                        logger.debug("[DEBUG] User info fetch response status:", response.status);

                        if (response.ok) {
                            const userInfo = await response.json();
                            logger.debug("[DEBUG] User info received:", {
                                email: userInfo.email,
                                name: userInfo.name,
                                verified: userInfo.email_verified,
                            });

                            // Validate user info structure
                            if (!userInfo.email || !userInfo.email_verified) {
                                throw new Error("Invalid or unverified user info");
                            }

                            await setStorageDirect({ tactGoogleLoginHint: userInfo.email });
                            resolve([
                                {
                                    id: userInfo.sub || userInfo.id, // Use 'sub' (subject) as primary ID
                                    email: userInfo.email,
                                    name: userInfo.name,
                                    picture: userInfo.picture,
                                    verified_email: userInfo.email_verified,
                                },
                            ]);
                        } else if (response.status === 401) {
                            logger.debug("[DEBUG] Token expired (401), clearing auth flag");
                            // Keep opt-in; discard only the failed token so the next sync can renew silently.
                            await clearGoogleTokens();
                            resolve([]);
                        } else {
                            logger.error("[DEBUG] User info fetch failed:", response.status, response.statusText);
                            resolve([]);
                        }
                    } catch (e) {
                        logger.error("[DEBUG] User info fetch error:", e);
                        resolve([]);
                    }
                };

                if (!token) {
                    logger.debug(
                        "[DEBUG] No existing token (cache may have been cleared), returning empty without clearing auth flag"
                    );
                    // トークンキャッシュがクリアされた可能性があるため、フラグは削除しない
                    resolve([]);
                    return;
                }

                await tryFetchUserInfo(token);
            });
        });
    });
}

// Keep reminders scoped to the authenticated Google account; no calendar-wide search.
async function syncToCalendar(data: any, token?: string): Promise<any> {
    if (!token) return { assignments: [], quizzes: [], errors: [{ type: 'auth', title: '', error: 'Google認証が必要です' }] };
    const accounts = await getGoogleAccounts();
    const account = accounts[0];
    if (!account?.email) throw new Error('Googleアカウントを確認できません');
    return syncReminders(data, token, account.email);
}

// Complete logout - remove all authentication data and cached tokens
async function logoutGoogle(): Promise<void> {
    logger.debug("🔧 [LOGOUT DEBUG] Starting complete logout process...");

    return new Promise((resolve) => {
        const clearStorage = () => {
            clearAllAuthenticationData(() => {
                logger.debug("🔧 [LOGOUT DEBUG] All authentication data cleared");
                resolve();
            });
        };
        clearGoogleTokens().then(clearStorage, clearStorage);
    });
}

// Clear all authentication-related data from storage
function clearAllAuthenticationData(callback?: () => void): void {
    logger.debug("🔧 [LOGOUT DEBUG] Clearing all authentication storage data...");

    const keysToRemove = [
        "userAuthenticatedExplicitly",
        "tactGoogleLoginHint",
        "oauth_state",
        "lastSyncTime",
        "sentEventKeys",
        "google_auth_token",
        "google_user_info",
        "calendar_permissions",
    ];

    chrome.storage.local.remove(keysToRemove, () => {
        if (chrome.runtime.lastError) {
            logger.error("Failed to clear auth storage:", chrome.runtime.lastError.message);
        }
        logger.debug("🔧 [LOGOUT DEBUG] Storage data cleared:", keysToRemove);

        // Session storage is available in newer Chrome versions
        try {
            if ((chrome.storage as any).session) {
                (chrome.storage as any).session.clear(() => {
                    logger.debug("🔧 [LOGOUT DEBUG] Session storage cleared");
                    if (callback) callback();
                });
            } else {
                if (callback) callback();
            }
        } catch (error) {
            logger.debug("🔧 [LOGOUT DEBUG] Session storage not available");
            if (callback) callback();
        }
    });
}

// バックグラウンドからカレンダー同期を実行
async function performCalendarSync() {
    try {
        const settings = await new Promise<any>((resolve, reject) => chrome.storage.local.get(['autoSyncEnabled', 'userAuthenticatedExplicitly'], result => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(result);
        }));
        if (!settings.userAuthenticatedExplicitly || settings.autoSyncEnabled === false) return { assignments: [], quizzes: [], errors: [] };
        logger.debug("バックグラウンドから自動同期を実行します");

        // TACTタブがあるかどうかを確認
        const tactTabs = await new Promise<chrome.tabs.Tab[]>((resolve) => {
            chrome.tabs.query({ url: "https://tact.ac.thers.ac.jp/*" }, (tabs) => {
                resolve(tabs);
            });
        });

        if (tactTabs.length === 0) {
            logger.debug("TACTタブが見つかりません。同期をスキップします。");
            // 次回アラームの準備（スキップしてもアラームは継続する）
            const attemptResult = await new Promise<any>((resolve) => {
                chrome.storage.local.get(["lastSyncAttempt"], (result) => resolve(result));
            });
            const now = Date.now();
            // 最後の試行から30分以上経過している場合はTACTタブを開くプロンプトを表示
            if (!attemptResult.lastSyncAttempt || now - attemptResult.lastSyncAttempt > 30 * 60 * 1000) {
                showNotification(
                    "同期に必要なTACTタブがありません",
                    "カレンダー同期にはTACTページが必要です。同期を開始するにはTACTにログインしてください。"
                );
                await setStorageDirect({ lastSyncAttempt: now });
            }
            return { error: "TACT_TAB_NOT_FOUND" };
        }

        // TACTタブにデータ取得メッセージを送信
        const tab = tactTabs[0];
        let data;
        try {
            data = await new Promise<any>((resolve, reject) => {
                chrome.tabs.sendMessage(tab.id!, { action: "getSakaiDataForSync" }, async (response) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                        return;
                    }
                    if (!response || !response.success) {
                        reject(new Error(response?.error || "データ取得エラー"));
                        return;
                    }
                    resolve(response.data);
                });
            });
        } catch (contentScriptError) {
            logger.error("コンテンツスクリプトからのデータ取得に失敗:", contentScriptError);
            // TACTページでコンテンツスクリプトが正しく動作していない場合
            showNotification("同期データの取得に失敗しました", "TACTページを再読み込みして再度お試しください。");
            return { error: "CONTENT_SCRIPT_ERROR", details: String(contentScriptError) };
        }

        if (!data || (!data.assignments && !data.quizzes)) {
            logger.debug("同期するデータが見つかりませんでした");
            return { assignments: [], quizzes: [], errors: [] };
        }

        // Googleカレンダーに同期 - 既存トークンのチェックのみ
        let token;
        try {
            // 非対話的認証のみ試行（既存トークンがある場合のみ）
            const accounts = await getGoogleAccounts();
            if (accounts.length === 0) {
                logger.debug("Googleアカウントが認証されていません。自動同期をスキップします。");
                showNotification(
                    "カレンダー同期スキップ",
                    "Googleアカウントにログインしてください。手動でカレンダー同期を実行してください。"
                );
                return { error: "NO_AUTH_TOKEN" };
            }

            // 既存トークンで認証を取得
            token = await new Promise<string>((resolve, reject) => {
                googleIdentity.getAuthToken({ interactive: false }, (t) => {
                    if (chrome.runtime.lastError || !t) {
                        reject(new Error("No valid authentication token"));
                    } else {
                        resolve(t);
                    }
                });
            });
            // 取得したトークンを検証
            await verifyTokenSecurity(token);
        } catch (authError) {
            logger.error("Google認証トークンが無効:", authError);
            showNotification(
                "カレンダー同期スキップ",
                "Googleアカウントの認証が必要です。手動でカレンダー同期を実行してください。"
            );
            return { error: "AUTH_ERROR", details: String(authError) };
        }

        const result = await syncToCalendar(data, token);

        // 結果の通知
        const totalEvents = result.assignments.length + result.quizzes.length;

        // 実際にイベントが作成された場合のみ最終同期時刻を保存
        // 空振り時に更新すると、直後に追加された課題が次の間隔まで取り込まれなくなる
        if (totalEvents > 0) {
            await setStorageDirect({ lastSyncTime: Date.now() });
        }
        if (totalEvents > 0) {
            showNotification("カレンダー同期完了", `${totalEvents}件のイベントをGoogleカレンダーに同期しました`);
        }

        logger.debug(`自動同期完了: ${totalEvents}件のイベントを作成しました`);

        // 同期結果をTACTタブに通知
        if (tab.id) {
            try {
                chrome.tabs.sendMessage(tab.id, {
                    action: "syncCompleted",
                    result: {
                        assignments: result.assignments.length,
                        quizzes: result.quizzes.length,
                        errors: result.errors.length,
                    },
                });
            } catch (notifyError) {
                logger.error("同期結果通知のエラー:", notifyError);
            }
        }

        return result;
    } catch (error) {
        logger.error("自動同期に失敗しました:", error);
        showNotification("カレンダー同期エラー", "カレンダー同期処理中にエラーが発生しました。");
        return { error: "SYNC_ERROR", details: String(error) };
    }
}

// Clear existing authentication and force re-authentication
async function clearAuthenticationAndReauth(): Promise<string> {
    logger.debug("🔧 [AUTH CLEAR] Clearing existing authentication...");

    // Clear stored authentication flags
    await new Promise<void>((resolve) => {
        chrome.storage.local.remove(["userAuthenticatedExplicitly"], () => resolve());
    });

    // Perform simple re-authentication without recursive verification
    return new Promise((resolve, reject) => {
        googleIdentity.getAuthToken(
            {
                interactive: true,
                scopes: [
                    "https://www.googleapis.com/auth/calendar",
                    "https://www.googleapis.com/auth/userinfo.email",
                    "https://www.googleapis.com/auth/userinfo.profile",
                ],
            },
            (token) => {
                if (chrome.runtime.lastError || !token) {
                    reject(new Error(chrome.runtime.lastError?.message || "Fresh authentication failed"));
                } else {
                    // Verify token security before accepting it
                    verifyTokenSecurity(token)
                        .then(() => {
                            setStorageDirect({ userAuthenticatedExplicitly: true })
                                .then(() => {
                                    logger.debug("🔧 [AUTH CLEAR] Fresh authentication successful");
                                    resolve(token);
                                })
                                .catch(() => {
                                    resolve(token);
                                });
                        })
                        .catch((error) => {
                            logger.error("🔧 [AUTH CLEAR] Token verification failed after reauth:", error);
                            reject(new Error("Token security verification failed after re-authentication"));
                        });
                }
            }
        );
    });
}

// serviceWorkerの起動時に初期化
init();
