/** Meta WhatsApp Embedded Signup (Facebook Login for Business v4). Client-only. */

export type EmbeddedSignupMeta = {
  appId: string;
  configId: string;
  graphVersion: string;
};

export type EmbeddedSignupSession = {
  waba_id?: string;
  phone_number_id?: string;
  business_id?: string;
};

type WaEmbeddedSignupMessage = {
  type?: string;
  event?: string;
  data?: {
    waba_id?: string;
    phone_number_id?: string;
    business_id?: string;
    current_step?: string;
  };
};

declare global {
  interface Window {
    FB?: {
      init: (opts: {
        appId: string;
        autoLogAppEvents?: boolean;
        xfbml?: boolean;
        version: string;
        cookie?: boolean;
      }) => void;
      login: (
        cb: (response: { authResponse?: { code?: string }; status?: string }) => void,
        opts: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras: { setup: Record<string, never> };
        }
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;
let messageListenerAttached = false;

function parseSignupMessage(raw: unknown): WaEmbeddedSignupMessage | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as WaEmbeddedSignupMessage;
    } catch {
      return null;
    }
  }
  if (typeof raw === "object") return raw as WaEmbeddedSignupMessage;
  return null;
}

function isMetaOrigin(origin: string) {
  try {
    const host = new URL(origin).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return origin.endsWith("facebook.com");
  }
}

/** Listen for WA_EMBEDDED_SIGNUP postMessage (waba_id, phone_number_id). */
export function attachEmbeddedSignupListener(onUpdate: (session: EmbeddedSignupSession) => void) {
  if (typeof window === "undefined" || messageListenerAttached) return () => {};
  messageListenerAttached = true;

  const handler = (event: MessageEvent) => {
    if (!isMetaOrigin(event.origin)) return;
    const data = parseSignupMessage(event.data);
    if (data?.type !== "WA_EMBEDDED_SIGNUP" || !data.data) return;
    const patch: EmbeddedSignupSession = {};
    if (data.data.waba_id) patch.waba_id = String(data.data.waba_id);
    if (data.data.phone_number_id) patch.phone_number_id = String(data.data.phone_number_id);
    if (data.data.business_id) patch.business_id = String(data.data.business_id);
    if (Object.keys(patch).length) onUpdate(patch);
  };

  window.addEventListener("message", handler);
  return () => {
    window.removeEventListener("message", handler);
    messageListenerAttached = false;
  };
}

export function loadMetaSdk(meta: EmbeddedSignupMeta): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Browser only"));
  if (window.FB) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: meta.appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: meta.graphVersion || "v26.0",
      });
      resolve();
    };

    if (document.getElementById("facebook-jssdk")) {
      const wait = setInterval(() => {
        if (window.FB) {
          clearInterval(wait);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(wait);
        if (!window.FB) reject(new Error("Facebook SDK load timeout"));
      }, 15000);
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onerror = () => reject(new Error("Facebook SDK load failed"));
    document.body.appendChild(script);
  });

  return sdkPromise;
}

export function launchWhatsAppEmbeddedSignup(meta: EmbeddedSignupMeta): Promise<{
  code: string;
  session: EmbeddedSignupSession;
}> {
  const session: EmbeddedSignupSession = {};

  return loadMetaSdk(meta).then(
    () =>
      new Promise((resolve, reject) => {
        const detach = attachEmbeddedSignupListener((patch) => {
          Object.assign(session, patch);
        });

        if (!window.FB) {
          detach();
          reject(new Error("Facebook SDK not ready"));
          return;
        }

        window.FB.login(
          (response) => {
            detach();
            const code = response.authResponse?.code;
            if (!code) {
              reject(new Error("WhatsApp signup cancel ho gaya ya complete nahi hua."));
              return;
            }
            resolve({ code, session: { ...session } });
          },
          {
            config_id: meta.configId,
            response_type: "code",
            override_default_response_type: true,
            extras: { setup: {} },
          }
        );
      })
  );
}
