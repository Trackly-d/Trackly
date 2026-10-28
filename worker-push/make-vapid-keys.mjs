/* Makes the two keys the push Worker needs (VAPID keys). Run on YOUR computer:   node worker-push/make-vapid-keys.mjs
   - PUBLIC key: safe to share. It goes in js/push-config.js (VAPID_PUBLIC_KEY) and in wrangler.toml (VAPID_PUBLIC_KEY).
   - PRIVATE key: a secret. Do NOT paste it in a chat, a file in the project, or GitHub. The command below asks you for it
     and keeps it inside Cloudflare:   npx wrangler secret put VAPID_PRIVATE_JWK
   This script prints the private key once. Copy it straight into that prompt, then close the terminal. */
import { webcrypto as crypto } from "node:crypto";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);

console.log("\nPUBLIC key (safe to share):\n" + raw.toString("base64url"));
console.log("\nPRIVATE key (secret, paste it only into the wrangler prompt):\n" + JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }) + "\n");
