export const REGULAR_FILE_MODE = '100644';
export const EXECUTABLE_FILE_MODE = '100755';
export const SYMBOLIC_LINK = '120000';
export const DIRECTORY_MODE = '040000';
export const MAX_PATH_SIZE = 0xfff;
export const IGNORE: string[] = ['..', '.', '.trak', 'node_modules', 'bun.lock', 'README.md', '.gitignore', 'package.json', 'tsconfig.json', 'trak.sh', 'lib', 'main.ts', 'bun.lockb'];