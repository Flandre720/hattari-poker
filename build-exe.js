/**
 * はったりポーカー — exe ビルドスクリプト
 * 
 * 使用方法:
 *   node build-exe.js          — フル: フロントビルド → サーバーバンドル → exe生成 → cloudflaredダウンロード
 *   node build-exe.js bundle   — サーバーバンドルのみ
 *   node build-exe.js --force  — フル（cloudflared再ダウンロード強制）
 */

import { execSync } from 'child_process';
import { build } from 'esbuild';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const mode = args.find(a => !a.startsWith('-'));   // 'bundle' or undefined
const forceDownload = args.includes('--force');

const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const CLOUDFLARED_DEST = path.join(__dirname, 'release', 'cloudflared.exe');

function run(cmd, label) {
  console.log(`\n🔨 ${label}...`);
  execSync(cmd, { stdio: 'inherit', cwd: __dirname });
}

async function bundleServer() {
  console.log('\n🔨 サーバーをバンドル中...');
  await build({
    entryPoints: ['server/server.ts'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: 'server-bundle.cjs',
    external: [],
    // shared/types.ts も含める
    define: {
      'import.meta.url': 'import_meta_url',
    },
    banner: {
      js: `
        const import_meta_url = require('url').pathToFileURL(__filename).href;
      `,
    },
  });
  console.log('✅ server-bundle.cjs 生成完了');
}

/**
 * cloudflared.exe を GitHub Releases からダウンロード
 * - リダイレクト追従（GitHub は 302 を返す）
 * - 既存ファイルがあればスキップ（--force で再ダウンロード可能）
 */
async function downloadCloudflared() {
  if (!forceDownload && fs.existsSync(CLOUDFLARED_DEST)) {
    const size = fs.statSync(CLOUDFLARED_DEST).size;
    console.log(`\n⏭️  cloudflared.exe は既に存在します (${(size / 1024 / 1024).toFixed(1)} MB) — スキップ`);
    console.log('    再ダウンロードするには --force を付けて実行してください');
    return;
  }

  console.log('\n🌐 cloudflared.exe をダウンロード中...');
  console.log(`    URL: ${CLOUDFLARED_URL}`);

  // release/ ディレクトリを確保
  const dir = path.dirname(CLOUDFLARED_DEST);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await new Promise((resolve, reject) => {
    function download(url, redirectCount = 0) {
      if (redirectCount > 5) {
        return reject(new Error('リダイレクトが多すぎます'));
      }

      https.get(url, { headers: { 'User-Agent': 'cockroach-poker-builder' } }, (res) => {
        // リダイレクト追従
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // 現在のレスポンスを消費
          return download(res.headers.location, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`ダウンロード失敗: HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        let lastPercent = -1;

        const file = fs.createWriteStream(CLOUDFLARED_DEST);
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const percent = Math.floor((downloadedBytes / totalBytes) * 100);
            if (percent !== lastPercent && percent % 10 === 0) {
              process.stdout.write(`    進捗: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} / ${(totalBytes / 1024 / 1024).toFixed(1)} MB)\r`);
              lastPercent = percent;
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`\n✅ cloudflared.exe ダウンロード完了 (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
          resolve();
        });
        file.on('error', (err) => {
          fs.unlinkSync(CLOUDFLARED_DEST);
          reject(err);
        });
      }).on('error', reject);
    }

    download(CLOUDFLARED_URL);
  });
}

async function main() {
  if (mode === 'bundle') {
    await bundleServer();
    return;
  }

  // ── Step 1: フロントエンドビルド ──
  run('npm run build', 'フロントエンドビルド (Vite)');

  // ── Step 2: サーバーバンドル ──
  await bundleServer();

  // ── Step 3: exe生成 ──
  console.log('\n🔨 exe生成中 (pkg)...');
  
  // pkg設定で dist/ をアセットとして含める
  run(
    'npx --yes @yao-pkg/pkg server-bundle.cjs --targets node20-win-x64 --output release/cockroach-poker.exe --assets dist/**/*',
    'pkg でexe化'
  );

  // dist/ を release/ にもコピー（pkgのアセットは snapshot内に埋め込まれるが、念のためコピー）
  if (!fs.existsSync('release')) {
    fs.mkdirSync('release', { recursive: true });
  }
  
  // distフォルダをreleaseにコピー
  copyDirSync('dist', 'release/dist');

  // ── Step 4: cloudflared.exe ダウンロード ──
  try {
    await downloadCloudflared();
  } catch (err) {
    console.log(`\n⚠️ cloudflared.exe のダウンロードに失敗しました: ${err.message}`);
    console.log('    手動でダウンロードしてください:');
    console.log('    https://github.com/cloudflare/cloudflared/releases');
    console.log('    cloudflared-windows-amd64.exe → release/cloudflared.exe にリネーム');
  }
  
  console.log('\n════════════════════════════════════════════');
  console.log('  ✅ ビルド完了！');
  console.log('════════════════════════════════════════════');
  console.log('');
  console.log('  📁 release/ フォルダの中身:');
  console.log('     cockroach-poker.exe  — ゲームサーバー');
  console.log('     dist/               — フロントエンド');
  if (fs.existsSync(CLOUDFLARED_DEST)) {
    console.log('     cloudflared.exe     — インターネット公開用トンネル');
  } else {
    console.log('     ⚠️ cloudflared.exe  — 未同梱（手動配置が必要）');
  }
  console.log('');
  console.log('  💡 release/ フォルダごと配布してください');
  console.log('     cockroach-poker.exe をダブルクリックで起動！');
  console.log('');
}

function copyDirSync(src, dest) {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

main().catch(err => {
  console.error('❌ ビルドエラー:', err);
  process.exit(1);
});
