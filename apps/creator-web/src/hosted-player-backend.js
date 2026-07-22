import { createCreatorBackend } from "./backend.js";

globalThis.reignsAgentHostedPlayerReady = createCreatorBackend().then((backend) => Object.freeze({
    basePath: import.meta.env.BASE_URL,
    request(path, body, method = "POST") {
      return backend.request(path, { method, body });
    },
    assetUrl(uri) {
      return backend.assetUrl(uri);
    }
  }));
