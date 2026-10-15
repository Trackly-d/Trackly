/* ==========================================================
   TRACKLY Firebase setup
   This is the ONLY file that knows your Firebase keys and the SDK version.
   1. Replace the values inside firebaseConfig with the ones from your
      Firebase console (Project settings, Your apps, Web app).
   2. Everything else in the project imports from this file.
   The SDK version (12.18.0) appears in the gstatic.com links below.
   If Firebase shows a newer number, change it in those links only.
   ========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// Lets the other files import Firebase login tools from here, so the version lives in one place.
export * from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

// Database tools (Firestore) the other files need
export * from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD6rZXBAf8vwb0Fm_eIcoJ5iVmHFljcEfc",
  authDomain: "trackly-e18d8.firebaseapp.com",
  projectId: "trackly-e18d8",
  storageBucket: "trackly-e18d8.firebasestorage.app",
  messagingSenderId: "787803662405",
  appId: "1:787803662405:web:9ab58c9e2b8bcc8de7db2c"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);