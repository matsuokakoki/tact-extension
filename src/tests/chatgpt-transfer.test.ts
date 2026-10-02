import { validateMaterialUrl } from '../features/chatgptTransfer';
test('ChatGPT bridge only fetches actual TACT course resources', () => {
    expect(validateMaterialUrl('https://tact.ac.thers.ac.jp/access/content/group/c/a.pdf').hostname).toBe('tact.ac.thers.ac.jp');
    for (const url of ['https://evil.example/a.pdf', 'http://tact.ac.thers.ac.jp/access/content/group/c/a.pdf', 'https://tact.ac.thers.ac.jp/direct/assignment/site/c.json', 'https://tact.ac.thers.ac.jp/access/content/group/c/']) {
        expect(() => validateMaterialUrl(url)).toThrow();
    }
});

import { DEFAULT_MATERIAL_PROMPT, LEGACY_MATERIAL_PROMPT, resolveMaterialPrompt } from '../features/chatgpt';
test('previous saved default upgrades to the prompt with four comprehension questions and explanations', () => {
    expect(resolveMaterialPrompt(LEGACY_MATERIAL_PROMPT)).toBe(DEFAULT_MATERIAL_PROMPT);
    expect(resolveMaterialPrompt(undefined)).toBe(DEFAULT_MATERIAL_PROMPT);
    expect(DEFAULT_MATERIAL_PROMPT).toContain('テストを4問');
    expect(DEFAULT_MATERIAL_PROMPT).toContain('各問の正解');
});
test('a user-written prompt survives the default prompt update', () => {
    expect(resolveMaterialPrompt('自分用のプロンプト')).toBe('自分用のプロンプト');
    expect(resolveMaterialPrompt('   ')).toBe(DEFAULT_MATERIAL_PROMPT);
});
