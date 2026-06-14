import { dirname } from 'node:path';
import { styleText } from 'node:util';
import { findLatticeDir } from '../lattice.js';
import type { CmdContext, Styler } from '../context.js';

export type { CmdContext };

function makeStyler(): Styler {
  return {
    bold: (s) => styleText('bold', s),
    dim: (s) => styleText('dim', s),
    red: (s) => styleText('red', s),
    cyan: (s) => styleText('cyan', s),
    white: (s) => styleText('white', s),
    green: (s) => styleText('green', s),
    yellow: (s) => styleText('yellow', s),
    boldWhite: (s) => styleText(['bold', 'white'], s),
  };
}

export function resolveContext(opts: {
  dir?: string;
  latDir?: string;
  color?: boolean;
  docsOnly?: boolean;
}): CmdContext {
  const color = opts.color !== false;
  if (!color) {
    process.env.NO_COLOR = '1';
  }

  const docsOnly = opts.docsOnly ?? false;
  const dirName = opts.latDir;
  const latDir = findLatticeDir(opts.dir, dirName) ?? '';
  if (!latDir) {
    const target = dirName ?? 'lat.md';
    console.error(styleText('red', `No ${target} directory found`));
    console.error(styleText('dim', 'Run `lat init` to create one.'));
    process.exit(1);
  }

  const projectRoot = docsOnly ? latDir : dirname(latDir);
  return { latDir, projectRoot, styler: makeStyler(), mode: 'cli', docsOnly };
}
