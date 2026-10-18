// node tools/vapid.mjs <file> — a new VAPID key pair for the push notifications (functions/_lib/push.js; 2026-10-18).
// Prints the public key: wrangler.toml [vars] VAPID_PUBLIC_KEY (public; the browsers subscribe with it). Writes the private
// key (the P-256 « d », base64url) to <file> — keep it out of the repository, never print it — for the Pages secret:
//   npx wrangler pages secret put VAPID_PRIVATE_KEY --project-name observatoire-cn < <file>
// and, for the local server, a line VAPID_PRIVATE_KEY=… in .dev.vars. A new pair makes every device subscribe again
// (push.js does it at its next visit); the old subscriptions fail and are dropped.
import { writeFileSync, existsSync } from "fs";
import { webcrypto } from "crypto";

const file = process.argv[2];
if (!file) { console.error("usage: node tools/vapid.mjs <file for the private key>"); process.exit(2); }
if (existsSync(file)) { console.error(`${file} exists: not overwritten`); process.exit(1); }
const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = Buffer.from(await webcrypto.subtle.exportKey("raw", kp.publicKey)).toString("base64url");
const { d } = await webcrypto.subtle.exportKey("jwk", kp.privateKey);
writeFileSync(file, d, { mode: 0o600 });
console.log(pub);
