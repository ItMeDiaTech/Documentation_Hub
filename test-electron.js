"use strict";

// Check what require.resolve returns for 'electron'
console.log('Checking module resolution...');
console.log('require.resolve("electron"):', require.resolve('electron'));

// This is how you should access electron APIs inside Electron
const { app, BrowserWindow } = require('electron');
console.log('app type:', typeof app);
console.log('app object:', app);

if (app) {
    console.log('SUCCESS: app exists');
    console.log('app.getVersion():', app.getVersion());
    app.on('ready', () => {
        console.log('App is ready!');
        app.quit();
    });
} else {
    console.log('FAIL: app is undefined');
    process.exit(1);
}
