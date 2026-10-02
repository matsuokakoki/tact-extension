import { eligible, syncReminders, ReminderStore, ReminderItem, reminderKey } from '../features/calendar/reminders';
const now = 1800000000;
const item: ReminderItem = { id: 'a', title: '課題A', dueTime: now + 86400, context: 'c', courseName: '授業' };
function memory(): ReminderStore {
    const data: Record<string, any> = {};
    return { read: async key => data[key] === undefined ? undefined : JSON.parse(JSON.stringify(data[key])), write: async (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); } };
}
function response(status = 200, data: any = { id: 'event' }): Response { return { ok: status < 400, status, json: async () => data } as Response; }
beforeAll(() => { (global as any).crypto = require('crypto').webcrypto; });
test('seven-day boundaries and TACT submission filter', () => {
    expect(eligible(item, now)).toBe(true);
    expect(eligible({ ...item, dueTime: now }, now)).toBe(false);
    expect(eligible({ ...item, dueTime: now + 7 * 86400 }, now)).toBe(true);
    expect(eligible({ ...item, dueTime: now + 7 * 86400 + 1 }, now)).toBe(false);
    expect(eligible({ ...item, submitted: true }, now)).toBe(false);
    expect(eligible({ ...item, hasFinished: true }, now)).toBe(false);
});
test('CREATE -> unchanged zero requests -> checked direct DELETE -> unchecked CREATE', async () => {
    const store = memory(), request = jest.fn(async (_url: string, _init?: RequestInit) => response());
    await syncReminders({ assignments: [item] }, 'token', 'account', store, request as any, now);
    expect(request).toHaveBeenCalledTimes(1);
    const created = JSON.parse(request.mock.calls[0][1]?.body as string);
    expect(created.id).toMatch(/^[a-v0-9]{5,1024}$/);
    await syncReminders({ assignments: [item] }, 'token', 'account', store, request as any, now);
    expect(request).toHaveBeenCalledTimes(1);
    await store.write(`tactCompletion:${reminderKey('assignment', item)}`, true);
    expect((await syncReminders({ assignments: [item] }, 'token', 'account', store, request as any, now)).deleted).toBe(1);
    expect(request.mock.calls[1][1]?.method).toBe('DELETE');
    await store.write(`tactCompletion:${reminderKey('assignment', item)}`, false);
    await syncReminders({ assignments: [item] }, 'token', 'account', store, request as any, now);
    expect(request.mock.calls[2][1]?.method).toBe('POST');
});
test('failed DELETE retains ID and retries even when the assignment is absent', async () => {
    const store = memory();
    const request = jest.fn(async (_url: string, _init?: RequestInit) => response()).mockImplementationOnce(async () => response()).mockImplementationOnce(async () => response(503));
    await syncReminders({ assignments: [item] }, 't', 'account', store, request as any, now);
    await store.write(`tactCompletion:${reminderKey('assignment', item)}`, true);
    expect((await syncReminders({ assignments: [item] }, 't', 'account', store, request as any, now)).errors).toHaveLength(1);
    expect((await syncReminders({ assignments: [] }, 't', 'account', store, request as any, now)).deleted).toBe(1);
    expect(request.mock.calls[1][0]).toBe(request.mock.calls[2][0]);
});
test('changed deadlines PATCH and deadlines outside seven days DELETE', async () => {
    const store = memory(), request = jest.fn(async (_url: string, _init?: RequestInit) => response());
    await syncReminders({ assignments: [item] }, 't', 'account', store, request as any, now);
    await syncReminders({ assignments: [{ ...item, dueTime: now + 2 * 86400 }] }, 't', 'account', store, request as any, now);
    expect(request.mock.calls[1][1]?.method).toBe('PATCH');
    await syncReminders({ assignments: [{ ...item, dueTime: now + 8 * 86400 }] }, 't', 'account', store, request as any, now);
    expect(request.mock.calls[2][1]?.method).toBe('DELETE');
});
test('failed creation retries the same persisted ID, and account mappings are separate', async () => {
    const store = memory(), request = jest.fn(async (_url: string, _init?: RequestInit) => response()).mockImplementationOnce(async () => response(503));
    await syncReminders({ assignments: [item] }, 't', 'first', store, request as any, now);
    await syncReminders({ assignments: [item] }, 't', 'first', store, request as any, now);
    expect(request.mock.calls[0][1]?.body).toBe(request.mock.calls[1][1]?.body);
    await syncReminders({ assignments: [item] }, 't', 'second', store, request as any, now);
    expect(request).toHaveBeenCalledTimes(3);
});
test.each([404, 410])('already deleted HTTP %s is success', async status => {
    const store = memory(), request = jest.fn(async (_url: string, _init?: RequestInit) => response()).mockImplementationOnce(async () => response()).mockImplementationOnce(async () => response(status));
    await syncReminders({ assignments: [item] }, 't', 'a', store, request as any, now);
    expect((await syncReminders({ assignments: [{ ...item, submitted: true }] }, 't', 'a', store, request as any, now)).deleted).toBe(1);
});
test('concurrent callers serialize and cannot create duplicates', async () => {
    const store = memory(), request = jest.fn(async (_url: string, _init?: RequestInit) => response());
    await Promise.all([syncReminders({ assignments: [item] }, 't', 'a', store, request as any, now), syncReminders({ assignments: [item] }, 't', 'a', store, request as any, now)]);
    expect(request).toHaveBeenCalledTimes(1);
});
