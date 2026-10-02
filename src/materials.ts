import { DEFAULT_MATERIAL_PROMPT, resolveMaterialPrompt, sendMaterialToChatGPT } from './features/chatgpt';
import { planFiles, needsDownload, Resource, flattenResources } from './features/materialDownload/plan';
import { CourseDownloadState, DirectoryHandle, readCourse, writeCourse } from './features/materialDownload/storage';
const promptBox = document.querySelector('#prompt') as HTMLTextAreaElement;
const resourcesList = document.querySelector('#resources') as HTMLElement;
promptBox.value = DEFAULT_MATERIAL_PROMPT;
chrome.storage.local.get('tactMaterialPrompt', data => { promptBox.value = resolveMaterialPrompt(data.tactMaterialPrompt); });
promptBox.addEventListener('change', () => chrome.storage.local.set({ tactMaterialPrompt: promptBox.value }));
const select = document.querySelector('#course') as HTMLSelectElement;
const choose = document.querySelector('#choose') as HTMLButtonElement;
const grant = document.querySelector('#grant') as HTMLButtonElement;
const download = document.querySelector('#download') as HTMLButtonElement;
const status = document.querySelector('#status') as HTMLElement;
const destination = document.querySelector('#destination') as HTMLElement;
const details = document.querySelector('#details') as HTMLElement;
let state: CourseDownloadState = { receipts: {} };
let loadedCourse = '';
let busy = false;
function report(error: unknown) { status.textContent = error instanceof Error ? error.message : String(error); }
function controls(value: boolean) {
    busy = value;
    select.disabled = choose.disabled = grant.disabled = value;
    download.disabled = value || !state.handle || loadedCourse !== select.value;
}
async function load() {
    controls(true);
    try {
        state = await readCourse(select.value);
        loadedCourse = select.value;
        destination.textContent = state.handle ? `保存先: ${state.handle.name}（このフォルダ直下へ保存）` : '保存先未設定: OneDrive内の「授業資料」フォルダなどを選んでください。';
        status.textContent = state.lastDownload ? `前回取得: ${new Date(state.lastDownload).toLocaleString('ja-JP')}` : '初回は全資料、次回からは新規・更新分のみを取得します。';
        grant.hidden = !state.handle;
        await listResources(select.value);
    } catch (error) { loadedCourse = ''; report(error); }
    finally { controls(false); }
}
select.addEventListener('change', () => { details.replaceChildren(); void load(); });
choose.addEventListener('click', async () => {
    if (busy) return;
    const picker = (window as any).showDirectoryPicker;
    if (!picker) { report('このブラウザはフォルダ選択に対応していません。PC版Chromeで開いてください。'); return; }
    // Invoke directly within the click: user activation must not be lost to storage/network awaits.
    const selection = picker({ id: 'tact-materials', mode: 'readwrite' });
    controls(true);
    try {
        const handle: DirectoryHandle = await selection;
        state = { handle, receipts: {} }; // Different destination needs a full first download.
        await writeCourse(select.value, state);
        await load();
    } catch (error) { report(error); }
    finally { controls(false); }
});
grant.addEventListener('click', async () => {
    if (!state.handle || busy) return;
    const permission = state.handle.requestPermission({ mode: 'readwrite' });
    controls(true);
    try { status.textContent = await permission === 'granted' ? '再許可できました。「資料を取得」を押してください。' : '許可されませんでした。「保存先を選ぶ」で手動で選び直せます。'; }
    catch (error) { report(error); }
    finally { controls(false); }
});
async function fetchResources(courseId: string): Promise<Resource[]> {
    const response = await fetch(`https://tact.ac.thers.ac.jp/direct/content/resources/group/${encodeURIComponent(courseId)}.json?depth=all`, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) throw new Error(`資料一覧取得失敗 HTTP ${response.status}。TACTにログインしてから再試行してください。`);
    let data;
    try { data = await response.json(); } catch { throw new Error('資料一覧を取得できません。TACTに再ログインしてください。'); }
    if (!Array.isArray(data.content_collection)) throw new Error('資料一覧の形式が不明です。取得済み履歴は変更していません。');
    return flattenResources(data.content_collection);
}
async function listResources(courseId: string) {
    resourcesList.replaceChildren();
    try {
        const { files } = planFiles(await fetchResources(courseId), courseId);
        for (const file of files) {
            const row = document.createElement('li');
            const title = document.createElement('a'); title.href = file.url; title.textContent = file.path.join('/'); title.target = '_blank'; title.rel = 'noopener';
            const button = document.createElement('button'); button.textContent = 'ChatGPT'; button.style.marginLeft = '12px';
            button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                    await new Promise<void>((resolve, reject) => chrome.storage.local.set({ tactMaterialPrompt: promptBox.value }, () => {
                        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve();
                    }));
                    const result = await sendMaterialToChatGPT(file.url, file.path[file.path.length - 1]);
                    status.textContent = result.message;
                } catch (error) { report(error); }
                finally { button.disabled = false; }
            });
            row.append(title, button); resourcesList.appendChild(row);
        }
    } catch (error) { report(error); }
}
download.addEventListener('click', async () => {
    if (busy || !state.handle) return;
    controls(true);
    details.replaceChildren();
    try {
        if (await state.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
            throw new Error('保存先の権限が切れています。「このフォルダを再許可」を押してください。失敗したら「保存先を選ぶ」で選び直せます。');
        }
        const courseId = select.value;
        const job = async () => {
            // Another tab may have completed the same course while this tab was open.
            state = await readCourse(courseId);
            const handle = state.handle!;
            status.textContent = '資料一覧を取得中…';
            const { files, skipped } = planFiles(await fetchResources(courseId), courseId);
            let added = 0, updated = 0, unchanged = 0, failed = 0;
            for (const file of files) {
                if (!needsDownload(file, state.receipts[file.id])) { unchanged++; continue; }
                const row = document.createElement('li');
                const previous = state.receipts[file.id];
                status.textContent = `取得中: ${file.path.join('/')}`;
                try {
                    const response = await fetch(file.url, { credentials: 'include', cache: 'no-store' });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    // Authentication redirects must never be written over a real course file.
                    const finalUrl = new URL(response.url || file.url);
                    if (finalUrl.origin !== 'https://tact.ac.thers.ac.jp' || /\/(?:portal\/login|login|auth)(?:\/|$)/.test(finalUrl.pathname)) throw new Error('ログイン画面へ移動しました');
                    const blob = await response.blob();
                    let directory = handle;
                    for (const part of file.path.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create: true });
                    const target = await directory.getFileHandle(file.path[file.path.length - 1], { create: true });
                    const writer = await target.createWritable();
                    try { await writer.write(blob); await writer.close(); }
                    catch (error) { await writer.abort().catch(() => undefined); throw error; }
                    state.receipts[file.id] = { fingerprint: file.fingerprint, path: file.path.join('/') };
                    state.lastDownload = Date.now();
                    // Mark complete only after both write and close succeed; checkpoint each file.
                    await writeCourse(courseId, state);
                    if (previous) updated++; else added++;
                    row.textContent = `${previous ? '更新' : '新規'}: ${file.path.join('/')}`;
                } catch (error) {
                    failed++;
                    row.textContent = `失敗: ${file.path.join('/')} — ${String(error)}（再試行可能）`;
                }
                details.appendChild(row);
            }
            status.textContent = `完了: 新規 ${added}件・更新 ${updated}件・取得済み ${unchanged}件・失敗 ${failed}件・外部リンク等 ${skipped}件`;
        };
        // Serialize per course across tabs to avoid overwrites and lost receipts.
        await (navigator as any).locks.request(`tact-download:${courseId}`, job);
    } catch (error) { report(error); }
    finally { controls(false); }
});
chrome.storage.local.get('tactMaterialCourses', data => {
    if (chrome.runtime.lastError) { report(chrome.runtime.lastError.message); return; }
    for (const course of data.tactMaterialCourses || []) {
        const option = document.createElement('option');
        option.value = course.id; option.textContent = course.name; select.appendChild(option);
    }
    const courseId = new URL(location.href).searchParams.get('course');
    if (courseId && Array.from(select.options).some(option => option.value === courseId)) select.value = courseId;
    if (!select.value) { report('TACTの授業ページから「資料を取得」を開いてください。'); return; }
    void load();
});
