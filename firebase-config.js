/* ==========================================================================
   firebase-config.js — data layer for Stash

   Exports two stores that share the same interface, so app.js doesn't care
   which one it talks to:
     store.init()            -> Promise, connect / sign in
     store.subscribe(cb)     -> cb(cards[]) now and on every remote change
     store.save(card)        -> Promise, create or overwrite one card
     store.remove(id)        -> Promise, delete one card

   • While firebaseConfig still holds the YOUR_ placeholders, `store` is the
     localStorage store, so the app works immediately with zero setup.
   • Once you paste real values, `store` becomes Firestore (offline cache,
     anonymous sign-in, data kept per user at stash/{uid}/cards/{cardId}).

   SETUP
   1. Firebase console → create project → add a Web app → copy its config below.
   2. Authentication → Sign-in method → enable "Google".
   3. Build → AI Logic → Get started → choose "Gemini Developer API"
      (powers the ✨ Extract tasks button; no API key goes in this code).
   4. Build → Firestore Database → create database, then use these rules:

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /stash/{uid}/cards/{cardId} {
            allow read, write: if request.auth != null && request.auth.uid == uid;
          }
        }
      }
   ========================================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyAnqeZaLWCLPXInk6Mix_7g3R44wR-BcBQ",
  authDomain: "my-personal-apps-f4ad7.firebaseapp.com",
  projectId: "my-personal-apps-f4ad7",
  storageBucket: "my-personal-apps-f4ad7.firebasestorage.app",
  messagingSenderId: "80797726651",
  appId: "1:80797726651:web:2b9b271ffbba448947f69e",
};

// App Check (blocks other people from using your Firebase/Gemini quota).
// Paste your reCAPTCHA v3 SITE key here (the public one, not the secret).
const RECAPTCHA_SITE_KEY = "YOUR_RECAPTCHA_SITE_KEY";

// All Firebase modules must use the same version. firebase-ai.js needs 11.x.
export const FIREBASE_VERSION = "11.10.0";
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;

// Set once the Firestore store has initialised; ai.js reuses it for Gemini.
let firebaseApp = null;
export const getFirebaseApp = () => firebaseApp;

export const isConfigured = () => !firebaseConfig.apiKey.startsWith("YOUR_");

/* ---------- Local store (default, no setup needed) ---------- */
function createLocalStore() {
  const KEY = "stash.cards.v1";

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  };
  const write = (list) => localStorage.setItem(KEY, JSON.stringify(list));

  return {
    mode: "local",
    async init() {},
    subscribe(cb) {
      cb(read());
      return () => {};
    },
    async save(card) {
      const list = read();
      const i = list.findIndex((c) => c.id === card.id);
      if (i >= 0) list[i] = card; else list.push(card);
      write(list);
    },
    async remove(id) {
      write(read().filter((c) => c.id !== id));
    },
  };
}

/* ---------- Firestore store ---------- */
function createFirebaseStore() {
  let fs;          // firestore module functions
  let db;
  let uid;
  let auth;
  let authApi;

  const cardsRef = () => fs.collection(db, "stash", uid, "cards");

  return {
    mode: "firebase",

    get signedIn() { return Boolean(uid); },

    // Google sign-in (call from a button click so the popup isn't blocked)
    async signIn() {
      const provider = new authApi.GoogleAuthProvider();
      const cred = await authApi.signInWithPopup(auth, provider);
      uid = cred.user.uid;
    },

    async init() {
      // Loaded on demand so local mode never touches the network.
      const [appMod, authMod, fsMod] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-auth.js`),
        import(`${CDN}/firebase-firestore.js`),
      ]);
      fs = fsMod;

      firebaseApp = appMod.initializeApp(firebaseConfig);

      // App Check must start right after initializeApp, before anything else.
      if (!RECAPTCHA_SITE_KEY.startsWith("YOUR_")) {
        // On your own computer, use a debug token (printed in the browser console).
        if (["localhost", "127.0.0.1"].includes(location.hostname)) {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        const acMod = await import(`${CDN}/firebase-app-check.js`);
        acMod.initializeAppCheck(firebaseApp, {
          provider: new acMod.ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
          isTokenAutoRefreshEnabled: true,
        });
      }
      db = fs.initializeFirestore(firebaseApp, {
        localCache: fs.persistentLocalCache({
          tabManager: fs.persistentMultipleTabManager(),
        }),
      });

      authApi = authMod;
      auth = authMod.getAuth(firebaseApp);
      // Wait for Firebase to tell us if someone is already signed in.
      const user = await new Promise((resolve, reject) => {
        const off = authMod.onAuthStateChanged(auth, (u) => { off(); resolve(u); }, reject);
      });
      uid = user && !user.isAnonymous ? user.uid : null;
    },

    subscribe(cb, onError) {
      const q = fs.query(cardsRef(), fs.orderBy("createdAt", "desc"));
      return fs.onSnapshot(
        q,
        (snap) => cb(snap.docs.map((d) => d.data())),
        (err) => { console.error("Firestore listener error:", err); onError?.(err); }
      );
    },

    save(card) {
      return fs.setDoc(fs.doc(db, "stash", uid, "cards", card.id), card);
    },

    remove(id) {
      return fs.deleteDoc(fs.doc(db, "stash", uid, "cards", id));
    },
  };
}

export const localStore = createLocalStore();
export const store = isConfigured() ? createFirebaseStore() : localStore;
