// Prints a scrypt hash for APP_PASSWORD_HASH.
// Usage: npm run hash-password -- "my secret password"
import { hashPassword } from "../src/auth.js";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your password"');
  process.exit(1);
}
console.log(await hashPassword(password));
