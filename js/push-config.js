/* ==========================================================
   TRACKLY push settings
   The address of the push Worker (worker-push/) and its PUBLIC key. Both are public, like the other Workers' addresses.
   No secret ever goes in this file: the private key lives only inside the Worker (see worker-push/README.md).

   After you deploy the push Worker, replace the two lines below.
   ========================================================== */

export const PUSH_WORKER_URL = "https://trackly-push.trackly409.workers.dev";
export const VAPID_PUBLIC_KEY = "BLKDPn-IZkxxlyeIva7P6IOUPB2T_iKNAojHpNWrX9puyQH_VrzblUHjWZjsgNno3jYMErBwTzuiINIXe_Ou9B4";

/* True once the public key has been pasted in */
export const PUSH_CONFIGURED = !VAPID_PUBLIC_KEY.startsWith("PASTE_");
