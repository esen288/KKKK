import {defineConfig} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
export default defineConfig({testDir:'./test',testMatch:'browser.spec.js',workers:1,use:{baseURL:'http://127.0.0.1:3199',launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']}},webServer:{command:'node server.js',url:'http://127.0.0.1:3199',reuseExistingServer:false,env:{PORT:'3199',HOST:'127.0.0.1',DATA_DIR:mkdtempSync(path.join(tmpdir(),'novax-browser-')),ADMIN_PASSWORD:'browser-test-password-2026',NODE_ENV:'test',COOKIE_SECURE:'false'}},reporter:'list'});
