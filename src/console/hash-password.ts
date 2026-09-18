import { FounderAuth } from "./auth.js";

const pbkdf2 = process.argv.includes("--pbkdf2");
const password = process.argv.filter((item) => item !== "--pbkdf2")[2];
if (!password) {
  process.stderr.write("usage: npm run console:hash-password -- [--pbkdf2] <password>\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`${pbkdf2 ? FounderAuth.hashPasswordPbkdf2(password) : FounderAuth.hashPassword(password)}\n`);
}
