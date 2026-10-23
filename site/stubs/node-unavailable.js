// Browser build only: server configuration readers are never called by the playground (it
// injects the deployment, trust policy and chain provider). If one ever is, fail loudly.
const unavailable = (name) => () => {
  throw new Error(`${name} is not available in the browser playground`);
};
export const readFileSync = unavailable("fs.readFileSync");
export const existsSync = unavailable("fs.existsSync");
export const mkdirSync = unavailable("fs.mkdirSync");
export const resolve = unavailable("path.resolve");
export const join = unavailable("path.join");
export const dirname = unavailable("path.dirname");
export default { readFileSync, existsSync, mkdirSync, resolve, join, dirname };
