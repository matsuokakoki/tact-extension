/** Small, serialized reminder synchronizer. No calendar-wide listing. */
export interface ReminderItem {
    id: string; title: string; dueTime: number; context?: string; courseName?: string;
    hasFinished?: boolean; submitted?: boolean;
}
interface EventRecord { eventId: string; signature: string; ready: boolean; item: ReminderItem; type: string; }
export interface ReminderStore {
    read(key: string): Promise<any>;
    write(key: string, value: any): Promise<void>;
}
export const reminderStore: ReminderStore = {
    read: key => new Promise((resolve, reject) => chrome.storage.local.get(key, data => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(data[key]);
    })),
    write: (key, value) => new Promise((resolve, reject) => chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
    }))
};
export function reminderKey(type: string, item: ReminderItem): string {
    return `${type}:${item.context || ''}:${item.id}`;
}
export function exclusionReason(item: ReminderItem, now: number): string | null {
    if (item.submitted) return 'TACT上で提出済み';
    if (item.hasFinished) return '完了チェック済み';
    if (!Number.isFinite(item.dueTime) || item.dueTime <= 0) return '締切を読み取れません';
    if (item.dueTime <= now) return '締切を過ぎています';
    if (item.dueTime > now + 7 * 86400) return '締切が7日より先です';
    return null;
}
export function eligible(item: ReminderItem, now: number): boolean {
    return exclusionReason(item, now) === null;
}
let queue: Promise<unknown> = Promise.resolve();
export function syncReminders(data: { assignments?: ReminderItem[]; quizzes?: ReminderItem[]; verifyExisting?: boolean }, token: string,
    accountId: string, store: ReminderStore = reminderStore, request: typeof fetch = fetch,
    now = Math.floor(Date.now() / 1000)): Promise<any> {
    const work = () => run(data, token, accountId, store, request, now);
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
}
async function run(data: { assignments?: ReminderItem[]; quizzes?: ReminderItem[]; verifyExisting?: boolean }, token: string,
    account: string, store: ReminderStore, request: typeof fetch, now: number) {
    if (!token || !account) throw new Error('Google認証が必要です');
    const storageKey = `tactReminderEvents:v1:${account}`;
    const records: Record<string, EventRecord> = await store.read(storageKey) || {};
    const result: any = { assignments: [], quizzes: [], errors: [], deleted: 0, updated: 0, eligible: 0, unchanged: 0, diagnostics: [] };
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const work = { assignments: [...(data.assignments || [])], quizzes: [...(data.quizzes || [])] };
    const seen = new Set([...work.assignments.map(item => reminderKey('assignment', item)), ...work.quizzes.map(item => reminderKey('quiz', item))]);
    for (const [key, record] of Object.entries(records)) {
        if (!seen.has(key) && record.item && (record.item.dueTime <= now || await store.read(`tactCompletion:${key}`) === true)) {
            work[record.type === 'assignment' ? 'assignments' : 'quizzes'].push(record.item);
        }
    }
    for (const type of ['assignment', 'quiz'] as const) {
        for (const original of work[type === 'assignment' ? 'assignments' : 'quizzes']) {
            if (!original.id || !original.title) continue;
            const key = reminderKey(type, original);
            // Read completion at execution time, including retries and overlapping syncs.
            const completion = await store.read(`tactCompletion:${key}`);
            const item = { ...original, hasFinished: completion === undefined ? original.hasFinished : completion };
            let record = records[key];
            const reason = exclusionReason(item, now);
            const diagnostic = { title: item.title, courseName: item.courseName || '', dueTime: item.dueTime, reason: reason || '同期対象' };
            result.diagnostics.push(diagnostic);
            if (!reason) result.eligible++;
            try {
                if (!eligible(item, now)) {
                    if (record) {
                        const response = await request(`${base}/${encodeURIComponent(record.eventId)}`, { method: 'DELETE', headers });
                        if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`削除失敗 HTTP ${response.status}`);
                        delete records[key];
                        await store.write(storageKey, records);
                        result.deleted++;
                    }
                    continue;
                }
                const body = {
                    summary: `${type === 'assignment' ? '課題' : '小テスト'}: ${item.title}`,
                    location: item.courseName || '',
                    description: `https://tact.ac.thers.ac.jp/portal/site/${encodeURIComponent(item.context || '')}`,
                    start: { dateTime: new Date(item.dueTime * 1000).toISOString(), timeZone: 'Asia/Tokyo' },
                    end: { dateTime: new Date((item.dueTime + 1800) * 1000).toISOString(), timeZone: 'Asia/Tokyo' },
                    extendedProperties: { private: { sakaiAssignmentId: item.id, itemType: type, tactReminderKey: key } },
                    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }, { method: 'popup', minutes: 1440 }] }
                };
                const signature = JSON.stringify(body);
                if (record?.ready && record.signature === signature && !data.verifyExisting) { result.unchanged++; diagnostic.reason = '登録済み（変更なし）'; continue; }
                if (record?.ready) {
                    const response = await request(`${base}/${encodeURIComponent(record.eventId)}`, { method: 'PATCH', headers, body: signature });
                    if (response.status === 404 || response.status === 410) {
                        delete records[key];
                        await store.write(storageKey, records);
                        record = undefined as any;
                    } else {
                        if (!response.ok) throw new Error(`更新失敗 HTTP ${response.status}`);
                        record.signature = signature;
                        record.item = item;
                        await store.write(storageKey, records);
                        result.updated++;
                        continue;
                    }
                }
                if (!record) {
                    // Persist the ID before POST so a worker interruption can never duplicate it.
                    const bytes = crypto.getRandomValues(new Uint8Array(16));
                    record = { eventId: 'tact' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''), signature, ready: false, item, type };
                    records[key] = record;
                    await store.write(storageKey, records);
                }
                let response = await request(base, { method: 'POST', headers, body: JSON.stringify({ ...body, id: record.eventId }) });
                if (response.status === 409) {
                    response = await request(`${base}/${record.eventId}`, { headers });
                    if (response.ok) {
                        const existing = await response.json();
                        if (existing.extendedProperties?.private?.tactReminderKey !== key) throw new Error('予定IDが競合しました');
                        // A previous POST succeeded; align with the latest deadline.
                        response = await request(`${base}/${record.eventId}`, { method: 'PATCH', headers, body: signature });
                    }
                }
                if (response.status === 410) {
                    delete records[key];
                    await store.write(storageKey, records);
                    throw new Error('予定が削除されました。次回取得時に再作成します');
                }
                if (!response.ok) throw new Error(`作成失敗 HTTP ${response.status}`);
                record.ready = true;
                record.signature = signature;
                record.item = item;
                await store.write(storageKey, records);
                result[type === 'assignment' ? 'assignments' : 'quizzes'].push({ title: item.title, success: true, eventId: record.eventId });
            } catch (error) {
                result.errors.push({ type, title: item.title, error: String(error) });
            }
        }
    }
    return result;
}
