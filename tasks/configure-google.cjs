const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const manifestPath = path.resolve(__dirname, '../manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.key) {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    manifest.key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}
const arg = process.argv[2];
if (arg && arg !== '--id') {
    if (!/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(arg)) throw new Error('Google OAuthクライアントIDを指定してください');
    manifest.oauth2 = { client_id: arg, scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'] };
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const id = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, c => String.fromCharCode(97 + parseInt(c, 16)));
console.log('拡張機能ID: ' + id);
console.log(manifest.oauth2 ? 'Google OAuth設定済み。npm run build:chrome を実行し、拡張機能を再読み込みしてください。' : 'Google Cloudで「Chrome拡張機能」のOAuthクライアントをこのIDで作成してください。');
