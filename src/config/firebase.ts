// src/config/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence, connectFirestoreEmulator, Firestore } from 'firebase/firestore';
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCbMN-DfK_-MZhdVJNLH2gh0PUNq0qckNk",
  authDomain: "flower-shop-transactions.firebaseapp.com",
  projectId: "flower-shop-transactions",
  storageBucket: "flower-shop-transactions.firebasestorage.app",
  messagingSenderId: "16277816248",
  appId: "1:16277816248:web:64f5c7f25fbaa3acbe054d",
  measurementId: "G-BWYWCG430B"
};

// Initialize Firebase with improved error handling
let app = initializeApp(firebaseConfig);
let db: Firestore = getFirestore(app);
let analytics = null;

try {
  console.log("[Firebase] 🔄 Initializing Firebase...");
  
  // Enable persistence for offline support
  if (typeof window !== 'undefined') {
    enableIndexedDbPersistence(db)
      .then(() => {
        console.log("[Firebase] ✅ Offline persistence enabled");
      })
      .catch((error) => {
        console.warn("[Firebase] ⚠️ Offline persistence could not be enabled:", error.code);
      });
      
    // Initialize Analytics if supported
    isAnalyticsSupported().then(supported => {
      if (supported) {
        analytics = getAnalytics(app);
        console.log("[Firebase] ✅ Analytics initialized");
      } else {
        console.log("[Firebase] ℹ️ Analytics not supported in this environment");
      }
    });
  }
  
  console.log("[Firebase] ✅ Firebase initialized successfully");
} catch (error) {
  console.error("[Firebase] ❌ Error initializing Firebase:", error);
}

// Connect to emulator if in development mode
if (process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
  try {
    connectFirestoreEmulator(db, 'localhost', 8080);
    console.log("[Firebase] 🧪 Connected to Firestore emulator");
  } catch (error) {
    console.error("[Firebase] ❌ Failed to connect to Firestore emulator:", error);
  }
}

export { analytics, app };
export { db };
export default app;