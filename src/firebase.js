// src/firebase.js
import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { sendPasswordResetEmail } from "firebase/auth";
// --- 1. IMPORT getFirestore ---
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import publicConfig from "../shared/firebase-public.json";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || publicConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || publicConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || publicConfig.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || publicConfig.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || publicConfig.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || publicConfig.appId,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// --- 2. INITIALIZE FIRESTORE ---
const db = getFirestore(app);
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST) {
  connectAuthEmulator(auth, "http://" + import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
}
if (import.meta.env.DEV && import.meta.env.VITE_FIRESTORE_EMULATOR_HOST) {
  const [host, port] = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST.split(":");
  connectFirestoreEmulator(db, host, Number(port));
}

// --- 3. EXPORT db ALONG WITH EVERYTHING ELSE ---
export {
  auth,
  db, // Add db to the export list
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail
};
