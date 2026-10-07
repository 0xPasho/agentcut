import path from "node:path";

const home = (arg: string) => arg.replace(/^~(?=\/)/, process.env.HOME ?? "~");

/**
 * Commands run with the install's root as their working directory, so a path the
 * caller typed relative to *their* directory is made absolute first. Only path
 * positions are rewritten: instructions, ids and project titles are literal.
 */
export function planArgs(command: string, rest: string[], from: string): string[] {
  const args = rest.map((arg, index) => {
    if (command === "packs" && ["inspect", "import", "publish"].includes(rest[0]) && index === 1 && !/^https?:\/\//i.test(arg)) return path.resolve(from, home(arg));
    if (command === "projects" && (rest[0] === "create" || rest[0] === "batch") && index >= 2 && !arg.startsWith("--") && rest[index - 1] !== "--brief") return path.resolve(from, home(arg));
    if ((command === "render" && index === 0 && /\.json$/i.test(arg)) || (command === "edit" && rest[1] === "call" && index === 2)) return path.resolve(from, arg);
    // --slot name=folder: the folder is a caller-relative path; the slot name is not.
    if (command === "templates") {
      const inline = /^--slot=(.*)$/s.exec(arg);
      if (inline || rest[index - 1] === "--slot") {
        const [name, folder] = (inline ? inline[1] : arg).split(/=(.*)/s);
        if (folder) {
          const target = path.resolve(from, home(folder));
          return inline ? `--slot=${name}=${target}` : `${name}=${target}`;
        }
      }
    }
    return arg;
  });
  if (command === "publishing" && args[0] === "call" && args[1]) args[1] = path.resolve(from, args[1]);
  if (command === "workspace" && args[1]) args[1] = path.resolve(from, home(args[1]));
  // One entry serves three commands; it learns which from its first argument.
  if (command === "login" || command === "logout" || command === "whoami") return [command, ...args];
  return args;
}
