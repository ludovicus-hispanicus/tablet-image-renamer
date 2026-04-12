console.log('electron module:', typeof require('electron'));
console.log('keys:', Object.keys(require('electron')));
const e = require('electron');
console.log('app:', typeof e.app);
console.log('BrowserWindow:', typeof e.BrowserWindow);
process.exit(0);
