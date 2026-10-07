/** `agentcut login | logout | whoami`: this machine's sign-in to the packs marketplace. */
import { finishLogin, logout, marketUrl, signedIn, startLogin, whoami } from "@agentcut/core/modules/packs/server/market";
import { spawn } from "node:child_process";

function openBrowser(url: string) {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command === "login") {
    const current = await signedIn();
    if (current && (await whoami())) return console.log(`Already signed in to ${marketUrl()} as ${current.user.login}. Run agentcut logout to switch.`);
    const login = await startLogin();
    console.log(`\n  Confirm this code in your browser:  ${login.userCode}\n  ${login.verificationUrl}\n`);
    if (!process.argv.includes("--no-open")) openBrowser(login.verificationUrl);
    console.log("Waiting for confirmation… (Ctrl+C to cancel)");
    const user = await finishLogin(login);
    return console.log(`Signed in to ${marketUrl()} as ${user.login}.`);
  }
  if (command === "logout") return console.log((await logout()) ? `Signed out of ${marketUrl()}.` : `Not signed in to ${marketUrl()}.`);
  if (command === "whoami") {
    const user = await whoami();
    if (!user) {
      console.error(`Not signed in to ${marketUrl()}. Run agentcut login.`);
      process.exitCode = 1;
      return;
    }
    return console.log(user.login);
  }
  throw new Error("usage: agentcut login | logout | whoami");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
