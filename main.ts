// make.fun frontend entry — program (Node 22, standard library only).
//
// The frontend itself is plain static files in app/ (index.html, one CSS file
// and a few small ES modules, no build step) that read make.fun's public API
// in the browser. This program is the hand-in: it gathers app/ and the three
// screenshots/ into the output directory and writes dossier.json, the summary
// the judge reads (screenshots, first-load files and bytes, source), using
// the kit's vendored library. It makes no network calls and writes the same
// bytes on every run.
//
// Run it outside the grader with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function copyTree(from, to) {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}

mkdirSync(outDir, { recursive: true });
copyTree(join(repoRoot, 'app'), join(outDir, 'app'));
copyTree(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));

// Caps from the gate: dossier text at most 160 KiB, at most 3 screenshots of
// at most 256 KiB each, app/ at most 993 files and directories and 16 MiB.
// buildDossier refuses anything past them, so a bad app fails here, loudly.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 3, max_bytes: 262144 },
    app_max_files: 993,
    app_max_bytes: 16777216,
  }),
);
