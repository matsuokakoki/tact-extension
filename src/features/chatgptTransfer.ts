import { resolveMaterialPrompt } from './chatgpt';
export function validateMaterialUrl(raw: string): URL {
    const url = new URL(raw);
    if (url.origin !== 'https://tact.ac.thers.ac.jp' || !url.pathname.startsWith('/access/content/group/') || url.pathname.endsWith('/')) throw new Error('TACTの授業資料URLではありません');
    return url;
}
async function message(tabId: number, request: any): Promise<any> {
    return new Promise((resolve, reject) => chrome.tabs.sendMessage(tabId, request, response => {
        if (chrome.runtime.lastError) reject(new Error('ChatGPTタブを再読み込みしてください: ' + chrome.runtime.lastError.message));
        else if (!response?.success) reject(new Error(response?.error || 'ChatGPTが応答しません'));
        else resolve(response);
    }));
}
let transferring = false;
export async function prepareMaterial(rawUrl: string, name: string): Promise<any> {
    if (transferring) throw new Error('別の資料を処理中です。少し待って再試行してください。');
    const url = validateMaterialUrl(rawUrl);
    transferring = true;
    let targetId: number | undefined;
    const id = crypto.randomUUID();
    try {
        const tabs = await new Promise<chrome.tabs.Tab[]>(resolve => chrome.tabs.query({ url: 'https://chatgpt.com/*' }, resolve));
        tabs.sort((a, b) => ((b as any).lastAccessed || 0) - ((a as any).lastAccessed || 0));
        const tab = tabs.find(tab => tab.active) || tabs[0];
        if (!tab?.id) {
            await new Promise<void>(resolve => chrome.tabs.create({ url: 'https://chatgpt.com/' }, () => resolve()));
            throw new Error('ChatGPTタブを開きました。ログイン・読み込みが完了したら、もう一度[ChatGPT]を押してください。');
        }
        targetId = tab.id;
        await new Promise<void>(resolve => chrome.tabs.update(targetId!, { active: true }, () => resolve()));
        if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true });
        const ready = await message(targetId, { action: 'tactChatGPTReady' });
        if (!ready.ready) throw new Error('ChatGPTへログインし、入力欄を表示してください。');
        const response = await fetch(url.href, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error(`資料取得失敗 HTTP ${response.status}`);
        validateMaterialUrl(response.url || url.href);
        const length = Number(response.headers.get('content-length'));
        if (length > 32 * 1024 * 1024) throw new Error('32MBを超える資料はダウンロードして手動で添付してください。');
        const stored = await new Promise<any>(resolve => chrome.storage.local.get('tactMaterialPrompt', resolve));
        const prompt = resolveMaterialPrompt(stored.tactMaterialPrompt);
        let filename = name || decodeURIComponent(url.pathname.split('/').pop() || 'material.pdf');
        // Preserve the actual file extension when TACT's display title has none.
        const sourceName = decodeURIComponent(url.pathname.split('/').pop() || '');
        const extension = sourceName.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0];
        if (extension && !filename.toLowerCase().endsWith(extension.toLowerCase())) filename += extension;
        await message(targetId, { action: 'tactChatGPTBegin', id, filename, mime: response.headers.get('content-type') || 'application/octet-stream', prompt });
        if (!response.body) throw new Error('資料の読み込みに失敗しました');
        const reader = response.body.getReader();
        let total = 0;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                if (!value) continue;
                total += value.byteLength;
                if (total > 32 * 1024 * 1024) throw new Error('32MBを超える資料は手動で添付してください。');
                for (let start = 0; start < value.length; start += 128 * 1024) {
                    const chunk = value.subarray(start, start + 128 * 1024);
                    let binary = '';
                    for (let offset = 0; offset < chunk.length; offset += 8192) binary += String.fromCharCode(...Array.from(chunk.subarray(offset, offset + 8192)));
                    await message(targetId, { action: 'tactChatGPTChunk', id, chunk: btoa(binary) });
                }
            }
        } finally { await reader.cancel().catch(() => undefined); }
        return await message(targetId, { action: 'tactChatGPTFinish', id });
    } catch (error) {
        if (targetId) await message(targetId, { action: 'tactChatGPTCancel', id }).catch(() => undefined);
        throw error;
    } finally { transferring = false; }
}
