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
  error_message?: string;
  session_id?: string;
};

type WaEmbeddedSignupMessage = {
  type?: string;
  event?: string;
  data?: {
    waba_id?: string;
    phone_number_id?: string;
    business_id?: string;
    current_step?: string;
    error_message?: string;
    error_id?: string;
    session_id?: string;
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
          extras: { setup: Record<string, never>; sessionInfoVersion?: string };
        }
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;
let initedAppId = "";

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
  return origin === "https://www.facebook.com" || origin === "https://web.facebook.com";
}

export function loadMetaSdk(meta: EmbeddedSignupMeta): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Browser only"));
  if (window.FB && initedAppId === meta.appId) return Promise.resolve();
  if (sdkPromise && initedAppId === meta.appId) return sdkPromise;

  sdkPromise = new Promise<void>((resolve, reject) => {
    const init = () => {
      window.FB?.init({
        appId: meta.appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: meta.graphVersion || "v26.0",
      });
      initedAppId = meta.appId;
      resolve();
    };

    window.fbAsyncInit = init;

    if (window.FB) {
      init();
      return;
    }

    if (document.getElementById("facebook-jssdk")) {
      const wait = setInterval(() => {
        if (window.FB) {
          clearInterval(wait);
          init();
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

/** Must run synchronously inside a click handler — do not await before this. */
export function launchWhatsAppEmbeddedSignup(meta: EmbeddedSignupMeta): Promise<{
  code: string;
  session: EmbeddedSignupSession;
}> {
  if (!window.FB) {
    return Promise.reject(new Error("Facebook SDK abhi ready nahi. Page refresh karke dubara try karein."));
  }

  const session: EmbeddedSignupSession = {};

  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      if (!isMetaOrigin(event.origin)) return;
      const data = parseSignupMessage(event.data);
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      const eventName = String(data.event || "").toUpperCase();
      if (data.data?.waba_id) session.waba_id = String(data.data.waba_id);
      if (data.data?.phone_number_id) session.phone_number_id = String(data.data.phone_number_id);
      if (data.data?.business_id) session.business_id = String(data.data.business_id);
      if (data.data?.session_id) session.session_id = String(data.data.session_id);
      if (eventName === "ERROR") {
        session.error_message =
          data.data?.error_message || data.data?.error_id || "Meta Embedded Signup error";
      }
    };

    window.addEventListener("message", handler);

    window.FB.login(
      (response) => {
        window.removeEventListener("message", handler);
        const code = response.authResponse?.code;
        if (!code) {
          reject(
            new Error(
              session.error_message ||
                "WhatsApp signup complete nahi hua. Meta app Live nahi hai, config ID galat hai, ya domain allow nahi."
            )
          );
          return;
        }
        resolve({ code, session: { ...session } });
      },
      {
        config_id: meta.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: "3",
        },
      }
    );
  });
}
