export const LEGACY_MATERIAL_PROMPT = 'この授業資料を、日本語で初学者にも分かるように詳しく解説してください。まず全体像を示し、重要な概念、専門用語の意味、理解に必要な前提知識、具体例の順に説明してください。資料にない内容を補う場合は、その旨を明示してください。コード例を示す場合は出力結果も教えてください。';
export const DEFAULT_MATERIAL_PROMPT = LEGACY_MATERIAL_PROMPT + '最後に、理解度を確認するテストを4問作成してください。問題を先にまとめて示し、その後に各問の正解と、なぜその答えになるのかを初学者にも分かるように詳しく解説してください。';
/** Upgrade the previous default while preserving user-written prompts. */
export function resolveMaterialPrompt(saved: unknown): string {
    return typeof saved === 'string' && saved.trim() && saved !== LEGACY_MATERIAL_PROMPT ? saved : DEFAULT_MATERIAL_PROMPT;
}
export function sendMaterialToChatGPT(url: string, filename: string): Promise<any> {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage({ action: 'prepareMaterialInChatGPT', url, filename }, response => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!response?.success) reject(new Error(response?.error || 'ChatGPTへ渡せませんでした'));
        else resolve(response);
    }));
}
/** Adds buttons beside native TACT resource links, including resources-tool frames. */
export function installMaterialChatGPTButtons(): void {
    let scheduled = false;
    function update() {
        scheduled = false;
        for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
            if (link.dataset.tactChatgpt || !link.textContent?.trim()) continue;
            let url: URL;
            try { url = new URL(link.href); } catch { continue; }
            if (url.origin !== 'https://tact.ac.thers.ac.jp' || !url.pathname.startsWith('/access/content/group/') || url.pathname.endsWith('/')) continue;
            const name = link.textContent.trim();
            link.dataset.tactChatgpt = 'true';
            const button = document.createElement('button');
            button.type = 'button'; button.textContent = 'ChatGPT';
            button.title = 'この資料を既存のChatGPTタブに添付し、解説用プロンプトを入力';
            button.style.cssText = 'margin-left:8px;padding:2px 8px;border:1px solid #b9c8d9;border-radius:5px;background:#eef5ff;color:#203a5f;font-size:12px;cursor:pointer';
            link.insertAdjacentElement('afterend', button);
            button.addEventListener('click', async event => {
                event.preventDefault(); event.stopPropagation(); button.disabled = true; button.textContent = '準備中…';
                try {
                    const response = await sendMaterialToChatGPT(url.href, name);
                    button.title = response.message || 'ChatGPTで添付・入力を確認して送信してください';
                    button.textContent = '準備済み';
                } catch (error) {
                    button.textContent = 'ChatGPT';
                    alert(`${String(error)}\n資料をダウンロードして手動で添付することもできます。`);
                } finally { button.disabled = false; }
            });
        }
    }
    update();
    new MutationObserver(() => {
        if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
    }).observe(document.documentElement, { childList: true, subtree: true });
}
