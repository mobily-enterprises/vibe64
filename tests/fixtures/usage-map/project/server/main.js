import http from "node:http";

import { registerSessionRoutes } from "../packages/sessions/src/server/routes.js";
import { Router } from "./router.js";

const router = new Router();
registerSessionRoutes(router);
http.createServer((request, response) => router.handle(request, response)).listen(Number(process.env.PORT || 3000));
