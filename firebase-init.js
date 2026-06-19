import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Creates a throwaway secondary Firebase app instance with its own Auth.
// Used so an Admin can register a brand-new employee account via
// createUserWithEmailAndPassword WITHOUT signing themselves out of their
// own session (which is what would happen if we used the primary `auth`).
export function createSecondaryAuth(){
  const name = `secondary-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, name);
  const secondaryAuth = getAuth(secondaryApp);
  return {
    auth: secondaryAuth,
    cleanup: () => deleteApp(secondaryApp)
  };
}

