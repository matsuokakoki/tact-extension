import { planFiles, safeSegment, needsDownload } from '../features/materialDownload/plan';
const file = { id: '/group/c/week1/a.pdf', title: 'a.pdf', type: 'resource', container: '/group/c/week1/', url: '/access/content/group/c/week1/a.pdf', modifiedTime: 1, size: 20 };
test('reproduces nested folders without the Sakai group prefix', () => {
    const { files } = planFiles([{ ...file, container: '/group/c/week1/sample/' }], 'c');
    expect(files[0].path).toEqual(['week1', 'sample', 'a.pdf']);
});
test('uses folder display names and handles encoded Japanese paths', () => {
    const { files } = planFiles([{ id: '/group/c/week1/', title: '第1回', type: 'collection' }, file], 'c');
    expect(files[0].path).toEqual(['第1回', 'a.pdf']);
});
test('unchanged files skip; timestamp, size and path changes download again', () => {
    const planned = planFiles([file], 'c').files[0];
    const receipt = { fingerprint: planned.fingerprint, path: planned.path.join('/') };
    expect(needsDownload(planned)).toBe(true);
    expect(needsDownload(planned, receipt)).toBe(false);
    for (const changed of [{ modifiedTime: 2 }, { size: 21 }, { title: 'b.pdf' }]) {
        expect(needsDownload(planFiles([{ ...file, ...changed }], 'c').files[0], receipt)).toBe(true);
    }
});
test('external URLs and web links are counted and skipped', () => {
    expect(planFiles([{ ...file, url: 'https://evil.example/a.pdf' }, { ...file, type: 'url' }], 'c')).toEqual({ files: [], skipped: 2 });
});
test('Windows reserved names and traversal segments cannot escape the destination', () => {
    for (const segment of ['..', '.', 'CON', 'a/b', 'a\\b', 'NUL.txt', 'x:?', 'trailing.']) {
        const safe = safeSegment(segment);
        expect(safe).not.toMatch(/[<>:"/\\|?*]/);
        expect(safe).not.toBe('..');
        expect(safe).not.toMatch(/[. ]$/);
    }
});
test('case-insensitive file collisions do not overwrite one another', () => {
    const files = planFiles([file, { ...file, id: 'b', title: 'A.PDF' }], 'c').files;
    expect(new Set(files.map(f => f.path.join('/').toLowerCase())).size).toBe(2);
});
test('foreign course paths fail before writing', () => {
    expect(() => planFiles([{ ...file, container: '/group/other/' }], 'c')).toThrow();
});
test('official recursive Sakai payload keeps folders, modified time and filename extension', () => {
    const { flattenResources } = require('../features/materialDownload/plan');
    const tree = [{ resourceId: '/group/c/', name: '授業', type: 'org.sakaiproject.content.types.folder', resourceChildren: [
        { resourceId: '/group/c/week/', name: '第1回', type: 'org.sakaiproject.content.types.folder', resourceChildren: [
            { resourceId: '/group/c/week/a.pdf', name: '講義資料', type: 'org.sakaiproject.content.types.fileUpload', url: '/access/content/group/c/week/a.pdf', modified: 42, size: '123' }
        ] }
    ] }];
    const files = planFiles(flattenResources(tree), 'c').files;
    expect(files).toHaveLength(1);
    expect(files[0].path).toEqual(['第1回', '講義資料.pdf']);
    expect(files[0].fingerprint).toContain('42');
});
test('collision paths are stable when the API list is reordered', () => {
    const second = { ...file, id: 'b', title: 'A.PDF' };
    const paths = (items: any[]) => Object.fromEntries(planFiles(items, 'c').files.map(file => [file.id, file.path]));
    expect(paths([file, second])).toEqual(paths([second, file]));
});
test('case-colliding folder display names remain separate', () => {
    const { files } = planFiles([
        { id: '/group/c/week1/', title: 'Slides', type: 'collection' },
        { id: '/group/c/week2/', title: 'slides', type: 'collection' },
        file, { ...file, id: 'other', container: '/group/c/week2/' }
    ], 'c');
    expect(files[0].path[0].toLowerCase()).not.toEqual(files[1].path[0].toLowerCase());
});
test('flat layout saves files together and distinguishes duplicate names across folders', () => {
    const other = { ...file, id: '/group/c/week2/a.pdf', container: '/group/c/week2/' };
    const paths = (items: any[]) => Object.fromEntries(planFiles(items, 'c', 'flat').files.map(item => [item.id, item.path]));
    const result = paths([file, other]);
    expect(result).toEqual(paths([other, file]));
    expect(Object.values(result).every((path: any) => path.length === 1)).toBe(true);
    expect(new Set(Object.values(result).map((path: any) => path[0].toLowerCase())).size).toBe(2);
});
test('changing layout downloads files to their new paths', () => {
    const folders = planFiles([file], 'c').files[0];
    const flat = planFiles([file], 'c', 'flat').files[0];
    expect(flat.path).toEqual(['a.pdf']);
    expect(needsDownload(flat, { fingerprint: folders.fingerprint, path: folders.path.join('/') })).toBe(true);
});
