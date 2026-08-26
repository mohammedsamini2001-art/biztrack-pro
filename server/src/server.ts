import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT) || 3000;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`BizTrack Pro API listening on port ${info.port}`);
});
