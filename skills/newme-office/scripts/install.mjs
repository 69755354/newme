import {cp, lstat, mkdir, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function checkRegularTree(folder) {
  for (const entry of await readdir(folder, {withFileTypes:true})) {
    const child = path.join(folder, entry.name);
    if (entry.isDirectory()) await checkRegularTree(child);
    else if (!entry.isFile()) throw new Error(`Unsupported template entry: ${child}`);
  }
}

export async function installApp(destination) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  if (!destination || !path.isAbsolute(destination)) throw new Error('Pass an absolute destination path.');
  const target = path.resolve(destination);
  const skill = await realpath(SKILL);
  const source = path.join(skill, 'assets', 'app');
  await checkRegularTree(source);
  try {
    await lstat(target);
    throw new Error('Destination already exists; choose a new directory. Nothing was overwritten.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const realParent = await realpath(path.dirname(target));
  const relative = path.relative(skill, realParent);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Choose a destination outside the installed skill directory.');
  }
  await mkdir(target);
  for (const entry of await readdir(source)) {
    await cp(path.join(source, entry), path.join(target, entry), {recursive:true, force:false, errorOnExist:true});
  }
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node install.mjs /absolute/path/to/new-app-directory');
    const target = await installApp(process.argv[2]);
    console.log(JSON.stringify({installed:true, directory:target, next:['Run npm test in this directory.', 'Run npm start, then open http://127.0.0.1:4319/.'], microphone:'off; enable only from the page'}, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
