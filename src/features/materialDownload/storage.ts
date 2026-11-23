import { Receipt, SaveLayout } from './plan';
export interface DirectoryHandle {
    name: string;
    queryPermission(options: { mode: 'readwrite' }): Promise<string>;
    requestPermission(options: { mode: 'readwrite' }): Promise<string>;
    getDirectoryHandle(name: string, options: { create: boolean }): Promise<DirectoryHandle>;
    getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }>;
}
export interface CourseDownloadState { handle?: DirectoryHandle; layout?: SaveLayout; receipts: Record<string, Receipt>; lastDownload?: number; }
async function database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('tact-material-download-v1', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('courses');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
export async function readCourse(id: string): Promise<CourseDownloadState> {
    const db = await database();
    try {
        return await new Promise((resolve, reject) => {
            const request = db.transaction('courses').objectStore('courses').get(id);
            request.onsuccess = () => resolve(request.result || { receipts: {} });
            request.onerror = () => reject(request.error);
        });
    } finally { db.close(); }
}
export async function writeCourse(id: string, state: CourseDownloadState): Promise<void> {
    const db = await database();
    try {
        await new Promise<void>((resolve, reject) => {
            const transaction = db.transaction('courses', 'readwrite');
            transaction.objectStore('courses').put(state, id);
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error('保存が中断されました'));
        });
    } finally { db.close(); }
}
