import logger from "../utils/logger";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import {
  initializeApp as initAdmin,
  cert,
  getApps as getAdminApps,
} from "firebase-admin/app";
import { getDatabase as adminGetDatabase } from "firebase-admin/database";

type AdminDb = import("firebase-admin/database").Database;

let adminDb: AdminDb | undefined;

function ensureInit(): void {
  if (adminDb) return;

  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  const explicitPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  const gcloudPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const inlineJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const inlineBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const projectIdEnv = process.env.FIREBASE_PROJECT_ID;
  const clientEmailEnv = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyEnv = process.env.FIREBASE_PRIVATE_KEY;
  const privateKeyB64Env = process.env.FIREBASE_PRIVATE_KEY_BASE64;

  // Default to local file `serviceAccountKey.json` in project root if present
  const defaultLocal = resolve(process.cwd(), "serviceAccountKey.json");

  const candidatePaths = [explicitPath, gcloudPath, defaultLocal].filter(
    (p): p is string => !!p
  );

  let creds: any | undefined;

  // Prefer inline JSON
  if (inlineJson) {
    try {
      creds = JSON.parse(inlineJson);
    } catch (e) {
      logger.warn("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }

  // Base64-encoded JSON
  if (!creds && inlineBase64) {
    try {
      const raw = Buffer.from(inlineBase64, "base64").toString("utf8");
      creds = JSON.parse(raw);
    } catch (e) {
      logger.warn("FIREBASE_SERVICE_ACCOUNT_BASE64 is invalid or not base64 JSON");
    }
  }

  // Split ENV (client_email + private_key [+ projectId])
  if (!creds && clientEmailEnv) {
    try {
      let privateKey: string | undefined;
      if (privateKeyB64Env) {
        privateKey = Buffer.from(privateKeyB64Env, "base64").toString("utf8");
      } else if (privateKeyEnv) {
        privateKey = privateKeyEnv.replace(/\\n/g, "\n");
      }
      if (privateKey) {
        creds = {
          projectId: projectIdEnv,
          clientEmail: clientEmailEnv,
          privateKey,
        };
      }
    } catch (e) {
      logger.warn("Failed to construct service account from split env vars");
    }
  }

  // Fallback to files from env paths or local default
  if (!creds) {
    for (const p of candidatePaths) {
      try {
        if (existsSync(p)) {
          const raw = readFileSync(p, "utf8");
          creds = JSON.parse(raw);
          break;
        }
      } catch (e) {
        // keep trying other options
        logger.warn(`Failed reading Firebase service account at ${p}`);
      }
    }
  }

  if (!creds) {
    logger.warn(
      "Firebase Admin not configured (missing serviceAccountKey). RTDB writes disabled."
    );
    return;
  }

  if (!databaseURL) {
    logger.warn(
      "FIREBASE_DATABASE_URL missing. Set it to your RTDB URL to enable persistence."
    );
    return;
  }

  try {
    if (getAdminApps().length === 0) {
      initAdmin({
        credential: cert(creds as any),
        databaseURL,
      });
    }
    adminDb = adminGetDatabase();
    logger.info("Firebase Admin initialized");
  } catch (e) {
    logger.error("Failed to initialize Firebase Admin SDK", e);
  }
}

export async function rtdbGet<T = any>(path: string): Promise<T | undefined> {
  ensureInit();
  if (!adminDb) return undefined;
  try {
    const snap = await adminDb.ref(path).get();
    return snap.exists() ? (snap.val() as T) : undefined;
  } catch (e) {
    logger.error("Firebase rtdbGet failed", e);
    return undefined;
  }
}

export async function rtdbSet(path: string, value: any): Promise<void> {
  ensureInit();
  if (!adminDb) return; // no-op if not configured
  try {
    await adminDb.ref(path).set(value);
  } catch (e) {
    logger.error("Firebase rtdbSet failed", e);
  }
}
