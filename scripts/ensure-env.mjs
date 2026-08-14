import { copyFileSync, existsSync } from 'node:fs';

if (!existsSync('.env')) {
  copyFileSync('env.example', '.env');
  console.log('created root .env from env.example');
}
