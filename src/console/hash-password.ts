import { FounderAuth } from "./auth.js";

const password = process.argv[2];
if (!password) {
  process.stderr.write("usage: npm run console:hash-password -- <password>\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`${FounderAuth.hashPassword(password)}\n`);
}
