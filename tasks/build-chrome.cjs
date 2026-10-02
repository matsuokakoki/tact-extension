const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
process.env.NODE_ENV = 'production';
const browser = process.argv[2] || 'chrome';
if (!['chrome', 'edge'].includes(browser)) throw new Error('Unsupported browser');
const project = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(project, 'dist/release'), { recursive: true });
for (const args of [[require.resolve('webpack-cli/bin/cli.js'), '--config', `tasks/webpack.config.${browser}.js`], ['tasks/release.js', browser]]) {
    const result = spawnSync(process.execPath, args, { cwd: project, env: process.env, stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status || 1);
}
