// Browser integration checks against controlled pages, not signed-in services.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
(async () => {
    const browser = await chromium.launch({ headless: true, ...(process.env.TACT_TEST_CHROMIUM ? { executablePath: process.env.TACT_TEST_CHROMIUM } : {}), args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote', '--single-process', '--use-gl=angle', '--use-angle=swiftshader', '--in-process-gpu'] });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(String(error)));
        await page.route('https://extension.test/**', async route => {
            const filename = new URL(route.request().url()).pathname.slice(1);
            const file = path.join(root, 'dist/source/chrome', filename);
            await route.fulfill({ body: fs.readFileSync(file), contentType: filename.endsWith('.js') ? 'application/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' });
        });
        await page.addInitScript(() => {
            window.test = { writes: [], downloads: [], permission: 'granted', fail: true, pickerCalls: 0, messages: [], courses: {} };
            function directory(name) {
                return { name, queryPermission: async () => window.test.permission, requestPermission: async () => { window.test.permission = 'granted'; return 'granted'; },
                    getDirectoryHandle: async part => directory(name + '/' + part),
                    getFileHandle: async filename => ({ createWritable: async () => ({ write: async blob => {
                        if (filename === 'exercise.pdf' && window.test.fail) throw new Error('mock write failure');
                        window.test.writes.push({ path: name + '/' + filename, data: await blob.text() });
                    }, close: async () => {}, abort: async () => {} }) }) };
            }
            window.showDirectoryPicker = async () => { window.test.pickerCalls++; return directory('授業資料'); };
            const db = { close() {}, transaction() {
                const tx = { objectStore() { return {
                    get(key) { const request = {}; setTimeout(() => { request.result = window.test.courses[key]; request.onsuccess(); }, 0); return request; },
                    put(value, key) { window.test.courses[key] = value; setTimeout(() => tx.oncomplete(), 0); }
                }; } }; return tx;
            } };
            Object.defineProperty(window, 'indexedDB', { value: { open() { const request = {}; setTimeout(() => { request.result = db; request.onsuccess(); }, 0); return request; } } });
            window.chrome = { runtime: { lastError: null, sendMessage(request, callback) { window.test.messages.push(request); callback({ success: true, message: 'ChatGPTに添付開始' }); } },
                storage: { local: { get(key, callback) { callback({ tactMaterialCourses: [{ id: 'c', name: '情報ネットワーク' }] }); }, set(value, callback) { if (callback) callback(); } } } };
            window.fetch = async url => {
                if (String(url).includes('/direct/content/resources/group/')) return new Response(JSON.stringify({ content_collection: [{ resourceId: '/group/c/', name: '授業', type: 'org.sakaiproject.content.types.folder', resourceChildren: [
                    { resourceId: '/group/c/week/', name: '第1回', type: 'org.sakaiproject.content.types.folder', resourceChildren: [
                        { resourceId: '/group/c/week/lecture.pdf', name: 'lecture.pdf', type: 'org.sakaiproject.content.types.fileUpload', url: 'https://tact.ac.thers.ac.jp/access/content/group/c/week/lecture.pdf', modified: 42, size: '20' },
                        { resourceId: '/group/c/week/exercise.pdf', name: 'exercise.pdf', type: 'org.sakaiproject.content.types.fileUpload', url: 'https://tact.ac.thers.ac.jp/access/content/group/c/week/exercise.pdf', modified: 42, size: '20' }
                    ] }
                ] }] }), { headers: { 'content-type': 'application/json' } });
                window.test.downloads.push(String(url)); return new Response('%PDF-mock', { headers: { 'content-type': 'application/pdf' } });
            };
        });
        await page.goto('https://extension.test/materials.html');
        await page.locator('#resources button').first().waitFor();
        await page.locator('#choose').click();
        await page.waitForFunction(() => !document.querySelector('#download').disabled);
        await page.locator('#download').click();
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('失敗 1件'));
        assert.equal(await page.evaluate(() => window.test.writes[0].path), '授業資料/第1回/lecture.pdf');
        assert.equal(await page.evaluate(() => !!window.test.courses.c.receipts['/group/c/week/exercise.pdf']), false);
        await page.evaluate(() => { window.test.fail = false; });
        await page.locator('#download').click();
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('取得済み 1件'));
        assert.equal(await page.evaluate(() => window.test.downloads.length), 3);
        await page.locator('#download').click();
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('取得済み 2件'));
        assert.equal(await page.evaluate(() => window.test.downloads.length), 3);
        await page.evaluate(() => { window.test.permission = 'prompt'; });
        await page.locator('#download').click();
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('権限が切れています'));
        await page.locator('#grant').click();
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('再許可できました'));
        assert.equal(await page.evaluate(() => window.test.pickerCalls), 1);
        await page.locator('#resources button').first().click();
        await page.waitForFunction(() => window.test.messages.length === 1);
        assert.equal(await page.evaluate(() => window.test.messages[0].action), 'prepareMaterialInChatGPT');
        if (process.env.TACT_TEST_SCREENSHOT) await page.screenshot({ path: process.env.TACT_TEST_SCREENSHOT, fullPage: true });
        console.log('PASS browser: nested downloads, failed-write retry, unchanged skip, permission recovery, ChatGPT button');
        const chat = await browser.newPage();
        await chat.setContent('<form><input type="file" multiple><textarea id="prompt-textarea"></textarea><button type="submit">Send</button></form>');
        await chat.evaluate(() => {
            window.sent = 0;
            document.querySelector('form').onsubmit = event => { event.preventDefault(); window.sent++; };
            window.chrome = { runtime: { id: 'test-extension', onMessage: { addListener(listener) { window.bridge = listener; } } } };
        });
        await chat.addScriptTag({ path: path.join(root, 'dist/source/chrome/chatgptBridge.js') });
        const dispatch = request => chat.evaluate(request => new Promise(resolve => window.bridge(request, { id: 'test-extension' }, resolve)), request);
        assert.equal((await dispatch({ action: 'tactChatGPTBegin', id: '1', filename: 'lecture.pdf', mime: 'application/pdf', prompt: 'この資料を解説してください' })).success, true);
        await dispatch({ action: 'tactChatGPTChunk', id: '1', chunk: Buffer.from('%PDF-mock').toString('base64') });
        assert.equal((await dispatch({ action: 'tactChatGPTFinish', id: '1' })).success, true);
        assert.equal(await chat.locator('#prompt-textarea').inputValue(), 'この資料を解説してください');
        assert.equal(await chat.evaluate(() => document.querySelector('input').files[0].name), 'lecture.pdf');
        assert.equal(await chat.evaluate(() => window.sent), 0);
        assert.equal((await dispatch({ action: 'tactChatGPTBegin', id: '2', filename: 'other.pdf' })).success, false);
        console.log('PASS browser: File/DataTransfer attachment, prompt input, no submission, existing draft preserved');
        await chat.setContent('<div id="prompt-textarea" contenteditable="true"></div><input type="file" multiple>');
        await dispatch({ action: 'tactChatGPTBegin', id: '3', filename: 'lecture.pdf', mime: 'application/pdf', prompt: 'contenteditable入力' });
        await dispatch({ action: 'tactChatGPTChunk', id: '3', chunk: Buffer.from('%PDF-mock').toString('base64') });
        assert.equal((await dispatch({ action: 'tactChatGPTFinish', id: '3' })).success, true);
        assert.equal(await chat.locator('#prompt-textarea').innerText(), 'contenteditable入力');
        assert.deepEqual(errors, []);
        console.log('PASS browser: contenteditable composer input; no page errors');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
