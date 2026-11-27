import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import 'reflect-metadata';
import ts from 'typescript';

// Node's strip-types runner cannot load legacy Nest decorators.
const modules = new Map<string, object>();
export function loadSource<T>(filename: string): T {
  const cached = modules.get(filename);
  if (cached) return cached as T;
  const exports = {};
  modules.set(filename, exports);
  const require = createRequire(filename);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true },
  });
  const load = runInThisContext(`(function (exports, require) { ${outputText}\n})`, { filename });
  load(exports, (id: string) => id.startsWith('.')
    ? loadSource(require.resolve(`${id}.ts`))
    : require(id));
  return exports as T;
}

