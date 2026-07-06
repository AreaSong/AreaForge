import { hashPassword } from "../../packages/auth/src/index";

const password = process.argv[2];

if (!password) {
  console.error("Usage: pnpm auth:hash <password>");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
console.log(passwordHash);
