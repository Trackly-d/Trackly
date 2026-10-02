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
export { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCTDm-8cf5rKUlP-OCr_00bB6PYMrCPYbc",
  authDomain: "trackly-d0644.firebaseapp.com",
  projectId: "trackly-d0644",
  storageBucket: "trackly-d0644.firebasestorage.app",
  messagingSenderId: "246676384071",
  appId: "1:246676384071:web:630df15e79da5fdfe74462"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);