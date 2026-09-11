/** Server-only env. Bracket access avoids some static inlining; never use NEXT_PUBLIC_ for secrets. */

function read(name: string) {
  return (process.env[name] || "").trim();
}

export function metaPublicSignupConfig() {
  const appId = read("META_APP_ID");
  const configId = read("META_EMBEDDED_SIGNUP_CONFIG_ID");
  const graphVersion = read("META_GRAPH_VERSION") || "v26.0";
  return {
    appId,
    configId,
    graphVersion,
    configured: Boolean(appId && configId),
  };
}

export function metaAppSecret() {
  return read("META_APP_SECRET");
}
