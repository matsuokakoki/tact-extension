import { validateMaterialUrl } from '../features/chatgptTransfer';
test('ChatGPT bridge only fetches actual TACT course resources', () => {
    expect(validateMaterialUrl('https://tact.ac.thers.ac.jp/access/content/group/c/a.pdf').hostname).toBe('tact.ac.thers.ac.jp');
    for (const url of ['https://evil.example/a.pdf', 'http://tact.ac.thers.ac.jp/access/content/group/c/a.pdf', 'https://tact.ac.thers.ac.jp/direct/assignment/site/c.json', 'https://tact.ac.thers.ac.jp/access/content/group/c/']) {
        expect(() => validateMaterialUrl(url)).toThrow();
    }
});
