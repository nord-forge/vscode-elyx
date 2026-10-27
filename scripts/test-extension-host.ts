import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dir, '..');
const sandbox = mkdtempSync(join(tmpdir(), 'elyx-color-host-'));
const workspace = join(sandbox, 'workspace');
const resultFile = join(sandbox, 'result.json');
const fixtures = {
  'design/tokens/colors.elyx': 'export effects = tokens { whiteAlpha7: #ffffff12, whiteAlpha10: #ffffff1a }\nexport palette = tokens { blue: #2f6f8f }\n',
  'design/tokens/spacing.elyx': 'export space = tokens { x3: 12px, x4: 16px }\n',
  'elyx/tokens/radii.elyx': 'export radius = tokens { lg: 8px }\n',
  'elyx/tokens/typography.elyx': 'export fontSize = tokens { base: 16px }\nexport fonts = tokens { body: "Menlo" }\nexport lineHeight = tokens { normal: 1.6 }\nexport letterSpacing = tokens { wide: 2% }\n',
  'design/controls/preview.elyx': 'import "design/tokens/colors.elyx" as colors\nimport "design/tokens/spacing.elyx" as spaces\n\nexport example = frame {\n  fill: colors.effects.whiteAlpha7,\n  border: colors.effects.whiteAlpha10,\n  corner-radius: radii.radius.lg,\n  padding: [spaces.space.x3, spaces.space.x4],\n  accent: colors.palette.blue,\n  title: "Colours from imported tokens"\n}\n',
};
fixtures['design/controls/preview.elyx'] = fixtures['design/controls/preview.elyx'].replace('\n}', '\n  layout: {fakeKey: [4px, // marker-preview-comment\n    8px], direction: .column},\n  sample = text {contents: "Visual typography", font-size: typography.fontSize.base, font-family: typography.fonts.body, line-height: typography.lineHeight.normal, letter-spacing: typography.letterSpacing.wide}\n}');
for (const [path, content] of Object.entries(fixtures)) {
  const file = join(workspace, path);
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, content);
}
mkdirSync(join(root, 'artifacts'), { recursive: true });
const code = process.env.ELYX_CODE_CLI || (process.argv.includes('--codium')
  ? '/Applications/VSCodium.app/Contents/Resources/app/bin/codium'
  : '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
const child = Bun.spawn([
  code, '--new-window', '--wait', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome',
  '--user-data-dir', join(sandbox, 'user'), '--extensions-dir', join(sandbox, 'extensions'),
  '--extensionDevelopmentPath', root, '--extensionTestsPath', join(root, 'test/extension-host/index.js'), workspace,
], {
  cwd: root,
  env: { ...process.env, ELYX_COLOR_TEST_ROOT: workspace, ELYX_COLOR_TEST_RESULT: resultFile,
    ELYX_COLOR_VISUAL: process.argv.includes('--visual') ? '1' : process.env.ELYX_COLOR_VISUAL },
  stdout: 'inherit', stderr: 'inherit',
});
const exitCode = await child.exited;
let result;
try {
  const bytes = readFileSync(resultFile, 'utf8');
  writeFileSync(join(root, process.argv.includes('--codium') ? 'artifacts/color-host-codium.json' : 'artifacts/color-host.json'), bytes);
  result = JSON.parse(bytes);
}
catch { console.error('Extension Host did not write a test result.'); process.exit(1); }
if (result.failed || result.passed.length < 13) {
  console.error(result.failed || 'Incomplete Extension Host checks.');
  process.exit(1);
}
console.log(`${result.passed.length} Extension Host integration checks passed.`);
process.exit(exitCode);
