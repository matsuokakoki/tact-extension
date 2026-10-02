/** ChatGPT DOM adapter. Prepares an attachment and prompt; never presses Send. */
export function findComposer(root: ParentNode = document): HTMLElement | null {
    return root.querySelector<HTMLElement>('#prompt-textarea[contenteditable="true"], textarea#prompt-textarea, textarea[aria-label="Chat with ChatGPT"], [role="textbox"][contenteditable="true"]');
}
function composerText(composer: HTMLElement): string {
    return composer instanceof HTMLTextAreaElement ? composer.value : composer.textContent || '';
}
export function fillComposer(composer: HTMLElement, text: string): void {
    if (composerText(composer).trim()) throw new Error('ChatGPTに入力中の文章があります。送信または削除してから再試行してください。');
    composer.focus();
    if (composer instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setter) throw new Error('入力欄を更新できません');
        setter.call(composer, text);
        composer.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
        const inserted = document.execCommand('insertText', false, text);
        if (!inserted || !composerText(composer).includes(text)) {
            throw new Error('入力欄へ自動入力できません。表示されたプロンプトをコピーして貼り付けてください。');
        }
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }
}
function notice(message: string, prompt?: string) {
    document.getElementById('tact-chatgpt-notice')?.remove();
    const panel = document.createElement('section'); panel.id = 'tact-chatgpt-notice';
    panel.style.cssText = 'position:fixed;bottom:24px;right:24px;max-width:460px;padding:18px;background:#f3f7ff;color:#18304f;border:1px solid #afbed7;border-radius:12px;z-index:2147483647;font:14px/1.7 system-ui;box-shadow:0 6px 25px #0003';
    const text = document.createElement('p'); text.textContent = message; panel.appendChild(text);
    if (prompt) {
        const copy = document.createElement('button'); copy.textContent = 'プロンプトをコピー';
        copy.onclick = () => { void navigator.clipboard.writeText(prompt).then(() => { copy.textContent = 'コピーしました'; }); };
        panel.appendChild(copy);
    }
    const close = document.createElement('button'); close.textContent = '閉じる'; close.style.marginLeft = '12px'; close.onclick = () => panel.remove(); panel.appendChild(close);
    document.body.appendChild(panel);
}
interface Transfer { id: string; filename: string; mime: string; prompt: string; chunks: Uint8Array[]; size: number; url: string; }
let transfer: Transfer | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
function clearTransfer() { transfer = null; if (expiry) clearTimeout(expiry); }
chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !String(request.action).startsWith('tactChatGPT')) return false;
    try {
        if (request.action === 'tactChatGPTReady') { respond({ success: true, ready: !!findComposer() }); return false; }
        if (request.action === 'tactChatGPTBegin') {
            const composer = findComposer();
            if (!composer) throw new Error('ChatGPTへログインし、入力欄を表示してから再試行してください。');
            if (composerText(composer).trim()) throw new Error('ChatGPTの入力中の文章を送信または削除してから再試行してください。');
            if (transfer) throw new Error('別の資料を処理中です。少し待って再試行してください。');
            transfer = { id: request.id, filename: request.filename, mime: request.mime, prompt: request.prompt, chunks: [], size: 0, url: location.href };
            expiry = setTimeout(clearTransfer, 60000);
        } else if (request.action === 'tactChatGPTChunk') {
            if (!transfer || transfer.id !== request.id) throw new Error('資料転送が中断されました。再試行してください。');
            const binary = atob(request.chunk);
            const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
            transfer.size += bytes.length;
            if (transfer.size > 32 * 1024 * 1024) { clearTransfer(); throw new Error('32MBを超える資料は手動で添付してください。'); }
            transfer.chunks.push(bytes);
        } else if (request.action === 'tactChatGPTFinish') {
            if (!transfer || transfer.id !== request.id) throw new Error('資料転送が中断されました');
            const received = transfer;
            clearTransfer();
            if (location.href !== received.url) throw new Error('ChatGPTの会話が変更されました。再試行してください。');
            const composer = findComposer();
            if (!composer || composerText(composer).trim()) throw new Error('ChatGPTの入力欄が変更されました。資料の自動添付を中止しました。');
            const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]') || document.querySelector<HTMLInputElement>('input[type="file"]');
            if (!input) {
                notice('ファイル入力欄が見つかりません。ChatGPTの「＋」からファイル添付を一度開き、TACTから再試行してください。', received.prompt);
                throw new Error('ChatGPTの「＋」から添付メニューを開いて再試行してください。');
            }
            const file = new File(received.chunks, received.filename, { type: received.mime });
            const data = new DataTransfer(); data.items.add(file);
            input.files = data.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            try { fillComposer(composer, received.prompt); }
            catch (error) {
                notice(`${String(error)} 資料の添付は開始しています。`, received.prompt);
                respond({ success: true, message: '添付開始。プロンプトはChatGPT画面からコピーして手動入力してください。' });
                return false;
            }
            document.getElementById('tact-chatgpt-notice')?.remove();
            respond({ success: true, message: '添付・プロンプト入力済み' });
            return false;
        } else if (request.action === 'tactChatGPTCancel') { clearTransfer(); }
        respond({ success: true });
    } catch (error) { respond({ success: false, error: String(error) }); }
    return false;
});
