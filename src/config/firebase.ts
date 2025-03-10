// src/config/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from "firebase/analytics";

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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// Initialize Analytics - only in browser environment
let analytics = null;
if (typeof window !== 'undefined') {
  analytics = getAnalytics(app);
}
export const db = getFirestore(app);

export { analytics };
export default app;