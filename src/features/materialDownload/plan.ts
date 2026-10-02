export interface Resource {
    id?: string; resourceId?: string; title?: string; name?: string; type?: string;
    container?: string; url?: string; modifiedTime?: unknown; modifiedDate?: unknown; modified?: unknown; createdTime?: unknown; size?: unknown; mimeType?: string; webLinkUrl?: string; hidden?: boolean; isVisible?: boolean; resourceChildren?: Resource[];
}
export interface DownloadFile { id: string; url: string; path: string[]; fingerprint: string; }
export interface Receipt { fingerprint: string; path: string; }
function hash(value: string): string {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16);
}
export function safeSegment(raw: string): string {
    let name = raw.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
    if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    name = name.slice(0, 150);
    return name !== raw ? `${name}~${hash(raw)}` : name;
}
export function isFolder(item: Resource): boolean {
    return item.type === 'collection' || item.type === 'folder' || !!item.type?.endsWith('.folder') || !!item.resourceId?.endsWith('/');
}
function decode(value: string): string { try { return decodeURIComponent(value); } catch { return value; } }
export function planFiles(items: Resource[], courseId: string): { files: DownloadFile[]; skipped: number } {
    const files: DownloadFile[] = [];
    let skipped = 0;
    const directoryLabels = new Map<string, string>();
    const directoryBuckets = new Map<string, string[]>();
    const fileBuckets = new Map<string, DownloadFile[]>();
    const folderNames = new Map<string, string>();
    for (const item of items) {
        if (isFolder(item)) {
            const id = item.resourceId || item.id || (item.url ? new URL(item.url, 'https://tact.ac.thers.ac.jp').pathname.replace(/^\/access\/content/, '') : undefined);
            if (id) folderNames.set(decode(id).replace(/^\/content/, '').replace(/\/$/, ''), item.title || item.name || decode(id).split('/').filter(Boolean).pop()!);
        }
    }
    // Resolve folder name collisions independently of API listing order.
    for (const item of items) {
        let parent = `/group/${courseId}`;
        const container = decode(item.container || '/').replace(/^\/content/, '');
        const relative = container.startsWith(parent + '/') ? container.slice(parent.length + 1) : container;
        for (const part of relative.split('/').filter(Boolean)) {
            const prefix = parent + '/' + part;
            if (!directoryLabels.has(prefix)) {
                const label = safeSegment(folderNames.get(prefix) || part);
                directoryLabels.set(prefix, label);
                const bucket = parent + ':' + label.toLocaleLowerCase('en-US');
                directoryBuckets.set(bucket, [...(directoryBuckets.get(bucket) || []), prefix]);
            }
            parent = prefix;
        }
    }
    for (const bucket of directoryBuckets.values()) {
        if (bucket.length > 1) for (const prefix of bucket) directoryLabels.set(prefix, `${directoryLabels.get(prefix)}~${hash(prefix)}`);
    }
    for (const item of items) {
        if (isFolder(item)) continue;
        if (!item.url || item.type === 'url' || item.type === 'text/url' || item.mimeType === 'text/url' || !!item.webLinkUrl || item.hidden === true || item.isVisible === false) { skipped++; continue; }
        const url = new URL(item.url, 'https://tact.ac.thers.ac.jp');
        if (url.origin !== 'https://tact.ac.thers.ac.jp') { skipped++; continue; }
        const id = item.resourceId || item.id || url.pathname;
        const root = `/group/${courseId}/`;
        const container = decode(item.container || '/').replace(/^\/content/, '');
        let relative = container;
        if (container.startsWith(root)) relative = container.slice(root.length);
        else if (container.startsWith('/group/')) throw new Error('科目と資料のフォルダが一致しません');
        const rawParts = relative.split('/').filter(Boolean);
        let parent = root.replace(/\/$/, '');
        const path = rawParts.map(part => {
            parent += '/' + part;
            return directoryLabels.get(parent) || safeSegment(part);
        });
        let filename = item.title || item.name || decode(url.pathname.split('/').pop() || 'file');
        const extension = decode(url.pathname.split('/').pop() || '').match(/\.[a-zA-Z0-9]{1,8}$/)?.[0];
        if (extension && !filename.toLowerCase().endsWith(extension.toLowerCase())) filename += extension;
        path.push(safeSegment(filename));
        const planned = { id, url: url.href, path, fingerprint: '' };
        files.push(planned);
        const bucket = path.join('/').toLocaleLowerCase('en-US');
        fileBuckets.set(bucket, [...(fileBuckets.get(bucket) || []), planned]);
    }
    for (const bucket of fileBuckets.values()) {
        if (bucket.length > 1) for (const file of bucket) {
            const last = file.path.pop()!;
            const dot = last.lastIndexOf('.');
            file.path.push(dot > 0 ? `${last.slice(0, dot)}~${hash(file.id)}${last.slice(dot)}` : `${last}~${hash(file.id)}`);
        }
    }
    const paths = new Set<string>();
    for (const file of files) {
        const normalized = file.path.join('/').toLocaleLowerCase('en-US');
        if (paths.has(normalized)) throw new Error('同じ保存パスを持つ資料があります');
        paths.add(normalized);
        const item = items.find(item => (item.resourceId || item.id || new URL(item.url || '/', 'https://tact.ac.thers.ac.jp').pathname) === file.id)!;
        file.fingerprint = JSON.stringify([item.modifiedTime || item.modifiedDate || item.modified || item.createdTime || null, item.size ?? null, file.url, file.path]);
    }
    return { files, skipped };
}
export function needsDownload(file: DownloadFile, receipt?: Receipt): boolean {
    return !receipt || receipt.fingerprint !== file.fingerprint || receipt.path !== file.path.join('/');
}

/** Flatten Sakai's recursive resources response; preserve folder display names. */
export function flattenResources(roots: Resource[]): Resource[] {
    const result: Resource[] = [];
    function visit(item: Resource, parent: string) {
        const id = item.resourceId || item.id || '';
        const folder = isFolder(item);
        result.push({ ...item, container: item.container || parent });
        for (const child of item.resourceChildren || []) visit(child, folder ? id : parent);
    }
    for (const root of roots) visit(root, '/');
    return result;
}
